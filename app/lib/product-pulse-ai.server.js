import prisma from "../db.server";
import { isProductPulseDevelopment } from "./product-pulse-dev.server";
import { recordJobLog, serializeError } from "./product-pulse-job-logs.server";

const GEMINI_PROVIDER = "gemini";
const OPENAI_PROVIDER = "openai";
const GEMINI_PRIMARY_RETRY_MS = 24 * 60 * 60 * 1000;

const AI_TASKS = {
  signal_classification: {
    modelEnv: ["OPENAI_PRO_MODEL", "OPENAI_PREMIUM_MODEL", "OPENAI_BASIC_MODEL"],
    fallbackModel: "gpt-5.4-mini",
    maxOutputTokens: 3200,
    temperature: 0.1,
  },
  content_gap: {
    modelEnv: ["OPENAI_BASIC_MODEL", "OPENAI_PRO_MODEL", "OPENAI_PREMIUM_MODEL"],
    fallbackModel: "gpt-5.4-nano",
    maxOutputTokens: 1600,
    temperature: 0.1,
  },
  final_report: {
    modelEnv: ["OPENAI_PREMIUM_MODEL", "OPENAI_PRO_MODEL", "OPENAI_BASIC_MODEL"],
    fallbackModel: "gpt-5.4",
    maxOutputTokens: 3600,
    temperature: 0.2,
  },
  test_text: {
    modelEnv: ["OPENAI_PREMIUM_MODEL", "OPENAI_PRO_MODEL", "OPENAI_BASIC_MODEL"],
    fallbackModel: "gpt-5.4",
    maxOutputTokens: 520,
    temperature: 0.35,
  },
};

export async function runProductDiagnosisAiAnalysis({ shop, jobId, input }) {
  const classificationPrompt = buildSignalClassificationPrompt(input);
  const classificationResponse = await generateAiText({
    shop,
    jobId,
    task: "signal_classification",
    prompt: classificationPrompt,
  });
  const classification = parseAiJson(classificationResponse.text, {
    classified_signals: [],
    clusters: [],
    main_issue: input?.deterministic?.mainIssue || "product_quality",
    issue_summary: "AI classification was unavailable; deterministic issue signals were used.",
    source_agreement: "unknown",
  });

  const gapPrompt = buildContentGapPrompt(input, classification);
  const gapResponse = await generateAiText({
    shop,
    jobId,
    task: "content_gap",
    prompt: gapPrompt,
  });
  const contentGaps = parseAiJson(gapResponse.text, {
    missing: [],
    present: [],
    notes: "AI PDP content-gap analysis was unavailable.",
  });

  const reportPrompt = buildFinalReportPrompt(input, classification, contentGaps);
  const reportResponse = await generateAiText({
    shop,
    jobId,
    task: "final_report",
    prompt: reportPrompt,
  });
  const report = parseAiJson(reportResponse.text, {
    main_finding_title: input?.deterministic?.mainIssueLabel || "Product issue needs review",
    main_finding_detail: input?.deterministic?.evidenceSummary || "ProductPulse found deterministic signals that should be reviewed.",
    evidence_summary: input?.deterministic?.evidenceSummary || "",
    recommendation_copy: {},
  });

  return {
    provider: reportResponse.provider,
    model: reportResponse.model,
    modelsUsed: {
      classification: pickAiModelSummary(classificationResponse),
      contentGap: pickAiModelSummary(gapResponse),
      finalReport: pickAiModelSummary(reportResponse),
    },
    classification,
    contentGaps,
    report,
    raw: {
      classification: classificationResponse.text,
      contentGaps: gapResponse.text,
      report: reportResponse.text,
    },
  };
}

export async function generateProductDiagnosisTestText({ shop, jobId, product }) {
  const prompt = buildProductDiagnosisPrompt(product);
  return generateAiText({ shop, jobId, task: "test_text", prompt });
}

