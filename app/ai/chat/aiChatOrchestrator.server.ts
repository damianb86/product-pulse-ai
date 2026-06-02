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
  buildScopeRuntimeInstructions,
  classifyProductPulseChatScope,
  fallbackOutputRefusal,
  fallbackScopeRefusal,
  validateProductPulseAssistantScope,
  type AiOutputScopeValidation,
  type AiScopeClassification,
} from "./scopeGuard.server";
import {
  AI_SUPPORT_CONTACT_TOOL_NAME,
  buildSupportContactOpenAiToolDefinition,
  executeAiSupportContactTool,
  type ExecuteAiSupportContactToolInput,
} from "../support/supportContactTool.server";
import { getAiChatMonthlyQuotaForShop, type AiChatMonthlyQuota } from "./quota.server";

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
  chatQuotaResolver?: typeof getAiChatMonthlyQuotaForShop;
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

interface ScopeGuardSummary {
  inputRoute: string | null;
  inputAllowed: boolean | null;
  inputConfidence: number | null;
  outputRoute: string | null;
  outputAllowed: boolean | null;
  outputConfidence: number | null;
  blocked: boolean;
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
  private chatQuotaResolver: typeof getAiChatMonthlyQuotaForShop;

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
    this.chatQuotaResolver = dependencies.chatQuotaResolver || getAiChatMonthlyQuotaForShop;
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
    if (
      shouldReplaceGenericConversationTitle(conversation.title, message)
      && typeof this.conversationStore.updateConversationTitle === "function"
    ) {
      await this.conversationStore.updateConversationTitle(context, conversation.id, message);
      conversation.title = message;
    }
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

