import { recordJobLog } from "./product-pulse-job-logs.server";

const TOKEN_FIELDS = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cachedInputTokens",
  "reasoningTokens",
];

export function createAiUsageTracker({ shop, jobId, operation = "ai_operation", metadata = {} } = {}) {
  const calls = [];

  return {
    record(call) {
      const normalized = normalizeAiUsageCall(call);
      calls.push(normalized);
      return normalized;
    },
    getCalls() {
      return calls.slice();
    },
    getSummary() {
      return summarizeAiUsage(calls, metadata);
    },
    async logSummary({ level = "info", event, message, data = {} } = {}) {
      const summary = summarizeAiUsage(calls, metadata);
      await recordJobLog({
        shop,
        jobId,
        level,
        event: event || `${operation}.ai_token_usage`,
        message: message || buildAiUsageSummaryMessage(summary),
        data: {
          ...data,
          aiUsage: summary,
        },
      });
      return summary;
    },
  };
}

export function normalizeAiUsageCall(call = {}) {
  const {
    provider = "",
    model = "",
    task = "",
    requestContext = "primary",
    usage = null,
    usageSource = "",
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    reasoningTokens,
  } = call;
  const normalizedProvider = String(provider || "unknown").toLowerCase();
  const normalizedModel = String(model || "unknown");
  const normalizedTask = String(task || "unknown");
  const normalizedRequestContext = String(requestContext || "primary");
  if (usageSource && TOKEN_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(call, field))) {
    return {
      provider: normalizedProvider,
      model: normalizedModel,
      task: normalizedTask,
      requestContext: normalizedRequestContext,
      inputTokens: toOptionalNumber(inputTokens),
      outputTokens: toOptionalNumber(outputTokens),
      totalTokens: toOptionalNumber(totalTokens),
      cachedInputTokens: toOptionalNumber(cachedInputTokens),
      reasoningTokens: toOptionalNumber(reasoningTokens),
      usageSource: String(usageSource || "normalized_usage"),
    };
  }

  const tokenUsage = normalizeProviderTokenUsage(normalizedProvider, usage, usageSource);
  return {
    provider: normalizedProvider,
    model: normalizedModel,
    task: normalizedTask,
    requestContext: normalizedRequestContext,
    ...tokenUsage,
  };
}

export function summarizeAiUsage(calls = [], metadata = {}) {
  const normalizedCalls = (Array.isArray(calls) ? calls : []).map(normalizeAiUsageCall);
  const total = createEmptyUsageBucket("total", "All AI usage");
  const byModel = new Map();
  const byTask = new Map();
  const byProvider = new Map();

  normalizedCalls.forEach((call) => {
    addCallToBucket(total, call);
    addCallToGroupedBucket(byModel, `${call.provider}:${call.model}`, {
      provider: call.provider,
      model: call.model,
      label: `${call.provider}/${call.model}`,
    }, call);
    addCallToGroupedBucket(byTask, call.task, { task: call.task, label: call.task }, call);
    addCallToGroupedBucket(byProvider, call.provider, { provider: call.provider, label: call.provider }, call);
  });

  return {
    schemaVersion: 1,
    ...metadata,
    callCount: normalizedCalls.length,
    knownTokenCallCount: normalizedCalls.filter((call) => call.totalTokens !== null).length,
    unknownTokenCallCount: normalizedCalls.filter((call) => call.totalTokens === null).length,
    total: finalizeUsageBucket(total),
    byProvider: finalizeUsageBuckets(byProvider),
    byModel: finalizeUsageBuckets(byModel),
    byTask: finalizeUsageBuckets(byTask),
    calls: normalizedCalls,
  };
}

export function buildAiUsageSummaryMessage(summary = {}) {
  const totalTokens = summary.total?.totalTokens;
  const knownCalls = Number(summary.knownTokenCallCount || 0);
  const unknownCalls = Number(summary.unknownTokenCallCount || 0);
  const knownText = !knownCalls && unknownCalls
    ? "unknown total tokens"
    : unknownCalls
      ? `${Number(totalTokens || 0).toLocaleString("en-US")} known tokens (${unknownCalls} call${unknownCalls === 1 ? "" : "s"} without provider usage)`
      : Number.isFinite(Number(totalTokens))
        ? `${Number(totalTokens).toLocaleString("en-US")} total tokens`
        : "unknown total tokens";
  const modelCount = Array.isArray(summary.byModel) ? summary.byModel.length : 0;
  const callCount = Number(summary.callCount || 0);
  return `AI usage summary: ${knownText} across ${callCount} call${callCount === 1 ? "" : "s"} and ${modelCount} model${modelCount === 1 ? "" : "s"}.`;
}

