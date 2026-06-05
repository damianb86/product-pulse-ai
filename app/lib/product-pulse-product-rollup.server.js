import prisma from "../db.server";

export const PRODUCT_PULSE_PRODUCT_ROLLUP_VERSION = 1;

const PRODUCT_PULSE_PRODUCT_ROLLUP_SELECT = {
  id: true,
  shop: true,
  productGid: true,
  productTitle: true,
  handle: true,
  imageUrl: true,
  imageAlt: true,
  vendor: true,
  productType: true,
  primaryCollection: true,
  collections: true,
  tags: true,
  sku: true,
  riskScore: true,
  impactScore: true,
  confidence: true,
  primaryIssue: true,
  sourceCoverage: true,
  sourceCount: true,
  signalCount: true,
  analysisDepth: true,
  latestDiagnosisId: true,
  latestDiagnosisAt: true,
  isResolved: true,
  resolvedAt: true,
  isWatched: true,
  watchlistStatus: true,
  reviewRating: true,
  avgRating: true,
  reviewCount: true,
  negativeReviewCount: true,
  negativeReviewRate: true,
  recentNegativeReviewCount: true,
  revenueAtRisk: true,
  marginAtRisk: true,
  estimatedImpact: true,
  salesAmount: true,
  refundAmount: true,
  avgUnitRevenue: true,
  marginRate: true,
  returnRate: true,
  refundRate: true,
  returnUnits: true,
  refundUnits: true,
  recentSignalUnits: true,
  windowDays: true,
  soldUnits: true,
  soldOrders: true,
  storeAvgReturnRate: true,
  storeAvgRefundRate: true,
  lastSignalAt: true,
  customerTextSignals: true,
  contentIssueCount: true,
  descriptionWordCount: true,
  csvReviewCount: true,
  csvReviewRatingCount: true,
  csvNegativeReviewCount: true,
  csvAverageRating: true,
  judgeMeReviewCount: true,
  judgeMeNegativeReviewCount: true,
  judgeMeAverageRating: true,
  yotpoReviewCount: true,
  looxReviewCount: true,
  productMomentumScore: true,
  productMomentumTier: true,
  momentumDirection: true,
  momentumConfidence: true,
  momentumConfidenceLabel: true,
  signalTrend: true,
  riskTrend: true,
  topReturnReasons: true,
  affectedVariants: true,
  impactFactors: true,
  estimatedImpactFactors: true,
  snapshotUpdatedAt: true,
  calculatedAt: true,
  updatedAt: true,
};

const PRODUCT_PULSE_PRODUCT_ROLLUP_ORDER_BY = [
  { riskScore: "desc" },
  { snapshotUpdatedAt: "desc" },
  { updatedAt: "desc" },
];

export async function getProductPulseProductRollupSnapshotRowsForShop(shop) {
  if (!shop) return [];
  const [rollups, snapshotCount] = await Promise.all([
    prisma.productPulseProductRollup.findMany({
      where: { shop },
      orderBy: PRODUCT_PULSE_PRODUCT_ROLLUP_ORDER_BY,
      select: PRODUCT_PULSE_PRODUCT_ROLLUP_SELECT,
    }),
    prisma.productRiskSnapshot.count({ where: { shop } }),
  ]);
  if (snapshotCount <= 0 || !rollups.length || rollups.length !== snapshotCount) return [];
  return rollups.map(productPulseProductRollupToSnapshotRow);
}

export async function getProductPulseProductRollupMetricsForProducts(shop, productGids = []) {
  if (!shop) return new Map();
  const uniqueProductGids = [...new Set(productGids.filter(Boolean))];
  if (!uniqueProductGids.length) return new Map();
  const rollups = await prisma.productPulseProductRollup.findMany({
    where: { shop, productGid: { in: uniqueProductGids } },
    select: PRODUCT_PULSE_PRODUCT_ROLLUP_SELECT,
  });
  return new Map(rollups.map((rollup) => [rollup.productGid, buildProductPulseProductRollupMetrics(rollup)]));
}

export async function upsertProductPulseProductRollup(snapshot, options = {}) {
  const data = buildProductPulseProductRollupData(snapshot, options);
  if (!data) return null;
  const updateData = { ...data };
  delete updateData.id;
  return prisma.productPulseProductRollup.upsert({
    where: {
      shop_productGid: {
        shop: data.shop,
        productGid: data.productGid,
      },
    },
    create: removeUndefined(data),
    update: removeUndefined(updateData),
  });
}

