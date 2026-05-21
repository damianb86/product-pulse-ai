/* eslint-env node */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/db.server", () => ({ default: {} }));
vi.mock("../../app/shopify.server", () => ({
  authenticate: {
    admin: vi.fn(),
  },
}));

const {
  createAiAppMutationRegistry,
} = await import("../../app/ai/appMutations/registry.server");
const {
  PRODUCT_PULSE_AI_APP_MUTATION_NAMES,
} = await import("../../app/ai/appMutations/productPulseAppMutations.server");
const {
  handleChatKitAction,
} = await import("../../app/ai/chatkit/actions.server");
const {
  mapAiPresentationBlockToChatKitWidget,
} = await import("../../app/ai/chatkit/widgets");
const {
  aiAppMutationProposalToPresentationBlock,
} = await import("../../app/ai/appMutations/presentation");

const context = {
  shop: "shop-a.myshopify.com",
  userId: "user-1",
  conversationId: "conversation-1",
  sessionId: "session-1",
  createdAt: "2026-05-20T12:00:00.000Z",
};

describe("ProductPulse AI app-only mutation registry", () => {
  it("creates tenant-scoped editable app draft proposals without accepting tenant input", async () => {
    const { registry, store, productRepository } = createAppMutationRegistry();

    const result = await registry.createAiAppMutationProposal(
      context,
      PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductDescriptionDraft,
      {
        productRef: "core-linen-trouser",
        text: "Clarify fit and care before purchase.",
        reason: "Sizing complaints",
      },
    );

    expect(result.ok).toBe(true);
    expect(result.data.proposal).toMatchObject({
      shop: context.shop,
      mutationName: PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductDescriptionDraft,
      targetId: "gid://shopify/Product/1",
      status: "draft",
      draftType: "product_description",
    });
    expect(productRepository.getProductRiskDetail).toHaveBeenCalledWith(
      expect.objectContaining({ shop: context.shop }),
      "core-linen-trouser",
      expect.any(Object),
    );
    expect(store.auditLogs.map((log) => log.eventType)).toEqual(["proposed"]);

    const invalid = await registry.createAiAppMutationProposal(
      context,
      PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductDescriptionDraft,
      {
        productRef: "core-linen-trouser",
        text: "Valid draft.",
        shop: "evil.myshopify.com",
      },
    );
    expect(invalid.ok).toBe(false);
    expect(invalid.error.code).toBe("VALIDATION_ERROR");
  });

  it("saves edited product description drafts server-side only", async () => {
    const { registry, store, db } = createAppMutationRegistry();
    const proposal = await registry.createAiAppMutationProposal(
      context,
      PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductDescriptionDraft,
      {
        productRef: "core-linen-trouser",
        text: "Initial AI draft.",
      },
    );

    const result = await registry.saveAiAppMutationDraft(
      context,
      proposal.data.proposal.id,
      { text: "Merchant edited app-only draft." },
    );

    expect(result.ok).toBe(true);
    expect(result.data.result.safeMessage).toContain("ProductPulse");
    expect(result.data.result.safeMessage).toContain("Shopify was not modified");
    expect(store.proposals.get(proposal.data.proposal.id)).toMatchObject({
      status: "saved",
      userEditedValue: { text: "Merchant edited app-only draft." },
    });
    expect(db.productAction.create).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("evil.myshopify.com");
  });

  it("creates app-owned recommended action records without Shopify apply mode", async () => {
    const { registry, db } = createAppMutationRegistry();
    const proposal = await registry.createAiAppMutationProposal(
      context,
      PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createRecommendedAction,
      {
        productRef: "core-linen-trouser",
        title: "Review sizing guidance",
        description: "Clarify product fit expectations before purchase.",
        priority: "high",
      },
    );

    const result = await registry.saveAiAppMutationDraft(context, proposal.data.proposal.id, {
      title: "Review sizing guidance",
      description: "Clarify product fit expectations before purchase.",
      priority: "high",
      status: "draft",
    });

    expect(result.ok).toBe(true);
    expect(db.productAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        shop: context.shop,
        productGid: "gid://shopify/Product/1",
        status: "draft",
        payload: expect.objectContaining({
          source: "ai_app_only_draft",
          shopifyMutationBlocked: true,
        }),
      }),
    });
    const serializedCall = JSON.stringify(db.productAction.create.mock.calls[0]);
    expect(serializedCall).not.toContain("applyMode");
    expect(serializedCall).not.toContain("admin.graphql");
  });

  it("rejects arbitrary metafields and accepts allowlisted app-only metafield drafts", async () => {
    const { registry } = createAppMutationRegistry();

    const rejected = await registry.createAiAppMutationProposal(
      context,
      PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createMetafieldValueDraft,
      {
        productRef: "core-linen-trouser",
        namespace: "custom",
        key: "unsafe",
        type: "single_line_text_field",
        value: "Do not allow arbitrary metafields.",
      },
    );
    expect(rejected.ok).toBe(false);
    expect(rejected.error.message).toContain("allowlisted");

    const allowed = await registry.createAiAppMutationProposal(
      context,
      PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createMetafieldValueDraft,
      {
        productRef: "core-linen-trouser",
        namespace: "productpulse",
        key: "faq_html",
        type: "multi_line_text_field",
        value: "<p>FAQ draft saved in app only.</p>",
      },
    );
    expect(allowed.ok).toBe(true);

    const saved = await registry.saveAiAppMutationDraft(context, allowed.data.proposal.id, {
      value: "<p>Edited FAQ draft saved in app only.</p>",
    });
    expect(saved.ok).toBe(true);
    expect(saved.data.result.safeMessage).toContain("Shopify was not modified");
  });

  it("prevents cross-tenant and expired proposal saves", async () => {
    const { registry, store, db } = createAppMutationRegistry();
    const proposal = await registry.createAiAppMutationProposal(
      context,
      PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductDescriptionDraft,
      {
        productRef: "core-linen-trouser",
        text: "Draft text.",
      },
    );

    const crossTenant = await registry.saveAiAppMutationDraft({
      ...context,
      shop: "other-shop.myshopify.com",
    }, proposal.data.proposal.id, { text: "Tampered" });
    expect(crossTenant.ok).toBe(false);
    expect(crossTenant.error.code).toBe("APP_MUTATION_PROPOSAL_NOT_FOUND");

    store.proposals.get(proposal.data.proposal.id).expiresAt = "2026-05-20T11:59:00.000Z";
    const expired = await registry.saveAiAppMutationDraft(context, proposal.data.proposal.id, { text: "Late edit" });
    expect(expired.ok).toBe(false);
    expect(expired.error.code).toBe("APP_MUTATION_PROPOSAL_EXPIRED");
    expect(db.productAction.create).not.toHaveBeenCalled();
  });

  it("saves ChatKit app draft actions through proposalId and ignores tampered product fields", async () => {
    const { registry, db } = createAppMutationRegistry();
    const proposal = await registry.createAiAppMutationProposal(
      context,
      PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createRecommendedAction,
      {
        productRef: "core-linen-trouser",
        title: "Clarify fit",
        description: "Add app-owned guidance only.",
      },
    );

    const result = await handleChatKitAction(context, {
      action: {
        type: "save_ai_app_draft",
        payload: {
          proposalId: proposal.data.proposal.id,
          productRef: "tampered-product",
          title: "Edited title",
          description: "Edited app-only action.",
          priority: "medium",
          status: "draft",
        },
      },
    }, {
      appMutationRegistry: registry,
    });

    expect(result.status).toBe("success");
    expect(result.action.type).toBe("assistant_response");
    expect(result.action.blocks[0]).toMatchObject({
      type: "app_draft_result",
      status: "success",
      targetLabel: "Core Linen Trouser",
    });
    expect(db.productAction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        productGid: "gid://shopify/Product/1",
        label: "Edited title",
      }),
    });
    expect(JSON.stringify(result.action.blocks[0])).not.toContain("tampered-product");
  });

  it("renders editable draft cards with safe save/cancel payloads", async () => {
    const { registry } = createAppMutationRegistry();
    const proposal = await registry.createAiAppMutationProposal(
      context,
      PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductDescriptionDraft,
      {
        productRef: "core-linen-trouser",
        text: "Editable app-only draft.",
      },
    );
    const block = aiAppMutationProposalToPresentationBlock(proposal.data.proposal);
    const widget = mapAiPresentationBlockToChatKitWidget(block);

    expect(widget.type).toBe("Card");
    expect(JSON.stringify(widget)).toContain("\"type\":\"Form\"");
    expect(JSON.stringify(widget)).toContain("\"type\":\"Textarea\"");
    expect(JSON.stringify(widget)).toContain("\"type\":\"save_ai_app_draft\"");
    expect(JSON.stringify(widget)).toContain("\"type\":\"cancel_ai_app_draft\"");
    expect(JSON.stringify(widget)).toContain("\"proposalId\":\"proposal-1\"");
    expect(JSON.stringify(widget)).not.toContain("gid://shopify/Product/1\"");
    expect(JSON.stringify(widget)).not.toContain(context.shop);
  });
});

