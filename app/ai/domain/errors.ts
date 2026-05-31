import type { AiToolSafeError } from "./types";

export class AiToolExecutionError extends Error {
  code: string;
  retryable: boolean;

  constructor(code: string, message: string, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "AiToolExecutionError";
    this.code = code;
    this.retryable = Boolean(options.retryable);
  }
}

export function toSafeAiToolError(error: unknown): AiToolSafeError {
  if (error instanceof AiToolExecutionError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  return {
    code: "TOOL_EXECUTION_ERROR",
    message: "The AI data tool could not complete the request.",
    retryable: false,
  };
}
