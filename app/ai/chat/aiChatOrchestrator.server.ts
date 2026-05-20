import { z } from "zod";
import { createAiToolContextFromAuthenticatedRequest } from "../context.server";
import type { AiToolContext, AiToolExecutionResult } from "../domain/types";
import type { AiToolRegistry } from "../tools/registry.server";
import { createAiToolRegistry } from "../tools/registry.server";
import { toOpenAiToolAdapterResult } from "../tools/adapters/openAiToolAdapter";
import { sanitizeJsonSchemaForOpenAi } from "../tools/adapters/jsonSchema";
import { getAiChatConfig, hasOpenAiApiKey, type AiChatConfig } from "./config.server";
import {
  buildStructuredMessageContent,
  PrismaAiConversationStore,
  type AiConversationStore,
  type StoredAiConversationMessage,
} from "./conversationStore.server";
import { buildAiChatInstructions } from "./instructions";
import { getPageContextReference, normalizeAiPageContext, type AiPageContext } from "./pageContext";
import {
  aiAssistantResponseSchema,
  createFallbackAssistantResponse,
  parseAiAssistantResponse,
  type AiAssistantResponse,
} from "./responseSchema";
import {
  createOpenAiResponsesClient,
  type OpenAiResponseLike,
  type OpenAiResponseOutputItem,
  type OpenAiResponsesClient,
} from "./openAiClient.server";

const MAX_USER_MESSAGE_LENGTH = 3000;

export interface RunAiChatTurnInput {
  request: Request;
  message: string;
  conversationId?: string | null;
  pageContext?: unknown;
  userIntentMetadata?: unknown;
}

export interface RunAiChatTurnWithContextInput {
  message: string;
  conversationId?: string | null;
  pageContext?: unknown;
  userIntentMetadata?: unknown;
}

export interface AiChatTurnResult extends AiAssistantResponse {
  conversationId: string;
  messageId: string;
  userMessageId: string;
  metadata: {
    model: string;
    toolCallCount: number;
    blockedToolCallCount: number;
    openAiResponseId: string | null;
    usage: Record<string, unknown> | null;
    pageContext: AiPageContext;
  };
}

export interface AiChatOrchestratorDependencies {
  openAiClient?: OpenAiResponsesClient;
  toolRegistry?: AiToolRegistry;
  conversationStore?: AiConversationStore;
  config?: AiChatConfig;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

interface ToolCallExecutionSummary {
  callId: string;
  openAiToolName: string;
  internalToolName: string;
  arguments: unknown;
  output: string;
  status: "success" | "error" | "blocked";
  resultCount?: number;
  durationMs?: number;
}

export class AiChatOrchestrator {
  private openAiClient?: OpenAiResponsesClient;
  private toolRegistry: AiToolRegistry;
  private conversationStore: AiConversationStore;
  private config: AiChatConfig;
  private env: NodeJS.ProcessEnv;
  private now: () => Date;

  constructor(dependencies: AiChatOrchestratorDependencies = {}) {
    this.openAiClient = dependencies.openAiClient;
    this.toolRegistry = dependencies.toolRegistry || createAiToolRegistry();
    this.conversationStore = dependencies.conversationStore || new PrismaAiConversationStore();
    this.config = dependencies.config || getAiChatConfig(dependencies.env);
    this.env = dependencies.env || process.env;
    this.now = dependencies.now || (() => new Date());
  }

  async runAiChatTurn(input: RunAiChatTurnInput): Promise<AiChatTurnResult> {
    const context = await createAiToolContextFromAuthenticatedRequest(input.request, {
      conversationId: input.conversationId || undefined,
    });
    return this.runAiChatTurnWithContext(context, input);
  }

