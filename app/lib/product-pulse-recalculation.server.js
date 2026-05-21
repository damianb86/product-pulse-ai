import prisma from "../db.server";
import { recordJobLog } from "./product-pulse-job-logs.server";
import {
  PRODUCT_PULSE_SCORING_VERSION,
  calculateProductScoreModel,
} from "./product-pulse-scoring";

export const PRODUCT_PULSE_RECALCULATION_MAX_LIMIT = 250;
export const PRODUCT_PULSE_RECALCULATION_DEFAULT_LIMIT = 100;

export function recalculateProductPulseSnapshotMetrics(snapshot = {}, options = {}) {
  const metrics = snapshot.metrics || {};
  const scoreModel = calculateProductScoreModel(metrics, options.scoringOptions || {});
  const impactFactors = scoreModel.impactFactors || {};
  const relationshipFactors = scoreModel.relationshipFactors || {};
  const updatedMetrics = {
    ...metrics,
    scoringVersion: PRODUCT_PULSE_SCORING_VERSION,
    returnRefundRelationshipFactors: relationshipFactors,
    returnRefundScoringImpact: scoreModel.relationshipExplanations,
    returnPressure: relationshipFactors.returnPressure,
    refundLeakage: relationshipFactors.refundLeakage,
    customerSignalBreakdown: relationshipFactors.customerSignalBreakdown,
    financialExposureBreakdown: relationshipFactors.financialExposure,
    riskComponents: scoreModel.riskComponents,
    confidenceFactors: scoreModel.confidenceFactors,
    impactFactors,
    priorityScore: scoreModel.priorityScore,
    evidenceStrengthScore: scoreModel.evidenceStrengthScore,
    revenueAtRisk: impactFactors.revenueAtRisk,
    marginAtRisk: impactFactors.marginAtRisk,
    estimatedImpact: impactFactors.estimatedImpact,
    impactRange: {
      low: impactFactors.impactLow,
      mid: impactFactors.impactMid,
      high: impactFactors.impactHigh,
    },
    recalculatedAt: (options.now || new Date()).toISOString(),
  };

  return {
    riskScore: scoreModel.riskScore,
    impactScore: Math.round(impactFactors.estimatedImpact || 0),
    confidence: scoreModel.confidenceScore,
    primaryIssue: snapshot.primaryIssue || "ProductPulse recalculated metric",
    sourceCoverage: snapshot.sourceCoverage || metrics.sourceCoverage || [],
    metrics: updatedMetrics,
    calculatedAt: options.now || new Date(),
  };
}

export async function recomputeProductPulseMetricsForProduct(shop, productGid, options = {}) {
  const db = options.db || prisma;
  if (!shop || !productGid) return buildRecomputeResult({ scope: "product", shop, found: 0 });

  const snapshot = await db.productRiskSnapshot.findFirst({
    where: { shop, productGid },
  });
  if (!snapshot) {
    await writeRecomputeLog({
      shop,
      jobId: options.jobId,
      event: "product_pulse_recompute.product_not_found",
      message: "No ProductPulse snapshot found for relationship-aware recompute.",
      data: { productGid },
      recordLog: options.recordLog,
    });
    return buildRecomputeResult({ scope: "product", shop, found: 0 });
  }

  const updated = await updateRecomputedSnapshot(snapshot, options);
  await writeRecomputeLog({
    shop,
    jobId: options.jobId,
    event: "product_pulse_recompute.product_completed",
    message: "Relationship-aware ProductPulse metrics recomputed for one product.",
    data: summarizeRecomputedSnapshot(updated),
    recordLog: options.recordLog,
  });

  return buildRecomputeResult({
    scope: "product",
    shop,
    found: 1,
    updated: 1,
    snapshots: [updated],
  });
}

