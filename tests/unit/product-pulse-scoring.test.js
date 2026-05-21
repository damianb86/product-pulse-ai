import { describe, expect, it } from "vitest";
import {
  PRODUCT_PULSE_SCORING_VERSION,
  calculateCoverageScore,
  calculateImpactScore,
  calculateProductScoreModel,
  calculateRiskScore,
  getCoverageState,
  validateCreditBalance,
} from "../../app/lib/product-pulse-scoring";
import { defaultView } from "../fixtures/product-pulse-fixtures";

describe("ProductPulse scoring", () => {
  it("calculates deterministic source coverage from connected weights", () => {
    expect(calculateCoverageScore(defaultView.sources)).toBe(76);
    expect(getCoverageState(76).label).toBe("Strong coverage");
  });

  it("calculates product risk without AI-provided numeric metrics", () => {
    const risk = calculateRiskScore({
      returnRate: 20,
      refundRate: 10,
      reviewRating: 3.2,
      issueCount: 5,
    });

    expect(risk).toBe(64);
  });

  it("classifies products with several bad signal families as high risk", () => {
    const model = calculateProductScoreModel({
      soldUnits: 80,
      returnUnits: 14,
      refundUnits: 6,
      reviewCount: 18,
      negativeReviewCount: 7,
      avgRating: 3.1,
      contentIssueCount: 4,
      contentQualityRisk: 11,
      sentimentTotal: 14,
      sentimentNegativeCount: 8,
      recentSignalUnits: 8,
      signalEventCount: 35,
      sourceCoverage: ["Shopify product", "Shopify returns", "Shopify refunds", "CSV reviews"],
      sourceAgreement: true,
    });

    expect(model.riskScore).toBeGreaterThanOrEqual(80);
    expect(model.riskComponents.returnsScore).toBeGreaterThan(15);
    expect(model.riskComponents.reviewsScore).toBeGreaterThan(15);
    expect(model.riskComponents.contentGapScore).toBeGreaterThan(10);
  });

  it("keeps financial impact as money outside product risk", () => {
    const model = calculateProductScoreModel({
      returnRate: 20,
      refundRate: 10,
      refundAmount: 400,
      revenueAtRisk: 100000,
      marginAtRisk: 40000,
      issueCount: 5,
    });

    expect(calculateImpactScore({ revenueAtRisk: 100000, marginAtRisk: 40000, signalCount: 100 })).toBe(40000);
    expect(model.impactScore).toBeGreaterThan(model.riskScore);
    expect(model.priorityScore).toBeGreaterThan(model.riskScore);
  });

  it("uses linked return and refund relationships as a strong Product Risk signal", () => {
    const base = calculateProductScoreModel({
      soldUnits: 100,
      salesAmount: 10000,
      returnUnits: 8,
      refundUnits: 8,
      refundAmount: 800,
      sourceCoverage: ["Shopify orders", "Shopify returns", "Shopify refunds"],
    });
    const linked = calculateProductScoreModel({
      soldUnits: 100,
      salesAmount: 10000,
      returnUnits: 8,
      refundUnits: 8,
      refundAmount: 800,
      sourceCoverage: ["Shopify orders", "Shopify returns", "Shopify refunds"],
      returnRefundRelationshipSummary: relationshipSummary({
        returned_and_refunded_units: 8,
        returned_and_refunded_orders: 8,
        returned_units: 8,
        returned_orders: 8,
        refunded_units: 8,
        refunded_orders: 8,
        attributed_refund_amount: 800,
        refund_amount_with_return: 800,
        relationship_match_confidence_avg: 1,
        relationship_match_confidence_min: 1,
        return_reason_categories: { damaged_or_defective: 8 },
        refund_reason_categories: { damaged_or_defective: 8 },
      }),
    });

    expect(linked.scoringVersion).toBe(PRODUCT_PULSE_SCORING_VERSION);
    expect(linked.riskScore).toBeGreaterThan(base.riskScore);
    expect(linked.riskComponents.relationshipScore).toBeGreaterThan(9);
    expect(linked.relationshipFactors.customerSignalBreakdown.linkedReturnRefundCount).toBe(8);
    expect(linked.relationshipExplanations.join(" ")).toContain("returned");
  });

  it("weights return-only friction lower than return plus refund loss", () => {
    const returnOnly = calculateProductScoreModel({
      soldUnits: 80,
      salesAmount: 8000,
      returnUnits: 8,
      sourceCoverage: ["Shopify orders", "Shopify returns"],
      returnRefundRelationshipSummary: relationshipSummary({
        sold_units: 80,
        sold_orders: 80,
        returned_units: 8,
        returned_orders: 8,
        returned_not_refunded_units: 8,
        returned_not_refunded_orders: 8,
        relationship_match_confidence_avg: 1,
        return_reason_categories: { size_or_fit: 8 },
      }),
    });
    const linked = calculateProductScoreModel({
      soldUnits: 80,
      salesAmount: 8000,
      returnUnits: 8,
      refundUnits: 8,
      refundAmount: 800,
      sourceCoverage: ["Shopify orders", "Shopify returns", "Shopify refunds"],
      returnRefundRelationshipSummary: relationshipSummary({
        sold_units: 80,
        sold_orders: 80,
        returned_units: 8,
        returned_orders: 8,
        refunded_units: 8,
        refunded_orders: 8,
        returned_and_refunded_units: 8,
        returned_and_refunded_orders: 8,
        attributed_refund_amount: 800,
        refund_amount_with_return: 800,
        relationship_match_confidence_avg: 1,
        return_reason_categories: { size_or_fit: 8 },
      }),
    });

    expect(returnOnly.riskComponents.returnOnlyRisk).toBeGreaterThan(0);
    expect(returnOnly.riskComponents.relationshipScore).toBeLessThan(linked.riskComponents.relationshipScore);
    expect(returnOnly.impactFactors.relationshipExposure.estimatedFutureRefundFromReturnOnlyCases).toBeGreaterThan(0);
  });

  it("does not over-increase product risk for refund-only shipping reasons", () => {
    const productReason = calculateProductScoreModel(refundOnlyInput({ refundReasonCategories: { damaged_or_defective: 6 } }));
    const shippingReason = calculateProductScoreModel(refundOnlyInput({ refundReasonCategories: { shipping_issue: 6 } }));

    expect(productReason.riskScore).toBeGreaterThan(shippingReason.riskScore);
    expect(productReason.riskComponents.refundOnlyProductRisk).toBeGreaterThan(shippingReason.riskComponents.refundOnlyProductRisk);
    expect(shippingReason.riskComponents.refundScoreMultiplier).toBeLessThan(productReason.riskComponents.refundScoreMultiplier);
  });

  it("treats unattributed refunds as low-confidence financial context", () => {
    const model = calculateProductScoreModel({
      soldUnits: 100,
      salesAmount: 5000,
      refundUnits: 5,
      refundAmount: 500,
      sourceCoverage: ["Shopify orders", "Shopify refunds"],
      returnRefundRelationshipSummary: relationshipSummary({
        refunded_units: 0,
        refunded_orders: 0,
        attributed_refund_amount: 0,
        unattributed_refund_amount: 500,
        total_refund_amount_related_to_product_or_orders: 500,
        relationship_unknown_count: 2,
        relationship_match_confidence_avg: 0,
        relationship_match_confidence_min: 0,
      }),
    });

    expect(model.riskComponents.relationshipScore).toBe(0);
    expect(model.riskComponents.refundScore).toBeLessThan(model.riskComponents.rawRefundScore);
    expect(model.confidenceFactors.refundAttributionPenalty).toBeGreaterThan(0);
    expect(model.impactFactors.relationshipExposure.unattributedRefundAmount).toBe(500);
  });

  it("does not overweight pending return resolution", () => {
    const pending = calculateProductScoreModel({
      soldUnits: 50,
      salesAmount: 5000,
      returnUnits: 5,
      sourceCoverage: ["Shopify orders", "Shopify returns"],
      returnRefundRelationshipSummary: relationshipSummary({
        sold_units: 50,
        returned_units: 5,
        pending_return_units: 5,
        relationship_match_confidence_avg: 1,
        return_reason_categories: { unknown: 5 },
      }),
    });
    const linked = calculateProductScoreModel({
      soldUnits: 50,
      salesAmount: 5000,
      returnUnits: 5,
      refundUnits: 5,
      refundAmount: 500,
      sourceCoverage: ["Shopify orders", "Shopify returns", "Shopify refunds"],
      returnRefundRelationshipSummary: relationshipSummary({
        sold_units: 50,
        returned_units: 5,
        refunded_units: 5,
        returned_and_refunded_units: 5,
        attributed_refund_amount: 500,
        refund_amount_with_return: 500,
        relationship_match_confidence_avg: 1,
        return_reason_categories: { damaged_or_defective: 5 },
      }),
    });

    expect(pending.riskComponents.pendingReturnRisk).toBeGreaterThan(0);
    expect(pending.riskComponents.relationshipScore).toBeLessThan(linked.riskComponents.relationshipScore);
    expect(pending.confidenceFactors.pendingRelationshipPenalty).toBeGreaterThan(0);
  });

  it("separates return pressure, refund leakage, customer signals, and financial exposure", () => {
    const model = calculateProductScoreModel({
      soldUnits: 40,
      salesAmount: 4000,
      returnUnits: 5,
      refundUnits: 3,
      refundAmount: 270,
      sourceCoverage: ["Shopify orders", "Shopify returns", "Shopify refunds"],
      returnRefundRelationshipSummary: relationshipSummary({
        sold_units: 40,
        sold_orders: 36,
        returned_units: 5,
        returned_orders: 5,
        refunded_units: 3,
        refunded_orders: 3,
        returned_and_refunded_units: 2,
        returned_not_refunded_units: 3,
        refunded_without_return_units: 1,
        attributed_refund_amount: 270,
        refund_amount_with_return: 180,
        refund_amount_without_return: 90,
        relationship_match_confidence_avg: 0.9,
        relationship_match_confidence_min: 0.8,
        return_reason_categories: { product_quality: 5 },
      }),
    });

    expect(model.relationshipFactors.returnPressure.score).toBeGreaterThan(0);
    expect(model.relationshipFactors.refundLeakage.attributedRefundAmount).toBe(270);
    expect(model.relationshipFactors.refundLeakage.refundAmountWithoutReturn).toBe(90);
    expect(model.relationshipFactors.customerSignalBreakdown).toMatchObject({
      linkedReturnRefundCount: 2,
      returnOnlyCount: 3,
      refundOnlyCount: 1,
    });
    expect(model.impactFactors.relationshipExposure.confirmedRefundAmount).toBe(270);
  });

  it("rewards strong relationship attribution more than unknown relationship quality", () => {
    const strong = calculateProductScoreModel({
      soldUnits: 50,
      salesAmount: 5000,
      returnUnits: 3,
      refundUnits: 3,
      refundAmount: 300,
      sourceCoverage: ["Shopify orders", "Shopify returns", "Shopify refunds"],
      returnRefundRelationshipSummary: relationshipSummary({
        returned_units: 3,
        refunded_units: 3,
        returned_and_refunded_units: 3,
        attributed_refund_amount: 300,
        refund_amount_with_return: 300,
        relationship_match_confidence_avg: 1,
        relationship_match_confidence_min: 1,
        return_reason_categories: { damaged_or_defective: 3 },
      }),
    });
    const weak = calculateProductScoreModel({
      soldUnits: 50,
      salesAmount: 5000,
      returnUnits: 3,
      refundUnits: 3,
      refundAmount: 300,
      sourceCoverage: ["Shopify orders", "Shopify returns", "Shopify refunds"],
      returnRefundRelationshipSummary: relationshipSummary({
        returned_units: 3,
        refunded_units: 0,
        unattributed_refund_amount: 300,
        relationship_unknown_count: 3,
        relationship_match_confidence_avg: 0,
        relationship_match_confidence_min: 0,
      }),
    });

    expect(strong.confidenceScore).toBeGreaterThan(weak.confidenceScore);
    expect(strong.confidenceFactors.relationshipMatchScore).toBeGreaterThan(weak.confidenceFactors.relationshipMatchScore);
    expect(weak.confidenceFactors.relationshipUnknownPenalty).toBeGreaterThan(0);
  });

  it("guards relationship-derived metrics against zero denominators", () => {
    const model = calculateProductScoreModel({
      returnRefundRelationshipSummary: {
        schema_version: 1,
        product_id: "gid://shopify/Product/zero",
        relationship_buckets: {},
      },
    });

    expect(Number.isFinite(model.riskScore)).toBe(true);
    expect(Number.isFinite(model.confidenceScore)).toBe(true);
    expect(Number.isFinite(model.impactScore)).toBe(true);
  });

  it("blocks diagnosis when credits are insufficient", () => {
    expect(validateCreditBalance(0, 1)).toMatchObject({ valid: false });
    expect(validateCreditBalance(2, 1)).toMatchObject({ valid: true });
  });
});

