import { z } from "zod";
import { createAiToolContextFromAuthenticatedRequest } from "../context.server";
import type { AiToolContext, AiToolExecutionResult } from "../domain/types";
import type { AiToolRegistry } from "../tools/registry.server";
import { createAiToolRegistry } from "../tools/registry.server";
import { toOpenAiToolAdapterResult } from "../tools/adapters/openAiToolAdapter";
import { sanitizeJsonSchemaForOpenAi } from "../tools/adapters/jsonSchema";
import {
  AI_ACTION_PROPOSAL_TOOL_NAME,
  createAiActionRegistry,
  type AiActionRegistry,
} from "../actions/registry.server";
import {
  aiActionProposalToPresentationBlock,
  aiActionProposalToSafeSummary,
} from "../actions/presentation";
import {
  AI_APP_MUTATION_PROPOSAL_TOOL_NAME,
  buildAppMutationProposalOpenAiToolDefinition,
  createAiAppMutationRegistry,
  type AiAppMutationRegistry,
} from "../appMutations/registry.server";
import { PRODUCT_PULSE_AI_APP_MUTATION_NAMES } from "../appMutations/productPulseAppMutations.server";
import { estimateAiTurnCost, type AiEstimatedCost } from "../observability/pricing";
import type { AiChatTrace } from "../observability/trace";
import { AI_TRACE_SCHEMA_VERSION, compactAiChatTraceForMetadata } from "../observability/trace";
import { combineOpenAiTokenUsage, type AiTokenUsage } from "../observability/tokenUsage";
import { recordAiUsageEvent } from "../observability/usageEvents.server";
import { getAiChatConfig, hasOpenAiApiKey, type AiChatConfig } from "./config.server";
import {
  buildStructuredMessageContent,
  PrismaAiConversationStore,
  type AiConversationStore,
  type StoredAiConversationMessage,
} from "./conversationStore.server";
import { AI_CHAT_INSTRUCTIONS_VERSION, buildAiChatInstructions } from "./instructions";
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
import {
  AI_SUPPORT_CONTACT_TOOL_NAME,
  buildSupportContactOpenAiToolDefinition,
  executeAiSupportContactTool,
  type ExecuteAiSupportContactToolInput,
} from "../support/supportContactTool.server";

const MAX_USER_MESSAGE_LENGTH = 3000;

const actionProposalToolInputSchema = z.object({
  actionName: z.string().trim().min(1).max(160),
  input: z.record(z.string(), z.unknown()).optional(),
}).strict();

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
    usage: AiTokenUsage | null;
    estimatedCost: AiEstimatedCost | null;
    trace: ReturnType<typeof compactAiChatTraceForMetadata> | null;
    pageContext: AiPageContext;
  };
}

export interface AiChatOrchestratorDependencies {
  openAiClient?: OpenAiResponsesClient;
  toolRegistry?: AiToolRegistry;
  actionRegistry?: AiActionRegistry;
  appMutationRegistry?: AiAppMutationRegistry;
  conversationStore?: AiConversationStore;
  config?: AiChatConfig;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  supportContactExecutor?: (input: ExecuteAiSupportContactToolInput) => Promise<AiToolExecutionResult>;
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

interface StructuredResponseValidationSummary {
  valid: boolean;
  retryCount: number;
  fallbackUsed: boolean;
}

export class AiChatOrchestrator {
  private openAiClient?: OpenAiResponsesClient;
  private toolRegistry: AiToolRegistry;
  private actionRegistry: AiActionRegistry;
  private appMutationRegistry: AiAppMutationRegistry;
  private conversationStore: AiConversationStore;
  private config: AiChatConfig;
  private env: NodeJS.ProcessEnv;
  private now: () => Date;
  private supportContactExecutor: (input: ExecuteAiSupportContactToolInput) => Promise<AiToolExecutionResult>;

