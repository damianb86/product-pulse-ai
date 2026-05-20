/* eslint-env node */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("../../app/db.server", () => ({ default: {} }));
vi.mock("../../app/shopify.server", () => ({
  authenticate: {
    admin: vi.fn(),
  },
}));

const { AiChatOrchestrator } = await import("../../app/ai/chat/aiChatOrchestrator.server");
const { handleChatKitMessage } = await import("../../app/ai/chatkit/message.server");
const { PRODUCT_PULSE_AI_ACTION_NAMES } = await import("../../app/ai/actions/productPulseActions.server");
const { PRODUCT_PULSE_AI_TOOL_NAMES } = await import("../../app/ai/tools/productPulseTools.server");
const { productPulseAiEvalCases } = await import("../../app/ai/evals/cases/productPulseEvalCases.js");
const {
  expectActionNotExecuted,
  expectActionNotProposed,
  expectActionProposalCreated,
  expectBlockType,
  expectCostBelowThreshold,
  expectNoHallucinatedText,
  expectTenantIsolationPreserved,
  expectToolCalled,
  expectToolNotCalled,
  expectValidStructuredResponse,
} = await import("../../app/ai/evals/assertions.js");

const evalContext = {
  shop: "eval-shop.myshopify.com",
  userId: "eval-user",
  sessionId: "eval-session",
  scopes: ["read_products"],
  createdAt: "2026-05-20T12:00:00.000Z",
};

describe("ProductPulse AI eval cases", () => {
  for (const evalCase of productPulseAiEvalCases) {
    it(`${evalCase.name}: ${evalCase.description}`, async () => {
      if (process.env.AI_EVAL_REAL_OPENAI === "true") {
        throw new Error("Real OpenAI eval execution is intentionally not wired into the default eval runner yet.");
      }

      const actual = evalCase.mode === "chatkit_action"
        ? await runChatKitActionEval(evalCase)
        : await runChatTurnEval(evalCase);

      expectValidStructuredResponse(actual.result);
      for (const toolName of evalCase.expectedTools || []) expectToolCalled(actual.toolCalls, toolName);
      for (const toolName of evalCase.forbiddenTools || []) expectToolNotCalled(actual.toolCalls, toolName);
      for (const actionName of evalCase.expectedActionsProposed || []) expectActionProposalCreated(actual.actions, actionName);
      for (const actionName of evalCase.forbiddenActionsProposed || []) expectActionNotProposed(actual.actions, actionName);
      for (const actionName of evalCase.forbiddenActionsExecuted || []) expectActionNotExecuted(actual.actions, actionName);
      for (const blockType of evalCase.expectedBlocks || []) expectBlockType(actual.result, blockType);
      if (evalCase.forbiddenText?.length) expectNoHallucinatedText(actual.result, evalCase.forbiddenText);
      if (evalCase.expectTenantIsolation) expectTenantIsolationPreserved(actual.toolCalls, evalContext.shop);
      if (typeof evalCase.maxEstimatedCostUsd === "number") expectCostBelowThreshold(actual.result, evalCase.maxEstimatedCostUsd);

      expect(actual.openAiCreate).toHaveBeenCalledTimes(evalCase.expectedOpenAiCalls || expectedOpenAiCalls(evalCase));
      expect(actual.actions.executed.length).toBe(evalCase.expectedActionsExecuted?.length || 0);
    });
  }
});