  async runAiChatTurnWithContext(
    context: AiToolContext,
    input: RunAiChatTurnWithContextInput,
  ): Promise<AiChatTurnResult> {
    const message = normalizeUserMessage(input.message);
    const pageContext = normalizeAiPageContext(input.pageContext);
    const conversation = await this.conversationStore.getOrCreateConversation(context, {
      conversationId: input.conversationId,
      titleSeed: message,
      metadata: {
        pageContext,
        userIntentMetadata: input.userIntentMetadata,
      },
    });
    const chatContext: AiToolContext = {
      ...context,
      conversationId: conversation.id,
      createdAt: context.createdAt || this.now().toISOString(),
    };
    const userMessage = await this.conversationStore.addMessage({
      context: chatContext,
      conversationId: conversation.id,
      role: "user",
      content: message,
      structuredContent: {
        pageContext,
        userIntentMetadata: input.userIntentMetadata,
      },
    });

    if (!hasOpenAiApiKey(this.env) && !this.openAiClient) {
      const fallback = createFallbackAssistantResponse("AI chat is not configured yet. Set OPENAI_API_KEY on the server before using this endpoint.", [
        "AI chat configuration is missing.",
      ]);
      const assistantMessage = await this.persistAssistantMessage(chatContext, conversation.id, fallback, null);
      return buildTurnResult({
        response: fallback,
        conversationId: conversation.id,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        model: this.config.defaultModel,
        pageContext,
        toolCallCount: 0,
        blockedToolCallCount: 0,
        openAiResponseId: null,
        usage: null,
      });
    }

    const client = this.openAiClient || createOpenAiResponsesClient(this.env);
    const recentMessages = await this.conversationStore.listRecentMessages(
      chatContext,
      conversation.id,
      this.config.maxRecentMessages,
    );
    const adapter = toOpenAiToolAdapterResult(this.toolRegistry);
    const instructions = buildAiChatInstructions({
      pageContext,
      toolNames: adapter.tools.map((tool) => tool.name),
    });
    const inputItems = buildOpenAiInputItems({
      messages: recentMessages,
      pageContext,
      currentUserMessageId: userMessage.id,
    });

    try {
      const runResult = await this.runOpenAiToolLoop({
        client,
        chatContext,
        conversationId: conversation.id,
        userMessageId: userMessage.id,
        instructions,
        inputItems,
        tools: adapter.tools,
        openAiNameToInternalName: adapter.openAiNameToInternalName,
      });
      const assistantResponse = await this.parseOrRecoverAssistantResponse({
        client,
        instructions,
        inputItems: runResult.inputItems,
        rawResponse: runResult.response,
      });
      const assistantMessage = await this.persistAssistantMessage(
        chatContext,
        conversation.id,
        assistantResponse,
        runResult.response.id || null,
      );

      return buildTurnResult({
        response: assistantResponse,
        conversationId: conversation.id,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        model: this.config.defaultModel,
        pageContext,
        toolCallCount: runResult.executedToolCalls,
        blockedToolCallCount: runResult.blockedToolCalls,
        openAiResponseId: runResult.response.id || null,
        usage: normalizeUsage(runResult.response.usage),
      });
    } catch (error) {
      const fallback = createFallbackAssistantResponse("I could not complete that AI chat turn. Please try again in a moment.", [
        getSafeOpenAiErrorCode(error),
      ].filter(Boolean));
      const assistantMessage = await this.persistAssistantMessage(chatContext, conversation.id, fallback, null);
      return buildTurnResult({
        response: fallback,
        conversationId: conversation.id,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        model: this.config.defaultModel,
        pageContext,
        toolCallCount: 0,
        blockedToolCallCount: 0,
        openAiResponseId: null,
        usage: null,
      });
    }
  }

  private async runOpenAiToolLoop(input: {
    client: OpenAiResponsesClient;
    chatContext: AiToolContext;
    conversationId: string;
    userMessageId: string;
    instructions: string;
    inputItems: Array<Record<string, unknown>>;
    tools: unknown[];
    openAiNameToInternalName: Map<string, string>;
  }): Promise<{
    response: OpenAiResponseLike;
    inputItems: Array<Record<string, unknown>>;
    executedToolCalls: number;
    blockedToolCalls: number;
  }> {
    const inputItems = [...input.inputItems];
    let response = await this.createOpenAiResponse(input.client, input.instructions, inputItems, input.tools);
    let executedToolCalls = 0;
    let blockedToolCalls = 0;

    for (let turn = 0; turn <= this.config.maxToolCallsPerTurn; turn += 1) {
      const functionCalls = extractFunctionCalls(response);
      if (!functionCalls.length) {
        return { response, inputItems, executedToolCalls, blockedToolCalls };
      }

      inputItems.push(...normalizeOpenAiOutputItems(response.output));
      for (const toolCall of functionCalls) {
        const summary = executedToolCalls >= this.config.maxToolCallsPerTurn
          ? await this.blockToolCall(input.chatContext, input.conversationId, input.userMessageId, toolCall, "Tool call limit reached.")
          : await this.executeToolCall({
              chatContext: input.chatContext,
              conversationId: input.conversationId,
              userMessageId: input.userMessageId,
              toolCall,
              openAiNameToInternalName: input.openAiNameToInternalName,
            });

        if (summary.status === "blocked") blockedToolCalls += 1;
        else executedToolCalls += 1;
        inputItems.push({
          type: "function_call_output",
          call_id: summary.callId,
          output: summary.output,
        });
      }

      const toolsForNextTurn = blockedToolCalls ? [] : input.tools;
      response = await this.createOpenAiResponse(input.client, input.instructions, inputItems, toolsForNextTurn);
      if (blockedToolCalls) {
        return { response, inputItems, executedToolCalls, blockedToolCalls };
      }
    }

    return { response, inputItems, executedToolCalls, blockedToolCalls };
  }

