import type { AiToolContext, AiToolSafeError } from "../domain/types";

export interface AiToolCallLogInput {
  context: AiToolContext;
  toolName: string;
  input?: unknown;
  status?: "started" | "success" | "error";
  durationMs?: number;
  resultCount?: number;
  error?: AiToolSafeError;
  timestamp?: string;
}

export interface AiToolCallLogger {
  logToolCallStart(input: AiToolCallLogInput): Promise<void> | void;
  logToolCallSuccess(input: AiToolCallLogInput): Promise<void> | void;
  logToolCallError(input: AiToolCallLogInput): Promise<void> | void;
}

export class NoopAiToolCallLogger implements AiToolCallLogger {
  logToolCallStart(): void {}
  logToolCallSuccess(): void {}
  logToolCallError(): void {}
}

export class ConsoleAiToolCallLogger implements AiToolCallLogger {
  logToolCallStart(input: AiToolCallLogInput): void {
    this.log("started", input);
  }

  logToolCallSuccess(input: AiToolCallLogInput): void {
    this.log("success", input);
  }

  logToolCallError(input: AiToolCallLogInput): void {
    this.log("error", input);
  }

  private log(status: "started" | "success" | "error", input: AiToolCallLogInput): void {
    const payload = {
      timestamp: input.timestamp || new Date().toISOString(),
      status,
      shop: input.context.shop,
      userId: input.context.userId ?? null,
      requestId: input.context.requestId || null,
      conversationId: input.context.conversationId || null,
      toolName: input.toolName,
      input: redactSensitiveObject(input.input),
      durationMs: input.durationMs,
      resultCount: input.resultCount,
      error: input.error ? {
        code: input.error.code,
        message: input.error.message,
        retryable: Boolean(input.error.retryable),
      } : undefined,
    };
    console.info("[ai-tool-call]", payload);
  }
}

export const noopAiToolCallLogger = new NoopAiToolCallLogger();

function redactSensitiveObject(value: unknown, depth = 0): unknown {
  if (depth > 5) return "[Truncated]";
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => redactSensitiveObject(item, depth + 1));

  const safe: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    safe[key] = isSensitiveKey(key)
      ? "[Redacted]"
      : redactSensitiveObject(nestedValue, depth + 1);
  }
  return safe;
}

function isSensitiveKey(key: string): boolean {
  return /(authorization|cookie|password|secret|token|accessToken|refreshToken|apiKey|apiSecret|hmac|signature|session|credentials|email)/i.test(key);
}
