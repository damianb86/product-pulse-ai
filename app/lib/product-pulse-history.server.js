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
