export const SOURCE_WEIGHTS = {
  shopifyProducts: 18,
  shopifyOrders: 18,
  shopifyReturns: 18,
  judgemeReviews: 14,
  chatmeReviews: 10,
  csvReviews: 8,
  supportTickets: 8,
  pdpQuestions: 6,
};

export const PRODUCT_PULSE_SCORING_VERSION = "return_refund_relationship_v2";

const PRODUCT_REASON_CATEGORIES = new Set([
  "product_quality",
  "damaged_or_defective",
  "not_as_described",
  "size_or_fit",
  "wrong_item",
]);

const OPERATIONAL_REASON_CATEGORIES = new Set([
  "shipping_issue",
  "fulfillment_issue",
  "customer_service",
  "billing_or_adjustment",
  "goodwill",
]);

export function calculateCoverageScore(sources) {
  const totalWeight = sources.reduce((sum, source) => sum + source.weight, 0);
  if (!totalWeight) return 0;

  const connectedWeight = sources
    .filter((source) => source.connected)
    .reduce((sum, source) => sum + source.weight, 0);

  return Math.round((connectedWeight / totalWeight) * 100);
}

export function getCoverageState(score) {
  if (score >= 75) {
    return {
      tone: "success",
      label: "Strong coverage",
      message: "Product, return and review signals are enough for high-confidence diagnosis.",
    };
  }

  if (score >= 45) {
    return {
      tone: "warning",
      label: "Partial coverage",
      message: "The scan can run, but more sources will improve confidence and recommendations.",
    };
  }

  return {
    tone: "critical",
    label: "Low coverage",
    message: "Connect reviews or returns before relying on diagnosis recommendations.",
  };
}

export function calculateRiskScore(metrics) {
  return calculateProductScoreModel(metrics).riskScore;
}

export function calculateImpactScore(metrics) {
  return Math.round(calculateProductScoreModel(metrics).impactScore);
}

export function calculateProductScoreModel(input = {}, options = {}) {
  const metrics = normalizeScoreInput(input, options);
  const riskComponents = calculateRiskComponents(metrics, options);
  const impactFactors = calculateFinancialImpact(metrics, options);
  const confidenceFactors = calculateDiagnosisConfidence(metrics, riskComponents, options);
  const relationshipFactors = calculateRelationshipFactors(metrics, riskComponents, impactFactors, confidenceFactors);
  const relationshipExplanations = buildReturnRefundScoringExplanations(relationshipFactors);
  const priorityScore = calculatePriorityScore({
    riskScore: riskComponents.riskScore,
    confidenceScore: confidenceFactors.confidenceScore,
    impactScore: impactFactors.estimatedImpact,
    maxReferenceImpact: options.maxReferenceImpact,
  });

  return {
    riskScore: riskComponents.riskScore,
    confidenceScore: confidenceFactors.confidenceScore,
    impactScore: impactFactors.estimatedImpact,
    priorityScore,
    evidenceStrengthScore: confidenceFactors.evidenceStrengthScore,
    riskComponents,
    confidenceFactors,
    impactFactors,
    relationshipFactors,
    relationshipExplanations,
    scoringVersion: PRODUCT_PULSE_SCORING_VERSION,
  };
}

export function buildReturnRefundScoringExplanations(relationshipFactors = {}) {
  if (!relationshipFactors.hasRelationshipSummary) return [];
  const relationship = relationshipFactors.customerSignalBreakdown || {};
  const leakage = relationshipFactors.refundLeakage || {};
  const confidence = relationshipFactors.diagnosisConfidence || {};
  const explanations = [];

  if (relationship.linkedReturnRefundCount > 0) {
    explanations.push(`Risk increased because ${relationship.linkedReturnRefundCount} returned unit${relationship.linkedReturnRefundCount === 1 ? "" : "s"} also had attributed refunds.`);
  }

  if (relationship.returnOnlyCount > 0) {
    explanations.push(`Returns are present without matching refunds for ${relationship.returnOnlyCount} unit${relationship.returnOnlyCount === 1 ? "" : "s"}, so they are treated as product friction instead of confirmed financial loss.`);
  }

  if (relationship.refundOnlyCount > 0) {
    explanations.push(`Refund leakage includes ${relationship.refundOnlyCount} refunded unit${relationship.refundOnlyCount === 1 ? "" : "s"} without a matching return.`);
  }

  if (leakage.unattributedRefundAmount > 0) {
    explanations.push(`Confidence is lower because ${formatMoneyForExplanation(leakage.unattributedRefundAmount)} in refunds could not be safely attributed to this product.`);
  }

  if (confidence.pendingRelationshipPenalty > 0) {
    explanations.push("Pending returns are included as unresolved friction and are not overweighted until their financial outcome is known.");
  }

  if (relationship.linkedReturnRefundCount > 0 || leakage.attributedRefundAmount > 0) {
    explanations.push("Financial exposure separates confirmed attributed refunds from return-only future risk and unattributed refund context.");
  }

  return explanations;
}

export function getRiskTone(score) {
  if (score >= 75) return "critical";
  if (score >= 55) return "warning";
  if (score >= 35) return "info";
  return "success";
}

export function getRiskLabel(score) {
  if (score >= 75) return "High risk";
  if (score >= 55) return "Watch";
  if (score >= 35) return "Emerging";
  return "Healthy";
}

