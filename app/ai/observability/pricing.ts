import type { AiTokenUsage } from "./tokenUsage";

export interface AiModelPricing {
  model: string;
  inputUsdPerMillion: number;
  cachedInputUsdPerMillion: number | null;
  outputUsdPerMillion: number;
  source: "default" | "env";
}

export interface AiEstimatedCost {
  model: string;
  estimated: true;
  currency: "USD";
  inputUsd: number | null;
  cachedInputUsd: number | null;
  outputUsd: number | null;
  totalUsd: number | null;
  pricing: AiModelPricing | null;
  missingUsage: boolean;
  missingPricing: boolean;
}

type PricingTable = Record<string, Omit<AiModelPricing, "model" | "source">>;

// Standard short-context text prices per 1M tokens from OpenAI's pricing page.
// Keep all pricing in this file so it is easy to update when model prices change.
const DEFAULT_PRICING: PricingTable = {
  "gpt-5.5": { inputUsdPerMillion: 5, cachedInputUsdPerMillion: 0.5, outputUsdPerMillion: 30 },
  "gpt-5.4": { inputUsdPerMillion: 2.5, cachedInputUsdPerMillion: 0.25, outputUsdPerMillion: 15 },
  "gpt-5.4-mini": { inputUsdPerMillion: 0.75, cachedInputUsdPerMillion: 0.075, outputUsdPerMillion: 4.5 },
  "gpt-5.4-nano": { inputUsdPerMillion: 0.2, cachedInputUsdPerMillion: 0.02, outputUsdPerMillion: 1.25 },
  "gpt-5": { inputUsdPerMillion: 1.25, cachedInputUsdPerMillion: 0.125, outputUsdPerMillion: 10 },
  "gpt-5-mini": { inputUsdPerMillion: 0.25, cachedInputUsdPerMillion: 0.025, outputUsdPerMillion: 2 },
  "gpt-5-nano": { inputUsdPerMillion: 0.05, cachedInputUsdPerMillion: 0.005, outputUsdPerMillion: 0.4 },
  "gpt-4.1": { inputUsdPerMillion: 2, cachedInputUsdPerMillion: 0.5, outputUsdPerMillion: 8 },
  "gpt-4.1-mini": { inputUsdPerMillion: 0.4, cachedInputUsdPerMillion: 0.1, outputUsdPerMillion: 1.6 },
  "gpt-4.1-nano": { inputUsdPerMillion: 0.1, cachedInputUsdPerMillion: 0.025, outputUsdPerMillion: 0.4 },
  "gpt-4o": { inputUsdPerMillion: 2.5, cachedInputUsdPerMillion: 1.25, outputUsdPerMillion: 10 },
  "gpt-4o-mini": { inputUsdPerMillion: 0.15, cachedInputUsdPerMillion: 0.075, outputUsdPerMillion: 0.6 },
};

export function getAiModelPricing(model: string, env: NodeJS.ProcessEnv = process.env): AiModelPricing | null {
  const normalized = normalizeModelName(model);
  const envPricing = getEnvPricing(env)[normalized];
  if (envPricing) return { model: normalized, ...envPricing, source: "env" };
  const defaultPricing = DEFAULT_PRICING[normalized] || findFamilyPricing(normalized, DEFAULT_PRICING);
  return defaultPricing ? { model: normalized, ...defaultPricing, source: "default" } : null;
}

