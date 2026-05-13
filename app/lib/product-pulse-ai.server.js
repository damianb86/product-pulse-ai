import prisma from "../db.server";
import { isProductPulseDevelopment } from "./product-pulse-dev.server";
import { recordJobLog, serializeError } from "./product-pulse-job-logs.server";

const GEMINI_PROVIDER = "gemini";
const OPENAI_PROVIDER = "openai";
const GEMINI_PRIMARY_RETRY_MS = 24 * 60 * 60 * 1000;

export async function generateProductDiagnosisTestText({ shop, jobId, product }) {
  const provider = isProductPulseDevelopment() ? GEMINI_PROVIDER : OPENAI_PROVIDER;
  const prompt = buildProductDiagnosisPrompt(product);

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.ai_provider_selected",
    message: `Selected ${provider === GEMINI_PROVIDER ? "Gemini" : "OpenAI"} for this product diagnosis job.`,
    data: {
      provider,
      productGid: product.id,
      handle: product.handle,
      title: product.title,
      developmentMode: isProductPulseDevelopment(),
    },
  });

  return provider === GEMINI_PROVIDER
    ? generateWithGemini({ shop, jobId, prompt })
    : generateWithOpenAI({ shop, jobId, prompt });
}

function buildProductDiagnosisPrompt(product) {
  const metrics = product.metrics || {};
  const sources = Array.isArray(product.sourceCoverage) ? product.sourceCoverage.join(", ") : "Shopify products";
  const returnReasons = Array.isArray(metrics.topReturnReasons) && metrics.topReturnReasons.length
    ? metrics.topReturnReasons.join(", ")
    : "none captured";

  return [
    "Write one concise Spanish test paragraph for ProductPulse AI.",
    "This is only a connection test, not a final product diagnosis.",
    `Product title: ${product.title}.`,
    `Handle: ${product.handle || "unknown"}.`,
    `Risk score: ${product.riskScore ?? 0}/100.`,
    `Primary issue: ${product.primaryIssue || "not available"}.`,
    `Stored sources: ${sources}.`,
    `Top return reasons: ${returnReasons}.`,
    "Return only the paragraph. Do not include bullets, markdown, JSON, recommendations or headings.",
  ].join("\n");
}

async function generateWithOpenAI({ shop, jobId, prompt }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_PREMIUM_MODEL || process.env.OPENAI_PRO_MODEL || process.env.OPENAI_BASIC_MODEL;

  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  if (!model) throw new Error("No OpenAI model is configured.");

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.openai_request",
    message: "Sending product diagnosis test prompt to OpenAI.",
    data: { provider: OPENAI_PROVIDER, model },
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
      max_output_tokens: 220,
    }),
  });

  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = json.error?.message || `OpenAI request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  const text = extractOpenAIText(json);
  if (!text) throw new Error("OpenAI returned an empty product diagnosis test response.");

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.openai_response",
    message: "OpenAI returned the product diagnosis test paragraph.",
    data: { provider: OPENAI_PROVIDER, model, text },
  });

  return { provider: OPENAI_PROVIDER, model, text };
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

async function generateWithGemini({ shop, jobId, prompt }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured.");

  const models = getGeminiModelPool();
  if (!models.length) throw new Error("No Gemini model is configured.");

  const orderedModels = await getGeminiAttemptOrder(models);
  let lastError = null;

  for (const [index, model] of orderedModels.entries()) {
    const primaryAttempt = model === models[0];
    if (primaryAttempt) {
      await rememberGeminiPrimaryRetry(model);
    }

    try {
      await recordJobLog({
        shop,
        jobId,
        event: "product_diagnosis.gemini_request",
        message: `Sending product diagnosis test prompt to Gemini model ${model}.`,
        data: { provider: GEMINI_PROVIDER, model, attempt: index + 1 },
      });

      const text = await requestGeminiText({ apiKey, model, prompt });
      await rememberGeminiSuccess(model);
      await recordJobLog({
        shop,
        jobId,
        event: "product_diagnosis.gemini_response",
        message: "Gemini returned the product diagnosis test paragraph.",
        data: { provider: GEMINI_PROVIDER, model, text },
      });

      return { provider: GEMINI_PROVIDER, model, text };
    } catch (error) {
      lastError = error;
      await rememberGeminiFailure(model, error);
      await recordJobLog({
        shop,
        jobId,
        level: "warn",
        event: "product_diagnosis.gemini_model_failed",
        message: `Gemini model ${model} failed${shouldTryNextGeminiModel(error) ? "; trying fallback." : "."}`,
        data: { provider: GEMINI_PROVIDER, model, error: serializeError(error) },
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

async function requestGeminiText({ apiKey, model, prompt }) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 220,
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

  if (!text) throw new Error("Gemini returned an empty product diagnosis test response.");
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

function uniqueTruthy(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}