export async function upsertProductPulseProductRollups(snapshots = [], options = {}) {
  const persisted = [];
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const rollup = await upsertProductPulseProductRollup(snapshot, options);
    if (rollup) persisted.push(rollup);
  }
  return persisted;
}

export function buildProductPulseProductRollupData(snapshot, options = {}) {
  if (!snapshot?.shop || !snapshot?.productGid) return null;
  const metrics = isPlainObject(snapshot.metrics) ? snapshot.metrics : {};
  const sourceCoverage = getStringArray(snapshot.sourceCoverage);
  const collections = getStringArray(metrics.collections);
  const tags = getStringArray(metrics.tags);
  const monthlySummary = isPlainObject(metrics.monthlyOrderActivity?.summary) ? metrics.monthlyOrderActivity.summary : {};
  const image = getSnapshotProductImage(snapshot);
  const latestDiagnosis = options.latestDiagnosis || null;
  const resolvedAction = options.resolvedAction || null;
  const watchedItem = options.watchedItem || null;
  const returnUnits = toInteger(metrics.returnUnits);
  const refundUnits = toInteger(metrics.refundUnits);
  const signalCount = firstInteger(metrics.signalCount, metrics.signalsCount, metrics.issueCount, 0);
  const revenueAtRisk = firstNumber(metrics.revenueAtRisk, metrics.estimatedImpact, metrics.refundAmount, 0);
  const latestDiagnosisId = normalizeString(latestDiagnosis?.id) || normalizeString(metrics.latestDiagnosisId);
  const latestDiagnosisAt = toDate(latestDiagnosis?.completedAt) || toDate(metrics.lastDetailedDiagnosisAt);
  const analysisDepth = latestDiagnosisId || latestDiagnosisAt ? "full" : "quickscan";
  const resolvedAt = resolvedAction?.actionType === "mark-resolved"
    ? toDate(resolvedAction.appliedAt) || toDate(resolvedAction.createdAt)
    : null;

  return {
    id: normalizeString(snapshot.id) || undefined,
    shop: snapshot.shop,
    productGid: snapshot.productGid,
    productTitle: normalizeString(snapshot.productTitle) || "Unknown product",
    handle: normalizeString(snapshot.handle) || null,
    imageUrl: image.imageUrl || null,
    imageAlt: image.imageAlt || null,
    vendor: normalizeString(metrics.vendor) || null,
    productType: normalizeString(metrics.productType) || null,
    primaryCollection: collections[0] || normalizeString(metrics.productType) || null,
    collections,
    tags,
    sku: normalizeString(metrics.sku) || null,
    riskScore: toInteger(snapshot.riskScore),
    impactScore: toInteger(snapshot.impactScore),
    confidence: toInteger(snapshot.confidence),
    primaryIssue: normalizeString(snapshot.primaryIssue) || null,
    sourceCoverage,
    sourceCount: sourceCoverage.length,
    signalCount,
    analysisDepth,
    latestDiagnosisId,
    latestDiagnosisAt,
    isResolved: Boolean(resolvedAt),
    resolvedAt,
    isWatched: Boolean(watchedItem),
    watchlistStatus: normalizeString(watchedItem?.status) || null,
    reviewRating: firstNumber(metrics.reviewRating, metrics.avgRating, 0),
    avgRating: firstNumber(metrics.avgRating, metrics.reviewRating, metrics.csvAverageRating, 0),
    reviewCount: toInteger(metrics.reviewCount),
    negativeReviewCount: toInteger(metrics.negativeReviewCount),
    negativeReviewRate: toNumber(metrics.negativeReviewRate),
    recentNegativeReviewCount: toInteger(metrics.recentNegativeReviewCount),
    revenueAtRisk,
    marginAtRisk: firstNumber(metrics.marginAtRisk, revenueAtRisk ? revenueAtRisk * 0.45 : 0, 0),
    estimatedImpact: firstNumber(metrics.estimatedImpact, revenueAtRisk, metrics.refundAmount, 0),
    salesAmount: toNumber(metrics.salesAmount),
    refundAmount: toNumber(metrics.refundAmount),
    avgUnitRevenue: toNumber(metrics.avgUnitRevenue),
    marginRate: toNullableNumber(metrics.marginRate),
    returnRate: firstNumber(metrics.returnRate, monthlySummary.returnRate, 0),
    refundRate: firstNumber(metrics.refundRate, monthlySummary.refundRate, 0),
    returnUnits,
    refundUnits,
    recentSignalUnits: toInteger(metrics.recentSignalUnits),
    windowDays: firstInteger(metrics.windowDays, 60),
    soldUnits: Math.max(toInteger(metrics.soldUnits), toInteger(monthlySummary.totalOrderUnits), returnUnits, refundUnits),
    soldOrders: toInteger(metrics.soldOrders),
    storeAvgReturnRate: toNumber(metrics.storeAvgReturnRate),
    storeAvgRefundRate: toNumber(metrics.storeAvgRefundRate),
    lastSignalAt: toDate(metrics.lastSignalAt),
    customerTextSignals: firstInteger(metrics.customerTextSignals, metrics.textInsights?.sentiment?.total, 0),
    contentIssueCount: toInteger(metrics.contentIssueCount),
    descriptionWordCount: firstInteger(metrics.descriptionWordCount, metrics.descriptionWords, 0),
    csvReviewCount: toInteger(metrics.csvReviewCount),
    csvReviewRatingCount: toInteger(metrics.csvReviewRatingCount),
    csvNegativeReviewCount: toInteger(metrics.csvNegativeReviewCount),
    csvAverageRating: toNumber(metrics.csvAverageRating),
    judgeMeReviewCount: toInteger(metrics.judgeMeReviewCount),
    judgeMeNegativeReviewCount: toInteger(metrics.judgeMeNegativeReviewCount),
    judgeMeAverageRating: toNumber(metrics.judgeMeAverageRating),
    yotpoReviewCount: toInteger(metrics.yotpoReviewCount),
    looxReviewCount: toInteger(metrics.looxReviewCount),
    productMomentumScore: firstNullableInteger(metrics.productMomentumScore, metrics.productMomentum?.score),
    productMomentumTier: normalizeString(metrics.productMomentumTier || metrics.productMomentum?.tier) || null,
    momentumDirection: normalizeString(metrics.momentumDirection || metrics.productMomentum?.direction) || null,
    momentumConfidence: firstNullableInteger(metrics.momentumConfidence, metrics.productMomentum?.confidence),
    momentumConfidenceLabel: normalizeString(metrics.momentumConfidenceLabel || metrics.productMomentum?.confidenceLabel) || null,
    signalTrend: getNumberArray(metrics.signalTrend),
    riskTrend: getNumberArray(metrics.riskTrend),
    topReturnReasons: getStringArray(metrics.topReturnReasons),
    affectedVariants: getStringArray(metrics.affectedVariants),
    impactFactors: isPlainObject(metrics.impactFactors) ? metrics.impactFactors : null,
    estimatedImpactFactors: isPlainObject(metrics.estimatedImpactFactors) ? metrics.estimatedImpactFactors : null,
    searchText: buildRollupSearchText({
      productTitle: snapshot.productTitle,
      handle: snapshot.handle,
      primaryIssue: snapshot.primaryIssue,
      vendor: metrics.vendor,
      productType: metrics.productType,
      collections,
      tags,
      sourceCoverage,
    }),
    snapshotUpdatedAt: toDate(snapshot.updatedAt),
    calculatedAt: toDate(snapshot.calculatedAt),
    rollupVersion: PRODUCT_PULSE_PRODUCT_ROLLUP_VERSION,
  };
}