export function estimateAiTurnCost(input: {
  model: string;
  usage: AiTokenUsage | null;
  env?: NodeJS.ProcessEnv;
}): AiEstimatedCost {
  const pricing = getAiModelPricing(input.model, input.env);
  const usage = input.usage;
  if (!usage || !pricing) {
    return {
      model: input.model,
      estimated: true,
      currency: "USD",
      inputUsd: null,
      cachedInputUsd: null,
      outputUsd: null,
      totalUsd: null,
      pricing,
      missingUsage: !usage,
      missingPricing: !pricing,
    };
  }

  const cachedInputTokens = usage.cachedInputTokens || 0;
  const billableInputTokens = typeof usage.inputTokens === "number"
    ? Math.max(0, usage.inputTokens - cachedInputTokens)
    : null;
  const inputUsd = billableInputTokens == null
    ? null
    : (billableInputTokens / 1_000_000) * pricing.inputUsdPerMillion;
  const cachedInputUsd = cachedInputTokens && pricing.cachedInputUsdPerMillion != null
    ? (cachedInputTokens / 1_000_000) * pricing.cachedInputUsdPerMillion
    : cachedInputTokens ? null : 0;
  const outputUsd = typeof usage.outputTokens === "number"
    ? (usage.outputTokens / 1_000_000) * pricing.outputUsdPerMillion
    : null;
  const totalUsd = sumCost(inputUsd, cachedInputUsd, outputUsd);

  return {
    model: input.model,
    estimated: true,
    currency: "USD",
    inputUsd: roundUsd(inputUsd),
    cachedInputUsd: roundUsd(cachedInputUsd),
    outputUsd: roundUsd(outputUsd),
    totalUsd: roundUsd(totalUsd),
    pricing,
    missingUsage: false,
    missingPricing: false,
  };
}

function getEnvPricing(env: NodeJS.ProcessEnv): PricingTable {
  const rawJson = String(env.AI_MODEL_PRICING_JSON || "").trim();
  if (rawJson) {
    try {
      return normalizePricingTable(JSON.parse(rawJson));
    } catch {
      return {};
    }
  }

  const model = normalizeModelName(String(env.AI_CHAT_MODEL || env.OPENAI_CHAT_MODEL || "").trim());
  const inputUsdPerMillion = numberOrNull(env.AI_CHAT_INPUT_PRICE_PER_MILLION);
  const outputUsdPerMillion = numberOrNull(env.AI_CHAT_OUTPUT_PRICE_PER_MILLION);
  if (!model || inputUsdPerMillion == null || outputUsdPerMillion == null) return {};
  return {
    [model]: {
      inputUsdPerMillion,
      cachedInputUsdPerMillion: numberOrNull(env.AI_CHAT_CACHED_INPUT_PRICE_PER_MILLION),
      outputUsdPerMillion,
    },
  };
}

function normalizePricingTable(value: unknown): PricingTable {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return Object.fromEntries(Object.entries(record).flatMap(([model, rawPricing]) => {
    const pricing = rawPricing && typeof rawPricing === "object" ? rawPricing as Record<string, unknown> : {};
    const inputUsdPerMillion = numberOrNull(pricing.inputUsdPerMillion ?? pricing.input);
    const outputUsdPerMillion = numberOrNull(pricing.outputUsdPerMillion ?? pricing.output);
    if (inputUsdPerMillion == null || outputUsdPerMillion == null) return [];
    return [[normalizeModelName(model), {
      inputUsdPerMillion,
      cachedInputUsdPerMillion: numberOrNull(pricing.cachedInputUsdPerMillion ?? pricing.cachedInput),
      outputUsdPerMillion,
    }]];
  }));
}

function findFamilyPricing(model: string, table: PricingTable): PricingTable[string] | null {
  const family = Object.keys(table)
    .sort((a, b) => b.length - a.length)
    .find((knownModel) => model === knownModel || model.startsWith(`${knownModel}-`));
  return family ? table[family] : null;
}

function normalizeModelName(model: string): string {
  return String(model || "").trim().toLowerCase();
}

function numberOrNull(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

function sumCost(...values: Array<number | null>): number | null {
  if (values.some((value) => typeof value !== "number")) return null;
  return (values as number[]).reduce((sum, value) => sum + value, 0);
}

function roundUsd(value: number | null): number | null {
  if (value == null) return null;
  return Math.round(value * 100_000_000) / 100_000_000;
}
