import prisma from "../db.server";
import { recordJobLog, serializeError } from "./product-pulse-job-logs.server";

const OPENAI_API_BASE_URL = "https://api.openai.com/v1";
const OPENAI_BATCH_ENDPOINT = "/v1/responses";
const OPENAI_BATCH_COMPLETION_WINDOW = "24h";
const TERMINAL_OPENAI_BATCH_STATUSES = new Set(["completed", "failed", "expired", "cancelled"]);

export function isOpenAiBatchTerminalStatus(status) {
  return TERMINAL_OPENAI_BATCH_STATUSES.has(String(status || "").toLowerCase());
}

export async function createProductPulseOpenAiBatchGroup({
  shop,
  jobId,
  productGid = null,
  requests = [],
  resumePayload = null,
  metadata = {},
} = {}) {
  const normalizedRequests = requests
    .map((request) => normalizeBatchRequest(request))
    .filter(Boolean);

  if (!shop || !jobId) throw new Error("OpenAI Batch group requires shop and jobId.");
  if (!normalizedRequests.length) {
    throw new Error("OpenAI Batch group requires at least one request.");
  }

  const groupedRequests = groupRequestsByModel(normalizedRequests);
  const requestCount = normalizedRequests.length;
  const group = await prisma.productPulseOpenAiBatchGroup.create({
    data: {
      shop,
      jobId,
      productGid,
      status: "submitting",
      requestCount,
      resumePayload: jsonSafe(resumePayload),
      metadata: jsonSafe({
        ...metadata,
        modelCount: groupedRequests.length,
        requestCount,
      }),
    },
  });

  try {
    const batches = [];
    for (const [model, modelRequests] of groupedRequests) {
      batches.push(await createOpenAiBatchForModel({
        group,
        shop,
        jobId,
        productGid,
        model,
        requests: modelRequests,
        metadata,
      }));
    }

    const submittedAt = new Date();
    const updatedGroup = await prisma.productPulseOpenAiBatchGroup.update({
      where: { id: group.id },
      data: {
        status: "submitted",
        submittedAt,
        metadata: jsonSafe({
          ...metadata,
          modelCount: batches.length,
          requestCount,
          openAiBatchIds: batches.map((batch) => batch.openAiBatchId).filter(Boolean),
        }),
      },
      include: { batches: { include: { requests: true } } },
    });

    await recordJobLog({
      shop,
      jobId,
      event: "product_diagnosis.openai_batch_submitted",
      message: `Submitted ${requestCount} terminal Product Diagnosis AI request${requestCount === 1 ? "" : "s"} to OpenAI Batch API.`,
      data: {
        groupId: updatedGroup.id,
        batches: updatedGroup.batches.map((batch) => ({
          id: batch.id,
          openAiBatchId: batch.openAiBatchId,
          model: batch.model,
          requestCount: batch.requestCount,
          inputFileId: batch.inputFileId,
        })),
      },
    });

    return updatedGroup;
  } catch (error) {
    await prisma.productPulseOpenAiBatchGroup.update({
      where: { id: group.id },
      data: {
        status: "failed",
        failedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    }).catch(() => {});
    throw error;
  }
}

export async function processOpenAiBatchWebhookEvent(event = {}, headers = {}) {
  const eventId = getOpenAiWebhookEventId(event, headers);
  const eventType = String(event?.type || "unknown");
  const openAiObjectId = extractOpenAiBatchIdFromEvent(event);
  const eventRow = await createOrGetWebhookEvent({
    id: eventId,
    type: eventType,
    openAiObjectId,
    payload: event,
  });

  if (eventRow.status === "processed") {
    return { status: "duplicate", eventId, openAiObjectId };
  }

  if (!openAiObjectId) {
    await markWebhookEventProcessed(eventId, { status: "ignored" });
    return { status: "ignored", eventId, reason: "not_a_batch_event" };
  }

  try {
    const result = await refreshAndProcessOpenAiBatch(openAiObjectId);
    await markWebhookEventProcessed(eventId, { status: "processed" });
    return {
      status: "processed",
      eventId,
      openAiBatchId: openAiObjectId,
      ...result,
    };
  } catch (error) {
    await prisma.productPulseOpenAiWebhookEvent.update({
      where: { id: eventId },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    }).catch(() => {});
    throw error;
  }
}

export async function refreshAndProcessOpenAiBatch(openAiBatchId) {
  const batchRow = await prisma.productPulseOpenAiBatch.findUnique({
    where: { openAiBatchId },
    include: { group: true, requests: true },
  });
  if (!batchRow) {
    return { status: "ignored", reason: "batch_not_tracked" };
  }

  const remoteBatch = await retrieveOpenAiBatch(openAiBatchId);
  const remoteStatus = String(remoteBatch.status || batchRow.status || "").toLowerCase();
  await updateTrackedBatchFromRemote(batchRow, remoteBatch);

  if (isOpenAiBatchTerminalStatus(remoteStatus)) {
    await processTerminalBatchFiles(batchRow, remoteBatch);
  }

  const group = await refreshOpenAiBatchGroupStatus(batchRow.groupId);
  return {
    status: remoteStatus,
    batchId: batchRow.id,
    groupId: batchRow.groupId,
    jobId: batchRow.jobId,
    shop: batchRow.shop,
    groupReady: Boolean(group?.completedAt && !group.processedAt),
    group,
  };
}

export async function getOpenAiBatchGroupForJob(jobId) {
  return prisma.productPulseOpenAiBatchGroup.findUnique({
    where: { jobId },
    include: {
      batches: {
        include: { requests: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function getOpenAiBatchGroup(groupId) {
  return prisma.productPulseOpenAiBatchGroup.findUnique({
    where: { id: groupId },
    include: {
      batches: {
        include: { requests: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function claimOpenAiBatchGroupForResume(groupId) {
  const claimed = await prisma.productPulseOpenAiBatchGroup.updateMany({
    where: {
      id: groupId,
      status: { in: ["completed", "completed_with_errors", "resume_failed"] },
      processedAt: null,
    },
    data: {
      status: "resuming",
    },
  });

  if (claimed.count !== 1) return null;
  return getOpenAiBatchGroup(groupId);
}

export async function markOpenAiBatchGroupProcessed(groupId, result = {}) {
  return prisma.productPulseOpenAiBatchGroup.update({
    where: { id: groupId },
    data: {
      status: "processed",
      processedAt: new Date(),
      result: jsonSafe(result),
      errorMessage: null,
    },
  });
}

export async function markOpenAiBatchGroupResumeFailed(groupId, error) {
  return prisma.productPulseOpenAiBatchGroup.update({
    where: { id: groupId },
    data: {
      status: "resume_failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    },
  });
}

export function extractOpenAiBatchIdFromEvent(event = {}) {
  const candidates = [
    event?.data?.id,
    event?.data?.batch_id,
    event?.data?.batchId,
    event?.data?.batch?.id,
    event?.data?.object?.id,
    event?.id,
  ];
  return candidates
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .find((value) => value.startsWith("batch_")) || null;
}

export function extractOpenAiBatchResponseText(responseBody = {}) {
  if (typeof responseBody.output_text === "string" && responseBody.output_text.trim()) {
    return responseBody.output_text.trim();
  }

  const chunks = [];
  for (const item of responseBody.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
      if (typeof content.output_text === "string") chunks.push(content.output_text);
    }
  }

  return chunks.join("\n").trim();
}

async function createOpenAiBatchForModel({ group, shop, jobId, productGid, model, requests, metadata }) {
  const batchRow = await prisma.productPulseOpenAiBatch.create({
    data: {
      groupId: group.id,
      shop,
      jobId,
      productGid,
      model,
      status: "creating",
      endpoint: OPENAI_BATCH_ENDPOINT,
      completionWindow: OPENAI_BATCH_COMPLETION_WINDOW,
      requestCount: requests.length,
      metadata: jsonSafe(metadata),
    },
  });

  const requestRows = requests.map((request, index) => {
    const customId = buildCustomId(batchRow.id, request.task, index);
    return {
      customId,
      task: request.task,
      model,
      request: {
        custom_id: customId,
        method: "POST",
        url: OPENAI_BATCH_ENDPOINT,
        body: request.body,
      },
    };
  });

  await prisma.productPulseOpenAiBatchRequest.createMany({
    data: requestRows.map((request) => ({
      batchId: batchRow.id,
      customId: request.customId,
      task: request.task,
      model,
      status: "queued",
      request: jsonSafe(request.request),
    })),
  });

  const jsonl = requestRows.map((request) => JSON.stringify(request.request)).join("\n") + "\n";
  const uploadedFile = await uploadOpenAiBatchFile({
    jsonl,
    fileName: `productpulse-${jobId}-${batchRow.id}.jsonl`,
  });
  const openAiBatch = await createOpenAiBatch({
    inputFileId: uploadedFile.id,
    metadata: {
      productpulse_batch_group_id: group.id,
      productpulse_batch_id: batchRow.id,
      productpulse_job_id: jobId,
      productpulse_shop: shop,
      productpulse_model: model,
    },
  });

  return prisma.productPulseOpenAiBatch.update({
    where: { id: batchRow.id },
    data: {
      status: String(openAiBatch.status || "validating").toLowerCase(),
      openAiBatchId: openAiBatch.id,
      inputFileId: uploadedFile.id,
      submittedAt: new Date(),
      outputFileId: openAiBatch.output_file_id || null,
      errorFileId: openAiBatch.error_file_id || null,
      completedAt: fromUnixSeconds(openAiBatch.completed_at),
      failedAt: fromUnixSeconds(openAiBatch.failed_at || openAiBatch.expired_at || openAiBatch.cancelled_at),
      metadata: jsonSafe({
        ...metadata,
        openAiBatchId: openAiBatch.id,
        inputFileId: uploadedFile.id,
        requestCount: requests.length,
      }),
    },
  });
}

function normalizeBatchRequest(request = {}) {
  const task = String(request.task || "").trim();
  const model = String(request.model || "").trim();
  const prompt = String(request.prompt || "").trim();
  if (!task || !model || !prompt) return null;

  return {
    task,
    model,
    body: {
      model,
      input: prompt,
      max_output_tokens: request.maxOutputTokens,
      temperature: request.temperature,
    },
  };
}

function groupRequestsByModel(requests = []) {
  const groups = new Map();
  requests.forEach((request) => {
    const current = groups.get(request.model) || [];
    current.push(request);
    groups.set(request.model, current);
  });
  return [...groups.entries()];
}

function buildCustomId(batchId, task, index) {
  const normalizedTask = String(task || "task").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60);
  return `pp_${batchId}_${index}_${normalizedTask}`;
}

async function uploadOpenAiBatchFile({ jsonl, fileName }) {
  const form = new FormData();
  form.append("purpose", "batch");
  form.append("file", new Blob([jsonl], { type: "application/jsonl" }), fileName);

  return fetchOpenAiJson("/files", {
    method: "POST",
    body: form,
  });
}

async function createOpenAiBatch({ inputFileId, metadata }) {
  return fetchOpenAiJson("/batches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input_file_id: inputFileId,
      endpoint: OPENAI_BATCH_ENDPOINT,
      completion_window: OPENAI_BATCH_COMPLETION_WINDOW,
      metadata: normalizeOpenAiMetadata(metadata),
    }),
  });
}

async function retrieveOpenAiBatch(openAiBatchId) {
  return fetchOpenAiJson(`/batches/${encodeURIComponent(openAiBatchId)}`);
}

async function downloadOpenAiFile(fileId) {
  const response = await fetch(`${OPENAI_API_BASE_URL}/files/${encodeURIComponent(fileId)}/content`, {
    headers: {
      Authorization: `Bearer ${getOpenAiApiKey()}`,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`OpenAI file download failed with HTTP ${response.status}: ${text || response.statusText}`);
  }
  return response.text();
}

async function fetchOpenAiJson(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Authorization", `Bearer ${getOpenAiApiKey()}`);
  const response = await fetch(`${OPENAI_API_BASE_URL}${path}`, {
    ...init,
    headers,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json.error?.message || `OpenAI request failed with HTTP ${response.status}.`;
    const error = new Error(message);
    error.status = response.status;
    error.code = json.error?.code || json.error?.type || null;
    error.details = json.error || json;
    throw error;
  }
  return json;
}

function getOpenAiApiKey() {
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  return apiKey;
}

async function updateTrackedBatchFromRemote(batchRow, remoteBatch = {}) {
  const status = String(remoteBatch.status || "").toLowerCase();
  return prisma.productPulseOpenAiBatch.update({
    where: { id: batchRow.id },
    data: {
      status: status || undefined,
      outputFileId: remoteBatch.output_file_id || null,
      errorFileId: remoteBatch.error_file_id || null,
      completedRequestCount: Number(remoteBatch.request_counts?.completed || 0),
      failedRequestCount: Number(remoteBatch.request_counts?.failed || 0),
      completedAt: fromUnixSeconds(remoteBatch.completed_at),
      failedAt: fromUnixSeconds(remoteBatch.failed_at || remoteBatch.expired_at || remoteBatch.cancelled_at),
      errorMessage: formatOpenAiBatchErrors(remoteBatch.errors),
      metadata: jsonSafe({
        ...(batchRow.metadata || {}),
        requestCounts: remoteBatch.request_counts || null,
        errors: remoteBatch.errors || null,
      }),
    },
  });
}

async function processTerminalBatchFiles(batchRow, remoteBatch = {}) {
  const outputFileId = remoteBatch.output_file_id || batchRow.outputFileId;
  const errorFileId = remoteBatch.error_file_id || batchRow.errorFileId;
  let processedOutput = 0;
  let processedErrors = 0;

  if (outputFileId) {
    const outputJsonl = await downloadOpenAiFile(outputFileId);
    processedOutput = await processBatchOutputJsonl(batchRow.id, outputJsonl);
  }

  if (errorFileId) {
    const errorJsonl = await downloadOpenAiFile(errorFileId);
    processedErrors = await processBatchErrorJsonl(batchRow.id, errorJsonl);
  }

  if (!outputFileId && !errorFileId && String(remoteBatch.status || batchRow.status).toLowerCase() !== "completed") {
    await prisma.productPulseOpenAiBatchRequest.updateMany({
      where: { batchId: batchRow.id, status: { not: "completed" } },
      data: {
        status: "failed",
        error: jsonSafe(remoteBatch.errors || { message: "OpenAI batch ended without an output or error file." }),
      },
    });
  }

  const counts = await countBatchRequests(batchRow.id);
  await prisma.productPulseOpenAiBatch.update({
    where: { id: batchRow.id },
    data: {
      processedAt: new Date(),
      completedRequestCount: counts.completed,
      failedRequestCount: counts.failed,
      metadata: jsonSafe({
        ...(batchRow.metadata || {}),
        requestCounts: remoteBatch.request_counts || null,
        errors: remoteBatch.errors || null,
        processedOutput,
        processedErrors,
      }),
    },
  });
}

async function processBatchOutputJsonl(batchId, jsonl) {
  let processed = 0;
  for (const line of parseJsonl(jsonl)) {
    const customId = String(line.custom_id || "").trim();
    if (!customId) continue;
    const statusCode = Number(line.response?.status_code || 0);
    const responseBody = line.response?.body || null;
    const outputText = responseBody ? extractOpenAiBatchResponseText(responseBody) : "";
    const error = line.error || (statusCode >= 400 ? line.response : null);
    const completed = statusCode >= 200 && statusCode < 300 && Boolean(outputText);
    await prisma.productPulseOpenAiBatchRequest.updateMany({
      where: { batchId, customId },
      data: {
        status: completed ? "completed" : "failed",
        response: jsonSafe(line.response || null),
        error: jsonSafe(error || null),
        outputText: outputText || null,
        usage: jsonSafe(responseBody?.usage || null),
      },
    });
    processed += 1;
  }
  return processed;
}

async function processBatchErrorJsonl(batchId, jsonl) {
  let processed = 0;
  for (const line of parseJsonl(jsonl)) {
    const customId = String(line.custom_id || "").trim();
    if (!customId) continue;
    await prisma.productPulseOpenAiBatchRequest.updateMany({
      where: { batchId, customId, status: { not: "completed" } },
      data: {
        status: "failed",
        error: jsonSafe(line.error || line),
      },
    });
    processed += 1;
  }
  return processed;
}

async function countBatchRequests(batchId) {
  const groups = await prisma.productPulseOpenAiBatchRequest.groupBy({
    by: ["status"],
    where: { batchId },
    _count: { _all: true },
  });
  return {
    completed: groups.find((group) => group.status === "completed")?._count?._all || 0,
    failed: groups
      .filter((group) => group.status !== "completed")
      .reduce((total, group) => total + Number(group._count?._all || 0), 0),
  };
}

async function refreshOpenAiBatchGroupStatus(groupId) {
  const group = await prisma.productPulseOpenAiBatchGroup.findUnique({
    where: { id: groupId },
    include: { batches: { include: { requests: true } } },
  });
  if (!group) return null;

  const requestCount = group.batches.reduce((total, batch) => total + Number(batch.requestCount || 0), 0);
  const completedRequestCount = group.batches.reduce((total, batch) => total + Number(batch.completedRequestCount || 0), 0);
  const failedRequestCount = group.batches.reduce((total, batch) => total + Number(batch.failedRequestCount || 0), 0);
  const allTerminal = group.batches.length > 0 && group.batches.every((batch) => isOpenAiBatchTerminalStatus(batch.status));
  const allProcessed = allTerminal && group.batches.every((batch) => batch.processedAt);
  const anyFailed = failedRequestCount > 0 || group.batches.some((batch) => String(batch.status || "").toLowerCase() !== "completed");
  const status = allProcessed
    ? anyFailed ? "completed_with_errors" : "completed"
    : allTerminal ? "finalizing" : "submitted";

  return prisma.productPulseOpenAiBatchGroup.update({
    where: { id: groupId },
    data: {
      status,
      requestCount,
      completedRequestCount,
      failedRequestCount,
      completedAt: allProcessed ? new Date() : null,
    },
    include: { batches: { include: { requests: true } } },
  });
}

async function createOrGetWebhookEvent({ id, type, openAiObjectId, payload }) {
  try {
    return await prisma.productPulseOpenAiWebhookEvent.create({
      data: {
        id,
        type,
        openAiObjectId,
        payload: jsonSafe(payload),
      },
    });
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    return prisma.productPulseOpenAiWebhookEvent.findUnique({ where: { id } });
  }
}

async function markWebhookEventProcessed(id, { status = "processed" } = {}) {
  return prisma.productPulseOpenAiWebhookEvent.update({
    where: { id },
    data: {
      status,
      processedAt: new Date(),
      errorMessage: null,
    },
  });
}

function getOpenAiWebhookEventId(event = {}, headers = {}) {
  const headerValue = typeof headers.get === "function"
    ? headers.get("webhook-id")
    : headers["webhook-id"] || headers["Webhook-Id"] || headers.webhookId;
  return String(event?.id || headerValue || `evt_local_${Date.now()}_${Math.random().toString(36).slice(2)}`);
}

function parseJsonl(jsonl) {
  return String(jsonl || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return { error: serializeError(error), raw: line };
      }
    });
}

function fromUnixSeconds(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return new Date(numeric * 1000);
}

function normalizeOpenAiMetadata(metadata = {}) {
  return Object.fromEntries(
    Object.entries(metadata || {})
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim() !== "")
      .slice(0, 16)
      .map(([key, value]) => [
        String(key).replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 64),
        String(value).slice(0, 512),
      ]),
  );
}

function formatOpenAiBatchErrors(errors) {
  if (!errors) return null;
  if (typeof errors === "string") return errors.slice(0, 2000);
  try {
    return JSON.stringify(errors).slice(0, 2000);
  } catch {
    return String(errors).slice(0, 2000);
  }
}

function jsonSafe(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}