export async function recomputeProductPulseMetricsForShop(shop, options = {}) {
  const db = options.db || prisma;
  if (!shop) return buildRecomputeResult({ scope: "shop", shop, found: 0 });
  const limit = normalizeRecomputeLimit(options.limit);
  const snapshots = await db.productRiskSnapshot.findMany({
    where: { shop },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  const updatedSnapshots = [];

  for (const snapshot of snapshots) {
    updatedSnapshots.push(await updateRecomputedSnapshot(snapshot, options));
  }

  await writeRecomputeLog({
    shop,
    jobId: options.jobId,
    event: "product_pulse_recompute.shop_completed",
    message: "Relationship-aware ProductPulse metrics recomputed for one shop.",
    data: {
      found: snapshots.length,
      updated: updatedSnapshots.length,
      limit,
      scoringVersion: PRODUCT_PULSE_SCORING_VERSION,
    },
    recordLog: options.recordLog,
  });

  return buildRecomputeResult({
    scope: "shop",
    shop,
    found: snapshots.length,
    updated: updatedSnapshots.length,
    limit,
    snapshots: updatedSnapshots,
  });
}

export async function recomputeProductPulseMetricsForAllShops(options = {}) {
  const db = options.db || prisma;
  const limit = normalizeRecomputeLimit(options.limit);
  const snapshots = await db.productRiskSnapshot.findMany({
    orderBy: { updatedAt: "desc" },
    take: limit,
  });
  const updatedSnapshots = [];

  for (const snapshot of snapshots) {
    updatedSnapshots.push(await updateRecomputedSnapshot(snapshot, options));
  }

  await writeRecomputeLog({
    shop: options.shop || updatedSnapshots[0]?.shop,
    jobId: options.jobId,
    event: "product_pulse_recompute.all_completed",
    message: "Relationship-aware ProductPulse metrics recomputed across shops with a bounded limit.",
    data: {
      found: snapshots.length,
      updated: updatedSnapshots.length,
      limit,
      scoringVersion: PRODUCT_PULSE_SCORING_VERSION,
    },
    recordLog: options.recordLog,
  });

  return buildRecomputeResult({
    scope: "all",
    found: snapshots.length,
    updated: updatedSnapshots.length,
    limit,
    snapshots: updatedSnapshots,
  });
}

async function updateRecomputedSnapshot(snapshot, options = {}) {
  const db = options.db || prisma;
  const recalculated = recalculateProductPulseSnapshotMetrics(snapshot, options);
  return db.productRiskSnapshot.update({
    where: {
      shop_productGid: {
        shop: snapshot.shop,
        productGid: snapshot.productGid,
      },
    },
    data: recalculated,
  });
}

function normalizeRecomputeLimit(limit) {
  const numeric = Number(limit || PRODUCT_PULSE_RECALCULATION_DEFAULT_LIMIT);
  if (!Number.isFinite(numeric)) return PRODUCT_PULSE_RECALCULATION_DEFAULT_LIMIT;
  return Math.min(PRODUCT_PULSE_RECALCULATION_MAX_LIMIT, Math.max(1, Math.round(numeric)));
}

function buildRecomputeResult({
  scope,
  shop = null,
  found = 0,
  updated = 0,
  limit = null,
  snapshots = [],
} = {}) {
  return {
    scope,
    shop,
    found,
    updated,
    limit,
    scoringVersion: PRODUCT_PULSE_SCORING_VERSION,
    snapshots: snapshots.map(summarizeRecomputedSnapshot),
  };
}

function summarizeRecomputedSnapshot(snapshot = {}) {
  return {
    shop: snapshot.shop,
    productGid: snapshot.productGid,
    riskScore: snapshot.riskScore,
    impactScore: snapshot.impactScore,
    confidence: snapshot.confidence,
    scoringVersion: snapshot.metrics?.scoringVersion,
  };
}

async function writeRecomputeLog({ shop, jobId, event, message, data, recordLog = recordJobLog } = {}) {
  if (!shop || !jobId || !recordLog) return null;
  return recordLog({
    shop,
    jobId,
    event,
    message,
    data,
  });
}