function buildSignalClassificationPrompt(input) {
  const snippets = JSON.stringify(input?.evidenceSnippets || [], null, 2);
  const metrics = JSON.stringify(input?.deterministic || {}, null, 2);
  const product = JSON.stringify(input?.product || {}, null, 2);

  return [
    "You are ProductPulse AI. Classify customer evidence for one ecommerce product.",
    "Use the text evidence only to interpret language. Do not calculate financial metrics, rates, counts, confidence, or risk score.",
    "Return valid JSON only. No markdown.",
    "Schema:",
    JSON.stringify({
      classified_signals: [{
        source: "judgeme_review|shopify_return_note|shopify_return_reason",
        text: "short evidence snippet",
        issue_category: "fit_sizing|quality_defect|durability|color_expectation|compatibility|shipping_delivery|support_conversation|other",
        issue_detail: "snake_case_detail",
        affected_area: "optional",
        sentiment: "negative|neutral|positive",
        severity: "low|medium|high",
        product_related: true,
        recommended_action_type: "fit_note|faq|description_update|tag|support_note|variant_review|image_or_size_chart|none",
      }],
      clusters: [{
        issue_category: "fit_sizing",
        issue_detail: "runs_small",
        human_name: "Runs small",
        summary: "short explanation",
        signals: 0,
        source_types: ["judgeme_reviews", "returns"],
        severity: "low|medium|high",
      }],
      main_issue: "fit_sizing",
      main_issue_label: "Sizing and fit",
      issue_summary: "one concise paragraph",
      source_agreement: "returns_and_reviews_agree|single_source|weak|none",
    }, null, 2),
    "Product:",
    product,
    "Deterministic metrics, already calculated by the system:",
    metrics,
    "Evidence snippets:",
    snippets,
  ].join("\n\n");
}

function buildContentGapPrompt(input, classification) {
  const product = input?.product || {};
  const normalizedDescription = String(product.description || "").replace(/\s+/g, " ").slice(0, 5000);

  return [
    "You are checking a product detail page for missing shopper guidance.",
    "Use the current product description and the issue clusters. Return valid JSON only.",
    "Do not invent metrics or claim a gap exists unless the product content appears to be missing it.",
    "Schema:",
    JSON.stringify({
      present: ["material info"],
      missing: ["fit note"],
      notes: "concise explanation",
      issue_specific_gaps: [{
        issue_category: "fit_sizing",
        missing_content: "fit note",
        why_it_matters: "Customers mention tight chest fit.",
      }],
    }, null, 2),
    "Product content:",
    JSON.stringify({
      title: product.title,
      handle: product.handle,
      description: normalizedDescription,
      tags: product.tags || [],
      options: product.options || [],
      variants: (product.variants || []).slice(0, 50),
      metafields: product.metafields || [],
    }, null, 2),
    "AI clusters:",
    JSON.stringify(classification?.clusters || [], null, 2),
  ].join("\n\n");
}

function buildFinalReportPrompt(input, classification, contentGaps) {
  return [
    "You are ProductPulse AI writing the final product diagnosis report for a merchant.",
    "The system already calculated all numeric metrics. Never change risk score, confidence, impact, rates, counts, or amounts.",
    "Use the metrics, clusters, PDP gaps, and recommendation candidates to explain what is happening and draft merchant-ready copy.",
    "Return valid JSON only. No markdown.",
    "Schema:",
    JSON.stringify({
      main_finding_title: "Sizing and fit expectations are not being met",
      main_finding_detail: "2-3 sentence user-facing finding grounded in evidence",
      evidence_summary: "1-2 sentence source agreement summary",
      issue_names: [{ code: "fit_sizing.runs_small", label: "Runs small" }],
      recommendation_copy: {
        pdp_copy: "merchant-ready product page copy",
        faq_question: "How does this product fit?",
        faq_answer: "merchant-ready FAQ answer",
        support_note: "short internal support note",
      },
    }, null, 2),
    "Product:",
    JSON.stringify(input?.product || {}, null, 2),
    "Deterministic metrics:",
    JSON.stringify(input?.deterministic || {}, null, 2),
    "AI classification:",
    JSON.stringify(classification || {}, null, 2),
    "PDP content gaps:",
    JSON.stringify(contentGaps || {}, null, 2),
    "Recommendation candidates chosen by rules:",
    JSON.stringify(input?.recommendationCandidates || [], null, 2),
  ].join("\n\n");
}

function buildProductDiagnosisPrompt(product) {
  const metrics = product.metrics || {};
  const sources = Array.isArray(product.sourceCoverage) ? product.sourceCoverage.join(", ") : "Shopify products";
  const returnReasons = Array.isArray(metrics.topReturnReasons) && metrics.topReturnReasons.length
    ? metrics.topReturnReasons.join(", ")
    : "none captured";

  return [
    "Write one single Spanish test text for ProductPulse AI, around 150 to 210 words.",
    "It should feel clearly AI-generated, a bit imaginative and slightly random, but still useful and product-specific.",
    "This is only a connection test, not a final product diagnosis.",
    `Product title: ${product.title}.`,
    `Handle: ${product.handle || "unknown"}.`,
    `Risk score: ${product.riskScore ?? 0}/100.`,
    `Primary issue: ${product.primaryIssue || "not available"}.`,
    `Stored sources: ${sources}.`,
    `Top return reasons: ${returnReasons}.`,
    "Return only one paragraph. Do not include bullets, markdown, JSON, recommendations or headings.",
  ].join("\n");
}

