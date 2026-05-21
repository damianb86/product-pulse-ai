import prisma from "../../db.server";
import { estimateAiTurnCost, type AiEstimatedCost } from "./pricing";
import type { AiTokenUsage } from "./tokenUsage";

export type AiUsageSource =
  | "chat"
  | "product_diagnosis"
  | "watchlist"
  | "csv_import"
  | "ai_test"
  | "legacy_chat_trace"
  | "legacy_job_log"
  | "unknown";

export interface AiUsageEventInput {
  shop: string;
  userId?: string | number | null;
  source: AiUsageSource | string;
  operation: string;
  provider: string;
  model: string;
  task?: string | null;
  requestContext?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  jobId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  status?: string | null;
  usage?: unknown;
  estimatedCost?: AiEstimatedCost | null;
  createdAt?: Date | string | null;
  env?: NodeJS.ProcessEnv;
}

export interface AiUsageDashboardRecord {
  id: string;
  source: string;
  sourceLabel: string;
  operation: string;
  provider: string;
  model: string;
  task: string | null;
  requestContext: string | null;
  conversationId: string | null;
  messageId: string | null;
  jobId: string | null;
  entityType: string | null;
  entityId: string | null;
  status: string;
  usage: AiTokenUsage;
  estimatedCost: AiEstimatedCost;
  createdAt: string;
  legacy: boolean;
}

export interface AiUsageDashboardData {
  generatedAt: string;
  totals: AiUsageDashboardTotals;
  last7Days: AiUsageDashboardTotals;
  last30Days: AiUsageDashboardTotals;
  bySource: AiUsageDashboardGroup[];
  byModel: AiUsageDashboardGroup[];
  byTask: AiUsageDashboardGroup[];
  recentEvents: AiUsageDashboardRecord[];
  notes: string[];
}

