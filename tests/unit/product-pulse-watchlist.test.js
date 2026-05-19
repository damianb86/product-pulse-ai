import { describe, expect, it } from "vitest";
import { __productPulseWatchlistTestHooks } from "../../app/lib/product-pulse-watchlist.server";

describe("ProductPulse watchlist helpers", () => {
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
        metrics: { returnRate: 0.12, negativeReviewCount: 3 },
      },
      createdAt: new Date("2026-05-17T10:00:00.000Z"),
    });

    expect(report.status).toBe("baseline");
    expect(report.changeCount).toBe(0);
    expect(report.current.riskScore).toBe(63);
    expect(report.headline).toBe("No previous Watchlist data");
    expect(report.sections).toHaveLength(0);
    expect(report.sourceInsights).toHaveLength(0);
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
