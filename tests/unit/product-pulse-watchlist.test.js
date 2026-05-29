import { describe, expect, it } from "vitest";
import {
  WATCHLIST_MAX_PRODUCTS,
  __productPulseWatchlistTestHooks,
  enforceWatchlistPlanLimitForShop,
  getWatchlistLimitContext,
  getWatchlistProductLimitForPlan,
  isProductPulseBetaActive,
} from "../../app/lib/product-pulse-watchlist.server";

describe("ProductPulse watchlist helpers", () => {
  it("allows up to ninety-nine watched products per shop", () => {
    expect(WATCHLIST_MAX_PRODUCTS).toBe(99);
  });

  it("resolves watchlist capacity from plan and beta state", () => {
    expect(getWatchlistProductLimitForPlan("free", { betaActive: true })).toBe(5);
    expect(getWatchlistProductLimitForPlan("free", { betaActive: false })).toBe(1);
    expect(getWatchlistProductLimitForPlan("starter", { betaActive: true })).toBe(10);
    expect(getWatchlistProductLimitForPlan("starter", { betaActive: false })).toBe(5);
    expect(getWatchlistProductLimitForPlan("growth", { betaActive: true })).toBe(25);
    expect(getWatchlistProductLimitForPlan("pro", { betaActive: true })).toBe(50);
    expect(getWatchlistProductLimitForPlan("premium", { betaActive: true })).toBe(99);
  });

  it("treats beta as active by default and allows env override", () => {
    expect(isProductPulseBetaActive({})).toBe(true);
    expect(isProductPulseBetaActive({ PRODUCT_PULSE_BETA_ACTIVE: "false" })).toBe(false);
    expect(getWatchlistLimitContext({ env: { PRODUCT_PULSE_PLAN_KEY: "starter", PRODUCT_PULSE_BETA_ACTIVE: "0" } })).toMatchObject({
      planKey: "starter",
      planName: "Starter",
      betaActive: false,
      maxProducts: 5,
    });
  });

  it("removes products beyond the active plan limit and keeps the oldest items", async () => {
    const db = createWatchlistLimitTestDb([
      buildWatchlistLimitItem(1),
      buildWatchlistLimitItem(2),
      buildWatchlistLimitItem(3),
      buildWatchlistLimitItem(4),
      buildWatchlistLimitItem(5),
      buildWatchlistLimitItem(6),
    ]);

    const result = await enforceWatchlistPlanLimitForShop("test-shop.myshopify.com", {
      db,
      planKey: "free",
      betaActive: true,
      recordActivity: false,
    });

    expect(result).toMatchObject({
      planKey: "free",
      betaActive: true,
      maxProducts: 5,
      removedCount: 1,
    });
    expect(result.items.map((item) => item.productGid)).toEqual([
      "gid://shopify/Product/1",
      "gid://shopify/Product/2",
      "gid://shopify/Product/3",
      "gid://shopify/Product/4",
      "gid://shopify/Product/5",
    ]);
    expect(db.state.items.map((item) => item.productGid)).toEqual([
      "gid://shopify/Product/1",
      "gid://shopify/Product/2",
      "gid://shopify/Product/3",
      "gid://shopify/Product/4",
      "gid://shopify/Product/5",
    ]);
  });

  it("labels watchlist row risk with configured ProductPulse thresholds", () => {
    const row = __productPulseWatchlistTestHooks.formatWatchlistRow(
      {
        id: "watch-1",
        productGid: "gid://shopify/Product/1",
        productTitle: "Watched product",
        handle: "watched-product",
        status: "Watching",
        addedAt: new Date("2026-05-01T12:00:00.000Z"),
        updatedAt: new Date("2026-05-02T12:00:00.000Z"),
      },
      {
        productGid: "gid://shopify/Product/1",
        riskScore: 63,
        primaryIssue: "Stored signal",
        updatedAt: new Date("2026-05-03T12:00:00.000Z"),
        metrics: {},
      },
      {
        risk: {
          minimumScore: 20,
          mediumThreshold: 70,
          highThreshold: 90,
        },
      },
    );

    expect(row.riskScore).toBe(63);
    expect(row.riskLabel).toBe("Low");
    expect(row.riskTone).toBe("success");
    expect(row.latestChange).toBe("Stored signal");
    expect(row.latestChangeDetail).toBe("");
  });

  it("uses product-specific row detail before the first Watchlist scan", () => {
    const row = __productPulseWatchlistTestHooks.formatWatchlistRow(
      {
        id: "watch-2",
        productGid: "gid://shopify/Product/2",
        productTitle: "Awaiting product",
        handle: "awaiting-product",
        status: "Watching",
        addedAt: new Date("2026-05-01T12:00:00.000Z"),
        updatedAt: new Date("2026-05-02T12:00:00.000Z"),
      },
      null,
    );

    expect(row.latestChange).toBe("Awaiting first scan");
    expect(row.latestChangeDetail).toBe("Added May 1 · Watching");
  });

  it("labels watchlist trend average with configured ProductPulse thresholds", () => {
    const trend = __productPulseWatchlistTestHooks.buildWatchlistTrend(
      [{
        productGid: "gid://shopify/Product/1",
        title: "Watched product",
        href: "/app/products/watched-product",
        riskScore: 63,
        latestChangeDetail: "Stored signal",
      }],
      new Map([[
        "gid://shopify/Product/1",
        [
          { riskScore: 58, recordedAt: new Date("2026-05-01T12:00:00.000Z"), source: "quickscan" },
          { riskScore: 63, recordedAt: new Date("2026-05-02T12:00:00.000Z"), source: "full-diagnosis" },
        ],
      ]]),
      {
        risk: {
          minimumScore: 20,
          mediumThreshold: 70,
          highThreshold: 90,
        },
      },
    );

    expect(trend.riskScore).toBe(63);
    expect(trend.riskLabel).toBe("Low");
    expect(trend.series[0].riskLabel).toBe("Low");
  });

  it("builds a baseline watch change report when no previous run exists", () => {
    const report = __productPulseWatchlistTestHooks.buildWatchChangeReport({
      snapshot: {
        productGid: "gid://shopify/Product/1",
        riskScore: 63,
        impactScore: 11,
        confidence: 72,
        primaryIssue: "Product quality",
        metrics: { returnRate: 0.12, refundAmount: 218, negativeReviewCount: 3 },
      },
      createdAt: new Date("2026-05-17T10:00:00.000Z"),
    });

    expect(report.status).toBe("baseline");
    expect(report.changeCount).toBe(0);
    expect(report.current.riskScore).toBe(63);
    expect(report.current.refundAmount).toBe(218);
    expect(report.headline).toBe("No previous Watchlist data");
    expect(report.sections).toHaveLength(0);
    expect(report.sourceInsights).toHaveLength(0);
  });

  it("uses a dedicated Watchlist baseline activity event for initial snapshots", () => {
    const event = __productPulseWatchlistTestHooks.getWatchScanActivityEventSpec("watchlist-baseline");

    expect(event).toEqual({
      eventType: "watch_baseline_captured",
      title: "Watchlist baseline captured",
    });
  });

  it("reports only meaningful watchlist changes against the previous run", () => {
    const previousSummary = {
      capturedAt: "2026-05-16T10:00:00.000Z",
      riskScore: 51,
      riskLabel: "Medium",
      confidence: 62,
      impactScore: 10,
      estimatedImpact: 250,
      marginAtRisk: 90,
      revenueAtRisk: 600,
      primaryIssue: "Buyer confusion",
      returnRatePercent: 8,
      refundRatePercent: 1,
      returnUnits: 2,
      refundUnits: 0,
      negativeReviewCount: 2,
      reviewCount: 6,
      signalCount: 8,
      topReturnReason: "Size",
      productMomentumScore: 71,
      productMomentumTier: "Rising",
      productMomentumDirection: "Accelerating",
    };

    const report = __productPulseWatchlistTestHooks.buildWatchChangeReport({
      previousSummary,
      snapshot: {
        productGid: "gid://shopify/Product/1",
        riskScore: 67,
        impactScore: 14,
        confidence: 64,
        primaryIssue: "Product quality",
        metrics: {
          returnRate: 0.18,
          returnUnits: 4,
          negativeReviewCount: 5,
          signalCount: 12,
          estimatedImpact: 375,
          marginAtRisk: 140,
          revenueAtRisk: 900,
          productMomentum: { score: 75, tier: "Rising", direction: "Accelerating" },
        },
      },
      createdAt: new Date("2026-05-17T10:00:00.000Z"),
    });

    expect(report.status).toBe("changed");
    expect(report.changeCount).toBeGreaterThan(0);
    expect(report.changes.some((change) => change.id === "risk-score")).toBe(true);
    expect(report.changes.some((change) => change.id === "return-rate")).toBe(true);
    expect(report.sections.map((section) => section.id)).toContain("risk");
    expect(report.changes.find((change) => change.id === "risk-score").to).toBe("67");
  });

  it("adds source-level Watchlist evidence insights for new returns and reviews", () => {
    const previousSummary = {
      capturedAt: "2026-05-16T10:00:00.000Z",
      riskScore: 51,
      riskLabel: "Medium",
      confidence: 62,
      impactScore: 10,
      returnRatePercent: 8,
      returnUnits: 1,
      negativeReviewCount: 0,
      reviewCount: 1,
      evidenceDetails: {
        returns: {
          totalUnits: 1,
          items: [{ key: "return-old", text: "Too small", sentiment: "negative", reason: "Size", issueCode: "fit_size", createdAt: "2026-05-15T10:00:00.000Z" }],
        },
        reviews: {
          total: 1,
          negative: 0,
          items: [{ key: "review-old", text: "Works fine", sentiment: "positive", rating: 5, createdAt: "2026-05-15T10:00:00.000Z" }],
        },
      },
    };

    const report = __productPulseWatchlistTestHooks.buildWatchChangeReport({
      previousSummary,
      snapshot: {
        productGid: "gid://shopify/Product/1",
        riskScore: 62,
        impactScore: 14,
        confidence: 68,
        primaryIssue: "Product quality",
        metrics: {
          returnRate: 0.18,
          returnUnits: 3,
          negativeReviewCount: 1,
          reviewCount: 2,
          textInsights: {
            returns: { sentiment: { total: 2, negative: 2, neutral: 0, positive: 0 } },
            reviews: { sentiment: { total: 2, negative: 1, neutral: 0, positive: 1 } },
          },
          incrementalDiagnosis: {
            cache: {
              customerText: {
                returnItems: [
                  { key: "return-old", text: "Too small", analysisText: "Too small", sentiment: "negative", reason: "Size", issueCode: "fit_size", createdAt: "2026-05-15T10:00:00.000Z" },
                  { key: "return-new", text: "Feels broken and cheap", analysisText: "Feels broken and cheap", sentiment: "negative", reason: "Quality issue", issueCode: "product_quality", createdAt: "2026-05-17T09:30:00.000Z" },
                ],
                reviewItems: [
                  { key: "review-old", text: "Works fine", analysisText: "Works fine", sentiment: "positive", rating: 5, createdAt: "2026-05-15T10:00:00.000Z" },
                  { key: "review-new", text: "Cheap plastic, not worth it", analysisText: "Cheap plastic, not worth it", sentiment: "negative", rating: 1, issueCode: "value_quality", createdAt: "2026-05-17T09:40:00.000Z" },
                ],
              },
            },
          },
        },
      },
      createdAt: new Date("2026-05-17T10:00:00.000Z"),
    });

    expect(report.sourceInsights.map((insight) => insight.id)).toEqual(expect.arrayContaining(["return-evidence", "review-evidence"]));
    expect(report.sourceInsights.find((insight) => insight.id === "return-evidence").bullets.join(" ")).toContain("New return sentiment");
    expect(report.sourceInsights.find((insight) => insight.id === "review-evidence").bullets.join(" ")).toContain("Representative review");
  });

  it("does not surface low-information Shopify refund defaults as reason language", () => {
    const report = __productPulseWatchlistTestHooks.buildWatchChangeReport({
      previousSummary: {
        capturedAt: "2026-05-17T10:00:00.000Z",
        riskScore: 70,
        refundUnits: 0,
        evidenceDetails: {
          refunds: {
            totalUnits: 0,
            sourceItems: [],
            items: [],
          },
        },
      },
      snapshot: {
        productGid: "gid://shopify/Product/1",
        riskScore: 75,
        metrics: {
          refundUnits: 1,
          refundAmount: 39,
          incrementalDiagnosis: {
            cache: {
              sourceEvents: {
                refunds: [{
                  key: "refund-source-new",
                  quantity: 1,
                  amount: 39,
                  reason: "Refund Discrepancy",
                  reasonText: "Refund Discrepancy",
                  restockType: "NO_RESTOCK",
                  createdAt: "2026-05-17T11:00:00.000Z",
                }],
              },
              refunds: {
                items: [{
                  key: "refund-new",
                  text: "Customer used a pop-grip case, then learned the accessory sits outside the CaseFit compatibility boundary.",
                  issueCode: "fit_sizing",
                  sentiment: "negative",
                  quantity: 1,
                  amount: 39,
                  reasonText: "Refund Discrepancy",
                  restockType: "NO_RESTOCK",
                  createdAt: "2026-05-17T11:00:00.000Z",
                }],
              },
            },
          },
        },
      },
      createdAt: new Date("2026-05-17T12:00:00.000Z"),
    });

    const refundChange = report.sourceChanges.find((change) => change.id === "new-refunds");
    const refundInsight = report.sourceInsights.find((insight) => insight.id === "refund-evidence");

    expect(refundChange.detail).toContain("Compatibility");
    expect(refundChange.detail).not.toContain("Fit Sizing");
    expect(refundChange.detail).not.toContain("Refund Discrepancy");
    expect(refundChange.detail).not.toContain("NO RESTOCK");
    expect(refundInsight.bullets.join(" ")).toContain("Compatibility");
    expect(refundInsight.bullets.join(" ")).not.toContain("Fit Sizing");
    expect(refundInsight.bullets.join(" ")).not.toContain("Refund Discrepancy");
  });

  it("does not treat historical reviews as new when the previous report lacks item-level review cache", () => {
    const previousSummary = {
      capturedAt: "2026-05-17T21:54:39.527Z",
      riskScore: 62,
      riskLabel: "Medium",
      confidence: 68,
      impactScore: 14,
      negativeReviewCount: 10,
      reviewCount: 10,
      signalCount: 14,
    };

    const report = __productPulseWatchlistTestHooks.buildWatchChangeReport({
      previousSummary,
      snapshot: {
        productGid: "gid://shopify/Product/1",
        riskScore: 62,
        impactScore: 14,
        confidence: 68,
        primaryIssue: "Product quality",
        metrics: {
          negativeReviewCount: 10,
          reviewCount: 10,
          signalCount: 14,
          incrementalDiagnosis: {
            cache: {
              customerText: {
                reviewItems: Array.from({ length: 10 }, (_, index) => ({
                  key: `review-${index + 1}`,
                  text: `Old review ${index + 1}`,
                  analysisText: `Old review ${index + 1}`,
                  sentiment: "negative",
                  rating: index % 2 === 0 ? 1 : 2,
                  createdAt: `2026-05-17T21:4${index % 9}:00.000Z`,
                })),
              },
            },
          },
        },
      },
      createdAt: new Date("2026-05-17T22:22:40.407Z"),
    });

    expect(report.sourceInsights.some((insight) => insight.id === "review-evidence")).toBe(false);
  });

  it("counts only reviews created after the previous watch report when older reports have no item baseline", () => {
    const previousSummary = {
      capturedAt: "2026-05-17T21:53:42.419Z",
      riskScore: 71,
      riskLabel: "Medium",
      confidence: 70,
      impactScore: 14,
      negativeReviewCount: 8,
      reviewCount: 8,
      signalCount: 12,
    };

    const report = __productPulseWatchlistTestHooks.buildWatchChangeReport({
      previousSummary,
      snapshot: {
        productGid: "gid://shopify/Product/1",
        riskScore: 74,
        impactScore: 14,
        confidence: 70,
        primaryIssue: "Product quality",
        metrics: {
          negativeReviewCount: 9,
          reviewCount: 9,
          signalCount: 13,
          incrementalDiagnosis: {
            cache: {
              customerText: {
                reviewItems: [
                  ...Array.from({ length: 8 }, (_, index) => ({
                    key: `review-old-${index + 1}`,
                    text: `Historical review ${index + 1}`,
                    analysisText: `Historical review ${index + 1}`,
                    sentiment: "negative",
                    rating: 2,
                    createdAt: `2026-05-17T21:4${index % 9}:00.000Z`,
                  })),
                  {
                    key: "review-new-1",
                    text: "New review says the plastic feels cheap.",
                    analysisText: "New review says the plastic feels cheap.",
                    sentiment: "negative",
                    rating: 1,
                    createdAt: "2026-05-17T22:20:54.000Z",
                  },
                ],
              },
            },
          },
        },
      },
      createdAt: new Date("2026-05-17T22:22:33.739Z"),
    });

    const reviewInsight = report.sourceInsights.find((insight) => insight.id === "review-evidence");
    expect(reviewInsight?.metric).toBe("1 new review");
    expect(reviewInsight?.summary).toContain("1 new review text signal");
  });

  it("reports concrete new orders before calculated product-state changes", () => {
    const previousSummary = {
      capturedAt: "2026-05-19T02:00:00.000Z",
      riskScore: 56,
      riskLabel: "Medium",
      confidence: 79,
      impactScore: 12,
      primaryIssue: "Color expectations",
      orderCount: 1,
      soldUnits: 2,
      salesAmount: 80,
      evidenceDetails: {
        orders: {
          totalOrders: 1,
          totalUnits: 2,
          totalRevenue: 80,
          items: [{
            key: "sale:old-order",
            orderId: "old-order",
            quantity: 2,
            amount: 80,
            variant: "Blue",
            createdAt: "2026-05-18T02:00:00.000Z",
          }],
        },
      },
    };

    const report = __productPulseWatchlistTestHooks.buildWatchChangeReport({
      previousSummary,
      snapshot: {
        productGid: "gid://shopify/Product/1",
        riskScore: 56,
        impactScore: 12,
        confidence: 79,
        primaryIssue: "Color expectations",
        metrics: {
          soldUnits: 6,
          salesAmount: 320,
          monthlyOrderActivity: {
            summary: {
              totalOrders: 2,
              totalOrderUnits: 6,
              totalRevenue: 320,
            },
          },
          incrementalDiagnosis: {
            cache: {
              sourceEvents: {
                sales: [
                  {
                    cacheKey: "sale:old-order",
                    orderId: "old-order",
                    quantity: 2,
                    amount: 80,
                    variantTitle: "Blue",
                    createdAt: "2026-05-18T02:00:00.000Z",
                  },
                  {
                    cacheKey: "sale:new-order:rose",
                    orderId: "new-order",
                    quantity: 3,
                    amount: 180,
                    variantTitle: "Rose",
                    createdAt: "2026-05-19T03:00:00.000Z",
                  },
                  {
                    cacheKey: "sale:new-order:black",
                    orderId: "new-order",
                    quantity: 1,
                    amount: 60,
                    variantTitle: "Black",
                    createdAt: "2026-05-19T03:00:00.000Z",
                  },
                ],
              },
            },
          },
        },
      },
      createdAt: new Date("2026-05-19T04:00:00.000Z"),
    });

    expect(report.status).toBe("changed");
    expect(report.sourceChangeCount).toBe(1);
    expect(report.sourceChanges[0].id).toBe("new-orders");
    expect(report.sourceChanges[0].value).toBe("1 order");
    expect(report.sourceChanges[0].delta).toBe("+4 units");
    expect(report.sourceInsights[0].id).toBe("order-evidence");
    expect(report.sourceInsights[0].metric).toBe("1 new order");
    expect(report.changes).toEqual([]);
    expect(report.headline).toContain("New orders");
  });

  it("deduplicates multi-variant order lines in Watchlist order changes", () => {
    const report = __productPulseWatchlistTestHooks.buildWatchChangeReport({
      previousSummary: {
        capturedAt: "2026-05-19T02:00:00.000Z",
        riskScore: 40,
        riskLabel: "Low",
        confidence: 80,
        primaryIssue: "No primary issue",
        orderCount: 0,
        soldUnits: 0,
        salesAmount: 0,
        evidenceDetails: { orders: { totalOrders: 0, totalUnits: 0, totalRevenue: 0, items: [] } },
      },
      snapshot: {
        productGid: "gid://shopify/Product/1",
        riskScore: 40,
        confidence: 80,
        primaryIssue: "No primary issue",
        metrics: {
          soldUnits: 2,
          salesAmount: 120,
          incrementalDiagnosis: {
            cache: {
              sourceEvents: {
                sales: [
                  {
                    cacheKey: "sale:multi-variant-order:black",
                    orderId: "multi-variant-order",
                    quantity: 1,
                    amount: 60,
                    variantTitle: "Black",
                    createdAt: "2026-05-19T03:00:00.000Z",
                  },
                  {
                    cacheKey: "sale:multi-variant-order:white",
                    orderId: "multi-variant-order",
                    quantity: 1,
                    amount: 60,
                    variantTitle: "White",
                    createdAt: "2026-05-19T03:00:00.000Z",
                  },
                ],
              },
            },
          },
        },
      },
      createdAt: new Date("2026-05-19T04:00:00.000Z"),
    });

    expect(report.current.orderCount).toBe(1);
    expect(report.current.evidenceDetails.orders.totalOrders).toBe(1);
    expect(report.sourceChanges[0]).toMatchObject({
      id: "new-orders",
      value: "1 order",
      delta: "+2 units",
    });
    expect(report.sourceInsights[0]).toMatchObject({
      id: "order-evidence",
      metric: "1 new order",
    });
  });

  it("keeps historical returns, refunds, reviews and cache-missing content out of concrete Watchlist changes", () => {
    const previousSummary = {
      capturedAt: "2026-05-23T13:16:25.154Z",
      riskScore: 100,
      riskLabel: "High",
      confidence: 99,
      primaryIssue: "Voice unlock reliability",
      orderCount: 14,
      soldUnits: 14,
      salesAmount: 816,
      returnUnits: 7,
      refundUnits: 4,
      returnRatePercent: 50,
      refundRatePercent: 28.6,
      reviewCount: 52,
      negativeReviewCount: 25,
      evidenceDetails: {
        orders: {
          totalOrders: 14,
          totalUnits: 14,
          totalRevenue: 816,
          items: [{
            key: "sale:old-safe-order",
            orderId: "old-safe-order",
            quantity: 1,
            amount: 96,
            variant: "Matte Black",
            createdAt: "2026-05-20T02:00:00.000Z",
          }],
        },
        returns: {
          totalUnits: 7,
          rate: 50,
          items: [{ key: "return-old", text: "Voice opened for TV phrase.", sentiment: "negative", createdAt: "2026-05-20T02:00:00.000Z" }],
        },
        refunds: {
          totalUnits: 4,
          rate: 28.6,
          items: [{ key: "refund-old", text: "Goodwill no restock.", sentiment: "neutral", createdAt: "2026-05-20T02:00:00.000Z" }],
        },
        reviews: {
          total: 52,
          negative: 25,
          items: [{ key: "review-old", text: "Voice lock feels inconsistent.", sentiment: "negative", rating: 2, createdAt: "2026-05-20T02:00:00.000Z" }],
        },
        content: {
          changed: true,
          reason: "product_content_cache_missing",
          signature: "safe-signature",
        },
      },
    };

    const report = __productPulseWatchlistTestHooks.buildWatchChangeReport({
      previousSummary,
      snapshot: {
        productGid: "gid://shopify/Product/safe",
        productTitle: "GEN EchoLock Voice Safe",
        riskScore: 100,
        confidence: 99,
        primaryIssue: "Voice unlock reliability",
        metrics: {
          soldUnits: 18,
          salesAmount: 1200,
          returnUnits: 7,
          refundUnits: 4,
          returnRate: 38.9,
          refundRate: 22.2,
          reviewCount: 52,
          negativeReviewCount: 25,
          incrementalDiagnosis: {
            productContent: {
              changed: true,
              reason: "product_content_cache_missing",
              signature: "safe-signature",
            },
            cache: {
              sourceEvents: {
                sales: [
                  {
                    cacheKey: "sale:old-safe-order",
                    orderId: "old-safe-order",
                    quantity: 1,
                    amount: 96,
                    variantTitle: "Matte Black",
                    createdAt: "2026-05-20T02:00:00.000Z",
                  },
                  {
                    cacheKey: "sale:new-safe-order",
                    orderId: "new-safe-order",
                    quantity: 4,
                    amount: 384,
                    variantTitle: "Matte Black",
                    createdAt: "2026-05-24T03:43:48.000Z",
                  },
                ],
              },
              customerText: {
                returnItems: [{ key: "return-old", text: "Voice opened for TV phrase.", sentiment: "negative", createdAt: "2026-05-20T02:00:00.000Z" }],
                reviewItems: [{ key: "review-old", text: "Voice lock feels inconsistent.", sentiment: "negative", rating: 2, createdAt: "2026-05-20T02:00:00.000Z" }],
              },
              refunds: {
                items: [{ key: "refund-old", text: "Goodwill no restock.", sentiment: "neutral", createdAt: "2026-05-20T02:00:00.000Z" }],
              },
            },
          },
          monthlyOrderActivity: {
            summary: {
              totalOrders: 15,
              totalOrderUnits: 18,
              totalRevenue: 1200,
              returnRate: 38.9,
              refundRate: 22.2,
            },
          },
        },
      },
      createdAt: new Date("2026-05-24T03:45:39.597Z"),
    });

    expect(report.sourceChanges.map((change) => change.id)).toEqual(["new-orders"]);
    expect(report.sourceInsights.some((insight) => insight.id === "product-content")).toBe(false);
    expect(report.changes.map((change) => change.id)).toEqual(expect.arrayContaining(["return-rate", "refund-rate"]));
    expect(report.narrative).toContain("New orders");
    expect(report.narrative).toContain("Matte Black");
    expect(report.narrative).not.toMatch(/new return|new refund|new review|product content/i);
  });

  it("uses stored evidence keys instead of review dates when comparing two item-level reports", () => {
    const previousSummary = {
      capturedAt: "2026-05-19T02:00:00.000Z",
      riskScore: 56,
      riskLabel: "Medium",
      confidence: 79,
      negativeReviewCount: 0,
      reviewCount: 7,
      signalCount: 10,
      evidenceDetails: {
        reviews: {
          total: 7,
          negative: 0,
          items: [{ key: "review-old", text: "Matches the photos.", sentiment: "positive", rating: 5, createdAt: "2026-05-01T00:00:00.000Z" }],
        },
      },
    };

    const report = __productPulseWatchlistTestHooks.buildWatchChangeReport({
      previousSummary,
      snapshot: {
        productGid: "gid://shopify/Product/1",
        riskScore: 58,
        confidence: 80,
        primaryIssue: "Color expectations",
        metrics: {
          negativeReviewCount: 1,
          reviewCount: 8,
          signalCount: 11,
          incrementalDiagnosis: {
            cache: {
              customerText: {
                reviewItems: [
                  { key: "review-old", text: "Matches the photos.", sentiment: "positive", rating: 5, createdAt: "2026-05-01T00:00:00.000Z" },
                  {
                    key: "review-new-but-backdated",
                    text: "The rose color looked copper in person.",
                    analysisText: "The rose color looked copper in person.",
                    sentiment: "negative",
                    rating: 3,
                    createdAt: "2026-05-18T02:00:00.000Z",
                  },
                ],
              },
            },
          },
        },
      },
      createdAt: new Date("2026-05-19T02:05:00.000Z"),
    });

    const reviewInsight = report.sourceInsights.find((insight) => insight.id === "review-evidence");
    expect(reviewInsight?.metric).toBe("1 new review");
    expect(reviewInsight?.bullets.join(" ")).toContain("New review sentiment: 1 negative, 0 neutral, 0 positive");
  });

  it("does not convert historical source backfill into new Watchlist source changes when the previous baseline had no source items", () => {
    const previousSummary = {
      capturedAt: "2026-05-20T10:00:00.000Z",
      riskScore: 64,
      confidence: 70,
      primaryIssue: "Setup expectations",
      orderCount: 0,
      soldUnits: 0,
      salesAmount: 0,
      returnUnits: 0,
      refundUnits: 0,
      reviewCount: 0,
      negativeReviewCount: 0,
      signalCount: 0,
      evidenceDetails: {
        orders: { items: [] },
        returns: { sourceItems: [], items: [] },
        refunds: { sourceItems: [], items: [] },
        reviews: { items: [] },
      },
    };

    const report = __productPulseWatchlistTestHooks.buildWatchChangeReport({
      previousSummary,
      snapshot: {
        productGid: "gid://shopify/Product/8786190729304",
        riskScore: 86,
        confidence: 88,
        primaryIssue: "Setup expectations",
        metrics: {
          orderCount: 8,
          soldUnits: 11,
          salesAmount: 612,
          returnUnits: 3,
          refundUnits: 3,
          refundAmount: 186,
          reviewCount: 13,
          negativeReviewCount: 7,
          signalCount: 16,
          incrementalDiagnosis: {
            cache: {
              sourceFingerprint: "full-source-cache-v1",
              sourceEvents: {
                sales: [
                  { id: "sale-1", orderId: "order-1", quantity: 2, amount: 118, createdAt: "2026-05-18T09:00:00.000Z" },
                  { id: "sale-2", orderId: "order-2", quantity: 1, amount: 59, createdAt: "2026-05-19T09:00:00.000Z" },
                ],
                returns: [
                  { id: "return-1", returnId: "return-1", orderId: "order-1", quantity: 1, reason: "Setup mismatch", createdAt: "2026-05-19T12:00:00.000Z" },
                ],
                refunds: [
                  { id: "refund-1", refundId: "refund-1", orderId: "order-1", quantity: 1, amount: 59, reason: "Setup mismatch", createdAt: "2026-05-19T12:30:00.000Z" },
                ],
              },
              customerText: {
                reviewItems: [
                  { key: "review-1", text: "Camera banding warning was there, but I missed it.", sentiment: "negative", rating: 2, createdAt: "2026-05-19T15:00:00.000Z" },
                ],
              },
              refunds: {
                items: [
                  { key: "refund-note-1", text: "Refund was for a missed setup condition.", sentiment: "negative", quantity: 1, amount: 59, createdAt: "2026-05-19T12:30:00.000Z" },
                ],
              },
            },
          },
        },
      },
      createdAt: new Date("2026-05-21T10:00:00.000Z"),
    });

    expect(report.status).toBe("changed");
    expect(report.sourceChangeCount).toBe(0);
    expect(report.sourceChanges).toEqual([]);
    expect(report.sourceInsights).toEqual([]);
    expect(report.changes.some((change) => change.id === "risk-score")).toBe(true);
  });

  it("keeps reused no-change runs focused on calculated movement instead of aggregate source deltas", () => {
    const previousSummary = {
      capturedAt: "2026-05-20T10:00:00.000Z",
      riskScore: 54,
      confidence: 70,
      primaryIssue: "Product quality",
      reviewCount: 5,
      negativeReviewCount: 2,
      productMomentumScore: 42,
      productMomentumTier: "Warm",
      evidenceDetails: {
        reviews: {
          total: 5,
          negative: 2,
          averageRating: 3,
          items: [{ key: "review-old", text: "Older complaint", rating: 2, createdAt: "2026-05-10T10:00:00.000Z" }],
        },
      },
      sourceFingerprint: "previous-window",
    };

    const report = __productPulseWatchlistTestHooks.buildWatchChangeReport({
      previousSummary,
      noChangesReused: true,
      snapshot: {
        productGid: "gid://shopify/Product/1",
        riskScore: 54,
        confidence: 71,
        primaryIssue: "Product quality",
        metrics: {
          reviewCount: 5,
          negativeReviewCount: 2,
          avgRating: 4,
          productMomentum: { score: 69, tier: "Hot", direction: "Accelerating" },
          productMomentumScore: 69,
          productMomentumTier: "Hot",
          momentumDirection: "Accelerating",
          incrementalDiagnosis: {
            cache: {
              sourceFingerprint: "current-window",
              customerText: {
                reviewItems: [{ key: "review-old", text: "Older complaint", rating: 2, createdAt: "2026-05-10T10:00:00.000Z" }],
              },
            },
          },
        },
      },
      createdAt: new Date("2026-05-21T10:00:00.000Z"),
    });

    expect(report.status).toBe("changed");
    expect(report.sourceChangeCount).toBe(0);
    expect(report.sourceChanges).toEqual([]);
    expect(report.changes.some((change) => change.id === "momentum-score")).toBe(true);
    expect(report.narrative).toContain("had no concrete new orders");
    expect(report.narrative).toContain("Secondary calculated context");
  });

  it("does not report tiny financial-exposure drift as a meaningful Watchlist change", () => {
    const previousSummary = {
      capturedAt: "2026-05-19T02:00:00.000Z",
      riskScore: 59,
      riskLabel: "Medium",
      confidence: 79,
      estimatedImpact: 802,
      marginAtRisk: 360.9,
      revenueAtRisk: 802,
      primaryIssue: "Product quality",
      signalCount: 21,
    };

    const report = __productPulseWatchlistTestHooks.buildWatchChangeReport({
      previousSummary,
      snapshot: {
        productGid: "gid://shopify/Product/1",
        riskScore: 59,
        confidence: 79,
        primaryIssue: "Product quality",
        metrics: {
          estimatedImpact: 804.16,
          marginAtRisk: 363.06,
          revenueAtRisk: 806.81,
          signalCount: 21,
        },
      },
      createdAt: new Date("2026-05-19T02:05:00.000Z"),
    });

    expect(report.status).toBe("unchanged");
    expect(report.changes).toEqual([]);
  });

  it("reports no meaningful changes when the current snapshot matches the previous run", () => {
    const previousSummary = {
      capturedAt: "2026-05-16T10:00:00.000Z",
      riskScore: 63,
      riskLabel: "Medium",
      confidence: 72,
      impactScore: 11,
      estimatedImpact: 250,
      marginAtRisk: 90,
      revenueAtRisk: 600,
      primaryIssue: "Product quality",
      returnRatePercent: 12,
      refundRatePercent: 0,
      returnUnits: 3,
      refundUnits: 0,
      negativeReviewCount: 2,
      reviewCount: 8,
      signalCount: 10,
      topReturnReason: "Size",
      productMomentumScore: 70,
      productMomentumTier: "Rising",
      productMomentumDirection: "Stable",
    };

    const report = __productPulseWatchlistTestHooks.buildWatchChangeReport({
      previousSummary,
      snapshot: {
        productGid: "gid://shopify/Product/1",
        riskScore: 63,
        impactScore: 11,
        confidence: 72,
        primaryIssue: "Product quality",
        metrics: {
          returnRate: 0.12,
          returnUnits: 3,
          negativeReviewCount: 2,
          reviewCount: 8,
          signalCount: 10,
          estimatedImpact: 250,
          marginAtRisk: 90,
          revenueAtRisk: 600,
          topReturnReason: "Size",
          productMomentum: { score: 70, tier: "Rising", direction: "Stable" },
        },
      },
      createdAt: new Date("2026-05-17T10:00:00.000Z"),
    });

    expect(report.status).toBe("unchanged");
    expect(report.changeCount).toBe(0);
    expect(report.sections).toEqual([]);
    expect(report.changes).toEqual([]);
  });
});

function buildWatchlistLimitItem(index) {
  return {
    id: `watch-${index}`,
    shop: "test-shop.myshopify.com",
    productGid: `gid://shopify/Product/${index}`,
    productTitle: `Watched product ${index}`,
    handle: `watched-product-${index}`,
    status: "Watching",
    addedAt: new Date(Date.UTC(2026, 4, index)),
  };
}

function createWatchlistLimitTestDb(items = []) {
  const state = {
    items: items.slice(),
  };
  return {
    state,
    productWatchlistItem: {
      async findMany(query = {}) {
        const where = query.where || {};
        return state.items
          .filter((item) => !where.shop || item.shop === where.shop)
          .sort((a, b) => {
            const byAddedAt = new Date(a.addedAt).getTime() - new Date(b.addedAt).getTime();
            if (byAddedAt) return byAddedAt;
            return String(a.id).localeCompare(String(b.id));
          });
      },
      async deleteMany(query = {}) {
        const ids = new Set(query.where?.id?.in || []);
        const before = state.items.length;
        state.items = state.items.filter((item) => !ids.has(item.id));
        return { count: before - state.items.length };
      },
    },
  };
}
