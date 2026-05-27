/* eslint-env node */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  productScoreHistory: {
    createMany: vi.fn(),
    deleteMany: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
}));

vi.mock("../../app/db.server", () => ({ default: prismaMock }));

const {
  getReconstructedProductScoreHistoryForShop,
  recordReconstructedProductScoreHistory,
} = await import("../../app/lib/product-pulse-history.server.js");

describe("ProductPulse score history persistence", () => {
  beforeEach(() => {
    prismaMock.productScoreHistory.createMany.mockReset();
    prismaMock.productScoreHistory.deleteMany.mockReset();
    prismaMock.productScoreHistory.findFirst.mockReset();
    prismaMock.productScoreHistory.findMany.mockReset();
  });

  it("keeps bootstrapped reconstructed history when temporal metrics are current", async () => {
    prismaMock.productScoreHistory.findMany.mockResolvedValue([
      { id: "existing-history-row", metrics: { temporalMetricsVersion: 3 } },
    ]);

    const result = await recordReconstructedProductScoreHistory({
      shop: "peak-outfitters.myshopify.com",
      snapshot: {
        id: "snapshot-1",
        productGid: "gid://shopify/Product/1",
        productTitle: "Cooling Pillow",
        metrics: { productMomentumScore: 88 },
      },
      history: [
        {
          recordedAt: "2026-04-30T23:59:59.000Z",
          riskScore: 41,
          metrics: { priorityScore: 37 },
        },
      ],
      diagnosisId: "diagnosis-1",
    });

    expect(result).toMatchObject({
      count: 0,
      skipped: true,
      reason: "reconstructed_history_already_bootstrapped",
    });
    expect(prismaMock.productScoreHistory.createMany).not.toHaveBeenCalled();
    expect(prismaMock.productScoreHistory.deleteMany).not.toHaveBeenCalled();
  });

  it("rebuilds legacy reconstructed history with stale temporal metrics", async () => {
    prismaMock.productScoreHistory.findMany.mockResolvedValue([
      { id: "legacy-history-row", metrics: { productMomentumScore: 88 } },
    ]);
    prismaMock.productScoreHistory.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.productScoreHistory.createMany.mockResolvedValue({ count: 1 });

    const result = await recordReconstructedProductScoreHistory({
      shop: "peak-outfitters.myshopify.com",
      snapshot: {
        id: "snapshot-1",
        productGid: "gid://shopify/Product/1",
        productTitle: "Cooling Pillow",
      },
      history: [
        {
          recordedAt: "2026-04-30T23:59:59.000Z",
          riskScore: 41,
          metrics: { priorityScore: 37, productMomentumScore: 12 },
        },
      ],
      diagnosisId: "diagnosis-1",
    });

    expect(result).toEqual({ count: 1 });
    expect(prismaMock.productScoreHistory.deleteMany).toHaveBeenCalledWith({
      where: {
        shop: "peak-outfitters.myshopify.com",
        productGid: "gid://shopify/Product/1",
        source: "full-diagnosis-reconstructed",
      },
    });
    const rows = prismaMock.productScoreHistory.createMany.mock.calls[0][0].data;
    expect(rows[0].metrics).toMatchObject({
      productMomentumScore: 12,
      temporalMetricsVersion: 3,
    });
  });

  it("stores reconstructed temporal metrics without inheriting current-only values", async () => {
    prismaMock.productScoreHistory.findMany.mockResolvedValue([]);
    prismaMock.productScoreHistory.createMany.mockResolvedValue({ count: 1 });

    await recordReconstructedProductScoreHistory({
      shop: "peak-outfitters.myshopify.com",
      snapshot: {
        id: "snapshot-1",
        productGid: "gid://shopify/Product/1",
        productTitle: "Cooling Pillow",
        primaryIssue: "Current issue",
        metrics: {
          priorityScore: 91,
          productMomentumScore: 88,
          returnPressureScore: 77,
        },
      },
      history: [
        {
          recordedAt: "2026-04-30T23:59:59.000Z",
          riskScore: 41,
          confidence: 70,
          primaryIssue: "Historical issue",
          metrics: {
            priorityScore: 37,
            mainIssueIntensity: 37,
            returnPressureScore: 22,
            returnRefundRelationshipSummary: {
              product_id: "gid://shopify/Product/1",
              sold_units: 20,
              returned_units: 3,
              returned_and_refunded_units: 1,
              returned_not_refunded_units: 2,
              exchange_or_replacement_units: 0,
              pending_return_units: 0,
              return_rate_units: 0.15,
            },
            returnRefundRelationshipFactors: {
              hasRelationshipSummary: true,
              returnPressure: {
                score: 22,
                productFrictionUnits: 3,
                returnRateUnits: 15,
              },
            },
            refundLeakageScore: 13,
            productMomentumScore: 44,
            estimatedImpact: 0,
          },
        },
      ],
      diagnosisId: "diagnosis-1",
    });

    const rows = prismaMock.productScoreHistory.createMany.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0].metrics).toMatchObject({
      priorityScore: 37,
      mainIssueIntensity: 37,
      returnPressureScore: 22,
      returnPressureRate: 15,
      refundLeakageScore: 13,
      productMomentumScore: 44,
      financialExposure: 0,
      temporalMetricsVersion: 3,
    });
    expect(rows[0].metrics.productMomentumScore).not.toBe(88);
    expect(rows[0].metrics.returnPressureScore).not.toBe(77);
  });

  it("normalizes stored reconstructed rows for diagnosis reuse", async () => {
    prismaMock.productScoreHistory.findMany.mockResolvedValue([
      {
        id: "history-1",
        source: "full-diagnosis-reconstructed",
        riskScore: 52,
        impactScore: 8,
        confidence: 81,
        primaryIssue: "Return pressure",
        recordedAt: new Date("2026-03-31T23:59:59.000Z"),
        metrics: {
          periodEnd: "2026-03-31T23:59:59.000Z",
          returnRate: 4.2,
          priorityScore: 46,
          productMomentumScore: 58,
          returnPressureScore: 34,
          returnPressureRate: 12.5,
          refundLeakageScore: 12,
          temporalMetricsVersion: 3,
          sourceCoverage: [{ source: "Shopify" }],
        },
      },
    ]);

    const rows = await getReconstructedProductScoreHistoryForShop(
      "peak-outfitters.myshopify.com",
      "gid://shopify/Product/1",
    );

    expect(rows).toEqual([
      expect.objectContaining({
        recordedAt: "2026-03-31T23:59:59.000Z",
        riskScore: 52,
        returnRate: 4.2,
        mainIssueIntensity: 46,
        productMomentumScore: 58,
        returnPressureScore: 34,
        returnPressureRate: 12.5,
        refundLeakageScore: 12,
        sourceCount: 1,
        temporalMetricsVersion: 3,
      }),
    ]);
  });
});