async function runChatTurnEval(evalCase) {
  const store = new InMemoryConversationStore();
  const actions = { proposed: [], executed: [] };
  const toolCalls = [];
  const openAiCreate = vi.fn()
    .mockImplementationOnce(async () => modelStepToOpenAiResponse(evalCase.modelSteps[0]))
    .mockImplementationOnce(async () => modelStepToOpenAiResponse(evalCase.modelSteps[1]))
    .mockImplementationOnce(async () => modelStepToOpenAiResponse(evalCase.modelSteps[2]));
  const orchestrator = new AiChatOrchestrator({
    openAiClient: { responses: { create: openAiCreate } },
    conversationStore: store,
    toolRegistry: createEvalToolRegistry(evalCase, toolCalls),
    actionRegistry: createEvalActionRegistry(actions),
    env: {
      OPENAI_API_KEY: "eval-key",
      AI_MODEL_PRICING_JSON: JSON.stringify({
        "gpt-eval": { input: 1, cachedInput: 0.1, output: 2 },
      }),
    },
    config: {
      defaultModel: "gpt-eval",
      strongModel: "gpt-eval-strong",
      cheapModel: "gpt-eval-cheap",
      maxToolCallsPerTurn: 5,
      maxRecentMessages: 6,
      maxToolResultCharacters: 2000,
      maxOutputTokens: 1200,
      maxStructuredResponseRetries: 1,
      maxActionProposalsPerTurn: 1,
      openAiTimeoutMs: 30000,
      costTrackingEnabled: true,
      debugCosts: false,
      responseTemperature: 0.2,
    },
    now: () => new Date("2026-05-20T12:00:00.000Z"),
  });

  const result = await orchestrator.runAiChatTurnWithContext(evalContext, {
    message: evalCase.userMessage,
    pageContext: evalCase.pageContext,
  });
  return { result, toolCalls, actions, openAiCreate };
}

async function runChatKitActionEval(evalCase) {
  const actions = { proposed: [], executed: [] };
  const store = new InMemoryConversationStore();
  store.conversations.push({
    id: "conversation-1",
    shop: evalContext.shop,
    userId: evalContext.userId,
    title: "Eval conversation",
  });
  const openAiCreate = vi.fn();
  const response = await handleChatKitMessage(evalContext, JSON.stringify({
    type: "threads.custom_action",
    params: {
      thread_id: "conversation-1",
      item_id: "widget-1",
      action: evalCase.actionPayload,
    },
  }), {
    conversationStore: store,
    actionRegistry: createEvalActionRegistry(actions),
    orchestrator: { runAiChatTurnWithContext: openAiCreate },
    now: () => new Date("2026-05-20T12:00:00.000Z"),
  });
  const body = await response.text();
  const assistantMessage = store.messages.find((message) => message.role === "assistant");
  return {
    result: {
      assistantText: assistantMessage?.content || body,
      blocks: assistantMessage?.structuredContent?.blocks || [],
      metadata: { estimatedCost: { totalUsd: 0 } },
    },
    toolCalls: [],
    actions,
    openAiCreate,
  };
}

function createEvalToolRegistry(evalCase, toolCalls) {
  const definitions = [
    toolDefinition(PRODUCT_PULSE_AI_TOOL_NAMES.getProductRiskDetail),
    toolDefinition(PRODUCT_PULSE_AI_TOOL_NAMES.getProductEvidenceSnippets),
    toolDefinition(PRODUCT_PULSE_AI_TOOL_NAMES.getWatchlistSnapshot),
    toolDefinition(PRODUCT_PULSE_AI_TOOL_NAMES.listProductRiskSummaries),
  ];
  return {
    listAiTools: () => definitions,
    executeAiTool: vi.fn().mockImplementation(async (toolName, context, rawInput) => {
      const mockedResult = evalCase.toolResults?.[toolName];
      toolCalls.push({
        toolName,
        context,
        rawInput,
        validatedInputHasTenant: false,
      });
      if (mockedResult?.ok === false) {
        return {
          ok: false,
          toolName,
          error: { code: mockedResult.code, message: mockedResult.message, retryable: false },
          metadata: { resultCount: 0 },
        };
      }
      return {
        ok: true,
        toolName,
        data: { product: { productGid: "gid://shopify/Product/1", title: "Core Linen Trouser" } },
        metadata: { resultCount: 1 },
      };
    }),
  };
}

function createEvalActionRegistry(actions) {
  return {
    listAiActions: vi.fn().mockReturnValue([{ actionName: PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist }]),
    createAiActionProposal: vi.fn().mockImplementation(async (_context, actionName, input) => {
      actions.proposed.push({ actionName, input });
      return { ok: true, data: { proposal: actionProposalFixture(actionName) } };
    }),
    confirmAiActionProposal: vi.fn().mockImplementation(async (_context, proposalId) => {
      actions.executed.push({ actionName: PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist, proposalId });
      return {
        ok: true,
        data: {
          proposal: actionProposalFixture(PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist),
          execution: {
            actionName: PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist,
            status: "success",
            summary: "Product added to watchlist.",
            affectedEntities: [{ type: "product", id: "gid://shopify/Product/1", label: "Core Linen Trouser" }],
            createdJobId: null,
            safeMessage: "Product added to watchlist.",
          },
        },
      };
    }),
  };
}