  private async executeToolCall(input: {
    chatContext: AiToolContext;
    conversationId: string;
    userMessageId: string;
    toolCall: OpenAiResponseOutputItem;
    openAiNameToInternalName: Map<string, string>;
  }): Promise<ToolCallExecutionSummary> {
    const callId = String(input.toolCall.call_id || input.toolCall.id || `tool-${this.now().getTime()}`);
    const openAiToolName = String(input.toolCall.name || "");
    const internalToolName = input.openAiNameToInternalName.get(openAiToolName) || openAiToolName;
    const rawArguments = parseToolArguments(input.toolCall.arguments);
    const startedAt = Date.now();

    await this.conversationStore.recordToolCall({
      context: input.chatContext,
      conversationId: input.conversationId,
      messageId: input.userMessageId,
      toolName: internalToolName,
      callId,
      validatedInput: rawArguments,
      status: "started",
    });

    const result = await this.toolRegistry.executeAiTool(internalToolName, input.chatContext, rawArguments);
    const durationMs = Date.now() - startedAt;
    const output = compactToolExecutionResult(result, this.config.maxToolResultCharacters);
    await this.conversationStore.recordToolCall({
      context: input.chatContext,
      conversationId: input.conversationId,
      messageId: input.userMessageId,
      toolName: internalToolName,
      callId,
      validatedInput: rawArguments,
      status: result.ok ? "success" : "error",
      durationMs,
      resultCount: result.metadata.resultCount,
      safeError: result.ok ? undefined : result.error,
    });

    return {
      callId,
      openAiToolName,
      internalToolName,
      arguments: rawArguments,
      output,
      status: result.ok ? "success" : "error",
      resultCount: result.metadata.resultCount,
      durationMs,
    };
  }

  private async blockToolCall(
    context: AiToolContext,
    conversationId: string,
    userMessageId: string,
    toolCall: OpenAiResponseOutputItem,
    reason: string,
  ): Promise<ToolCallExecutionSummary> {
    const callId = String(toolCall.call_id || toolCall.id || `blocked-${this.now().getTime()}`);
    const toolName = String(toolCall.name || "unknown_tool");
    const output = JSON.stringify({
      ok: false,
      error: {
        code: "TOOL_CALL_LIMIT_EXCEEDED",
        message: "The assistant reached the per-turn tool call limit.",
      },
    });
    await this.conversationStore.recordToolCall({
      context,
      conversationId,
      messageId: userMessageId,
      toolName,
      callId,
      validatedInput: parseToolArguments(toolCall.arguments),
      status: "blocked",
      safeError: {
        code: "TOOL_CALL_LIMIT_EXCEEDED",
        message: reason,
      },
    });
    return {
      callId,
      openAiToolName: toolName,
      internalToolName: toolName,
      arguments: parseToolArguments(toolCall.arguments),
      output,
      status: "blocked",
    };
  }

  private async createOpenAiResponse(
    client: OpenAiResponsesClient,
    instructions: string,
    inputItems: Array<Record<string, unknown>>,
    tools: unknown[],
  ): Promise<OpenAiResponseLike> {
    const request: Record<string, unknown> = {
      model: this.config.defaultModel,
      instructions,
      input: inputItems,
      text: {
        format: {
          type: "json_schema",
          name: "product_pulse_ai_assistant_response",
          strict: false,
          schema: sanitizeJsonSchemaForOpenAi(z.toJSONSchema(aiAssistantResponseSchema)),
        },
      },
      temperature: this.config.responseTemperature,
    };
    if (tools.length) request.tools = tools;
    return client.responses.create(request);
  }

  private async parseOrRecoverAssistantResponse(input: {
    client: OpenAiResponsesClient;
    instructions: string;
    inputItems: Array<Record<string, unknown>>;
    rawResponse: OpenAiResponseLike;
  }): Promise<AiAssistantResponse> {
    const parsed = parseAiAssistantResponse(extractStructuredResponseValue(input.rawResponse));
    if (parsed) return parsed;

    const retryInput = [
      ...input.inputItems,
      ...normalizeOpenAiOutputItems(input.rawResponse.output),
      {
        role: "user",
        content: "Return the previous answer again as valid JSON that matches the required ProductPulse assistant response schema.",
      },
    ];
    const retry = await this.createOpenAiResponse(input.client, input.instructions, retryInput, []);
    const retryParsed = parseAiAssistantResponse(extractStructuredResponseValue(retry));
    if (retryParsed) return retryParsed;

    const text = extractOutputText(input.rawResponse) || extractOutputText(retry);
    return createFallbackAssistantResponse(
      text ? truncateText(text, 1600) : "I found data, but could not format the answer correctly.",
      ["The AI response format was repaired with a safe text-only fallback."],
    );
  }