  constructor(dependencies: AiChatOrchestratorDependencies = {}) {
    this.openAiClient = dependencies.openAiClient;
    this.toolRegistry = dependencies.toolRegistry || createAiToolRegistry();
    this.actionRegistry = dependencies.actionRegistry || createAiActionRegistry();
    this.appMutationRegistry = dependencies.appMutationRegistry || createAiAppMutationRegistry({ env: dependencies.env });
    this.conversationStore = dependencies.conversationStore || new PrismaAiConversationStore();
    this.config = { ...getAiChatConfig(dependencies.env), ...(dependencies.config || {}) };
    this.env = dependencies.env || process.env;
    this.now = dependencies.now || (() => new Date());
    this.supportContactExecutor = dependencies.supportContactExecutor || executeAiSupportContactTool;
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
    const turnStartedAt = Date.now();
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

    if (!this.config.assistantEnabled) {
      const fallback = createFallbackAssistantResponse("AI assistant is currently disabled.", [
        "AI assistant is disabled by configuration.",
      ]);
      const assistantMessageId = createMessageId("ai_msg", this.now);
      const trace = buildAiChatTrace({
        context: chatContext,
        conversationId: conversation.id,
        messageId: assistantMessageId,
        userMessageId: userMessage.id,
        model: this.config.defaultModel,
        openAiResponseIds: [],
        openAiCallCount: 0,
        usage: null,
        estimatedCost: null,
        toolCallCount: 0,
        blockedToolCallCount: 0,
        actionProposalCount: 0,
        validation: { valid: true, retryCount: 0, fallbackUsed: true },
        pageContext,
        config: this.config,
        recentMessagesSent: 0,
        durationMs: Date.now() - turnStartedAt,
        errorStatus: "ai_assistant_disabled",
        now: this.now,
      });
      const assistantMessage = await this.persistAssistantMessage(chatContext, conversation.id, fallback, null, trace);
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
        estimatedCost: null,
        trace: compactAiChatTraceForMetadata(trace),
      });
    }

