/* eslint-env node */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/db.server", () => ({ default: {} }));
vi.mock("../../app/shopify.server", () => ({
  authenticate: {
    admin: vi.fn(),
  },
  unauthenticated: {
    admin: vi.fn(),
  },
}));
vi.mock("../../app/lib/product-pulse-jobs.server.js", () => ({
  queueProductDiagnosisForShop: vi.fn(),
  runSelectedProductDiagnosesForShop: vi.fn(),
  recordProductDetailActionForShop: vi.fn(),
  deleteProductAnalysisForShop: vi.fn(),
}));
vi.mock("../../app/lib/product-pulse-watchlist.server.js", () => ({
  addWatchedProductForShop: vi.fn(),
  removeWatchedProductForShop: vi.fn(),
  getActiveWatchedProductsForShop: vi.fn(),
}));

const {
  createAiActionRegistry,
} = await import("../../app/ai/actions/registry.server");
const {
  PRODUCT_PULSE_AI_ACTION_NAMES,
} = await import("../../app/ai/actions/productPulseActions.server");
const {
  handleChatKitAction,
} = await import("../../app/ai/chatkit/actions.server");

const context = {
  shop: "shop-a.myshopify.com",
  userId: "user-1",
  conversationId: "conversation-1",
  sessionId: "session-1",
  createdAt: "2026-05-20T12:00:00.000Z",
};

