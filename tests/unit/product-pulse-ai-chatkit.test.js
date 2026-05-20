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
  aiChatKitSessionRequestSchema,
  createAiChatKitSession,
  createAiChatKitSessionFromRequest,
} = await import("../../app/ai/chatkit/session.server");
const {
  chatKitActionRequestSchema,
  handleChatKitAction,
} = await import("../../app/ai/chatkit/actions.server");
const {
  mapAiChatTurnToChatKitToolOutput,
  mapAiPresentationBlocksToChatKitWidgets,
} = await import("../../app/ai/chatkit/widgets");
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

describe("ProductPulse ChatKit integration", () => {
  it("authenticates session creation and does not trust client tenant metadata", async () => {
    mocks.authenticateAdmin.mockResolvedValueOnce({
      session: {
        id: "session-from-auth",
        shop: "auth-shop.myshopify.com",
        userId: 42,
        scope: "read_products",
      },
    });
    const store = new InMemoryConversationStore();
    const sessionCreate = vi.fn().mockResolvedValue(chatKitSession());

    const result = await createAiChatKitSessionFromRequest({
      request: new Request("https://example.test/api/ai/chatkit/session", { method: "POST" }),
      sessionInput: {
        uiMetadata: {
          source: "drawer",
        },
      },
      dependencies: {
        config: enabledConfig(),
        conversationStore: store,
        chatKitClient: chatKitClient(sessionCreate),
        toolRegistry: createRegistry(),
      },
    });

    expect(result.enabled).toBe(true);
    expect(result.client_secret).toBe("client-secret");
    expect(store.contexts[0].shop).toBe("auth-shop.myshopify.com");
    expect(sessionCreate).toHaveBeenCalledTimes(1);
    const openAiInput = sessionCreate.mock.calls[0][0];
    expect(openAiInput.user).toMatch(/^pp_/);
    expect(openAiInput.workflow.state_variables.product_pulse_scope).toHaveLength(32);
    expect(JSON.stringify(openAiInput)).not.toContain("auth-shop.myshopify.com");
  });

  it("returns a disabled response without creating an OpenAI session when misconfigured", async () => {
    const store = new InMemoryConversationStore();
    const sessionCreate = vi.fn();

    const result = await createAiChatKitSession(baseContext, {}, {
      config: {
        ...enabledConfig(),
        enabled: false,
        workflowId: null,
        disabledReason: "ChatKit requires AI_CHATKIT_WORKFLOW_ID on the server.",
      },
      conversationStore: store,
      chatKitClient: chatKitClient(sessionCreate),
      toolRegistry: createRegistry(),
    });

    expect(result.enabled).toBe(false);
    expect(result.message).toContain("AI_CHATKIT_WORKFLOW_ID");
    expect(sessionCreate).not.toHaveBeenCalled();
    expect(store.messages[0].role).toBe("system");
  });

  it("sanitizes unverified product page context before creating a session", async () => {
    const sessionCreate = vi.fn().mockResolvedValue(chatKitSession());
    const registry = createRegistry({ productFound: false });

    const result = await createAiChatKitSession(baseContext, {
      pageContext: {
        type: "product",
        entityId: "gid://shopify/Product/other-shop",
      },
    }, {
      config: enabledConfig(),
      conversationStore: new InMemoryConversationStore(),
      chatKitClient: chatKitClient(sessionCreate),
      toolRegistry: registry,
    });

    expect(result.pageContext.entityId).toBeUndefined();
    expect(result.warnings.join(" ")).toContain("could not be verified");
    expect(registry.executeAiTool).toHaveBeenCalledWith(
      PRODUCT_PULSE_AI_TOOL_NAMES.getProductRiskDetail,
      expect.objectContaining({ shop: baseContext.shop }),
      { productRef: "gid://shopify/Product/other-shop" },
    );
  });

  it("converts neutral presentation blocks into ChatKit widgets", () => {
    const widgets = mapAiPresentationBlocksToChatKitWidgets([
      {
        type: "product_reference",
        productGid: "gid://shopify/Product/1",
        title: "Core Linen Trouser",
        handle: "core-linen-trouser",
        riskScore: 82,
        riskLabel: "High",
      },
      {
        type: "evidence_list",
        productGid: "gid://shopify/Product/1",
        title: "Evidence",
        items: [{ source: "Returns", quote: "Too small twice.", weight: "High signal" }],
      },
      {
        type: "metric_table",
        title: "Metrics",
        rows: [{ label: "Return rate", value: "12%", detail: "Above store baseline" }],
      },
      {
        type: "action_proposal",
        proposalId: "proposal-1",
        actionName: "product_pulse_add_to_watchlist",
        title: "Add to ProductPulse watchlist",
        summary: "Add Core Linen Trouser to the app watchlist.",
        targetType: "product",
        targetId: "gid://shopify/Product/1",
        targetLabel: "Core Linen Trouser",
        reason: "High risk",
        expectedResult: "ProductPulse will create a watchlist row. Shopify product data will not be changed.",
        risks: ["The watchlist has a small product limit."],
        confirmationLevel: "low",
        sideEffectLevel: "low",
        reversible: true,
        expiresAt: "2026-05-20T12:15:00.000Z",
      },
    ]);

    expect(widgets.map((widget) => widget.type)).toEqual(["Card", "ListView", "Card", "Card"]);
    expect(JSON.stringify(widgets)).toContain("open_product");
    expect(JSON.stringify(widgets)).toContain("open_evidence");
    expect(JSON.stringify(widgets)).toContain("confirm_ai_action");
    expect(JSON.stringify(widgets)).toContain("cancel_ai_action");
  });

  it("converts orchestrator responses into ChatKit client tool output", () => {
    const output = mapAiChatTurnToChatKitToolOutput({
      conversationId: "conversation-1",
      messageId: "message-2",
      userMessageId: "message-1",
      assistantText: "This product is high risk.",
      blocks: [{ type: "summary", title: "Summary", text: "Returns mention sizing." }],
      suggestedReplies: ["Show evidence"],
      referencedEntities: [],
      followUpQuestions: [],
      warnings: [],
      metadata: {
        model: "gpt-test",
        toolCallCount: 1,
        blockedToolCallCount: 0,
        openAiResponseId: "resp-1",
        usage: null,
        pageContext: { type: "product" },
      },
    });

    expect(output.ok).toBe(true);
    expect(output.conversationId).toBe("conversation-1");
    expect(output.widgets).toHaveLength(1);
    expect(output.metadata.toolCallCount).toBe(1);
  });

  it("rejects unsafe or unknown ChatKit actions", async () => {
    expect(chatKitActionRequestSchema.safeParse({
      action: {
        type: "open_product",
        payload: { productRef: "core-linen-trouser", shop: "evil.myshopify.com" },
      },
    }).success).toBe(false);

    const result = await handleChatKitAction(baseContext, {
      action: {
        type: "apply_change",
        payload: {},
      },
    }, {
      toolRegistry: createRegistry(),
    });

    expect(result.status).toBe("error");
    expect(result.code).toBe("UNSUPPORTED_CHATKIT_ACTION");
  });

  it("validates product ownership before returning navigation actions", async () => {
    const registry = createRegistry({
      product: {
        productGid: "gid://shopify/Product/1",
        handle: "core-linen-trouser",
      },
    });

    const result = await handleChatKitAction(baseContext, {
      action: {
        type: "open_evidence",
        payload: {
          productRef: "core-linen-trouser",
          source: "Returns",
        },
      },
    }, {
      toolRegistry: registry,
    });

    expect(result).toEqual({
      status: "success",
      action: {
        type: "navigate",
        url: "/app/products/core-linen-trouser/evidence?source=Returns",
      },
    });
    expect(registry.executeAiTool).toHaveBeenCalledWith(
      PRODUCT_PULSE_AI_TOOL_NAMES.getProductRiskDetail,
      expect.objectContaining({ shop: baseContext.shop }),
      { productRef: "core-linen-trouser" },
    );
  });

  it("rejects navigation for products not available in the authenticated shop", async () => {
    const result = await handleChatKitAction(baseContext, {
      action: {
        type: "open_product",
        payload: { productRef: "other-shop-product" },
      },
    }, {
      toolRegistry: createRegistry({ productFound: false }),
    });

    expect(result.status).toBe("error");
    expect(result.code).toBe("NOT_FOUND");
  });

  it("rejects invalid session payloads with tenant identifiers", () => {
    const parsed = aiChatKitSessionRequestSchema.safeParse({
      shop: "evil.myshopify.com",
      pageContext: { type: "dashboard" },
    });

    expect(parsed.success).toBe(false);
  });
});

