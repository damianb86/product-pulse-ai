import prisma from "../db.server";

const RECONSTRUCTED_HISTORY_TEMPORAL_METRICS_VERSION = 3;

export async function recordProductScoreHistory({ shop, snapshot, source = "unknown", diagnosisId = null, recordedAt = new Date() }) {
  if (!shop || !snapshot?.productGid) return null;

  return prisma.productScoreHistory.create({
    data: {
      shop,
      productGid: snapshot.productGid,
      productTitle: String(snapshot.productTitle || "Shopify product"),
      handle: optionalString(snapshot.handle),
      source,
      riskScore: toInteger(snapshot.riskScore),
      impactScore: nullableInteger(snapshot.impactScore),
      confidence: nullableInteger(snapshot.confidence),
      primaryIssue: optionalString(snapshot.primaryIssue),
      metrics: buildHistoryMetrics(snapshot),
      snapshotId: optionalString(snapshot.id),
      diagnosisId: optionalString(diagnosisId),
      recordedAt,
    },
  });
}

export async function recordProductScoreHistoryBatch(shop, snapshots = [], options = {}) {
  const rows = snapshots
    .filter((snapshot) => snapshot?.productGid)
    .map((snapshot) => ({
      shop,
      productGid: snapshot.productGid,
      productTitle: String(snapshot.productTitle || "Shopify product"),
      handle: optionalString(snapshot.handle),
      source: options.source || "unknown",
      riskScore: toInteger(snapshot.riskScore),
      impactScore: nullableInteger(snapshot.impactScore),
      confidence: nullableInteger(snapshot.confidence),
      primaryIssue: optionalString(snapshot.primaryIssue),
      metrics: buildHistoryMetrics(snapshot),
      snapshotId: optionalString(snapshot.id),
      diagnosisId: optionalString(options.diagnosisId),
      recordedAt: options.recordedAt || new Date(),
    }));

  if (!rows.length) return { count: 0 };
  return prisma.productScoreHistory.createMany({ data: rows });
}

export async function recordReconstructedProductScoreHistory({
  shop,
  snapshot,
  history = [],
  source = "full-diagnosis-reconstructed",
  diagnosisId = null,
} = {}) {
  if (!shop || !snapshot?.productGid) return { count: 0 };

  const existingRows = await prisma.productScoreHistory.findMany({
    where: {
      shop,
      productGid: snapshot.productGid,
      source,
    },
    select: { id: true, metrics: true },
    take: 5,
  });
  if (hasReusableReconstructedHistoryRows(existingRows)) {
    return { count: 0, skipped: true, reason: "reconstructed_history_already_bootstrapped" };
  }

  const rows = (Array.isArray(history) ? history : [])
    .filter((point) => point && !point.isCurrent)
    .map((point) => {
      const recordedAt = parseDate(point.recordedAt || point.periodEnd);
      if (!recordedAt) return null;
      return {
        shop,
        productGid: snapshot.productGid,
        productTitle: String(snapshot.productTitle || point.productTitle || "Shopify product"),
        handle: optionalString(snapshot.handle),
        source,
        riskScore: toInteger(point.riskScore),
        impactScore: nullableInteger(point.impactScore),
        confidence: nullableInteger(point.confidence),
        primaryIssue: optionalString(point.primaryIssue || snapshot.primaryIssue),
        metrics: jsonCompatible(buildReconstructedHistoryMetrics(point, snapshot)),
        snapshotId: optionalString(snapshot.id),
        diagnosisId: optionalString(diagnosisId),
        recordedAt,
      };
    })
    .filter(Boolean);

  if (existingRows.length) {
    await prisma.productScoreHistory.deleteMany({
      where: {
        shop,
        productGid: snapshot.productGid,
        source,
      },
    });
  }

  if (!rows.length) return { count: 0 };
  return prisma.productScoreHistory.createMany({ data: rows });
}