export function productPulseProductRollupToSnapshotRow(rollup = {}) {
  const latestDiagnosisAt = toDate(rollup.latestDiagnosisAt);
  const snapshotUpdatedAt = toDate(rollup.snapshotUpdatedAt) || toDate(rollup.updatedAt) || latestDiagnosisAt || toDate(rollup.calculatedAt);
  const row = {
    id: rollup.id,
    shop: rollup.shop,
    productGid: rollup.productGid,
    productTitle: rollup.productTitle,
    handle: rollup.handle || "",
    riskScore: toInteger(rollup.riskScore),
    impactScore: toInteger(rollup.impactScore),
    confidence: toInteger(rollup.confidence),
    primaryIssue: rollup.primaryIssue || "",
    sourceCoverage: getStringArray(rollup.sourceCoverage),
    metrics: buildProductPulseProductRollupMetrics(rollup),
    calculatedAt: toDate(rollup.calculatedAt) || snapshotUpdatedAt,
    updatedAt: snapshotUpdatedAt,
  };

  if (rollup.latestDiagnosisId) {
    row.tableLatestDiagnosisId = rollup.latestDiagnosisId;
    row.tableLatestDiagnosisShop = rollup.shop;
    row.tableLatestDiagnosisProductGid = rollup.productGid;
    row.tableLatestDiagnosisProductTitle = rollup.productTitle;
    row.tableLatestDiagnosisStatus = "Completed";
    row.tableLatestDiagnosisRiskScore = toInteger(rollup.riskScore);
    row.tableLatestDiagnosisConfidence = toInteger(rollup.confidence);
    row.tableLatestDiagnosisLikelyCause = rollup.primaryIssue || "";
    row.tableLatestDiagnosisCreatedAt = latestDiagnosisAt || snapshotUpdatedAt;
    row.tableLatestDiagnosisCompletedAt = latestDiagnosisAt || snapshotUpdatedAt;
  }

  if (rollup.isResolved) {
    row.tableResolutionActionType = "mark-resolved";
    row.tableResolutionCreatedAt = toDate(rollup.resolvedAt) || snapshotUpdatedAt;
    row.tableResolutionAppliedAt = toDate(rollup.resolvedAt) || snapshotUpdatedAt;
  }

  return row;
}