function enabledConfig() {
  return {
    enabled: true,
    apiKeyConfigured: true,
    workflowId: "wf_product_pulse",
    workflowVersion: null,
    debug: false,
    sessionTtlSeconds: 600,
    rateLimitPerMinute: 10,
    recentThreadCount: 10,
    disabledReason: null,
  };
}

function chatKitClient(sessionCreate) {
  return {
    beta: {
      chatkit: {
        sessions: {
          create: sessionCreate,
        },
      },
    },
  };
}

function chatKitSession() {
  return {
    id: "cksess_1",
    object: "chatkit.session",
    client_secret: "client-secret",
    expires_at: 1810000000,
    status: "active",
    user: "pp_user",
    max_requests_per_1_minute: 10,
    rate_limits: { max_requests_per_1_minute: 10 },
    workflow: { id: "wf_product_pulse" },
    chatkit_configuration: {
      automatic_thread_titling: { enabled: true },
      file_upload: { enabled: false, max_file_size: null, max_files: null },
      history: { enabled: true, recent_threads: 10 },
    },
  };
}

function createRegistry({ productFound = true, product = {} } = {}) {
  return {
    executeAiTool: vi.fn().mockResolvedValue(productFound
      ? {
          ok: true,
          toolName: PRODUCT_PULSE_AI_TOOL_NAMES.getProductRiskDetail,
          data: {
            product: {
              productGid: "gid://shopify/Product/1",
              handle: "core-linen-trouser",
              ...product,
            },
          },
          metadata: { resultCount: 1 },
        }
      : {
          ok: false,
          toolName: PRODUCT_PULSE_AI_TOOL_NAMES.getProductRiskDetail,
          error: { code: "NOT_FOUND", message: "Not found." },
          metadata: { resultCount: 0 },
        }),
  };
}

class InMemoryConversationStore {
  constructor() {
    this.conversations = [];
    this.messages = [];
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
    };
    this.messages.push(message);
    return message;
  }

  async listRecentMessages() {
    return [];
  }

  async recordToolCall() {}

  async touchConversation() {}
}
