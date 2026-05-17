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
    expect(report.sections[0].title).toBe("Baseline");
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
          items: [{ key: "return-old", text: "Too small", sentiment: "negative", reason: "Size", issueCode: "fit_size" }],
        },
        reviews: {
          total: 1,
          negative: 0,
          items: [{ key: "review-old", text: "Works fine", sentiment: "positive", rating: 5 }],
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
                  { key: "return-old", text: "Too small", analysisText: "Too small", sentiment: "negative", reason: "Size", issueCode: "fit_size" },
                  { key: "return-new", text: "Feels broken and cheap", analysisText: "Feels broken and cheap", sentiment: "negative", reason: "Quality issue", issueCode: "product_quality" },
                ],
                reviewItems: [
                  { key: "review-old", text: "Works fine", analysisText: "Works fine", sentiment: "positive", rating: 5 },
                  { key: "review-new", text: "Cheap plastic, not worth it", analysisText: "Cheap plastic, not worth it", sentiment: "negative", rating: 1, issueCode: "value_quality" },
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
    expect(report.sections[0].title).toBe("No changes");
  });
});