export function buildProductPulseProductRollupMetrics(rollup = {}) {
  const latestDiagnosisAt = toIso(rollup.latestDiagnosisAt);
  const soldUnits = Math.max(toInteger(rollup.soldUnits), toInteger(rollup.returnUnits), toInteger(rollup.refundUnits));
  const customerTextSignals = toInteger(rollup.customerTextSignals);
  const metrics = {
    imageUrl: rollup.imageUrl || "",
    productImageUrl: rollup.imageUrl || "",
    featuredImageUrl: rollup.imageUrl || "",
    imageAlt: rollup.imageAlt || "",
    productImageAlt: rollup.imageAlt || "",
    featuredImageAlt: rollup.imageAlt || "",
    vendor: rollup.vendor || "",
    productType: rollup.productType || "",
    collections: getStringArray(rollup.collections),
    tags: getStringArray(rollup.tags),
    sku: rollup.sku || "",
    latestDiagnosisId: rollup.latestDiagnosisId || null,
    lastDetailedDiagnosisAt: latestDiagnosisAt,
    reviewRating: toNumber(rollup.reviewRating),
    avgRating: toNumber(rollup.avgRating),
    reviewCount: toInteger(rollup.reviewCount),
    negativeReviewCount: toInteger(rollup.negativeReviewCount),
    negativeReviewRate: toNumber(rollup.negativeReviewRate),
    recentNegativeReviewCount: toInteger(rollup.recentNegativeReviewCount),
    returnRate: toNumber(rollup.returnRate),
    refundRate: toNumber(rollup.refundRate),
    returnUnits: toInteger(rollup.returnUnits),
    refundUnits: toInteger(rollup.refundUnits),
    recentSignalUnits: toInteger(rollup.recentSignalUnits),
    windowDays: toInteger(rollup.windowDays) || 60,
    soldUnits,
    soldOrders: toInteger(rollup.soldOrders),
    storeAvgReturnRate: toNumber(rollup.storeAvgReturnRate),
    storeAvgRefundRate: toNumber(rollup.storeAvgRefundRate),
    lastSignalAt: toIso(rollup.lastSignalAt),
    signalCount: toInteger(rollup.signalCount),
    signalsCount: toInteger(rollup.signalCount),
    issueCount: toInteger(rollup.signalCount),
    revenueAtRisk: toNumber(rollup.revenueAtRisk),
    estimatedImpact: toNumber(rollup.estimatedImpact),
    marginAtRisk: toNumber(rollup.marginAtRisk),
    salesAmount: toNumber(rollup.salesAmount),
    avgUnitRevenue: toNumber(rollup.avgUnitRevenue),
    refundAmount: toNumber(rollup.refundAmount),
    marginRate: toNullableNumber(rollup.marginRate),
    customerTextSignals,
    contentIssueCount: toInteger(rollup.contentIssueCount),
    descriptionWords: toInteger(rollup.descriptionWordCount),
    descriptionWordCount: toInteger(rollup.descriptionWordCount),
    csvReviewCount: toInteger(rollup.csvReviewCount),
    csvReviewRatingCount: toInteger(rollup.csvReviewRatingCount),
    csvNegativeReviewCount: toInteger(rollup.csvNegativeReviewCount),
    csvAverageRating: toNumber(rollup.csvAverageRating),
    judgeMeReviewCount: toInteger(rollup.judgeMeReviewCount),
    judgeMeNegativeReviewCount: toInteger(rollup.judgeMeNegativeReviewCount),
    judgeMeAverageRating: toNumber(rollup.judgeMeAverageRating),
    yotpoReviewCount: toInteger(rollup.yotpoReviewCount),
    looxReviewCount: toInteger(rollup.looxReviewCount),
    productMomentumScore: toNullableNumber(rollup.productMomentumScore),
    productMomentumTier: rollup.productMomentumTier || "",
    momentumDirection: rollup.momentumDirection || "",
    momentumConfidence: toNullableNumber(rollup.momentumConfidence),
    momentumConfidenceLabel: rollup.momentumConfidenceLabel || "",
    signalTrend: getNumberArray(rollup.signalTrend),
    riskTrend: getNumberArray(rollup.riskTrend),
    topReturnReasons: getStringArray(rollup.topReturnReasons),
    affectedVariants: getStringArray(rollup.affectedVariants),
    impactFactors: isPlainObject(rollup.impactFactors) ? rollup.impactFactors : null,
    estimatedImpactFactors: isPlainObject(rollup.estimatedImpactFactors) ? rollup.estimatedImpactFactors : null,
    sourceCoverage: getStringArray(rollup.sourceCoverage),
    monthlyOrderActivity: {
      summary: {
        totalOrderUnits: soldUnits,
        returnRate: toNumber(rollup.returnRate),
        refundRate: toNumber(rollup.refundRate),
      },
    },
    textInsights: customerTextSignals > 0 ? { sentiment: { total: customerTextSignals } } : null,
  };

  metrics.productMomentum = buildRollupProductMomentum(metrics);
  return metrics;
}

