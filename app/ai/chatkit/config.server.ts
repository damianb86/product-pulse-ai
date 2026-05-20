export interface AiChatKitConfig {
  enabled: boolean;
  apiKeyConfigured: boolean;
  workflowId: string | null;
  workflowVersion: string | null;
  debug: boolean;
  sessionTtlSeconds: number;
  rateLimitPerMinute: number;
  recentThreadCount: number;
  disabledReason: string | null;
}

export interface AiChatKitClientConfig {
  enabled: boolean;
  debug: boolean;
  disabledReason: string | null;
}

export function getAiChatKitConfig(env: NodeJS.ProcessEnv = process.env): AiChatKitConfig {
  const apiKeyConfigured = Boolean(normalizeString(env.OPENAI_API_KEY));
  const workflowId = normalizeString(env.AI_CHATKIT_WORKFLOW_ID || env.OPENAI_CHATKIT_WORKFLOW_ID);
  const explicitlyDisabled = isDisabled(env.AI_CHATKIT_ENABLED);
  const debug = isEnabled(env.AI_CHATKIT_DEBUG);
  const enabled = !explicitlyDisabled && apiKeyConfigured && Boolean(workflowId);
  const disabledReason = getDisabledReason({ explicitlyDisabled, apiKeyConfigured, workflowId });

  return {
    enabled,
    apiKeyConfigured,
    workflowId,
    workflowVersion: normalizeString(env.AI_CHATKIT_WORKFLOW_VERSION),
    debug,
    sessionTtlSeconds: normalizeInteger(env.AI_CHATKIT_SESSION_TTL_SECONDS, 600, 60, 3600),
    rateLimitPerMinute: normalizeInteger(env.AI_CHATKIT_RATE_LIMIT_PER_MINUTE, 10, 1, 60),
    recentThreadCount: normalizeInteger(env.AI_CHATKIT_HISTORY_RECENT_THREADS, 10, 0, 50),
    disabledReason,
  };
}

export function getAiChatKitClientConfig(env: NodeJS.ProcessEnv = process.env): AiChatKitClientConfig {
  const config = getAiChatKitConfig(env);
  return {
    enabled: config.enabled,
    debug: config.debug,
    disabledReason: config.disabledReason,
  };
}

function getDisabledReason(input: {
  explicitlyDisabled: boolean;
  apiKeyConfigured: boolean;
  workflowId: string | null;
}): string | null {
  if (input.explicitlyDisabled) return "ChatKit is disabled by AI_CHATKIT_ENABLED.";
  if (!input.apiKeyConfigured) return "ChatKit requires OPENAI_API_KEY on the server.";
  if (!input.workflowId) return "ChatKit requires AI_CHATKIT_WORKFLOW_ID on the server.";
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