export async function getReconstructedProductScoreHistoryForShop(
  shop,
  productGid,
  { source = "full-diagnosis-reconstructed", take = 120 } = {},
) {
  if (!shop || !productGid) return [];
  const rows = await prisma.productScoreHistory.findMany({
    where: { shop, productGid, source },
    orderBy: { recordedAt: "asc" },
    ...(Number(take) > 0 ? { take: Number(take) } : {}),
  });
  if (!hasReusableReconstructedHistoryRows(rows)) return [];
  return rows.map(normalizeProductScoreHistoryPoint).filter(Boolean);
}

export async function getProductScoreHistoryForShop(shop, productGid, { take = 40 } = {}) {
  if (!shop || !productGid) return [];
  const rows = await prisma.productScoreHistory.findMany({
    where: { shop, productGid },
    orderBy: { recordedAt: "desc" },
    take,
  });
  return rows.reverse();
}

export async function getProductScoreHistoryForProductsForShop(shop, productGids = [], { take = 40 } = {}) {
  if (!shop) return new Map();
  const uniqueProductGids = [...new Set(productGids.filter(Boolean))];
  if (!uniqueProductGids.length) return new Map();

  const entries = await Promise.all(
    uniqueProductGids.map(async (productGid) => [
      productGid,
      await getProductScoreHistoryForShop(shop, productGid, { take }),
    ]),
  );
  return new Map(entries);
}

function buildHistoryMetrics(snapshot = {}) {
  const metrics = snapshot.metrics || {};
  return {
    analysisDepth: metrics.analysisDepth || null,
    issueCount: toInteger(metrics.issueCount || metrics.issuesCount || metrics.signalCount),
    signalsCount: toInteger(metrics.signalsCount || metrics.signalCount),
    returnRate: nullableNumber(metrics.returnRate),
    refundRate: nullableNumber(metrics.refundRate),
    negativeReviewRate: nullableNumber(metrics.negativeReviewRate),
    marginAtRisk: nullableNumber(metrics.marginAtRisk || metrics.estimatedMarginAtRisk),
    revenueAtRisk: nullableNumber(metrics.revenueAtRisk),
    financialExposure: nullableNumber(metrics.financialExposure || metrics.estimatedImpact),
    salesAmount: nullableNumber(metrics.salesAmount || metrics.revenueLast30Days || metrics.productMomentum?.inputs?.revenueLast30Days),
    refundAmount: nullableNumber(metrics.refundAmount),
    soldUnits: nullableNumber(metrics.soldUnits),
    returnUnits: nullableNumber(metrics.returnUnits),
    refundUnits: nullableNumber(metrics.refundUnits),
    reviewCount: nullableInteger(metrics.reviewCount),
    negativeReviewCount: nullableInteger(metrics.negativeReviewCount),
    avgRating: nullableNumber(metrics.avgRating || metrics.reviewRating || metrics.csvAverageRating),
    customerSignalCount: nullableInteger(metrics.customerSignalCount),
    priorityScore: nullableInteger(metrics.priorityScore),
    mainIssueIntensity: nullableInteger(metrics.mainIssueIntensity ?? metrics.priorityScore),
    evidenceStrengthScore: nullableInteger(metrics.evidenceStrengthScore || metrics.confidenceFactors?.evidenceStrengthScore),
    retentionHealthScore: nullableInteger(metrics.retentionHealthScore || metrics.productRetentionSummary?.retentionHealthScore || metrics.productRetention?.summary?.retentionHealthScore),
    scoringVersion: metrics.scoringVersion || metrics.returnRefundRelationshipFactors?.version || null,
    returnRefundRelationship: buildRelationshipHistoryMetrics(metrics),
    returnPressureScore: nullableInteger(metrics.returnPressureScore ?? metrics.returnPressure?.score ?? metrics.returnRefundRelationshipFactors?.returnPressure?.score),
    returnPressureRate: nullableNumber(getRelationshipReturnPressureRatePercent(metrics)),
    refundLeakageScore: nullableInteger(metrics.refundLeakageScore ?? metrics.refundLeakage?.score ?? metrics.returnRefundRelationshipFactors?.refundLeakage?.score),
    productMomentumScore: nullableInteger(metrics.productMomentumScore ?? metrics.productMomentum?.score),
    productMomentumTier: metrics.productMomentumTier || metrics.productMomentum?.tier || null,
    momentumDirection: metrics.momentumDirection || metrics.productMomentum?.direction || null,
    momentumConfidence: nullableInteger(metrics.momentumConfidence ?? metrics.productMomentum?.confidence),
    topReturnReason: getTopReasonLabel(metrics.topReturnReasonDetails || metrics.topReturnReasons),
    topRefundReason: getTopReasonLabel(metrics.topRefundReasonDetails || metrics.topRefundReasons),
    dominantEmotion: getDominantEmotionLabel(metrics.textInsights || metrics.customerLanguage || metrics.customerLanguageAnalysis),
    productStatus: metrics.productStatus || metrics.status || null,
    variantCount: nullableInteger(metrics.variantCount),
    skuCount: nullableInteger(metrics.skuCount),
    productContentSignature: getProductContentSignature(metrics),
    productContentReason: metrics.incrementalDiagnosis?.productContent?.reason || null,
    productUpdatedAt: metrics.incrementalDiagnosis?.productContent?.productUpdatedAt || metrics.incrementalDiagnosis?.cache?.productContent?.productUpdatedAt || null,
    returnRatePrediction: metrics.returnRatePrediction?.summary || null,
    sourceCoverage: snapshot.sourceCoverage || null,
  };
}

