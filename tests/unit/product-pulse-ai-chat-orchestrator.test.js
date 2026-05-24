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
const {
  AI_ACTION_PROPOSAL_TOOL_NAME,
} = await import("../../app/ai/actions/registry.server");
const {
  PRODUCT_PULSE_AI_ACTION_NAMES,
} = await import("../../app/ai/actions/productPulseActions.server");
const {
  PRODUCT_PULSE_AI_APP_MUTATION_NAMES,
} = await import("../../app/ai/appMutations/productPulseAppMutations.server");
const {
  estimateAiTurnCost,
} = await import("../../app/ai/observability/pricing");
const {
  normalizeOpenAiTokenUsage,
} = await import("../../app/ai/observability/tokenUsage");
const {
  AI_SUPPORT_CONTACT_TOOL_NAME,
} = await import("../../app/ai/support/supportContactTool.server");

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

  it("recovers assistant text and safe cards when model JSON has oversized block arrays", async () => {
    const store = new InMemoryConversationStore();
    const oversizedResponse = validAssistantResponse({
      assistantText: "Resumen compacto del producto sin JSON crudo.",
      blocks: [{
        type: "product_reference",
        title: "The Night Watch",
        handle: "the-night-watch",
        riskScore: 26,
        riskLabel: "Low",
        ignoredModelField: "must be dropped",
        metrics: Array.from({ length: 8 }, (_, index) => ({
          label: `Metric ${index + 1}`,
          value: index + 1,
          detail: `Detail ${index + 1}`,
        })),
      }],
    });
    const openAiCreate = vi.fn().mockResolvedValueOnce(openAiTextResponse(oversizedResponse));
    const orchestrator = createTestOrchestrator({ store, openAiCreate });

    const result = await orchestrator.runAiChatTurnWithContext(baseContext, {
      message: "Mostrame un resumen compacto.",
    });

    expect(openAiCreate).toHaveBeenCalledTimes(1);
    expect(result.assistantText).toBe("Resumen compacto del producto sin JSON crudo.");
    expect(result.assistantText).not.toContain("\"assistantText\"");
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0].type).toBe("product_reference");
    expect(result.blocks[0].metrics).toHaveLength(4);
    expect(result.blocks[0]).not.toHaveProperty("ignoredModelField");
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

  it("lets the model create internal action proposals but not execute actions", async () => {
    const store = new InMemoryConversationStore();
    const proposal = actionProposalFixture();
    const actionRegistry = {
      listAiActions: vi.fn().mockReturnValue([
        { actionName: PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist },
      ]),
      createAiActionProposal: vi.fn().mockResolvedValue({
        ok: true,
        data: { proposal },
      }),
    };
    const openAiCreate = vi.fn()
      .mockResolvedValueOnce(openAiToolCallResponse({
        name: AI_ACTION_PROPOSAL_TOOL_NAME,
        arguments: {
          actionName: PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist,
          input: { productRef: "core-linen-trouser" },
        },
      }))
      .mockResolvedValueOnce(openAiTextResponse(validAssistantResponse({
        assistantText: "I created a confirmation card. Confirm it to add the product to the ProductPulse watchlist.",
        blocks: [{
          type: "action_proposal",
          proposalId: proposal.id,
          actionName: proposal.actionName,
          title: proposal.title,
          summary: proposal.summary,
          targetType: proposal.targetType,
          targetId: proposal.targetId,
          targetLabel: proposal.targetLabel,
          reason: proposal.reason,
          expectedResult: proposal.expectedResult,
          risks: proposal.risks,
          confirmationLevel: proposal.confirmationLevel,
          sideEffectLevel: proposal.sideEffectLevel,
          reversible: proposal.reversible,
          expiresAt: proposal.expiresAt,
        }],
      })));
    const orchestrator = createTestOrchestrator({ store, openAiCreate, actionRegistry });

    const result = await orchestrator.runAiChatTurnWithContext(baseContext, {
      message: "Add this product to the watchlist.",
    });

    expect(actionRegistry.createAiActionProposal).toHaveBeenCalledWith(
      expect.objectContaining({ shop: baseContext.shop }),
      PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist,
      { productRef: "core-linen-trouser" },
    );
    expect(result.blocks[0].type).toBe("action_proposal");
    expect(store.toolCalls.find((call) => (
      call.toolName === AI_ACTION_PROPOSAL_TOOL_NAME && call.status === "success"
    ))).toMatchObject({
      status: "success",
      resultCount: 1,
    });
    const secondOpenAiRequest = openAiCreate.mock.calls[1][0];
    const toolOutputForModel = JSON.stringify(secondOpenAiRequest.input);
    expect(toolOutputForModel).toContain("action_proposal");
    expect(toolOutputForModel).not.toContain(baseContext.shop);
    expect(toolOutputForModel).not.toContain("user-1");
  });

  it("routes invented internal action names to safe app-only product action proposals", async () => {
    const store = new InMemoryConversationStore();
    const actionRegistry = {
      listAiActions: vi.fn().mockReturnValue([]),
      createAiActionProposal: vi.fn().mockResolvedValue({
        ok: false,
        error: {
          code: "UNKNOWN_AI_ACTION",
          message: "Unknown AI internal action: add_description_expectations_note.",
          retryable: false,
        },
      }),
    };
    const appMutationRegistry = {
      listAiAppMutations: vi.fn().mockReturnValue([
        { mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductAction },
      ]),
      executeProposalTool: vi.fn().mockResolvedValue({
        ok: true,
        toolName: "product_pulse_propose_app_only_mutation",
        data: {
          proposal: { mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductAction },
          block: {
            type: "app_draft_proposal",
            proposalId: "draft-1",
            mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductAction,
            draftType: "recommendation_text",
            title: "Create ProductPulse action",
            summary: "Create an app-owned action.",
            targetType: "product",
            targetId: "gid://shopify/Product/1",
            targetLabel: "Core Linen Trouser",
            proposedValue: {},
            currentAppValueSnapshot: {},
            generatedReason: null,
            validationWarnings: [],
            editableFields: [],
            confirmationLevel: "medium",
            sideEffectLevel: "medium",
            reversible: true,
            expiresAt: "2026-05-20T12:30:00.000Z",
          },
        },
        metadata: { resultCount: 1 },
      }),
    };
    const openAiCreate = vi.fn()
      .mockResolvedValueOnce(openAiToolCallResponse({
        name: AI_ACTION_PROPOSAL_TOOL_NAME,
        arguments: {
          actionName: "add_description_expectations_note",
          input: {
            productRef: "core-linen-trouser",
            draftText: "Check sizing before purchase.",
            targetField: "product.description",
          },
        },
      }))
      .mockResolvedValueOnce(openAiTextResponse(validAssistantResponse({
        assistantText: "Creé un borrador interno para confirmar.",
        blocks: [{
          type: "app_draft_proposal",
          proposalId: "draft-1",
          mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductAction,
          draftType: "recommendation_text",
          title: "Create ProductPulse action",
          summary: "Create an app-owned action.",
          targetType: "product",
          targetId: "gid://shopify/Product/1",
          targetLabel: "Core Linen Trouser",
          proposedValue: {},
          currentAppValueSnapshot: {},
          generatedReason: null,
          validationWarnings: [],
          editableFields: [],
          confirmationLevel: "medium",
          sideEffectLevel: "medium",
          reversible: true,
          expiresAt: "2026-05-20T12:30:00.000Z",
        }],
      })));
    const orchestrator = createTestOrchestrator({ store, openAiCreate, actionRegistry, appMutationRegistry });

    const result = await orchestrator.runAiChatTurnWithContext(baseContext, {
      message: "Creá una acción para agregar una nota a la descripción.",
    });

    expect(result.blocks[0].type).toBe("app_draft_proposal");
    expect(appMutationRegistry.executeProposalTool).toHaveBeenCalledWith(
      expect.objectContaining({ shop: baseContext.shop }),
      {
        mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductAction,
        input: expect.objectContaining({
          actionId: "add_description_expectations_note",
          title: "add description expectations note",
          draftText: "Check sizing before purchase.",
        }),
      },
    );
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

  it("normalizes token usage and estimates turn cost centrally", () => {
    const usage = normalizeOpenAiTokenUsage({
      input_tokens: 1000,
      output_tokens: 500,
      total_tokens: 1500,
      input_tokens_details: { cached_tokens: 200 },
      output_tokens_details: { reasoning_tokens: 50 },
    });

    const cost = estimateAiTurnCost({
      model: "gpt-5.4-mini",
      usage,
    });

    expect(usage).toMatchObject({
      inputTokens: 1000,
      outputTokens: 500,
      cachedInputTokens: 200,
      reasoningOutputTokens: 50,
      totalTokens: 1500,
    });
    expect(cost.totalUsd).toBe(0.002865);
    expect(cost.missingUsage).toBe(false);
    expect(cost.missingPricing).toBe(false);
  });

  it("logs AI turn traces with usage, estimated cost, instruction version, and call count", async () => {
    const store = new InMemoryConversationStore();
    const openAiCreate = vi.fn().mockResolvedValueOnce(openAiTextResponse(validAssistantResponse({
      assistantText: "Here is a measured answer.",
    })));
    const orchestrator = createTestOrchestrator({ store, openAiCreate });

    const result = await orchestrator.runAiChatTurnWithContext(baseContext, {
      message: "Summarize this product.",
    });

    const request = openAiCreate.mock.calls[0][0];
    const assistantMessage = store.messages.find((message) => message.role === "assistant");
    expect(request.max_output_tokens).toBe(1600);
    expect(result.metadata.usage).toMatchObject({
      inputTokens: 10,
      outputTokens: 20,
      totalTokens: 30,
    });
    expect(result.metadata.estimatedCost.totalUsd).toBeGreaterThan(0);
    expect(result.metadata.trace).toMatchObject({
      openAiCallCount: 1,
      toolCallCount: 0,
      blockedToolCallCount: 0,
      instructionVersion: "product-pulse-ai-chat-v1",
      structuredResponse: {
        valid: true,
        retryCount: 0,
        fallbackUsed: false,
      },
    });
    expect(assistantMessage.structuredContent.trace).toMatchObject({
      shop: baseContext.shop,
      userId: baseContext.userId,
      tokenUsage: expect.objectContaining({ totalTokens: 30 }),
      estimatedCost: expect.objectContaining({ estimated: true }),
    });
  });

  it("trims conversation history before sending model input", async () => {
    const store = new InMemoryConversationStore();
    store.conversations.push({
      id: "conversation-1",
      shop: baseContext.shop,
      userId: baseContext.userId,
      title: "Existing conversation",
    });
    for (let index = 0; index < 10; index += 1) {
      store.messages.push({
        id: `old-${index}`,
        conversationId: "conversation-1",
        role: index % 2 ? "assistant" : "user",
        content: `old message ${index}`,
        structuredContent: {},
        createdAt: new Date(),
      });
    }
    const openAiCreate = vi.fn().mockResolvedValueOnce(openAiTextResponse(validAssistantResponse()));
    const orchestrator = createTestOrchestrator({
      store,
      openAiCreate,
      config: { maxRecentMessages: 3 },
    });

    await orchestrator.runAiChatTurnWithContext(baseContext, {
      conversationId: "conversation-1",
      message: "Current message",
    });

    const request = openAiCreate.mock.calls[0][0];
    expect(request.input).toHaveLength(3);
    expect(JSON.stringify(request.input)).toContain("Current message");
    expect(JSON.stringify(request.input)).not.toContain("old message 0");
  });

  it("honors configured structured-response retry limits", async () => {
    const store = new InMemoryConversationStore();
    const openAiCreate = vi.fn().mockResolvedValueOnce({ id: "bad-1", output_text: "not json" });
    const orchestrator = createTestOrchestrator({
      store,
      openAiCreate,
      config: { maxStructuredResponseRetries: 0 },
    });

    const result = await orchestrator.runAiChatTurnWithContext(baseContext, {
      message: "Return invalid output.",
    });

    expect(openAiCreate).toHaveBeenCalledTimes(1);
    expect(result.warnings.join(" ")).toContain("safe text-only fallback");
    expect(result.metadata.trace.structuredResponse).toMatchObject({
      valid: false,
      retryCount: 0,
      fallbackUsed: true,
    });
  });

  it("lets the model send a support contact report through the backend tool", async () => {
    const store = new InMemoryConversationStore();
    const supportContactExecutor = vi.fn().mockResolvedValue({
      ok: true,
      toolName: AI_SUPPORT_CONTACT_TOOL_NAME,
      data: {
        sent: true,
        type: "problem_report",
        subject: "AI chat problem: evidence tab issue",
        contactRequestId: "contact-1",
        safeMessage: "Thanks, the ProductPulse team received the problem report and will review it.",
      },
      metadata: { resultCount: 1 },
    });
    const openAiCreate = vi.fn()
      .mockResolvedValueOnce(openAiToolCallResponse({
        name: AI_SUPPORT_CONTACT_TOOL_NAME,
        arguments: {
          type: "problem_report",
          subject: "Evidence tab does not open",
          userMessage: "The evidence button does not open anything on the Mona Lisa product.",
          interpretation: "The merchant is reporting a ChatKit navigation/action issue on a product page.",
          relatedProductRef: "gid://shopify/Product/1",
          relatedProductTitle: "Mona Lisa",
          relatedData: [{ label: "Screen", value: "Product detail" }],
        },
      }))
      .mockResolvedValueOnce(openAiTextResponse(validAssistantResponse({
        assistantText: "Gracias, ya informé el problema al equipo de ProductPulse. Lo vamos a revisar y nos vamos a mantener en contacto.",
      })));
    const orchestrator = createTestOrchestrator({ store, openAiCreate, supportContactExecutor });

    const result = await orchestrator.runAiChatTurnWithContext(baseContext, {
      conversationId: "conversation-1",
      message: "Quiero reportar que el botón de evidencia no abre nada.",
      pageContext: {
        type: "product",
        entityId: "gid://shopify/Product/1",
        entityHandle: "mona-lisa",
      },
    });

    expect(result.assistantText).toContain("informé el problema");
    expect(supportContactExecutor).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ shop: baseContext.shop, conversationId: "conversation-1" }),
      conversationId: "conversation-1",
      pageContext: expect.objectContaining({ type: "product", entityId: "gid://shopify/Product/1" }),
    }));
    expect(store.toolCalls.find((call) => call.toolName === AI_SUPPORT_CONTACT_TOOL_NAME && call.status === "success")).toBeTruthy();
  });
});

