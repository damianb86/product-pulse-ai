/* eslint-env node */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../app/db.server", () => ({ default: {} }));
vi.mock("../../app/shopify.server", () => ({ authenticate: { admin: vi.fn() } }));

const {
  ProductPulseAiRepository,
  ProductPulseWatchlistAiRepository,
} = await import("../../app/ai/repositories/productPulseAiRepository.server");
const {
  createAiToolRegistry,
} = await import("../../app/ai/tools/registry.server");
const {
  PRODUCT_PULSE_AI_TOOL_NAMES,
} = await import("../../app/ai/tools/productPulseTools.server");

const context = {
  shop: "shop-a.myshopify.com",
  userId: "user-1",
  createdAt: "2026-05-20T12:00:00.000Z",
};

describe("ProductPulse AI data repositories", () => {
  it("scopes product list queries by server context and returns compact safe summaries", async () => {
    const db = createRepositoryDbMock();
    const snapshot = buildSnapshot({
      productGid: "gid://shopify/Product/1",
      productTitle: "Risky product",
      riskScore: 81,
      metrics: {
        returnRate: 22,
        refundRate: 5,
        reviewCount: 12,
        incrementalDiagnosis: {
          cache: {
            sourceEvents: [{ raw: "do not expose" }],
          },
        },
      },
    });
    db.productRiskSnapshot.findMany.mockResolvedValue([snapshot]);
    db.productRiskSnapshot.count.mockResolvedValue(1);
    db.productDiagnosis.findMany.mockResolvedValue([
      {
        id: "diagnosis-1",
        productGid: snapshot.productGid,
        status: "Completed",
        riskScore: 83,
        confidence: 91,
        likelyCause: "Fit issue",
        completedAt: new Date("2026-05-18T12:00:00.000Z"),
      },
    ]);
    db.productWatchlistItem.findMany.mockResolvedValue([{ productGid: snapshot.productGid, status: "Watching" }]);

    const repository = new ProductPulseAiRepository(db);
    const result = await repository.listProductRiskSummaries(context, { limit: 99 });

    expect(db.productRiskSnapshot.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ shop: context.shop }),
      take: expect.any(Number),
    }));
    expect(db.productRiskSnapshot.findMany.mock.calls[0][0].take).toBeLessThanOrEqual(75);
    expect(db.productDiagnosis.findMany.mock.calls[0][0].where.shop).toBe(context.shop);
    expect(db.productWatchlistItem.findMany.mock.calls[0][0].where.shop).toBe(context.shop);
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({
      productGid: snapshot.productGid,
      riskScore: 83,
      riskLabel: "High",
      latestDiagnosisId: "diagnosis-1",
      isWatched: true,
    });
    expect(result.products[0]).not.toHaveProperty("shop");
    expect(result.products[0].metrics).not.toHaveProperty("incrementalDiagnosis");
    expect(JSON.stringify(result.products[0])).not.toContain("do not expose");
  });

  it("returns bounded product detail without raw payloads or long evidence dumps", async () => {
    const db = createRepositoryDbMock();
    const longEvidence = "x".repeat(800);
    const snapshot = buildSnapshot({ productGid: "gid://shopify/Product/2", handle: "safe-product" });
    db.productRiskSnapshot.findFirst.mockResolvedValue(snapshot);
    db.productDiagnosis.findFirst.mockResolvedValue({
      id: "diagnosis-2",
      productGid: snapshot.productGid,
      status: "Completed",
      riskScore: 71,
      confidence: 80,
      likelyCause: "Content issue",
      issues: [{ issue: "Content issue", evidence: [longEvidence], sourceTypes: ["reviews"] }],
      evidence: [{ source: "Reviews", quote: longEvidence, points: [longEvidence] }],
      recommendations: [{
        id: "rewrite-product-description",
        label: "Rewrite product description",
        type: "PDP copy",
        status: "Draft",
        payload: {
          draftText: longEvidence,
          token: "secret-token",
          credentials: "secret-credentials",
        },
      }],
      completedAt: new Date("2026-05-18T12:00:00.000Z"),
      createdAt: new Date("2026-05-18T11:00:00.000Z"),
    });
    db.productAction.findMany.mockResolvedValue([
      {
        id: "action-1",
        actionType: "rewrite-product-description",
        label: "Rewrite product description",
        status: "draft",
        payload: { token: "secret-token", issue: "content" },
      },
    ]);
    db.productWatchlistItem.findUnique.mockResolvedValue(null);
    db.productScoreHistory.findMany.mockResolvedValue([]);

    const repository = new ProductPulseAiRepository(db);
    const detail = await repository.getProductRiskDetail(context, "safe-product", {
      evidenceLimit: 1,
      issueLimit: 1,
      recommendationLimit: 1,
      actionLimit: 1,
    });

    expect(db.productRiskSnapshot.findFirst.mock.calls[0][0].where.shop).toBe(context.shop);
    expect(db.productDiagnosis.findFirst.mock.calls[0][0].where.shop).toBe(context.shop);
    expect(detail.diagnosis.evidence).toHaveLength(1);
    expect(detail.diagnosis.evidence[0].quote.length).toBeLessThanOrEqual(360);
    expect(detail.diagnosis.evidence[0].points[0].length).toBeLessThanOrEqual(260);
    expect(detail.diagnosis.recommendations[0].draftPreview.length).toBeLessThanOrEqual(280);
    expect(JSON.stringify(detail)).not.toContain("secret-token");
    expect(JSON.stringify(detail)).not.toContain("secret-credentials");
  });

  it("does not expose watch alert recipient emails", async () => {
    const db = createRepositoryDbMock();
    db.productWatchlistItem.findMany.mockResolvedValue([]);
    db.productWatchlistItem.count.mockResolvedValue(0);
    db.productWatchSettings.findUnique.mockResolvedValue({
      shop: context.shop,
      scanCadenceDays: 7,
      alertRecipients: ["owner@example.com", "cx@example.com"],
      triggerRule: "new_issue_only",
      summarySchedule: "weekly_monday_8am",
      alertsEnabled: true,
    });
    db.productWatchActivity.findMany.mockResolvedValue([]);
    db.productRiskSnapshot.findMany.mockResolvedValue([]);

    const repository = new ProductPulseWatchlistAiRepository(db);
    const snapshot = await repository.getWatchlistSnapshot(context);

    expect(db.productWatchlistItem.findMany.mock.calls[0][0].where.shop).toBe(context.shop);
    expect(snapshot.alertRecipientCount).toBe(2);
    expect(JSON.stringify(snapshot)).not.toContain("owner@example.com");
    expect(JSON.stringify(snapshot)).not.toContain("cx@example.com");
  });
});

