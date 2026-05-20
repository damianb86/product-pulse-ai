/* eslint-env node */
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
}));

vi.mock("../../app/db.server", () => ({ default: {} }));
vi.mock("../../app/shopify.server", () => ({
  authenticate: {
    admin: mocks.authenticateAdmin,
  },
}));

const {
  AiChatOrchestrator,
} = await import("../../app/ai/chat/aiChatOrchestrator.server");
const {
  createAiToolRegistry,
} = await import("../../app/ai/tools/registry.server");
const {
  PRODUCT_PULSE_AI_TOOL_NAMES,
} = await import("../../app/ai/tools/productPulseTools.server");

const baseContext = {
  shop: "shop-a.myshopify.com",
  userId: "user-1",
  sessionId: "session-1",
  scopes: ["read_products"],
  createdAt: "2026-05-20T12:00:00.000Z",
};

describe("ProductPulse AI chat orchestrator", () => {
  it("authenticates request, creates server-side AI context, and persists messages", async () => {
    mocks.authenticateAdmin.mockResolvedValueOnce({
      session: {
        id: "session-from-auth",
        shop: "auth-shop.myshopify.com",
        userId: 42,
        scope: "read_products",
      },
    });
    const store = new InMemoryConversationStore();
    const openAiCreate = vi.fn().mockResolvedValueOnce(openAiTextResponse(validAssistantResponse({
      assistantText: "I can help with ProductPulse product risk data.",
    })));
    const orchestrator = createTestOrchestrator({ store, openAiCreate });

    const result = await orchestrator.runAiChatTurn({
      request: new Request("https://example.test/api/ai/chat", { method: "POST" }),
      message: "What can you do?",
    });

    expect(result.conversationId).toBe("conversation-1");
    expect(store.contexts[0].shop).toBe("auth-shop.myshopify.com");
    expect(store.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(openAiCreate).toHaveBeenCalledTimes(1);
  });

  it("does not let model-supplied tenant fields override server context", async () => {
    const productRepository = {
      listProductRiskSummaries: vi.fn().mockResolvedValue({
        products: [],
        totalCount: 0,
        hasMore: false,
        freshness: [{ source: "ProductPulse", updatedAt: null }],
      }),
    };
    const registry = createRegistryWithRepositories({ productRepository });
    const store = new InMemoryConversationStore();
    const openAiCreate = vi.fn()
      .mockResolvedValueOnce(openAiToolCallResponse({
        name: PRODUCT_PULSE_AI_TOOL_NAMES.listProductRiskSummaries,
        arguments: { limit: 999, shop: "evil-shop.myshopify.com" },
      }))
      .mockResolvedValueOnce(openAiTextResponse(validAssistantResponse({
        assistantText: "No products matched that request.",
      })));
    const orchestrator = createTestOrchestrator({ registry, store, openAiCreate });

    const result = await orchestrator.runAiChatTurnWithContext(baseContext, {
      message: "List high risk products.",
    });

    expect(result.metadata.toolCallCount).toBe(1);
    expect(productRepository.listProductRiskSummaries).toHaveBeenCalledWith(
      expect.objectContaining({ shop: baseContext.shop }),
      expect.objectContaining({ limit: 25 }),
    );
    expect(productRepository.listProductRiskSummaries.mock.calls[0][1]).not.toHaveProperty("shop");
    expect(store.toolCalls.some((call) => call.status === "success")).toBe(true);
  });

  it("rejects unknown model-requested tools through the registry", async () => {
    const store = new InMemoryConversationStore();
    const openAiCreate = vi.fn()
      .mockResolvedValueOnce(openAiToolCallResponse({
        name: "raw_sql_query",
        arguments: { sql: "select * from Session" },
      }))
      .mockResolvedValueOnce(openAiTextResponse(validAssistantResponse({
        assistantText: "I cannot use that tool. I can only read ProductPulse data through approved tools.",
        warnings: ["The requested tool is not available."],
      })));
    const orchestrator = createTestOrchestrator({ store, openAiCreate });

    const result = await orchestrator.runAiChatTurnWithContext(baseContext, {
      message: "Run raw SQL.",
    });

    expect(result.metadata.toolCallCount).toBe(1);
    expect(store.toolCalls.find((call) => call.status === "error").safeError).toMatchObject({
      code: "UNKNOWN_TOOL",
    });
  });

  it("enforces the per-turn tool call limit", async () => {
    const productRepository = {
      listProductRiskSummaries: vi.fn().mockResolvedValue({
        products: [],
        totalCount: 0,
        hasMore: false,
        freshness: [],
      }),
    };
    const registry = createRegistryWithRepositories({ productRepository });
    const store = new InMemoryConversationStore();
    const openAiCreate = vi.fn()
      .mockResolvedValueOnce({
        id: "resp-tools",
        output: [
          {
            type: "function_call",
            name: PRODUCT_PULSE_AI_TOOL_NAMES.listProductRiskSummaries,
            call_id: "call-1",
            arguments: JSON.stringify({ limit: 5 }),
          },
          {
            type: "function_call",
            name: PRODUCT_PULSE_AI_TOOL_NAMES.listProductRiskSummaries,
            call_id: "call-2",
            arguments: JSON.stringify({ limit: 5 }),
          },
        ],
      })
      .mockResolvedValueOnce(openAiTextResponse(validAssistantResponse({
        assistantText: "I reached the per-turn data lookup limit.",
        warnings: ["Some requested tool calls were blocked by the per-turn limit."],
      })));
    const orchestrator = createTestOrchestrator({
      registry,
      store,
      openAiCreate,
      config: { maxToolCallsPerTurn: 1 },
    });

    const result = await orchestrator.runAiChatTurnWithContext(baseContext, {
      message: "Use multiple tools.",
    });

    expect(productRepository.listProductRiskSummaries).toHaveBeenCalledTimes(1);
    expect(result.metadata.toolCallCount).toBe(1);
    expect(result.metadata.blockedToolCallCount).toBe(1);
    expect(store.toolCalls.some((call) => call.status === "blocked")).toBe(true);
  });

  it("falls back safely when structured model output is invalid", async () => {
    const store = new InMemoryConversationStore();
    const openAiCreate = vi.fn()
      .mockResolvedValueOnce({ id: "bad-1", output_text: "not json" })
      .mockResolvedValueOnce({ id: "bad-2", output_text: "still not json" });
    const orchestrator = createTestOrchestrator({ store, openAiCreate });

    const result = await orchestrator.runAiChatTurnWithContext(baseContext, {
      message: "Explain this.",
    });

    expect(openAiCreate).toHaveBeenCalledTimes(2);
    expect(result.assistantText).toContain("not json");
    expect(result.warnings.join(" ")).toContain("safe text-only fallback");
  });

  it("passes product page context into the model input", async () => {
    const store = new InMemoryConversationStore();
    const openAiCreate = vi.fn().mockResolvedValueOnce(openAiTextResponse(validAssistantResponse({
      assistantText: "This product reference is available for follow-up tool calls.",
    })));
    const orchestrator = createTestOrchestrator({ store, openAiCreate });

    await orchestrator.runAiChatTurnWithContext(baseContext, {
      message: "Explain this product.",
      pageContext: {
        type: "product",
        entityId: "gid://shopify/Product/123",
      },
    });

    const firstRequest = openAiCreate.mock.calls[0][0];
    expect(JSON.stringify(firstRequest.input)).toContain("gid://shopify/Product/123");
    expect(firstRequest.instructions).toContain("type=product");
  });

  it("returns a persisted safe response without OpenAI when configuration is missing", async () => {
    const store = new InMemoryConversationStore();
    const orchestrator = new AiChatOrchestrator({
      conversationStore: store,
      env: {},
    });

    const result = await orchestrator.runAiChatTurnWithContext(baseContext, {
      message: "Can you answer?",
    });

    expect(result.assistantText).toContain("AI chat is not configured");
    expect(store.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
  });
});

function createTestOrchestrator({ registry, store, openAiCreate, config = {} } = {}) {
  return new AiChatOrchestrator({
    toolRegistry: registry || createRegistryWithRepositories(),
    conversationStore: store || new InMemoryConversationStore(),
    openAiClient: {
      responses: {
        create: openAiCreate || vi.fn().mockResolvedValue(openAiTextResponse(validAssistantResponse())),
      },
    },
    env: { OPENAI_API_KEY: "test-key" },
    config: {
      defaultModel: "gpt-test",
      strongModel: "gpt-test-strong",
      cheapModel: "gpt-test-cheap",
      maxToolCallsPerTurn: 5,
      maxRecentMessages: 8,
      maxToolResultCharacters: 2000,
      responseTemperature: 0.2,
      ...config,
    },
  });
}

function createRegistryWithRepositories(overrides = {}) {
  return createAiToolRegistry({
    productPulse: {
      productRepository: {
        listProductRiskSummaries: vi.fn().mockResolvedValue({
          products: [],
          totalCount: 0,
          hasMore: false,
          freshness: [],
        }),
        getProductRiskDetail: vi.fn().mockResolvedValue(null),
        getProductEvidenceSnippets: vi.fn().mockResolvedValue(null),
        ...overrides.productRepository,
      },
      analyticsRepository: {
        getAnalyticsSnapshot: vi.fn().mockResolvedValue({
          productCount: 0,
          sampledProductCount: 0,
          sampled: false,
          averageRiskScore: null,
          averageConfidence: null,
          riskDistribution: { high: 0, medium: 0, low: 0 },
          topIssues: [],
          sourceCoverage: [],
          recentDiagnosisCount: 0,
          openRecommendationCount: 0,
          appliedActionCount: 0,
          freshness: [],
        }),
        ...overrides.analyticsRepository,
      },
      watchlistRepository: {
        getWatchlistSnapshot: vi.fn().mockResolvedValue({
          maxProducts: 5,
          watchedCount: 0,
          slotsAvailable: 5,
          alertsEnabled: true,
          alertRecipientCount: 0,
          scanCadenceDays: 3,
          triggerRule: "new_or_rising_risk",
          summarySchedule: "daily_digest_8am",
          items: [],
          recentActivity: [],
          freshness: [],
        }),
        ...overrides.watchlistRepository,
      },
    },
  });
}

function openAiToolCallResponse({ name, arguments: args }) {
  return {
    id: "resp-tool",
    output: [{
      type: "function_call",
      name,
      call_id: "call-1",
      arguments: JSON.stringify(args || {}),
    }],
  };
}

function openAiTextResponse(response) {
  const text = JSON.stringify(response);
  return {
    id: "resp-text",
    output_text: text,
    output: [{
      type: "message",
      content: [{ type: "output_text", text }],
    }],
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      total_tokens: 30,
    },
  };
}

function validAssistantResponse(overrides = {}) {
  return {
    assistantText: "Here is a safe ProductPulse answer.",
    blocks: [],
    suggestedReplies: [],
    referencedEntities: [],
    followUpQuestions: [],
    warnings: [],
    ...overrides,
  };
}

class InMemoryConversationStore {
  constructor() {
    this.conversations = [];
    this.messages = [];
    this.toolCalls = [];
    this.contexts = [];
  }

  async getOrCreateConversation(context, input = {}) {
    this.contexts.push(context);
    const existing = input.conversationId
      ? this.conversations.find((conversation) => conversation.id === input.conversationId && conversation.shop === context.shop)
      : null;
    if (existing) return existing;
    const conversation = {
      id: input.conversationId || `conversation-${this.conversations.length + 1}`,
      shop: context.shop,
      userId: context.userId || null,
      title: input.titleSeed || null,
    };
    this.conversations.push(conversation);
    return conversation;
  }

  async addMessage(input) {
    const message = {
      id: `message-${this.messages.length + 1}`,
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      structuredContent: input.structuredContent,
      openAiResponseId: input.openAiResponseId || null,
      createdAt: new Date(),
    };
    this.messages.push(message);
    return message;
  }

  async listRecentMessages(context, conversationId, limit) {
    return this.messages
      .filter((message) => message.conversationId === conversationId)
      .slice(-limit);
  }

  async recordToolCall(input) {
    this.toolCalls.push(input);
  }

  async touchConversation() {}
}