function createTestOrchestrator({ registry, actionRegistry, appMutationRegistry, store, openAiCreate, config = {}, supportContactExecutor } = {}) {
  return new AiChatOrchestrator({
    toolRegistry: registry || createRegistryWithRepositories(),
    actionRegistry,
    appMutationRegistry,
    conversationStore: store || new InMemoryConversationStore(),
    openAiClient: {
      responses: {
        create: openAiCreate || vi.fn().mockResolvedValue(openAiTextResponse(validAssistantResponse())),
      },
    },
    supportContactExecutor,
    env: {
      OPENAI_API_KEY: "test-key",
      AI_MODEL_PRICING_JSON: JSON.stringify({
        "gpt-test": { input: 1, cachedInput: 0.1, output: 2 },
      }),
    },
    config: {
      defaultModel: "gpt-test",
      strongModel: "gpt-test-strong",
      cheapModel: "gpt-test-cheap",
      maxToolCallsPerTurn: 5,
      maxRecentMessages: 8,
      maxToolResultCharacters: 2000,
      maxOutputTokens: 1600,
      maxStructuredResponseRetries: 1,
      maxActionProposalsPerTurn: 1,
      openAiTimeoutMs: 30000,
      costTrackingEnabled: true,
      debugCosts: false,
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

function actionProposalFixture() {
  return {
    id: "proposal-1",
    shop: baseContext.shop,
    userId: baseContext.userId,
    conversationId: "conversation-1",
    actionName: PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist,
    category: "watchlist",
    targetType: "product",
    targetId: "gid://shopify/Product/1",
    targetLabel: "Core Linen Trouser",
    proposedInput: { productRef: "core-linen-trouser" },
    title: "Add to ProductPulse watchlist",
    summary: "Add Core Linen Trouser to the app watchlist.",
    reason: "High risk",
    expectedResult: "ProductPulse will create a watchlist row. Shopify product data will not be changed.",
    risks: ["The watchlist has a small product limit."],
    confirmationLevel: "low",
    sideEffectLevel: "low",
    reversible: true,
    requiresEntityOwnershipCheck: true,
    status: "pending",
    result: undefined,
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
      id: input.id || `message-${this.messages.length + 1}`,
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