export function validateCreditBalance(availableCredits, requestedProducts = 1) {
  if (!Number.isInteger(requestedProducts) || requestedProducts < 1) {
    return { valid: false, message: "Choose at least one product to diagnose." };
  }

  if (availableCredits < requestedProducts) {
    return {
      valid: false,
      message: `Diagnosis needs ${requestedProducts} credit${requestedProducts === 1 ? "" : "s"}, but only ${availableCredits} are available.`,
    };
  }

  return { valid: true, message: "Credits available." };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalizeScoreInput(input = {}, options = {}) {
  const rawReturnRate = normalizeRate(input.returnRate, 0, 0);
  const rawRefundRate = normalizeRate(input.refundRate, 0, 0);
  const soldUnits = number(input.soldUnits) || ((rawReturnRate > 0 || rawRefundRate > 0) ? 100 : 0);
  const returnUnits = number(input.returnUnits) || (soldUnits && rawReturnRate ? Math.round(rawReturnRate * soldUnits) : 0);
  const refundUnits = number(input.refundUnits) || (soldUnits && rawRefundRate ? Math.round(rawRefundRate * soldUnits) : 0);
  const reviewCount = number(input.reviewCount ?? input.totalReviews ?? input.csvReviewRatingCount);
  const negativeReviewCount = number(input.negativeReviewCount ?? input.csvLowRatingCount);
  const sourceCoverage = Array.isArray(input.sourceCoverage) ? input.sourceCoverage.filter(Boolean) : [];
  const independentSourceCount = number(input.independentSourceCount ?? countIndependentSources({
    soldUnits,
    returnUnits,
    refundUnits,
    reviewCount,
    contentIssueCount: number(input.contentIssueCount ?? input.issueCount),
    sentimentTotal: number(input.sentimentTotal ?? input.textInsights?.sentiment?.total),
    sourceCoverage,
  }));
  const signalEventCount = number(input.signalEventCount
    ?? input.customerSignalCount
    ?? (returnUnits + refundUnits + negativeReviewCount + number(input.contentIssueCount ?? input.issueCount)));
  const effectiveSampleSize = number(input.effectiveSampleSize ?? (
    returnUnits
    + refundUnits
    + reviewCount
    + number(input.contentIssueCount ?? input.issueCount)
    + number(input.sentimentEventCount ?? 0)
  ));
  const salesAmount = number(input.salesAmount);
  const refundAmount = number(input.refundAmount);
  const avgUnitRevenue = number(input.avgUnitRevenue) || (soldUnits > 0 && salesAmount > 0
    ? salesAmount / soldUnits
    : refundUnits > 0 && refundAmount > 0
      ? refundAmount / refundUnits
      : 0);
  const returnRefundRelationship = normalizeReturnRefundRelationshipSummary(input.returnRefundRelationshipSummary);

  return {
    soldUnits,
    returnUnits,
    refundUnits,
    refundAmount,
    salesAmount,
    revenueAtRisk: number(input.revenueAtRisk),
    marginAtRisk: number(input.marginAtRisk),
    avgUnitRevenue,
    returnRate: normalizeRate(input.returnRate, returnUnits, soldUnits),
    refundRate: normalizeRate(input.refundRate, refundUnits, soldUnits),
    storeReturnBaseline: normalizeBaseline(input.storeReturnBaseline ?? input.storeAvgReturnRate, options.defaultReturnBaseline ?? 0.04),
    storeRefundBaseline: normalizeBaseline(input.storeRefundBaseline ?? input.storeAvgRefundRate, options.defaultRefundBaseline ?? 0.025),
    reviewCount,
    negativeReviewCount,
    negativeReviewRate: normalizeRate(input.negativeReviewRate ?? input.csvNegativeRatingRate, negativeReviewCount, reviewCount),
    storeNegativeReviewBaseline: normalizeBaseline(input.storeNegativeReviewBaseline ?? input.storeAvgNegativeReviewRate, options.defaultNegativeReviewBaseline ?? 0.12),
    avgRating: number(input.avgRating ?? input.reviewRating ?? input.csvAverageRating),
    sentimentTotal: number(input.sentimentTotal ?? input.textInsights?.sentiment?.total),
    sentimentNegativeCount: number(input.sentimentNegativeCount ?? input.textInsights?.sentiment?.negative),
    subjectiveNegativeCount: number(input.subjectiveNegativeCount ?? input.textInsights?.subjectiveNegativity?.count),
    subjectiveNegativeRatio: number(input.subjectiveNegativeRatio ?? input.textInsights?.subjectiveNegativity?.ratio),
    contentIssueCount: number(input.contentIssueCount ?? input.issueCount),
    contentQualityRisk: number(input.contentQualityRisk ?? input.contentRisk),
    variantCount: number(input.variantCount),
    affectedVariantCount: number(input.affectedVariantCount ?? input.affectedVariants?.length),
    affectedVariantSignalCount: number(input.affectedVariantSignalCount ?? input.affectedVariantUnits),
    strongestVariantSignalCount: number(input.strongestVariantSignalCount ?? input.topAffectedVariantCount),
    recentSignalUnits: number(input.recentSignalUnits ?? input.recentSignals),
    signalEventCount,
    effectiveSampleSize,
    sourceCoverage,
    sourceCount: number(input.sourceCount ?? sourceCoverage.length),
    independentSourceCount,
    productMatchConfidence: normalizeConfidence(input.productMatchConfidence ?? input.matchConfidence ?? 1),
    sourceAgreement: Boolean(input.sourceAgreement),
    orderAccessDenied: Boolean(input.orderAccessDenied),
    missingOrders: Boolean(input.missingOrders ?? input.orderAccessDenied),
    missingReturns: Boolean(input.missingReturns),
    missingRefunds: Boolean(input.missingRefunds),
    dataQualityIncomplete: Boolean(input.dataQualityIncomplete ?? input.orderAccessDenied),
    scoreBreakdownReconstructed: Boolean(input.scoreBreakdownReconstructed),
    staleEvidence: Boolean(input.staleEvidence),
    duplicateSignalPenalty: number(input.duplicateSignalPenalty),
    subjectiveOnlyIssue: Boolean(input.subjectiveOnlyIssue),
    singleSource: Boolean(input.singleSource),
    calculationState: input.calculationState || "calculated_from_persisted_components",
    windowDays: number(input.windowDays) || 90,
    returnRefundRelationshipSummary: input.returnRefundRelationshipSummary || null,
    returnRefundRelationship,
  };
}

function calculateRiskComponents(metrics, options = {}) {
  const relationshipRisk = calculateRelationshipRiskAdjustment(metrics);
  const hasEvidence = metrics.returnUnits
    || metrics.refundUnits
    || metrics.negativeReviewCount
    || metrics.sentimentNegativeCount
    || metrics.contentIssueCount
    || metrics.refundAmount
    || relationshipRisk.relationshipScore;
  const base = hasEvidence ? clamp(number(options.baseRisk ?? 6), 5, 8) : 0;
  const returnsRateScore = calculateSmoothedRateRisk({
    events: metrics.returnUnits,
    population: metrics.soldUnits,
    observedRate: metrics.returnRate,
    baseline: metrics.storeReturnBaseline,
    maxScore: 25,
    priorStrength: number(options.returnPriorStrength) || 20,
    targetSampleSize: number(options.targetReturnSampleSize) || 60,
    severityScale: number(options.returnSeverityScale) || 0.065,
  });
  const highReturnPressure = metrics.returnUnits >= 3 && metrics.soldUnits >= 5 && metrics.returnRate > metrics.storeReturnBaseline + 0.25
    ? clamp(8 + (metrics.returnRate - metrics.storeReturnBaseline) * 14 + Math.log1p(metrics.returnUnits) * 1.2, 0, 25)
    : 0;
  const returnsScore = clamp(Math.max(returnsRateScore, highReturnPressure), 0, 25);
  const refundRateScore = calculateSmoothedRateRisk({
    events: metrics.refundUnits,
    population: metrics.soldUnits,
    observedRate: metrics.refundRate,
    baseline: metrics.storeRefundBaseline,
    maxScore: 15,
    priorStrength: number(options.refundPriorStrength) || 20,
    targetSampleSize: number(options.targetRefundSampleSize) || 60,
    severityScale: number(options.refundSeverityScale) || 0.045,
  });
  const highRefundPressure = metrics.soldUnits > 10 && metrics.refundRate > 0.2 && metrics.refundUnits >= 3
    ? clamp(7 + (metrics.refundRate - 0.2) * 34 + Math.log1p(metrics.refundUnits) * 1.1, 0, 20)
    : 0;
  const rawRefundScore = clamp(Math.max(refundRateScore, highRefundPressure), 0, 20);
  const refund_score = clamp(rawRefundScore * relationshipRisk.refundScoreMultiplier, 0, 20);
  const reviews_score = calculateReviewRisk(metrics, options);
  const sentiment_score = calculateSentimentRisk(metrics, options);
  const content_gap_score = clamp(Math.max(
    number(metrics.contentQualityRisk),
    metrics.contentIssueCount ? 4 + Math.log1p(metrics.contentIssueCount) * 4.5 : 0,
  ), 0, 15);
  const variant_score = calculateVariantRisk(metrics);
  const familyRisks = [
    returnsScore,
    reviews_score,
    sentiment_score,
    content_gap_score,
    refund_score,
    variant_score,
    relationshipRisk.relationshipScore,
  ];
  const activeFamilyCount = familyRisks.filter((score) => score >= 3).length;
  const agreement_points = (metrics.sourceAgreement ? 4 : 0) + Math.max(0, activeFamilyCount - 1) * 2.2;
  const agreement_bonus = clamp(agreement_points, 0, 8);
  const recentShare = metrics.signalEventCount > 0 ? metrics.recentSignalUnits / metrics.signalEventCount : 0;
  const recency_points = hasEvidence ? recentShare * 6 + (metrics.recentSignalUnits >= 3 ? 1.5 : 0) : 0;
  const recency_bonus = clamp(recency_points, 0, 5);
  const rawScore = base
    + returnsScore
    + reviews_score
    + sentiment_score
    + content_gap_score
    + refund_score
    + variant_score
    + relationshipRisk.relationshipScore
    + agreement_bonus
    + recency_bonus;
  const riskScore = Math.round(clamp(rawScore, 0, 100));

  return {
    base: roundScore(base),
    returnsScore: roundScore(returnsScore),
    reviewsScore: roundScore(reviews_score),
    sentimentScore: roundScore(sentiment_score),
    contentGapScore: roundScore(content_gap_score),
    refundScore: roundScore(refund_score),
    rawRefundScore: roundScore(rawRefundScore),
    variantScore: roundScore(variant_score),
    relationshipScore: roundScore(relationshipRisk.relationshipScore),
    returnedAndRefundedRisk: roundScore(relationshipRisk.returnedAndRefundedRisk),
    returnOnlyRisk: roundScore(relationshipRisk.returnOnlyRisk),
    refundOnlyProductRisk: roundScore(relationshipRisk.refundOnlyProductRisk),
    exchangeOrReplacementRisk: roundScore(relationshipRisk.exchangeOrReplacementRisk),
    pendingReturnRisk: roundScore(relationshipRisk.pendingReturnRisk),
    refundScoreMultiplier: roundScore(relationshipRisk.refundScoreMultiplier),
    refundAttributionRate: roundScore(relationshipRisk.refundAttributionRate * 100),
    relationshipMatchConfidence: roundScore(relationshipRisk.relationshipMatchConfidence * 100),
    agreementBonus: roundScore(agreement_bonus),
    recencyBonus: roundScore(recency_bonus),
    rawScore: roundScore(rawScore),
    calculated: riskScore,
    riskScore,
    calculationState: metrics.calculationState,
  };
}

function calculateRelationshipRiskAdjustment(metrics) {
  const relationship = metrics.returnRefundRelationship;
  if (!relationship?.hasRelationshipSignals) {
    return {
      relationshipScore: 0,
      returnedAndRefundedRisk: 0,
      returnOnlyRisk: 0,
      refundOnlyProductRisk: 0,
      exchangeOrReplacementRisk: 0,
      pendingReturnRisk: 0,
      refundScoreMultiplier: 1,
      refundAttributionRate: relationship?.refundAttributionRate || 0,
      relationshipMatchConfidence: relationship?.relationshipMatchConfidenceAvg || 0,
    };
  }

  const soldUnits = Math.max(metrics.soldUnits, relationship.soldUnits, 1);
  const confidenceSupport = 0.65 + 0.35 * relationship.relationshipMatchConfidenceAvg;
  const reason = relationship.reasonProfile;
  const productReasonWeight = reason.reasonedUnits
    ? clamp(0.55 + reason.productReasonShare * 0.72 - reason.operationalReasonShare * 0.38, 0.25, 1.2)
    : 0.74;

  const returnedAndRefundedRisk = calculateRateSeverity(relationship.returnedAndRefundedUnits / soldUnits, 14, 0.055) * confidenceSupport;
  const returnOnlyRisk = calculateRateSeverity(relationship.returnedNotRefundedUnits / soldUnits, 7, 0.11) * (0.75 + 0.25 * relationship.relationshipMatchConfidenceAvg);
  const refundOnlyProductRisk = calculateRateSeverity(relationship.refundedWithoutReturnUnits / soldUnits, 12, 0.05) * productReasonWeight;
  const exchangeOrReplacementRisk = calculateRateSeverity(relationship.exchangeOrReplacementUnits / soldUnits, 5, 0.1) * 0.75;
  const pendingReturnRisk = calculateRateSeverity(relationship.pendingReturnUnits / soldUnits, 3, 0.16) * 0.5;
  const relationshipScore = clamp(
    returnedAndRefundedRisk
    + returnOnlyRisk
    + refundOnlyProductRisk
    + exchangeOrReplacementRisk
    + pendingReturnRisk,
    0,
    24,
  );

  const hasRefundRelationshipData = relationship.totalRefundAmountRelated > 0 || relationship.refundedUnits > 0 || metrics.refundAmount > 0;
  const refundAttributionRate = hasRefundRelationshipData
    ? clamp(relationship.refundAttributionRate || 0, 0, 1)
    : 1;
  const refundScoreMultiplier = hasRefundRelationshipData
    ? clamp(0.35 + refundAttributionRate * 0.65 - reason.operationalReasonShare * 0.35, 0.2, 1)
    : 1;

  return {
    relationshipScore,
    returnedAndRefundedRisk,
    returnOnlyRisk,
    refundOnlyProductRisk,
    exchangeOrReplacementRisk,
    pendingReturnRisk,
    refundScoreMultiplier,
    refundAttributionRate,
    relationshipMatchConfidence: relationship.relationshipMatchConfidenceAvg,
  };
}

function calculateReviewRisk(metrics, options = {}) {
  const ratingDeficitSeverity = metrics.avgRating > 0
    ? clamp((4.15 - metrics.avgRating) * 9, 0, 22)
    : 0;

  if (!metrics.reviewCount) {
    return calculateRatingOnlyReviewRisk(metrics, ratingDeficitSeverity);
  }

  const smoothedNegativeRate = smoothRate({
    events: metrics.negativeReviewCount,
    population: metrics.reviewCount,
    baseline: metrics.storeNegativeReviewBaseline,
    priorStrength: number(options.reviewPriorStrength) || 12,
  });
  const excessNegativeRate = Math.max(smoothedNegativeRate - metrics.storeNegativeReviewBaseline, 0);
  const reviewSampleSufficiency = sampleSufficiency(metrics.reviewCount, number(options.targetReviewSampleSize) || 25);
  const negativeRateSeverity = metrics.negativeReviewCount
    ? 25 * (1 - Math.exp(-excessNegativeRate / (number(options.reviewSeverityScale) || 0.1)))
    : 0;
  const negativeCountSupport = metrics.negativeReviewCount <= 1
    ? 0.25
    : metrics.negativeReviewCount === 2
      ? 0.45
      : 1;
  const ratingSampleSupport = metrics.reviewCount >= 6
    ? 1
    : metrics.reviewCount >= 3
      ? 0.75
      : 0.45;
  const negativeRateRisk = negativeRateSeverity * negativeCountSupport;
  const ratingRisk = ratingDeficitSeverity * ratingSampleSupport;

  return clamp(Math.max(negativeRateRisk, ratingRisk) * reviewSampleSufficiency, 0, 25);
}

function calculateRatingOnlyReviewRisk(metrics, ratingDeficitSeverity) {
  if (!ratingDeficitSeverity) return 0;
  const supportingFamilyCount = [
    metrics.returnUnits >= 2 || metrics.returnRate >= 0.12,
    metrics.refundUnits >= 2 || metrics.refundRate >= 0.07,
    metrics.contentIssueCount >= 2 || metrics.contentQualityRisk >= 6,
    metrics.sentimentNegativeCount >= 2,
  ].filter(Boolean).length;
  const support = supportingFamilyCount >= 3
    ? 0.68
    : supportingFamilyCount === 2
      ? 0.52
      : supportingFamilyCount === 1
        ? 0.32
        : 0.18;

  return clamp(ratingDeficitSeverity * support, 0, 12);
}

function calculateSentimentRisk(metrics, options = {}) {
  if (!metrics.sentimentTotal || !metrics.sentimentNegativeCount) return 0;
  const sharesReviewSource = options.sentimentSharesReviewSource !== false;
  const maxScore = sharesReviewSource ? 6 : 15;
  const negativeRatio = metrics.sentimentNegativeCount / Math.max(metrics.sentimentTotal, 1);
  const objectiveRatio = Math.max(0, (metrics.sentimentNegativeCount - metrics.subjectiveNegativeCount) / Math.max(metrics.sentimentTotal, 1));
  const objectiveRisk = maxScore * clamp((objectiveRatio - 0.08) / 0.62, 0, 1);
  const subjectiveSupport = metrics.subjectiveNegativeCount <= 1
    ? 0.25
    : metrics.subjectiveNegativeCount === 2
      ? 0.5
      : Math.min(1, 0.62 + Math.log1p(metrics.subjectiveNegativeCount) / 4);
  const subjectiveRisk = maxScore * 0.45 * clamp(metrics.subjectiveNegativeRatio || negativeRatio, 0, 1) * subjectiveSupport;
  const sampleSupport = sampleSufficiency(metrics.sentimentTotal, 20);
  return clamp((objectiveRisk + subjectiveRisk) * sampleSupport, 0, maxScore);
}

function calculateVariantRisk(metrics) {
  if (metrics.variantCount <= 1) return 0;
  const totalSignals = Math.max(metrics.signalEventCount, metrics.affectedVariantSignalCount, 1);
  const strongestSignals = metrics.strongestVariantSignalCount || metrics.affectedVariantSignalCount;
  if (strongestSignals < 2) return 0;
  const concentration = strongestSignals / totalSignals;
  const concentrationScore = Math.max(0, concentration - 0.45) * 18;
  const sampleSupport = sampleSufficiency(strongestSignals, 8);
  return clamp((concentrationScore + Math.log1p(strongestSignals) * 1.35) * sampleSupport, 0, 10);
}

function calculateDiagnosisConfidence(metrics, riskComponents) {
  const coverageScore = clamp(metrics.sourceCount * 5, 0, 24);
  const independentSourceScore = clamp(metrics.independentSourceCount * 7, 0, 18);
  const effectiveSampleScore = clamp(sampleSufficiency(metrics.effectiveSampleSize, 80) * 24, 0, 24);
  const productMatchScore = clamp(metrics.productMatchConfidence * 14, 0, 14);
  const relationshipConfidence = calculateRelationshipConfidenceFactors(metrics);
  const agreementScore = clamp(
    (metrics.sourceAgreement ? 8 : 0)
    + Math.max(0, [riskComponents.returnsScore, riskComponents.reviewsScore, riskComponents.refundScore, riskComponents.sentimentScore, riskComponents.contentGapScore, riskComponents.relationshipScore].filter((score) => score >= 3).length - 1) * 2.2,
    0,
    15,
  );
  const freshnessScore = clamp(metrics.recentSignalUnits > 0
    ? 4 + Math.min(6, (metrics.recentSignalUnits / Math.max(metrics.signalEventCount, 1)) * 8)
    : 0, 0, 10);
  const penalties = {
    missingOrdersPenalty: metrics.missingOrders ? 10 : 0,
    missingReturnsPenalty: metrics.missingReturns ? 6 : 0,
    missingRefundsPenalty: metrics.missingRefunds ? 5 : 0,
    lowSalesSamplePenalty: metrics.soldUnits > 0 && metrics.soldUnits < 5 ? 8 : 0,
    staleEvidencePenalty: metrics.staleEvidence ? 5 : 0,
    weakProductMatchPenalty: metrics.productMatchConfidence < 0.75 ? 8 : 0,
    duplicateSignalPenalty: clamp(metrics.duplicateSignalPenalty, 0, 8),
    singleSourcePenalty: metrics.independentSourceCount < 2 ? 7 : 0,
    subjectiveOnlyIssuePenalty: metrics.subjectiveOnlyIssue ? 10 : 0,
    reconstructedScorePenalty: metrics.scoreBreakdownReconstructed ? 5 : 0,
    refundAttributionPenalty: relationshipConfidence.refundAttributionPenalty,
    pendingRelationshipPenalty: relationshipConfidence.pendingRelationshipPenalty,
    relationshipUnknownPenalty: relationshipConfidence.relationshipUnknownPenalty,
    missingRelationshipReasonPenalty: relationshipConfidence.missingRelationshipReasonPenalty,
  };
  const penaltyTotal = Object.values(penalties).reduce((sum, value) => sum + value, 0);
  const confidenceRaw = coverageScore
    + independentSourceScore
    + effectiveSampleScore
    + productMatchScore
    + agreementScore
    + freshnessScore
    + relationshipConfidence.relationshipMatchScore
    + relationshipConfidence.relationshipReasonScore
    - penaltyTotal;
  const strongReviewFallback = metrics.soldUnits < 5 && metrics.reviewCount >= 10 && agreementScore >= 10;
  const sampleSizeCap = metrics.soldUnits < 5 && metrics.reviewCount < 5
    ? 65
    : strongReviewFallback
      ? 88
      : metrics.effectiveSampleSize < 5
        ? 65
        : metrics.effectiveSampleSize < 15
          ? 80
          : metrics.effectiveSampleSize < 30
            ? 88
            : 99;
  const sourceIndependenceCap = metrics.independentSourceCount < 2
    ? 70
    : metrics.singleSource
      ? 75
      : 99;
  const dataQualityCap = metrics.dataQualityIncomplete ? 85 : 99;
  const reconstructionCap = metrics.scoreBreakdownReconstructed ? 90 : 99;
  const cap = Math.min(sampleSizeCap, sourceIndependenceCap, dataQualityCap, reconstructionCap);
  const confidenceScore = Math.round(clamp(confidenceRaw, 0, cap));
  const signalVolumeScore = effectiveSampleScore;
  const sourceAgreementScore = agreementScore;
  const recencyScore = freshnessScore;
  const evidenceStrengthScore = Math.round(clamp(
    signalVolumeScore * 1.3
    + independentSourceScore * 1.4
    + sourceAgreementScore * 1.3
    + recencyScore * 1.1
    + relationshipConfidence.relationshipMatchScore * 1.2
    + relationshipConfidence.relationshipReasonScore,
    0,
    100,
  ));

  return {
    coverageScore: roundScore(coverageScore),
    independentSourceScore: roundScore(independentSourceScore),
    effectiveSampleScore: roundScore(effectiveSampleScore),
    productMatchScore: roundScore(productMatchScore),
    relationshipMatchScore: roundScore(relationshipConfidence.relationshipMatchScore),
    relationshipReasonScore: roundScore(relationshipConfidence.relationshipReasonScore),
    agreementScore: roundScore(agreementScore),
    freshnessScore: roundScore(freshnessScore),
    signalVolumeScore: roundScore(signalVolumeScore),
    sourceAgreementScore: roundScore(sourceAgreementScore),
    recencyScore: roundScore(recencyScore),
    penalties: roundScore(penaltyTotal),
    ...Object.fromEntries(Object.entries(penalties).map(([key, value]) => [key, roundScore(value)])),
    confidenceRaw: roundScore(confidenceRaw),
    confidenceScore,
    maxConfidence: cap,
    sampleSizeCap,
    sourceIndependenceCap,
    dataQualityCap,
    reconstructionCap,
    effectiveSampleSize: roundScore(metrics.effectiveSampleSize),
    independentSourceCount: metrics.independentSourceCount,
    relationshipMatchConfidenceAvg: roundScore((metrics.returnRefundRelationship?.relationshipMatchConfidenceAvg || 0) * 100),
    refundAttributionRate: roundScore((metrics.returnRefundRelationship?.refundAttributionRate || 0) * 100),
    evidenceStrengthScore,
    calculationState: metrics.calculationState,
  };
}

function calculateRelationshipConfidenceFactors(metrics) {
  const relationship = metrics.returnRefundRelationship;
  if (!relationship?.hasRelationshipSignals) {
    return {
      relationshipMatchScore: 0,
      relationshipReasonScore: 0,
      refundAttributionPenalty: 0,
      pendingRelationshipPenalty: 0,
      relationshipUnknownPenalty: 0,
      missingRelationshipReasonPenalty: 0,
    };
  }

  const relationshipSignalCount = Math.max(relationship.totalRelationshipSignalUnits, relationship.relationshipUnknownCount, 1);
  const signalSupport = sampleSufficiency(relationshipSignalCount, 8);
  const relationshipMatchScore = clamp(relationship.relationshipMatchConfidenceAvg * 10 * signalSupport, 0, 10);
  const relationshipReasonScore = relationship.reasonProfile.reasonedUnits
    ? clamp(4 * (relationship.reasonProfile.reasonedUnits / relationshipSignalCount), 0, 4)
    : 0;
  const refundAttributionPenalty = relationship.totalRefundAmountRelated > 0
    ? clamp((1 - relationship.refundAttributionRate) * 8, 0, 8)
    : 0;
  const pendingRelationshipPenalty = relationship.pendingReturnUnits > 0
    ? clamp(1.5 + relationship.pendingReturnUnits * 1.2, 0, 5)
    : 0;
  const relationshipUnknownPenalty = relationship.relationshipUnknownCount > 0
    ? clamp(relationship.relationshipUnknownCount * 2, 0, 6)
    : 0;
  const missingRelationshipReasonPenalty = relationship.totalRelationshipSignalUnits > 0 && !relationship.reasonProfile.reasonedUnits
    ? 3
    : 0;

  return {
    relationshipMatchScore,
    relationshipReasonScore,
    refundAttributionPenalty,
    pendingRelationshipPenalty,
    relationshipUnknownPenalty,
    missingRelationshipReasonPenalty,
  };
}

function calculateFinancialImpact(metrics, options = {}) {
  const marginRate = clamp(number(options.marginRate ?? metrics.marginRate ?? 0.45), 0.05, 0.9);
  const processingCostPerReturn = number(options.returnProcessingCost ?? metrics.returnProcessingCost ?? 8);
  const windowDays = Math.max(number(metrics.windowDays) || 90, 1);
  const projectionDays = number(options.projectionDays) || 90;
  const avgUnitRevenue = metrics.avgUnitRevenue || 0;
  const smoothedReturnRate = smoothRate({
    events: metrics.returnUnits,
    population: metrics.soldUnits,
    baseline: metrics.storeReturnBaseline,
    priorStrength: 20,
  });
  const excessReturnRate = Math.max(smoothedReturnRate - metrics.storeReturnBaseline, 0);
  const projectedFutureUnits = metrics.soldUnits > 0 ? (metrics.soldUnits / windowDays) * projectionDays : 0;
  const lossPerReturn = avgUnitRevenue * marginRate + processingCostPerReturn;
  const returnProcessingCost = metrics.returnUnits * processingCostPerReturn;
  const lostMarginFromReturnedUnits = metrics.returnUnits * avgUnitRevenue * marginRate;
  const observedLoss = metrics.refundAmount + returnProcessingCost + lostMarginFromReturnedUnits;
  const projectedReturnLoss = projectedFutureUnits * excessReturnRate * lossPerReturn;
  const projectedLostRevenue = projectedFutureUnits * excessReturnRate * avgUnitRevenue;
  const projectedLostMargin = projectedFutureUnits * excessReturnRate * avgUnitRevenue * marginRate;
  const relationshipExposure = calculateRelationshipFinancialExposure(metrics, { avgUnitRevenue });
  const confirmedRefundAmount = relationshipExposure.confirmedRefundAmount;
  const ratingDeficit = metrics.avgRating > 0 ? clamp((4.2 - metrics.avgRating) / 3.2, 0, 1) : 0;
  const reviewSampleSupport = sampleSufficiency(metrics.reviewCount, 25);
  const estimatedConversionDelta = clamp((Math.max(metrics.negativeReviewRate - metrics.storeNegativeReviewBaseline, 0) * 0.12 + ratingDeficit * 0.035) * reviewSampleSupport, 0, 0.14);
  const revenueWindow = metrics.salesAmount > 0 ? (metrics.salesAmount / windowDays) * projectionDays : 0;
  const reviewConversionRevenueDrag = revenueWindow * estimatedConversionDelta;
  const reviewConversionMarginDrag = reviewConversionRevenueDrag * marginRate;
  const returnRevenueExposure = metrics.returnUnits * avgUnitRevenue;
  const refundMarginLoss = confirmedRefundAmount * marginRate;
  const observedLossAdjusted = confirmedRefundAmount + returnProcessingCost + lostMarginFromReturnedUnits;
  const calculatedRevenueAtRisk = projectedLostRevenue + returnRevenueExposure + reviewConversionRevenueDrag + relationshipExposure.relationshipAdjustedRefundAmount;
  const calculatedMarginAtRisk = projectedLostMargin + refundMarginLoss + returnProcessingCost + reviewConversionMarginDrag;
  const revenueAtRisk = roundMoney(Math.max(calculatedRevenueAtRisk, metrics.revenueAtRisk));
  const marginAtRisk = roundMoney(Math.max(calculatedMarginAtRisk, metrics.marginAtRisk));
  const impactMid = roundMoney(Math.max(observedLossAdjusted + projectedReturnLoss + reviewConversionMarginDrag, marginAtRisk, confirmedRefundAmount, metrics.marginAtRisk));
  const sampleMultiplier = metrics.effectiveSampleSize < 10 ? { low: 0.55, high: 1.75 } : metrics.effectiveSampleSize < 25 ? { low: 0.7, high: 1.45 } : { low: 0.84, high: 1.22 };

  return {
    observedLoss: roundMoney(observedLossAdjusted),
    rawObservedLoss: roundMoney(observedLoss),
    refunds: roundMoney(confirmedRefundAmount),
    refundValueAtRisk: roundMoney(relationshipExposure.relationshipAdjustedRefundAmount),
    relationshipExposure,
    returnProcessingCost: roundMoney(returnProcessingCost),
    lostMarginFromReturnedUnits: roundMoney(lostMarginFromReturnedUnits),
    projectedReturnLoss: roundMoney(projectedReturnLoss),
    projectedFutureReturnLoss: roundMoney(projectedReturnLoss),
    projectedLostRevenue: roundMoney(projectedLostRevenue),
    projectedLostMargin: roundMoney(projectedLostMargin),
    reviewConversionDrag: roundMoney(reviewConversionMarginDrag),
    reviewConversionRevenueDrag: roundMoney(reviewConversionRevenueDrag),
    reviewConversionMarginDrag: roundMoney(reviewConversionMarginDrag),
    estimatedConversionDelta: roundScore(estimatedConversionDelta * 100),
    revenueAtRisk,
    marginAtRisk,
    impactLow: roundMoney(impactMid * sampleMultiplier.low),
    impactMid,
    impactHigh: roundMoney(impactMid * sampleMultiplier.high),
    estimatedImpact: impactMid,
    impactScore: impactMid,
    avgUnitRevenue: roundMoney(avgUnitRevenue),
    marginRate,
    excessReturnRate: roundScore(excessReturnRate * 100),
    projectedFutureUnits: roundScore(projectedFutureUnits),
  };
}

function calculateRelationshipFinancialExposure(metrics, { avgUnitRevenue = 0 } = {}) {
  const relationship = metrics.returnRefundRelationship;
  if (!relationship?.hasRelationshipSignals && !relationship?.hasData) {
    return {
      hasRelationshipSummary: false,
      confirmedRefundAmount: roundMoney(metrics.refundAmount),
      attributedRefundAmount: roundMoney(metrics.refundAmount),
      refundAmountWithReturn: 0,
      refundAmountWithoutReturn: 0,
      unattributedRefundAmount: 0,
      estimatedFutureRefundFromReturnOnlyCases: 0,
      relationshipAdjustedRefundAmount: roundMoney(metrics.refundAmount),
      refundAttributionRate: 0,
      totalRefundAmountRelated: roundMoney(metrics.refundAmount),
    };
  }

  const attributedRefundAmount = roundMoney(relationship.attributedRefundAmount);
  const unattributedRefundAmount = roundMoney(relationship.unattributedRefundAmount);
  const returnOnlyRefundProbability = clamp(
    relationship.returnToRefundRate || metrics.storeRefundBaseline || 0.2,
    0.05,
    0.85,
  );
  const estimatedFutureRefundFromReturnOnlyCases = roundMoney(
    relationship.returnedNotRefundedUnits * avgUnitRevenue * returnOnlyRefundProbability,
  );
  const relationshipAdjustedRefundAmount = roundMoney(
    attributedRefundAmount
    + estimatedFutureRefundFromReturnOnlyCases
    + unattributedRefundAmount * 0.25,
  );

  return {
    hasRelationshipSummary: true,
    confirmedRefundAmount: attributedRefundAmount,
    attributedRefundAmount,
    refundAmountWithReturn: roundMoney(relationship.refundAmountWithReturn),
    refundAmountWithoutReturn: roundMoney(relationship.refundAmountWithoutReturn),
    unattributedRefundAmount,
    estimatedFutureRefundFromReturnOnlyCases,
    relationshipAdjustedRefundAmount,
    refundAttributionRate: roundScore(relationship.refundAttributionRate * 100),
    totalRefundAmountRelated: roundMoney(relationship.totalRefundAmountRelated),
  };
}

function calculateRelationshipFactors(metrics, riskComponents, impactFactors, confidenceFactors) {
  const relationship = metrics.returnRefundRelationship;
  if (!relationship?.hasData) {
    return {
      version: PRODUCT_PULSE_SCORING_VERSION,
      hasRelationshipSummary: false,
      productRisk: null,
      returnPressure: null,
      refundLeakage: null,
      financialExposure: impactFactors.relationshipExposure,
      diagnosisConfidence: null,
      customerSignalBreakdown: null,
    };
  }

  const productFrictionUnits = relationship.returnedAndRefundedUnits
    + relationship.returnedNotRefundedUnits
    + relationship.exchangeOrReplacementUnits
    + relationship.pendingReturnUnits;
  const soldUnits = Math.max(metrics.soldUnits, relationship.soldUnits, 1);
  const returnFrictionRate = productFrictionUnits / soldUnits;
  const returnPressureScore = clamp(
    100 * (1 - Math.exp(-returnFrictionRate / 0.18))
    + relationship.reasonProfile.productReasonShare * 10
    + Math.min(8, relationship.pendingReturnUnits * 1.4),
    0,
    100,
  );
  const refundRateRevenue = relationship.totalProductRevenue > 0
    ? relationship.attributedRefundAmount / relationship.totalProductRevenue
    : 0;
  const refundLeakageScore = clamp(
    100 * (1 - Math.exp(-refundRateRevenue / 0.18))
    + relationship.refundWithoutReturnRate * 28
    + (1 - (relationship.refundAttributionRate || 1)) * 10,
    0,
    100,
  );

  return {
    version: PRODUCT_PULSE_SCORING_VERSION,
    hasRelationshipSummary: true,
    productRisk: {
      score: riskComponents.relationshipScore,
      returnedAndRefundedRisk: riskComponents.returnedAndRefundedRisk,
      returnOnlyRisk: riskComponents.returnOnlyRisk,
      refundOnlyProductRisk: riskComponents.refundOnlyProductRisk,
      exchangeOrReplacementRisk: riskComponents.exchangeOrReplacementRisk,
      pendingReturnRisk: riskComponents.pendingReturnRisk,
      refundScoreMultiplier: riskComponents.refundScoreMultiplier,
    },
    returnPressure: {
      score: Math.round(returnPressureScore),
      productFrictionUnits,
      returnRateUnits: roundScore(relationship.returnRateUnits * 100),
      returnedAndRefundedUnits: relationship.returnedAndRefundedUnits,
      returnedNotRefundedUnits: relationship.returnedNotRefundedUnits,
      exchangeOrReplacementUnits: relationship.exchangeOrReplacementUnits,
      pendingReturnUnits: relationship.pendingReturnUnits,
      productReasonShare: roundScore(relationship.reasonProfile.productReasonShare * 100),
    },
    refundLeakage: {
      score: Math.round(refundLeakageScore),
      refundRateRevenue: roundScore(refundRateRevenue * 100),
      attributedRefundAmount: roundMoney(relationship.attributedRefundAmount),
      refundAmountWithReturn: roundMoney(relationship.refundAmountWithReturn),
      refundAmountWithoutReturn: roundMoney(relationship.refundAmountWithoutReturn),
      unattributedRefundAmount: roundMoney(relationship.unattributedRefundAmount),
      refundAttributionRate: roundScore(relationship.refundAttributionRate * 100),
    },
    financialExposure: impactFactors.relationshipExposure,
    diagnosisConfidence: {
      relationshipMatchScore: confidenceFactors.relationshipMatchScore,
      relationshipReasonScore: confidenceFactors.relationshipReasonScore,
      refundAttributionPenalty: confidenceFactors.refundAttributionPenalty,
      pendingRelationshipPenalty: confidenceFactors.pendingRelationshipPenalty,
      relationshipUnknownPenalty: confidenceFactors.relationshipUnknownPenalty,
      missingRelationshipReasonPenalty: confidenceFactors.missingRelationshipReasonPenalty,
      relationshipMatchConfidenceAvg: confidenceFactors.relationshipMatchConfidenceAvg,
      refundAttributionRate: confidenceFactors.refundAttributionRate,
    },
    customerSignalBreakdown: {
      linkedReturnRefundCount: relationship.returnedAndRefundedUnits,
      returnOnlyCount: relationship.returnedNotRefundedUnits,
      refundOnlyCount: relationship.refundedWithoutReturnUnits,
      exchangeOrReplacementCount: relationship.exchangeOrReplacementUnits,
      pendingOrUnknownCount: relationship.pendingReturnUnits + relationship.relationshipUnknownCount,
      unattributedRefundCount: relationship.unattributedRefundOrders,
    },
  };
}

export function calculatePriorityScore({ riskScore = 0, confidenceScore = 0, impactScore = 0, maxReferenceImpact = 25000 } = {}) {
  const normalizedLogImpactScore = clamp(
    100 * Math.log1p(Math.max(0, number(impactScore))) / Math.log1p(Math.max(1, number(maxReferenceImpact) || 25000)),
    0,
    100,
  );
  return Math.round(clamp(
    0.5 * number(riskScore)
    + 0.25 * number(confidenceScore)
    + 0.25 * normalizedLogImpactScore,
    0,
    100,
  ));
}

function calculateSmoothedRateRisk({ events, population, observedRate, baseline, maxScore, priorStrength, targetSampleSize, severityScale }) {
  if (!events && !observedRate) return 0;
  const smoothedRate = population > 0
    ? smoothRate({ events, population, baseline, priorStrength })
    : observedRate;
  const excessRate = Math.max(smoothedRate - baseline, 0);
  const sampleSupport = sampleSufficiency(population + events, targetSampleSize);
  const severity = maxScore * (1 - Math.exp(-excessRate / Math.max(severityScale, 0.001)));
  return clamp(severity * sampleSupport, 0, maxScore);
}

function calculateRateSeverity(rate, maxScore, severityScale) {
  return clamp(maxScore * (1 - Math.exp(-Math.max(0, number(rate)) / Math.max(severityScale, 0.001))), 0, maxScore);
}

function normalizeReturnRefundRelationshipSummary(summary) {
  if (!summary || typeof summary !== "object") return null;
  const buckets = summary.relationship_buckets || {};
  const soldUnits = number(summary.sold_units);
  const totalProductRevenue = number(summary.total_product_revenue);
  const attributedRefundAmount = number(summary.attributed_refund_amount);
  const unattributedRefundAmount = number(summary.unattributed_refund_amount);
  const returnedAndRefundedUnits = number(summary.returned_and_refunded_units);
  const returnedNotRefundedUnits = number(summary.returned_not_refunded_units);
  const refundedWithoutReturnUnits = number(summary.refunded_without_return_units);
  const exchangeOrReplacementUnits = number(summary.exchange_or_replacement_units);
  const pendingReturnUnits = number(summary.pending_return_units);
  const relationshipUnknownCount = number(summary.relationship_unknown_count);
  const totalRefundAmountRelated = number(summary.total_refund_amount_related_to_product_or_orders)
    || attributedRefundAmount + unattributedRefundAmount;
  const reasonProfile = buildRelationshipReasonProfile(summary);
  const totalRelationshipSignalUnits = returnedAndRefundedUnits
    + returnedNotRefundedUnits
    + refundedWithoutReturnUnits
    + exchangeOrReplacementUnits
    + pendingReturnUnits;
  const hasRelationshipSignals = Boolean(totalRelationshipSignalUnits || relationshipUnknownCount || unattributedRefundAmount);
  const hasData = Boolean(
    soldUnits
    || number(summary.sold_orders)
    || totalRelationshipSignalUnits
    || attributedRefundAmount
    || unattributedRefundAmount
    || totalProductRevenue
    || relationshipUnknownCount,
  );

  return {
    hasData,
    hasRelationshipSignals,
    soldUnits,
    soldOrders: number(summary.sold_orders),
    returnedUnits: number(summary.returned_units),
    returnedOrders: number(summary.returned_orders),
    refundedUnits: number(summary.refunded_units),
    refundedOrders: number(summary.refunded_orders),
    returnedAndRefundedUnits,
    returnedAndRefundedOrders: number(summary.returned_and_refunded_orders),
    returnedNotRefundedUnits,
    returnedNotRefundedOrders: number(summary.returned_not_refunded_orders),
    refundedWithoutReturnUnits,
    refundedWithoutReturnOrders: number(summary.refunded_without_return_orders),
    exchangeOrReplacementUnits,
    exchangeOrReplacementOrders: number(summary.exchange_or_replacement_orders),
    pendingReturnUnits,
    pendingReturnOrders: number(summary.pending_return_orders),
    unattributedRefundAmount,
    attributedRefundAmount,
    refundAmountWithReturn: number(summary.refund_amount_with_return),
    refundAmountWithoutReturn: number(summary.refund_amount_without_return),
    totalProductRevenue,
    totalRefundAmountRelated,
    relationshipMatchConfidenceAvg: normalizeConfidence(summary.relationship_match_confidence_avg),
    relationshipMatchConfidenceMin: normalizeConfidence(summary.relationship_match_confidence_min),
    relationshipUnknownCount,
    returnRateUnits: normalizeRelationshipRate(summary.return_rate_units, number(summary.returned_units), soldUnits),
    returnRateOrders: normalizeRelationshipRate(summary.return_rate_orders, number(summary.returned_orders), number(summary.sold_orders)),
    refundRateRevenue: normalizeRelationshipRate(summary.refund_rate_revenue, attributedRefundAmount, totalProductRevenue),
    refundRateUnits: normalizeRelationshipRate(summary.refund_rate_units, number(summary.refunded_units), soldUnits),
    returnToRefundRate: normalizeRelationshipRate(summary.return_to_refund_rate, returnedAndRefundedUnits, number(summary.returned_units)),
    refundWithReturnRate: normalizeRelationshipRate(summary.refund_with_return_rate, returnedAndRefundedUnits, number(summary.refunded_units)),
    refundWithoutReturnRate: normalizeRelationshipRate(summary.refund_without_return_rate, refundedWithoutReturnUnits, soldUnits),
    returnWithoutRefundRate: normalizeRelationshipRate(summary.return_without_refund_rate, returnedNotRefundedUnits, soldUnits),
    exchangeRate: normalizeRelationshipRate(summary.exchange_rate, exchangeOrReplacementUnits, soldUnits),
    unattributedRefundRate: normalizeRelationshipRate(summary.unattributed_refund_rate, unattributedRefundAmount, totalProductRevenue),
    refundAttributionRate: totalRefundAmountRelated > 0
      ? normalizeRelationshipRate(summary.refund_attribution_rate, attributedRefundAmount, totalRefundAmountRelated)
      : 0,
    reasonProfile,
    totalRelationshipSignalUnits,
    unattributedRefundOrders: number(buckets.unattributed_refund?.orders),
  };
}

function buildRelationshipReasonProfile(summary = {}) {
  const categories = mergeReasonCategories(summary.return_reason_categories, summary.refund_reason_categories);
  let productReasonUnits = 0;
  let operationalReasonUnits = 0;
  let unknownReasonUnits = 0;
  let reasonedUnits = 0;

  Object.entries(categories).forEach(([category, value]) => {
    const units = number(value);
    if (!units) return;
    reasonedUnits += units;
    if (PRODUCT_REASON_CATEGORIES.has(category)) {
      productReasonUnits += units;
    } else if (OPERATIONAL_REASON_CATEGORIES.has(category)) {
      operationalReasonUnits += units;
    } else if (category === "unknown") {
      unknownReasonUnits += units;
    }
  });

  return {
    categories,
    productReasonUnits,
    operationalReasonUnits,
    unknownReasonUnits,
    reasonedUnits,
    productReasonShare: reasonedUnits ? productReasonUnits / reasonedUnits : 0,
    operationalReasonShare: reasonedUnits ? operationalReasonUnits / reasonedUnits : 0,
    unknownReasonShare: reasonedUnits ? unknownReasonUnits / reasonedUnits : 0,
  };
}

function mergeReasonCategories(...categoryObjects) {
  return categoryObjects.reduce((merged, categoryObject) => {
    if (!categoryObject || typeof categoryObject !== "object") return merged;
    Object.entries(categoryObject).forEach(([key, value]) => {
      const units = number(value);
      if (units > 0) merged[key] = (merged[key] || 0) + units;
    });
    return merged;
  }, {});
}

function normalizeRelationshipRate(value, numerator, denominator) {
  const numeric = normalizeRate(value, 0, 0);
  if (numeric > 0) return numeric;
  return denominator > 0 ? clamp(number(numerator) / denominator, 0, 1) : 0;
}

function smoothRate({ events, population, baseline, priorStrength }) {
  const eventCount = number(events);
  const sampleCount = number(population);
  if (sampleCount <= 0) return 0;
  return (eventCount + number(priorStrength) * baseline) / (sampleCount + number(priorStrength));
}

function sampleSufficiency(sampleSize, targetSampleSize) {
  return clamp(Math.log1p(Math.max(0, number(sampleSize))) / Math.log1p(Math.max(1, number(targetSampleSize))), 0, 1);
}

function normalizeRate(value, events, population) {
  const numeric = number(value);
  if (numeric > 0) return clamp(numeric > 1 ? numeric / 100 : numeric, 0, 1);
  return population > 0 ? clamp(events / population, 0, 1) : 0;
}

function normalizeBaseline(value, fallback) {
  const numeric = normalizeRate(value, 0, 0);
  return numeric > 0 ? numeric : fallback;
}

function normalizeConfidence(value) {
  const numeric = number(value);
  if (numeric > 1) return clamp(numeric / 100, 0, 1);
  if (numeric > 0) return clamp(numeric, 0, 1);
  return 0;
}

function countIndependentSources({ soldUnits, returnUnits, refundUnits, reviewCount, contentIssueCount, sentimentTotal, sourceCoverage }) {
  const sourceNames = new Set((sourceCoverage || []).map((source) => String(source).toLowerCase()));
  let count = 0;
  if (soldUnits > 0 || sourceNames.has("shopify orders")) count += 1;
  if (returnUnits > 0 || sourceNames.has("shopify returns")) count += 1;
  if (refundUnits > 0 || sourceNames.has("shopify refunds")) count += 1;
  if (reviewCount > 0 || sourceNames.has("csv review ratings") || sourceNames.has("csv reviews") || sourceNames.has("judge.me reviews")) count += 1;
  if (sentimentTotal > 0) count += 1;
  if (contentIssueCount > 0 || sourceNames.has("shopify products")) count += 1;
  return count;
}

function number(value) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundScore(value) {
  return Math.round(number(value) * 10) / 10;
}

function roundMoney(value) {
  return Math.round(number(value) * 100) / 100;
}

function formatMoneyForExplanation(value) {
  return `$${Math.round(number(value)).toLocaleString("en-US")}`;
}