function createAppMutationRegistry(overrides = {}) {
  const store = overrides.store || new InMemoryAppMutationProposalStore();
  const productRepository = overrides.productRepository || {
    getProductRiskDetail: vi.fn().mockImplementation((ctx, productRef) => {
      if (ctx.shop !== context.shop || productRef === "missing-product") return null;
      return productFixture();
    }),
  };
  let actionId = 1;
  const db = overrides.db || {
    productDiagnosis: {
      findFirst: vi.fn().mockResolvedValue({ id: "diagnosis-1" }),
    },
    productAction: {
      create: vi.fn().mockImplementation(async ({ data }) => ({
        id: `product-action-${actionId++}`,
        ...data,
      })),
    },
  };
  const registry = createAiAppMutationRegistry({
    proposalStore: store,
    productPulse: {
      productRepository,
      db,
      env: {},
    },
    now: () => new Date("2026-05-20T12:00:00.000Z"),
    env: {},
  });
  return { registry, store, productRepository, db };
}

function productFixture() {
  return {
    productGid: "gid://shopify/Product/1",
    title: "Core Linen Trouser",
    handle: "core-linen-trouser",
    riskScore: 82,
    primaryIssue: "Sizing complaints",
    latestDiagnosisId: "diagnosis-1",
    diagnosis: {
      evidence: [{ id: "ev-1", source: "Reviews" }],
      recommendations: [
        {
          id: "fix-size-chart",
          label: "Review size chart",
          type: "internal_review",
          status: "active",
          effort: "low",
          issue: "Sizing complaints",
          draftPreview: null,
          payloadSummary: {},
        },
      ],
    },
    actionHistory: [],
  };
}

