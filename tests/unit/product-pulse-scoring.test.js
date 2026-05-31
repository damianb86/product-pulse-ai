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

  it("separates return pressure, refund leakage, customer signals, and estimated margin exposure", () => {
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

  it("uses solo purchase context to strengthen product-specific attribution when negative signals exist", () => {
    const baseInput = {
      soldUnits: 80,
      salesAmount: 8000,
      returnUnits: 8,
      refundUnits: 4,
      refundAmount: 400,
      sourceCoverage: ["Shopify orders", "Shopify returns", "Shopify refunds"],
      returnRefundRelationshipSummary: relationshipSummary({
        sold_units: 80,
        returned_units: 8,
        refunded_units: 4,
        returned_and_refunded_units: 4,
        returned_not_refunded_units: 4,
        attributed_refund_amount: 400,
        refund_amount_with_return: 400,
        relationship_match_confidence_avg: 1,
        relationship_match_confidence_min: 1,
        return_reason_categories: { product_quality: 8 },
      }),
    };
    const withoutContext = calculateProductScoreModel(baseInput);
    const withSoloContext = calculateProductScoreModel({
      ...baseInput,
      productPurchaseContextSummary: purchaseContextSummary({
        total_orders_containing_product: 30,
        total_units_sold: 80,
        solo_product_order_count: 24,
        multi_product_order_count: 6,
        single_unit_order_count: 14,
        multi_unit_order_count: 16,
        purchase_context_confidence: 88,
      }),
    });

    expect(withSoloContext.riskScore).toBeGreaterThan(withoutContext.riskScore);
    expect(withSoloContext.confidenceScore).toBeGreaterThan(withoutContext.confidenceScore);
    expect(withSoloContext.riskComponents.soloAttributionRisk).toBeGreaterThan(0);
    expect(withSoloContext.purchaseContextExplanations.join(" ")).toContain("usually bought alone");
  });

  it("reduces diagnosis confidence for weak order-level refunds in multi-product baskets", () => {
    const soloContext = calculateProductScoreModel({
      soldUnits: 100,
      salesAmount: 10000,
      refundUnits: 6,
      refundAmount: 600,
      sourceCoverage: ["Shopify orders", "Shopify refunds"],
      returnRefundRelationshipSummary: relationshipSummary({
        sold_units: 100,
        refunded_units: 0,
        unattributed_refund_amount: 600,
        total_refund_amount_related_to_product_or_orders: 600,
        relationship_unknown_count: 3,
      }),
      productPurchaseContextSummary: purchaseContextSummary({
        total_orders_containing_product: 40,
        total_units_sold: 100,
        solo_product_order_count: 34,
        multi_product_order_count: 6,
        purchase_context_confidence: 85,
      }),
    });
    const multiBasketContext = calculateProductScoreModel({
      soldUnits: 100,
      salesAmount: 10000,
      refundUnits: 6,
      refundAmount: 600,
      sourceCoverage: ["Shopify orders", "Shopify refunds"],
      returnRefundRelationshipSummary: relationshipSummary({
        sold_units: 100,
        refunded_units: 0,
        unattributed_refund_amount: 600,
        total_refund_amount_related_to_product_or_orders: 600,
        relationship_unknown_count: 3,
      }),
      productPurchaseContextSummary: purchaseContextSummary({
        total_orders_containing_product: 40,
        total_units_sold: 100,
        solo_product_order_count: 4,
        multi_product_order_count: 36,
        avg_distinct_products_per_order: 3.4,
        purchase_context_confidence: 85,
      }),
    });

    expect(multiBasketContext.confidenceScore).toBeLessThan(soloContext.confidenceScore);
    expect(multiBasketContext.confidenceFactors.purchaseContextMultiProductAttributionPenalty).toBeGreaterThan(0);
    expect(multiBasketContext.riskComponents.purchaseRefundScoreMultiplier).toBeLessThan(1);
    expect(multiBasketContext.purchaseContextExplanations.join(" ")).toContain("often bought with other products");
  });

  it("adds a bounded variant/fit modifier when multi-variant purchase context aligns with returns", () => {
    const withoutContext = calculateProductScoreModel({
      soldUnits: 90,
      salesAmount: 9000,
      returnUnits: 9,
      sourceCoverage: ["Shopify orders", "Shopify returns"],
      variantCount: 4,
      returnRefundRelationshipSummary: relationshipSummary({
        sold_units: 90,
        returned_units: 9,
        returned_not_refunded_units: 9,
        relationship_match_confidence_avg: 1,
        return_reason_categories: { size_or_fit: 9 },
      }),
    });
    const withContext = calculateProductScoreModel({
      soldUnits: 90,
      salesAmount: 9000,
      returnUnits: 9,
      sourceCoverage: ["Shopify orders", "Shopify returns"],
      variantCount: 4,
      returnRefundRelationshipSummary: relationshipSummary({
        sold_units: 90,
        returned_units: 9,
        returned_not_refunded_units: 9,
        relationship_match_confidence_avg: 1,
        return_reason_categories: { size_or_fit: 9 },
      }),
      productPurchaseContextSummary: purchaseContextSummary({
        total_orders_containing_product: 30,
        total_units_sold: 90,
        multi_variant_order_count: 7,
        purchase_context_segments: {
          multi_variant_orders: {
            orders: 7,
            sold_units: 21,
            returned_units: 5,
            refunded_units: 0,
            refund_amount: 0,
            return_rate_units: 5 / 21,
            refund_rate_units: 0,
            sufficient_data: true,
          },
        },
        purchase_context_confidence: 84,
      }),
    });

    expect(withContext.riskComponents.multiVariantPurchaseRisk).toBeGreaterThan(0);
    expect(withContext.riskScore).toBeGreaterThan(withoutContext.riskScore);
    expect(withContext.purchaseContextFactors.returnPressure.returnRateForMultiVariantOrders).toBeGreaterThan(0);
  });

  it("raises estimated margin exposure for bulk purchases with refund evidence without making healthy bulk risky", () => {
    const baseInput = {
      soldUnits: 120,
      salesAmount: 12000,
      returnUnits: 0,
      refundUnits: 8,
      refundAmount: 800,
      sourceCoverage: ["Shopify orders", "Shopify refunds"],
      returnRefundRelationshipSummary: relationshipSummary({
        sold_units: 120,
        refunded_units: 8,
        refunded_without_return_units: 8,
        attributed_refund_amount: 800,
        refund_amount_without_return: 800,
        relationship_match_confidence_avg: 1,
        refund_reason_categories: { damaged_or_defective: 8 },
      }),
    };
    const normalPurchase = calculateProductScoreModel(baseInput);
    const bulkPurchase = calculateProductScoreModel({
      ...baseInput,
      productPurchaseContextSummary: purchaseContextSummary({
        total_orders_containing_product: 40,
        total_units_sold: 120,
        multi_unit_order_count: 25,
        bulk_order_count: 12,
        avg_product_quantity_per_order: 3,
        purchase_context_confidence: 86,
        purchase_context_segments: {
          bulk_orders: {
            orders: 12,
            sold_units: 48,
            returned_units: 0,
            refunded_units: 6,
            refund_amount: 600,
            refund_rate_units: 0.125,
            sufficient_data: true,
          },
        },
      }),
    });
    const healthyBulk = calculateProductScoreModel({
      soldUnits: 120,
      salesAmount: 12000,
      returnUnits: 0,
      refundUnits: 0,
      sourceCoverage: ["Shopify orders"],
      productPurchaseContextSummary: purchaseContextSummary({
        total_orders_containing_product: 40,
        total_units_sold: 120,
        multi_unit_order_count: 25,
        bulk_order_count: 12,
        avg_product_quantity_per_order: 3,
        purchase_context_confidence: 86,
      }),
    });

    expect(bulkPurchase.impactFactors.purchaseContextExposure.bulkQuantityExposure).toBeGreaterThan(0);
    expect(bulkPurchase.impactScore).toBeGreaterThan(normalPurchase.impactScore);
    expect(healthyBulk.riskComponents.bulkQuantitySeverityRisk).toBe(0);
    expect(healthyBulk.riskScore).toBeLessThan(20);
  });

  it("exposes purchase-context return and refund segmentation only through backend factors", () => {
    const model = calculateProductScoreModel({
      soldUnits: 100,
      salesAmount: 10000,
      returnUnits: 10,
      refundUnits: 4,
      refundAmount: 400,
      sourceCoverage: ["Shopify orders", "Shopify returns", "Shopify refunds"],
      productPurchaseContextSummary: purchaseContextSummary({
        total_orders_containing_product: 35,
        total_units_sold: 100,
        solo_product_order_count: 15,
        multi_product_order_count: 20,
        purchase_context_confidence: 82,
        purchase_context_segments: {
          bought_alone: {
            orders: 15,
            sold_units: 35,
            returned_units: 2,
            refunded_units: 1,
            refund_amount: 100,
            return_rate_units: 2 / 35,
            refund_rate_units: 1 / 35,
            sufficient_data: true,
          },
          bought_with_others: {
            orders: 20,
            sold_units: 65,
            returned_units: 8,
            refunded_units: 3,
            refund_amount: 300,
            return_rate_units: 8 / 65,
            refund_rate_units: 3 / 65,
            sufficient_data: true,
          },
        },
      }),
    });

    expect(model.purchaseContextFactors.returnPressure.returnRateWhenBoughtAlone).toBeCloseTo(5.7, 1);
    expect(model.purchaseContextFactors.returnPressure.returnRateWhenBoughtWithOthers).toBeCloseTo(12.3, 1);
    expect(model.purchaseContextFactors.refundLeakage.refundRateWhenBoughtWithOthers).toBeCloseTo(4.6, 1);
    expect(model.purchaseContextFactors.customerSignalBreakdown.primaryContext).toBe("Mixed basket context");
  });

  it("keeps relationship opportunities contextual and does not blindly increase Product Risk", () => {
    const model = calculateProductScoreModel({
      soldUnits: 80,
      salesAmount: 8000,
      sourceCoverage: ["Shopify orders"],
      productRelationshipIntelligenceSummary: productRelationshipSummary({
        top_bought_together: [relationshipItem({
          related_product_title: "Care Kit",
          relationship_direction: "together",
          relationship_type: "same_order",
          lift: 2.8,
          delta_return_rate: 0,
          delta_refund_rate: 0,
        })],
        strongest_relationships: [relationshipItem({
          related_product_title: "Care Kit",
          relationship_direction: "together",
          relationship_type: "same_order",
          lift: 2.8,
        })],
      }),
    });

    expect(model.riskComponents.productRelationshipRiskAdjustment).toBe(0);
    expect(model.riskScore).toBeLessThan(30);
    expect(model.productRelationshipFactors.recommendedActionSignals.bundleOpportunity).toBe(true);
    expect(model.productRelationshipExplanations.join(" ")).toContain("Bought together");
  });

  it("lowers confidence when relationship-heavy baskets make weak refund attribution ambiguous", () => {
    const withoutRelationshipContext = calculateProductScoreModel({
      soldUnits: 60,
      salesAmount: 6000,
      refundUnits: 4,
      refundAmount: 400,
      sourceCoverage: ["Shopify orders", "Shopify refunds"],
      returnRefundRelationshipSummary: relationshipSummary({
        sold_units: 60,
        sold_orders: 40,
        refunded_units: 4,
        refunded_orders: 4,
        unattributed_refund_amount: 400,
        relationship_unknown_count: 4,
      }),
      productPurchaseContextSummary: purchaseContextSummary({
        total_orders_containing_product: 40,
        multi_product_order_count: 34,
        solo_product_order_count: 6,
        multi_product_basket_rate: 0.85,
        purchase_context_confidence: 78,
      }),
    });
    const withRelationshipContext = calculateProductScoreModel({
      soldUnits: 60,
      salesAmount: 6000,
      refundUnits: 4,
      refundAmount: 400,
      sourceCoverage: ["Shopify orders", "Shopify refunds"],
      returnRefundRelationshipSummary: relationshipSummary({
        sold_units: 60,
        sold_orders: 40,
        refunded_units: 4,
        refunded_orders: 4,
        unattributed_refund_amount: 400,
        relationship_unknown_count: 4,
      }),
      productPurchaseContextSummary: purchaseContextSummary({
        total_orders_containing_product: 40,
        multi_product_order_count: 34,
        solo_product_order_count: 6,
        multi_product_basket_rate: 0.85,
        purchase_context_confidence: 78,
      }),
      productRelationshipIntelligenceSummary: productRelationshipSummary({
        confidence: { score: 56, label: "Medium" },
        relationships_with_return_risk_impact: [relationshipItem({
          related_product_title: "Accessory Pack",
          relationship_direction: "together",
          relationship_type: "same_order",
          lift: 2.1,
          confidence: 56,
          confidence_label: "Medium",
          delta_return_rate: 0.1,
          delta_refund_rate: 0.08,
        })],
        strongest_relationships: [relationshipItem({
          related_product_title: "Accessory Pack",
          relationship_direction: "together",
          relationship_type: "same_order",
          lift: 2.1,
          confidence: 56,
          confidence_label: "Medium",
          delta_return_rate: 0.1,
          delta_refund_rate: 0.08,
        })],
      }),
    });

    expect(withRelationshipContext.confidenceFactors.productRelationshipAmbiguityPenalty).toBeGreaterThan(0);
    expect(withRelationshipContext.confidenceScore).toBeLessThan(withoutRelationshipContext.confidenceScore);
    expect(withRelationshipContext.productRelationshipExplanations.join(" ")).toContain("Diagnosis confidence is lower");
  });

  it("treats sequential relationships as opportunity instead of Product Risk", () => {
    const model = calculateProductScoreModel({
      soldUnits: 100,
      salesAmount: 10000,
      sourceCoverage: ["Shopify orders"],
      productRelationshipIntelligenceSummary: productRelationshipSummary({
        top_bought_after: [relationshipItem({
          related_product_title: "Refill Pack",
          relationship_direction: "after",
          relationship_type: "next_purchase",
          time_window: "30d_after",
          lift: 1.8,
          delta_return_rate: 0,
          delta_refund_rate: 0,
        })],
        strongest_relationships: [relationshipItem({
          related_product_title: "Refill Pack",
          relationship_direction: "after",
          relationship_type: "next_purchase",
          time_window: "30d_after",
          lift: 1.8,
        })],
      }),
    });

    expect(model.riskComponents.productRelationshipRiskAdjustment).toBe(0);
    expect(model.productRelationshipFactors.recommendedActionSignals.crossSellOpportunity).toBe(true);
    expect(model.productRelationshipExplanations.join(" ")).toContain("commercial opportunity rather than Product Risk");
  });

  it("blocks diagnosis when points are insufficient", () => {
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

function purchaseContextSummary(overrides = {}) {
  const totalOrders = Number(overrides.total_orders_containing_product ?? 20);
  const totalUnits = Number(overrides.total_units_sold ?? totalOrders);
  const summary = {
    schema_version: 1,
    product_id: "gid://shopify/Product/1",
    total_orders_containing_product: totalOrders,
    total_units_sold: totalUnits,
    total_revenue_if_available: Number(overrides.total_revenue_if_available ?? totalUnits * 100),
    solo_product_order_count: Number(overrides.solo_product_order_count ?? totalOrders),
    multi_product_order_count: Number(overrides.multi_product_order_count ?? 0),
    single_unit_order_count: Number(overrides.single_unit_order_count ?? totalOrders),
    multi_unit_order_count: Number(overrides.multi_unit_order_count ?? 0),
    bulk_order_count: Number(overrides.bulk_order_count ?? 0),
    multi_variant_order_count: Number(overrides.multi_variant_order_count ?? 0),
    avg_product_quantity_per_order: Number(overrides.avg_product_quantity_per_order ?? (totalOrders ? totalUnits / totalOrders : 0)),
    median_product_quantity_per_order: Number(overrides.median_product_quantity_per_order ?? 1),
    avg_distinct_products_per_order: Number(overrides.avg_distinct_products_per_order ?? 1),
    avg_total_units_per_order: Number(overrides.avg_total_units_per_order ?? 1),
    top_co_purchased_products: overrides.top_co_purchased_products || [],
    purchase_context_confidence: Number(overrides.purchase_context_confidence ?? 85),
    unknown_or_incomplete_order_count: Number(overrides.unknown_or_incomplete_order_count ?? 0),
    bulk_purchase_threshold: Number(overrides.bulk_purchase_threshold ?? 4),
    quantity_distribution: overrides.quantity_distribution || {},
    purchase_context_segments: overrides.purchase_context_segments || {},
    monthly_context: overrides.monthly_context || [],
    context_buckets: overrides.context_buckets || {},
  };
  summary.solo_purchase_rate = Number(overrides.solo_purchase_rate ?? (totalOrders ? summary.solo_product_order_count / totalOrders : 0));
  summary.multi_product_basket_rate = Number(overrides.multi_product_basket_rate ?? (totalOrders ? summary.multi_product_order_count / totalOrders : 0));
  summary.single_unit_purchase_rate = Number(overrides.single_unit_purchase_rate ?? (totalOrders ? summary.single_unit_order_count / totalOrders : 0));
  summary.multi_unit_purchase_rate = Number(overrides.multi_unit_purchase_rate ?? (totalOrders ? summary.multi_unit_order_count / totalOrders : 0));
  summary.bulk_purchase_rate = Number(overrides.bulk_purchase_rate ?? (totalOrders ? summary.bulk_order_count / totalOrders : 0));
  summary.multi_variant_order_rate = Number(overrides.multi_variant_order_rate ?? (totalOrders ? summary.multi_variant_order_count / totalOrders : 0));
  return summary;
}

function productRelationshipSummary(overrides = {}) {
  return {
    source_product_id: "gid://shopify/Product/1",
    relationship_model_version: "product_relationship_v1",
    schema_version: 1,
    data_basis: {
      same_order_available: true,
      customer_sequence_available: true,
      order_count: 20,
      customer_count: 16,
      known_basket_order_count: 20,
      unknown_basket_order_count: 0,
      ...(overrides.data_basis || {}),
    },
    confidence: {
      score: 82,
      label: "High",
      reasons: [],
      ...(overrides.confidence || {}),
    },
    top_bought_together: overrides.top_bought_together || [],
    top_bought_before: overrides.top_bought_before || [],
    top_bought_after: overrides.top_bought_after || [],
    strongest_relationships: overrides.strongest_relationships || [],
    emerging_relationships: overrides.emerging_relationships || [],
    relationships_with_return_risk_impact: overrides.relationships_with_return_risk_impact || [],
    relationships_with_cross_sell_opportunity: overrides.relationships_with_cross_sell_opportunity || [],
    warnings: overrides.warnings || [],
  };
}

function relationshipItem(overrides = {}) {
  return {
    source_product_id: "gid://shopify/Product/1",
    related_product_id: overrides.related_product_id || "gid://shopify/Product/related",
    related_product_title: overrides.related_product_title || "Related product",
    relationship_type: overrides.relationship_type || "same_order",
    relationship_direction: overrides.relationship_direction || "together",
    time_window: overrides.time_window || "same_order",
    relationship_rate: overrides.relationship_rate ?? 0.3,
    attach_rate: overrides.attach_rate ?? 0.3,
    related_product_base_rate: overrides.related_product_base_rate ?? 0.12,
    lift: overrides.lift ?? 2,
    relationship_strength_score: overrides.relationship_strength_score ?? 78,
    relationship_strength: overrides.relationship_strength || "strong",
    confidence: overrides.confidence ?? 82,
    confidence_label: overrides.confidence_label || "High",
    sample_size: overrides.sample_size ?? 5,
    trend: overrides.trend || "stable",
    delta_return_rate: overrides.delta_return_rate ?? 0,
    delta_refund_rate: overrides.delta_refund_rate ?? 0,
    warnings: overrides.warnings || [],
  };
}
