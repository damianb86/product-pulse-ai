import prisma from "../db.server";

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

  await prisma.productScoreHistory.deleteMany({
    where: {
      shop,
      productGid: snapshot.productGid,
      source,
    },
  });

  if (!rows.length) return { count: 0 };
  return prisma.productScoreHistory.createMany({ data: rows });
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
    priorityScore: nullableInteger(metrics.priorityScore),
    productMomentumScore: nullableInteger(metrics.productMomentumScore || metrics.productMomentum?.score),
    productMomentumTier: metrics.productMomentumTier || metrics.productMomentum?.tier || null,
    momentumDirection: metrics.momentumDirection || metrics.productMomentum?.direction || null,
    momentumConfidence: nullableInteger(metrics.momentumConfidence || metrics.productMomentum?.confidence),
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
    calculationState: pointMetrics.calculationState || "reconstructed_from_deep_diagnosis_events",
    granularity: point.granularity || pointMetrics.granularity || null,
    sequence: nullableInteger(point.sequence),
    periodEnd: point.periodEnd || point.recordedAt || null,
    windowDays: nullableInteger(pointMetrics.windowDays),
    soldUnits: nullableNumber(pointMetrics.soldUnits),
    salesAmount: nullableNumber(pointMetrics.salesAmount),
    returnUnits: nullableNumber(pointMetrics.returnUnits),
    refundUnits: nullableNumber(pointMetrics.refundUnits),
    refundAmount: nullableNumber(pointMetrics.refundAmount),
    reviewCount: nullableInteger(pointMetrics.reviewCount),
    negativeReviewCount: nullableInteger(pointMetrics.negativeReviewCount),
    customerSignalCount: nullableInteger(pointMetrics.customerSignalCount),
    contentIssueCount: nullableInteger(pointMetrics.contentIssueCount),
    recentSignalUnits: nullableInteger(pointMetrics.recentSignalUnits),
    riskComponents: pointMetrics.riskComponents || null,
    confidenceFactors: pointMetrics.confidenceFactors || null,
  };
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
