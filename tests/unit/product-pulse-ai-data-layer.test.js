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

  it("returns compact relationship and financial exposure summaries for one scoped product", async () => {
    const db = createRepositoryDbMock();
    const snapshot = buildSnapshot({
      productGid: "gid://shopify/Product/relationship",
      handle: "relationship-product",
      metrics: {
        soldUnits: 19,
        salesAmount: 800,
        refundAmount: 84,
        returnRefundRelationshipSummary: relationshipSummaryFixture({
          sold_units: 19,
          sold_orders: 14,
          returned_units: 6,
          returned_orders: 5,
          refunded_units: 2,
          refunded_orders: 2,
          returned_and_refunded_units: 2,
          returned_not_refunded_units: 4,
          attributed_refund_amount: 84,
          refund_amount_with_return: 84,
          total_product_revenue: 800,
          relationship_match_confidence_avg: 1,
        }),
        financialExposureBreakdown: {
          hasRelationshipSummary: true,
          confirmedRefundAmount: 84,
          estimatedFutureRefundFromReturnOnlyCases: 180,
          returnRelatedRiskAmount: 180,
          relationshipAdjustedRefundAmount: 264,
        },
      },
    });
    db.productRiskSnapshot.findFirst.mockResolvedValue(snapshot);

    const repository = new ProductPulseAiRepository(db);
    const relationship = await repository.getReturnRefundRelationshipSummary(context, "relationship-product");
    const resolution = await repository.getProductReturnRefundResolution(context, "relationship-product");
    const exposure = await repository.getProductFinancialExposureBreakdown(context, "relationship-product");

    expect(db.productRiskSnapshot.findFirst.mock.calls[0][0].where.shop).toBe(context.shop);
    expect(relationship.relationship).toMatchObject({
      available: true,
      returnedAndRefundedUnits: 2,
      returnedNotRefundedUnits: 4,
      returnRateUnits: 31.6,
      attributionConfidence: "High",
    });
    expect(resolution.matrix).toEqual({
      returnYesRefundYes: 2,
      returnYesRefundNo: 4,
      returnNoRefundYes: 0,
    });
    expect(exposure.financialExposure).toMatchObject({
      confirmedRefundAmount: 84,
      returnRelatedRiskAmount: 180,
      estimatedExposure: 264,
    });
    expect(JSON.stringify(relationship)).not.toContain("shop-a.myshopify.com");
  });

  it("returns compact purchase context summaries and risk impact for one scoped product", async () => {
    const db = createRepositoryDbMock();
    const snapshot = buildSnapshot({
      productGid: "gid://shopify/Product/purchase-context",
      handle: "purchase-context-product",
      metrics: {
        productPurchaseContextSummary: {
          total_orders_containing_product: 18,
          total_units_sold: 26,
          total_revenue_if_available: 1200,
          solo_product_order_count: 13,
          multi_product_order_count: 5,
          single_unit_order_count: 12,
          multi_unit_order_count: 6,
          bulk_order_count: 1,
          multi_variant_order_count: 3,
          avg_product_quantity_per_order: 1.4,
          avg_distinct_products_per_order: 1.8,
          solo_purchase_rate: 13 / 18,
          multi_product_basket_rate: 5 / 18,
          single_unit_purchase_rate: 12 / 18,
          multi_unit_purchase_rate: 6 / 18,
          bulk_purchase_rate: 1 / 18,
          multi_variant_order_rate: 3 / 18,
          purchase_context_confidence: 86,
          purchase_context_confidence_label: "High",
          quantity_distribution: {
            one_unit_count: 12,
            two_unit_count: 4,
            three_unit_count: 1,
            four_plus_unit_count: 1,
            one_unit_rate: 12 / 18,
            two_unit_rate: 4 / 18,
            three_unit_rate: 1 / 18,
            four_plus_unit_rate: 1 / 18,
          },
          top_co_purchased_products: [{
            productId: "gid://shopify/Product/care-kit",
            title: "Care Kit",
            co_order_count: 6,
            co_order_rate: 0.333,
            affinity_score: 2.1,
          }],
        },
        productPurchaseContextFactors: {
          hasPurchaseContextSummary: true,
          productRisk: { soloAttributionRisk: 3 },
          diagnosisConfidence: { purchaseContextScore: 6 },
          financialExposure: { bulkQuantityExposure: 25 },
          returnPressure: { returnRateWhenBoughtWithOthers: 18, returnRateWhenBoughtAlone: 7 },
          refundLeakage: { refundRateWhenBoughtAlone: 3, refundRateWhenBoughtWithOthers: 8 },
        },
        productPurchaseContextScoringImpact: [
          "This product is usually bought alone, so negative signals are easier to attribute to the product.",
        ],
      },
    });
    db.productRiskSnapshot.findFirst.mockResolvedValue(snapshot);

    const repository = new ProductPulseAiRepository(db);
    const summary = await repository.getProductPurchaseContextSummary(context, "purchase-context-product");
    const riskImpact = await repository.getProductPurchaseContextRiskImpact(context, "purchase-context-product");

    expect(db.productRiskSnapshot.findFirst.mock.calls[0][0].where.shop).toBe(context.shop);
    expect(summary).toMatchObject({
      available: true,
      totalOrdersContainingProduct: 18,
      soloProductOrderCount: 13,
      soloPurchaseRate: 72.2,
      avgProductQuantityPerOrder: 1.4,
      multiVariantOrderRate: 16.7,
      purchaseContextConfidenceLabel: "High",
    });
    expect(summary.quantityDistribution.oneUnitCount).toBe(12);
    expect(summary.topCoPurchasedProducts[0]).toMatchObject({
      title: "Care Kit",
      coOrderCount: 6,
      coOrderRate: 33.3,
      affinityScore: 2.1,
    });
    expect(riskImpact.purchaseContextRiskImpact.riskImpact).toContain("Solo-purchase behavior");
    expect(riskImpact.purchaseContextRiskImpact.financialExposureImpact).toContain("Bulk or multi-unit orders");
    expect(JSON.stringify(summary)).not.toContain("shop-a.myshopify.com");
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

  it("exposes return/refund AI tools as read-only scoped compact summaries", async () => {
    const productRepository = {
      getReturnRefundRelationshipSummary: vi.fn().mockResolvedValue({
        product: { productGid: "gid://shopify/Product/1", updatedAt: "2026-05-20T12:00:00.000Z", calculatedAt: null },
        relationship: { available: false, status: "Refund relationship not matched yet" },
      }),
      getProductReturnRefundResolution: vi.fn().mockResolvedValue({
        productGid: "gid://shopify/Product/1",
        title: "Product",
        handle: "product",
        available: true,
        status: "Relationship matching available",
        matrix: { returnYesRefundYes: 1, returnYesRefundNo: 2, returnNoRefundYes: 0 },
        buckets: { returnAndRefund: 1, returnOnly: 2, refundOnly: 0, exchangeOrReplacement: 0, pendingOrUnknown: 0, unattributedRefundAmount: 0 },
        rates: { returnedUnitsRefunded: 33.3, refundsWithoutReturn: 0, refundAttribution: 100 },
        attributionConfidence: "High",
        interpretation: "Returns are leading to attributed refunds.",
      }),
      getProductFinancialExposureBreakdown: vi.fn().mockResolvedValue({
        product: { productGid: "gid://shopify/Product/1", updatedAt: null, calculatedAt: null },
        financialExposure: { available: true, confirmedRefundAmount: 84, returnRelatedRiskAmount: 180, estimatedExposure: 264 },
      }),
    };
    const registry = createRegistryWithRepositories({ productRepository });

    const relationshipResult = await registry.executeAiTool(
      PRODUCT_PULSE_AI_TOOL_NAMES.getReturnRefundRelationshipSummary,
      context,
      { productRef: "product", shop: "evil-shop.myshopify.com" },
    );
    const resolutionResult = await registry.executeAiTool(
      PRODUCT_PULSE_AI_TOOL_NAMES.getProductReturnRefundResolution,
      context,
      { productRef: "product" },
    );
    const exposureResult = await registry.executeAiTool(
      PRODUCT_PULSE_AI_TOOL_NAMES.getProductFinancialExposureBreakdown,
      context,
      { productRef: "product" },
    );

    expect(relationshipResult.ok).toBe(true);
    expect(resolutionResult.ok).toBe(true);
    expect(exposureResult.ok).toBe(true);
    expect(productRepository.getReturnRefundRelationshipSummary).toHaveBeenCalledWith(
      expect.objectContaining({ shop: context.shop }),
      "product",
    );
    expect(productRepository.getReturnRefundRelationshipSummary.mock.calls[0][0]).not.toHaveProperty("shop", "evil-shop.myshopify.com");
    expect(resolutionResult.data.resolution.matrix.returnYesRefundYes).toBe(1);
    expect(exposureResult.data.financialExposure.confirmedRefundAmount).toBe(84);
  });

  it("exposes purchase context AI tools as read-only scoped compact summaries", async () => {
    const purchaseContext = {
      available: true,
      productGid: "gid://shopify/Product/1",
      title: "Product",
      handle: "product",
      totalOrdersContainingProduct: 18,
      soloPurchaseRate: 72.2,
      avgProductQuantityPerOrder: 1.4,
      multiVariantOrderRate: 16.7,
      quantityDistribution: { oneUnitCount: 12 },
      topCoPurchasedProducts: [{ title: "Care Kit", coOrderCount: 6 }],
      interpretation: "Usually bought alone.",
    };
    const productRepository = {
      getProductPurchaseContextSummary: vi.fn().mockResolvedValue(purchaseContext),
      getProductBasketBehavior: vi.fn().mockResolvedValue(purchaseContext),
      getProductQuantityDistribution: vi.fn().mockResolvedValue(purchaseContext),
      getProductCoPurchaseSummary: vi.fn().mockResolvedValue(purchaseContext),
      getProductPurchaseContextRiskImpact: vi.fn().mockResolvedValue({
        product: { productGid: "gid://shopify/Product/1", updatedAt: null, calculatedAt: null },
        purchaseContextRiskImpact: {
          available: true,
          riskImpact: "Solo-purchase behavior strengthens product-specific attribution.",
          confidenceImpact: "Diagnosis confidence is higher because the product is often bought alone.",
        },
      }),
    };
    const registry = createRegistryWithRepositories({ productRepository });

    const summaryResult = await registry.executeAiTool(
      PRODUCT_PULSE_AI_TOOL_NAMES.getProductPurchaseContextSummary,
      context,
      { productRef: "product", shop: "evil-shop.myshopify.com" },
    );
    const basketResult = await registry.executeAiTool(PRODUCT_PULSE_AI_TOOL_NAMES.getProductBasketBehavior, context, { productRef: "product" });
    const quantityResult = await registry.executeAiTool(PRODUCT_PULSE_AI_TOOL_NAMES.getProductQuantityDistribution, context, { productRef: "product" });
    const coPurchaseResult = await registry.executeAiTool(PRODUCT_PULSE_AI_TOOL_NAMES.getProductCoPurchaseSummary, context, { productRef: "product" });
    const riskImpactResult = await registry.executeAiTool(PRODUCT_PULSE_AI_TOOL_NAMES.getProductPurchaseContextRiskImpact, context, { productRef: "product" });

    expect(summaryResult.ok).toBe(true);
    expect(basketResult.ok).toBe(true);
    expect(quantityResult.ok).toBe(true);
    expect(coPurchaseResult.ok).toBe(true);
    expect(riskImpactResult.ok).toBe(true);
    expect(productRepository.getProductPurchaseContextSummary).toHaveBeenCalledWith(
      expect.objectContaining({ shop: context.shop }),
      "product",
    );
    expect(productRepository.getProductPurchaseContextSummary.mock.calls[0][0]).not.toHaveProperty("shop", "evil-shop.myshopify.com");
    expect(summaryResult.data.purchaseContext.soloPurchaseRate).toBe(72.2);
    expect(coPurchaseResult.data.purchaseContext.topCoPurchasedProducts[0].title).toBe("Care Kit");
    expect(riskImpactResult.data.purchaseContextRiskImpact.riskImpact).toContain("Solo-purchase");
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
        getReturnRefundRelationshipSummary: vi.fn().mockResolvedValue(null),
        getProductReturnRefundResolution: vi.fn().mockResolvedValue(null),
        getProductFinancialExposureBreakdown: vi.fn().mockResolvedValue(null),
        getProductPurchaseContextSummary: vi.fn().mockResolvedValue(null),
        getProductBasketBehavior: vi.fn().mockResolvedValue(null),
        getProductQuantityDistribution: vi.fn().mockResolvedValue(null),
        getProductCoPurchaseSummary: vi.fn().mockResolvedValue(null),
        getProductPurchaseContextRiskImpact: vi.fn().mockResolvedValue(null),
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

function relationshipSummaryFixture(overrides = {}) {
  const summary = {
    sold_units: 10,
    sold_orders: 8,
    returned_units: 0,
    returned_orders: 0,
    refunded_units: 0,
    refunded_orders: 0,
    returned_and_refunded_units: 0,
    returned_not_refunded_units: 0,
    refunded_without_return_units: 0,
    exchange_or_replacement_units: 0,
    pending_return_units: 0,
    unattributed_refund_amount: 0,
    attributed_refund_amount: 0,
    refund_amount_with_return: 0,
    refund_amount_without_return: 0,
    total_product_revenue: 1000,
    relationship_match_confidence_avg: 0,
    relationship_match_confidence_min: 0,
    relationship_unknown_count: 0,
    relationship_buckets: {},
    ...overrides,
  };
  summary.return_rate_units = summary.sold_units ? summary.returned_units / summary.sold_units : 0;
  summary.return_to_refund_rate = summary.returned_units ? summary.returned_and_refunded_units / summary.returned_units : 0;
  summary.refund_without_return_rate = summary.sold_units ? summary.refunded_without_return_units / summary.sold_units : 0;
  summary.refund_rate_revenue = summary.total_product_revenue ? summary.attributed_refund_amount / summary.total_product_revenue : 0;
  summary.refund_attribution_rate = 1;
  return summary;
}
