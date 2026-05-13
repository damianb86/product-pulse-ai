import prisma from "../db.server";
import { isProductPulseDevelopment } from "./product-pulse-dev.server";
import { recordJobLog, serializeError } from "./product-pulse-job-logs.server";

const GEMINI_PROVIDER = "gemini";
const OPENAI_PROVIDER = "openai";
const GEMINI_PRIMARY_RETRY_MS = 24 * 60 * 60 * 1000;
const GEMINI_MODEL_RETRY_DELAY_MS = 750;

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
    granular_findings: [],
    repeated_language: [],
    sentiment_summary: {},
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
    "If a Shopify return reason is Other, Unknown, or generic, read the customer note/reason text and classify the actual product issue when the text supports it.",
    "Analyze sentiment in return notes and reviews. Capture repeated words, repeated phrases, recurring emotions, and fine-grained findings that should become merchant-facing issues.",
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
      granular_findings: [{
        finding: "Other return notes repeatedly mention sizing problems",
        issue_category: "fit_sizing",
        issue_detail: "other_returns_run_small",
        sentiment: "negative|neutral|positive",
        severity: "low|medium|high",
        signals: 0,
        source_types: ["shopify_return_note"],
        evidence: ["short grounded evidence phrase"],
        suggested_action: "Review Other return notes",
      }],
      repeated_language: [{
        term: "too small",
        count: 0,
        source_types: ["judgeme_reviews", "shopify_return_note"],
        sentiment: "negative|neutral|positive",
        issue_category: "fit_sizing",
        explanation: "Customers repeat this phrase when explaining returns.",
      }],
      sentiment_summary: {
        dominant_sentiment: "negative|neutral|positive|mixed",
        negative_count: 0,
        neutral_count: 0,
        positive_count: 0,
        returns: "short return-note sentiment summary",
        reviews: "short review sentiment summary",
        summary: "one merchant-facing sentence",
      },
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
    "You are auditing the product content quality for one ecommerce product.",
    "Review the title, description, tags, product type, vendor, collections, options, variants and issue clusters together.",
    "Identify missing content, unclear copy, contradictions, title/description mismatch, tag/collection mismatch, incoherent metadata, missing specifications, and shopper guidance gaps.",
    "A missing or extremely short description is a product-content issue. A subjective mismatch must be explicitly grounded in the supplied fields.",
    "Return valid JSON only. Do not calculate financial metrics, rates, customer-signal counts, confidence, or risk score.",
    "Schema:",
    JSON.stringify({
      content_quality_score: 82,
      content_summary: "The description is coherent with the title but lacks fit guidance.",
      present: ["material info"],
      missing: ["fit note"],
      notes: "concise explanation",
      content_issues: [{
        code: "missing_description|short_description|title_description_mismatch|tag_description_mismatch|collection_mismatch|unclear_value_prop|missing_specifications|contradiction|incoherent_copy|missing_customer_guidance",
        label: "Short product description",
        severity: "low|medium|high",
        evidence: "Specific field-level evidence",
        suggested_action: "Rewrite product description",
      }],
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
      vendor: product.vendor,
      productType: product.productType,
      tags: product.tags || [],
      collections: product.collections || [],
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
    "Use the metrics, clusters, product-content analysis, PDP gaps, and recommendation candidates to explain what is happening and draft merchant-ready copy.",
    "If product content is missing, incoherent, too short, or mismatched with title/tags/collections, include that in the finding or recommendations when relevant.",
    "Return valid JSON only. No markdown.",
    "Schema:",
    JSON.stringify({
      main_finding_title: "Sizing and fit expectations are not being met",
      main_finding_detail: "2-3 sentence user-facing finding grounded in evidence",
      evidence_summary: "1-2 sentence source agreement summary",
      issue_names: [{ code: "fit_sizing.runs_small", label: "Runs small" }],
      recommendation_copy: {
        pdp_copy: "merchant-ready product page copy",
        product_description: "rewritten product description draft when product content has issues",
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

async function generateWithOpenAI({ shop, jobId, task, taskConfig, prompt, modelOverride = null, requestContext = "primary" }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = modelOverride || resolveOpenAIModel(taskConfig);

  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  if (!model) throw new Error("No OpenAI model is configured.");

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.openai_request",
    message: requestContext === "gemini_fallback"
      ? `Sending ${task} prompt to OpenAI nano after Gemini fallback exhaustion.`
      : `Sending ${task} prompt to OpenAI.`,
    data: { provider: OPENAI_PROVIDER, model, task, requestContext },
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
    const error = new Error(message);
    error.status = response.status;
    error.code = json.error?.code || json.error?.type || null;
    error.details = json.error || null;
    throw error;
  }

  const text = extractOpenAIText(json);
  if (!text) throw new Error(`OpenAI returned an empty ${task} response.`);

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.openai_response",
    message: `OpenAI returned ${task}.`,
    data: { provider: OPENAI_PROVIDER, model, task, requestContext, text },
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

function resolveOpenAINanoModel() {
  return String(process.env.OPENAI_BASIC_MODEL || "").trim() || "gpt-5.4-nano";
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
  let lastRetryReason = null;

  for (const [index, model] of orderedModels.entries()) {
    const nextModel = orderedModels[index + 1];
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
      lastRetryReason = getGeminiRetryReason(error);
      if (nextModel && lastRetryReason) {
        await rememberGeminiModelSwitch(nextModel, {
          failedModel: model,
          error,
          reason: lastRetryReason,
        });
      } else {
        await rememberGeminiFailure(model, error);
      }

      await recordJobLog({
        shop,
        jobId,
        level: "warn",
        event: "product_diagnosis.gemini_model_failed",
        message: buildGeminiFailureLogMessage({ model, nextModel, retryReason: lastRetryReason }),
        data: {
          provider: GEMINI_PROVIDER,
          model,
          nextModel: nextModel || null,
          retryReason: lastRetryReason,
          task,
          error: serializeError(error),
        },
      });

      if (!lastRetryReason) throw error;
      if (!nextModel) {
        await rememberGeminiPoolExhausted(models[0], {
          failedModel: model,
          error,
          reason: lastRetryReason,
        });
        const poolError = buildGeminiPoolExhaustedError(lastRetryReason, error);
        if (shouldFallbackToOpenAINano(lastRetryReason)) {
          return generateWithOpenAINanoAfterGeminiExhaustion({
            shop,
            jobId,
            task,
            taskConfig,
            prompt,
            retryReason: lastRetryReason,
            geminiError: poolError,
            lastGeminiError: error,
          });
        }
        throw poolError;
      }

      await sleep(GEMINI_MODEL_RETRY_DELAY_MS);
    }
  }

  const poolError = buildGeminiPoolExhaustedError(lastRetryReason, lastError);
  if (shouldFallbackToOpenAINano(lastRetryReason)) {
    return generateWithOpenAINanoAfterGeminiExhaustion({
      shop,
      jobId,
      task,
      taskConfig,
      prompt,
      retryReason: lastRetryReason,
      geminiError: poolError,
      lastGeminiError: lastError,
    });
  }
  throw poolError;
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
  return models.slice(currentIndex);
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
    error.details = json.error?.details || json.error || null;
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

function getGeminiRetryReason(error) {
  const message = `${error?.message || ""} ${error?.code || ""}`.toLowerCase();
  if (
    error?.status === 503 ||
    message.includes("high demand") ||
    message.includes("overloaded") ||
    message.includes("temporarily unavailable") ||
    message.includes("try again later") ||
    message.includes("unavailable")
  ) {
    return "high_demand";
  }

  if (
    error?.status === 429 ||
    message.includes("quota") ||
    message.includes("resource_exhausted") ||
    message.includes("rate limit") ||
    message.includes("too many requests") ||
    message.includes("exceeded")
  ) {
    return "quota";
  }

  if (
    error?.status === 404 ||
    message.includes("not found") ||
    message.includes("model")
  ) {
    return "model_unavailable";
  }

  return null;
}

function shouldFallbackToOpenAINano(retryReason) {
  return retryReason === "high_demand" || retryReason === "quota";
}

async function generateWithOpenAINanoAfterGeminiExhaustion({
  shop,
  jobId,
  task,
  taskConfig,
  prompt,
  retryReason,
  geminiError,
  lastGeminiError,
}) {
  const model = resolveOpenAINanoModel();

  await recordJobLog({
    shop,
    jobId,
    level: "warn",
    event: "product_diagnosis.gemini_pool_exhausted_openai_fallback",
    message: `All configured Gemini models failed due to ${getGeminiRetryReasonLabel(retryReason)}; retrying ${task} with OpenAI nano.`,
    data: {
      provider: OPENAI_PROVIDER,
      model,
      task,
      retryReason,
      geminiError: serializeError(lastGeminiError || geminiError),
    },
  });

  try {
    return await generateWithOpenAI({
      shop,
      jobId,
      task,
      taskConfig,
      prompt,
      modelOverride: model,
      requestContext: "gemini_fallback",
    });
  } catch (openAiError) {
    await recordJobLog({
      shop,
      jobId,
      level: "error",
      event: "product_diagnosis.openai_nano_fallback_failed",
      message: "OpenAI nano fallback failed after Gemini pool exhaustion.",
      data: {
        provider: OPENAI_PROVIDER,
        model,
        task,
        retryReason,
        geminiError: serializeError(lastGeminiError || geminiError),
        openAiError: serializeError(openAiError),
      },
    });
    throw buildOpenAINanoFallbackError({ retryReason, geminiError, openAiError });
  }
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

async function rememberGeminiModelSwitch(nextModel, { failedModel, error, reason }) {
  await prisma.productPulseAiProviderState.upsert({
    where: { provider: GEMINI_PROVIDER },
    create: {
      provider: GEMINI_PROVIDER,
      currentModel: nextModel,
      failureCount: 1,
      metadata: {
        lastFailureAt: new Date().toISOString(),
        failedModel,
        nextModel,
        reason,
        error: serializeError(error),
      },
    },
    update: {
      currentModel: nextModel,
      failureCount: { increment: 1 },
      metadata: {
        lastFailureAt: new Date().toISOString(),
        failedModel,
        nextModel,
        reason,
        error: serializeError(error),
      },
    },
  }).catch(() => {});
}

async function rememberGeminiPoolExhausted(nextModel, { failedModel, error, reason }) {
  await prisma.productPulseAiProviderState.upsert({
    where: { provider: GEMINI_PROVIDER },
    create: {
      provider: GEMINI_PROVIDER,
      currentModel: nextModel,
      failureCount: 1,
      metadata: {
        exhaustedAt: new Date().toISOString(),
        failedModel,
        nextModel,
        reason,
        error: serializeError(error),
      },
    },
    update: {
      currentModel: nextModel,
      failureCount: { increment: 1 },
      metadata: {
        exhaustedAt: new Date().toISOString(),
        failedModel,
        nextModel,
        reason,
        error: serializeError(error),
      },
    },
  }).catch(() => {});
}

function buildGeminiFailureLogMessage({ model, nextModel, retryReason }) {
  if (!retryReason) return `Gemini model ${model} failed.`;
  const reasonLabel = getGeminiRetryReasonLabel(retryReason);
  if (nextModel) return `Gemini model ${model} failed due to ${reasonLabel}; retrying with ${nextModel}.`;
  return `Gemini model ${model} failed due to ${reasonLabel}; all configured Gemini models were attempted.`;
}

function buildGeminiPoolExhaustedError(retryReason, error) {
  const detail = formatProviderErrorDetail(error);
  if (retryReason === "high_demand") {
    return new Error(`AI diagnosis could not be completed because every configured Gemini model is currently under high demand. Gemini detail: ${detail}`);
  }
  if (retryReason === "quota") {
    return new Error(`AI diagnosis could not be completed because every configured Gemini model hit quota or rate limits. Gemini detail: ${detail}`);
  }
  if (retryReason === "model_unavailable") {
    return new Error(`AI diagnosis could not be completed because no configured Gemini model is currently available. Gemini detail: ${detail}`);
  }
  return error || new Error("AI diagnosis could not be completed with Gemini. Please try again later.");
}

function buildOpenAINanoFallbackError({ retryReason, geminiError, openAiError }) {
  return new Error([
    `AI diagnosis failed after all Gemini models hit ${getGeminiRetryReasonLabel(retryReason)} and OpenAI nano fallback also failed.`,
    `Gemini: ${formatProviderErrorDetail(geminiError)}.`,
    `OpenAI nano: ${formatProviderErrorDetail(openAiError)}.`,
    "Please try again later.",
  ].join(" "));
}

function getGeminiRetryReasonLabel(retryReason) {
  if (retryReason === "high_demand") return "high demand";
  if (retryReason === "quota") return "quota or rate limit";
  if (retryReason === "model_unavailable") return "model availability";
  return "an unknown Gemini error";
}

function formatProviderErrorDetail(error) {
  const parts = [];
  if (error?.status) parts.push(`HTTP ${error.status}`);
  if (error?.code) parts.push(String(error.code));
  if (error?.message) parts.push(String(error.message));
  if (!parts.length && error) parts.push(String(error));
  if (!parts.length) return "No provider detail was returned.";
  return truncateMessage(parts.join(" - "), 520);
}

function truncateMessage(message, limit) {
  const normalized = String(message || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, limit - 1)}…`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