function buildRollupProductMomentum(metrics = {}) {
  const score = toNullableNumber(metrics.productMomentumScore);
  if (
    score === null
    && !metrics.productMomentumTier
    && !metrics.momentumDirection
    && metrics.momentumConfidence === null
  ) {
    return null;
  }
  return {
    source: "product-rollup",
    score: score || 0,
    tier: metrics.productMomentumTier || "",
    direction: metrics.momentumDirection || "",
    confidence: metrics.momentumConfidence || 0,
    confidenceLabel: metrics.momentumConfidenceLabel || "",
    windowDays: metrics.windowDays || 60,
  };
}

function getSnapshotProductImage(snapshot = {}) {
  const metrics = isPlainObject(snapshot.metrics) ? snapshot.metrics : {};
  const imageUrl = [
    metrics.imageUrl,
    metrics.productImageUrl,
    metrics.featuredImageUrl,
    typeof metrics.image === "string" ? metrics.image : metrics.image?.url,
    metrics.featuredImage?.url,
  ].map(normalizeString).find(Boolean) || "";
  const imageAlt = [
    metrics.imageAlt,
    metrics.productImageAlt,
    metrics.featuredImageAlt,
    metrics.image?.altText,
    metrics.featuredImage?.altText,
    snapshot.productTitle,
  ].map(normalizeString).find(Boolean) || "";
  return { imageUrl, imageAlt };
}

function buildRollupSearchText(parts = {}) {
  return [
    parts.productTitle,
    parts.handle,
    parts.primaryIssue,
    parts.vendor,
    parts.productType,
    ...(Array.isArray(parts.collections) ? parts.collections : []),
    ...(Array.isArray(parts.tags) ? parts.tags : []),
    ...(Array.isArray(parts.sourceCoverage) ? parts.sourceCoverage : []),
  ].map(normalizeString).filter(Boolean).join(" ").toLowerCase();
}

function removeUndefined(data = {}) {
  return Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
}

function getStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeString).filter(Boolean);
}

function getNumberArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(Number).filter(Number.isFinite);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

function normalizeString(value) {
  return String(value ?? "").trim();
}

function firstNumber(...values) {
  for (const value of values) {
    const number = toNullableNumber(value);
    if (number !== null) return number;
  }
  return 0;
}

function firstInteger(...values) {
  return Math.round(firstNumber(...values));
}

function firstNullableInteger(...values) {
  for (const value of values) {
    const number = toNullableNumber(value);
    if (number !== null) return Math.round(number);
  }
  return null;
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toInteger(value) {
  return Math.round(toNumber(value));
}

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function toIso(value) {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}