describe("ProductPulse AI internal action registry", () => {
  it("creates tenant-scoped action proposals without accepting tenant input", async () => {
    const { registry, store, productRepository } = createActionRegistry();

    const result = await registry.createAiActionProposal(
      context,
      PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist,
      { productRef: "core-linen-trouser", reason: "High risk" },
    );

    expect(result.ok).toBe(true);
    expect(result.data.proposal).toMatchObject({
      shop: context.shop,
      actionName: PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist,
      targetId: "gid://shopify/Product/1",
      status: "pending",
    });
    expect(productRepository.getProductRiskDetail).toHaveBeenCalledWith(
      expect.objectContaining({ shop: context.shop }),
      "core-linen-trouser",
      expect.any(Object),
    );
    expect(store.auditLogs.map((log) => log.eventType)).toEqual(["proposed"]);
  });

  it("rejects unknown action names and invalid tenant override input", async () => {
    const { registry, services } = createActionRegistry();

    const unknown = await registry.createAiActionProposal(context, "raw_shopify_mutation", {});
    expect(unknown.ok).toBe(false);
    expect(unknown.error.code).toBe("UNKNOWN_AI_ACTION");

    const invalid = await registry.createAiActionProposal(
      context,
      PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist,
      { productRef: "core-linen-trouser", shop: "evil.myshopify.com" },
    );
    expect(invalid.ok).toBe(false);
    expect(invalid.error.code).toBe("VALIDATION_ERROR");
    expect(services.addWatchedProductForShop).not.toHaveBeenCalled();
  });

  it("accepts productGid aliases from AI product cards and normalizes the stored proposal input", async () => {
    const { registry, productRepository } = createActionRegistry();

    const result = await registry.createAiActionProposal(
      context,
      PRODUCT_PULSE_AI_ACTION_NAMES.runProductDiagnosis,
      { productGid: "gid://shopify/Product/1", reason: "Refresh this product from the dashboard card." },
    );

    expect(result.ok).toBe(true);
    expect(productRepository.getProductRiskDetail).toHaveBeenCalledWith(
      expect.objectContaining({ shop: context.shop }),
      "gid://shopify/Product/1",
      expect.any(Object),
    );
    expect(result.data.proposal.proposedInput).toEqual({
      productRef: "gid://shopify/Product/1",
      reason: "Refresh this product from the dashboard card.",
    });
  });

  it("confirms a proposal by reloading stored input and ignores tampered ChatKit payload fields", async () => {
    const { registry, services } = createActionRegistry();
    const proposalResult = await registry.createAiActionProposal(
      context,
      PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist,
      { productRef: "core-linen-trouser" },
    );

    const result = await handleChatKitAction(context, {
      action: {
        type: "confirm_ai_action",
        payload: {
          proposalId: proposalResult.data.proposal.id,
          productRef: "tampered-product",
          message: "use this instead",
        },
      },
    }, {
      actionRegistry: registry,
    });

    expect(result.status).toBe("success");
    expect(result.action.type).toBe("assistant_response");
    expect(result.action.blocks[0]).toMatchObject({
      type: "action_result",
      status: "success",
      targetLabel: "Core Linen Trouser",
    });
    expect(JSON.stringify(result.action.blocks[0])).not.toContain("tampered-product");
    expect(JSON.stringify(result.action.blocks[0])).not.toContain(context.shop);
    expect(services.addWatchedProductForShop).toHaveBeenCalledWith(context.shop, {
      productGid: "gid://shopify/Product/1",
      title: "Core Linen Trouser",
      handle: "core-linen-trouser",
    });
  });

  it("cancels a proposal from a ChatKit payload containing only proposalId", async () => {
    const { registry, store, services } = createActionRegistry();
    const proposalResult = await registry.createAiActionProposal(
      context,
      PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist,
      { productRef: "core-linen-trouser" },
    );

    const result = await handleChatKitAction(context, {
      action: {
        type: "cancel_ai_action",
        payload: {
          proposalId: proposalResult.data.proposal.id,
        },
      },
    }, {
      actionRegistry: registry,
    });

    expect(result.status).toBe("success");
    expect(result.action.type).toBe("assistant_response");
    expect(result.action.blocks[0]).toMatchObject({
      type: "action_result",
      status: "cancelled",
      targetLabel: "Core Linen Trouser",
    });
    expect(store.proposals.get(proposalResult.data.proposal.id).status).toBe("cancelled");
    expect(services.addWatchedProductForShop).not.toHaveBeenCalled();
  });

  it("prevents cross-tenant proposal confirmation", async () => {
    const { registry, services } = createActionRegistry();
    const proposalResult = await registry.createAiActionProposal(
      context,
      PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist,
      { productRef: "core-linen-trouser" },
    );

    const result = await registry.confirmAiActionProposal({
      ...context,
      shop: "other-shop.myshopify.com",
    }, proposalResult.data.proposal.id);

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("ACTION_PROPOSAL_NOT_FOUND");
    expect(services.addWatchedProductForShop).not.toHaveBeenCalled();
  });

  it("does not execute expired or already executed proposals", async () => {
    const { registry, store, services } = createActionRegistry();
    const expired = await registry.createAiActionProposal(
      context,
      PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist,
      { productRef: "core-linen-trouser" },
    );
    store.proposals.get(expired.data.proposal.id).expiresAt = "2026-05-20T11:59:00.000Z";

    const expiredResult = await registry.confirmAiActionProposal(context, expired.data.proposal.id);
    expect(expiredResult.ok).toBe(false);
    expect(expiredResult.error.code).toBe("ACTION_PROPOSAL_EXPIRED");

    const pending = await registry.createAiActionProposal(
      context,
      PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist,
      { productRef: "core-linen-trouser" },
    );
    const first = await registry.confirmAiActionProposal(context, pending.data.proposal.id);
    const second = await registry.confirmAiActionProposal(context, pending.data.proposal.id);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.error.code).toBe("ACTION_PROPOSAL_NOT_PENDING");
    expect(services.addWatchedProductForShop).toHaveBeenCalledTimes(1);
  });

  it("queues internal diagnosis jobs and watchlist refresh jobs without Shopify mutation authority", async () => {
    const { registry, services } = createActionRegistry();

    const diagnosis = await registry.createAiActionProposal(
      context,
      PRODUCT_PULSE_AI_ACTION_NAMES.runProductDiagnosis,
      { productRef: "core-linen-trouser" },
    );
    const watchlist = await registry.createAiActionProposal(
      context,
      PRODUCT_PULSE_AI_ACTION_NAMES.runWatchlistDiagnoses,
      {},
    );

    await registry.confirmAiActionProposal(context, diagnosis.data.proposal.id);
    await registry.confirmAiActionProposal(context, watchlist.data.proposal.id);

    expect(services.queueProductDiagnosisForShop).toHaveBeenCalledWith(
      context.shop,
      "gid://shopify/Product/1",
    );
    expect(services.runSelectedProductDiagnosesForShop).toHaveBeenCalledWith(
      context.shop,
      ["gid://shopify/Product/1"],
    );
  });

  it("marks recommended internal actions without apply mode or Shopify writes", async () => {
    const { registry, services } = createActionRegistry();

    const proposal = await registry.createAiActionProposal(
      context,
      PRODUCT_PULSE_AI_ACTION_NAMES.markRecommendedAction,
      {
        productRef: "core-linen-trouser",
        actionId: "fix-size-chart",
        status: "dismissed",
      },
    );
    const result = await registry.confirmAiActionProposal(context, proposal.data.proposal.id);

    expect(result.ok).toBe(true);
    expect(services.recordProductDetailActionForShop).toHaveBeenCalledWith(
      context.shop,
      "gid://shopify/Product/1",
      "fix-size-chart",
      { actionStatus: "dismissed" },
    );
    expect(JSON.stringify(services.recordProductDetailActionForShop.mock.calls[0][3])).not.toContain("applyMode");
  });

  it("archives only ProductPulse internal Product Diagnosis records", async () => {
    const { registry, services } = createActionRegistry();
    const proposal = await registry.createAiActionProposal(
      context,
      PRODUCT_PULSE_AI_ACTION_NAMES.archiveInternalProductAnalysis,
      { productRef: "core-linen-trouser" },
    );

    const result = await registry.confirmAiActionProposal(context, proposal.data.proposal.id);

    expect(result.ok).toBe(true);
    expect(services.deleteProductAnalysisForShop).toHaveBeenCalledWith(
      context.shop,
      "gid://shopify/Product/1",
    );
    expect(result.data.execution.safeMessage).toContain("removed");
  });

  it("stores audit logs for proposal and execution lifecycle", async () => {
    const { registry, store } = createActionRegistry();
    const proposal = await registry.createAiActionProposal(
      context,
      PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist,
      { productRef: "core-linen-trouser" },
    );

    await registry.confirmAiActionProposal(context, proposal.data.proposal.id);

    expect(store.auditLogs.map((log) => log.eventType)).toEqual([
      "proposed",
      "confirmed",
      "executed",
    ]);
    expect(store.auditLogs.every((log) => log.context.shop === context.shop)).toBe(true);
  });

  it("returns safe errors when an internal service fails", async () => {
    const { registry } = createActionRegistry({
      services: {
        addWatchedProductForShop: vi.fn().mockResolvedValue({
          status: "error",
          message: "database password leaked stack trace",
        }),
      },
    });
    const proposal = await registry.createAiActionProposal(
      context,
      PRODUCT_PULSE_AI_ACTION_NAMES.addToWatchlist,
      { productRef: "core-linen-trouser" },
    );

    const result = await registry.confirmAiActionProposal(context, proposal.data.proposal.id);

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "ACTION_EXECUTION_ERROR",
      message: "ProductPulse could not complete that action.",
    });
    expect(JSON.stringify(result)).not.toContain("database password leaked stack trace");
  });
});

