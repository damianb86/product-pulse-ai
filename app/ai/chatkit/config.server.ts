export interface AiChatKitConfig {
  enabled: boolean;
  apiKeyConfigured: boolean;
  apiUrl: string;
  domainKey: string;
  debug: boolean;
  recentThreadCount: number;
  disabledReason: string | null;
}

export interface AiChatKitClientConfig {
  enabled: boolean;
  debug: boolean;
  apiUrl: string;
  domainKey: string;
  disabledReason: string | null;
}

export function getAiChatKitConfig(env: NodeJS.ProcessEnv = process.env): AiChatKitConfig {
  const apiKeyConfigured = Boolean(normalizeString(env.OPENAI_API_KEY));
  const domainKey = normalizeString(env.AI_CHATKIT_DOMAIN_KEY || env.OPENAI_CHATKIT_DOMAIN_KEY);
  const explicitlyDisabled = isDisabled(env.AI_CHATKIT_ENABLED);
  const debug = isEnabled(env.AI_CHATKIT_DEBUG);
  const enabled = !explicitlyDisabled && apiKeyConfigured && Boolean(domainKey);
  const disabledReason = getDisabledReason({ explicitlyDisabled, apiKeyConfigured, domainKey });

  return {
    enabled,
    apiKeyConfigured,
    apiUrl: normalizeString(env.AI_CHATKIT_API_URL) || "/api/ai/chatkit/message",
    domainKey: domainKey || "",
    debug,
    recentThreadCount: normalizeInteger(env.AI_CHATKIT_HISTORY_RECENT_THREADS, 10, 0, 50),
    disabledReason,
  };
}

export function getAiChatKitClientConfig(env: NodeJS.ProcessEnv = process.env): AiChatKitClientConfig {
  const config = getAiChatKitConfig(env);
  return {
    enabled: config.enabled,
    debug: config.debug,
    apiUrl: config.apiUrl,
    domainKey: config.domainKey,
    disabledReason: config.disabledReason,
  };
}

function getDisabledReason(input: {
  explicitlyDisabled: boolean;
  apiKeyConfigured: boolean;
  domainKey: string | null;
}): string | null {
  if (input.explicitlyDisabled) return "ChatKit is disabled by AI_CHATKIT_ENABLED.";
  if (!input.apiKeyConfigured) return "ChatKit requires OPENAI_API_KEY on the server.";
  if (!input.domainKey) return "ChatKit requires AI_CHATKIT_DOMAIN_KEY from the OpenAI domain allowlist.";
  return null;
}

function normalizeString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function normalizeInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function isDisabled(value: unknown): boolean {
  return ["0", "false", "off", "disabled"].includes(String(value ?? "").trim().toLowerCase());
}

function isEnabled(value: unknown): boolean {
  return ["1", "true", "on", "enabled"].includes(String(value ?? "").trim().toLowerCase());
}
