import type {
  AnyAiToolDefinition,
  AiToolContext,
  AiToolExecutionResult,
  AiToolResultMetadata,
  AiToolSafeError,
} from "../domain/types";
import { toSafeAiToolError } from "../domain/errors";
import type { AiToolCallLogger } from "../logging/aiToolCallLogger.server";
import { noopAiToolCallLogger } from "../logging/aiToolCallLogger.server";
import {
  createProductPulseAiToolDefinitions,
  type ProductPulseAiToolDependencies,
} from "./productPulseTools.server";

export interface AiToolRegistryOptions {
  logger?: AiToolCallLogger;
  productPulse?: ProductPulseAiToolDependencies;
  definitions?: AnyAiToolDefinition[];
}

export class AiToolRegistry {
  private tools: Map<string, AnyAiToolDefinition>;
  private logger: AiToolCallLogger;

  constructor(definitions: AnyAiToolDefinition[], logger: AiToolCallLogger = noopAiToolCallLogger) {
    this.tools = new Map();
    definitions.forEach((definition) => {
      if (this.tools.has(definition.name)) {
        throw new Error(`Duplicate AI tool registered: ${definition.name}`);
      }
      this.tools.set(definition.name, definition);
    });
    this.logger = logger;
  }

  listAiTools(): AnyAiToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getAiToolDefinition(toolName: string): AnyAiToolDefinition | null {
    return this.tools.get(toolName) || null;
  }

  async executeAiTool(
    toolName: string,
    context: AiToolContext,
    rawInput: unknown = {},
  ): Promise<AiToolExecutionResult> {
    const definition = this.getAiToolDefinition(toolName);
    if (!definition) {
      return {
        ok: false,
        toolName,
        error: {
          code: "UNKNOWN_TOOL",
          message: "Unknown AI data tool.",
          retryable: false,
        },
        metadata: {},
      };
    }

    const parsed = definition.inputSchema.safeParse(rawInput ?? {});
    if (!parsed.success) {
      const error: AiToolSafeError = {
        code: "VALIDATION_ERROR",
        message: "Tool input failed validation.",
        retryable: false,
        validationIssues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      };
      await safeLog(() => this.logger.logToolCallError({
        context,
        toolName,
        status: "error",
        error,
        timestamp: new Date().toISOString(),
      }));
      return {
        ok: false,
        toolName,
        error,
        metadata: {},
      };
    }

    const validatedInput = parsed.data;
    const startedAt = Date.now();
    await safeLog(() => this.logger.logToolCallStart({
      context,
      toolName,
      input: validatedInput,
      status: "started",
      timestamp: new Date(startedAt).toISOString(),
    }));

    try {
      const result = await definition.execute(context, validatedInput);
      const metadata = normalizeResultMetadata(result.metadata);
      const durationMs = Date.now() - startedAt;
      await safeLog(() => this.logger.logToolCallSuccess({
        context,
        toolName,
        input: validatedInput,
        status: "success",
        durationMs,
        resultCount: metadata.resultCount,
        timestamp: new Date().toISOString(),
      }));
      return {
        ok: true,
        toolName,
        data: result.data,
        metadata,
      };
    } catch (caught) {
      const durationMs = Date.now() - startedAt;
      const error = toSafeAiToolError(caught);
      await safeLog(() => this.logger.logToolCallError({
        context,
        toolName,
        input: validatedInput,
        status: "error",
        durationMs,
        error,
        timestamp: new Date().toISOString(),
      }));
      return {
        ok: false,
        toolName,
        error,
        metadata: {
          resultCount: 0,
        },
      };
    }
  }
}

export function createAiToolRegistry(options: AiToolRegistryOptions = {}): AiToolRegistry {
  const definitions = options.definitions || createProductPulseAiToolDefinitions(options.productPulse);
  return new AiToolRegistry(definitions, options.logger || noopAiToolCallLogger);
}

const defaultAiToolRegistry = createAiToolRegistry();

export function listAiTools(): AnyAiToolDefinition[] {
  return defaultAiToolRegistry.listAiTools();
}

export function getAiToolDefinition(toolName: string): AnyAiToolDefinition | null {
  return defaultAiToolRegistry.getAiToolDefinition(toolName);
}

export function executeAiTool(
  toolName: string,
  context: AiToolContext,
  rawInput: unknown = {},
): Promise<AiToolExecutionResult> {
  return defaultAiToolRegistry.executeAiTool(toolName, context, rawInput);
}

function normalizeResultMetadata(metadata: AiToolResultMetadata | undefined): AiToolResultMetadata {
  return metadata || {};
}

async function safeLog(log: () => Promise<void> | void): Promise<void> {
  try {
    await log();
  } catch {
    // Logging should never break tool execution.
  }
}