describe("ProductPulse AI tool registry", () => {
  it("normalizes excessive limits and strips tenant override attempts from tool input", async () => {
    const productRepository = {
      listProductRiskSummaries: vi.fn().mockResolvedValue({
        products: [],
        totalCount: 0,
        hasMore: false,
        freshness: [{ source: "ProductPulse", updatedAt: null }],
      }),
    };
    const registry = createRegistryWithRepositories({ productRepository });

    const result = await registry.executeAiTool(
      PRODUCT_PULSE_AI_TOOL_NAMES.listProductRiskSummaries,
      context,
      { limit: 999, shop: "evil-shop.myshopify.com" },
    );

    expect(result.ok).toBe(true);
    expect(productRepository.listProductRiskSummaries).toHaveBeenCalledWith(
      expect.objectContaining({ shop: context.shop }),
      expect.objectContaining({ limit: 25, offset: 0 }),
    );
    expect(productRepository.listProductRiskSummaries.mock.calls[0][1]).not.toHaveProperty("shop");
    expect(result.metadata.limit).toBe(25);
  });

  it("rejects unknown tools with a structured safe error", async () => {
    const registry = createRegistryWithRepositories();

    const result = await registry.executeAiTool("not_a_real_tool", context, {});

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "UNKNOWN_TOOL",
      },
    });
  });

  it("rejects validation failures before repository execution", async () => {
    const productRepository = {
      getProductRiskDetail: vi.fn(),
    };
    const registry = createRegistryWithRepositories({ productRepository });

    const result = await registry.executeAiTool(
      PRODUCT_PULSE_AI_TOOL_NAMES.getProductRiskDetail,
      context,
      {},
    );

    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("VALIDATION_ERROR");
    expect(result.error.validationIssues.length).toBeGreaterThan(0);
    expect(productRepository.getProductRiskDetail).not.toHaveBeenCalled();
  });

  it("returns a safe not-found error for invalid product references", async () => {
    const productRepository = {
      getProductRiskDetail: vi.fn().mockResolvedValue(null),
    };
    const registry = createRegistryWithRepositories({ productRepository });

    const result = await registry.executeAiTool(
      PRODUCT_PULSE_AI_TOOL_NAMES.getProductRiskDetail,
      context,
      { productRef: "missing-product" },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "NOT_FOUND",
    });
    expect(result.error.message).not.toContain(context.shop);
  });

  it("masks raw repository/database errors", async () => {
    const productRepository = {
      listProductRiskSummaries: vi.fn().mockRejectedValue(new Error("database password leaked stack")),
    };
    const registry = createRegistryWithRepositories({ productRepository });

    const result = await registry.executeAiTool(
      PRODUCT_PULSE_AI_TOOL_NAMES.listProductRiskSummaries,
      context,
      { limit: 5 },
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "TOOL_EXECUTION_ERROR",
      message: "The AI data tool could not complete the request.",
    });
    expect(JSON.stringify(result)).not.toContain("database password leaked stack");
  });
});

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

function createRepositoryDbMock() {
  return {
    productRiskSnapshot: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    productDiagnosis: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
    },
    productAction: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    productPulseSource: {
      findUnique: vi.fn().mockResolvedValue({
        config: {
          risk: {
            minimumScore: 10,
            mediumThreshold: 50,
            highThreshold: 75,
          },
        },
      }),
      findMany: vi.fn().mockResolvedValue([]),
    },
    productWatchlistItem: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
    },
    productWatchSettings: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    productWatchActivity: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    productScoreHistory: {
      findMany: vi.fn().mockResolvedValue([]),
    },
  };
}

function buildSnapshot(overrides = {}) {
  return {
    id: "snapshot-1",
    shop: context.shop,
    productGid: "gid://shopify/Product/1",
    productTitle: "Stored product",
    handle: "stored-product",
    riskScore: 66,
    impactScore: 12,
    confidence: 84,
    primaryIssue: "Fit issue",
    sourceCoverage: ["Shopify products", "Shopify returns"],
    metrics: {
      returnRate: 12,
      refundRate: 2,
      reviewRating: 3.7,
      signalCount: 8,
      soldUnits: 30,
    },
    calculatedAt: new Date("2026-05-18T12:00:00.000Z"),
    updatedAt: new Date("2026-05-18T12:00:00.000Z"),
    ...overrides,
  };
}