function buildReconstructedHistoryMetrics(point = {}, snapshot = {}) {
  const pointMetrics = point.metrics || {};
  return {
    ...buildHistoryMetrics({
      ...snapshot,
      metrics: {
        ...(snapshot.metrics || {}),
        ...pointMetrics,
      },
      sourceCoverage: pointMetrics.sourceCoverage || snapshot.sourceCoverage,
    }),
    reconstructedHistory: true,
    temporalMetricsVersion: RECONSTRUCTED_HISTORY_TEMPORAL_METRICS_VERSION,
    calculationState: pointMetrics.calculationState || "reconstructed_from_deep_diagnosis_events",
    granularity: point.granularity || pointMetrics.granularity || null,
    sequence: nullableInteger(point.sequence),
    periodEnd: point.periodEnd || point.recordedAt || null,
    windowDays: nullableInteger(pointMetrics.windowDays),
    soldUnits: nullableNumber(pointMetrics.soldUnits),
    salesAmount: nullableNumber(pointMetrics.salesAmount),
    financialExposure: nullableNumber(pointMetrics.financialExposure ?? pointMetrics.estimatedImpact),
    marginAtRisk: nullableNumber(pointMetrics.marginAtRisk),
    revenueAtRisk: nullableNumber(pointMetrics.revenueAtRisk),
    returnUnits: nullableNumber(pointMetrics.returnUnits),
    refundUnits: nullableNumber(pointMetrics.refundUnits),
    refundAmount: nullableNumber(pointMetrics.refundAmount),
    reviewCount: nullableInteger(pointMetrics.reviewCount),
    negativeReviewCount: nullableInteger(pointMetrics.negativeReviewCount),
    avgRating: nullableNumber(pointMetrics.avgRating || pointMetrics.reviewRating || pointMetrics.csvAverageRating),
    customerSignalCount: nullableInteger(pointMetrics.customerSignalCount),
    contentIssueCount: nullableInteger(pointMetrics.contentIssueCount),
    recentSignalUnits: nullableInteger(pointMetrics.recentSignalUnits),
    riskComponents: pointMetrics.riskComponents || null,
    confidenceFactors: pointMetrics.confidenceFactors || null,
    priorityScore: nullableInteger(pointMetrics.priorityScore),
    mainIssueIntensity: nullableInteger(pointMetrics.mainIssueIntensity ?? pointMetrics.priorityScore),
    returnRefundRelationship: buildRelationshipHistoryMetrics(pointMetrics),
    returnPressureScore: nullableInteger(pointMetrics.returnPressureScore ?? pointMetrics.returnPressure?.score ?? pointMetrics.returnRefundRelationshipFactors?.returnPressure?.score),
    returnPressureRate: nullableNumber(getRelationshipReturnPressureRatePercent(pointMetrics)),
    refundLeakageScore: nullableInteger(pointMetrics.refundLeakageScore ?? pointMetrics.refundLeakage?.score ?? pointMetrics.returnRefundRelationshipFactors?.refundLeakage?.score),
    productMomentumScore: nullableInteger(pointMetrics.productMomentumScore ?? pointMetrics.productMomentum?.score),
    productMomentumTier: pointMetrics.productMomentumTier || pointMetrics.productMomentum?.tier || null,
    momentumDirection: pointMetrics.momentumDirection || pointMetrics.productMomentum?.direction || null,
    momentumConfidence: nullableInteger(pointMetrics.momentumConfidence ?? pointMetrics.productMomentum?.confidence),
    topReturnReason: getTopReasonLabel(pointMetrics.topReturnReasonDetails || pointMetrics.topReturnReasons),
    topRefundReason: getTopReasonLabel(pointMetrics.topRefundReasonDetails || pointMetrics.topRefundReasons),
    dominantEmotion: getDominantEmotionLabel(pointMetrics.textInsights || pointMetrics.customerLanguage || pointMetrics.customerLanguageAnalysis),
    productStatus: pointMetrics.productStatus || pointMetrics.status || null,
    variantCount: nullableInteger(pointMetrics.variantCount),
    skuCount: nullableInteger(pointMetrics.skuCount),
    productContentSignature: getProductContentSignature(pointMetrics),
    productContentReason: pointMetrics.incrementalDiagnosis?.productContent?.reason || null,
    productUpdatedAt: pointMetrics.incrementalDiagnosis?.productContent?.productUpdatedAt || pointMetrics.incrementalDiagnosis?.cache?.productContent?.productUpdatedAt || null,
    scoringVersion: pointMetrics.scoringVersion || pointMetrics.returnRefundRelationshipFactors?.version || null,
  };
}