  private async persistAssistantMessage(
    context: AiToolContext,
    conversationId: string,
    response: AiAssistantResponse,
    openAiResponseId: string | null,
  ): Promise<StoredAiConversationMessage> {
    return this.conversationStore.addMessage({
      context,
      conversationId,
      role: "assistant",
      content: buildStructuredMessageContent(response),
      structuredContent: response,
      openAiResponseId,
    });
  }
}

function buildOpenAiInputItems(input: {
  messages: StoredAiConversationMessage[];
  pageContext: AiPageContext;
  currentUserMessageId: string;
}): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  const pageReference = getPageContextReference(input.pageContext);
  if (pageReference) {
    items.push({
      role: "system",
      content: `Current product reference from page context: ${pageReference}`,
    });
  }

  input.messages.forEach((message) => {
    if (!["user", "assistant"].includes(message.role)) return;
    items.push({
      role: message.role,
      content: message.content,
    });
  });
  return items;
}

function extractFunctionCalls(response: OpenAiResponseLike): OpenAiResponseOutputItem[] {
  return normalizeOpenAiOutputItems(response.output)
    .filter((item) => item.type === "function_call");
}

function normalizeOpenAiOutputItems(output: unknown): OpenAiResponseOutputItem[] {
  return Array.isArray(output)
    ? output.map((item) => item && typeof item === "object" ? item as OpenAiResponseOutputItem : null).filter(Boolean) as OpenAiResponseOutputItem[]
    : [];
}

function parseToolArguments(value: unknown): unknown {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function compactToolExecutionResult(result: AiToolExecutionResult, maxCharacters: number): string {
  const payload = result.ok
    ? {
        ok: true,
        data: result.data,
        metadata: result.metadata,
      }
    : {
        ok: false,
        error: result.error,
        metadata: result.metadata,
      };
  return truncateText(JSON.stringify(payload), maxCharacters);
}

function extractStructuredResponseValue(response: OpenAiResponseLike): unknown {
  const outputText = extractOutputText(response);
  if (!outputText) return null;
  try {
    return JSON.parse(outputText);
  } catch {
    return null;
  }
}

function extractOutputText(response: OpenAiResponseLike): string {
  if (typeof response.output_text === "string") return response.output_text.trim();
  const text = normalizeOpenAiOutputItems(response.output)
    .flatMap((item) => Array.isArray(item.content) ? item.content : [])
    .filter((content) => content.type === "output_text" || content.type === "text")
    .map((content) => String(content.text || ""))
    .join("\n")
    .trim();
  return text;
}

function normalizeUserMessage(value: unknown): string {
  const message = String(value || "").replace(/\s+/g, " ").trim();
  if (!message) throw new Error("AI chat message is required.");
  return truncateText(message, MAX_USER_MESSAGE_LENGTH);
}

function truncateText(value: string, maxCharacters: number): string {
  if (value.length <= maxCharacters) return value;
  return `${value.slice(0, Math.max(0, maxCharacters - 3)).trim()}...`;
}

function normalizeUsage(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function getSafeOpenAiErrorCode(error: unknown): string {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = record.status || record.code;
  if (status === 401) return "OpenAI authentication failed.";
  if (status === 429) return "OpenAI rate limit reached.";
  return "AI chat turn failed safely.";
}

function buildTurnResult(input: {
  response: AiAssistantResponse;
  conversationId: string;
  userMessageId: string;
  assistantMessageId: string;
  model: string;
  pageContext: AiPageContext;
  toolCallCount: number;
  blockedToolCallCount: number;
  openAiResponseId: string | null;
  usage: Record<string, unknown> | null;
}): AiChatTurnResult {
  return {
    conversationId: input.conversationId,
    messageId: input.assistantMessageId,
    userMessageId: input.userMessageId,
    ...input.response,
    metadata: {
      model: input.model,
      toolCallCount: input.toolCallCount,
      blockedToolCallCount: input.blockedToolCallCount,
      openAiResponseId: input.openAiResponseId,
      usage: input.usage,
      pageContext: input.pageContext,
    },
  };
}
