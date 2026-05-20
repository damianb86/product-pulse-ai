export interface AiChatConfig {
  defaultModel: string;
  strongModel: string;
  cheapModel: string;
  maxToolCallsPerTurn: number;
  maxRecentMessages: number;
  maxToolResultCharacters: number;
  responseTemperature: number;
}

export function getAiChatConfig(env: NodeJS.ProcessEnv = process.env): AiChatConfig {
  const defaultModel = stringEnv(env.AI_CHAT_MODEL) || stringEnv(env.OPENAI_CHAT_MODEL) || "gpt-5.4-mini";
  return {
    defaultModel,
    strongModel: stringEnv(env.AI_CHAT_STRONG_MODEL) || stringEnv(env.OPENAI_PREMIUM_MODEL) || "gpt-5.4",
    cheapModel: stringEnv(env.AI_CHAT_CHEAP_MODEL) || stringEnv(env.OPENAI_BASIC_MODEL) || defaultModel,
    maxToolCallsPerTurn: integerEnv(env.AI_CHAT_MAX_TOOL_CALLS_PER_TURN, 1, 10, 5),
    maxRecentMessages: integerEnv(env.AI_CHAT_MAX_RECENT_MESSAGES, 1, 24, 8),
    maxToolResultCharacters: integerEnv(env.AI_CHAT_MAX_TOOL_RESULT_CHARACTERS, 1000, 16000, 6000),
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