function normalizeProductScoreHistoryPoint(row = {}) {
  const metrics = row.metrics && typeof row.metrics === "object" ? row.metrics : {};
  const recordedAt = parseDate(row.recordedAt);
  if (!recordedAt) return null;
  const recordedAtIso = recordedAt.toISOString();

  return jsonCompatible({
    id: row.id || null,
    source: row.source || "unknown",
    recordedAt: recordedAtIso,
    periodEnd: metrics.periodEnd || recordedAtIso,
    calculatedAt: recordedAtIso,
    granularity: metrics.granularity || null,
    sequence: nullableInteger(metrics.sequence),
    isCurrent: false,
    riskScore: toInteger(row.riskScore),
    impactScore: nullableInteger(row.impactScore),
    confidence: nullableInteger(row.confidence),
    primaryIssue: optionalString(row.primaryIssue),
    returnRate: nullableNumber(metrics.returnRate),
    refundRate: nullableNumber(metrics.refundRate),
    negativeReviewRate: nullableNumber(metrics.negativeReviewRate),
    marginAtRisk: nullableNumber(metrics.marginAtRisk),
    revenueAtRisk: nullableNumber(metrics.revenueAtRisk),
    financialExposure: nullableNumber(metrics.financialExposure),
    salesAmount: nullableNumber(metrics.salesAmount),
    refundAmount: nullableNumber(metrics.refundAmount),
    soldUnits: nullableNumber(metrics.soldUnits),
    returnUnits: nullableNumber(metrics.returnUnits),
    refundUnits: nullableNumber(metrics.refundUnits),
    reviewCount: nullableInteger(metrics.reviewCount),
    negativeReviewCount: nullableInteger(metrics.negativeReviewCount),
    avgRating: nullableNumber(metrics.avgRating || metrics.reviewRating || metrics.csvAverageRating),
    customerSignalCount: nullableInteger(metrics.customerSignalCount),
    evidenceStrengthScore: nullableInteger(metrics.evidenceStrengthScore),
    retentionHealthScore: nullableInteger(metrics.retentionHealthScore),
    productMomentumScore: nullableInteger(metrics.productMomentumScore),
    productMomentumTier: metrics.productMomentumTier || null,
    momentumDirection: metrics.momentumDirection || null,
    topReturnReason: optionalString(metrics.topReturnReason),
    topRefundReason: optionalString(metrics.topRefundReason),
    dominantEmotion: optionalString(metrics.dominantEmotion),
    productStatus: optionalString(metrics.productStatus),
    variantCount: nullableInteger(metrics.variantCount),
    skuCount: nullableInteger(metrics.skuCount),
    productContentSignature: optionalString(metrics.productContentSignature),
    productContentReason: optionalString(metrics.productContentReason),
    productUpdatedAt: optionalString(metrics.productUpdatedAt),
    returnPressureScore: nullableInteger(metrics.returnPressureScore ?? metrics.returnRefundRelationship?.returnPressureScore),
    returnPressureRate: nullableNumber(metrics.returnPressureRate ?? metrics.returnRefundRelationship?.returnPressureRate ?? metrics.returnRefundRelationship?.returnRateUnits),
    refundLeakageScore: nullableInteger(metrics.refundLeakageScore ?? metrics.returnRefundRelationship?.refundLeakageScore),
    mainIssueIntensity: nullableInteger(metrics.mainIssueIntensity ?? metrics.priorityScore),
    signalCount: nullableInteger(metrics.signalsCount || metrics.signalCount || metrics.issueCount),
    sourceCount: getHistorySourceCount(metrics.sourceCoverage),
    temporalMetricsVersion: nullableInteger(metrics.temporalMetricsVersion),
    metrics,
  });
}