class InMemoryAppMutationProposalStore {
  constructor() {
    this.proposals = new Map();
    this.auditLogs = [];
    this.nextId = 1;
  }

  async createProposal(ctx, draft) {
    const now = "2026-05-20T12:00:00.000Z";
    const proposal = {
      id: `proposal-${this.nextId}`,
      shop: ctx.shop,
      userId: ctx.userId || null,
      conversationId: ctx.conversationId || null,
      ...draft,
      targetLabel: draft.targetLabel || null,
      sourceContext: draft.sourceContext || null,
      currentAppValueSnapshot: draft.currentAppValueSnapshot || null,
      userEditedValue: null,
      finalDraftValue: null,
      generatedReason: draft.generatedReason || null,
      evidenceReferences: draft.evidenceReferences || null,
      validationWarnings: draft.validationWarnings || [],
      editableFields: draft.editableFields || [],
      allowedFields: draft.allowedFields || [],
      blockedFields: draft.blockedFields || [],
      status: "draft",
      safeError: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: draft.expiresAt.toISOString(),
      savedAt: null,
      cancelledAt: null,
    };
    this.nextId += 1;
    this.proposals.set(proposal.id, proposal);
    return proposal;
  }

  async getProposal(ctx, proposalId) {
    const proposal = this.proposals.get(proposalId);
    if (!proposal || proposal.shop !== ctx.shop) return null;
    return proposal;
  }

  async updateProposal(input) {
    const proposal = this.proposals.get(input.proposalId);
    if (!proposal || proposal.shop !== input.context.shop) return null;
    if (input.allowedCurrentStatuses?.length && !input.allowedCurrentStatuses.includes(proposal.status)) {
      return null;
    }
    Object.assign(proposal, {
      status: input.status || proposal.status,
      updatedAt: "2026-05-20T12:00:00.000Z",
    });
    if (input.userEditedValue !== undefined) proposal.userEditedValue = input.userEditedValue;
    if (input.finalDraftValue !== undefined) proposal.finalDraftValue = input.finalDraftValue;
    if (input.validationWarnings !== undefined) proposal.validationWarnings = input.validationWarnings;
    if (input.safeError !== undefined) proposal.safeError = input.safeError;
    if (input.savedAt !== undefined) proposal.savedAt = input.savedAt?.toISOString() || null;
    if (input.cancelledAt !== undefined) proposal.cancelledAt = input.cancelledAt?.toISOString() || null;
    return proposal;
  }

  async logAudit(input) {
    this.auditLogs.push(input);
  }
}
