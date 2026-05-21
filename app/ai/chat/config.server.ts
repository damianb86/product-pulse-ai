import { getAiFeatureFlags } from "../security/featureFlags.server";

export interface AiChatConfig {
  assistantEnabled: boolean;
  internalActionsEnabled: boolean;
  appMutationsEnabled: boolean;
  actionConfirmationsEnabled: boolean;
  defaultModel: string;
  strongModel: string;
  cheapModel: string;
  maxToolCallsPerTurn: number;
  maxRecentMessages: number;
  maxToolResultCharacters: number;
  maxOutputTokens: number;
  maxStructuredResponseRetries: number;
  maxActionProposalsPerTurn: number;
  openAiTimeoutMs: number;
  costTrackingEnabled: boolean;
  debugCosts: boolean;
  responseTemperature: number;
}

export function getAiChatConfig(env: NodeJS.ProcessEnv = process.env): AiChatConfig {
  const defaultModel = stringEnv(env.AI_CHAT_MODEL) || stringEnv(env.OPENAI_CHAT_MODEL) || "gpt-5.4-mini";
  const flags = getAiFeatureFlags(env);
  return {
    assistantEnabled: flags.assistantEnabled,
    internalActionsEnabled: flags.internalActionsEnabled,
    appMutationsEnabled: flags.appMutationsEnabled,
    actionConfirmationsEnabled: flags.actionConfirmationsEnabled,
    defaultModel,
    strongModel: stringEnv(env.AI_CHAT_STRONG_MODEL) || stringEnv(env.OPENAI_PREMIUM_MODEL) || "gpt-5.4",
    cheapModel: stringEnv(env.AI_CHAT_CHEAP_MODEL) || stringEnv(env.OPENAI_BASIC_MODEL) || defaultModel,
    maxToolCallsPerTurn: integerEnv(env.AI_CHAT_MAX_TOOL_CALLS_PER_TURN, 1, 10, 5),
    maxRecentMessages: integerEnv(env.AI_CHAT_MAX_RECENT_MESSAGES, 1, 24, 8),
    maxToolResultCharacters: integerEnv(env.AI_CHAT_MAX_TOOL_RESULT_CHARACTERS, 1000, 16000, 6000),
    maxOutputTokens: integerEnv(env.AI_CHAT_MAX_OUTPUT_TOKENS, 256, 8000, 1600),
    maxStructuredResponseRetries: integerEnv(env.AI_CHAT_MAX_STRUCTURED_RESPONSE_RETRIES, 0, 2, 1),
    maxActionProposalsPerTurn: integerEnv(env.AI_CHAT_MAX_ACTION_PROPOSALS_PER_TURN, 0, 3, 1),
    openAiTimeoutMs: integerEnv(env.AI_CHAT_OPENAI_TIMEOUT_MS, 1000, 120000, 30000),
    costTrackingEnabled: booleanEnv(env.AI_COST_TRACKING_ENABLED, true),
    debugCosts: booleanEnv(env.AI_DEBUG_COSTS, false),
    responseTemperature: decimalEnv(env.AI_CHAT_TEMPERATURE, 0, 1, 0.2),
  };
}

export function hasOpenAiApiKey(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(stringEnv(env.OPENAI_API_KEY));
}

function stringEnv(value: string | undefined): string {
  return String(value || "").trim();
}

function integerEnv(value: string | undefined, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

function decimalEnv(value: string | undefined, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function booleanEnv(value: string | undefined, fallback: boolean): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return fallback;
}