function createActionRegistry(overrides = {}) {
  const store = overrides.store || new InMemoryActionProposalStore();
  const productRepository = overrides.productRepository || {
    getProductRiskDetail: vi.fn().mockImplementation((ctx, productRef) => {
      if (ctx.shop !== context.shop || productRef === "missing-product") return null;
      return productFixture({ productRef });
    }),
  };
  const services = {
    queueProductDiagnosisForShop: vi.fn().mockResolvedValue({
      status: "success",
      message: "Diagnosis queued.",
      job: { id: "job-diagnosis-1" },
    }),
    runSelectedProductDiagnosesForShop: vi.fn().mockResolvedValue({
      status: "success",
      message: "Watchlist Product Diagnosis queued.",
      queuedCount: 1,
      jobs: [{ id: "job-watchlist-1" }],
    }),
    recordProductDetailActionForShop: vi.fn().mockResolvedValue({
      status: "success",
      message: "Recommendation updated.",
    }),
    deleteProductAnalysisForShop: vi.fn().mockResolvedValue({
      status: "success",
      message: "ProductPulse analysis removed.",
      deleted: { snapshots: 1 },
    }),
    addWatchedProductForShop: vi.fn().mockResolvedValue({
      status: "success",
      message: "Product added to watchlist.",
    }),
    removeWatchedProductForShop: vi.fn().mockResolvedValue({
      status: "success",
      message: "Product removed from watchlist.",
    }),
    getActiveWatchedProductsForShop: vi.fn().mockResolvedValue([
      {
        productGid: "gid://shopify/Product/1",
        productTitle: "Core Linen Trouser",
      },
    ]),
    ...overrides.services,
  };
  const registry = createAiActionRegistry({
    proposalStore: store,
    productPulse: {
      productRepository,
      services,
    },
    now: () => new Date("2026-05-20T12:00:00.000Z"),
  });
  return { registry, store, productRepository, services };
}

function productFixture() {
  return {
    productGid: "gid://shopify/Product/1",
    title: "Core Linen Trouser",
    handle: "core-linen-trouser",
    primaryIssue: "Sizing complaints are rising.",
    diagnosis: {
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

class InMemoryActionProposalStore {
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
      reason: draft.reason || null,
      expectedResult: draft.expectedResult || null,
      risks: draft.risks || [],
      status: "pending",
      result: undefined,
      safeError: null,
      createdAt: now,
      updatedAt: now,
      expiresAt: draft.expiresAt.toISOString(),
      confirmedAt: null,
      cancelledAt: null,
      executedAt: null,
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

  async updateProposalStatus(input) {
    const proposal = this.proposals.get(input.proposalId);
    if (!proposal || proposal.shop !== input.context.shop) return null;
    if (input.allowedCurrentStatuses?.length && !input.allowedCurrentStatuses.includes(proposal.status)) {
      return null;
    }
    Object.assign(proposal, {
      status: input.status,
      updatedAt: "2026-05-20T12:00:00.000Z",
    });
    if (input.result !== undefined) proposal.result = input.result;
    if (input.safeError !== undefined) proposal.safeError = input.safeError;
    if (input.confirmedAt !== undefined) proposal.confirmedAt = input.confirmedAt?.toISOString() || null;
    if (input.cancelledAt !== undefined) proposal.cancelledAt = input.cancelledAt?.toISOString() || null;
    if (input.executedAt !== undefined) proposal.executedAt = input.executedAt?.toISOString() || null;
    return proposal;
  }

  async logAudit(input) {
    this.auditLogs.push(input);
  }
}