function hasReusableReconstructedHistoryRows(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return false;
  return rows.every((row) => (
    Number(row?.metrics?.temporalMetricsVersion || 0) >= RECONSTRUCTED_HISTORY_TEMPORAL_METRICS_VERSION
  ));
}

function getHistorySourceCount(sourceCoverage) {
  if (Array.isArray(sourceCoverage)) return sourceCoverage.length;
  if (sourceCoverage && typeof sourceCoverage === "object") return Object.keys(sourceCoverage).length;
  return null;
}

function getRelationshipReturnPressureRatePercent(metrics = {}) {
  const summary = metrics.returnRefundRelationshipSummary || {};
  const factors = metrics.returnRefundRelationshipFactors || {};
  const returnPressure = metrics.returnPressure || factors.returnPressure || {};
  const soldUnits = firstFiniteNumber(summary.sold_units, summary.soldUnits, metrics.soldUnits);
  const summaryFrictionUnits = sumFiniteNumbers(
    summary.returned_and_refunded_units,
    summary.returned_not_refunded_units,
    summary.exchange_or_replacement_units,
    summary.pending_return_units,
  );
  const productFrictionUnits = firstFiniteNumber(returnPressure.productFrictionUnits, summaryFrictionUnits);
  if (soldUnits > 0 && productFrictionUnits != null) {
    return (productFrictionUnits / soldUnits) * 100;
  }
  return firstFiniteNumber(
    returnPressure.returnRateUnits,
    rateRatioToPercent(summary.return_rate_units),
    summary.returnRateUnits,
    metrics.returnPressureRate,
    metrics.returnRate,
  );
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function sumFiniteNumbers(...values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  return numbers.length ? numbers.reduce((sum, value) => sum + value, 0) : null;
}

function rateRatioToPercent(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number * 100 : null;
}

function buildRelationshipHistoryMetrics(metrics = {}) {
  const summary = metrics.returnRefundRelationshipSummary || {};
  const factors = metrics.returnRefundRelationshipFactors || {};
  const hasScores = factors.returnPressure?.score != null || factors.refundLeakage?.score != null || factors.productRisk?.score != null;
  if (!summary.product_id && !factors.hasRelationshipSummary && !hasScores) return null;
  const returnPressureRate = getRelationshipReturnPressureRatePercent(metrics);

  return {
    soldUnits: nullableNumber(summary.sold_units),
    returnedUnits: nullableNumber(summary.returned_units),
    returnedAndRefundedUnits: nullableNumber(summary.returned_and_refunded_units),
    returnedNotRefundedUnits: nullableNumber(summary.returned_not_refunded_units),
    refundedWithoutReturnUnits: nullableNumber(summary.refunded_without_return_units),
    exchangeOrReplacementUnits: nullableNumber(summary.exchange_or_replacement_units),
    pendingReturnUnits: nullableNumber(summary.pending_return_units),
    unattributedRefundAmount: nullableNumber(summary.unattributed_refund_amount),
    attributedRefundAmount: nullableNumber(summary.attributed_refund_amount),
    returnToRefundRate: nullableNumber(summary.return_to_refund_rate),
    refundAttributionRate: nullableNumber(summary.refund_attribution_rate),
    matchConfidenceAvg: nullableNumber(summary.relationship_match_confidence_avg),
    returnRateUnits: nullableNumber(rateRatioToPercent(summary.return_rate_units)),
    returnPressureRate: nullableNumber(returnPressureRate),
    returnPressureScore: nullableInteger(factors.returnPressure?.score),
    refundLeakageScore: nullableInteger(factors.refundLeakage?.score),
    relationshipRiskScore: nullableNumber(factors.productRisk?.score),
  };
}

function getTopReasonLabel(value = []) {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first) return null;
  if (typeof first === "string") return optionalString(first);
  return optionalString(first.label || first.reason || first.value || first.name);
}