function toolDefinition(name) {
  return {
    name,
    description: `Eval tool ${name}`,
    inputSchema: z.object({}).passthrough(),
    readOnly: true,
    category: "eval",
    permissionLevel: "authenticated",
    execute: vi.fn(),
  };
}

function modelStepToOpenAiResponse(step) {
  if (!step) return openAiFinalResponse({ assistantText: "No mocked model step was configured." });
  if (step.type === "tool_call") {
    return {
      id: `resp-${step.name}`,
      output: [{
        type: "function_call",
        name: step.name,
        call_id: `call-${step.name}`,
        arguments: JSON.stringify(step.arguments || {}),
      }],
      usage: { input_tokens: 20, output_tokens: 10, total_tokens: 30 },
    };
  }
  return openAiFinalResponse(step.response);
}

function openAiFinalResponse(response) {
  const text = JSON.stringify(response);
  return {
    id: "resp-final",
    output_text: text,
    output: [{ type: "message", content: [{ type: "output_text", text }] }],
    usage: { input_tokens: 30, output_tokens: 40, total_tokens: 70 },
  };
}

function expectedOpenAiCalls(evalCase) {
  if (evalCase.mode === "chatkit_action") return 0;
  return evalCase.modelSteps.length;
}

function actionProposalFixture(actionName) {
  return {
    id: "proposal-1",
    shop: evalContext.shop,
    userId: evalContext.userId,
    conversationId: "conversation-1",
    actionName,
    category: "watchlist",
    targetType: "product",
    targetId: "gid://shopify/Product/1",
    targetLabel: "Core Linen Trouser",
    proposedInput: { productRef: "core-linen-trouser" },
    title: "Add to ProductPulse watchlist",
    summary: "Add Core Linen Trouser to the ProductPulse watchlist.",
    reason: "High risk",
    expectedResult: "ProductPulse will create an internal watchlist row. Shopify product data will not change.",
    risks: [],
    confirmationLevel: "low",
    sideEffectLevel: "low",
    reversible: true,
    requiresEntityOwnershipCheck: true,
    status: "pending",
    result: null,
    safeError: null,
    createdAt: "2026-05-20T12:00:00.000Z",
    updatedAt: "2026-05-20T12:00:00.000Z",
    expiresAt: "2026-05-20T12:15:00.000Z",
    confirmedAt: null,
    cancelledAt: null,
    executedAt: null,
  };
}

class InMemoryConversationStore {
  constructor() {
    this.conversations = [];
    this.messages = [];
    this.toolCalls = [];
  }

  async getConversation(context, conversationId) {
    return this.conversations.find((conversation) => conversation.id === conversationId && conversation.shop === context.shop) || null;
  }

  async getOrCreateConversation(context, input = {}) {
    const existing = input.conversationId
      ? this.conversations.find((conversation) => conversation.id === input.conversationId && conversation.shop === context.shop)
      : null;
    if (existing) return existing;
    const conversation = {
      id: input.conversationId || "conversation-1",
      shop: context.shop,
      userId: context.userId || null,
      title: input.titleSeed || null,
      createdAt: new Date("2026-05-20T12:00:00.000Z"),
      updatedAt: new Date("2026-05-20T12:00:00.000Z"),
    };
    this.conversations.push(conversation);
    return conversation;
  }

  async addMessage(input) {
    const message = {
      id: input.id || `message-${this.messages.length + 1}`,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      structuredContent: input.structuredContent,
      openAiResponseId: input.openAiResponseId || null,
      createdAt: new Date("2026-05-20T12:00:00.000Z"),
    };
    this.messages.push(message);
    return message;
  }

  async listRecentMessages(_context, conversationId, limit) {
    return this.messages.filter((message) => message.conversationId === conversationId).slice(-limit);
  }

  async listMessages(_context, conversationId) {
    return {
      messages: this.messages.filter((message) => message.conversationId === conversationId),
      hasMore: false,
      after: null,
    };
  }

  async recordToolCall(input) {
    this.toolCalls.push(input);
  }

  async touchConversation() {}
}