function normalizeProviderTokenUsage(provider, usage, usageSource = "") {
  if (provider === "cache") {
    return {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      usageSource: usageSource || "cache",
    };
  }

  if (!usage || typeof usage !== "object") {
    return {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cachedInputTokens: null,
      reasoningTokens: null,
      usageSource: usageSource || "provider_missing",
    };
  }

  if (provider === "openai") return normalizeOpenAiUsage(usage, usageSource);
  if (provider === "gemini") return normalizeGeminiUsage(usage, usageSource);
  return normalizeGenericUsage(usage, usageSource);
}

function normalizeOpenAiUsage(usage = {}, usageSource = "") {
  const inputDetails = usage.input_tokens_details || usage.prompt_tokens_details || {};
  const outputDetails = usage.output_tokens_details || usage.completion_tokens_details || {};
  const inputTokens = toOptionalNumber(usage.input_tokens ?? usage.prompt_tokens);
  const outputTokens = toOptionalNumber(usage.output_tokens ?? usage.completion_tokens);
  const totalTokens = toOptionalNumber(usage.total_tokens) ?? sumKnownTokens(inputTokens, outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens: toOptionalNumber(inputDetails.cached_tokens ?? usage.cached_tokens),
    reasoningTokens: toOptionalNumber(outputDetails.reasoning_tokens ?? usage.reasoning_tokens),
    usageSource: usageSource || "openai_response_usage",
  };
}

function normalizeGeminiUsage(usage = {}, usageSource = "") {
  const inputTokens = toOptionalNumber(usage.promptTokenCount);
  const outputTokens = toOptionalNumber(usage.candidatesTokenCount);
  const reasoningTokens = toOptionalNumber(usage.thoughtsTokenCount);
  const totalTokens = toOptionalNumber(usage.totalTokenCount) ?? sumKnownTokens(inputTokens, outputTokens, reasoningTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens: toOptionalNumber(usage.cachedContentTokenCount),
    reasoningTokens,
    usageSource: usageSource || "gemini_usage_metadata",
  };
}

function normalizeGenericUsage(usage = {}, usageSource = "") {
  const inputTokens = toOptionalNumber(usage.inputTokens ?? usage.input_tokens ?? usage.prompt_tokens ?? usage.promptTokenCount);
  const outputTokens = toOptionalNumber(usage.outputTokens ?? usage.output_tokens ?? usage.completion_tokens ?? usage.candidatesTokenCount);
  const totalTokens = toOptionalNumber(usage.totalTokens ?? usage.total_tokens ?? usage.totalTokenCount) ?? sumKnownTokens(inputTokens, outputTokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens: toOptionalNumber(usage.cachedInputTokens ?? usage.cached_tokens ?? usage.cachedContentTokenCount),
    reasoningTokens: toOptionalNumber(usage.reasoningTokens ?? usage.reasoning_tokens ?? usage.thoughtsTokenCount),
    usageSource: usageSource || "generic_usage",
  };
}

function createEmptyUsageBucket(key, label) {
  return {
    key,
    label,
    calls: 0,
    unknownTokenCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    cachedInputTokens: 0,
    reasoningTokens: 0,
  };
}

function addCallToGroupedBucket(map, key, descriptor, call) {
  const bucket = map.get(key) || {
    ...createEmptyUsageBucket(key, descriptor.label),
    ...descriptor,
  };
  addCallToBucket(bucket, call);
  map.set(key, bucket);
}

function addCallToBucket(bucket, call) {
  bucket.calls += 1;
  if (call.totalTokens === null) bucket.unknownTokenCalls += 1;
  TOKEN_FIELDS.forEach((field) => {
    if (Number.isFinite(Number(call[field]))) {
      bucket[field] += Number(call[field]);
    }
  });
}

function finalizeUsageBuckets(map) {
  return Array.from(map.values())
    .map(finalizeUsageBucket)
    .sort((first, second) => Number(second.totalTokens || 0) - Number(first.totalTokens || 0) || first.label.localeCompare(second.label));
}

function finalizeUsageBucket(bucket) {
  const finalized = { ...bucket };
  TOKEN_FIELDS.forEach((field) => {
    finalized[field] = Math.round(Number(finalized[field] || 0));
  });
  return finalized;
}

function toOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sumKnownTokens(...values) {
  const numbers = values.filter((value) => Number.isFinite(Number(value))).map(Number);
  if (!numbers.length) return null;
  return numbers.reduce((total, value) => total + value, 0);
}