function getDominantEmotionLabel(textInsights = {}) {
  const direct = textInsights.primaryEmotion || textInsights.dominantEmotion || textInsights.emotion || textInsights.sentiment;
  if (direct) return typeof direct === "string" ? optionalString(direct) : optionalString(direct.label || direct.emotion || direct.name);
  const buckets = [
    ...(Array.isArray(textInsights.emotions) ? textInsights.emotions : []),
    ...(Array.isArray(textInsights.reviews?.emotions) ? textInsights.reviews.emotions : []),
    ...(Array.isArray(textInsights.returns?.emotions) ? textInsights.returns.emotions : []),
    ...(Array.isArray(textInsights.aiKnownEmotions) ? textInsights.aiKnownEmotions : []),
  ].filter(Boolean);
  const sorted = buckets
    .map((item) => (typeof item === "string"
      ? { label: item, count: 1 }
      : { label: item.label || item.emotion || item.name, count: Number(item.count || item.value || 0) }))
    .filter((item) => item.label)
    .sort((first, second) => Number(second.count || 0) - Number(first.count || 0));
  return sorted[0]?.label ? optionalString(sorted[0].label) : null;
}

function getProductContentSignature(metrics = {}) {
  const incremental = metrics.incrementalDiagnosis || {};
  const signature = metrics.productContentSignature
    || incremental.productContent?.signature
    || incremental.cache?.productContent?.signature;
  if (signature) return optionalString(signature);

  const parts = {
    status: metrics.productStatus || metrics.status || null,
    vendor: metrics.vendor || null,
    productType: metrics.productType || null,
    tags: normalizedStringList(metrics.tags),
    collections: normalizedStringList(metrics.collections),
    optionNames: normalizedStringList(metrics.optionNames),
    affectedVariants: normalizedStringList(metrics.affectedVariants),
    variantCount: nullableInteger(metrics.variantCount),
    skuCount: nullableInteger(metrics.skuCount),
  };
  const hasContent = Object.values(parts).some((value) => (Array.isArray(value) ? value.length > 0 : value !== null && value !== ""));
  return hasContent ? stableStringify(parts) : null;
}

function normalizedStringList(value = []) {
  return (Array.isArray(value) ? value : [value])
    .map((item) => {
      if (!item) return "";
      if (typeof item === "string") return item;
      return item.title || item.label || item.name || item.handle || item.id || "";
    })
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .sort((first, second) => first.localeCompare(second));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function jsonCompatible(value) {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonCompatible);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, jsonCompatible(entryValue)]),
  );
}

function optionalString(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function toInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : 0;
}

function nullableInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function nullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