async function generateAiText({ shop, jobId, task, prompt }) {
  const provider = isProductPulseDevelopment() ? GEMINI_PROVIDER : OPENAI_PROVIDER;
  const taskConfig = AI_TASKS[task] || AI_TASKS.final_report;

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.ai_provider_selected",
    message: `Selected ${provider === GEMINI_PROVIDER ? "Gemini" : "OpenAI"} for ${task}.`,
    data: {
      provider,
      task,
      developmentMode: isProductPulseDevelopment(),
    },
  });

  return provider === GEMINI_PROVIDER
    ? generateWithGemini({ shop, jobId, task, taskConfig, prompt })
    : generateWithOpenAI({ shop, jobId, task, taskConfig, prompt });
}

async function generateWithOpenAI({ shop, jobId, task, taskConfig, prompt }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = resolveOpenAIModel(taskConfig);

  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  if (!model) throw new Error("No OpenAI model is configured.");

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.openai_request",
    message: `Sending ${task} prompt to OpenAI.`,
    data: { provider: OPENAI_PROVIDER, model, task },
  });

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: prompt,
      max_output_tokens: taskConfig.maxOutputTokens,
      temperature: taskConfig.temperature,
    }),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json.error?.message || `OpenAI request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  const text = extractOpenAIText(json);
  if (!text) throw new Error(`OpenAI returned an empty ${task} response.`);

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.openai_response",
    message: `OpenAI returned ${task}.`,
    data: { provider: OPENAI_PROVIDER, model, task, text },
  });

  return { provider: OPENAI_PROVIDER, model, task, text };
}

function resolveOpenAIModel(taskConfig) {
  for (const envName of taskConfig.modelEnv || []) {
    const value = String(process.env[envName] || "").trim();
    if (value) return value;
  }
  return taskConfig.fallbackModel;
}

function extractOpenAIText(response) {
  if (typeof response.output_text === "string" && response.output_text.trim()) return response.output_text.trim();

  const chunks = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
      if (typeof content.output_text === "string") chunks.push(content.output_text);
    }
  }

  return chunks.join("\n").trim();
}

async function generateWithGemini({ shop, jobId, task, taskConfig, prompt }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const models = getGeminiModelPool();
  if (!models.length) throw new Error("No Gemini model is configured.");

  const orderedModels = await getGeminiAttemptOrder(models);
  let lastError = null;

  for (const [index, model] of orderedModels.entries()) {
    const primaryAttempt = model === models[0];
    if (primaryAttempt) await rememberGeminiPrimaryRetry(model);

    try {
      await recordJobLog({
        shop,
        jobId,
        event: "product_diagnosis.gemini_request",
        message: `Sending ${task} prompt to Gemini model ${model}.`,
        data: { provider: GEMINI_PROVIDER, model, task, attempt: index + 1 },
      });

      const text = await requestGeminiText({ apiKey, model, prompt, taskConfig });
      await rememberGeminiSuccess(model);
      await recordJobLog({
        shop,
        jobId,
        event: "product_diagnosis.gemini_response",
        message: `Gemini returned ${task}.`,
        data: { provider: GEMINI_PROVIDER, model, task, text },
      });

      return { provider: GEMINI_PROVIDER, model, task, text };
    } catch (error) {
      lastError = error;
      await rememberGeminiFailure(model, error);
      await recordJobLog({
        shop,
        jobId,
        level: "warn",
        event: "product_diagnosis.gemini_model_failed",
        message: `Gemini model ${model} failed${shouldTryNextGeminiModel(error) ? "; trying fallback." : "."}`,
        data: { provider: GEMINI_PROVIDER, model, task, error: serializeError(error) },
      });

      if (!shouldTryNextGeminiModel(error)) throw error;
    }
  }

  throw lastError || new Error("All Gemini models failed.");
}

function getGeminiModelPool() {
  return uniqueTruthy([
    process.env.GEMINI_MODEL,
    ...String(process.env.GEMINI_MODEL_FALLBACK_POOL || process.env.GEMINI_MODEL_FALLBACK_PUL || "")
      .split(",")
      .map((model) => model.trim()),
  ]);
}

async function getGeminiAttemptOrder(models) {
  const state = await prisma.productPulseAiProviderState.findUnique({
    where: { provider: GEMINI_PROVIDER },
  }).catch(() => null);

  const now = Date.now();
  const lastPrimaryRetry = state?.lastPrimaryRetryAt ? new Date(state.lastPrimaryRetryAt).getTime() : 0;
  const shouldRetryPrimary = !lastPrimaryRetry || now - lastPrimaryRetry >= GEMINI_PRIMARY_RETRY_MS;
  if (shouldRetryPrimary || !state?.currentModel) return models;

  const currentIndex = models.indexOf(state.currentModel);
  if (currentIndex <= 0) return models;
  return [...models.slice(currentIndex), ...models.slice(0, currentIndex)];
}

async function requestGeminiText({ apiKey, model, prompt, taskConfig }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: taskConfig.temperature,
          maxOutputTokens: taskConfig.maxOutputTokens,
        },
      }),
    },
  );

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json.error?.message || `Gemini request failed with HTTP ${response.status}.`);
    error.status = response.status;
    error.code = json.error?.status || json.error?.code;
    throw error;
  }

  const text = (json.candidates || [])
    .flatMap((candidate) => candidate.content?.parts || [])
    .map((part) => part.text)
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!text) throw new Error("Gemini returned an empty product diagnosis response.");
  return text;
}

function shouldTryNextGeminiModel(error) {
  const message = `${error?.message || ""} ${error?.code || ""}`.toLowerCase();
  return (
    error?.status === 429 ||
    error?.status === 404 ||
    message.includes("quota") ||
    message.includes("resource_exhausted") ||
    message.includes("rate") ||
    message.includes("token") ||
    message.includes("not found") ||
    message.includes("model")
  );
}

async function rememberGeminiPrimaryRetry(model) {
  await prisma.productPulseAiProviderState.upsert({
    where: { provider: GEMINI_PROVIDER },
    create: {
      provider: GEMINI_PROVIDER,
      currentModel: model,
      lastPrimaryRetryAt: new Date(),
      metadata: { reason: "daily_primary_retry" },
    },
    update: {
      currentModel: model,
      lastPrimaryRetryAt: new Date(),
      metadata: { reason: "daily_primary_retry" },
    },
  }).catch(() => {});
}

async function rememberGeminiSuccess(model) {
  await prisma.productPulseAiProviderState.upsert({
    where: { provider: GEMINI_PROVIDER },
    create: {
      provider: GEMINI_PROVIDER,
      currentModel: model,
      failureCount: 0,
      metadata: { lastSuccessAt: new Date().toISOString() },
    },
    update: {
      currentModel: model,
      failureCount: 0,
      metadata: { lastSuccessAt: new Date().toISOString() },
    },
  }).catch(() => {});
}

async function rememberGeminiFailure(model, error) {
  await prisma.productPulseAiProviderState.upsert({
    where: { provider: GEMINI_PROVIDER },
    create: {
      provider: GEMINI_PROVIDER,
      currentModel: model,
      failureCount: 1,
      metadata: { lastFailureAt: new Date().toISOString(), error: serializeError(error) },
    },
    update: {
      currentModel: model,
      failureCount: { increment: 1 },
      metadata: { lastFailureAt: new Date().toISOString(), error: serializeError(error) },
    },
  }).catch(() => {});
}

function parseAiJson(text, fallback) {
  const raw = String(text || "").trim();
  if (!raw) return fallback;

  const candidates = [
    raw,
    raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim(),
    extractJsonBlock(raw),
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate shape.
    }
  }

  return { ...fallback, raw_text: raw.slice(0, 4000) };
}

function extractJsonBlock(text) {
  const firstObject = text.indexOf("{");
  const lastObject = text.lastIndexOf("}");
  if (firstObject >= 0 && lastObject > firstObject) return text.slice(firstObject, lastObject + 1);

  const firstArray = text.indexOf("[");
  const lastArray = text.lastIndexOf("]");
  if (firstArray >= 0 && lastArray > firstArray) return text.slice(firstArray, lastArray + 1);
  return "";
}

function pickAiModelSummary(response) {
  return {
    provider: response.provider,
    model: response.model,
    task: response.task,
  };
}

function uniqueTruthy(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}