export interface AiUsageDashboardTotals {
  estimatedTotalUsd: number;
  knownCostEvents: number;
  unknownCostEvents: number;
  eventCount: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export interface AiUsageDashboardGroup extends AiUsageDashboardTotals {
  key: string;
  label: string;
  provider?: string;
  model?: string;
}

type UsageEventClient = {
  create?: (input: { data: Record<string, unknown> }) => Promise<unknown>;
  findMany?: (input: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
};

type DashboardPrismaClient = {
  aiUsageEvent?: UsageEventClient;
  aiConversationMessage?: {
    findMany?: (input: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
  };
  productPulseJobLog?: {
    findMany?: (input: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
  };
};

export function isAiCostDashboardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return booleanEnv(env.AI_COST_DASHBOARD_ENABLED, false);
}

export async function recordAiUsageEvent(input: AiUsageEventInput): Promise<unknown | null> {
  const shop = String(input.shop || "").trim();
  const model = String(input.model || "").trim();
  if (!shop || !model) return null;

  const client = (prisma as unknown as DashboardPrismaClient).aiUsageEvent;
  if (!client?.create) return null;

  const usage = normalizeUsageForCost(input.usage);
  const estimatedCost = input.estimatedCost
    ?? estimateUsageCost({
      provider: input.provider,
      model,
      usage,
      env: input.env,
    });

  try {
    return await client.create({
      data: {
        shop,
        userId: input.userId == null ? undefined : String(input.userId),
        source: cleanDimension(input.source, "unknown"),
        operation: cleanDimension(input.operation, "ai_operation"),
        provider: cleanDimension(input.provider, "unknown"),
        model,
        task: cleanOptionalDimension(input.task),
        requestContext: cleanOptionalDimension(input.requestContext),
        conversationId: cleanOptionalDimension(input.conversationId),
        messageId: cleanOptionalDimension(input.messageId),
        jobId: cleanOptionalDimension(input.jobId),
        entityType: cleanOptionalDimension(input.entityType),
        entityId: cleanOptionalDimension(input.entityId),
        status: cleanDimension(input.status, "success"),
        usage: compactUsagePayload(input.usage, usage),
        inputTokens: usage.inputTokens ?? undefined,
        outputTokens: usage.outputTokens ?? undefined,
        cachedInputTokens: usage.cachedInputTokens ?? undefined,
        reasoningTokens: usage.reasoningOutputTokens ?? undefined,
        totalTokens: usage.totalTokens ?? undefined,
        estimatedCost: estimatedCost ?? undefined,
        estimatedTotalUsd: estimatedCost?.totalUsd ?? undefined,
        createdAt: input.createdAt ? new Date(input.createdAt) : undefined,
      },
    });
  } catch {
    return null;
  }
}

export async function getAiUsageDashboardForShop(
  shop: string,
  options: { env?: NodeJS.ProcessEnv; limit?: number; now?: Date } = {},
): Promise<AiUsageDashboardData> {
  const env = options.env || process.env;
  const now = options.now || new Date();
  const limit = Math.min(5000, Math.max(100, Number(options.limit || 1200)));
  const client = prisma as unknown as DashboardPrismaClient;

  const [usageEvents, legacyChatMessages, legacyJobLogs] = await Promise.all([
    fetchUsageEvents(client, shop, limit),
    fetchLegacyChatMessages(client, shop, limit),
    fetchLegacyJobLogs(client, shop, limit),
  ]);

  const recordsFromEvents = usageEvents.map((event) => mapStoredUsageEvent(event, env));
  const eventMessageIds = new Set(recordsFromEvents.map((record) => record.messageId).filter(Boolean));
  const eventJobIds = new Set(recordsFromEvents.map((record) => record.jobId).filter(Boolean));
  const legacyChatRecords = legacyChatMessages
    .flatMap((message) => mapLegacyChatTrace(message, env))
    .filter((record) => !record.messageId || !eventMessageIds.has(record.messageId));
  const legacyJobRecords = legacyJobLogs
    .filter((log) => !eventJobIds.has(String(log.jobId || "")))
    .flatMap((log) => mapLegacyJobLogUsage(log, env));

  const records = [...recordsFromEvents, ...legacyChatRecords, ...legacyJobRecords]
    .filter(Boolean)
    .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt));

  const last7Cutoff = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const last30Cutoff = now.getTime() - 30 * 24 * 60 * 60 * 1000;
  const totals = summarizeRecords(records);
  const notes = buildDashboardNotes(records, totals);

  return {
    generatedAt: now.toISOString(),
    totals,
    last7Days: summarizeRecords(records.filter((record) => Date.parse(record.createdAt) >= last7Cutoff)),
    last30Days: summarizeRecords(records.filter((record) => Date.parse(record.createdAt) >= last30Cutoff)),
    bySource: groupRecords(records, (record) => record.source, (record) => record.sourceLabel),
    byModel: groupRecords(
      records,
      (record) => `${record.provider}:${record.model}`,
      (record) => `${formatProviderLabel(record.provider)} / ${record.model}`,
      (record) => ({ provider: record.provider, model: record.model }),
    ),
    byTask: groupRecords(records, (record) => record.task || record.operation, (record) => formatTaskLabel(record.task || record.operation)),
    recentEvents: records.slice(0, 25),
    notes,
  };
}

function estimateUsageCost(input: {
  provider?: string | null;
  model: string;
  usage: AiTokenUsage | null;
  env?: NodeJS.ProcessEnv;
}): AiEstimatedCost {
  if (String(input.provider || "").toLowerCase() === "cache") {
    return {
      model: input.model,
      estimated: true,
      currency: "USD",
      inputUsd: 0,
      cachedInputUsd: 0,
      outputUsd: 0,
      totalUsd: 0,
      pricing: {
        model: input.model,
        inputUsdPerMillion: 0,
        cachedInputUsdPerMillion: 0,
        outputUsdPerMillion: 0,
        source: "default",
      },
      missingUsage: false,
      missingPricing: false,
    };
  }

  return estimateAiTurnCost({
    model: input.model,
    usage: input.usage,
    env: input.env,
  });
}

function normalizeUsageForCost(value: unknown): AiTokenUsage {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const inputTokens = numberOrNull(record.inputTokens ?? record.input_tokens ?? record.prompt_tokens ?? record.promptTokenCount);
  const outputTokens = numberOrNull(record.outputTokens ?? record.output_tokens ?? record.completion_tokens ?? record.candidatesTokenCount);
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: numberOrNull(record.cachedInputTokens ?? record.cached_input_tokens ?? record.cached_tokens ?? record.cachedContentTokenCount),
    reasoningOutputTokens: numberOrNull(record.reasoningOutputTokens ?? record.reasoningTokens ?? record.reasoning_tokens ?? record.thoughtsTokenCount),
    totalTokens: numberOrNull(record.totalTokens ?? record.total_tokens ?? record.totalTokenCount) ?? sumKnownTokens(inputTokens, outputTokens),
    raw: record && Object.keys(record).length ? record : null,
  };
}

function compactUsagePayload(rawUsage: unknown, usage: AiTokenUsage): Record<string, unknown> {
  const raw = rawUsage && typeof rawUsage === "object" ? rawUsage as Record<string, unknown> : {};
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.cachedInputTokens,
    reasoningTokens: usage.reasoningOutputTokens,
    totalTokens: usage.totalTokens,
    usageSource: typeof raw.usageSource === "string" ? raw.usageSource : null,
  };
}

async function fetchUsageEvents(client: DashboardPrismaClient, shop: string, limit: number) {
  if (!client.aiUsageEvent?.findMany) return [];
  return client.aiUsageEvent.findMany({
    where: { shop },
    orderBy: { createdAt: "desc" },
    take: limit,
  }).catch(() => []);
}

