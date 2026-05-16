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
  };
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
  };
}

function calculateRiskComponents(metrics, options = {}) {
  const hasEvidence = metrics.returnUnits
    || metrics.refundUnits
    || metrics.negativeReviewCount
    || metrics.sentimentNegativeCount
    || metrics.contentIssueCount
    || metrics.refundAmount;
  const base = hasEvidence ? clamp(number(options.baseRisk ?? 6), 5, 8) : 0;
  const returnsScore = calculateSmoothedRateRisk({
    events: metrics.returnUnits,
    population: metrics.soldUnits,
    observedRate: metrics.returnRate,
    baseline: metrics.storeReturnBaseline,
    maxScore: 25,
    priorStrength: number(options.returnPriorStrength) || 20,
    targetSampleSize: number(options.targetReturnSampleSize) || 60,
    severityScale: number(options.returnSeverityScale) || 0.075,
  });
  const refundRateScore = calculateSmoothedRateRisk({
    events: metrics.refundUnits,
    population: metrics.soldUnits,
    observedRate: metrics.refundRate,
    baseline: metrics.storeRefundBaseline,
    maxScore: 15,
    priorStrength: number(options.refundPriorStrength) || 20,
    targetSampleSize: number(options.targetRefundSampleSize) || 60,
    severityScale: number(options.refundSeverityScale) || 0.055,
  });
  const highRefundPressure = metrics.soldUnits > 10 && metrics.refundRate > 0.2 && metrics.refundUnits >= 3
    ? clamp(5 + (metrics.refundRate - 0.2) * 28, 0, 15)
    : 0;
  const refund_score = clamp(Math.max(refundRateScore, highRefundPressure), 0, 15);
  const reviews_score = calculateReviewRisk(metrics, options);
  const sentiment_score = calculateSentimentRisk(metrics, options);
  const content_gap_score = clamp(Math.max(
    number(metrics.contentQualityRisk),
    metrics.contentIssueCount ? 3 + Math.log1p(metrics.contentIssueCount) * 4 : 0,
  ), 0, 15);
  const variant_score = calculateVariantRisk(metrics);
  const familyRisks = [
    returnsScore,
    reviews_score,
    sentiment_score,
    content_gap_score,
    refund_score,
    variant_score,
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
    variantScore: roundScore(variant_score),
    agreementBonus: roundScore(agreement_bonus),
    recencyBonus: roundScore(recency_bonus),
    rawScore: roundScore(rawScore),
    calculated: riskScore,
    riskScore,
    calculationState: metrics.calculationState,
  };
}

function calculateReviewRisk(metrics, options = {}) {
  if (!metrics.reviewCount || !metrics.negativeReviewCount) return 0;
  const smoothedNegativeRate = smoothRate({
    events: metrics.negativeReviewCount,
    population: metrics.reviewCount,
    baseline: metrics.storeNegativeReviewBaseline,
    priorStrength: number(options.reviewPriorStrength) || 12,
  });
  const excessNegativeRate = Math.max(smoothedNegativeRate - metrics.storeNegativeReviewBaseline, 0);
  const reviewSampleSufficiency = sampleSufficiency(metrics.reviewCount, number(options.targetReviewSampleSize) || 25);
  const negativeRateSeverity = 25 * (1 - Math.exp(-excessNegativeRate / (number(options.reviewSeverityScale) || 0.12)));
  const ratingDeficitSeverity = metrics.avgRating > 0
    ? clamp((4.15 - metrics.avgRating) * 9, 0, 22)
    : 0;
  const negativeCountSupport = metrics.negativeReviewCount <= 1
    ? 0.25
    : metrics.negativeReviewCount === 2
      ? 0.45
      : 1;

  return clamp(Math.max(negativeRateSeverity, ratingDeficitSeverity) * reviewSampleSufficiency * negativeCountSupport, 0, 25);
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
  const agreementScore = clamp(
    (metrics.sourceAgreement ? 8 : 0)
    + Math.max(0, [riskComponents.returnsScore, riskComponents.reviewsScore, riskComponents.refundScore, riskComponents.sentimentScore, riskComponents.contentGapScore].filter((score) => score >= 3).length - 1) * 2.2,
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
  };
  const penaltyTotal = Object.values(penalties).reduce((sum, value) => sum + value, 0);
  const confidenceRaw = coverageScore
    + independentSourceScore
    + effectiveSampleScore
    + productMatchScore
    + agreementScore
    + freshnessScore
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
    + recencyScore * 1.1,
    0,
    100,
  ));

  return {
    coverageScore: roundScore(coverageScore),
    independentSourceScore: roundScore(independentSourceScore),
    effectiveSampleScore: roundScore(effectiveSampleScore),
    productMatchScore: roundScore(productMatchScore),
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
    evidenceStrengthScore,
    calculationState: metrics.calculationState,
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
  const ratingDeficit = metrics.avgRating > 0 ? clamp((4.2 - metrics.avgRating) / 3.2, 0, 1) : 0;
  const reviewSampleSupport = sampleSufficiency(metrics.reviewCount, 25);
  const estimatedConversionDelta = clamp((Math.max(metrics.negativeReviewRate - metrics.storeNegativeReviewBaseline, 0) * 0.12 + ratingDeficit * 0.035) * reviewSampleSupport, 0, 0.14);
  const revenueWindow = metrics.salesAmount > 0 ? (metrics.salesAmount / windowDays) * projectionDays : 0;
  const reviewConversionRevenueDrag = revenueWindow * estimatedConversionDelta;
  const reviewConversionMarginDrag = reviewConversionRevenueDrag * marginRate;
  const returnRevenueExposure = metrics.returnUnits * avgUnitRevenue;
  const refundMarginLoss = metrics.refundAmount * marginRate;
  const calculatedRevenueAtRisk = projectedLostRevenue + returnRevenueExposure + reviewConversionRevenueDrag + metrics.refundAmount;
  const calculatedMarginAtRisk = projectedLostMargin + refundMarginLoss + returnProcessingCost + reviewConversionMarginDrag;
  const revenueAtRisk = roundMoney(Math.max(calculatedRevenueAtRisk, metrics.revenueAtRisk));
  const marginAtRisk = roundMoney(Math.max(calculatedMarginAtRisk, metrics.marginAtRisk));
  const impactMid = roundMoney(Math.max(observedLoss + projectedReturnLoss + reviewConversionMarginDrag, marginAtRisk, metrics.refundAmount, metrics.marginAtRisk));
  const sampleMultiplier = metrics.effectiveSampleSize < 10 ? { low: 0.55, high: 1.75 } : metrics.effectiveSampleSize < 25 ? { low: 0.7, high: 1.45 } : { low: 0.84, high: 1.22 };

  return {
    observedLoss: roundMoney(observedLoss),
    refunds: roundMoney(metrics.refundAmount),
    refundValueAtRisk: roundMoney(metrics.refundAmount),
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
