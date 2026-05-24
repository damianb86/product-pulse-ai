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
  handleChatKitMessage,
} = await import("../../app/ai/chatkit/message.server");
const {
  chatKitActionRequestSchema,
  handleChatKitAction,
} = await import("../../app/ai/chatkit/actions.server");
const {
  mapAiPresentationBlockToChatKitWidget,
  mapAiPresentationBlocksToChatKitWidgets,
} = await import("../../app/ai/chatkit/widgets");
const {
  aiAppMutationResultToPresentationBlock,
} = await import("../../app/ai/appMutations/presentation");
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
        toolRegistry: createRegistry(),
      },
    });

    expect(result.enabled).toBe(true);
    expect(result.client_secret).toBeUndefined();
    expect(result.apiUrl).toBe("/api/ai/chatkit/message");
    expect(result.domainKey).toBe("domain_pk_test");
    expect(store.contexts[0].shop).toBe("auth-shop.myshopify.com");
    expect(JSON.stringify(result)).not.toContain("auth-shop.myshopify.com");
  });

  it("returns a disabled response without requiring AI_CHATKIT_WORKFLOW_ID when OpenAI is not configured", async () => {
    const store = new InMemoryConversationStore();

    const result = await createAiChatKitSession(baseContext, {}, {
      config: {
        ...enabledConfig(),
        enabled: false,
        apiKeyConfigured: false,
        disabledReason: "ChatKit requires OPENAI_API_KEY on the server.",
      },
      conversationStore: store,
      toolRegistry: createRegistry(),
    });

    expect(result.enabled).toBe(false);
    expect(result.message).toContain("OPENAI_API_KEY");
    expect(store.messages[0].role).toBe("system");
  });

  it("sanitizes unverified product page context before creating a session", async () => {
    const registry = createRegistry({ productFound: false });

    const result = await createAiChatKitSession(baseContext, {
      pageContext: {
        type: "product",
        entityId: "gid://shopify/Product/other-shop",
      },
    }, {
      config: enabledConfig(),
      conversationStore: new InMemoryConversationStore(),
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

  it("routes ChatKit custom backend messages through the existing orchestrator", async () => {
    const store = new InMemoryConversationStore();
    const orchestrator = {
      runAiChatTurnWithContext: vi.fn().mockResolvedValue({
        conversationId: "conversation-1",
        messageId: "message-2",
        userMessageId: "message-1",
        assistantText: "This product is high risk.",
        blocks: [{ type: "summary", title: "Summary", text: "Returns mention sizing." }],
        suggestedReplies: [],
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
      }),
    };
    store.conversations.push({
      id: "conversation-1",
      shop: baseContext.shop,
      userId: baseContext.userId,
      title: "ProductPulse AI assistant",
      createdAt: "2026-05-20T12:00:00.000Z",
      updatedAt: "2026-05-20T12:00:00.000Z",
    });

    const response = await handleChatKitMessage(baseContext, JSON.stringify({
      type: "threads.create",
      metadata: {
        conversationId: "conversation-1",
        pageContext: { type: "product", entityId: "core-linen-trouser" },
        shop: "evil.myshopify.com",
      },
      params: {
        input: {
          content: [{ type: "input_text", text: "Explain this product" }],
          attachments: [],
          inference_options: {},
        },
      },
    }), {
      conversationStore: store,
      orchestrator,
      toolRegistry: createRegistry(),
      now: () => new Date("2026-05-20T12:00:00.000Z"),
    });

    const text = await response.text();
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(orchestrator.runAiChatTurnWithContext).toHaveBeenCalledWith(
      expect.objectContaining({ shop: baseContext.shop }),
      expect.objectContaining({
        conversationId: "conversation-1",
        message: "Explain this product",
        userIntentMetadata: expect.objectContaining({ source: "chatkit_custom_backend" }),
      }),
    );
    expect(text).toContain("\"thread.created\"");
    expect(text).toContain("\"assistant_message\"");
    expect(text).toContain("\"assistant_message.content_part.text_delta\"");
    expect(text).toContain("\"annotations\":[]");
    expect(text).toContain("\"end_of_turn\"");
    expect(text).toContain("\"widget\"");
    expect(text).not.toContain("evil.myshopify.com");
  });

  it("normalizes oversized ChatKit history limits instead of rejecting history requests", async () => {
    const store = new InMemoryConversationStore();
    store.conversations.push({
      id: "conversation-1",
      shop: baseContext.shop,
      userId: baseContext.userId,
      title: "Existing conversation",
      createdAt: "2026-05-20T12:00:00.000Z",
      updatedAt: "2026-05-20T12:00:00.000Z",
    });

    const response = await handleChatKitMessage(baseContext, JSON.stringify({
      type: "threads.list",
      params: {
        limit: 9999,
        order: "desc",
      },
      metadata: {
        source: "chatkit_custom_backend",
        conversationId: "conversation-1",
        pageContext: { type: "product", entityId: "gid://shopify/Product/1" },
      },
    }), {
      conversationStore: store,
      now: () => new Date("2026-05-20T12:00:00.000Z"),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].id).toBe("conversation-1");
    expect(store.listConversationInputs[0].limit).toBe(50);
  });

  it("accepts common ChatKit thread id aliases when loading a conversation", async () => {
    const store = new InMemoryConversationStore();
    store.conversations.push({
      id: "conversation-1",
      shop: baseContext.shop,
      userId: baseContext.userId,
      title: "Existing conversation",
      createdAt: "2026-05-20T12:00:00.000Z",
      updatedAt: "2026-05-20T12:00:00.000Z",
    });

    const response = await handleChatKitMessage(baseContext, JSON.stringify({
      type: "threads.get_by_id",
      params: {
        id: "conversation-1",
      },
      metadata: {
        source: "chatkit_custom_backend",
      },
    }), {
      conversationStore: store,
      now: () => new Date("2026-05-20T12:00:00.000Z"),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.id).toBe("conversation-1");
  });

  it("streams navigation widget actions as client effects instead of assistant text", async () => {
    const store = new InMemoryConversationStore();
    store.conversations.push({
      id: "conversation-1",
      shop: baseContext.shop,
      userId: baseContext.userId,
      title: "ProductPulse AI assistant",
      createdAt: "2026-05-20T12:00:00.000Z",
      updatedAt: "2026-05-20T12:00:00.000Z",
    });

    const response = await handleChatKitMessage(baseContext, JSON.stringify({
      type: "threads.custom_action",
      metadata: { pageContext: { type: "product", entityId: "core-linen-trouser" } },
      params: {
        thread_id: "conversation-1",
        item_id: "widget-1",
        action: {
          type: "open_product",
          payload: { productRef: "core-linen-trouser" },
        },
      },
    }), {
      conversationStore: store,
      toolRegistry: createRegistry({
        product: {
          productGid: "gid://shopify/Product/1",
          handle: "core-linen-trouser",
        },
      }),
      now: () => new Date("2026-05-20T12:00:00.000Z"),
    });

    const text = await response.text();
    expect(text).toContain("\"client_effect\"");
    expect(text).toContain("\"product_pulse.navigate\"");
    expect(text).toContain("\"/app/products/core-linen-trouser\"");
    expect(text).not.toContain("Opening that view in ProductPulse");
  });

  it("renders confirmed internal actions as deterministic result widgets without calling the orchestrator", async () => {
    const store = new InMemoryConversationStore();
    store.conversations.push({
      id: "conversation-1",
      shop: baseContext.shop,
      userId: baseContext.userId,
      title: "ProductPulse AI assistant",
      createdAt: "2026-05-20T12:00:00.000Z",
      updatedAt: "2026-05-20T12:00:00.000Z",
    });
    const orchestrator = {
      runAiChatTurnWithContext: vi.fn(),
    };
    const actionRegistry = {
      confirmAiActionProposal: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          proposal: actionProposalFixture(),
          execution: actionExecutionFixture(),
        },
      }),
    };

    const response = await handleChatKitMessage(baseContext, JSON.stringify({
      type: "threads.custom_action",
      metadata: { pageContext: { type: "product", entityId: "core-linen-trouser" } },
      params: {
        thread_id: "conversation-1",
        item_id: "widget-1",
        action: {
          type: "confirm_ai_action",
          payload: { proposalId: "proposal-1" },
        },
      },
    }), {
      conversationStore: store,
      orchestrator,
      actionRegistry,
      now: () => new Date("2026-05-20T12:00:00.000Z"),
    });

    const text = await response.text();
    expect(actionRegistry.confirmAiActionProposal).toHaveBeenCalledWith(
      expect.objectContaining({ shop: baseContext.shop }),
      "proposal-1",
    );
    expect(orchestrator.runAiChatTurnWithContext).not.toHaveBeenCalled();
    expect(text).toContain("\"assistant_message.content_part.text_delta\"");
    expect(text).toContain("\"widget\"");
    expect(text).toContain("\"Action completed\"");
    expect(text).toContain("\"Product added to watchlist.\"");
    expect(text).not.toContain("chatkit_custom_backend_action");
    expect(JSON.stringify(store.messages)).toContain("action_result");
  });

  it("accepts ChatKit editable app mutation submissions through the message endpoint", async () => {
    const store = new InMemoryConversationStore();
    store.conversations.push({
      id: "conversation-1",
      shop: baseContext.shop,
      userId: baseContext.userId,
      title: "ProductPulse AI assistant",
      createdAt: "2026-05-20T12:00:00.000Z",
      updatedAt: "2026-05-20T12:00:00.000Z",
    });
    const appMutationRegistry = {
      saveAiAppMutation: vi.fn().mockResolvedValue({
        ok: true,
        data: {
          proposal: {
            targetLabel: "Mona Lisa",
            sideEffectLevel: "medium",
          },
          result: {
            mutationName: "product_pulse_update_recommended_action_draft",
            status: "success",
            summary: "Recommended action updated in ProductPulse.",
            safeMessage: "Recommended action updated in ProductPulse. Shopify was not modified.",
            affectedEntities: [{
              type: "product",
              id: "gid://shopify/Product/8631416979535",
              label: "Mona Lisa",
            }],
            savedRecordId: "product-action-1",
          },
        },
      }),
    };

    const response = await handleChatKitMessage(baseContext, JSON.stringify({
      type: "threads.custom_action",
      metadata: {
        source: "chatkit_custom_backend",
        conversationId: "conversation-1",
        pageContext: {
          type: "product",
          entityId: "gid://shopify/Product/8631416979535",
          entityHandle: "mona-lisa-leonardo-da-vinci",
          filters: {},
        },
      },
      params: {
        thread_id: "conversation-1",
        item_id: "ai_msg_widget-1",
        action: {
          type: "save_ai_app_mutation",
          payload: {
            proposalId: "proposal-1",
            title: "Add text to end of description",
            description: "AI-regenerated app-owned action text.",
            draftText: "Lleva a tu espacio una de las obras mas reconocibles del mundo.",
            field: "",
            descriptionOperation: "prepend",
            priority: "medium",
          },
        },
      },
    }), {
      conversationStore: store,
      appMutationRegistry,
      now: () => new Date("2026-05-20T12:00:00.000Z"),
    });

    const text = await response.text();
    expect(appMutationRegistry.saveAiAppMutation).toHaveBeenCalledWith(
      expect.objectContaining({ shop: baseContext.shop }),
      "proposal-1",
      {
        title: "Add text to end of description",
        description: "AI-regenerated app-owned action text.",
        draftText: "Lleva a tu espacio una de las obras mas reconocibles del mundo.",
        field: "",
        descriptionOperation: "prepend",
        priority: "medium",
      },
    );
    expect(text).toContain("\"assistant_message.content_part.text_delta\"");
    expect(text).toContain("\"widget\"");
    expect(text).toContain("Recommended action updated in ProductPulse");
    expect(text).not.toContain("ChatKit action request is invalid");
  });

  it("adds open-product and open-action buttons to saved app mutation result widgets", () => {
    const productDraftBlock = aiAppMutationResultToPresentationBlock({
      mutationName: "product_pulse_create_product_description_draft",
      status: "success",
      summary: "ProductPulse action saved.",
      safeMessage: "ProductPulse action saved. Shopify was not modified.",
      affectedEntities: [{
        type: "product",
        id: "gid://shopify/Product/8631416979535",
        label: "Mona Lisa",
      }],
      savedRecordId: "proposal-1",
    });
    const productWidget = mapAiPresentationBlockToChatKitWidget(productDraftBlock);
    expect(JSON.stringify(productWidget)).toContain("\"label\":\"Open product\"");
    expect(JSON.stringify(productWidget)).toContain("\"type\":\"open_product\"");
    expect(JSON.stringify(productWidget)).toContain("\"productRef\":\"gid://shopify/Product/8631416979535\"");

    const actionDraftBlock = aiAppMutationResultToPresentationBlock({
      mutationName: "product_pulse_create_product_action",
      status: "success",
      summary: "ProductPulse action saved.",
      safeMessage: "ProductPulse action saved. Shopify was not modified.",
      affectedEntities: [
        {
          type: "product",
          id: "gid://shopify/Product/8631416979535",
          label: "Mona Lisa",
        },
        {
          type: "product_action",
          id: "product-action-1",
          label: "Add text to end of description",
        },
      ],
      savedRecordId: "product-action-1",
      savedData: {
        sourceActionId: "rewrite-product-description",
      },
    });
    const actionWidget = mapAiPresentationBlockToChatKitWidget(actionDraftBlock);
    expect(JSON.stringify(actionWidget)).toContain("\"label\":\"Open action\"");
    expect(JSON.stringify(actionWidget)).toContain("\"type\":\"open_recommendation\"");
    expect(JSON.stringify(actionWidget)).toContain("\"recommendationId\":\"rewrite-product-description\"");
  });

  it("converts neutral presentation blocks into ChatKit widgets", () => {
    const longEvidence = "A".repeat(320);
    const widgets = mapAiPresentationBlocksToChatKitWidgets([
      {
        type: "summary",
        title: "Summary",
        text: "Risk is elevated because returns and reviews point to the same product quality issue.",
      },
      {
        type: "product_reference",
        title: "Core Linen Trouser",
      },
      {
        type: "diagnosis_summary",
        title: "Diagnosis",
        likelyCause: null,
        issues: [],
      },
      {
        type: "evidence_list",
        productGid: "gid://shopify/Product/1",
        title: "Evidence",
        items: [
          { source: "Returns", quote: longEvidence, weight: "High signal" },
          { source: "Reviews", quote: "Customer says sizing failed twice.", weight: "Review signal" },
          { source: "Refunds", quote: "Refund pressure is above baseline.", weight: "Refund signal" },
          { source: "Support", quote: "Support tickets mention fit issues.", weight: "Support signal" },
          { source: "AI evidence synthesis", quote: "Evidence aligns across sources.", weight: "Synthesis signal" },
          { source: "Customer language", quote: "Repeated phrase appears in complaints.", weight: "Language signal" },
        ],
      },
      {
        type: "metric_table",
        title: "Metrics",
        rows: [{ label: "Return rate", value: "12%", detail: "Above store baseline" }],
      },
      {
        type: "return_refund_resolution",
        productGid: "gid://shopify/Product/1",
        returnAndRefundCount: 2,
        returnOnlyCount: 4,
        refundOnlyCount: 1,
        unattributedCount: 0,
        attributionConfidence: "High",
        interpretation: "Returns are leading to attributed refunds.",
      },
      {
        type: "purchase_context",
        productGid: "gid://shopify/Product/1",
        soloPurchaseRate: 72.2,
        avgQuantityPerOrder: 1.4,
        multiVariantRate: 16.7,
        confidence: "High",
        interpretation: "This product is usually bought alone.",
      },
      {
        type: "quantity_distribution",
        productGid: "gid://shopify/Product/1",
        buckets: [
          { label: "1 unit", count: 12, rate: 66.7 },
          { label: "2 units", count: 4, rate: 22.2 },
        ],
      },
      {
        type: "co_purchase_summary",
        productGid: "gid://shopify/Product/1",
        items: [{ title: "Care Kit", coOrderCount: 6, coOrderRate: 33.3, affinityScore: 2.1 }],
      },
      {
        type: "product_relationship_summary",
        productGid: "gid://shopify/Product/1",
        confidence: "Medium",
        interpretation: "Care Kit is a same-order relationship candidate for merchandising review.",
        riskImpact: "Returns are higher when bought with Compatibility Kit, so review the pairing as context only.",
        opportunityImpact: "Care Kit may support a bundle review.",
        items: [
          {
            title: "Care Kit",
            direction: "together",
            relationshipStrength: "strong",
            timeWindow: "same order",
            lift: 2.4,
            confidence: "Medium",
            sampleSize: 8,
          },
          {
            title: "Compatibility Kit",
            direction: "together",
            relationshipStrength: "moderate",
            lift: 1.8,
            confidence: "Medium",
            sampleSize: 4,
            deltaReturnRate: 12.5,
          },
        ],
      },
      {
        type: "product_relationship_timeline",
        productGid: "gid://shopify/Product/1",
        currentProductTitle: "Core Linen Trouser",
        before: [{ title: "Starter Guide", timeWindow: "30d before", relationshipRate: 18, lift: 3.2, confidence: "Medium" }],
        together: [{ title: "Care Kit", attachRate: 24, lift: 2.4, confidence: "High" }],
        after: [{ title: "Refill Pack", timeWindow: "30d after", relationshipRate: 21, lift: 4.1, confidence: "High" }],
      },
      {
        type: "product_relationship_risk",
        productGid: "gid://shopify/Product/1",
        relatedProductTitle: "Compatibility Kit",
        returnDelta: 14,
        refundDelta: 4,
        confidence: "Medium",
        summary: "Returns are higher when this product is bought with Compatibility Kit.",
        recommendation: "Review compatibility messaging for this pairing.",
        caveat: "Association only.",
      },
      {
        type: "product_relationship_opportunity",
        productGid: "gid://shopify/Product/1",
        relatedProductTitle: "Refill Pack",
        opportunityType: "cross_sell",
        timing: "30d after",
        lift: 4.1,
        confidence: "High",
        summary: "Refill Pack is a follow-on cross-sell candidate.",
        caveat: "Use as merchandising context.",
      },
      {
        type: "purchase_context_risk_impact",
        productGid: "gid://shopify/Product/1",
        riskImpact: "Solo-purchase behavior strengthens product-specific attribution.",
        confidenceImpact: "Diagnosis confidence is higher because the product is often bought alone.",
        financialExposureImpact: "Bulk or multi-unit orders increase potential unit exposure.",
      },
      {
        type: "entity_list",
        title: "High risk products",
        items: [{
          entityType: "product",
          id: "gid://shopify/Product/1",
          title: "Core Linen Trouser",
          subtitle: "Primary issue: sizing",
          productGid: "gid://shopify/Product/1",
          handle: "core-linen-trouser",
          status: "Active",
          riskScore: 82,
          riskLabel: "High",
        }],
      },
      {
        type: "recommendation_list",
        productGid: "gid://shopify/Product/1",
        title: "Recommended actions",
        items: [{
          id: "rec-1",
          label: "Review sizing guidance",
          status: "active",
          issue: "Sizing",
          effort: "Low",
          draftPreview: "Clarify fit guidance on the product page.",
        }],
      },
      {
        type: "unavailable_state",
        title: "No watchlist data",
        message: "The watchlist is empty.",
        nextStep: "Add products to the watchlist before asking for watchlist trends.",
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
      {
        type: "action_result",
        actionName: "product_pulse_add_to_watchlist",
        status: "success",
        title: "Action completed",
        summary: "Product added to watchlist.",
        targetLabel: "Core Linen Trouser",
        sideEffectLevel: "low",
        affectedEntities: [{
          type: "product",
          id: "gid://shopify/Product/1",
          label: "Core Linen Trouser",
        }],
        createdJobId: null,
      },
    ]);

    expect(widgets.map((widget) => widget.type)).toEqual(["Card", "Card", "Card", "ListView", "Card", "Card", "Card", "Card", "Card", "Card", "Card", "Card", "Card", "Card", "Card", "Card", "Card", "Card", "Card"]);
    expect(widgets.filter((widget) => widget.type === "Card").every((widget) => widget.size === "full")).toBe(true);
    expect(JSON.stringify(widgets)).toContain("#4C1D95");
    expect(JSON.stringify(widgets)).toContain("open_product");
    expect(JSON.stringify(widgets)).toContain("open_evidence_source");
    expect(JSON.stringify(widgets)).toContain("review_action");
    expect(JSON.stringify(widgets)).toContain("prepare_apply_action");
    expect(JSON.stringify(widgets)).toContain("Return & refund resolution");
    expect(JSON.stringify(widgets)).toContain("Return + refund");
    expect(JSON.stringify(widgets)).toContain("Purchase context");
    expect(JSON.stringify(widgets)).toContain("Co-purchased products");
    expect(JSON.stringify(widgets)).toContain("Product relationships");
    expect(JSON.stringify(widgets)).toContain("Product relationship timeline");
    expect(JSON.stringify(widgets)).toContain("Relationship risk context");
    expect(JSON.stringify(widgets)).toContain("Cross-sell opportunity");
    expect(JSON.stringify(widgets)).toContain("Care Kit");
    expect(JSON.stringify(widgets)).toContain("Compatibility Kit");
    expect(JSON.stringify(widgets)).toContain("Refill Pack");
    expect(JSON.stringify(widgets)).toContain("Solo-purchase behavior");
    expect(JSON.stringify(widgets)).toContain("confirm_ai_action");
    expect(JSON.stringify(widgets)).toContain("cancel_ai_action");
    expect(JSON.stringify(widgets)).toContain("Action completed");
    expect(JSON.stringify(widgets)).not.toContain("\"type\":\"Table");
    expect(JSON.stringify(widgets)).not.toContain(longEvidence);
  });

  it("renders recommended actions as detailed rows with review actions", () => {
    const widget = mapAiPresentationBlockToChatKitWidget({
      type: "recommendation_list",
      productGid: "gid://shopify/Product/1",
      title: "Recommended actions",
      items: Array.from({ length: 8 }, (_, index) => ({
        id: `rec-${index + 1}`,
        label: `Recommended action ${index + 1}`,
        status: index % 2 === 0 ? "active" : "reviewed",
        issue: `Issue ${index + 1}`,
        effort: "Low",
        draftPreview: "Explain what this action would change before the merchant reviews it.",
      })),
    });

    expect(widget.type).toBe("Card");
    expect(JSON.stringify(widget)).toContain("Recommended action 8");
    expect(JSON.stringify(widget)).toContain("Review");
    expect(JSON.stringify(widget)).toContain("\"type\":\"review_action\"");
    expect(JSON.stringify(widget)).toContain("\"type\":\"prepare_apply_action\"");
    expect(JSON.stringify(widget)).toContain("\"action_id\":\"rec-8\"");
  });

  it("falls back safely for unsupported presentation blocks without leaking raw JSON", () => {
    const widget = mapAiPresentationBlockToChatKitWidget({
      type: "future_card",
      internalSecret: "do-not-render",
    });

    expect(widget.type).toBe("Card");
    expect(JSON.stringify(widget)).toContain("Unsupported assistant card");
    expect(JSON.stringify(widget)).toContain("future_card");
    expect(JSON.stringify(widget)).not.toContain("do-not-render");
  });

  it("keeps action confirmation widget payloads limited to proposal IDs", () => {
    const widget = mapAiPresentationBlockToChatKitWidget({
      type: "action_proposal",
      proposalId: "proposal-1",
      actionName: "product_pulse_archive_internal_product_analysis",
      title: "Remove ProductPulse analysis",
      summary: "Remove app-owned analysis records.",
      targetType: "product",
      targetId: "gid://shopify/Product/1",
      targetLabel: "Core Linen Trouser",
      reason: "Merchant requested cleanup.",
      expectedResult: "ProductPulse records will be removed. Shopify product data will not be changed.",
      risks: ["This cannot be undone from the assistant."],
      confirmationLevel: "high",
      sideEffectLevel: "high",
      reversible: false,
      expiresAt: "2026-05-20T12:15:00.000Z",
    });

    expect(widget.confirm).toEqual({
      label: "Apply change",
      action: { type: "confirm_ai_action", payload: { proposalId: "proposal-1" } },
    });
    expect(widget.cancel).toEqual({
      label: "Cancel",
      action: { type: "cancel_ai_action", payload: { proposalId: "proposal-1" } },
    });
    expect(JSON.stringify(widget.confirm)).not.toContain("product_pulse_archive_internal_product_analysis");
    expect(JSON.stringify(widget.cancel)).not.toContain("gid://shopify/Product/1");
    expect(JSON.stringify(widget)).toContain("\"value\":\"Reason\"");
    expect(JSON.stringify(widget)).not.toContain("\"width\":78");
  });

  it("renders user-provided text as widget text, not HTML or markdown components", () => {
    const widget = mapAiPresentationBlockToChatKitWidget({
      type: "summary",
      title: "<strong>Summary</strong>",
      text: "<script>alert('x')</script> Product needs review.",
    });

    const serialized = JSON.stringify(widget);
    expect(serialized).toContain("\"type\":\"Text\"");
    expect(serialized).not.toContain("\"type\":\"Markdown\"");
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

  it("validates product ownership before returning recommendation modal navigation", async () => {
    const registry = createRegistry({
      product: {
        productGid: "gid://shopify/Product/1",
        handle: "core-linen-trouser",
      },
    });

    const result = await handleChatKitAction(baseContext, {
      action: {
        type: "open_recommendation",
        payload: {
          productRef: "core-linen-trouser",
          recommendationId: "rewrite-product-description",
        },
      },
    }, {
      toolRegistry: registry,
    });

    expect(result).toEqual({
      status: "success",
      action: {
        type: "navigate",
        url: "/app/products/core-linen-trouser?assistantAction=open_recommendation&recommendationId=rewrite-product-description",
      },
    });
    expect(registry.executeAiTool).toHaveBeenCalledWith(
      PRODUCT_PULSE_AI_TOOL_NAMES.getProductRiskDetail,
      expect.objectContaining({ shop: baseContext.shop }),
      { productRef: "core-linen-trouser" },
    );
  });

  it("accepts card-template action aliases without trusting tenant payloads", async () => {
    expect(chatKitActionRequestSchema.safeParse({
      action: {
        type: "prepare_apply_action",
        payload: {
          product_id: "core-linen-trouser",
          action_id: "rewrite-product-description",
        },
      },
    }).success).toBe(true);

    const registry = createRegistry({
      product: {
        productGid: "gid://shopify/Product/1",
        handle: "core-linen-trouser",
      },
    });

    const result = await handleChatKitAction(baseContext, {
      action: {
        type: "prepare_apply_action",
        payload: {
          product_id: "core-linen-trouser",
          action_id: "rewrite-product-description",
        },
      },
    }, {
      toolRegistry: registry,
    });

    expect(result).toEqual({
      status: "success",
      action: {
        type: "navigate",
        url: "/app/products/core-linen-trouser?assistantAction=open_recommendation&recommendationId=rewrite-product-description",
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
    apiUrl: "/api/ai/chatkit/message",
    domainKey: "domain_pk_test",
    debug: false,
    recentThreadCount: 10,
    disabledReason: null,
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

function actionProposalFixture() {
  return {
    id: "proposal-1",
    shop: baseContext.shop,
    userId: baseContext.userId,
    conversationId: "conversation-1",
    actionName: "product_pulse_add_to_watchlist",
    category: "watchlist",
    targetType: "product",
    targetId: "gid://shopify/Product/1",
    targetLabel: "Core Linen Trouser",
    proposedInput: { productRef: "core-linen-trouser" },
    title: "Add to ProductPulse watchlist",
    summary: "Add Core Linen Trouser to the ProductPulse watchlist.",
    reason: "High risk",
    expectedResult: "ProductPulse will create a watchlist row. Shopify product data will not be changed.",
    risks: [],
    confirmationLevel: "low",
    sideEffectLevel: "low",
    reversible: true,
    requiresEntityOwnershipCheck: true,
    status: "executed",
    result: null,
    safeError: null,
    createdAt: "2026-05-20T12:00:00.000Z",
    updatedAt: "2026-05-20T12:00:00.000Z",
    expiresAt: "2026-05-20T12:15:00.000Z",
    confirmedAt: "2026-05-20T12:01:00.000Z",
    cancelledAt: null,
    executedAt: "2026-05-20T12:01:00.000Z",
  };
}

function actionExecutionFixture() {
  return {
    actionName: "product_pulse_add_to_watchlist",
    status: "success",
    summary: "Product added to watchlist.",
    affectedEntities: [{
      type: "product",
      id: "gid://shopify/Product/1",
      label: "Core Linen Trouser",
    }],
    createdJobId: null,
    updatedData: null,
    safeMessage: "Product added to watchlist.",
  };
}

class InMemoryConversationStore {
  constructor() {
    this.conversations = [];
    this.messages = [];
    this.contexts = [];
    this.listConversationInputs = [];
  }

  async getConversation(context, conversationId) {
    return this.conversations.find((conversation) => conversation.id === conversationId && conversation.shop === context.shop) || null;
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

  async listConversations(context, input = {}) {
    this.listConversationInputs.push(input);
    const conversations = this.conversations
      .filter((conversation) => conversation.shop === context.shop)
      .slice(0, input.limit || 20);
    return { conversations, hasMore: false, after: null };
  }

  async updateConversationTitle(context, conversationId, title) {
    const conversation = await this.getConversation(context, conversationId);
    if (!conversation) return null;
    conversation.title = title;
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

  async listMessages(context, conversationId) {
    return {
      messages: this.messages.filter((message) => message.conversationId === conversationId),
      hasMore: false,
      after: null,
    };
  }

  async recordToolCall() {}

  async touchConversation() {}
}