    const chatQuota = await this.chatQuotaResolver(chatContext.shop, {
      userId: chatContext.userId,
      env: this.env,
      now: this.now(),
      defaultModel: this.config.defaultModel,
      cheapModel: this.config.cheapModel,
      standardMonthlyMessageLimit: this.config.standardMonthlyMessageLimit,
      cheapMonthlyMessageLimit: this.config.cheapMonthlyMessageLimit,
    });
    const selectedModel = chatQuota.model || this.config.defaultModel;
    if (!chatQuota.allowed) {
      const fallback = createFallbackAssistantResponse(chatQuota.message, [
        "Monthly AI chat quota exceeded.",
      ]);
      const assistantMessageId = createMessageId("ai_msg", this.now);
      const trace = buildAiChatTrace({
        context: chatContext,
        conversationId: conversation.id,
        messageId: assistantMessageId,
        userMessageId: userMessage.id,
        model: selectedModel,
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
        chatQuota,
        recentMessagesSent: 0,
        durationMs: Date.now() - turnStartedAt,
        errorStatus: "monthly_chat_quota_exceeded",
        now: this.now,
      });
      const assistantMessage = await this.persistAssistantMessage(chatContext, conversation.id, fallback, null, trace);
      return buildTurnResult({
        response: fallback,
        conversationId: conversation.id,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        model: selectedModel,
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
    const baseInstructions = buildAiChatInstructions({
      pageContext,
      toolNames: adapter.tools.map((tool) => tool.name),
      actionNames: actionDefinitions.map((definition) => definition.actionName),
      appMutationNames: appMutationDefinitions.map((definition) => definition.mutationName),
    });
    const supportContactSignal = detectSupportContactSignal(message);
    const inputItems = buildOpenAiInputItems({
      messages: recentMessages,
      pageContext,
      currentUserMessageId: userMessage.id,
      supportContactSignal,
    });
    const scopeGuardResponses: OpenAiResponseLike[] = [];
    let scopeClassification: AiScopeClassification | null = null;
    let instructions = baseInstructions;

    if (this.config.scopeGuardEnabled) {
      try {
        scopeClassification = await classifyProductPulseChatScope({
          client,
          model: this.config.scopeGuardModel,
          timeoutMs: this.config.openAiTimeoutMs,
          maxOutputTokens: this.config.scopeGuardMaxOutputTokens,
          userMessage: message,
          recentMessages: toScopeGuardMessages(recentMessages),
          pageContext,
        });
      } catch (error) {
        scopeClassification = fallbackScopeRefusal(message, getSafeOpenAiErrorCode(error));
      }
      if (scopeClassification.response) scopeGuardResponses.push(scopeClassification.response);

      if (!scopeClassification.allowed) {
        return this.persistAndReturnGuardedResponse({
          chatContext,
          conversationId: conversation.id,
          userMessageId: userMessage.id,
          response: createFallbackAssistantResponse(scopeClassification.safeResponse),
          openAiResponses: scopeGuardResponses,
          model: this.config.scopeGuardModel,
          selectedModel,
          pageContext,
          chatQuota,
          recentMessagesSent: recentMessages.length,
          startedAt: turnStartedAt,
          scopeGuard: toScopeGuardSummary(scopeClassification, null, true),
          errorStatus: `scope_guard_${scopeClassification.route}`,
        });
      }

      instructions = `${baseInstructions}\n\n${buildScopeRuntimeInstructions(scopeClassification)}`;
    }

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
        model: selectedModel,
      });
      const parseResult = await this.parseOrRecoverAssistantResponse({
        client,
        instructions,
        inputItems: runResult.inputItems,
        rawResponse: runResult.response,
        model: selectedModel,
      });
      const outputGuardResponses: OpenAiResponseLike[] = [];
      let outputValidation: AiOutputScopeValidation | null = null;
      let finalAssistantResponse = parseResult.response;

      if (this.config.outputGuardEnabled) {
        try {
          outputValidation = await validateProductPulseAssistantScope({
            client,
            model: this.config.scopeGuardModel,
            timeoutMs: this.config.openAiTimeoutMs,
            maxOutputTokens: this.config.scopeGuardMaxOutputTokens,
            userMessage: message,
            recentMessages: toScopeGuardMessages(recentMessages),
            pageContext,
            scopeClassification,
            assistantResponse: parseResult.response,
          });
        } catch (error) {
          outputValidation = fallbackOutputRefusal(message, getSafeOpenAiErrorCode(error));
        }
        if (outputValidation.response) outputGuardResponses.push(outputValidation.response);
        if (!outputValidation.allowed) {
          finalAssistantResponse = createFallbackAssistantResponse(outputValidation.safeResponse);
        }
      }

      const primaryOpenAiResponses = [...runResult.responses, ...parseResult.extraOpenAiResponses];
      const guardOpenAiResponses = [...scopeGuardResponses, ...outputGuardResponses];
      const openAiResponses = [
        ...scopeGuardResponses,
        ...primaryOpenAiResponses,
        ...outputGuardResponses,
      ];
      const usage = combineOpenAiTokenUsage(openAiResponses.map((response) => response.usage));
      const estimatedCost = this.config.costTrackingEnabled
        ? estimateAiTurnCostForResponseGroups({
            primaryModel: selectedModel,
            primaryResponses: primaryOpenAiResponses,
            guardModel: this.config.scopeGuardModel,
            guardResponses: guardOpenAiResponses,
            env: this.env,
          })
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
        model: selectedModel,
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
        chatQuota,
        recentMessagesSent: recentMessages.length,
        scopeGuard: toScopeGuardSummary(
          scopeClassification,
          outputValidation,
          Boolean(scopeClassification && !scopeClassification.allowed) || Boolean(outputValidation && !outputValidation.allowed),
        ),
        durationMs: Date.now() - turnStartedAt,
        errorStatus: outputValidation && !outputValidation.allowed ? `output_scope_guard_${outputValidation.route}` : null,
        now: this.now,
      });
      const assistantMessage = await this.persistAssistantMessage(
        chatContext,
        conversation.id,
        finalAssistantResponse,
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
        model: selectedModel,
        task: "chat_turn",
        requestContext: chatQuota.requestContext,
        conversationId: conversation.id,
        messageId: assistantMessage.id,
        entityType: usageEntity.entityType,
        entityId: usageEntity.entityId,
        usage,
        estimatedCost,
      });

      return buildTurnResult({
        response: finalAssistantResponse,
        conversationId: conversation.id,
        userMessageId: userMessage.id,
        assistantMessageId: assistantMessage.id,
        model: selectedModel,
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
        model: selectedModel,
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
        chatQuota,
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
        model: selectedModel,
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
    model: string;
  }): Promise<{
    response: OpenAiResponseLike;
    responses: OpenAiResponseLike[];
    inputItems: Array<Record<string, unknown>>;
    executedToolCalls: number;
    blockedToolCalls: number;
    toolCallSummaries: ToolCallExecutionSummary[];
  }> {
    const inputItems = [...input.inputItems];
    let response = await this.createOpenAiResponse(input.client, input.instructions, inputItems, input.tools, input.model);
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
      response = await this.createOpenAiResponse(input.client, input.instructions, inputItems, toolsForNextTurn, input.model);
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
    model: string,
  ): Promise<OpenAiResponseLike> {
    const request: Record<string, unknown> = {
      model: model || this.config.defaultModel,
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
    model: string;
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
      const retry = await this.createOpenAiResponse(input.client, input.instructions, retryInput, [], input.model);
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

    const text = extractReadableFallbackText(input.rawResponse)
      || extractReadableFallbackText(retries[retries.length - 1] || {});
    return {
      response: createFallbackAssistantResponse(
        text ? truncateText(text, 1600) : "I found data, but could not format the answer correctly.",
        ["The AI response format was repaired with a safe text-only fallback."],
      ),
      extraOpenAiResponses: retries,
      validation: { valid: false, retryCount: retries.length, fallbackUsed: true },
    };
  }

  private async persistAndReturnGuardedResponse(input: {
    chatContext: AiToolContext;
    conversationId: string;
    userMessageId: string;
    response: AiAssistantResponse;
    openAiResponses: OpenAiResponseLike[];
    model: string;
    selectedModel: string;
    pageContext: AiPageContext;
    chatQuota: AiChatMonthlyQuota | null;
    recentMessagesSent: number;
    startedAt: number;
    scopeGuard: ScopeGuardSummary;
    errorStatus: string;
  }): Promise<AiChatTurnResult> {
    const usage = combineOpenAiTokenUsage(input.openAiResponses.map((response) => response.usage));
    const estimatedCost = this.config.costTrackingEnabled
      ? estimateAiTurnCost({ model: input.model, usage, env: this.env })
      : null;
    const assistantMessageId = createMessageId("ai_msg", this.now);
    const trace = buildAiChatTrace({
      context: input.chatContext,
      conversationId: input.conversationId,
      messageId: assistantMessageId,
      userMessageId: input.userMessageId,
      model: input.model,
      openAiResponseIds: input.openAiResponses.map((response) => String(response.id || "")).filter(Boolean),
      openAiCallCount: input.openAiResponses.length,
      usage,
      estimatedCost,
      toolCallCount: 0,
      blockedToolCallCount: 0,
      actionProposalCount: 0,
      validation: { valid: true, retryCount: 0, fallbackUsed: true },
      pageContext: input.pageContext,
      config: this.config,
      chatQuota: input.chatQuota,
      recentMessagesSent: input.recentMessagesSent,
      scopeGuard: input.scopeGuard,
      durationMs: Date.now() - input.startedAt,
      errorStatus: input.errorStatus,
      now: this.now,
    });
    const assistantMessage = await this.persistAssistantMessage(
      input.chatContext,
      input.conversationId,
      input.response,
      input.openAiResponses[0]?.id || null,
      trace,
    );
    const usageEntity = getUsageEntityFromPageContext(input.pageContext);
    await recordAiUsageEvent({
      shop: input.chatContext.shop,
      userId: input.chatContext.userId,
      source: "chat",
      operation: "chat_turn",
      provider: "openai",
      model: input.model,
      task: "chat_scope_guard",
      requestContext: input.chatQuota?.requestContext,
      conversationId: input.conversationId,
      messageId: assistantMessage.id,
      entityType: usageEntity.entityType,
      entityId: usageEntity.entityId,
      status: "blocked",
      usage,
      estimatedCost,
    });

    return buildTurnResult({
      response: input.response,
      conversationId: input.conversationId,
      userMessageId: input.userMessageId,
      assistantMessageId: assistantMessage.id,
      model: input.selectedModel,
      pageContext: input.pageContext,
      toolCallCount: 0,
      blockedToolCallCount: 0,
      openAiResponseId: input.openAiResponses[0]?.id || null,
      usage,
      estimatedCost,
      trace: compactAiChatTraceForMetadata(trace),
    });
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
  supportContactSignal?: SupportContactSignal | null;
}): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  const pageReference = getPageContextReference(input.pageContext);
  if (pageReference) {
    items.push({
      role: "system",
      content: `Current product reference from page context: ${pageReference}`,
    });
  }
  if (input.supportContactSignal) {
    items.push({
      role: "system",
      content: [
        "Support/report signal detected in the current user message.",
        input.supportContactSignal.reason,
        "If the user is only confused or the report lacks enough detail, apologize briefly, ask what happened, what they expected, and whether they want ProductPulse to send a support report.",
        "If the user clearly describes a problem or asks to contact support, use the support contact tool with the shop/page context and recent transcript; do not invent missing details.",
      ].join(" "),
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

function toScopeGuardMessages(messages: StoredAiConversationMessage[]): Array<{ role: string; content: string }> {
  return messages
    .filter((message) => ["user", "assistant"].includes(message.role))
    .map((message) => ({
      role: message.role,
      content: truncateText(message.content, 1600),
    }));
}

function estimateAiTurnCostForResponseGroups(input: {
  primaryModel: string;
  primaryResponses: OpenAiResponseLike[];
  guardModel: string;
  guardResponses: OpenAiResponseLike[];
  env: NodeJS.ProcessEnv;
}): AiEstimatedCost {
  const allResponses = [...input.primaryResponses, ...input.guardResponses];
  const allUsage = combineOpenAiTokenUsage(allResponses.map((response) => response.usage));
  if (!input.guardResponses.length || input.primaryModel === input.guardModel) {
    return estimateAiTurnCost({ model: input.primaryModel, usage: allUsage, env: input.env });
  }

  const estimates = [
    estimateAiTurnCost({
      model: input.primaryModel,
      usage: combineOpenAiTokenUsage(input.primaryResponses.map((response) => response.usage)),
      env: input.env,
    }),
    estimateAiTurnCost({
      model: input.guardModel,
      usage: combineOpenAiTokenUsage(input.guardResponses.map((response) => response.usage)),
      env: input.env,
    }),
  ];

  return combineEstimatedCosts(input.primaryModel, estimates);
}

function combineEstimatedCosts(model: string, estimates: AiEstimatedCost[]): AiEstimatedCost {
  if (estimates.length === 1) return estimates[0];
  return {
    model,
    estimated: true,
    currency: "USD",
    inputUsd: sumUsd(estimates.map((estimate) => estimate.inputUsd)),
    cachedInputUsd: sumUsd(estimates.map((estimate) => estimate.cachedInputUsd)),
    outputUsd: sumUsd(estimates.map((estimate) => estimate.outputUsd)),
    totalUsd: sumUsd(estimates.map((estimate) => estimate.totalUsd)),
    pricing: null,
    missingUsage: estimates.some((estimate) => estimate.missingUsage),
    missingPricing: estimates.some((estimate) => estimate.missingPricing),
  };
}

function sumUsd(values: Array<number | null>): number | null {
  if (values.some((value) => typeof value !== "number")) return null;
  return Math.round((values as number[]).reduce((sum, value) => sum + value, 0) * 100_000_000) / 100_000_000;
}

function toScopeGuardSummary(
  inputScope: AiScopeClassification | null,
  outputScope: AiOutputScopeValidation | null,
  blocked: boolean,
): ScopeGuardSummary {
  return {
    inputRoute: inputScope?.route || null,
    inputAllowed: inputScope ? inputScope.allowed : null,
    inputConfidence: inputScope ? inputScope.confidence : null,
    outputRoute: outputScope?.route || null,
    outputAllowed: outputScope ? outputScope.allowed : null,
    outputConfidence: outputScope ? outputScope.confidence : null,
    blocked,
  };
}

interface SupportContactSignal {
  reason: string;
}

function detectSupportContactSignal(message: string): SupportContactSignal | null {
  const text = normalizeSupportSignalText(message);
  if (!text) return null;
  const wantsContact = /\b(contact|contactar|contacten|soporte|support|ayuda|help|email|e-mail|mail|mensaje)\b/.test(text)
    && /\b(equipo|team|soporte|support|productpulse|alguien|someone|enviar|send|avisar|reportar|report|contact|contactar)\b/.test(text);
  if (wantsContact) {
    return { reason: "The user appears to be asking to contact ProductPulse support or send the team a message." };
  }
  const describesProblem = /\b(problem|problema|bug|error|falla|fallo|failed|failure|broken|rompio|roto|mal|incorrect|incorrecto|wrong|raro|extrano|strange|something went wrong)\b/.test(text)
    || /\b(no funciona|not working|doesnt work|does not work|no abre|no carga|no aparece|no se muestra|no veo|no encuentro|no puedo ver|no pude|no puedo|me lleva a login|login)\b/.test(text)
    || /\b(confundido|confundida|confuso|confusa|confusion|no entiendo|unclear|perdido|perdida)\b/.test(text);
  if (describesProblem) {
    return { reason: "The user appears to describe app confusion, missing UI, incorrect behavior, or a possible ProductPulse problem." };
  }
  return null;
}

function normalizeSupportSignalText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\s+/g, " ")
    .trim();
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

function extractReadableFallbackText(response: OpenAiResponseLike): string {
  const rawText = extractOutputText(response);
  if (!rawText) return "";
  const text = unwrapJsonMarkdownFence(rawText);
  const assistantText = extractJsonStringProperty(text, "assistantText");
  if (assistantText) return assistantText;
  if (/^\s*[{[]/.test(text)) return "";
  return text;
}

function unwrapJsonMarkdownFence(value: string): string {
  const text = value.trim();
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : text;
}

function extractJsonStringProperty(value: string, propertyName: string): string {
  const propertyIndex = value.indexOf(`"${propertyName}"`);
  if (propertyIndex < 0) return "";
  const colonIndex = value.indexOf(":", propertyIndex + propertyName.length + 2);
  if (colonIndex < 0) return "";
  let cursor = colonIndex + 1;
  while (cursor < value.length && /\s/.test(value[cursor] || "")) cursor += 1;
  if (value[cursor] !== "\"") return "";
  cursor += 1;

  let result = "";
  while (cursor < value.length) {
    const char = value[cursor];
    if (char === "\"") return result.trim();
    if (char !== "\\") {
      result += char;
      cursor += 1;
      continue;
    }

    const next = value[cursor + 1];
    if (next === "n") result += "\n";
    else if (next === "r") result += "\r";
    else if (next === "t") result += "\t";
    else if (next === "b") result += "\b";
    else if (next === "f") result += "\f";
    else if (next === "\"" || next === "\\" || next === "/") result += next;
    else if (next === "u") {
      const hex = value.slice(cursor + 2, cursor + 6);
      result += /^[0-9a-fA-F]{4}$/.test(hex) ? String.fromCharCode(parseInt(hex, 16)) : "";
      cursor += 4;
    }
    cursor += 2;
  }
  return result.trim();
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
  chatQuota?: AiChatMonthlyQuota | null;
  recentMessagesSent: number;
  scopeGuard?: ScopeGuardSummary | null;
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
      inputScopeRoute: input.scopeGuard?.inputRoute || null,
      inputScopeAllowed: input.scopeGuard?.inputAllowed ?? null,
      inputScopeConfidence: input.scopeGuard?.inputConfidence ?? null,
      outputScopeRoute: input.scopeGuard?.outputRoute || null,
      outputScopeAllowed: input.scopeGuard?.outputAllowed ?? null,
      outputScopeConfidence: input.scopeGuard?.outputConfidence ?? null,
      scopeBlocked: Boolean(input.scopeGuard?.blocked),
    },
    chatQuota: input.chatQuota ? {
      tier: input.chatQuota.tier,
      requestContext: input.chatQuota.requestContext,
      totalMessageCount: input.chatQuota.usage.totalMessageCount,
      cheapMessageCount: input.chatQuota.usage.cheapMessageCount,
      standardMonthlyMessageLimit: input.chatQuota.usage.standardMonthlyMessageLimit,
      cheapMonthlyMessageLimit: input.chatQuota.usage.cheapMonthlyMessageLimit,
      periodStart: input.chatQuota.usage.periodStart,
      periodEnd: input.chatQuota.usage.periodEnd,
    } : null,
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

function shouldReplaceGenericConversationTitle(title: unknown, message: string): boolean {
  const normalizedTitle = String(title || "").replace(/\s+/g, " ").trim().toLowerCase();
  const normalizedMessage = String(message || "").replace(/\s+/g, " ").trim();
  if (!normalizedMessage) return false;
  return !normalizedTitle
    || normalizedTitle === "productpulse ai assistant"
    || normalizedTitle === "productpulse ai chat";
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