    if (!hasOpenAiApiKey(this.env) && !this.openAiClient) {
      const fallback = createFallbackAssistantResponse("AI chat is not configured yet. Set OPENAI_API_KEY on the server before using this endpoint.", [
        "AI chat configuration is missing.",
      ]);
      const assistantMessageId = createMessageId("ai_msg", this.now);
      const trace = buildAiChatTrace({
        context: chatContext,
        conversationId: conversation.id,
        messageId: assistantMessageId,
        userMessageId: userMessage.id,
        model: this.config.defaultModel,
        openAiResponseIds: [],
        openAiCallCount: 0,
        usage: null,
        estimatedCost: null,
        toolCallCount: 0,
        blockedToolCallCount: 0,
        actionProposalCount: 0,
        validation: { valid: true, retryCount: 0, fallbackUsed: true },
        pageContext,
        config: this.config,
        recentMessagesSent: 0,
        durationMs: Date.now() - turnStartedAt,
        errorStatus: "missing_openai_api_key",
        now: this.now,
      });
      const assistantMessage = await this.persistAssistantMessage(chatContext, conversation.id, fallback, null, trace);
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
        estimatedCost: null,
        trace: compactAiChatTraceForMetadata(trace),
      });
    }

    const client = this.openAiClient || createOpenAiResponsesClient(this.env);
    const recentMessages = await this.conversationStore.listRecentMessages(
      chatContext,
      conversation.id,
      this.config.maxRecentMessages,
    );
    const adapter = toOpenAiToolAdapterResult(this.toolRegistry);
    const openAiNameToInternalName = new Map(adapter.openAiNameToInternalName);
    const supportContactTool = buildSupportContactOpenAiToolDefinition(sanitizeJsonSchemaForOpenAi);
    openAiNameToInternalName.set(supportContactTool.name, AI_SUPPORT_CONTACT_TOOL_NAME);
    const actionProposalTool = buildActionProposalOpenAiToolDefinition();
    const actionDefinitions = this.config.internalActionsEnabled && this.config.actionConfirmationsEnabled
      ? this.actionRegistry.listAiActions()
      : [];
    const appMutationDefinitions = this.config.appMutationsEnabled && this.config.actionConfirmationsEnabled
      ? this.appMutationRegistry.listAiAppMutations()
      : [];
    const appMutationProposalTool = buildAppMutationProposalOpenAiToolDefinition(sanitizeJsonSchemaForOpenAi);
    const instructions = buildAiChatInstructions({
      pageContext,
      toolNames: adapter.tools.map((tool) => tool.name),
      actionNames: actionDefinitions.map((definition) => definition.actionName),
      appMutationNames: appMutationDefinitions.map((definition) => definition.mutationName),
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
        pageContext,
        tools: [
          ...adapter.tools,
          supportContactTool,
          ...(actionDefinitions.length ? [actionProposalTool] : []),
          ...(appMutationDefinitions.length ? [appMutationProposalTool] : []),
        ],
        openAiNameToInternalName,
      });
      const parseResult = await this.parseOrRecoverAssistantResponse({
        client,
        instructions,
        inputItems: runResult.inputItems,
        rawResponse: runResult.response,
      });
      const openAiResponses = [...runResult.responses, ...parseResult.extraOpenAiResponses];
      const usage = combineOpenAiTokenUsage(openAiResponses.map((response) => response.usage));
      const estimatedCost = this.config.costTrackingEnabled
        ? estimateAiTurnCost({ model: this.config.defaultModel, usage, env: this.env })
        : null;
      const actionProposalCount = runResult.toolCallSummaries
        .filter((summary) => summary.internalToolName === AI_ACTION_PROPOSAL_TOOL_NAME && summary.status === "success")
        .length;
      const assistantMessageId = createMessageId("ai_msg", this.now);
      const trace = buildAiChatTrace({
        context: chatContext,
        conversationId: conversation.id,
        messageId: assistantMessageId,
        userMessageId: userMessage.id,
        model: this.config.defaultModel,
        openAiResponseIds: openAiResponses.map((response) => String(response.id || "")).filter(Boolean),
        openAiCallCount: openAiResponses.length,
        usage,
        estimatedCost,
        toolCallCount: runResult.executedToolCalls,
        blockedToolCallCount: runResult.blockedToolCalls,
        actionProposalCount,
        validation: parseResult.validation,
        pageContext,
        config: this.config,
        recentMessagesSent: recentMessages.length,
        durationMs: Date.now() - turnStartedAt,
        errorStatus: null,
        now: this.now,
      });
      const assistantMessage = await this.persistAssistantMessage(
        chatContext,
        conversation.id,
        parseResult.response,
        runResult.response.id || null,
        trace,
      );
      const usageEntity = getUsageEntityFromPageContext(pageContext);
      await recordAiUsageEvent({
        shop: chatContext.shop,
        userId: chatContext.userId,
        source: "chat",
        operation: "chat_turn",
        provider: "openai",
        model: this.config.defaultModel,
        task: "chat_turn",
        conversationId: conversation.id,
        messageId: assistantMessage.id,
        entityType: usageEntity.entityType,
        entityId: usageEntity.entityId,
        usage,
        estimatedCost,
      });

      return buildTurnResult({
        response: parseResult.response,
        conversationId: conversation.id,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        model: this.config.defaultModel,
        pageContext,
        toolCallCount: runResult.executedToolCalls,
        blockedToolCallCount: runResult.blockedToolCalls,
        openAiResponseId: runResult.response.id || null,
        usage,
        estimatedCost,
        trace: compactAiChatTraceForMetadata(trace),
      });
    } catch (error) {
      const fallback = createFallbackAssistantResponse("I could not complete that AI chat turn. Please try again in a moment.", [
        getSafeOpenAiErrorCode(error),
      ].filter(Boolean));
      const assistantMessageId = createMessageId("ai_msg", this.now);
      const trace = buildAiChatTrace({
        context: chatContext,
        conversationId: conversation.id,
        messageId: assistantMessageId,
        userMessageId: userMessage.id,
        model: this.config.defaultModel,
        openAiResponseIds: [],
        openAiCallCount: 0,
        usage: null,
        estimatedCost: null,
        toolCallCount: 0,
        blockedToolCallCount: 0,
        actionProposalCount: 0,
        validation: { valid: false, retryCount: 0, fallbackUsed: true },
        pageContext,
        config: this.config,
        recentMessagesSent: recentMessages.length,
        durationMs: Date.now() - turnStartedAt,
        errorStatus: getSafeOpenAiErrorCode(error),
        now: this.now,
      });
      const assistantMessage = await this.persistAssistantMessage(chatContext, conversation.id, fallback, null, trace);
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
        estimatedCost: null,
        trace: compactAiChatTraceForMetadata(trace),
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
    pageContext: AiPageContext;
    tools: unknown[];
    openAiNameToInternalName: Map<string, string>;
  }): Promise<{
    response: OpenAiResponseLike;
    responses: OpenAiResponseLike[];
    inputItems: Array<Record<string, unknown>>;
    executedToolCalls: number;
    blockedToolCalls: number;
    toolCallSummaries: ToolCallExecutionSummary[];
  }> {
    const inputItems = [...input.inputItems];
    let response = await this.createOpenAiResponse(input.client, input.instructions, inputItems, input.tools);
    const responses = [response];
    const toolCallSummaries: ToolCallExecutionSummary[] = [];
    let executedToolCalls = 0;
    let blockedToolCalls = 0;

    for (let turn = 0; turn <= this.config.maxToolCallsPerTurn; turn += 1) {
      const functionCalls = extractFunctionCalls(response);
      if (!functionCalls.length) {
        return { response, responses, inputItems, executedToolCalls, blockedToolCalls, toolCallSummaries };
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
              pageContext: input.pageContext,
            });

        if (summary.status === "blocked") blockedToolCalls += 1;
        else executedToolCalls += 1;
        toolCallSummaries.push(summary);
        inputItems.push({
          type: "function_call_output",
          call_id: summary.callId,
          output: summary.output,
        });
      }

      const toolsForNextTurn = blockedToolCalls ? [] : input.tools;
      response = await this.createOpenAiResponse(input.client, input.instructions, inputItems, toolsForNextTurn);
      responses.push(response);
      if (blockedToolCalls) {
        return { response, responses, inputItems, executedToolCalls, blockedToolCalls, toolCallSummaries };
      }
    }

    return { response, responses, inputItems, executedToolCalls, blockedToolCalls, toolCallSummaries };
  }

  private async executeToolCall(input: {
    chatContext: AiToolContext;
    conversationId: string;
    userMessageId: string;
    toolCall: OpenAiResponseOutputItem;
    openAiNameToInternalName: Map<string, string>;
    pageContext: AiPageContext;
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

    const result = internalToolName === AI_ACTION_PROPOSAL_TOOL_NAME
      ? await this.executeActionProposalTool(input.chatContext, rawArguments)
      : internalToolName === AI_APP_MUTATION_PROPOSAL_TOOL_NAME
      ? await this.appMutationRegistry.executeProposalTool(input.chatContext, rawArguments)
      : internalToolName === AI_SUPPORT_CONTACT_TOOL_NAME
      ? await this.supportContactExecutor({
          context: input.chatContext,
          conversationId: input.conversationId,
          rawArguments,
          conversationStore: this.conversationStore,
          pageContext: input.pageContext,
          now: this.now,
        })
      : await this.toolRegistry.executeAiTool(internalToolName, input.chatContext, rawArguments);
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

  private async executeActionProposalTool(
    context: AiToolContext,
    rawArguments: unknown,
  ): Promise<AiToolExecutionResult> {
    const parsed = actionProposalToolInputSchema.safeParse(rawArguments || {});
    if (!this.config.internalActionsEnabled || !this.config.actionConfirmationsEnabled) {
      return {
        ok: false,
        toolName: AI_ACTION_PROPOSAL_TOOL_NAME,
        error: {
          code: "AI_INTERNAL_ACTIONS_DISABLED",
          message: "AI internal actions are disabled.",
          retryable: false,
        },
        metadata: { resultCount: 0 },
      };
    }
    if (!parsed.success) {
      return {
        ok: false,
        toolName: AI_ACTION_PROPOSAL_TOOL_NAME,
        error: {
          code: "VALIDATION_ERROR",
          message: "Action proposal input failed validation.",
          retryable: false,
          validationIssues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
        metadata: { resultCount: 0 },
      };
    }

    const result = await this.actionRegistry.createAiActionProposal(
      context,
      parsed.data.actionName,
      parsed.data.input || {},
    );
    if (!result.ok) {
      if (result.error.code === "UNKNOWN_AI_ACTION") {
        const fallback = await this.createAppOnlyActionFromUnknownInternalAction(context, parsed.data);
        if (fallback) return fallback;
      }
      return {
        ok: false,
        toolName: AI_ACTION_PROPOSAL_TOOL_NAME,
        error: result.error,
        metadata: { resultCount: 0 },
      };
    }

    const block = aiActionProposalToPresentationBlock(result.data.proposal);
    return {
      ok: true,
      toolName: AI_ACTION_PROPOSAL_TOOL_NAME,
      data: {
        proposal: aiActionProposalToSafeSummary(result.data.proposal),
        block,
        instruction: "Include this action_proposal block in the final response. Do not claim the action has executed.",
      },
      metadata: { resultCount: 1 },
    };
  }

  private async createAppOnlyActionFromUnknownInternalAction(
    context: AiToolContext,
    input: z.infer<typeof actionProposalToolInputSchema>,
  ): Promise<AiToolExecutionResult | null> {
    const rawInput = input.input && typeof input.input === "object" && !Array.isArray(input.input)
      ? input.input as Record<string, unknown>
      : {};
    const hasProductReference = Boolean(rawInput.productRef || rawInput.productGid || rawInput.handle);
    if (!hasProductReference) return null;
    const title = String(rawInput.title || rawInput.label || input.actionName || "").replace(/[_-]+/g, " ").trim();
    const mutationInput = {
      ...rawInput,
      actionId: rawInput.actionId || input.actionName,
      title: title || "Create ProductPulse action",
      description: rawInput.description || rawInput.reason || "Create an app-owned ProductPulse action from the chat request.",
      draftText: rawInput.draftText || rawInput.text || rawInput.proposedText || rawInput.note || "",
      reason: rawInput.reason || `Converted from unknown internal action "${input.actionName}".`,
      status: rawInput.status || "draft",
    };
    return this.appMutationRegistry.executeProposalTool(context, {
      mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductAction,
      input: mutationInput,
    });
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
      max_output_tokens: this.config.maxOutputTokens,
    };
    if (tools.length) request.tools = tools;
    return withTimeout(
      client.responses.create(request),
      this.config.openAiTimeoutMs,
      "OpenAI response timed out.",
    );
  }

  private async parseOrRecoverAssistantResponse(input: {
    client: OpenAiResponsesClient;
    instructions: string;
    inputItems: Array<Record<string, unknown>>;
    rawResponse: OpenAiResponseLike;
  }): Promise<{
    response: AiAssistantResponse;
    extraOpenAiResponses: OpenAiResponseLike[];
    validation: StructuredResponseValidationSummary;
  }> {
    const parsed = parseAiAssistantResponse(extractStructuredResponseValue(input.rawResponse));
    if (parsed) {
      return {
        response: enforceAssistantResponseGuardrails(parsed, this.config),
        extraOpenAiResponses: [],
        validation: { valid: true, retryCount: 0, fallbackUsed: false },
      };
    }

    const retries: OpenAiResponseLike[] = [];
    for (let retryCount = 1; retryCount <= this.config.maxStructuredResponseRetries; retryCount += 1) {
      const retryInput = [
        ...input.inputItems,
        ...normalizeOpenAiOutputItems(input.rawResponse.output),
        {
          role: "user",
          content: "Return the previous answer again as valid JSON that matches the required ProductPulse assistant response schema.",
        },
      ];
      const retry = await this.createOpenAiResponse(input.client, input.instructions, retryInput, []);
      retries.push(retry);
      const retryParsed = parseAiAssistantResponse(extractStructuredResponseValue(retry));
      if (retryParsed) {
        return {
          response: enforceAssistantResponseGuardrails(retryParsed, this.config),
          extraOpenAiResponses: retries,
          validation: { valid: true, retryCount, fallbackUsed: false },
        };
      }
    }

    const text = extractOutputText(input.rawResponse) || extractOutputText(retries[retries.length - 1] || {});
    return {
      response: createFallbackAssistantResponse(
        text ? truncateText(text, 1600) : "I found data, but could not format the answer correctly.",
        ["The AI response format was repaired with a safe text-only fallback."],
      ),
      extraOpenAiResponses: retries,
      validation: { valid: false, retryCount: retries.length, fallbackUsed: true },
    };
  }

  private async persistAssistantMessage(
    context: AiToolContext,
    conversationId: string,
    response: AiAssistantResponse,
    openAiResponseId: string | null,
    trace?: AiChatTrace | null,
  ): Promise<StoredAiConversationMessage> {
    return this.conversationStore.addMessage({
      id: trace?.messageId,
      context,
      conversationId,
      role: "assistant",
      content: buildStructuredMessageContent(response),
      structuredContent: trace ? { ...response, trace } : response,
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

function enforceAssistantResponseGuardrails(
  response: AiAssistantResponse,
  config: AiChatConfig,
): AiAssistantResponse {
  if (config.maxActionProposalsPerTurn < 0) return response;
  let actionProposalCount = 0;
  const blocks = response.blocks.filter((block) => {
    if (block.type !== "action_proposal" && block.type !== "app_draft_proposal") return true;
    actionProposalCount += 1;
    return actionProposalCount <= config.maxActionProposalsPerTurn;
  });
  if (blocks.length === response.blocks.length) return response;
  return {
    ...response,
    blocks,
    warnings: [
      ...response.warnings,
      "Some action proposals were hidden by the per-turn proposal limit.",
    ].slice(0, 6),
  };
}

function buildActionProposalOpenAiToolDefinition(): Record<string, unknown> {
  return {
    type: "function",
    name: AI_ACTION_PROPOSAL_TOOL_NAME,
    description: "Create a pending ProductPulse internal action proposal for explicit user confirmation. This does not execute the action.",
    parameters: sanitizeJsonSchemaForOpenAi(z.toJSONSchema(actionProposalToolInputSchema)),
    strict: false,
  };
}

function getSafeOpenAiErrorCode(error: unknown): string {
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const status = record.status || record.code;
  if (status === 401) return "OpenAI authentication failed.";
  if (status === 429) return "OpenAI rate limit reached.";
  return "AI chat turn failed safely.";
}

function buildAiChatTrace(input: {
  context: AiToolContext;
  conversationId: string;
  messageId: string;
  userMessageId: string;
  model: string;
  openAiResponseIds: string[];
  openAiCallCount: number;
  usage: AiTokenUsage | null;
  estimatedCost: AiEstimatedCost | null;
  toolCallCount: number;
  blockedToolCallCount: number;
  actionProposalCount: number;
  validation: StructuredResponseValidationSummary;
  pageContext: AiPageContext;
  config: AiChatConfig;
  recentMessagesSent: number;
  durationMs: number;
  errorStatus: string | null;
  now: () => Date;
}): AiChatTrace {
  return {
    schemaVersion: AI_TRACE_SCHEMA_VERSION,
    conversationId: input.conversationId,
    messageId: input.messageId,
    userMessageId: input.userMessageId,
    shop: input.context.shop,
    userId: input.context.userId == null ? null : String(input.context.userId),
    model: input.model,
    instructionVersion: AI_CHAT_INSTRUCTIONS_VERSION,
    openAiResponseIds: input.openAiResponseIds,
    openAiCallCount: input.openAiCallCount,
    tokenUsage: input.usage,
    estimatedCost: input.estimatedCost,
    toolCallCount: input.toolCallCount,
    blockedToolCallCount: input.blockedToolCallCount,
    actionProposalCount: input.actionProposalCount,
    structuredResponse: {
      valid: input.validation.valid,
      retryCount: input.validation.retryCount,
      fallbackUsed: input.validation.fallbackUsed,
    },
    guardrails: {
      maxToolCallsPerTurn: input.config.maxToolCallsPerTurn,
      maxRecentMessages: input.config.maxRecentMessages,
      recentMessagesSent: input.recentMessagesSent,
      maxToolResultCharacters: input.config.maxToolResultCharacters,
      maxOutputTokens: input.config.maxOutputTokens || null,
      maxActionProposalsPerTurn: input.config.maxActionProposalsPerTurn,
    },
    pageContext: input.pageContext,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    errorStatus: input.errorStatus,
    createdAt: input.now().toISOString(),
  };
}

function createMessageId(prefix: string, now: () => Date): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${now().getTime().toString(36)}_${random}`;
}

function getUsageEntityFromPageContext(pageContext: AiPageContext): {
  entityType?: string;
  entityId?: string;
} {
  if (pageContext.type === "product" && pageContext.entityId) {
    return {
      entityType: "product",
      entityId: pageContext.entityId,
    };
  }
  return {};
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  if (!timeoutMs) return promise;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      const error = new Error(message);
      Object.assign(error, { code: "OPENAI_TIMEOUT" });
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
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
  usage: AiTokenUsage | null;
  estimatedCost: AiEstimatedCost | null;
  trace: ReturnType<typeof compactAiChatTraceForMetadata> | null;
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
      estimatedCost: input.estimatedCost,
      trace: input.trace,
      pageContext: input.pageContext,
    },
  };
}