async function fetchLegacyChatMessages(client: DashboardPrismaClient, shop: string, limit: number) {
  if (!client.aiConversationMessage?.findMany) return [];
  return client.aiConversationMessage.findMany({
    where: { shop, role: "assistant" },
    orderBy: { createdAt: "desc" },
    take: limit,
  }).catch(() => []);
}

async function fetchLegacyJobLogs(client: DashboardPrismaClient, shop: string, limit: number) {
  if (!client.productPulseJobLog?.findMany) return [];
  return client.productPulseJobLog.findMany({
    where: {
      shop,
      event: { contains: "ai_token_usage" },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  }).catch(() => []);
}

function mapStoredUsageEvent(row: Record<string, unknown>, env: NodeJS.ProcessEnv): AiUsageDashboardRecord {
  const usage = normalizeUsageForCost({
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cachedInputTokens: row.cachedInputTokens,
    reasoningTokens: row.reasoningTokens,
    totalTokens: row.totalTokens,
    ...readRecord(row.usage),
  });
  const storedCost = readRecord(row.estimatedCost) as AiEstimatedCost | null;
  const estimatedCost = storedCost?.estimated
    ? storedCost
    : estimateUsageCost({ provider: stringValue(row.provider), model: stringValue(row.model), usage, env });

  return {
    id: stringValue(row.id),
    source: stringValue(row.source, "unknown"),
    sourceLabel: formatSourceLabel(stringValue(row.source, "unknown")),
    operation: stringValue(row.operation, "ai_operation"),
    provider: stringValue(row.provider, "unknown"),
    model: stringValue(row.model, "unknown"),
    task: nullableString(row.task),
    requestContext: nullableString(row.requestContext),
    conversationId: nullableString(row.conversationId),
    messageId: nullableString(row.messageId),
    jobId: nullableString(row.jobId),
    entityType: nullableString(row.entityType),
    entityId: nullableString(row.entityId),
    status: stringValue(row.status, "success"),
    usage,
    estimatedCost,
    createdAt: toIso(row.createdAt),
    legacy: false,
  };
}

function mapLegacyChatTrace(message: Record<string, unknown>, env: NodeJS.ProcessEnv): AiUsageDashboardRecord[] {
  const structured = readRecord(message.structuredContent);
  const trace = readRecord(structured?.trace);
  if (!trace) return [];
  const usage = normalizeUsageForCost(trace.tokenUsage);
  const traceCost = readRecord(trace.estimatedCost);
  const estimatedCost = traceCost?.estimated
    ? traceCost as unknown as AiEstimatedCost
    : estimateUsageCost({ provider: "openai", model: stringValue(trace.model, "unknown"), usage, env });

  return [{
    id: `legacy-chat:${stringValue(message.id)}`,
    source: "legacy_chat_trace",
    sourceLabel: "AI chat",
    operation: "chat_turn",
    provider: "openai",
    model: stringValue(trace.model, "unknown"),
    task: "chat_turn",
    requestContext: null,
    conversationId: nullableString(message.conversationId),
    messageId: nullableString(message.id),
    jobId: null,
    entityType: null,
    entityId: null,
    status: trace.errorStatus ? "error" : "success",
    usage,
    estimatedCost,
    createdAt: toIso(message.createdAt ?? trace.createdAt),
    legacy: true,
  }];
}

function mapLegacyJobLogUsage(log: Record<string, unknown>, env: NodeJS.ProcessEnv): AiUsageDashboardRecord[] {
  const data = readRecord(log.data);
  const aiUsage = readRecord(data?.aiUsage);
  const aiUsageRecord = aiUsage || {};
  const calls = Array.isArray(aiUsage?.calls) ? aiUsage.calls : [];
  return calls.flatMap((rawCall, index) => {
    const call = readRecord(rawCall);
    if (!call) return [];
    const usage = normalizeUsageForCost(call);
    const provider = stringValue(call.provider, "unknown");
    const model = stringValue(call.model, "unknown");
    return [{
      id: `legacy-job:${stringValue(log.id)}:${index}`,
      source: "legacy_job_log",
      sourceLabel: formatSourceLabel(stringValue(aiUsageRecord.operation || "product_diagnosis")),
      operation: stringValue(aiUsageRecord.operation || "product_diagnosis"),
      provider,
      model,
      task: nullableString(call.task),
      requestContext: nullableString(call.requestContext),
      conversationId: null,
      messageId: null,
      jobId: nullableString(log.jobId),
      entityType: data?.productGid || aiUsageRecord.productGid ? "product" : null,
      entityId: nullableString(data?.productGid ?? aiUsageRecord.productGid),
      status: stringValue(log.level) === "error" ? "error" : "success",
      usage,
      estimatedCost: estimateUsageCost({ provider, model, usage, env }),
      createdAt: toIso(log.createdAt),
      legacy: true,
    }];
  });
}

function summarizeRecords(records: AiUsageDashboardRecord[]): AiUsageDashboardTotals {
  return records.reduce<AiUsageDashboardTotals>((totals, record) => {
    totals.eventCount += 1;
    if (typeof record.estimatedCost.totalUsd === "number") {
      totals.estimatedTotalUsd += record.estimatedCost.totalUsd;
      totals.knownCostEvents += 1;
    } else {
      totals.unknownCostEvents += 1;
    }
    totals.inputTokens += record.usage.inputTokens || 0;
    totals.outputTokens += record.usage.outputTokens || 0;
    totals.cachedInputTokens += record.usage.cachedInputTokens || 0;
    totals.reasoningTokens += record.usage.reasoningOutputTokens || 0;
    totals.totalTokens += record.usage.totalTokens || 0;
    return totals;
  }, emptyTotals());
}

function emptyTotals(): AiUsageDashboardTotals {
  return {
    estimatedTotalUsd: 0,
    knownCostEvents: 0,
    unknownCostEvents: 0,
    eventCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

function groupRecords(
  records: AiUsageDashboardRecord[],
  getKey: (record: AiUsageDashboardRecord) => string,
  getLabel: (record: AiUsageDashboardRecord) => string,
  getExtra: (record: AiUsageDashboardRecord) => Partial<AiUsageDashboardGroup> = () => ({}),
): AiUsageDashboardGroup[] {
  const groups = new Map<string, AiUsageDashboardGroup>();
  records.forEach((record) => {
    const key = getKey(record) || "unknown";
    const group = groups.get(key) || {
      key,
      label: getLabel(record),
      ...getExtra(record),
      ...emptyTotals(),
    };
    const nextTotals = summarizeRecords([record]);
    Object.assign(group, mergeTotals(group, nextTotals));
    groups.set(key, group);
  });
  return Array.from(groups.values())
    .sort((first, second) => second.estimatedTotalUsd - first.estimatedTotalUsd || second.totalTokens - first.totalTokens);
}

function mergeTotals(first: AiUsageDashboardTotals, second: AiUsageDashboardTotals): AiUsageDashboardTotals {
  return {
    estimatedTotalUsd: first.estimatedTotalUsd + second.estimatedTotalUsd,
    knownCostEvents: first.knownCostEvents + second.knownCostEvents,
    unknownCostEvents: first.unknownCostEvents + second.unknownCostEvents,
    eventCount: first.eventCount + second.eventCount,
    inputTokens: first.inputTokens + second.inputTokens,
    outputTokens: first.outputTokens + second.outputTokens,
    cachedInputTokens: first.cachedInputTokens + second.cachedInputTokens,
    reasoningTokens: first.reasoningTokens + second.reasoningTokens,
    totalTokens: first.totalTokens + second.totalTokens,
  };
}

function buildDashboardNotes(records: AiUsageDashboardRecord[], totals: AiUsageDashboardTotals): string[] {
  const notes = [
    "Costs are estimates from provider token usage and the configured model pricing table.",
  ];
  if (totals.unknownCostEvents > 0) {
    notes.push(`${totals.unknownCostEvents} tracked event${totals.unknownCostEvents === 1 ? "" : "s"} need model pricing before their USD cost can be included.`);
  }
  if (records.some((record) => record.legacy)) {
    notes.push("Some rows come from legacy chat traces or development job logs created before persistent AI usage events existed.");
  }
  return notes;
}

function formatSourceLabel(source: string): string {
  const normalized = String(source || "").toLowerCase();
  if (normalized === "chat" || normalized === "legacy_chat_trace") return "AI chat";
  if (normalized === "product_diagnosis" || normalized === "legacy_job_log") return "Product diagnosis";
  if (normalized === "watchlist") return "Watchlist";
  if (normalized === "csv_import") return "CSV import";
  if (normalized === "ai_test") return "AI test";
  return "Other AI usage";
}

function formatProviderLabel(provider: string): string {
  const normalized = String(provider || "").toLowerCase();
  if (normalized === "openai") return "OpenAI";
  if (normalized === "gemini") return "Gemini";
  if (normalized === "cache") return "Cache";
  return provider || "Unknown";
}

function formatTaskLabel(task: string): string {
  return String(task || "unknown")
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Unknown";
}

function booleanEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function cleanDimension(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, 160) : fallback;
}

function cleanOptionalDimension(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, 300) : undefined;
}

function stringValue(value: unknown, fallback = ""): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function nullableString(value: unknown): string | null {
  const text = stringValue(value);
  return text || null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.round(parsed));
}

function sumKnownTokens(...values: Array<number | null>): number | null {
  if (values.some((value) => typeof value !== "number")) return null;
  return (values as number[]).reduce((sum, value) => sum + value, 0);
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value || ""));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : new Date(0).toISOString();
}