function relationshipSummary(overrides = {}) {
  const summary = {
    schema_version: 1,
    product_id: "gid://shopify/Product/1",
    sold_units: 100,
    sold_orders: 100,
    returned_units: 0,
    returned_orders: 0,
    refunded_units: 0,
    refunded_orders: 0,
    returned_and_refunded_units: 0,
    returned_and_refunded_orders: 0,
    returned_not_refunded_units: 0,
    returned_not_refunded_orders: 0,
    refunded_without_return_units: 0,
    refunded_without_return_orders: 0,
    exchange_or_replacement_units: 0,
    exchange_or_replacement_orders: 0,
    pending_return_units: 0,
    pending_return_orders: 0,
    unattributed_refund_amount: 0,
    attributed_refund_amount: 0,
    refund_amount_with_return: 0,
    refund_amount_without_return: 0,
    total_product_revenue: 10000,
    total_refund_amount_related_to_product_or_orders: 0,
    relationship_match_confidence_avg: 0,
    relationship_match_confidence_min: 0,
    relationship_unknown_count: 0,
    return_rate_units: 0,
    return_rate_orders: 0,
    refund_rate_revenue: 0,
    refund_rate_units: 0,
    return_to_refund_rate: 0,
    refund_with_return_rate: 0,
    refund_without_return_rate: 0,
    return_without_refund_rate: 0,
    exchange_rate: 0,
    unattributed_refund_rate: 0,
    refund_attribution_rate: 0,
    relationship_buckets: {
      unattributed_refund: { units: 0, orders: 0 },
    },
    ...overrides,
  };
  summary.total_refund_amount_related_to_product_or_orders = overrides.total_refund_amount_related_to_product_or_orders
    ?? (Number(summary.attributed_refund_amount || 0) + Number(summary.unattributed_refund_amount || 0));
  summary.return_rate_units = Number(summary.sold_units) ? Number(summary.returned_units || 0) / Number(summary.sold_units) : 0;
  summary.refund_rate_units = Number(summary.sold_units) ? Number(summary.refunded_units || 0) / Number(summary.sold_units) : 0;
  summary.refund_rate_revenue = Number(summary.total_product_revenue) ? Number(summary.attributed_refund_amount || 0) / Number(summary.total_product_revenue) : 0;
  summary.return_to_refund_rate = Number(summary.returned_units) ? Number(summary.returned_and_refunded_units || 0) / Number(summary.returned_units) : 0;
  summary.refund_with_return_rate = Number(summary.refunded_units) ? Number(summary.returned_and_refunded_units || 0) / Number(summary.refunded_units) : 0;
  summary.refund_without_return_rate = Number(summary.sold_units) ? Number(summary.refunded_without_return_units || 0) / Number(summary.sold_units) : 0;
  summary.return_without_refund_rate = Number(summary.sold_units) ? Number(summary.returned_not_refunded_units || 0) / Number(summary.sold_units) : 0;
  summary.exchange_rate = Number(summary.sold_units) ? Number(summary.exchange_or_replacement_units || 0) / Number(summary.sold_units) : 0;
  summary.unattributed_refund_rate = Number(summary.total_product_revenue) ? Number(summary.unattributed_refund_amount || 0) / Number(summary.total_product_revenue) : 0;
  summary.refund_attribution_rate = Number(summary.total_refund_amount_related_to_product_or_orders)
    ? Number(summary.attributed_refund_amount || 0) / Number(summary.total_refund_amount_related_to_product_or_orders)
    : 0;
  return summary;
}

function refundOnlyInput({ refundReasonCategories }) {
  return {
    soldUnits: 60,
    salesAmount: 6000,
    refundUnits: 6,
    refundAmount: 600,
    sourceCoverage: ["Shopify orders", "Shopify refunds"],
    returnRefundRelationshipSummary: relationshipSummary({
      sold_units: 60,
      sold_orders: 60,
      refunded_units: 6,
      refunded_orders: 6,
      refunded_without_return_units: 6,
      refunded_without_return_orders: 6,
      attributed_refund_amount: 600,
      refund_amount_without_return: 600,
      relationship_match_confidence_avg: 1,
      relationship_match_confidence_min: 1,
      refund_reason_categories: refundReasonCategories,
    }),
  };
}
