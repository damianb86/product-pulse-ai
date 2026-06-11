import prisma from "../db.server";
import {
  resumeProductDiagnosisAiAnalysisFromBatch,
  runProductDiagnosisAiAnalysis,
} from "./product-pulse-ai.server";
import { summarizeAiUsage } from "./product-pulse-ai-usage.server";
import { getNormalizedCsvReviewsForShop } from "./product-pulse-csv.server";
import {
  getReconstructedProductScoreHistoryForShop,
  recordProductScoreHistory,
  recordReconstructedProductScoreHistory,
} from "./product-pulse-history.server";
import { recordJobLog, serializeError } from "./product-pulse-job-logs.server";
import { getAnalysisLookbackDays, getProductPulseSettings } from "./product-pulse-settings.server";
import {
  buildDatedSignalTrend,
  buildIssueTrendMap,
  buildRiskTrendFromSignalTrend,
} from "./product-pulse-trends.server";
import {
  recordTimelineForDiagnosis,
  recordTimelineForLatestScoreSnapshots,
  recordTimelineForNoChangeDiagnosis,
  recordTimelineForProductAction,
} from "./product-pulse-timeline.server";
import { recordWatchlistScanActivities } from "./product-pulse-watchlist.server";
import { calculateProductScoreModel, calibrateProductRiskScore } from "./product-pulse-scoring";
import { buildReturnRefundRelationshipSummary } from "./product-pulse-return-refund-relationship.server";
import { buildProductPurchaseContextSummary } from "./product-pulse-purchase-context.server";
import { buildProductRelationshipSummary } from "./product-pulse-product-relationships.server";
import {
  attachProductRetentionPayloadToDiagnosis,
  calculateProductRetentionMetrics,
  calculateProductRetentionPreview,
} from "./product-pulse-retention.server";
import {
  filterDisabledProductActions,
  isDisabledProductAction,
} from "./product-pulse-disabled-actions";
import {
  authenticateYotpo,
  fetchYotpoProductReviewPages,
  fetchYotpoReviewPages,
} from "./product-pulse-yotpo.server";
import {
  fetchLooxProductReviewPages,
  fetchLooxReviewPages,
} from "./product-pulse-loox.server";
import { upsertProductPulseProductRollup, upsertProductPulseProductRollups } from "./product-pulse-product-rollup.server";

const DIAGNOSIS_DEFAULT_WINDOW_DAYS = 60;
const PRODUCT_RETENTION_DEFAULT_LOOKBACK_DAYS_FOR_DIAGNOSIS = 365;
const PRODUCT_RETENTION_MAX_COHORT_AGE_DAYS_FOR_DIAGNOSIS = 180;
const MAX_ORDER_PAGES = 12;
const DIAGNOSIS_TARGETED_ORDER_MAX_PAGES = getNonNegativeIntegerEnv("PRODUCT_PULSE_DIAGNOSIS_TARGETED_ORDER_MAX_PAGES", 0);
const DIAGNOSIS_TARGETED_ORDER_MAX_SKUS = getBoundedIntegerEnv("PRODUCT_PULSE_DIAGNOSIS_TARGETED_ORDER_MAX_SKUS", 20, 1, 100);
const MAX_JUDGEME_REVIEW_PAGES = 3;
const MAX_JUDGEME_SYNC_PAGES = 5;
const MAX_YOTPO_PRODUCT_REVIEW_PAGES = 3;
const MAX_YOTPO_SYNC_PAGES = 5;
const MAX_LOOX_PRODUCT_REVIEW_PAGES = 3;
const MAX_LOOX_SYNC_PAGES = 5;
const MONTHLY_ORDER_ACTIVITY_MAX_MONTHS = 12;
const RETURN_RATE_PREDICTION_MAX_WEEKS = 52;
const RETURN_RATE_PREDICTION_FORECAST_WEEKS = 13;
const RECONSTRUCTED_RISK_HISTORY_MAX_WEEKLY_POINTS = 58;
const RECONSTRUCTED_RISK_HISTORY_MAX_MONTHLY_POINTS = 24;
const RECONSTRUCTED_RISK_HISTORY_MONTHLY_THRESHOLD_DAYS = 370;
const RECONSTRUCTED_RISK_HISTORY_MIN_LOOKBACK_DAYS = 365;
const PRODUCT_MOMENTUM_BASELINE_DAYS = 90;
const SOURCE_EVENT_CACHE_SCHEMA_VERSION = 4;
const MAX_SOURCE_EVENT_CACHE_ITEMS = 2500;
const SHOP_SOURCE_EVENT_CACHE_KEY_PREFIX = "diagnosis-source-events";
const SHOP_SOURCE_EVENT_CACHE_FRESH_MS = Math.max(30_000, Number(process.env.PRODUCT_PULSE_SHOPIFY_SOURCE_CACHE_FRESH_MS || 10 * 60 * 1000));
const SHOP_SOURCE_EVENT_CACHE_MAX_HIT_LAG_MS = Math.max(0, Number(process.env.PRODUCT_PULSE_SHOPIFY_SOURCE_CACHE_MAX_HIT_LAG_MS ?? 30_000));
const SHOP_SOURCE_EVENT_CACHE_WRITE_BATCH_SIZE = 400;
const PRODUCT_EVOLUTION_KNOWN_ISSUE_KEYS = new Set([
  "fit_sizing",
  "color_expectation",
  "durability",
  "quality_defect",
  "compatibility",
  "setup_expectation",
  "shipping_delivery",
  "product_content",
  "product_quality",
  "safety_concern",
  "subjective_negative_reaction",
  "negative_sentiment",
  "repeated_language",
  "return_rate_anomaly",
  "refund_impact",
  "review_feed_integrity",
  "source_integrity",
]);
const SEO_TITLE_MAX_LENGTH = 70;
const SEO_META_DESCRIPTION_MAX_LENGTH = 160;
const JUDGEME_BASE_URLS = ["https://api.judge.me/api/v1", "https://judge.me/api/v1"];
const DIAGNOSIS_ORDERS_PAGE_SIZE = 8;
const DIAGNOSIS_TARGETED_ORDERS_PAGE_SIZE = getBoundedIntegerEnv("PRODUCT_PULSE_DIAGNOSIS_TARGETED_ORDERS_PAGE_SIZE", 25, 1, 250);
const DIAGNOSIS_ORDER_LINE_ITEMS_PAGE_SIZE = 25;
const DIAGNOSIS_TARGETED_ORDER_LINE_ITEMS_PAGE_SIZE = getBoundedIntegerEnv("PRODUCT_PULSE_DIAGNOSIS_TARGETED_ORDER_LINE_ITEMS_PAGE_SIZE", 100, 1, 250);
const DIAGNOSIS_REFUND_LINE_ITEMS_PAGE_SIZE = 20;
const DIAGNOSIS_REFUND_FALLBACK_LINE_ITEMS_PAGE_SIZE = 25;
const DIAGNOSIS_REFUND_ORDER_ADJUSTMENTS_PAGE_SIZE = 5;
const MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE = 2;
const SIGNAL_WEIGHT_FULL_STRENGTH_DAYS = 30;
const SIGNAL_WEIGHT_BUCKET_DAYS = 30;
const SIGNAL_WEIGHT_AGE_DECAY_RATE = 0.38;
const SIGNAL_WEIGHT_AGE_DECAY_EXPONENT = 1.15;
const SIGNAL_WEIGHT_ORDER_DECAY_INTERVAL = 35;
const SIGNAL_WEIGHT_MIN = 0.03;
const MIN_EXPECTATION_ISSUE_SIGNALS_FOR_MERCHANT_ISSUE = 3;
const MIN_EXPECTATION_HARD_EVENTS_FOR_MERCHANT_ISSUE = 2;
const EXPECTATION_ISSUE_CODES = new Set([
  "fit_sizing",
  "color_expectation",
  "setup_expectation",
  "compatibility",
]);
const DIAGNOSIS_REFUND_QUERY_PLANS = [
  { label: "balanced", ordersFirst: 8, refundLineItemsFirst: DIAGNOSIS_REFUND_LINE_ITEMS_PAGE_SIZE, fallbackLineItemsFirst: DIAGNOSIS_REFUND_FALLBACK_LINE_ITEMS_PAGE_SIZE, orderAdjustmentsFirst: DIAGNOSIS_REFUND_ORDER_ADJUSTMENTS_PAGE_SIZE, includeVariantProduct: true, includeAdjustments: true },
  { label: "low-cost", ordersFirst: 5, refundLineItemsFirst: 10, fallbackLineItemsFirst: 18, orderAdjustmentsFirst: 3, includeVariantProduct: true, includeAdjustments: true },
  { label: "minimal", ordersFirst: 4, refundLineItemsFirst: 8, fallbackLineItemsFirst: 12, orderAdjustmentsFirst: 0, includeVariantProduct: false, includeAdjustments: false },
];
const DIAGNOSIS_RETURN_QUERY_PLANS = [
  { label: "balanced", ordersFirst: 8, returnsFirst: 3, returnLineItemsFirst: 15, includeVariantProduct: true },
  { label: "low-cost", ordersFirst: 5, returnsFirst: 2, returnLineItemsFirst: 10, includeVariantProduct: true },
  { label: "minimal", ordersFirst: 4, returnsFirst: 2, returnLineItemsFirst: 8, includeVariantProduct: false },
];

function getNonNegativeIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value < 0) return Math.max(0, Math.trunc(Number(fallback || 0)));
  return Math.trunc(value);
}

function getBoundedIntegerEnv(name, fallback, min, max) {
  const lowerBound = Math.trunc(Number(min || 0));
  const upperBound = Math.trunc(Number(max || lowerBound));
  const fallbackValue = Number.isFinite(Number(fallback)) ? Math.trunc(Number(fallback)) : lowerBound;
  const value = Number(process.env[name]);
  const normalized = Number.isFinite(value) ? Math.trunc(value) : fallbackValue;
  return Math.max(lowerBound, Math.min(upperBound, normalized));
}

const US_STATE_NAMES = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  DC: "District of Columbia",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
};

function buildProductDiagnosisPerfContext({ shop, jobId, snapshot } = {}) {
  return {
    shop,
    jobId,
    productGid: snapshot?.productGid || null,
    handle: snapshot?.handle || null,
    productTitle: snapshot?.productTitle || snapshot?.title || null,
    startedAt: Date.now(),
    flushed: false,
  };
}

async function measureProductDiagnosisPerfStep(stage, context, callback, data = {}, summarizeResult = null) {
  void stage;
  void context;
  void data;
  void summarizeResult;
  return callback();
}

function logProductDiagnosisPerf(event, context = {}, data = {}, level = "warn") {
  void event;
  void context;
  void data;
  void level;
}

function recordProductDiagnosisPerfEvent(context, event, data = {}, level = "warn") {
  void context;
  void event;
  void data;
  void level;
}

function flushProductDiagnosisSummaryLog(context, data = {}, level = "warn") {
  if (context) context.flushed = true;
  void data;
  void level;
}

function summarizeReconstructedRiskHistory(history) {
  if (Array.isArray(history)) return { rawPoints: history.length, weeklyPoints: 0, monthlyPoints: 0 };
  return {
    rawPoints: history?.raw?.length || history?.points?.length || 0,
    weeklyPoints: history?.weekly?.length || 0,
    monthlyPoints: history?.monthly?.length || 0,
  };
}

function summarizeShopifyDiagnosisData(data = {}) {
  return {
    productFound: Boolean(data.product?.id),
    salesEvents: data.sales?.length || 0,
    relationshipSalesEvents: data.relationshipSales?.length || 0,
    refundEvents: data.refunds?.length || 0,
    returnEvents: data.returns?.length || 0,
    orderAccessDenied: Boolean(data.orderAccessDenied),
    incrementalMode: data.incrementalSource?.mode || null,
    sourceFetchComplete: data.incrementalSource?.fetchComplete ?? null,
    rawFetchedCounts: data.incrementalSource?.rawFetchedCounts || null,
    mergedCounts: data.incrementalSource?.mergedCounts || null,
  };
}

function summarizeReviewDiagnosisData(data = {}) {
  return {
    connected: Boolean(data.connected),
    reviews: data.reviews?.length || 0,
    matchConfidence: data.matchConfidence || 0,
    errors: data.errors?.length || 0,
  };
}

function summarizeMomentumCatalogBaseline(data = {}) {
  return {
    hasBaseline: Boolean(data),
    productCount: data?.productCount || data?.products?.length || data?.catalogProductCount || 0,
    comparisonProducts: data?.comparisonProducts?.length || data?.peers?.length || 0,
  };
}

function summarizeDeterministicDiagnosis(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  return {
    riskScore: deterministic.riskScore ?? null,
    confidence: deterministic.confidence ?? null,
    estimatedImpact: deterministic.estimatedImpact ?? metrics.estimatedImpact ?? null,
    mainIssue: deterministic.mainIssue || null,
    sourceCoverage: deterministic.sourceCoverage?.length || 0,
    evidenceSnippets: deterministic.evidenceSnippets?.length || 0,
    soldUnits: metrics.soldUnits ?? null,
    returnUnits: metrics.returnUnits ?? null,
    refundUnits: metrics.refundUnits ?? null,
    reviewCount: metrics.reviewCount ?? null,
    negativeReviewCount: metrics.negativeReviewCount ?? null,
    relationshipCandidates: metrics.productRelationshipIntelligenceSummary?.relationships?.length || 0,
  };
}

function summarizeProductRetentionResult(result = {}) {
  return {
    status: result?.status || null,
    retentionRunId: result?.retentionRunId || null,
    hasPayload: Boolean(result?.payload),
    hasEnoughData: result?.payload?.summary?.hasEnoughData ?? null,
    orderCount: result?.payload?.summary?.orderCount ?? result?.orders?.length ?? null,
    reusedPreviewOrders: Boolean(result?.reusedPreviewOrders),
  };
}

function summarizeAiInput(input = {}) {
  return {
    evidenceSnippets: input.evidenceSnippets?.length || 0,
    recommendationCandidates: input.recommendationCandidates?.length || 0,
    classifiedSignals: input.deterministic?.classifiedSignals?.length || 0,
    incrementalMode: input.incremental?.mode || null,
    productGid: input.product?.id || input.product?.productGid || null,
    batchMode: input.batchMode?.enabled ? input.batchMode.reason || "enabled" : null,
  };
}

function normalizeDiagnosisBatchMode(batchMode = null) {
  if (!batchMode || typeof batchMode !== "object") return null;
  return {
    enabled: Boolean(batchMode.enabled),
    freeCreditMode: Boolean(batchMode.freeCreditMode),
    forceOpenAiBatch: Boolean(batchMode.forceOpenAiBatch),
    reason: String(batchMode.reason || "").trim() || null,
    queuedAt: batchMode.queuedAt || null,
    cooldownHours: Number(batchMode.cooldownHours || 0) || null,
  };
}

function summarizeAiDiagnosisResult(ai = {}) {
  return {
    provider: ai.provider || null,
    model: ai.model || null,
    modelTasks: ai.modelsUsed ? Object.keys(ai.modelsUsed).filter((key) => ai.modelsUsed[key]).length : 0,
    usageTotalTokens: ai.aiUsage?.totalTokens ?? ai.aiUsage?.total_tokens ?? null,
    usageCallCount: ai.aiUsage?.knownTokenCallCount ?? ai.aiUsage?.calls?.length ?? null,
    hasChartInterpretations: Boolean(ai.chartInterpretations?.available),
    relationshipInsights: ai.relationshipInsights?.insights?.length || 0,
  };
}

function summarizeDiagnosisPayload(payload = {}) {
  return {
    riskScore: payload.riskScore ?? null,
    confidence: payload.confidence ?? null,
    estimatedImpact: payload.metrics?.estimatedImpact ?? null,
    issues: payload.issues?.length || 0,
    evidence: payload.evidence?.length || 0,
    recommendations: payload.recommendations?.length || 0,
    metricKeys: payload.metrics ? Object.keys(payload.metrics).length : 0,
  };
}

export async function runDetailedProductDiagnosis({ shop, jobId, admin, snapshot, batchMode = null }) {
  const perfContext = buildProductDiagnosisPerfContext({ shop, jobId, snapshot });
  const startedAt = Date.now();
  logProductDiagnosisPerf("product_diagnosis.deep_analysis.started", perfContext, {
    snapshotRiskScore: snapshot?.riskScore ?? null,
    snapshotConfidence: snapshot?.confidence ?? null,
    sourceCoverage: snapshot?.sourceCoverage || [],
  });

  try {
  const settings = await measureProductDiagnosisPerfStep("settings", perfContext, () => getProductPulseSettings(shop));
  const windowDays = getAnalysisLookbackDays(settings);
  logProductDiagnosisPerf("product_diagnosis.window_resolved", perfContext, { windowDays });
  const storedReconstructedRiskHistory = await measureProductDiagnosisPerfStep(
    "reconstructed_risk_history",
    perfContext,
    () => getReconstructedProductScoreHistoryForShop(shop, snapshot.productGid),
    { windowDays },
    summarizeReconstructedRiskHistory,
  );
  const shopifyData = await measureProductDiagnosisPerfStep(
    "shopify_data",
    perfContext,
    () => fetchShopifyDiagnosisData({ shop, jobId, admin, snapshot, windowDays, perfContext }),
    { windowDays },
    summarizeShopifyDiagnosisData,
  );
  const judgeMeData = await measureProductDiagnosisPerfStep(
    "judgeme_reviews",
    perfContext,
    () => fetchJudgeMeDiagnosisData({ shop, jobId, snapshot, shopifyProduct: shopifyData.product, windowDays }),
    { windowDays },
    summarizeReviewDiagnosisData,
  );
  const yotpoData = await measureProductDiagnosisPerfStep(
    "yotpo_reviews",
    perfContext,
    () => fetchYotpoDiagnosisData({ shop, jobId, snapshot, shopifyProduct: shopifyData.product, windowDays }),
    { windowDays },
    summarizeReviewDiagnosisData,
  );
  const looxData = await measureProductDiagnosisPerfStep(
    "loox_reviews",
    perfContext,
    () => fetchLooxDiagnosisData({ shop, jobId, snapshot, shopifyProduct: shopifyData.product, windowDays }),
    { windowDays },
    summarizeReviewDiagnosisData,
  );
  const csvReviewData = await measureProductDiagnosisPerfStep(
    "csv_reviews",
    perfContext,
    () => fetchCsvReviewDiagnosisData({ shop, jobId, snapshot, shopifyProduct: shopifyData.product, windowDays }),
    { windowDays },
    summarizeReviewDiagnosisData,
  );
  const momentumCatalogBaseline = await measureProductDiagnosisPerfStep(
    "momentum_catalog_baseline",
    perfContext,
    () => fetchProductMomentumCatalogBaseline({ shop, currentProductGid: snapshot.productGid }),
    {},
    summarizeMomentumCatalogBaseline,
  );
  const taxonomyCategorySuggestions = await measureProductDiagnosisPerfStep(
    "taxonomy_category_suggestions",
    perfContext,
    () => fetchProductTaxonomyCategorySuggestions({ admin, product: shopifyData.product }),
    {},
    (result) => ({ suggestions: result?.length || 0 }),
  );
  const baseDeterministic = await measureProductDiagnosisPerfStep(
    "deterministic_metrics",
    perfContext,
    () => calculateDeterministicDiagnosis({
      snapshot,
      shopifyData,
      judgeMeData,
      yotpoData,
      looxData,
      csvReviewData,
      windowDays,
      momentumCatalogBaseline,
      taxonomyCategorySuggestions,
      storedReconstructedRiskHistory,
    }),
    { windowDays },
    summarizeDeterministicDiagnosis,
  );
  const relationshipCollectionSuggestions = await measureProductDiagnosisPerfStep(
    "relationship_collection_suggestions",
    perfContext,
    () => fetchProductRelationshipCollectionSuggestions({
      admin,
      product: shopifyData.product,
      relationshipSummary: baseDeterministic.metrics.productRelationshipIntelligenceSummary,
    }),
    {},
    (result) => ({ suggestions: result?.length || 0 }),
  );
  const relationshipEnrichedDeterministic = await measureProductDiagnosisPerfStep(
    "relationship_deterministic_enrichment",
    perfContext,
    () => (relationshipCollectionSuggestions.length
      ? attachRelationshipCollectionSuggestionsToDeterministic(baseDeterministic, relationshipCollectionSuggestions)
      : baseDeterministic),
    { suggestions: relationshipCollectionSuggestions.length },
    summarizeDeterministicDiagnosis,
  );
  const retentionPreview = await measureProductDiagnosisPerfStep(
    "retention_preview",
    perfContext,
    () => calculateProductRetentionPreviewForDiagnosis({
      shop,
      jobId,
      admin,
      snapshot,
      windowDays,
    }),
    { windowDays },
    summarizeProductRetentionResult,
  );
  const deterministic = await measureProductDiagnosisPerfStep(
    "retention_preview_attach",
    perfContext,
    () => attachProductRetentionPreviewToDeterministic(relationshipEnrichedDeterministic, retentionPreview?.payload),
    {},
    summarizeDeterministicDiagnosis,
  );
  const recommendationCandidates = await measureProductDiagnosisPerfStep(
    "rule_recommendation_candidates",
    perfContext,
    () => buildRuleRecommendationCandidates(deterministic),
    {},
    (result) => ({ candidates: result?.length || 0 }),
  );
  const productEvolution = await measureProductDiagnosisPerfStep(
    "product_evolution_context",
    perfContext,
    () => buildProductDiagnosisEvolutionContext({
      shop,
      snapshot,
      deterministic,
      recommendationCandidates,
    }),
    {},
    summarizeProductEvolutionContext,
  );
  const diagnosisDeterministic = attachProductEvolutionToDeterministic(deterministic, productEvolution);
  const evolvedRecommendationCandidates = applyProductEvolutionToRecommendationCandidates(recommendationCandidates, productEvolution);
  const aiInput = await measureProductDiagnosisPerfStep(
    "ai_input_build",
    perfContext,
    () => ({
      product: buildAiProductInput(shopifyData.product, snapshot),
      deterministic: buildAiDeterministicInput(diagnosisDeterministic),
      evidenceSnippets: diagnosisDeterministic.evidenceSnippets,
      recommendationCandidates: evolvedRecommendationCandidates,
      incremental: buildAiIncrementalDiagnosisInput(diagnosisDeterministic),
      productEvolution: sanitizeProductEvolutionForAi(productEvolution),
      previousPrimaryIssue: snapshot.primaryIssue || null,
      batchMode: normalizeDiagnosisBatchMode(batchMode),
    }),
    {},
    summarizeAiInput,
  );

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.metrics_calculated",
    message: "Deterministic product diagnosis metrics were calculated before AI.",
    data: {
      productGid: snapshot.productGid,
      soldUnits: diagnosisDeterministic.metrics.soldUnits,
      returnUnits: diagnosisDeterministic.metrics.returnUnits,
      refundUnits: diagnosisDeterministic.metrics.refundUnits,
      refundAmount: diagnosisDeterministic.metrics.refundAmount,
      monthlyOrderActivity: diagnosisDeterministic.metrics.monthlyOrderActivity?.summary || null,
      returnRatePrediction: diagnosisDeterministic.metrics.returnRatePrediction?.summary || null,
      productMomentum: diagnosisDeterministic.metrics.productMomentum ? {
        score: diagnosisDeterministic.metrics.productMomentum.score,
        tier: diagnosisDeterministic.metrics.productMomentum.tier,
        direction: diagnosisDeterministic.metrics.productMomentum.direction,
        confidence: diagnosisDeterministic.metrics.productMomentum.confidence,
      } : null,
      reviewCount: diagnosisDeterministic.metrics.reviewCount,
      negativeReviewCount: diagnosisDeterministic.metrics.negativeReviewCount,
      customerTextSignals: diagnosisDeterministic.metrics.textInsights?.sentiment?.total || 0,
      negativeTextSignals: diagnosisDeterministic.metrics.textInsights?.sentiment?.negative || 0,
      subjectiveNegativeSignals: diagnosisDeterministic.metrics.textInsights?.subjectiveNegativity?.count || 0,
      deterministicEmotionCounts: diagnosisDeterministic.metrics.textInsights?.emotions || [],
      otherReturnClassifications: diagnosisDeterministic.metrics.textInsights?.otherReturnClassifications || [],
      riskScore: diagnosisDeterministic.riskScore,
      confidence: diagnosisDeterministic.confidence,
      estimatedImpact: diagnosisDeterministic.estimatedImpact,
      mainIssue: diagnosisDeterministic.mainIssue,
      sourceCoverage: diagnosisDeterministic.sourceCoverage,
      incrementalDiagnosis: {
        mode: diagnosisDeterministic.metrics.incrementalDiagnosis?.mode || "full",
        previousCompletedAt: diagnosisDeterministic.metrics.incrementalDiagnosis?.previousCompletedAt || null,
        productContent: diagnosisDeterministic.metrics.incrementalDiagnosis?.productContent || null,
        customerText: diagnosisDeterministic.metrics.incrementalDiagnosis?.customerText || null,
        refunds: diagnosisDeterministic.metrics.incrementalDiagnosis?.refunds || null,
        sourceChanges: diagnosisDeterministic.metrics.incrementalDiagnosis?.sourceChanges || null,
        aiEvidenceSnippetCount: diagnosisDeterministic.metrics.incrementalDiagnosis?.aiEvidenceSnippetCount || diagnosisDeterministic.evidenceSnippets.length,
      },
      productEvolution: summarizeProductEvolutionForJobLog(productEvolution),
    },
  });

  await measureProductDiagnosisPerfStep(
    "relationship_candidate_snapshots",
    perfContext,
    () => ensureProductRelationshipCandidateSnapshots({
      shop,
      jobId,
      sourceSnapshot: snapshot,
      relationshipSummary: diagnosisDeterministic.metrics.productRelationshipIntelligenceSummary,
    }),
    {},
    (result) => ({
      created: result?.created || 0,
      updated: result?.updated || 0,
    }),
  );

  const reuseDecision = await measureProductDiagnosisPerfStep(
    "reuse_decision",
    perfContext,
    () => getNoChangeDiagnosisReuseDecision({ snapshot, deterministic: diagnosisDeterministic }),
    {},
    (result) => ({
      shouldReuse: Boolean(result?.shouldReuse),
      reason: result?.reason || result?.skipReason || null,
    }),
  );
  if (reuseDecision.shouldReuse) {
    const reusedDiagnosis = await measureProductDiagnosisPerfStep(
      "no_change_reuse",
      perfContext,
      () => buildNoChangeDiagnosisReuseResult({
        shop,
        jobId,
        snapshot,
        deterministic: diagnosisDeterministic,
        reuseDecision,
      }),
      {},
      (result) => ({
        reused: Boolean(result),
        diagnosisId: result?.diagnosisId || null,
        skipReason: result?.skipReason || null,
      }),
    );
    if (reusedDiagnosis) {
      flushProductDiagnosisSummaryLog(perfContext, {
        status: "completed",
        durationMs: Date.now() - startedAt,
        skipped: true,
        skipReason: reusedDiagnosis.skipReason,
        diagnosisId: reusedDiagnosis.diagnosisId,
      });
      return reusedDiagnosis;
    }
  }

  const ai = await measureProductDiagnosisPerfStep(
    "ai_analysis",
    perfContext,
    () => runProductDiagnosisAiAnalysis({
      shop,
      jobId,
      input: aiInput,
      resumeContext: {
        snapshot,
        shopifyData,
        judgeMeData,
        yotpoData,
        looxData,
        csvReviewData,
        deterministic: diagnosisDeterministic,
        retentionPreview,
        windowDays,
        batchMode: normalizeDiagnosisBatchMode(batchMode),
      },
      onPerfEvent: (event, data, level) => recordProductDiagnosisPerfEvent(perfContext, event, data, level),
    }),
    summarizeAiInput(aiInput),
    summarizeAiDiagnosisResult,
  );
  if (ai?.status === "waiting_openai_batch") {
    flushProductDiagnosisSummaryLog(perfContext, {
      status: "waiting_openai_batch",
      durationMs: Date.now() - startedAt,
      skipped: false,
      productGid: snapshot.productGid,
      provider: ai.provider,
      model: ai.model,
      openAiBatch: ai.openAiBatch,
    });
    return {
      status: "waiting_openai_batch",
      productGid: snapshot.productGid,
      provider: ai.provider,
      model: ai.model,
      modelsUsed: ai.modelsUsed,
      aiUsage: ai.aiUsage,
      openAiBatch: ai.openAiBatch,
    };
  }
  const { emergentSentiments, knownEmotions } = await measureProductDiagnosisPerfStep(
    "ai_sentiment_normalization",
    perfContext,
    () => ({
      emergentSentiments: normalizeAiEmergentSentiments(ai),
      knownEmotions: normalizeAiKnownEmotions(ai, diagnosisDeterministic.metrics.textInsights),
    }),
    {},
    (result) => ({
      emergentSentiments: result?.emergentSentiments?.length || 0,
      knownEmotions: result?.knownEmotions?.length || 0,
    }),
  );
  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.emergent_sentiments_clustered",
    message: emergentSentiments.length
      ? "AI clustered emergent customer sentiments with enough evidence."
      : "AI did not find emergent customer sentiments with enough evidence.",
    data: {
      productGid: snapshot.productGid,
      knownEmotions,
      emergentSentiments,
      discardedSuggestions: ai.emergentSentiments?.discarded_suggestions || [],
    },
  });
  const diagnosisPayload = await measureProductDiagnosisPerfStep(
    "persisted_payload_build",
    perfContext,
    () => buildPersistedDiagnosis({ snapshot, shopifyData, judgeMeData, yotpoData, looxData, csvReviewData, deterministic: diagnosisDeterministic, ai }),
    {},
    summarizeDiagnosisPayload,
  );
  const diagnosis = await measureProductDiagnosisPerfStep(
    "persist_diagnosis",
    perfContext,
    () => persistDetailedDiagnosis({ shop, jobId, snapshot, payload: diagnosisPayload }),
    summarizeDiagnosisPayload(diagnosisPayload),
    (result) => ({
      diagnosisId: result?.id || null,
      completedAt: result?.completedAt || null,
    }),
  );
  const retentionResult = await measureProductDiagnosisPerfStep(
    "retention_full_attach",
    perfContext,
    () => calculateAndAttachProductRetentionForDiagnosis({
      shop,
      jobId,
      admin,
      snapshot,
      diagnosis,
      windowDays,
      retentionPreview,
    }),
    { diagnosisId: diagnosis.id, windowDays },
    summarizeProductRetentionResult,
  );

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.persisted",
    message: "Detailed product diagnosis was persisted and product signals were updated.",
    data: {
      diagnosisId: diagnosis.id,
      productGid: snapshot.productGid,
      riskScore: diagnosisPayload.riskScore,
      confidence: diagnosisPayload.confidence,
      estimatedImpact: diagnosisPayload.metrics.estimatedImpact,
      issues: diagnosisPayload.issues.map((issue) => issue.issue),
      recommendations: diagnosisPayload.recommendations.map((action) => action.label),
      modelsUsed: ai.modelsUsed,
      aiUsage: ai.aiUsage,
      productRetention: retentionResult
        ? {
          status: retentionResult.status,
          retentionRunId: retentionResult.retentionRunId,
          hasEnoughData: retentionResult.payload?.summary?.hasEnoughData ?? false,
        }
        : null,
    },
  });

  const result = {
    status: "success",
    diagnosisId: diagnosis.id,
    riskScore: diagnosisPayload.riskScore,
    confidence: diagnosisPayload.confidence,
    estimatedImpact: diagnosisPayload.metrics.estimatedImpact,
    provider: ai.provider,
    model: ai.model,
    modelsUsed: ai.modelsUsed,
    aiUsage: ai.aiUsage,
    productRetention: retentionResult?.payload || null,
  };
  flushProductDiagnosisSummaryLog(perfContext, {
    status: "completed",
    durationMs: Date.now() - startedAt,
    skipped: false,
    diagnosisId: result.diagnosisId,
    riskScore: result.riskScore,
    confidence: result.confidence,
    provider: result.provider,
    model: result.model,
  });
  return result;
  } catch (error) {
    flushProductDiagnosisSummaryLog(perfContext, {
      status: "failed",
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }, "error");
    throw error;
  }
}

export async function resumeDetailedProductDiagnosisFromOpenAiBatch({ shop, jobId, admin, batchGroupId }) {
  const startedAt = Date.now();
  const { resumePayload, ai } = await resumeProductDiagnosisAiAnalysisFromBatch({ shop, jobId, batchGroupId });
  const context = resumePayload?.resumeContext || {};
  const snapshot = context.snapshot;
  if (!snapshot?.productGid) throw new Error("OpenAI Batch resume payload is missing the product snapshot.");

  const perfContext = buildProductDiagnosisPerfContext({ shop, jobId, snapshot });
  logProductDiagnosisPerf("product_diagnosis.openai_batch_resume.started", perfContext, {
    batchGroupId,
    productGid: snapshot.productGid,
    provider: ai.provider,
    model: ai.model,
  });

  try {
    const deterministic = context.deterministic;
    const shopifyData = context.shopifyData;
    const judgeMeData = context.judgeMeData;
    const yotpoData = context.yotpoData;
    const looxData = context.looxData;
    const csvReviewData = context.csvReviewData;
    const retentionPreview = context.retentionPreview;
    const windowDays = context.windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS;

    const { emergentSentiments, knownEmotions } = await measureProductDiagnosisPerfStep(
      "ai_sentiment_normalization",
      perfContext,
      () => ({
        emergentSentiments: normalizeAiEmergentSentiments(ai),
        knownEmotions: normalizeAiKnownEmotions(ai, deterministic.metrics.textInsights),
      }),
      {},
      (result) => ({
        emergentSentiments: result?.emergentSentiments?.length || 0,
        knownEmotions: result?.knownEmotions?.length || 0,
      }),
    );
    await recordJobLog({
      shop,
      jobId,
      event: "product_diagnosis.emergent_sentiments_clustered",
      message: emergentSentiments.length
        ? "AI clustered emergent customer sentiments with enough evidence."
        : "AI did not find emergent customer sentiments with enough evidence.",
      data: {
        productGid: snapshot.productGid,
        knownEmotions,
        emergentSentiments,
        discardedSuggestions: ai.emergentSentiments?.discarded_suggestions || [],
        openAiBatchGroupId: batchGroupId,
      },
    });

    const diagnosisPayload = await measureProductDiagnosisPerfStep(
      "persisted_payload_build",
      perfContext,
      () => buildPersistedDiagnosis({ snapshot, shopifyData, judgeMeData, yotpoData, looxData, csvReviewData, deterministic, ai }),
      {},
      summarizeDiagnosisPayload,
    );
    const diagnosis = await measureProductDiagnosisPerfStep(
      "persist_diagnosis",
      perfContext,
      () => persistDetailedDiagnosis({ shop, jobId, snapshot, payload: diagnosisPayload }),
      summarizeDiagnosisPayload(diagnosisPayload),
      (result) => ({
        diagnosisId: result?.id || null,
        completedAt: result?.completedAt || null,
      }),
    );
    const retentionResult = await measureProductDiagnosisPerfStep(
      "retention_full_attach",
      perfContext,
      () => calculateAndAttachProductRetentionForDiagnosis({
        shop,
        jobId,
        admin,
        snapshot,
        diagnosis,
        windowDays,
        retentionPreview,
      }),
      { diagnosisId: diagnosis.id, windowDays },
      summarizeProductRetentionResult,
    );

    await recordJobLog({
      shop,
      jobId,
      event: "product_diagnosis.persisted",
      message: "Detailed product diagnosis was persisted and product signals were updated after OpenAI Batch completion.",
      data: {
        diagnosisId: diagnosis.id,
        productGid: snapshot.productGid,
        riskScore: diagnosisPayload.riskScore,
        confidence: diagnosisPayload.confidence,
        estimatedImpact: diagnosisPayload.metrics.estimatedImpact,
        issues: diagnosisPayload.issues.map((issue) => issue.issue),
        recommendations: diagnosisPayload.recommendations.map((action) => action.label),
        modelsUsed: ai.modelsUsed,
        aiUsage: ai.aiUsage,
        openAiBatchGroupId: batchGroupId,
        productRetention: retentionResult
          ? {
            status: retentionResult.status,
            retentionRunId: retentionResult.retentionRunId,
            hasEnoughData: retentionResult.payload?.summary?.hasEnoughData ?? false,
          }
          : null,
      },
    });

    const result = {
      status: "success",
      diagnosisId: diagnosis.id,
      riskScore: diagnosisPayload.riskScore,
      confidence: diagnosisPayload.confidence,
      estimatedImpact: diagnosisPayload.metrics.estimatedImpact,
      provider: ai.provider,
      model: ai.model,
      modelsUsed: ai.modelsUsed,
      aiUsage: ai.aiUsage,
      productRetention: retentionResult?.payload || null,
      openAiBatchGroupId: batchGroupId,
    };
    flushProductDiagnosisSummaryLog(perfContext, {
      status: "completed",
      durationMs: Date.now() - startedAt,
      skipped: false,
      diagnosisId: result.diagnosisId,
      riskScore: result.riskScore,
      confidence: result.confidence,
      provider: result.provider,
      model: result.model,
      openAiBatchGroupId: batchGroupId,
    });
    return result;
  } catch (error) {
    flushProductDiagnosisSummaryLog(perfContext, {
      status: "failed",
      durationMs: Date.now() - startedAt,
      openAiBatchGroupId: batchGroupId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }, "error");
    throw error;
  }
}

async function fetchShopifyDiagnosisData({ shop, jobId, admin, snapshot, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS, perfContext = null }) {
  const diagnosisPerfContext = perfContext || buildProductDiagnosisPerfContext({ shop, jobId, snapshot });
  const incrementalSource = getIncrementalSourceFetchContext({ snapshot, windowDays });
  const fetchStartedAt = new Date().toISOString();
  const product = await measureProductDiagnosisPerfStep("shopify_product_fetch", diagnosisPerfContext, () => fetchShopifyProduct({ admin, snapshot }).catch(async (error) => {
    await recordJobLog({
      shop,
      jobId,
      level: "warn",
      event: "product_diagnosis.shopify_product_failed",
      message: "Shopify product detail fetch failed; using the stored ProductPulse snapshot.",
      data: { error: serializeError(error), productGid: snapshot.productGid, handle: snapshot.handle },
    });
    return normalizeSnapshotProduct(snapshot);
  }), { windowDays }, (result) => ({
    productFound: Boolean(result?.id),
    variantCount: result?.variants?.nodes?.length || result?.variants?.length || 0,
    updatedAt: result?.updatedAt || null,
  }));

  let sales = [];
  let relationshipSales = [];
  let refunds = [];
  let returns = [];
  let sourceSalesEvents = [];
  let sourceRefundEvents = [];
  let sourceReturnEvents = [];
  let rawFetchedCounts = { salesEvents: 0, refundEvents: 0, returnEvents: 0 };
  let shopSourceCache = null;
  let shopSourceCacheUsed = false;
  let shopProductSalesCache = null;
  let shopSourceSalesAppendPersisted = null;
  let shopSourceCachePersisted = null;
  let sourceFetchMode = incrementalSource.shopifyCanReuse ? "incremental_fetch" : "full_window_fetch";
  let sourceFetchReason = incrementalSource.reason;
  let sourceSinceDate = incrementalSource.shopifyCanReuse ? incrementalSource.sinceDate : null;
  let sourcePreviousCompletedAt = incrementalSource.previousCompletedAt;
  let sourcePreviousWindowDays = incrementalSource.previousWindowDays;
  let orderAccessDenied = false;
  let salesFetchComplete = true;
  let shopSourceSalesFetchComplete = true;
  let refundFetchComplete = true;
  let returnFetchComplete = true;
  let salesExtraction = null;

  try {
    shopSourceCache = await measureProductDiagnosisPerfStep(
      "shopify_source_event_cache",
      diagnosisPerfContext,
      () => getShopSourceEventCacheForDiagnosis({ shop, windowDays, referenceAt: fetchStartedAt }),
      { windowDays },
      (result) => ({
        usable: Boolean(result?.usable),
        stale: Boolean(result?.stale),
        reason: result?.reason || null,
        salesEvents: result?.counts?.salesEvents || result?.events?.sales?.length || 0,
        refundEvents: result?.counts?.refundEvents || result?.events?.refunds?.length || 0,
        returnEvents: result?.counts?.returnEvents || result?.events?.returns?.length || 0,
      }),
    );
  } catch (error) {
    await recordJobLog({
      shop,
      jobId,
      level: "warn",
      event: "product_diagnosis.shop_source_event_cache_read_failed",
      message: "Shared Shopify source event cache read failed; diagnosis will fetch source events from Shopify.",
      data: { error: serializeError(error), productGid: snapshot.productGid },
    });
    shopSourceCache = { usable: false, reason: "shop_source_event_cache_read_failed", events: null };
  }

  if (shopSourceCache?.usable && shopSourceCache.events) {
    shopSourceCacheUsed = true;
    sourceFetchMode = "shop_shared_cache_hit";
    sourceFetchReason = shopSourceCache.reason;
    sourceSinceDate = null;
    sourcePreviousCompletedAt = shopSourceCache.fetchedThroughAt || null;
    sourcePreviousWindowDays = windowDays;
    sourceSalesEvents = shopSourceCache.events.sales;
    sourceRefundEvents = shopSourceCache.events.refunds;
    sourceReturnEvents = shopSourceCache.events.returns;
    relationshipSales = sourceSalesEvents;
  } else {
    const shouldUseShopCacheRefresh = Boolean(shopSourceCache?.stale && shopSourceCache.events);
    const sharedCacheModelsAvailable = hasShopSourceEventCacheModels();
    if (sharedCacheModelsAvailable) {
      try {
        shopProductSalesCache = await measureProductDiagnosisPerfStep(
          "shopify_product_sales_source_cache",
          diagnosisPerfContext,
          () => getShopProductSourceSalesCacheForDiagnosis({ shop, product, snapshot, windowDays }),
          { windowDays },
          (result) => ({
            usable: Boolean(result?.usable),
            reason: result?.reason || null,
            salesEvents: result?.events?.length || 0,
          }),
        );
      } catch (error) {
        await recordJobLog({
          shop,
          jobId,
          level: "warn",
          event: "product_diagnosis.shop_product_sales_cache_read_failed",
          message: "Shared product sales cache read failed; diagnosis will continue with Shopify sales extraction.",
          data: { error: serializeError(error), productGid: snapshot.productGid },
        });
        shopProductSalesCache = { usable: false, reason: "shop_product_sales_cache_read_failed", events: [] };
      }
    }
    sourceSinceDate = shouldUseShopCacheRefresh
      ? shopSourceCache.sinceDate
      : (sharedCacheModelsAvailable ? null : (incrementalSource.shopifyCanReuse ? incrementalSource.sinceDate : null));
    sourceFetchMode = shouldUseShopCacheRefresh
      ? "shop_shared_cache_incremental_refresh"
      : (sourceSinceDate ? "incremental_fetch" : "full_window_fetch");
    sourceFetchReason = shouldUseShopCacheRefresh ? shopSourceCache.reason : incrementalSource.reason;
    sourcePreviousCompletedAt = shouldUseShopCacheRefresh ? shopSourceCache.fetchedThroughAt : incrementalSource.previousCompletedAt;
    sourcePreviousWindowDays = shouldUseShopCacheRefresh ? windowDays : incrementalSource.previousWindowDays;

  try {
    const salesBundle = await measureProductDiagnosisPerfStep("shopify_sales_bundle", diagnosisPerfContext, () => fetchShopifySalesEventBundle({
      shop,
      jobId,
      admin,
      product,
      snapshot,
      windowDays,
      sinceDate: sourceSinceDate,
      includeAllProductCandidates: sharedCacheModelsAvailable,
    }), {
      windowDays,
      sinceDate: sourceSinceDate,
      incremental: Boolean(sourceSinceDate),
      shopSourceCacheRefresh: shouldUseShopCacheRefresh,
    }, (result) => ({
      salesEvents: result?.sales?.length || 0,
      relationshipSalesEvents: result?.relationshipSales?.length || 0,
      fetchComplete: result?.fetchComplete !== false,
      productSalesComplete: result?.extraction?.productSalesComplete !== false,
      shopSourceSalesComplete: result?.extraction?.shopSourceSalesComplete !== false,
      incompletenessReason: result?.extraction?.incompletenessReason || null,
    }));
    sales = salesBundle.sales;
    relationshipSales = salesBundle.relationshipSales;
    sourceSalesEvents = salesBundle.relationshipSales.length ? salesBundle.relationshipSales : salesBundle.sales;
    salesFetchComplete = salesBundle.fetchComplete !== false;
    shopSourceSalesFetchComplete = salesBundle.extraction?.shopSourceSalesComplete !== false;
    salesExtraction = salesBundle.extraction || null;
    if (!sharedCacheModelsAvailable && incrementalSource.shopifyCanReuse) {
      try {
        const relationshipBundle = await measureProductDiagnosisPerfStep("shopify_relationship_sales_full_bundle", diagnosisPerfContext, () => fetchShopifySalesEventBundle({
          shop,
          jobId,
          admin,
          product,
          snapshot,
          windowDays,
          sinceDate: null,
        }), { windowDays, sinceDate: null }, (result) => ({
          salesEvents: result?.sales?.length || 0,
          relationshipSalesEvents: result?.relationshipSales?.length || 0,
          fetchComplete: result?.fetchComplete !== false,
          productSalesComplete: result?.extraction?.productSalesComplete !== false,
          shopSourceSalesComplete: result?.extraction?.shopSourceSalesComplete !== false,
          incompletenessReason: result?.extraction?.incompletenessReason || null,
        }));
        relationshipSales = relationshipBundle.relationshipSales;
        sourceSalesEvents = relationshipBundle.relationshipSales.length ? relationshipBundle.relationshipSales : sourceSalesEvents;
      } catch (relationshipError) {
        await recordJobLog({
          shop,
          jobId,
          level: "warn",
          event: "product_diagnosis.relationship_sales_full_fetch_failed",
          message: "Full-window relationship sales extraction failed; product relationships will use incremental order events for this run.",
          data: { error: serializeError(relationshipError) },
        });
      }
    }
  } catch (error) {
    salesFetchComplete = false;
    const denied = isShopifyOrderAccessDenied(error);
    orderAccessDenied = orderAccessDenied || denied;
    await recordJobLog({
      shop,
      jobId,
      level: denied ? "warn" : "error",
      event: denied ? "product_diagnosis.shopify_order_access_denied" : "product_diagnosis.shopify_sales_failed",
      message: denied
        ? "Shopify denied Order object access while reading sales; diagnosis will use stored Catalog Scan metrics and connected review data where needed."
        : "Shopify sales extraction failed; diagnosis will continue with refunds, returns and review evidence where available.",
      data: { error: serializeError(error), recovery: denied ? "snapshot-and-reviews" : "partial-shopify-data" },
    });
  }

  try {
    refunds = await measureProductDiagnosisPerfStep(
      "shopify_refunds",
      diagnosisPerfContext,
      () => fetchShopifyRefundEvents({ shop, jobId, admin, product, snapshot, windowDays, sinceDate: sourceSinceDate, includeAllProducts: sharedCacheModelsAvailable }),
      {
        windowDays,
        sinceDate: sourceSinceDate,
        incremental: Boolean(sourceSinceDate),
        shopSourceCacheRefresh: shouldUseShopCacheRefresh,
      },
      (result) => ({ refundEvents: result?.length || 0 }),
    );
    sourceRefundEvents = refunds;
  } catch (error) {
    refundFetchComplete = false;
    const denied = isShopifyOrderAccessDenied(error);
    orderAccessDenied = orderAccessDenied || denied;
    await recordJobLog({
      shop,
      jobId,
      level: denied ? "warn" : "error",
      event: denied ? "product_diagnosis.shopify_order_access_denied" : "product_diagnosis.shopify_refunds_failed",
      message: denied
        ? "Shopify denied Order object access while reading refunds; refund evidence will fall back to stored Catalog Scan metrics."
        : "Shopify refund extraction failed; diagnosis will continue with other evidence.",
      data: { error: serializeError(error), recovery: denied ? "snapshot-and-reviews" : "partial-shopify-data" },
    });
  }

  try {
    returns = await measureProductDiagnosisPerfStep(
      "shopify_returns",
      diagnosisPerfContext,
      () => fetchShopifyReturnEvents({ shop, jobId, admin, product, snapshot, windowDays, sinceDate: sourceSinceDate, includeAllProducts: sharedCacheModelsAvailable }),
      {
        windowDays,
        sinceDate: sourceSinceDate,
        incremental: Boolean(sourceSinceDate),
        shopSourceCacheRefresh: shouldUseShopCacheRefresh,
      },
      (result) => ({ returnEvents: result?.length || 0 }),
    );
    sourceReturnEvents = returns;
  } catch (error) {
    returnFetchComplete = false;
    const denied = isShopifyOrderAccessDenied(error);
    orderAccessDenied = orderAccessDenied || denied;
    await recordJobLog({
      shop,
      jobId,
      level: denied ? "warn" : "error",
      event: denied ? "product_diagnosis.shopify_order_access_denied" : "product_diagnosis.shopify_returns_failed",
      message: denied
        ? "Shopify denied Order object access while reading returns; return evidence will fall back to stored Catalog Scan metrics."
        : "Shopify return extraction failed; diagnosis will continue with other evidence.",
      data: { error: serializeError(error), recovery: denied ? "snapshot-and-reviews" : "partial-shopify-data" },
    });
  }

    rawFetchedCounts = {
      salesEvents: sourceSalesEvents.length,
      refundEvents: sourceRefundEvents.length,
      returnEvents: sourceReturnEvents.length,
    };

    if (!shopSourceCacheUsed && shopProductSalesCache?.events?.length) {
      sourceSalesEvents = mergeSourceEventList({
        type: "sales",
        previous: shopProductSalesCache.events,
        current: sourceSalesEvents,
        windowDays,
      });
    }

    if (shouldUseShopCacheRefresh) {
      const mergedShopSourceEvents = mergeIncrementalSourceEvents({
        previous: shopSourceCache.events,
        current: { sales: sourceSalesEvents, refunds: sourceRefundEvents, returns: sourceReturnEvents },
        windowDays,
      });
      sourceSalesEvents = mergedShopSourceEvents.sales;
      sourceRefundEvents = mergedShopSourceEvents.refunds;
      sourceReturnEvents = mergedShopSourceEvents.returns;
    } else if (!sharedCacheModelsAvailable && incrementalSource.shopifyCanReuse) {
      const mergedProductSourceEvents = mergeIncrementalSourceEvents({
        previous: incrementalSource.previousSourceEvents,
        current: { sales: sourceSalesEvents, refunds: sourceRefundEvents, returns: sourceReturnEvents },
        windowDays,
      });
      sourceSalesEvents = mergedProductSourceEvents.sales;
      sourceRefundEvents = mergedProductSourceEvents.refunds;
      sourceReturnEvents = mergedProductSourceEvents.returns;
    }

    if (sharedCacheModelsAvailable && sourceSalesEvents.length && !orderAccessDenied) {
      try {
        shopSourceSalesAppendPersisted = await measureProductDiagnosisPerfStep(
          "shopify_source_event_sales_cache_append",
          diagnosisPerfContext,
          () => appendShopSourceEventCacheRows({
            shop,
            sourceType: "sales",
            events: sourceSalesEvents,
            windowDays,
          }),
          { windowDays, mode: sourceFetchMode },
          (result) => ({
            skipped: Boolean(result?.skipped),
            rows: result?.rows || 0,
            inserted: result?.inserted || 0,
            reason: result?.reason || null,
          }),
        );
      } catch (error) {
        await recordJobLog({
          shop,
          jobId,
          level: "warn",
          event: "product_diagnosis.shop_source_event_sales_cache_append_failed",
          message: "Shared Shopify sales cache append failed; diagnosis results are still valid for this run.",
          data: { error: serializeError(error), productGid: snapshot.productGid },
        });
      }
    }

    if (sharedCacheModelsAvailable && shopSourceSalesFetchComplete && refundFetchComplete && returnFetchComplete && !orderAccessDenied) {
      try {
        shopSourceCachePersisted = await measureProductDiagnosisPerfStep(
          "shopify_source_event_cache_write",
          diagnosisPerfContext,
          () => persistShopSourceEventCache({
            shop,
            windowDays,
            sourceEvents: { sales: sourceSalesEvents, refunds: sourceRefundEvents, returns: sourceReturnEvents },
            fetchedThroughAt: fetchStartedAt,
            sourceFetchComplete: { sales: shopSourceSalesFetchComplete, refunds: refundFetchComplete, returns: returnFetchComplete },
          }),
          { windowDays, mode: sourceFetchMode },
          (result) => ({
            skipped: Boolean(result?.skipped),
            rows: result?.rows || 0,
            reason: result?.reason || null,
            counts: result?.counts || null,
          }),
        );
      } catch (error) {
        await recordJobLog({
          shop,
          jobId,
          level: "warn",
          event: "product_diagnosis.shop_source_event_cache_write_failed",
          message: "Shared Shopify source event cache write failed; diagnosis results are still valid for this run.",
          data: { error: serializeError(error), productGid: snapshot.productGid },
        });
      }
    } else if (sharedCacheModelsAvailable) {
      shopSourceCachePersisted = {
        skipped: true,
        reason: !shopSourceSalesFetchComplete
          ? "shop_source_sales_scan_incomplete"
          : !refundFetchComplete
            ? "refund_source_fetch_incomplete"
            : !returnFetchComplete
              ? "return_source_fetch_incomplete"
              : orderAccessDenied
                ? "order_access_denied"
                : "source_fetch_incomplete",
      };
    }
  }

  const merged = await measureProductDiagnosisPerfStep(
    "shopify_merge_filter",
    diagnosisPerfContext,
    () => {
      const mergedSourceEvents = { sales: sourceSalesEvents, refunds: sourceRefundEvents, returns: sourceReturnEvents };
      const filteredSales = filterDiagnosisEventsForProduct(mergedSourceEvents.sales, product, snapshot);
      const filteredRefunds = filterDiagnosisEventsForProduct(mergedSourceEvents.refunds, product, snapshot);
      const filteredReturns = filterDiagnosisEventsForProduct(mergedSourceEvents.returns, product, snapshot);
      const backfilledSales = backfillMissingSalesFromOperationalEvents({
        product,
        snapshot,
        sales: filteredSales,
        returns: filteredReturns,
        refunds: filteredRefunds,
      });
      return {
        rawFetchedCounts,
        sales: backfilledSales,
        refunds: filteredRefunds,
        returns: filteredReturns,
        relationshipSales: selectDiagnosisRelationshipSalesForSummary({
          sourceSalesEvents: mergedSourceEvents.sales,
          relationshipSales,
          backfilledSales,
        }),
        sourceEventCounts: {
          salesEvents: mergedSourceEvents.sales.length,
          refundEvents: mergedSourceEvents.refunds.length,
          returnEvents: mergedSourceEvents.returns.length,
        },
      };
    },
    {
      mode: sourceFetchMode,
      incremental: Boolean(sourceSinceDate),
      shopSourceCacheUsed,
      previousSalesEvents: shopSourceCache?.events?.sales?.length || shopProductSalesCache?.events?.length || incrementalSource.previousSourceEvents?.sales?.length || 0,
      previousRefundEvents: shopSourceCache?.events?.refunds?.length || incrementalSource.previousSourceEvents?.refunds?.length || 0,
      previousReturnEvents: shopSourceCache?.events?.returns?.length || incrementalSource.previousSourceEvents?.returns?.length || 0,
    },
    (result) => ({
      rawFetchedCounts: result.rawFetchedCounts,
      salesEvents: result.sales.length,
      relationshipSalesEvents: result.relationshipSales.length,
      refundEvents: result.refunds.length,
      returnEvents: result.returns.length,
    }),
  );
  rawFetchedCounts = merged.rawFetchedCounts;
  sales = merged.sales;
  refunds = merged.refunds;
  returns = merged.returns;
  relationshipSales = merged.relationshipSales;

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.shopify_extracted",
    message: "Shopify product diagnosis data extraction finished.",
    data: {
      productGid: product.id,
      salesEvents: sales.length,
      relationshipSalesEvents: relationshipSales.length,
      refundEvents: refunds.length,
      returnEvents: returns.length,
      windowDays,
      orderAccessDenied,
      incrementalSource: {
        mode: sourceFetchMode,
        reason: sourceFetchReason,
        sinceDate: sourceSinceDate || (shopSourceCacheUsed ? null : getSinceDate(windowDays)),
        previousCompletedAt: sourcePreviousCompletedAt,
        previousWindowDays: sourcePreviousWindowDays,
        fetchedThroughAt: fetchStartedAt,
        rawFetchedCounts,
        mergedCounts: {
          salesEvents: sales.length,
          refundEvents: refunds.length,
          returnEvents: returns.length,
        },
        sourceEventCounts: merged.sourceEventCounts,
        salesExtraction,
        shopSourceCache: {
          used: shopSourceCacheUsed,
          reason: shopSourceCache?.reason || null,
          stale: Boolean(shopSourceCache?.stale),
          fetchedThroughAt: shopSourceCache?.fetchedThroughAt || null,
          counts: shopSourceCache?.counts || null,
          productSales: {
            used: Boolean(shopProductSalesCache?.usable),
            reason: shopProductSalesCache?.reason || null,
            salesEvents: shopProductSalesCache?.events?.length || 0,
          },
          salesAppend: shopSourceSalesAppendPersisted || null,
          persisted: shopSourceCachePersisted || null,
        },
        sourceFetchComplete: {
          sales: salesFetchComplete,
          refunds: refundFetchComplete,
          returns: returnFetchComplete,
        },
        fetchComplete: salesFetchComplete && refundFetchComplete && returnFetchComplete,
      },
    },
  });

  return {
    product,
    sales,
    relationshipSales,
    refunds,
    returns,
    orderAccessDenied,
    incrementalSource: {
      ...incrementalSource,
      mode: sourceFetchMode,
      reason: sourceFetchReason,
      sinceDate: sourceSinceDate || (shopSourceCacheUsed ? null : getSinceDate(windowDays)),
      previousCompletedAt: sourcePreviousCompletedAt,
      previousWindowDays: sourcePreviousWindowDays,
      fetchedThroughAt: fetchStartedAt,
      rawFetchedCounts,
      mergedCounts: {
        salesEvents: sales.length,
        refundEvents: refunds.length,
        returnEvents: returns.length,
      },
      sourceEventCounts: merged.sourceEventCounts,
      salesExtraction,
      shopSourceCache: {
        used: shopSourceCacheUsed,
        reason: shopSourceCache?.reason || null,
        stale: Boolean(shopSourceCache?.stale),
        fetchedThroughAt: shopSourceCache?.fetchedThroughAt || null,
        counts: shopSourceCache?.counts || null,
        productSales: {
          used: Boolean(shopProductSalesCache?.usable),
          reason: shopProductSalesCache?.reason || null,
          salesEvents: shopProductSalesCache?.events?.length || 0,
        },
        salesAppend: shopSourceSalesAppendPersisted || null,
        persisted: shopSourceCachePersisted || null,
      },
      sourceFetchComplete: {
        sales: salesFetchComplete,
        refunds: refundFetchComplete,
        returns: returnFetchComplete,
      },
      fetchComplete: salesFetchComplete && refundFetchComplete && returnFetchComplete,
    },
  };
}

async function fetchProductMomentumCatalogBaseline({ shop, currentProductGid }) {
  if (!shop) return null;
  const snapshots = await fetchProductMomentumCatalogBaselineRows(shop).catch(async () => (
    prisma.productRiskSnapshot.findMany({
      where: { shop },
      select: { productGid: true, metrics: true },
      orderBy: [{ updatedAt: "desc" }],
      take: 1000,
    })
  ));

  return buildProductMomentumCatalogBaseline(snapshots, currentProductGid);
}

async function fetchProductMomentumCatalogBaselineRows(shop) {
  const rows = await prisma.$queryRaw`
    SELECT
      "productGid",
      CASE
        WHEN jsonb_typeof("metrics"->'productMomentum'->'inputs'->'unitsLast30Days') = 'number'
          THEN ("metrics"->'productMomentum'->'inputs'->>'unitsLast30Days')::DOUBLE PRECISION
        WHEN jsonb_typeof("metrics"->'productMomentum'->'inputs'->'unitsLast30Days') = 'string'
          AND ("metrics"->'productMomentum'->'inputs'->>'unitsLast30Days') ~ '^-?[0-9]+(\\.[0-9]+)?$'
          THEN ("metrics"->'productMomentum'->'inputs'->>'unitsLast30Days')::DOUBLE PRECISION
        WHEN jsonb_typeof("metrics"->'soldUnits') = 'number'
          THEN ("metrics"->>'soldUnits')::DOUBLE PRECISION
        WHEN jsonb_typeof("metrics"->'soldUnits') = 'string'
          AND ("metrics"->>'soldUnits') ~ '^-?[0-9]+(\\.[0-9]+)?$'
          THEN ("metrics"->>'soldUnits')::DOUBLE PRECISION
        ELSE 0
      END AS "unitsLast30",
      CASE
        WHEN jsonb_typeof("metrics"->'productMomentum'->'inputs'->'unitsPrevious90Days') = 'number'
          THEN ("metrics"->'productMomentum'->'inputs'->>'unitsPrevious90Days')::DOUBLE PRECISION
        WHEN jsonb_typeof("metrics"->'productMomentum'->'inputs'->'unitsPrevious90Days') = 'string'
          AND ("metrics"->'productMomentum'->'inputs'->>'unitsPrevious90Days') ~ '^-?[0-9]+(\\.[0-9]+)?$'
          THEN ("metrics"->'productMomentum'->'inputs'->>'unitsPrevious90Days')::DOUBLE PRECISION
        ELSE 0
      END AS "unitsPrevious90",
      CASE
        WHEN jsonb_typeof("metrics"->'productMomentum'->'inputs'->'revenueLast30Days') = 'number'
          THEN ("metrics"->'productMomentum'->'inputs'->>'revenueLast30Days')::DOUBLE PRECISION
        WHEN jsonb_typeof("metrics"->'productMomentum'->'inputs'->'revenueLast30Days') = 'string'
          AND ("metrics"->'productMomentum'->'inputs'->>'revenueLast30Days') ~ '^-?[0-9]+(\\.[0-9]+)?$'
          THEN ("metrics"->'productMomentum'->'inputs'->>'revenueLast30Days')::DOUBLE PRECISION
        WHEN jsonb_typeof("metrics"->'salesAmount') = 'number'
          THEN ("metrics"->>'salesAmount')::DOUBLE PRECISION
        WHEN jsonb_typeof("metrics"->'salesAmount') = 'string'
          AND ("metrics"->>'salesAmount') ~ '^-?[0-9]+(\\.[0-9]+)?$'
          THEN ("metrics"->>'salesAmount')::DOUBLE PRECISION
        ELSE 0
      END AS "revenueLast30",
      CASE
        WHEN jsonb_typeof("metrics"->'productMomentum'->'inputs'->'revenuePrevious90Days') = 'number'
          THEN ("metrics"->'productMomentum'->'inputs'->>'revenuePrevious90Days')::DOUBLE PRECISION
        WHEN jsonb_typeof("metrics"->'productMomentum'->'inputs'->'revenuePrevious90Days') = 'string'
          AND ("metrics"->'productMomentum'->'inputs'->>'revenuePrevious90Days') ~ '^-?[0-9]+(\\.[0-9]+)?$'
          THEN ("metrics"->'productMomentum'->'inputs'->>'revenuePrevious90Days')::DOUBLE PRECISION
        ELSE 0
      END AS "revenuePrevious90",
      COALESCE("metrics"->>'productType', '') AS "productType",
      COALESCE("metrics"->>'vendor', '') AS "vendor"
    FROM "ProductRiskSnapshot"
    WHERE "shop" = ${shop}
    ORDER BY "updatedAt" DESC
    LIMIT 1000
  `;
  return rows.map((row) => ({
    productGid: row.productGid,
    metrics: {
      productType: row.productType || "",
      vendor: row.vendor || "",
      productMomentum: {
        inputs: {
          unitsLast30Days: numberOrNull(row.unitsLast30),
          unitsPrevious90Days: numberOrNull(row.unitsPrevious90),
          revenueLast30Days: numberOrNull(row.revenueLast30),
          revenuePrevious90Days: numberOrNull(row.revenuePrevious90),
        },
      },
      soldUnits: numberOrNull(row.unitsLast30),
      salesAmount: numberOrNull(row.revenueLast30),
    },
  }));
}

async function fetchProductTaxonomyCategorySuggestions({ admin, product = {} } = {}) {
  if (!admin?.graphql || normalizeProductCategory(product.category).id) return [];
  const searches = buildProductTaxonomySearches(product);
  const seen = new Map();

  for (const search of searches) {
    try {
      const data = await shopifyGraphql(
        admin,
        `#graphql
        query ProductPulseTaxonomyCategorySuggestions($search: String!) {
          taxonomy {
            categories(first: 12, search: $search) {
              nodes {
                id
                name
                fullName
                isLeaf
                isArchived
                level
              }
            }
          }
        }`,
        { search },
      );
      (data?.taxonomy?.categories?.nodes || []).forEach((category) => {
        const normalized = normalizeProductCategory(category);
        if (!normalized.id || normalized.isArchived) return;
        if (!seen.has(normalized.id)) seen.set(normalized.id, { ...normalized, source: "shopify_taxonomy_search", search });
      });
    } catch {
      return [];
    }
  }

  return rankProductTaxonomyCategories([...seen.values()], product).slice(0, 8);
}

async function fetchProductRelationshipCollectionSuggestions({ admin, product = {}, relationshipSummary = {} } = {}) {
  if (!admin?.graphql || !product?.id || hasProductCollectionMembership(product)) return [];

  const relationshipItems = getProductRelationshipCandidateItems(relationshipSummary)
    .map(normalizeRelationshipCollectionCandidate)
    .filter((item) => item.productGid && item.productGid !== product.id)
    .sort((first, second) => second.score - first.score)
    .slice(0, 20);
  if (!relationshipItems.length) return [];

  const relationshipByProductGid = new Map();
  relationshipItems.forEach((item) => {
    const current = relationshipByProductGid.get(item.productGid);
    if (!current || item.score > current.score) relationshipByProductGid.set(item.productGid, item);
  });

  try {
    const data = await shopifyGraphql(
      admin,
      `#graphql
      query ProductPulseRelatedProductCollections($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            handle
            collections(first: 20) {
              nodes {
                id
                title
                handle
                ruleSet {
                  appliedDisjunctively
                }
              }
            }
          }
        }
      }`,
      { ids: [...relationshipByProductGid.keys()] },
    );

    return rankRelationshipCollectionSuggestions({
      product,
      relatedProducts: (data?.nodes || []).filter(Boolean),
      relationshipByProductGid,
    });
  } catch {
    return [];
  }
}

function attachRelationshipCollectionSuggestionsToDeterministic(deterministic = {}, suggestions = []) {
  return {
    ...deterministic,
    metrics: {
      ...(deterministic.metrics || {}),
      relationshipCollectionSuggestions: Array.isArray(suggestions) ? suggestions : [],
    },
  };
}

function normalizeRelationshipCollectionCandidate(item = {}) {
  const productGid = String(item.related_product_id || item.relatedProductId || "").trim();
  const title = String(item.related_product_title || item.relatedProductTitle || item.title || "").replace(/\s+/g, " ").trim();
  const relationshipType = String(item.relationship_type || item.relationshipType || "").trim();
  const relationshipDirection = String(item.relationship_direction || item.relationshipDirection || item.direction || "").trim();
  const timeWindow = String(item.time_window || item.timeWindow || "").trim();
  const sampleSize = Number(item.sample_size || item.sampleSize || item.co_order_count || item.co_customer_count || item.order_count || item.customer_count || 0);
  const confidence = normalizePercentLike(item.confidence?.score ?? item.confidence_score ?? item.confidence ?? 0);
  const lift = Number(item.lift ?? item.lift_after ?? item.lift_before ?? 0);
  const relationshipStrength = String(item.relationship_strength || item.relationshipStrength || "").trim();
  const score = Math.round(
    Math.min(30, sampleSize * 5)
      + Math.min(25, confidence / 4)
      + Math.min(20, Math.max(0, lift - 1) * 8)
      + (relationshipType === "same_order" || relationshipDirection === "together" ? 12 : 8)
      + (relationshipStrength.includes("very") ? 8 : relationshipStrength ? 4 : 0),
  );

  return {
    productGid,
    title,
    handle: String(item.related_product_handle || item.relatedProductHandle || item.handle || "").trim(),
    relationshipType,
    relationshipDirection,
    timeWindow,
    sampleSize,
    confidence,
    lift: Number.isFinite(lift) ? lift : 0,
    relationshipStrength,
    score,
  };
}

function rankRelationshipCollectionSuggestions({ product = {}, relatedProducts = [], relationshipByProductGid = new Map() } = {}) {
  const currentCollectionKeys = new Set(getProductCollectionRecords(product).flatMap((collection) => [
    collection.id,
    normalizeText(collection.title),
    normalizeText(collection.handle),
  ]).filter(Boolean));
  const byCollectionId = new Map();

  relatedProducts.forEach((relatedProduct) => {
    const relationship = relationshipByProductGid.get(relatedProduct.id);
    if (!relationship) return;

    getProductCollectionRecords(relatedProduct).forEach((collection) => {
      if (!collection.id || !collection.title) return;
      if (collection.isRuleBased) return;
      if (currentCollectionKeys.has(collection.id) || currentCollectionKeys.has(normalizeText(collection.title)) || currentCollectionKeys.has(normalizeText(collection.handle))) return;

      const current = byCollectionId.get(collection.id) || {
        collectionId: collection.id,
        collectionName: collection.title,
        collectionHandle: collection.handle,
        score: 0,
        relatedProducts: [],
        evidence: [],
      };
      const sourceScore = relationship.score + (current.relatedProducts.length ? 6 : 0);
      current.score += sourceScore;
      current.relatedProducts.push({
        productGid: relatedProduct.id,
        title: relatedProduct.title || relationship.title,
        handle: relatedProduct.handle || relationship.handle,
        relationshipType: relationship.relationshipType,
        relationshipDirection: relationship.relationshipDirection,
        timeWindow: relationship.timeWindow,
        sampleSize: relationship.sampleSize,
        confidence: relationship.confidence,
        lift: relationship.lift,
      });
      current.evidence.push(formatRelationshipCollectionEvidence({ collection, relationship, relatedProduct }));
      byCollectionId.set(collection.id, current);
    });
  });

  return [...byCollectionId.values()]
    .map((suggestion) => ({
      ...suggestion,
      score: Math.round(suggestion.score),
      relatedProducts: suggestion.relatedProducts
        .sort((first, second) => Number(second.sampleSize || 0) - Number(first.sampleSize || 0))
        .slice(0, 5),
      evidence: uniqueBy(suggestion.evidence, (item) => normalizeText(item)).slice(0, 4),
      source: "product_relationship_intelligence",
    }))
    .filter((suggestion) => suggestion.score >= 35 && suggestion.relatedProducts.length)
    .sort((first, second) => second.score - first.score || second.relatedProducts.length - first.relatedProducts.length || first.collectionName.localeCompare(second.collectionName))
    .slice(0, 3);
}

function formatRelationshipCollectionEvidence({ collection = {}, relationship = {}, relatedProduct = {} } = {}) {
  const relation = relationship.relationshipType === "same_order" || relationship.relationshipDirection === "together"
    ? "bought together"
    : relationship.relationshipDirection === "before"
      ? "bought before this product"
      : relationship.relationshipDirection === "after"
        ? "bought after this product"
        : "related";
  const liftText = relationship.lift ? `, ${roundRate(relationship.lift, 1)}x lift` : "";
  const sampleText = relationship.sampleSize ? ` across ${relationship.sampleSize} matched order${relationship.sampleSize === 1 ? "" : "s"}` : "";
  return `${relatedProduct.title || relationship.title || "Related product"} is ${relation}${liftText}${sampleText} and belongs to ${collection.title}.`;
}

function buildProductTaxonomySearches(product = {}) {
  const productText = [
    product.title,
    product.productType,
    ...(Array.isArray(product.collections) ? product.collections : []),
    ...(Array.isArray(product.tags) ? product.tags : []),
  ].filter(Boolean).join(" ");
  const categoryTerms = [...detectProductCategoryGroups(productText)].flatMap(getTaxonomySearchTermsFromCategory);
  return uniqueBy([
    product.productType,
    ...(Array.isArray(product.collections) ? product.collections : []),
    product.title,
    ...categoryTerms,
  ].map((value) => String(value || "").replace(/\s+/g, " ").trim()).filter((value) => value.length >= 3), normalizeText)
    .slice(0, 6);
}

function getTaxonomySearchTermsFromCategory(category = "") {
  if (category === "apparel") return ["apparel", "clothing"];
  if (category === "toy") return ["toys", "games", "figures"];
  if (category === "art") return ["art prints", "posters", "wall decor"];
  if (category === "electronics") return ["electronics", "electronic accessories"];
  if (category === "beauty") return ["beauty", "personal care"];
  if (category === "home") return ["home decor", "kitchen", "home garden"];
  if (category === "food") return ["food", "beverages"];
  return [];
}

function rankProductTaxonomyCategories(categories = [], product = {}) {
  const productText = [
    product.title,
    product.description,
    product.productType,
    ...(Array.isArray(product.collections) ? product.collections : []),
    ...(Array.isArray(product.tags) ? product.tags : []),
  ].filter(Boolean).join(" ");
  const productIdentityText = [
    product.title,
    product.productType,
    ...(Array.isArray(product.collections) ? product.collections : []),
    ...(Array.isArray(product.tags) ? product.tags : []),
  ].filter(Boolean).join(" ");
  const productTokens = new Set(meaningfulTokens(productText));
  const productGroups = detectProductCategoryGroups(productText);
  const genericTokens = new Set([
    "apparel",
    "appliance",
    "appliances",
    "accessories",
    "clothing",
    "decor",
    "dining",
    "garden",
    "holder",
    "holders",
    "home",
    "kitchen",
    "kitchens",
    "organizer",
    "organizers",
    "product",
    "products",
    "rack",
    "racks",
    "supplies",
    "tool",
    "tools",
    "utensil",
    "utensils",
    "wall",
    "walls",
  ]);
  const productIdentityTokens = new Set(meaningfulTokens(productIdentityText));
  const productSpecificTokens = expandTaxonomyTokenSet([...productIdentityTokens].filter((token) => !genericTokens.has(token)));
  return categories
    .map((category) => {
      const label = `${category.fullName || ""} ${category.name || ""}`;
      const categoryTokens = meaningfulTokens(label);
      const sharedTokens = categoryTokens.filter((token) => productTokens.has(token)).length;
      const specificSharedTokens = new Set(categoryTokens.filter((token) => productSpecificTokens.has(token))).size;
      const categoryGroups = detectProductCategoryGroups(label);
      const groupOverlap = [...categoryGroups].filter((group) => productGroups.has(group)).length;
      const petMismatchPenalty = /\b(pet|pets|dog|dogs|cat|cats|animal|animals)\b/.test(normalizeText(label))
        && !/\b(pet|pets|dog|dogs|cat|cats|animal|animals)\b/.test(normalizeText(productText))
        ? 24
        : 0;
      const shoeMismatchPenalty = /\b(shoe|shoes|sneaker|sneakers|boot|boots)\b/.test(normalizeText(label))
        && !/\b(shoe|shoes|sneaker|sneakers|boot|boots)\b/.test(normalizeText(productText))
        ? 18
        : 0;
      const taxonomyMismatchPenalty = getProductTaxonomyMismatchPenalty(label, productIdentityText);
      const score = (category.isLeaf ? 8 : 0)
        + Math.min(18, sharedTokens * 3)
        + Math.min(12, specificSharedTokens * 6)
        + (groupOverlap * 8)
        + Math.min(8, Number(category.level || 0))
        - petMismatchPenalty
        - shoeMismatchPenalty
        - taxonomyMismatchPenalty;
      return { ...category, score, specificSharedTokens, taxonomyMismatchPenalty };
    })
    .filter((category) => category.specificSharedTokens > 0 && category.taxonomyMismatchPenalty < 30)
    .sort((first, second) => second.score - first.score || Number(second.isLeaf) - Number(first.isLeaf) || second.level - first.level || first.fullName.localeCompare(second.fullName));
}

function getProductTaxonomyMismatchPenalty(categoryLabel = "", productIdentityText = "") {
  const label = normalizeText(categoryLabel);
  const identity = normalizeText(productIdentityText);
  const lacksIdentityTerm = (pattern) => !pattern.test(identity);
  if (/\b(furniture|cabinet|cabinets|hutch|hutches)\b/.test(label) && lacksIdentityTerm(/\b(furniture|cabinet|cabinets|hutch|hutches)\b/)) {
    return 40;
  }
  if (/\b(pool|spa|ladder|ladders|ramp|ramps)\b/.test(label) && lacksIdentityTerm(/\b(pool|spa|ladder|ladders|ramp|ramps)\b/)) {
    return 40;
  }
  if (/\b(office supplies|post cards|postcards|paper products)\b/.test(label) && lacksIdentityTerm(/\b(post card|post cards|postcard|postcards|office|paper)\b/)) {
    return 36;
  }
  if (/\b(beds|bed frames|four posters)\b/.test(label) && lacksIdentityTerm(/\b(bed|beds|frame|frames|poster bed|four poster)\b/)) {
    return 36;
  }
  if (/\b(wallpaper)\b/.test(label) && lacksIdentityTerm(/\b(wallpaper)\b/)) {
    return 30;
  }
  return 0;
}

function expandTaxonomyTokenSet(tokens = []) {
  const expanded = new Set();
  (Array.isArray(tokens) ? tokens : []).forEach((token) => {
    const normalized = String(token || "").trim();
    if (!normalized) return;
    expanded.add(normalized);
    if (normalized.endsWith("s") && normalized.length > 3) expanded.add(normalized.slice(0, -1));
    else if (normalized.length > 2) expanded.add(`${normalized}s`);
  });
  return expanded;
}

export function buildProductMomentumCatalogBaseline(snapshots = [], currentProductGid = "") {
  const classificationOptions = buildCatalogClassificationOptions(snapshots);
  const rows = (Array.isArray(snapshots) ? snapshots : [])
    .map((snapshot) => {
      const metrics = snapshot?.metrics || {};
      const momentum = metrics.productMomentum || {};
      const inputs = momentum.inputs || {};
      return {
        productGid: snapshot?.productGid || "",
        unitsLast30: Number(inputs.unitsLast30Days ?? metrics.soldUnits ?? 0),
        unitsPrevious90: Number(inputs.unitsPrevious90Days ?? 0),
        revenueLast30: Number(inputs.revenueLast30Days ?? metrics.salesAmount ?? 0),
        revenuePrevious90: Number(inputs.revenuePrevious90Days ?? 0),
      };
    })
    .filter((row) => Number.isFinite(row.unitsLast30) || Number.isFinite(row.revenueLast30));

  const comparableRows = rows.filter((row) => row.productGid !== currentProductGid);
  const distributionRows = comparableRows.length >= 3 ? comparableRows : rows;
  const unitsLast30Distribution = distributionRows.map((row) => Math.max(0, Number(row.unitsLast30 || 0)));
  const revenueLast30Distribution = distributionRows.map((row) => Math.max(0, Number(row.revenueLast30 || 0)));
  const storeUnitsLast30 = rows.reduce((total, row) => total + Math.max(0, Number(row.unitsLast30 || 0)), 0);
  const storeUnitsPrevious90 = rows.reduce((total, row) => total + Math.max(0, Number(row.unitsPrevious90 || 0)), 0);
  const storeRevenueLast30 = rows.reduce((total, row) => total + Math.max(0, Number(row.revenueLast30 || 0)), 0);
  const storeRevenuePrevious90 = rows.reduce((total, row) => total + Math.max(0, Number(row.revenuePrevious90 || 0)), 0);

  return {
    productCount: rows.length,
    comparableProductCount: distributionRows.length,
    unitsLast30Distribution,
    revenueLast30Distribution,
    medianUnitsLast30: median(unitsLast30Distribution),
    medianRevenueLast30: median(revenueLast30Distribution),
    storeUnitsLast30,
    storeUnitsPrevious90,
    storeRevenueLast30,
    storeRevenuePrevious90,
    productTypes: classificationOptions.productTypes,
    vendors: classificationOptions.vendors,
    hasCatalogBaseline: distributionRows.length >= 3,
  };
}

function buildCatalogClassificationOptions(snapshots = []) {
  const productTypes = new Map();
  const vendors = new Map();
  const addValue = (map, value) => {
    const label = String(value || "").replace(/\s+/g, " ").trim();
    const key = normalizeText(label);
    if (!key) return;
    const current = map.get(key) || { label, count: 0 };
    current.count += 1;
    map.set(key, current);
  };

  (Array.isArray(snapshots) ? snapshots : []).forEach((snapshot) => {
    const metrics = snapshot?.metrics || {};
    addValue(productTypes, metrics.productType);
    addValue(vendors, metrics.vendor);
  });

  const sortOptions = (map) => Array.from(map.values())
    .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label))
    .map((item) => item.label)
    .slice(0, 50);

  return {
    productTypes: sortOptions(productTypes),
    vendors: sortOptions(vendors),
  };
}

async function fetchShopifyProduct({ admin, snapshot }) {
  if (!admin?.graphql) return normalizeSnapshotProduct(snapshot);

  if (snapshot.productGid) {
    const data = await shopifyGraphql(
      admin,
      `#graphql
      query ProductPulseDiagnosisProduct($id: ID!) {
        product: node(id: $id) {
          ... on Product {
            id
            legacyResourceId
            title
            handle
            createdAt
            updatedAt
            description
            descriptionHtml
            vendor
            productType
            status
            category {
              id
              name
              fullName
              isLeaf
              isArchived
              level
            }
            seo {
              title
              description
            }
            templateSuffix
            tags
            options {
              name
              values
            }
            variants(first: 100) {
              nodes {
                id
                legacyResourceId
                title
                sku
                price
                compareAtPrice
                inventoryQuantity
                inventoryPolicy
                inventoryItem {
                  id
                  tracked
                }
                selectedOptions {
                  name
                  value
                }
              }
            }
            collections(first: 20) {
              nodes {
                id
                title
                handle
              }
            }
            metafields(first: 20) {
              nodes {
                namespace
                key
                type
                value
              }
            }
            media(first: 20) {
              nodes {
                id
                alt
                mediaContentType
                status
                preview {
                  image {
                    url
                    altText
                    width
                    height
                  }
                }
                ... on MediaImage {
                  image {
                    url
                    altText
                    width
                    height
                  }
                }
              }
            }
          }
        }
      }`,
      { id: snapshot.productGid },
    );
    if (data?.product?.id) return normalizeShopifyProduct(data.product, snapshot);
  }

  const data = await shopifyGraphql(
    admin,
    `#graphql
    query ProductPulseDiagnosisProductByHandle($query: String!) {
      products(first: 1, query: $query) {
        nodes {
          id
          legacyResourceId
          title
          handle
          createdAt
          updatedAt
          description
          descriptionHtml
          vendor
          productType
          status
          category {
            id
            name
            fullName
            isLeaf
            isArchived
            level
          }
          seo {
            title
            description
          }
          templateSuffix
          tags
          options {
            name
            values
          }
          variants(first: 100) {
            nodes {
              id
              legacyResourceId
              title
              sku
              price
              compareAtPrice
              inventoryQuantity
              inventoryPolicy
              inventoryItem {
                id
                tracked
              }
              selectedOptions {
                name
                value
              }
            }
          }
          collections(first: 20) {
            nodes {
              id
              title
              handle
            }
          }
          metafields(first: 20) {
            nodes {
              namespace
              key
              type
              value
            }
          }
          media(first: 20) {
            nodes {
              id
              alt
              mediaContentType
              status
              preview {
                image {
                  url
                  altText
                  width
                  height
                }
              }
              ... on MediaImage {
                image {
                  url
                  altText
                  width
                  height
                }
              }
            }
          }
        }
      }
    }`,
    { query: `handle:${escapeShopifyQueryValue(snapshot.handle)}` },
  );

  return normalizeShopifyProduct(data?.products?.nodes?.[0], snapshot);
}

async function fetchShopifySalesEventBundle({ shop = "", jobId = null, admin, product, snapshot, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS, sinceDate = null, includeAllProductCandidates = false }) {
  if (!admin?.graphql) return { sales: [], relationshipSales: [] };
  const sales = [];
  const relationshipSales = [];
  const querySinceDate = normalizeShopifySinceDate(sinceDate, windowDays);
  const stats = buildSalesExtractionStats({ product, querySinceDate, includeAllProductCandidates });

  const targetedBundle = await fetchShopifyTargetedSalesEvents({
    admin,
    product,
    snapshot,
    querySinceDate,
    stats,
  });
  mergeSalesEventList(sales, targetedBundle.sales);
  mergeSalesEventList(relationshipSales, targetedBundle.relationshipSales);

  let cursor = null;
  for (let page = 0; page < MAX_ORDER_PAGES; page += 1) {
    const data = await shopifyGraphql(
      admin,
      buildDiagnosisSalesQuery(),
      {
        after: cursor,
        query: `processed_at:>=${querySinceDate}`,
        ordersFirst: DIAGNOSIS_ORDERS_PAGE_SIZE,
        lineItemsFirst: DIAGNOSIS_ORDER_LINE_ITEMS_PAGE_SIZE,
      },
    );
    const orders = data?.orders?.nodes || [];
    stats.global.pages += 1;
    stats.global.scannedOrders += orders.length;
    stats.global.hasNextPage = Boolean(data?.orders?.pageInfo?.hasNextPage);

    orders.forEach((order) => {
      const geography = null;
      const orderDate = toIso(getShopifyOrderDate(order));
      const customerKey = order.customer?.id || null;
      const orderLineItems = getNodes(order.lineItems);
      const basketLineItems = normalizeDiagnosisBasketLineItems(orderLineItems);
      const basketFingerprint = stableSignature(basketLineItems);
      stats.global.scannedLineItems += orderLineItems.length;
      orderLineItems.forEach((lineItem) => {
        const event = normalizeDiagnosisOrderLineItemSaleEvent({
          lineItem,
          order,
          product,
          snapshot,
          orderDate,
          customerKey,
          basketLineItems,
          basketFingerprint,
          geography,
        });
        if (!event.productId && !includeAllProductCandidates) return;
        if (event.productId || event.variantId || event.sku || event.title) {
          mergeSalesEventList(relationshipSales, [event]);
          stats.global.relationshipLineItems += 1;
        }
        if (lineItemMatchesProduct(lineItem, product, snapshot)) {
          mergeSalesEventList(sales, [event]);
          stats.global.matchedLineItems += 1;
        } else {
          captureSalesUnmatchedSample(stats, "global", lineItem);
        }
      });
    });

    if (!data?.orders?.pageInfo?.hasNextPage) break;
    if (page + 1 >= MAX_ORDER_PAGES) stats.global.hitPageLimit = true;
    const nextCursor = data.orders.pageInfo.endCursor || null;
    if (!nextCursor || nextCursor === cursor) {
      stats.global.paginationStalled = true;
      break;
    }
    cursor = nextCursor;
  }

  stats.finalSalesEvents = sales.length;
  stats.finalRelationshipSalesEvents = relationshipSales.length;
  const completeness = getSalesExtractionCompleteness(stats);
  const extraction = {
    ...stats,
    ...completeness,
  };
  await Promise.resolve(recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.shopify_sales_extracted",
    message: "Shopify sales line items were extracted for product diagnosis.",
    data: {
      productGid: snapshot.productGid,
      windowDays,
      sinceDate: querySinceDate,
      ...extraction,
    },
  })).catch(() => {});

  return {
    sales,
    relationshipSales,
    fetchComplete: completeness.productSalesComplete,
    extraction,
  };
}

async function fetchShopifyTargetedSalesEvents({ admin, product, snapshot, querySinceDate, stats }) {
  const skus = getProductVariantSkusForOrderSearch(product);
  if (!skus.length) {
    stats.targeted.skipped = true;
    stats.targeted.skipReason = "no_variant_skus";
    return { sales: [], relationshipSales: [] };
  }

  const sales = [];
  const relationshipSales = [];
  for (const sku of skus) {
    const query = buildDiagnosisSalesOrderQuery({ sinceDate: querySinceDate, sku });
    const skuStats = {
      sku,
      pages: 0,
      scannedOrders: 0,
      scannedLineItems: 0,
      matchedLineItems: 0,
      relationshipLineItems: 0,
      ordersWithMoreLineItems: 0,
      possibleLineItemMisses: 0,
      hasNextPage: false,
      hitPageLimit: false,
      paginationStalled: false,
    };
    stats.targeted.queries.push({ sku, query });
    let cursor = null;
    let shouldContinue = true;

    while (shouldContinue) {
      const data = await shopifyGraphql(
        admin,
        buildDiagnosisSalesQuery(),
        {
          after: cursor,
          query,
          ordersFirst: DIAGNOSIS_TARGETED_ORDERS_PAGE_SIZE,
          lineItemsFirst: DIAGNOSIS_TARGETED_ORDER_LINE_ITEMS_PAGE_SIZE,
        },
      );
      const orders = data?.orders?.nodes || [];
      skuStats.pages += 1;
      skuStats.scannedOrders += orders.length;
      skuStats.hasNextPage = Boolean(data?.orders?.pageInfo?.hasNextPage);

      orders.forEach((order) => {
        const geography = null;
        const orderDate = toIso(getShopifyOrderDate(order));
        const customerKey = order.customer?.id || null;
        const orderLineItems = getNodes(order.lineItems);
        const basketLineItems = normalizeDiagnosisBasketLineItems(orderLineItems);
        const basketFingerprint = stableSignature(basketLineItems);
        const hasMoreLineItems = Boolean(order.lineItems?.pageInfo?.hasNextPage);
        let matchedOrderLine = false;
        skuStats.scannedLineItems += orderLineItems.length;
        if (hasMoreLineItems) skuStats.ordersWithMoreLineItems += 1;
        orderLineItems.forEach((lineItem) => {
          const event = normalizeDiagnosisOrderLineItemSaleEvent({
            lineItem,
            order,
            product,
            snapshot,
            orderDate,
            customerKey,
            basketLineItems,
            basketFingerprint,
            geography,
          });
          if (event.productId || event.variantId || event.sku || event.title) {
            mergeSalesEventList(relationshipSales, [event]);
            skuStats.relationshipLineItems += 1;
          }
          if (lineItemMatchesProduct(lineItem, product, snapshot)) {
            matchedOrderLine = true;
            mergeSalesEventList(sales, [event]);
            skuStats.matchedLineItems += 1;
          } else {
            captureSalesUnmatchedSample(stats, "targeted", lineItem, sku);
          }
        });
        if (hasMoreLineItems && !matchedOrderLine) {
          skuStats.possibleLineItemMisses += 1;
          captureSalesUnmatchedOrderSample(stats, order, sku, orderLineItems.length);
        }
      });

      if (!data?.orders?.pageInfo?.hasNextPage) {
        shouldContinue = false;
        continue;
      }
      if (DIAGNOSIS_TARGETED_ORDER_MAX_PAGES > 0 && skuStats.pages >= DIAGNOSIS_TARGETED_ORDER_MAX_PAGES) {
        skuStats.hitPageLimit = true;
        shouldContinue = false;
        continue;
      }
      const nextCursor = data.orders.pageInfo.endCursor || null;
      if (!nextCursor || nextCursor === cursor) {
        skuStats.paginationStalled = true;
        shouldContinue = false;
        continue;
      }
      cursor = nextCursor;
    }

    stats.targeted.pages += skuStats.pages;
    stats.targeted.scannedOrders += skuStats.scannedOrders;
    stats.targeted.scannedLineItems += skuStats.scannedLineItems;
    stats.targeted.matchedLineItems += skuStats.matchedLineItems;
    stats.targeted.relationshipLineItems += skuStats.relationshipLineItems;
    stats.targeted.ordersWithMoreLineItems += skuStats.ordersWithMoreLineItems;
    stats.targeted.possibleLineItemMisses += skuStats.possibleLineItemMisses;
    stats.targeted.hasNextPage = stats.targeted.hasNextPage || skuStats.hasNextPage;
    stats.targeted.hitPageLimit = stats.targeted.hitPageLimit || skuStats.hitPageLimit;
    stats.targeted.paginationStalled = stats.targeted.paginationStalled || skuStats.paginationStalled;
    stats.targeted.perSku.push(skuStats);
  }

  return { sales, relationshipSales };
}

function buildDiagnosisSalesOrderQuery({ sinceDate, sku = "" } = {}) {
  const parts = [`processed_at:>=${sinceDate}`];
  const normalizedSku = String(sku || "").trim();
  if (normalizedSku) parts.push(`sku:"${escapeShopifyQueryValue(normalizedSku)}"`);
  return parts.join(" ");
}

function getProductVariantSkusForOrderSearch(product = {}) {
  return Array.from(new Set((product.variants || [])
    .map((variant) => String(variant?.sku || "").trim())
    .filter(Boolean)))
    .slice(0, DIAGNOSIS_TARGETED_ORDER_MAX_SKUS);
}

function mergeSalesEventList(target, events = []) {
  if (!Array.isArray(target)) return;
  const seen = new Set(target.map(getSaleLineIdentity).filter(Boolean));
  events.forEach((event) => {
    const key = getSaleLineIdentity(event);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    target.push(event);
  });
}

function buildSalesExtractionStats({ product = {}, querySinceDate, includeAllProductCandidates = false } = {}) {
  return {
    querySinceDate,
    includeAllProductCandidates,
    productVariantCount: product.variants?.length || 0,
    productSkuCount: getProductVariantSkusForOrderSearch(product).length,
    targeted: {
      skipped: false,
      skipReason: null,
      pages: 0,
      scannedOrders: 0,
      scannedLineItems: 0,
      matchedLineItems: 0,
      relationshipLineItems: 0,
      hasNextPage: false,
      hitPageLimit: false,
      queries: [],
      perSku: [],
      unmatchedSamples: [],
      unmatchedOrderSamples: [],
      ordersWithMoreLineItems: 0,
      possibleLineItemMisses: 0,
      paginationStalled: false,
      limits: {
        ordersFirst: DIAGNOSIS_TARGETED_ORDERS_PAGE_SIZE,
        lineItemsFirst: DIAGNOSIS_TARGETED_ORDER_LINE_ITEMS_PAGE_SIZE,
        maxPages: DIAGNOSIS_TARGETED_ORDER_MAX_PAGES,
        maxPagesMode: DIAGNOSIS_TARGETED_ORDER_MAX_PAGES > 0 ? "limited" : "uncapped",
        maxSkus: DIAGNOSIS_TARGETED_ORDER_MAX_SKUS,
        maxOrdersPerSku: DIAGNOSIS_TARGETED_ORDER_MAX_PAGES > 0
          ? DIAGNOSIS_TARGETED_ORDER_MAX_PAGES * DIAGNOSIS_TARGETED_ORDERS_PAGE_SIZE
          : null,
        maxOrdersAcrossSkus: DIAGNOSIS_TARGETED_ORDER_MAX_PAGES > 0
          ? DIAGNOSIS_TARGETED_ORDER_MAX_PAGES * DIAGNOSIS_TARGETED_ORDERS_PAGE_SIZE * getProductVariantSkusForOrderSearch(product).length
          : null,
      },
    },
    global: {
      pages: 0,
      scannedOrders: 0,
      scannedLineItems: 0,
      matchedLineItems: 0,
      relationshipLineItems: 0,
      hasNextPage: false,
      hitPageLimit: false,
      paginationStalled: false,
      unmatchedSamples: [],
      limits: {
        ordersFirst: DIAGNOSIS_ORDERS_PAGE_SIZE,
        lineItemsFirst: DIAGNOSIS_ORDER_LINE_ITEMS_PAGE_SIZE,
        maxPages: MAX_ORDER_PAGES,
      },
    },
    finalSalesEvents: 0,
    finalRelationshipSalesEvents: 0,
  };
}

function getSalesExtractionCompleteness(stats = {}) {
  const targeted = stats.targeted || {};
  const global = stats.global || {};
  const targetedAvailable = !targeted.skipped;
  const targetedIncomplete = targetedAvailable && Boolean(
    targeted.hitPageLimit
      || targeted.paginationStalled
      || Number(targeted.possibleLineItemMisses || 0) > 0,
  );
  const globalFallbackIncomplete = !targetedAvailable && Boolean(global.hitPageLimit || global.paginationStalled);
  const productSalesComplete = !targetedIncomplete && !globalFallbackIncomplete;
  const reasons = [
    targeted.hitPageLimit ? "targeted_order_page_limit_reached" : null,
    targeted.paginationStalled ? "targeted_order_pagination_stalled" : null,
    Number(targeted.possibleLineItemMisses || 0) > 0 ? "targeted_order_line_items_capped_before_product_line" : null,
    globalFallbackIncomplete ? "global_order_scan_limited_without_product_sku" : null,
  ].filter(Boolean);

  return {
    fetchComplete: productSalesComplete,
    productSalesComplete,
    shopSourceSalesComplete: !global.hitPageLimit && !global.paginationStalled,
    incompletenessReason: reasons[0] || null,
    incompletenessReasons: reasons,
  };
}

function captureSalesUnmatchedSample(stats, mode, lineItem = {}, sku = "") {
  const bucket = mode === "targeted" ? stats.targeted?.unmatchedSamples : stats.global?.unmatchedSamples;
  if (!Array.isArray(bucket) || bucket.length >= 8) return;
  bucket.push({
    querySku: sku || "",
    title: truncateText(lineItem.title || "", 120),
    sku: String(lineItem.sku || lineItem.variant?.sku || ""),
    productId: lineItem.product?.id || lineItem.variant?.product?.id || "",
    variantId: lineItem.variant?.id || "",
    handle: lineItem.product?.handle || lineItem.variant?.product?.handle || "",
  });
}

function captureSalesUnmatchedOrderSample(stats, order = {}, sku = "", scannedLineItemCount = 0) {
  const bucket = stats.targeted?.unmatchedOrderSamples;
  if (!Array.isArray(bucket) || bucket.length >= 8) return;
  bucket.push({
    querySku: sku || "",
    orderId: order.id || "",
    processedAt: order.processedAt || order.createdAt || "",
    scannedLineItemCount,
    lineItemsHasNextPage: Boolean(order.lineItems?.pageInfo?.hasNextPage),
  });
}

function normalizeDiagnosisOrderLineItemSaleEvent({
  lineItem,
  order,
  product,
  snapshot,
  orderDate,
  customerKey,
  basketLineItems,
  basketFingerprint,
  geography,
} = {}) {
  const lineProduct = lineItem?.product || {};
  const variant = lineItem?.variant || {};
  const lineImage = getDiagnosisLineItemImage(lineItem);
  return {
    id: lineItem?.id,
    orderId: order?.id,
    lineItemId: lineItem?.id,
    productId: lineProduct.id || variant.product?.id || (lineItemMatchesProduct(lineItem, product, snapshot) ? product.id || snapshot.productGid : null),
    createdAt: orderDate,
    orderDate,
    orderProcessedAt: toIso(order?.processedAt),
    orderCreatedAt: toIso(order?.createdAt),
    customerKey,
    customerId: customerKey,
    quantity: Number(lineItem?.quantity || 0),
    amount: Number(lineItem?.originalTotalSet?.shopMoney?.amount || 0),
    handle: lineProduct.handle || "",
    title: lineProduct.title || lineItem?.title || "",
    imageUrl: lineImage.imageUrl,
    imageAlt: lineImage.imageAlt,
    sku: lineItem?.sku || variant.sku || "",
    variantId: variant.id || null,
    variantTitle: variant.title || "",
    selectedOptions: variant.selectedOptions || [],
    basketLineItems,
    basketFingerprint,
    geography,
    country: geography?.country || "",
    countryCode: geography?.countryCode || "",
    province: geography?.province || "",
    provinceCode: geography?.provinceCode || "",
    city: geography?.city || "",
  };
}

function normalizeDiagnosisBasketLineItems(lineItems = []) {
  return getNodes(lineItems).map((lineItem) => {
    const lineImage = getDiagnosisLineItemImage(lineItem);
    return {
      id: lineItem.id || null,
      lineItemId: lineItem.id || null,
      productId: lineItem.product?.id || lineItem.variant?.product?.id || null,
      handle: lineItem.product?.handle || lineItem.variant?.product?.handle || "",
      title: lineItem.product?.title || lineItem.variant?.product?.title || lineItem.title || "",
      imageUrl: lineImage.imageUrl,
      imageAlt: lineImage.imageAlt,
      variantId: lineItem.variant?.id || null,
      variantTitle: lineItem.variant?.title || "",
      sku: lineItem.sku || lineItem.variant?.sku || "",
      quantity: Number(lineItem.quantity || 0),
      amount: Number(lineItem.originalTotalSet?.shopMoney?.amount || 0),
    };
  });
}

function getDiagnosisLineItemImage(lineItem = {}) {
  const product = lineItem?.product || {};
  const variant = lineItem?.variant || {};
  const mediaNode = product.media?.nodes?.[0] || {};
  const image = variant.image
    || product.featuredMedia?.preview?.image
    || mediaNode.image
    || mediaNode.preview?.image
    || {};
  return {
    imageUrl: image.url || "",
    imageAlt: image.altText || "",
  };
}

function backfillMissingSalesFromOperationalEvents({
  product = {},
  snapshot = {},
  sales = [],
  returns = [],
  refunds = [],
} = {}) {
  const normalizedSales = Array.isArray(sales) ? [...sales] : [];
  const existingSaleKeys = new Set(normalizedSales.map(getSaleLineIdentity).filter(Boolean));
  const candidateByKey = new Map();

  [...(Array.isArray(returns) ? returns : []), ...(Array.isArray(refunds) ? refunds : [])]
    .filter((event) => operationalEventMatchesDiagnosisProduct(event, product, snapshot))
    .forEach((event, index) => {
      const identity = getSaleLineIdentity(event);
      if (!identity || existingSaleKeys.has(identity)) return;
      const orderDate = toIso(getOrderCohortDate(event, { includeEventDate: true }));
      if (!orderDate) return;
      const current = candidateByKey.get(identity) || {
        id: `derived-sale:${identity}`,
        orderId: event.orderId || null,
        lineItemId: event.lineItemId || null,
        productId: event.productId || product.id || snapshot.productGid || null,
        createdAt: orderDate,
        orderDate,
        orderProcessedAt: toIso(event.orderProcessedAt),
        orderCreatedAt: toIso(event.orderCreatedAt),
        quantity: 0,
        amount: 0,
        title: event.title || product.title || snapshot.productTitle || "",
        sku: event.sku || "",
        variantId: event.variantId || null,
        variantTitle: event.variantTitle || "",
        selectedOptions: Array.isArray(event.selectedOptions) ? event.selectedOptions : [],
        basketLineItems: Array.isArray(event.basketLineItems) ? event.basketLineItems : [],
        basketFingerprint: "",
        geography: normalizeSalesEventGeography(event),
        country: event.country || event.geography?.country || "",
        countryCode: event.countryCode || event.geography?.countryCode || "",
        province: event.province || event.geography?.province || "",
        provinceCode: event.provinceCode || event.geography?.provinceCode || "",
        city: event.city || event.geography?.city || "",
        source: "operational_event_derived_sale",
        derivedFromOperationalEvidence: true,
        derivedFromOperationalEventIds: [],
        derivedFromOperationalEventCount: 0,
      };
      current.quantity = Math.max(current.quantity, getOperationalEventQuantity(event));
      current.amount = Math.max(current.amount, Number(event.amount || event.totalRefundedAmount || 0));
      current.derivedFromOperationalEventCount += 1;
      current.derivedFromOperationalEventIds.push(event.id || `${event.orderId || "order"}:${index}`);
      if (!current.variantId && event.variantId) current.variantId = event.variantId;
      if (!current.variantTitle && event.variantTitle) current.variantTitle = event.variantTitle;
      if (!current.sku && event.sku) current.sku = event.sku;
      candidateByKey.set(identity, current);
    });

  if (!candidateByKey.size) return normalizedSales;
  return [...normalizedSales, ...candidateByKey.values()]
    .sort((left, right) => {
      const leftDate = parseValidDate(left.createdAt || left.orderDate)?.getTime() || 0;
      const rightDate = parseValidDate(right.createdAt || right.orderDate)?.getTime() || 0;
      if (leftDate !== rightDate) return leftDate - rightDate;
      return String(left.id || "").localeCompare(String(right.id || ""));
    });
}

function filterDiagnosisEventsForProduct(events = [], product = {}, snapshot = {}) {
  return (Array.isArray(events) ? events : []).filter((event) => {
    if (diagnosisEventMatchesProduct(event, product, snapshot)) return true;
    return !hasStableDiagnosisEventProductIdentifier(event);
  });
}

function getSaleLineIdentity(event = {}) {
  const orderId = String(event.orderId || "").trim();
  const lineItemId = String(event.lineItemId || event.orderLineItemId || "").trim();
  if (orderId && lineItemId) return `${orderId}:${lineItemId}`;
  const productId = String(event.productId || "").trim();
  const variantId = String(event.variantId || "").trim();
  if (orderId && productId && variantId) return `${orderId}:${productId}:${variantId}`;
  if (orderId && productId) return `${orderId}:${productId}`;
  return "";
}

function operationalEventMatchesDiagnosisProduct(event = {}, product = {}, snapshot = {}) {
  return diagnosisEventMatchesProduct(event, product, snapshot);
}

function diagnosisEventMatchesProduct(event = {}, product = {}, snapshot = {}) {
  const productIds = new Set([
    product.id,
    snapshot.productGid,
    String(product.numericId || ""),
    extractNumericShopifyId(product.id),
    extractNumericShopifyId(snapshot.productGid),
  ].filter(Boolean).map(String));
  const eventProductId = String(event.productId || "").trim();
  if (eventProductId && (productIds.has(eventProductId) || productIds.has(extractNumericShopifyId(eventProductId)))) return true;

  const variantIds = new Set((product.variants || []).flatMap((variant) => [
    variant.id,
    variant.numericId,
    extractNumericShopifyId(variant.id),
  ]).filter(Boolean).map(String));
  const eventVariantId = String(event.variantId || "").trim();
  if (eventVariantId && (variantIds.has(eventVariantId) || variantIds.has(extractNumericShopifyId(eventVariantId)))) return true;

  if (eventProductId || eventVariantId) return false;

  const eventSku = normalizeText(event.sku || "");
  const productSkus = new Set((product.variants || []).map((variant) => normalizeText(variant.sku)).filter(Boolean));
  if (eventSku && productSkus.has(eventSku)) return true;
  if (eventSku) return false;

  const eventTitle = normalizeText(event.title || "");
  const productTitle = normalizeText(product.title || snapshot.productTitle || "");
  if (eventTitle && productTitle && (eventTitle === productTitle || eventTitle.includes(productTitle) || productTitle.includes(eventTitle))) return true;
  const handleAsTitle = normalizeText(product.handle || snapshot.handle || "").replace(/-/g, " ");
  if (hasStrongTextOverlap(eventTitle, productTitle) || hasStrongTextOverlap(eventTitle, handleAsTitle)) return true;

  return false;
}

function getDiagnosisProductIdCandidates(product = {}, snapshot = {}) {
  return Array.from(new Set([
    product.id,
    snapshot.productGid,
    String(product.numericId || ""),
    extractNumericShopifyId(product.id),
    extractNumericShopifyId(snapshot.productGid),
  ].filter(Boolean).map(String)));
}

function getDiagnosisVariantIdCandidates(product = {}) {
  return Array.from(new Set((product.variants || []).flatMap((variant) => [
    variant.id,
    variant.numericId,
    extractNumericShopifyId(variant.id),
  ]).filter(Boolean).map(String)));
}

function hasStableDiagnosisEventProductIdentifier(event = {}) {
  return Boolean(event.productId || event.variantId || event.sku || event.title);
}

function buildDiagnosisSalesQuery() {
  return `#graphql
      query ProductPulseDiagnosisSales($after: String, $query: String!, $ordersFirst: Int!, $lineItemsFirst: Int!) {
        orders(first: $ordersFirst, after: $after, query: $query, sortKey: PROCESSED_AT, reverse: true) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            createdAt
            processedAt
            customer {
              id
            }
            lineItems(first: $lineItemsFirst) {
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                id
                quantity
                title
                sku
                product {
                  id
                  handle
                  title
                  featuredMedia {
                    preview {
                      image {
                        url
                        altText
                      }
                    }
                  }
                  media(first: 1) {
                    nodes {
                      preview {
                        image {
                          url
                          altText
                        }
                      }
                      ... on MediaImage {
                        image {
                          url
                          altText
                        }
                      }
                    }
                  }
                }
                variant {
                  id
                  title
                  sku
                  image {
                    url
                    altText
                  }
                  selectedOptions {
                    name
                    value
                  }
                }
                originalTotalSet {
                  shopMoney {
                    amount
                  }
                }
              }
            }
          }
        }
      }`;
}

function getShopifyOrderDate(order = {}) {
  return order?.processedAt || order?.createdAt || order?.updatedAt || null;
}

function normalizeOrderAddressGeography(address = {}) {
  if (!address || typeof address !== "object") return null;
  const countryCode = normalizeGeographyCode(address.countryCodeV2 || address.countryCode || address.country_code);
  const provinceCode = normalizeGeographyCode(address.provinceCode || address.province_code || address.stateCode || address.state_code);
  const country = truncateText(address.country || address.countryName || "", 80);
  const province = truncateText(address.province || address.state || address.region || "", 80);
  const city = truncateText(address.city || "", 80);
  if (!countryCode && !country && !provinceCode && !province && !city) return null;
  return {
    country,
    countryCode,
    province,
    provinceCode,
    city,
  };
}

function normalizeGeographyCode(value = "") {
  return String(value || "").trim().toUpperCase();
}

async function fetchShopifyRefundEvents({ shop, jobId, admin, product, snapshot, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS, sinceDate = null, includeAllProducts = false }) {
  for (const [index, queryPlan] of DIAGNOSIS_REFUND_QUERY_PLANS.entries()) {
    try {
      return await fetchShopifyRefundEventsWithPlan({ shop, jobId, admin, product, snapshot, queryPlan, windowDays, sinceDate, includeAllProducts });
    } catch (error) {
      const nextPlan = DIAGNOSIS_REFUND_QUERY_PLANS[index + 1];
      if (!isShopifyQueryCostLimitError(error) || !nextPlan) throw error;
      await recordJobLog({
        shop,
        jobId,
        level: "warn",
        event: "product_diagnosis.shopify_refund_query_cost_retried",
        message: `Shopify rejected the ${queryPlan.label} refund query cost; retrying with ${nextPlan.label} limits.`,
        data: {
          productGid: snapshot.productGid,
          failedPlan: queryPlan,
          nextPlan,
          error: serializeError(error),
        },
      });
    }
  }

  return [];
}

async function fetchShopifyRefundEventsWithPlan({ shop, jobId, admin, product, snapshot, queryPlan, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS, sinceDate = null, includeAllProducts = false }) {
  if (!admin?.graphql) return [];
  const events = [];
  const seenRefundLineItemIds = new Set();
  const seenOrderLevelRefundLineItemIds = new Set();
  let cursor = null;
  const stats = {
    scannedRefunds: 0,
    scannedRefundLineItems: 0,
    matchedRefundLineItems: 0,
    scannedOrderLevelRefundLineItems: 0,
    matchedOrderLevelRefundLineItems: 0,
    matchedRefundLineItemsWithNotes: 0,
    matchedRefundLineItemsWithReasons: 0,
    matchedReasonSamples: [],
    matchedNoteSamples: [],
    unmatchedSamples: [],
    queryModes: [],
    queryPlan: queryPlan.label,
    queryLimits: {
      ordersFirst: queryPlan.ordersFirst,
      refundLineItemsFirst: queryPlan.refundLineItemsFirst,
      fallbackLineItemsFirst: queryPlan.fallbackLineItemsFirst,
      orderAdjustmentsFirst: queryPlan.orderAdjustmentsFirst,
      includeVariantProduct: queryPlan.includeVariantProduct,
      includeAdjustments: queryPlan.includeAdjustments,
    },
  };
  const orderQueries = buildRefundOrderQueries(windowDays, sinceDate);

  for (const orderQuery of orderQueries) {
    cursor = null;
    stats.queryModes.push(orderQuery.mode);

    for (let page = 0; page < MAX_ORDER_PAGES; page += 1) {
      const variables = {
        after: cursor,
        query: orderQuery.query,
        ordersFirst: queryPlan.ordersFirst,
        refundLineItemsFirst: queryPlan.refundLineItemsFirst,
        fallbackLineItemsFirst: queryPlan.fallbackLineItemsFirst || DIAGNOSIS_REFUND_FALLBACK_LINE_ITEMS_PAGE_SIZE,
      };
      if (queryPlan.includeAdjustments) variables.orderAdjustmentsFirst = queryPlan.orderAdjustmentsFirst || DIAGNOSIS_REFUND_ORDER_ADJUSTMENTS_PAGE_SIZE;

      const data = await shopifyGraphql(
        admin,
        buildDiagnosisRefundsQuery({
          includeVariantProduct: queryPlan.includeVariantProduct,
          includeAdjustments: queryPlan.includeAdjustments,
        }),
        variables,
      );

      getNodes(data?.orders).forEach((order) => {
        const refunds = order.refunds || [];
        refunds.forEach((refund) => {
          stats.scannedRefunds += 1;
          const adjustmentReasons = getRefundAdjustmentReasons(refund);
          const refundLineItems = getNodes(refund.refundLineItems);
          refundLineItems.forEach((refundLineItem) => {
            if (refundLineItem.id && seenRefundLineItemIds.has(refundLineItem.id)) return;
            if (refundLineItem.id) seenRefundLineItemIds.add(refundLineItem.id);
            stats.scannedRefundLineItems += 1;
            const lineItem = refundLineItem.lineItem || {};
            const matchedProduct = lineItemMatchesProduct(lineItem, product, snapshot);
            if (!matchedProduct) {
              if (stats.unmatchedSamples.length < 4) {
                stats.unmatchedSamples.push({
                  title: lineItem.title || "",
                  sku: lineItem.sku || lineItem.variant?.sku || "",
                  productId: lineItem.product?.id || lineItem.variant?.product?.id || "",
                  handle: lineItem.product?.handle || lineItem.variant?.product?.handle || "",
                  restockType: refundLineItem.restockType || "",
                  notePreview: truncateText(refund.note || "", 120),
                  queryMode: orderQuery.mode,
                });
              }
              if (!includeAllProducts) return;
            }

            const noteText = getRefundNoteText({ note: refund.note });
            const reasonText = getRefundReasonText({
              note: refund.note,
              restockType: refundLineItem.restockType,
              adjustmentReasons,
            });
            if (matchedProduct && noteText) {
              stats.matchedRefundLineItemsWithNotes += 1;
              if (stats.matchedNoteSamples.length < 5) {
                stats.matchedNoteSamples.push({
                  title: lineItem.title || product.title,
                  sku: lineItem.sku || lineItem.variant?.sku || "",
                  notePreview: truncateText(noteText, 180),
                  queryMode: orderQuery.mode,
                });
              }
            }
            if (matchedProduct && reasonText) {
              stats.matchedRefundLineItemsWithReasons += 1;
              if (stats.matchedReasonSamples.length < 5) {
                stats.matchedReasonSamples.push({
                  title: lineItem.title || product.title,
                  sku: lineItem.sku || lineItem.variant?.sku || "",
                  reasonPreview: truncateText(reasonText, 180),
                  adjustmentReasons,
                  restockType: refundLineItem.restockType || "",
                  queryMode: orderQuery.mode,
                });
              }
            }

            if (matchedProduct) stats.matchedRefundLineItems += 1;
            events.push({
              id: refundLineItem.id,
              refundId: refund.id,
              refundLineItemId: refundLineItem.id,
              orderId: order.id,
              lineItemId: lineItem.id || null,
              productId: lineItem.product?.id || lineItem.variant?.product?.id || (matchedProduct ? product.id || snapshot.productGid : null),
              orderDate: toIso(getShopifyOrderDate(order)),
              orderProcessedAt: toIso(order.processedAt),
              orderCreatedAt: toIso(order.createdAt),
              createdAt: toIso(refund.processedAt || refund.createdAt || order.createdAt),
              processedAt: toIso(refund.processedAt || refund.createdAt || order.createdAt),
              updatedAt: toIso(refund.updatedAt || refund.processedAt || refund.createdAt || order.createdAt),
              quantity: Number(refundLineItem.quantity || 0),
              amount: Number(refundLineItem.subtotalSet?.shopMoney?.amount || 0),
              totalRefundedAmount: Number(refund.totalRefundedSet?.shopMoney?.amount || 0),
              restockType: refundLineItem.restockType || "",
              adjustmentReasons,
              reason: reasonText,
              reasonLabel: reasonText || normalizeRefundReasonLabel(refundLineItem.restockType || ""),
              note: noteText,
              title: lineItem.title || (matchedProduct ? product.title : ""),
              sku: lineItem.sku || lineItem.variant?.sku || "",
              variantId: lineItem.variant?.id || null,
              variantTitle: lineItem.variant?.title || "",
              selectedOptions: lineItem.variant?.selectedOptions || [],
            });
          });

          if (!refundLineItems.length) {
            addDiagnosisOrderLevelRefundFallbackEvents({
              order,
              refund,
              adjustmentReasons,
              product,
              snapshot,
              orderQuery,
              seenOrderLevelRefundLineItemIds,
              stats,
              events,
              includeAllProducts,
            });
          }
        });

        if (!refunds.length) {
          addDiagnosisOrderLevelRefundFallbackEvents({
            order,
            refund: null,
            adjustmentReasons: [],
            product,
            snapshot,
            orderQuery,
            seenOrderLevelRefundLineItemIds,
            stats,
            events,
            includeAllProducts,
          });
        }
      });

      if (!data?.orders?.pageInfo?.hasNextPage) break;
      cursor = data.orders.pageInfo.endCursor;
    }
  }

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.shopify_refunds_extracted",
    message: "Shopify refund line items were extracted for product diagnosis.",
    data: {
      productGid: snapshot.productGid,
      windowDays,
      ...stats,
      refundEvents: events.length,
    },
  });

  return events;
}

function addDiagnosisOrderLevelRefundFallbackEvents({
  order,
  refund,
  adjustmentReasons = [],
  product,
  snapshot,
  orderQuery,
  seenOrderLevelRefundLineItemIds,
  stats,
  events,
  includeAllProducts = false,
}) {
  const lineItems = getNodes(order?.lineItems);
  if (!shouldUseDiagnosisOrderLevelRefundFallback(order, refund, lineItems)) return;

  const totalRefundedAmount = getDiagnosisOrderLevelRefundAmount(order, refund, lineItems);
  const context = {
    id: refund?.id || `order-refund:${order?.id || ""}`,
    orderDate: toIso(getShopifyOrderDate(order)),
    orderProcessedAt: toIso(order?.processedAt),
    orderCreatedAt: toIso(order?.createdAt),
    createdAt: toIso(refund?.processedAt || refund?.createdAt || order?.updatedAt || order?.createdAt),
    processedAt: toIso(refund?.processedAt || refund?.createdAt || order?.updatedAt || order?.createdAt),
    updatedAt: toIso(refund?.updatedAt || refund?.processedAt || refund?.createdAt || order?.updatedAt || order?.createdAt),
    orderId: order?.id,
    orderName: order?.name,
    displayFinancialStatus: order?.displayFinancialStatus,
    note: refund?.note || "",
    adjustmentReasons,
    totalRefundedAmount,
    lineItems,
  };

  lineItems.forEach((lineItem) => {
    stats.scannedOrderLevelRefundLineItems += 1;
    const fallbackKey = [order?.id, refund?.id || "order-level", lineItem?.id].filter(Boolean).join(":");
    if (!fallbackKey || seenOrderLevelRefundLineItemIds.has(fallbackKey)) return;

    const matchedProduct = lineItemMatchesProduct(lineItem, product, snapshot);
    if (!matchedProduct) {
      if (stats.unmatchedSamples.length < 4) {
        stats.unmatchedSamples.push({
          title: lineItem.title || "",
          sku: lineItem.sku || lineItem.variant?.sku || "",
          productId: lineItem.product?.id || lineItem.variant?.product?.id || "",
          handle: lineItem.product?.handle || lineItem.variant?.product?.handle || "",
          restockType: "order-level-refund",
          notePreview: truncateText(refund?.note || order?.displayFinancialStatus || "", 120),
          queryMode: orderQuery.mode,
        });
      }
      if (!includeAllProducts) return;
    }

    seenOrderLevelRefundLineItemIds.add(fallbackKey);
    const event = normalizeDiagnosisOrderLevelRefundLineItemEvent(lineItem, context, matchedProduct ? product : null);
    const noteText = getRefundNoteText(event);
    const reasonText = getRefundReasonText(event);
    if (matchedProduct) stats.matchedOrderLevelRefundLineItems += 1;
    if (matchedProduct && noteText) {
      stats.matchedRefundLineItemsWithNotes += 1;
      if (stats.matchedNoteSamples.length < 5) {
        stats.matchedNoteSamples.push({
          title: lineItem.title || product.title,
          sku: lineItem.sku || lineItem.variant?.sku || "",
          notePreview: truncateText(noteText, 180),
          queryMode: orderQuery.mode,
          fallbackSource: event.fallbackSource,
        });
      }
    }
    if (matchedProduct && reasonText) {
      stats.matchedRefundLineItemsWithReasons += 1;
      if (stats.matchedReasonSamples.length < 5) {
        stats.matchedReasonSamples.push({
          title: lineItem.title || product.title,
          sku: lineItem.sku || lineItem.variant?.sku || "",
          reasonPreview: truncateText(reasonText, 180),
          adjustmentReasons,
          restockType: event.restockType || "",
          queryMode: orderQuery.mode,
          fallbackSource: event.fallbackSource,
        });
      }
    }
    events.push(event);
  });
}

function normalizeDiagnosisOrderLevelRefundLineItemEvent(lineItem, refund, product) {
  const amount = calculateDiagnosisFallbackRefundLineAmount(lineItem, refund);
  const reason = getDiagnosisOrderLevelRefundReasonText(refund);

  return {
    id: `order-level-refund:${refund?.orderId || ""}:${refund?.id || ""}:${lineItem?.id || ""}`,
    refundId: refund?.id || null,
    orderId: refund?.orderId || null,
    lineItemId: lineItem.id || null,
    productId: lineItem.product?.id || lineItem.variant?.product?.id || product?.id || null,
    orderName: refund?.orderName || "",
    orderDate: refund?.orderDate || null,
    orderProcessedAt: refund?.orderProcessedAt || null,
    orderCreatedAt: refund?.orderCreatedAt || null,
    createdAt: refund?.createdAt,
    processedAt: refund?.processedAt || refund?.createdAt,
    updatedAt: refund?.updatedAt || refund?.createdAt,
    quantity: calculateDiagnosisFallbackRefundQuantity(lineItem, amount),
    amount,
    totalRefundedAmount: refund?.totalRefundedAmount || amount,
    restockType: "ORDER_LEVEL_REFUND",
    adjustmentReasons: refund?.adjustmentReasons || [],
    reason,
    reasonLabel: reason,
    note: getRefundNoteText(refund),
    title: lineItem.title || product?.title || "",
    sku: lineItem.sku || lineItem.variant?.sku || "",
    variantId: lineItem.variant?.id || null,
    variantTitle: lineItem.variant?.title || "",
    selectedOptions: lineItem.variant?.selectedOptions || [],
    fallbackSource: "order_financial_status",
  };
}

function shouldUseDiagnosisOrderLevelRefundFallback(order, refund, lineItems = []) {
  const status = String(order?.displayFinancialStatus || "").toUpperCase();
  const hasRefundSignal = status.includes("REFUND")
    || getShopMoneyAmount(order?.totalRefundedSet) > 0
    || getShopMoneyAmount(refund?.totalRefundedSet) > 0;
  if (!hasRefundSignal || !lineItems.length) return false;
  if (status === "REFUNDED") return true;
  if (status === "PARTIALLY_REFUNDED") return lineItems.length === 1;
  return lineItems.length === 1;
}

function getDiagnosisOrderLevelRefundAmount(order, refund, lineItems = []) {
  const refundAmount = getShopMoneyAmount(refund?.totalRefundedSet);
  if (refundAmount > 0) return refundAmount;
  const orderRefundedAmount = getShopMoneyAmount(order?.totalRefundedSet);
  if (orderRefundedAmount > 0) return orderRefundedAmount;
  return lineItems.reduce((total, lineItem) => total + getShopMoneyAmount(lineItem.originalTotalSet), 0);
}

function calculateDiagnosisFallbackRefundLineAmount(lineItem, refund) {
  const lineItems = refund?.lineItems || [];
  const totalRefundedAmount = Number(refund?.totalRefundedAmount || 0);
  const lineAmount = getShopMoneyAmount(lineItem.originalTotalSet);
  if (!totalRefundedAmount) return roundCurrency(lineAmount);

  const lineItemsAmount = lineItems.reduce((total, item) => total + getShopMoneyAmount(item.originalTotalSet), 0);
  if (lineItemsAmount > 0 && lineAmount > 0) {
    return roundCurrency((totalRefundedAmount * lineAmount) / lineItemsAmount);
  }

  const lineItemCount = Math.max(lineItems.length, 1);
  return roundCurrency(totalRefundedAmount / lineItemCount);
}

function calculateDiagnosisFallbackRefundQuantity(lineItem, amount) {
  const quantity = Math.max(Number(lineItem.quantity || 0), 0);
  if (quantity <= 1) return quantity || 1;
  const lineAmount = getShopMoneyAmount(lineItem.originalTotalSet);
  if (!lineAmount || amount >= lineAmount) return quantity;
  return Math.max(1, Math.min(quantity, Math.round(quantity * (amount / lineAmount))));
}

function getDiagnosisOrderLevelRefundReasonText(refund = {}) {
  const reason = getRefundReasonText({
    adjustmentReasons: refund.adjustmentReasons,
  });
  if (reason) return reason;
  const status = normalizeRefundReasonLabel(refund.displayFinancialStatus || "");
  return status || "Order-level refund";
}

function getShopMoneyAmount(moneyBag) {
  return Number(moneyBag?.shopMoney?.amount || 0) || 0;
}

function buildDiagnosisRefundsQuery({ includeVariantProduct = true, includeAdjustments = true } = {}) {
  return `#graphql
      query ProductPulseDiagnosisRefunds(
        $after: String,
        $query: String!,
        $ordersFirst: Int!,
        $fallbackLineItemsFirst: Int!,
        $refundLineItemsFirst: Int!${includeAdjustments ? `,
        $orderAdjustmentsFirst: Int!` : ""}
      ) {
        orders(first: $ordersFirst, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            name
            createdAt
            processedAt
            updatedAt
            displayFinancialStatus
            totalRefundedSet {
              shopMoney {
                amount
              }
            }
            lineItems(first: $fallbackLineItemsFirst) {
              nodes {
                id
                quantity
                title
                sku
                product {
                  id
                  legacyResourceId
                  handle
                  title
                }
                variant {
                  id
                  legacyResourceId
                  title
                  sku
                  selectedOptions {
                    name
                    value
                  }
                  ${includeVariantProduct ? `
                  product {
                    id
                    legacyResourceId
                    handle
                    title
                  }` : ""}
                }
                originalTotalSet {
                  shopMoney {
                    amount
                  }
                }
              }
            }
            refunds {
              id
              createdAt
              processedAt
              updatedAt
              note
              totalRefundedSet {
                shopMoney {
                  amount
                }
              }
              ${includeAdjustments ? `
              orderAdjustments(first: $orderAdjustmentsFirst) {
                nodes {
                  id
                  reason
                  amountSet {
                    shopMoney {
                      amount
                    }
                  }
                }
              }` : ""}
              refundLineItems(first: $refundLineItemsFirst) {
                nodes {
                  id
                  quantity
                  restockType
                  subtotalSet {
                    shopMoney {
                      amount
                    }
                  }
                  lineItem {
                    id
                    title
                    sku
                    product {
                      id
                      legacyResourceId
                      handle
                      title
                    }
                    variant {
                      id
                      legacyResourceId
                      title
                      sku
                      selectedOptions {
                        name
                        value
                      }
                      ${includeVariantProduct ? `
                      product {
                        id
                        legacyResourceId
                        handle
                        title
                      }` : ""}
                    }
                  }
                }
              }
            }
          }
        }
      }`;
}

function buildRefundOrderQueries(windowDays, sinceDate = null) {
  const since = normalizeShopifySinceDate(sinceDate, windowDays);
  return [
    { mode: "updated_at", query: `updated_at:>=${since}` },
    { mode: "partially_refunded", query: `financial_status:partially_refunded updated_at:>=${since}` },
    { mode: "refunded", query: `financial_status:refunded updated_at:>=${since}` },
  ];
}

async function fetchShopifyReturnEvents({ shop, jobId, admin, product, snapshot, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS, sinceDate = null, includeAllProducts = false }) {
  try {
    return await fetchShopifyReturnEventsWithSchema({ shop, jobId, admin, product, snapshot, includeReasonDefinition: true, windowDays, sinceDate, includeAllProducts });
  } catch (error) {
    if (!isMissingReturnReasonDefinitionError(error)) throw error;
    await recordJobLog({
      shop,
      jobId,
      level: "warn",
      event: "product_diagnosis.return_reason_definition_unavailable",
      message: "Shopify API version did not expose returnReasonDefinition; retrying return extraction with legacy returnReason fields.",
      data: { error: serializeError(error), productGid: snapshot.productGid },
    });
    return fetchShopifyReturnEventsWithSchema({ shop, jobId, admin, product, snapshot, includeReasonDefinition: false, windowDays, sinceDate, includeAllProducts });
  }
}

async function fetchShopifyReturnEventsWithSchema({ shop, jobId, admin, product, snapshot, includeReasonDefinition, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS, sinceDate = null, includeAllProducts = false }) {
  for (const [index, queryPlan] of DIAGNOSIS_RETURN_QUERY_PLANS.entries()) {
    try {
      return await fetchShopifyReturnEventsWithPlan({ shop, jobId, admin, product, snapshot, includeReasonDefinition, queryPlan, windowDays, sinceDate, includeAllProducts });
    } catch (error) {
      const nextPlan = DIAGNOSIS_RETURN_QUERY_PLANS[index + 1];
      if (!isShopifyQueryCostLimitError(error) || !nextPlan) throw error;
      await recordJobLog({
        shop,
        jobId,
        level: "warn",
        event: "product_diagnosis.shopify_return_query_cost_retried",
        message: `Shopify rejected the ${queryPlan.label} return query cost; retrying with ${nextPlan.label} limits.`,
        data: {
          productGid: snapshot.productGid,
          failedPlan: queryPlan,
          nextPlan,
          error: serializeError(error),
        },
      });
    }
  }

  return [];
}

async function fetchShopifyReturnEventsWithPlan({ shop, jobId, admin, product, snapshot, includeReasonDefinition, queryPlan, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS, sinceDate = null, includeAllProducts = false }) {
  if (!admin?.graphql) return [];
  const events = [];
  let cursor = null;
  const stats = {
    scannedReturnLineItems: 0,
    matchedReturnLineItems: 0,
    matchedReturnLineItemsWithNotes: 0,
    matchedNoteSamples: [],
    queryModes: [],
    unmatchedSamples: [],
    includeReasonDefinition,
    queryPlan: queryPlan.label,
    queryLimits: {
      ordersFirst: queryPlan.ordersFirst,
      returnsFirst: queryPlan.returnsFirst,
      returnLineItemsFirst: queryPlan.returnLineItemsFirst,
      includeVariantProduct: queryPlan.includeVariantProduct,
    },
  };
  const seenReturnLineItemIds = new Set();
  const orderQueries = buildReturnOrderQueries(windowDays, sinceDate);

  for (const orderQuery of orderQueries) {
    cursor = null;
    stats.queryModes.push(orderQuery.mode);

    for (let page = 0; page < MAX_ORDER_PAGES; page += 1) {
      const data = await shopifyGraphql(
        admin,
        buildDiagnosisReturnsQuery({ includeReasonDefinition, includeVariantProduct: queryPlan.includeVariantProduct }),
        {
          after: cursor,
          query: orderQuery.query,
          ordersFirst: queryPlan.ordersFirst,
          returnsFirst: queryPlan.returnsFirst,
          returnLineItemsFirst: queryPlan.returnLineItemsFirst,
        },
      );

      getNodes(data?.orders).forEach((order) => {
        getNodes(order.returns).forEach((itemReturn) => {
          getNodes(itemReturn.returnLineItems).forEach((returnLineItem) => {
            if (returnLineItem.id && seenReturnLineItemIds.has(returnLineItem.id)) return;
            if (returnLineItem.id) seenReturnLineItemIds.add(returnLineItem.id);
            stats.scannedReturnLineItems += 1;
            const lineItem = returnLineItem.fulfillmentLineItem?.lineItem || {};
            const matchedProduct = lineItemMatchesProduct(lineItem, product, snapshot);
            if (!matchedProduct) {
              if (stats.unmatchedSamples.length < 4) {
                stats.unmatchedSamples.push({
                  title: lineItem.title || "",
                  sku: lineItem.sku || lineItem.variant?.sku || "",
                  productId: lineItem.product?.id || "",
                  handle: lineItem.product?.handle || "",
                  reason: getReturnReasonValue(returnLineItem),
                  notePreview: truncateText(getReturnLineItemNoteText(returnLineItem), 120),
                  queryMode: orderQuery.mode,
                });
              }
              if (!includeAllProducts) return;
            }

            if (matchedProduct) stats.matchedReturnLineItems += 1;
            const reasonNote = getReturnLineItemReasonNote(returnLineItem);
            const customerNote = getReturnLineItemCustomerNote(returnLineItem);
            if (matchedProduct && (reasonNote || customerNote)) {
              stats.matchedReturnLineItemsWithNotes += 1;
              if (stats.matchedNoteSamples.length < 5) {
                stats.matchedNoteSamples.push({
                  title: lineItem.title || product.title,
                  sku: lineItem.sku || lineItem.variant?.sku || "",
                  reason: getReturnReasonValue(returnLineItem),
                  reasonLabel: getReturnReasonLabel(returnLineItem),
                  reasonNote: truncateText(reasonNote, 160),
                  customerNote: truncateText(customerNote, 160),
                  notePreview: truncateText(getReturnLineItemNoteText(returnLineItem), 220),
                  queryMode: orderQuery.mode,
                });
              }
            }

            events.push({
              id: returnLineItem.id,
              returnId: itemReturn.id,
              returnLineItemId: returnLineItem.id,
              orderId: order.id,
              lineItemId: lineItem.id || null,
              productId: lineItem.product?.id || lineItem.variant?.product?.id || (matchedProduct ? product.id || snapshot.productGid : null),
              orderDate: toIso(getShopifyOrderDate(order)),
              orderProcessedAt: toIso(order.processedAt),
              orderCreatedAt: toIso(order.createdAt),
              createdAt: toIso(itemReturn.createdAt || order.createdAt),
              status: itemReturn.status || "",
              quantity: Number(returnLineItem.quantity || returnLineItem.processedQuantity || returnLineItem.refundedQuantity || 0),
              processedQuantity: Number(returnLineItem.processedQuantity || 0),
              refundedQuantity: Number(returnLineItem.refundedQuantity || 0),
              reason: getReturnReasonValue(returnLineItem),
              reasonLabel: getReturnReasonLabel(returnLineItem),
              reasonNote,
              customerNote,
              title: lineItem.title || (matchedProduct ? product.title : ""),
              sku: lineItem.sku || lineItem.variant?.sku || "",
              variantId: lineItem.variant?.id || null,
              variantTitle: lineItem.variant?.title || "",
              selectedOptions: lineItem.variant?.selectedOptions || [],
            });
          });
        });
      });

      if (!data?.orders?.pageInfo?.hasNextPage) break;
      cursor = data.orders.pageInfo.endCursor;
    }
  }

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.shopify_returns_extracted",
    message: "Shopify return line items were extracted for product diagnosis.",
    data: {
      productGid: snapshot.productGid,
      windowDays,
      ...stats,
      returnEvents: events.length,
    },
  });

  return events;
}

function buildDiagnosisReturnsQuery({ includeReasonDefinition = true, includeVariantProduct = true } = {}) {
  return `#graphql
      query ProductPulseDiagnosisReturns(
        $after: String,
        $query: String!,
        $ordersFirst: Int!,
        $returnsFirst: Int!,
        $returnLineItemsFirst: Int!
      ) {
        orders(first: $ordersFirst, after: $after, query: $query, sortKey: UPDATED_AT, reverse: true) {
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            id
            createdAt
            processedAt
            returns(first: $returnsFirst) {
              nodes {
                id
                createdAt
                status
                returnLineItems(first: $returnLineItemsFirst) {
                  nodes {
                    ... on ReturnLineItem {
                      id
                      quantity
                      processedQuantity
                      refundedQuantity
                      customerNote
                      returnReason
                      returnReasonNote
                      ${includeReasonDefinition ? `
                      returnReasonDefinition {
                        handle
                        name
                      }` : ""}
                      fulfillmentLineItem {
                        lineItem {
                          id
                          title
                          sku
                          product {
                            id
                            legacyResourceId
                            handle
                            title
                          }
                          variant {
                            id
                            legacyResourceId
                            title
                            sku
                            selectedOptions {
                              name
                              value
                            }
                            ${includeVariantProduct ? `
                            product {
                              id
                              legacyResourceId
                              handle
                              title
                            }` : ""}
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }`;
}

function buildReturnOrderQueries(windowDays, sinceDate = null) {
  const since = normalizeShopifySinceDate(sinceDate, windowDays);
  return [
    { mode: "updated_at", query: `updated_at:>=${since}` },
    { mode: "return_requested", query: `return_status:return_requested updated_at:>=${since}` },
    { mode: "in_progress", query: `return_status:in_progress updated_at:>=${since}` },
    { mode: "inspection_complete", query: `return_status:inspection_complete updated_at:>=${since}` },
    { mode: "returned", query: `return_status:returned updated_at:>=${since}` },
  ];
}

async function fetchJudgeMeDiagnosisData({ shop, jobId, snapshot, shopifyProduct, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS }) {
  const source = await prisma.productPulseSource.findUnique({
    where: { shop_sourceKey: { shop, sourceKey: "judgemeReviews" } },
  }).catch(() => null);

  const token = String(source?.credentials?.privateApiToken || "").trim();
  if (!source?.connected || !source.active || !token) {
    await recordJobLog({
      shop,
      jobId,
      event: "product_diagnosis.judgeme_skipped",
      message: "Judge.me is not connected or active; diagnosis will continue without review evidence.",
      data: { connected: Boolean(source?.connected), active: Boolean(source?.active) },
    });
    return { connected: false, internalProductId: null, reviews: [], matchConfidence: 0, errors: [] };
  }

  const errors = [];
  const internalProduct = await resolveJudgeMeProduct({ shop, token, snapshot, shopifyProduct }).catch((error) => {
    errors.push(serializeError(error));
    return null;
  });
  let reviews = [];
  let matchConfidence = internalProduct?.matchConfidence || 0;

  if (internalProduct?.id) {
    reviews = await fetchJudgeMeReviewsByProductId({ shop, token, productId: internalProduct.id }).catch((error) => {
      errors.push(serializeError(error));
      return [];
    });
  }

  if (!reviews.length) {
    const fallback = await fetchAndMatchJudgeMeReviews({ shop, token, snapshot, shopifyProduct }).catch((error) => {
      errors.push(serializeError(error));
      return { reviews: [], matchConfidence: 0 };
    });
    reviews = fallback.reviews;
    matchConfidence = Math.max(matchConfidence, fallback.matchConfidence);
  }

  const normalizedReviews = filterReviewsByLookbackWindow(
    reviews.map((review) => normalizeJudgeMeReview(review, snapshot, shopifyProduct)).filter(Boolean),
    windowDays,
  );
  if (normalizedReviews.length) {
    await prisma.productPulseSource.update({
      where: { shop_sourceKey: { shop, sourceKey: "judgemeReviews" } },
      data: { health: "connected", lastSyncedAt: new Date() },
    }).catch(() => {});
  } else if (errors.length) {
    await prisma.productPulseSource.update({
      where: { shop_sourceKey: { shop, sourceKey: "judgemeReviews" } },
      data: { health: "error" },
    }).catch(() => {});
  }

  await recordJobLog({
    shop,
    jobId,
    level: errors.length && !normalizedReviews.length ? "warn" : "info",
    event: "product_diagnosis.judgeme_extracted",
    message: "Judge.me product review extraction finished.",
    data: {
      internalProductId: internalProduct?.id || null,
      reviews: normalizedReviews.length,
      ignoredOutsideWindow: Math.max(0, reviews.length - normalizedReviews.length),
      windowDays,
      matchConfidence,
      errors,
    },
  });

  return {
    connected: true,
    internalProductId: internalProduct?.id || null,
    reviews: normalizedReviews,
    matchConfidence,
    errors,
  };
}

async function fetchYotpoDiagnosisData({ shop, jobId, snapshot, shopifyProduct, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS }) {
  const source = await prisma.productPulseSource.findUnique({
    where: { shop_sourceKey: { shop, sourceKey: "yotpoReviews" } },
  }).catch(() => null);

  const storeId = String(source?.credentials?.storeId || "").trim();
  const apiSecret = String(source?.credentials?.apiSecret || "").trim();
  let utoken = String(source?.credentials?.utoken || "").trim();
  if (!source?.connected || !source.active || !storeId || (!utoken && !apiSecret)) {
    await recordJobLog({
      shop,
      jobId,
      event: "product_diagnosis.yotpo_skipped",
      message: "Yotpo Reviews is not connected or active; diagnosis will continue without Yotpo review evidence.",
      data: { connected: Boolean(source?.connected), active: Boolean(source?.active), hasStoreId: Boolean(storeId) },
    });
    return { connected: false, reviews: [], matchConfidence: 0, errors: [] };
  }

  const errors = [];
  const productLookup = await fetchYotpoProductReviewsForDiagnosis({ storeId, snapshot, shopifyProduct });
  const productMatched = productLookup.reviews.map((review) => ({
    review: attachYotpoProductIdentifiers(review, productLookup.productId),
    confidence: productLookup.matchConfidence,
  }));
  let refreshedToken = false;
  if (!productMatched.length && !utoken && apiSecret) {
    const auth = await authenticateYotpo({ storeId, apiSecret }).catch((error) => {
      errors.push(serializeError(error));
      return null;
    });
    utoken = auth?.utoken || "";
    refreshedToken = Boolean(utoken);
  }

  const fetched = !productMatched.length && utoken
    ? await fetchYotpoReviewPages({
      storeId,
      utoken,
      maxPages: MAX_YOTPO_SYNC_PAGES,
    }).catch(async (error) => {
      errors.push(serializeError(error));
      if (!apiSecret || ![401, 403].includes(Number(error?.status || 0))) return { reviews: [] };
      const auth = await authenticateYotpo({ storeId, apiSecret }).catch((authError) => {
        errors.push(serializeError(authError));
        return null;
      });
      if (!auth?.utoken) return { reviews: [] };
      utoken = auth.utoken;
      refreshedToken = true;
      return fetchYotpoReviewPages({ storeId, utoken, maxPages: MAX_YOTPO_SYNC_PAGES }).catch((retryError) => {
        errors.push(serializeError(retryError));
        return { reviews: [] };
      });
    })
    : { reviews: [] };

  const matched = productMatched.length
    ? productMatched
    : (fetched.reviews || [])
      .map((review) => ({
        review,
        confidence: getYotpoReviewMatchConfidence(review, snapshot, shopifyProduct),
      }))
      .filter((item) => item.confidence >= 0.75);
  const allMatchedReviews = matched
    .map((item) => normalizeYotpoReview(item.review, snapshot, shopifyProduct, item.confidence))
    .filter(Boolean);
  const reviews = filterReviewsByLookbackWindow(allMatchedReviews, windowDays);
  const matchConfidence = matched.length ? Math.max(...matched.map((item) => item.confidence)) : 0;

  if (reviews.length || refreshedToken) {
    await prisma.productPulseSource.update({
      where: { shop_sourceKey: { shop, sourceKey: "yotpoReviews" } },
      data: {
        health: "connected",
        lastSyncedAt: new Date(),
        credentials: refreshedToken
          ? {
            ...(source.credentials || {}),
            storeId,
            apiSecret,
            utoken,
            utokenGeneratedAt: new Date().toISOString(),
          }
          : source.credentials,
      },
    }).catch(() => {});
  } else if (errors.length) {
    await prisma.productPulseSource.update({
      where: { shop_sourceKey: { shop, sourceKey: "yotpoReviews" } },
      data: { health: "error" },
    }).catch(() => {});
  }

  await recordJobLog({
    shop,
    jobId,
    level: errors.length && !reviews.length ? "warn" : "info",
    event: "product_diagnosis.yotpo_extracted",
    message: "Yotpo Reviews extraction finished for this product.",
    data: {
      fetchedReviews: fetched.reviews?.length || 0,
      matchedReviews: reviews.length,
      ignoredOutsideWindow: Math.max(0, allMatchedReviews.length - reviews.length),
      windowDays,
      matchConfidence,
      refreshedToken,
      productLookupProductId: productLookup.productId,
      productLookupReviews: productLookup.reviews.length,
      productLookupErrors: productLookup.errors,
      errors,
    },
  });

  return {
    connected: true,
    reviews,
    matchConfidence,
    errors,
  };
}

async function fetchYotpoProductReviewsForDiagnosis({ storeId, snapshot, shopifyProduct }) {
  const errors = [];
  const candidates = buildYotpoProductReviewIdCandidates(snapshot, shopifyProduct);

  for (const candidate of candidates) {
    const result = await fetchYotpoProductReviewPages({
      storeId,
      productId: candidate.productId,
      maxPages: MAX_YOTPO_PRODUCT_REVIEW_PAGES,
    }).catch((error) => {
      errors.push({ productId: candidate.productId, ...serializeError(error) });
      return null;
    });

    if (result?.reviews?.length) {
      return {
        productId: candidate.productId,
        reviews: result.reviews,
        totalReviews: result.totalReviews,
        matchConfidence: candidate.matchConfidence,
        errors,
      };
    }
  }

  return {
    productId: null,
    reviews: [],
    totalReviews: 0,
    matchConfidence: 0,
    errors,
  };
}

async function fetchLooxDiagnosisData({ shop, jobId, snapshot, shopifyProduct, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS }) {
  const source = await prisma.productPulseSource.findUnique({
    where: { shop_sourceKey: { shop, sourceKey: "looxReviews" } },
  }).catch(() => null);

  const publicStoreId = String(source?.credentials?.publicStoreId || "").trim();
  const apiSecret = String(source?.credentials?.apiSecret || "").trim();
  if (!source?.connected || !source.active || !publicStoreId || !apiSecret) {
    await recordJobLog({
      shop,
      jobId,
      event: "product_diagnosis.loox_skipped",
      message: "Loox Reviews is not connected or active; diagnosis will continue without Loox review evidence.",
      data: { connected: Boolean(source?.connected), active: Boolean(source?.active), hasPublicStoreId: Boolean(publicStoreId) },
    });
    return { connected: false, reviews: [], matchConfidence: 0, errors: [] };
  }

  const errors = [];
  const productLookup = await fetchLooxProductReviewsForDiagnosis({ publicStoreId, apiSecret, snapshot, shopifyProduct });
  const productMatched = productLookup.reviews.map((review) => ({
    review: attachLooxProductIdentifiers(review, productLookup.productId),
    confidence: productLookup.matchConfidence,
  }));
  const fetched = !productMatched.length
    ? await fetchLooxReviewPages({
      publicStoreId,
      apiSecret,
      maxPages: MAX_LOOX_SYNC_PAGES,
    }).catch((error) => {
      errors.push(serializeError(error));
      return { reviews: [] };
    })
    : { reviews: [] };

  const matched = productMatched.length
    ? productMatched
    : (fetched.reviews || [])
      .map((review) => ({
        review,
        confidence: getLooxReviewMatchConfidence(review, snapshot, shopifyProduct),
      }))
      .filter((item) => item.confidence >= 0.75);
  const allMatchedReviews = matched
    .map((item) => normalizeLooxReview(item.review, snapshot, shopifyProduct, item.confidence))
    .filter(Boolean);
  const reviews = filterReviewsByLookbackWindow(allMatchedReviews, windowDays);
  const matchConfidence = matched.length ? Math.max(...matched.map((item) => item.confidence)) : 0;

  if (reviews.length) {
    await prisma.productPulseSource.update({
      where: { shop_sourceKey: { shop, sourceKey: "looxReviews" } },
      data: {
        health: "connected",
        lastSyncedAt: new Date(),
      },
    }).catch(() => {});
  } else if (errors.length || productLookup.errors.length) {
    await prisma.productPulseSource.update({
      where: { shop_sourceKey: { shop, sourceKey: "looxReviews" } },
      data: { health: "error" },
    }).catch(() => {});
  }

  await recordJobLog({
    shop,
    jobId,
    level: (errors.length || productLookup.errors.length) && !reviews.length ? "warn" : "info",
    event: "product_diagnosis.loox_extracted",
    message: "Loox Reviews extraction finished for this product.",
    data: {
      fetchedReviews: fetched.reviews?.length || 0,
      matchedReviews: reviews.length,
      ignoredOutsideWindow: Math.max(0, allMatchedReviews.length - reviews.length),
      windowDays,
      matchConfidence,
      productLookupProductId: productLookup.productId,
      productLookupReviews: productLookup.reviews.length,
      productLookupErrors: productLookup.errors,
      errors,
    },
  });

  return {
    connected: true,
    reviews,
    matchConfidence,
    errors: [...productLookup.errors, ...errors],
  };
}

async function fetchLooxProductReviewsForDiagnosis({ publicStoreId, apiSecret, snapshot, shopifyProduct }) {
  const errors = [];
  const candidates = buildLooxProductReviewIdCandidates(snapshot, shopifyProduct);

  for (const candidate of candidates) {
    const merchantResult = await fetchLooxReviewPages({
      publicStoreId,
      apiSecret,
      productId: candidate.productId,
      maxPages: MAX_LOOX_PRODUCT_REVIEW_PAGES,
    }).catch((error) => {
      errors.push({ productId: candidate.productId, api: "merchant", ...serializeError(error) });
      return null;
    });

    if (merchantResult?.reviews?.length) {
      return {
        productId: candidate.productId,
        reviews: merchantResult.reviews,
        totalReviews: merchantResult.totalReviews,
        matchConfidence: candidate.matchConfidence,
        errors,
      };
    }

    const storefrontResult = await fetchLooxProductReviewPages({
      publicStoreId,
      productId: candidate.productId,
      maxPages: MAX_LOOX_PRODUCT_REVIEW_PAGES,
    }).catch((error) => {
      errors.push({ productId: candidate.productId, api: "storefront", ...serializeError(error) });
      return null;
    });

    if (storefrontResult?.reviews?.length) {
      return {
        productId: candidate.productId,
        reviews: storefrontResult.reviews,
        totalReviews: storefrontResult.totalReviews,
        matchConfidence: candidate.matchConfidence,
        errors,
      };
    }
  }

  return {
    productId: null,
    reviews: [],
    totalReviews: 0,
    matchConfidence: 0,
    errors,
  };
}

async function fetchCsvReviewDiagnosisData({ shop, jobId, snapshot, shopifyProduct, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS }) {
  const source = await prisma.productPulseSource.findUnique({
    where: { shop_sourceKey: { shop, sourceKey: "csvReviews" } },
  }).catch(() => null);

  if (!source?.connected || !source.active || !source.config?.normalizedFilePath) {
    await recordJobLog({
      shop,
      jobId,
      event: "product_diagnosis.csv_reviews_skipped",
      message: "CSV reviews are not connected or active; diagnosis will continue without imported review evidence.",
      data: { connected: Boolean(source?.connected), active: Boolean(source?.active) },
    });
    return { connected: false, reviews: [], matchConfidence: 0, errors: [] };
  }

  const errors = [];
  const rows = await getNormalizedCsvReviewsForShop(shop).catch((error) => {
    errors.push(serializeError(error));
    return [];
  });
  const matched = rows
    .map((row) => ({
      row,
      confidence: getCsvReviewMatchConfidence(row, snapshot, shopifyProduct),
    }))
    .filter((item) => item.confidence >= 0.75);
  const allMatchedReviews = matched
    .map((item) => normalizeCsvDiagnosisReview(item.row, snapshot, shopifyProduct, item.confidence))
    .filter(Boolean);
  const reviews = filterReviewsByLookbackWindow(allMatchedReviews, windowDays);
  const matchConfidence = matched.length ? Math.max(...matched.map((item) => item.confidence)) : 0;

  if (reviews.length) {
    await prisma.productPulseSource.update({
      where: { shop_sourceKey: { shop, sourceKey: "csvReviews" } },
      data: { health: "connected", lastSyncedAt: new Date() },
    }).catch(() => {});
  } else if (errors.length) {
    await prisma.productPulseSource.update({
      where: { shop_sourceKey: { shop, sourceKey: "csvReviews" } },
      data: { health: "error" },
    }).catch(() => {});
  }

  await recordJobLog({
    shop,
    jobId,
    level: errors.length && !reviews.length ? "warn" : "info",
    event: "product_diagnosis.csv_reviews_extracted",
    message: "CSV review extraction finished for this product.",
    data: {
      rows: rows.length,
      matchedReviews: reviews.length,
      ignoredOutsideWindow: Math.max(0, allMatchedReviews.length - reviews.length),
      windowDays,
      matchConfidence,
      usage: "ratings, text and dates are included as imported review evidence",
      errors,
    },
  });

  return {
    connected: true,
    reviews,
    matchConfidence,
    errors,
  };
}

async function resolveJudgeMeProduct({ shop, token, snapshot, shopifyProduct }) {
  const numericProductId = shopifyProduct.numericId || extractNumericShopifyId(snapshot.productGid);
  const attempts = [
    numericProductId ? { external_id: numericProductId } : null,
    snapshot.handle ? { handle: snapshot.handle } : null,
    shopifyProduct.handle && shopifyProduct.handle !== snapshot.handle ? { handle: shopifyProduct.handle } : null,
  ].filter(Boolean);

  for (const params of attempts) {
    for (const baseUrl of JUDGEME_BASE_URLS) {
      const json = await judgeMeGet({ baseUrl, path: "/products/-1", shop, token, params }).catch(() => null);
      const product = extractJudgeMeProduct(json);
      if (product?.id) {
        return {
          id: product.id,
          raw: product,
          matchConfidence: params.external_id ? 1 : 0.85,
        };
      }
    }
  }

  return null;
}

async function fetchJudgeMeReviewsByProductId({ shop, token, productId }) {
  const reviews = [];

  for (let page = 1; page <= MAX_JUDGEME_REVIEW_PAGES; page += 1) {
    let pageReviews = [];
    for (const baseUrl of JUDGEME_BASE_URLS) {
      const json = await judgeMeGet({
        baseUrl,
        path: "/reviews",
        shop,
        token,
        params: { product_id: productId, published: true, page, per_page: 100 },
      }).catch(() => null);
      pageReviews = extractJudgeMeReviews(json);
      if (pageReviews.length) break;
    }
    reviews.push(...pageReviews);
    if (pageReviews.length < 100) break;
  }

  return reviews;
}

async function fetchAndMatchJudgeMeReviews({ shop, token, snapshot, shopifyProduct }) {
  const allReviews = [];

  for (let page = 1; page <= MAX_JUDGEME_SYNC_PAGES; page += 1) {
    let pageReviews = [];
    for (const baseUrl of JUDGEME_BASE_URLS) {
      const json = await judgeMeGet({
        baseUrl,
        path: "/reviews",
        shop,
        token,
        params: { published: true, page, per_page: 100 },
      }).catch(() => null);
      pageReviews = extractJudgeMeReviews(json);
      if (pageReviews.length) break;
    }
    allReviews.push(...pageReviews);
    if (pageReviews.length < 100) break;
  }

  const matched = allReviews
    .map((review) => ({ review, confidence: getJudgeMeReviewMatchConfidence(review, snapshot, shopifyProduct) }))
    .filter((item) => item.confidence >= 0.75);

  return {
    reviews: matched.map((item) => item.review),
    matchConfidence: matched.length ? Math.max(...matched.map((item) => item.confidence)) : 0,
  };
}

function calculateDeterministicDiagnosis({
  snapshot,
  shopifyData,
  judgeMeData,
  yotpoData = { connected: false, reviews: [], matchConfidence: 0 },
  looxData = { connected: false, reviews: [], matchConfidence: 0 },
  csvReviewData = { connected: false, reviews: [], matchConfidence: 0 },
  windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS,
  momentumCatalogBaseline = null,
  taxonomyCategorySuggestions = [],
  storedReconstructedRiskHistory = [],
}) {
  const snapshotMetrics = snapshot.metrics || {};
  const previousIncrementalCache = snapshotMetrics.incrementalDiagnosis?.cache || {};
  const previousDetailedDiagnosisAt = snapshotMetrics.lastDetailedDiagnosisAt || snapshotMetrics.latestDiagnosisAt || null;
  const product = shopifyData.product;
  const sales = shopifyData.sales || [];
  const relationshipSales = Array.isArray(shopifyData.relationshipSales) && shopifyData.relationshipSales.length
    ? shopifyData.relationshipSales
    : sales;
  const refunds = shopifyData.refunds || [];
  const returns = shopifyData.returns || [];
  const judgeMeReviews = (judgeMeData.reviews || []).map((review) => normalizeReviewSource(review, "judgeme_review", "Judge.me reviews"));
  const yotpoReviews = (yotpoData.reviews || []).map((review) => normalizeReviewSource(review, "yotpo_review", "Yotpo reviews"));
  const looxReviews = (looxData.reviews || []).map((review) => normalizeReviewSource(review, "loox_review", "Loox reviews"));
  const csvReviews = (csvReviewData.reviews || []).map((review) => normalizeReviewSource(review, "csv_review", "CSV reviews"));
  const reviews = [...judgeMeReviews, ...yotpoReviews, ...looxReviews, ...csvReviews];
  const sourceFetchComplete = getDiagnosisSourceFetchCompleteness(shopifyData);
  const rawSoldUnits = preferFreshNumber(sumBy(sales, "quantity"), snapshotMetrics.soldUnits, { fallbackWhenZero: !sourceFetchComplete.sales });
  const salesAmount = roundCurrency(preferFreshNumber(sumBy(sales, "amount"), snapshotMetrics.salesAmount, { fallbackWhenZero: !sourceFetchComplete.sales }));
  const returnUnits = preferFreshNumber(sumBy(returns, "quantity"), snapshotMetrics.returnUnits, { fallbackWhenZero: !sourceFetchComplete.returns });
  const refundUnits = preferFreshNumber(sumBy(refunds, "quantity"), snapshotMetrics.refundUnits, { fallbackWhenZero: !sourceFetchComplete.refunds });
  const refundAmount = roundCurrency(preferFreshNumber(sumBy(refunds, "amount"), snapshotMetrics.refundAmount, { fallbackWhenZero: !sourceFetchComplete.refunds }));
  const monthlyOrderActivity = buildMonthlyOrderActivity({ sales, returns, refunds, windowDays });
  const orderGeography = buildOrderGeographyRows(sales);
  const monthlyOrderUnits = Number(monthlyOrderActivity?.summary?.totalOrderUnits || 0);
  const soldUnits = Math.max(rawSoldUnits, monthlyOrderUnits, returnUnits, refundUnits);
  const returnRate = calculateUnitRatePercent(returnUnits, soldUnits, snapshotMetrics.returnRate);
  const refundRate = calculateUnitRatePercent(refundUnits, soldUnits, snapshotMetrics.refundRate);
  const reviewCount = reviews.length;
  const avgRating = roundRate(reviewCount ? reviews.reduce((total, review) => total + Number(review.rating || 0), 0) / reviewCount : 0, 1);
  const negativeReviews = reviews.filter(isNegativeReviewSignal);
  const negativeReviewCount = negativeReviews.length;
  const negativeReviewRate = roundRate(reviewCount ? (negativeReviewCount / reviewCount) * 100 : 0);
  const recentNegativeReviewCount = negativeReviews.filter((review) => isRecentDate(review.createdAt, 30)).length;
  const topReturnReasons = buildTopReturnReasonDetails(returns, 4);
  const topRefundReasons = countTopValues(refunds
    .map(getRefundReasonText)
    .filter((value) => value && !isDefaultCustomerLanguageTerm(value)), 4);
  const variantInsights = buildDiagnosisVariantInsights({ product, sales, returns, refunds, reviews });
  const affectedVariants = buildAffectedVariantDetailsFromInsights(variantInsights)
    || countTopValues([...returns, ...refunds].map((item) => item.variantTitle || item.sku).filter(Boolean), 4);
  const productContentState = resolveProductContentAnalysisState({
    product,
    previousCache: previousIncrementalCache.productContent,
    cutoffAt: previousDetailedDiagnosisAt,
  });
  const deterministicContent = productContentState.deterministicContent;
  const customerTextState = buildIncrementalCustomerTextInsights({
    returns,
    reviews,
    previousCache: previousIncrementalCache.customerText,
    cutoffAt: previousDetailedDiagnosisAt,
    windowDays,
  });
  const textInsights = customerTextState.textInsights;
  const refundTextState = buildIncrementalRefundOperationalInsights({
    refunds,
    refundRate,
    soldUnits,
    refundUnits,
    refundAmount,
    previousCache: previousIncrementalCache.refunds,
    cutoffAt: previousDetailedDiagnosisAt,
    windowDays,
  });
  const refundInsights = refundTextState.refundInsights;
  const returnRatePrediction = buildReturnRatePrediction({ sales, returns, refunds, windowDays });
  const returnRefundRelationshipSummary = buildReturnRefundRelationshipSummary({
    shop: snapshot.shop,
    productId: product.id || snapshot.productGid,
    products: [product],
    sales,
    returns,
    refunds,
  });
  const productPurchaseContextSummary = buildProductPurchaseContextSummary({
    shop: snapshot.shop,
    productId: product.id || snapshot.productGid,
    products: [product],
    sales,
    returns,
    refunds,
    assumeCompleteOrderEvents: false,
  });
  const productRelationshipIntelligenceSummary = buildProductRelationshipSummary({
    shop: snapshot.shop,
    productId: product.id || snapshot.productGid,
    products: [product],
    sales: relationshipSales,
    returns,
    refunds,
    windowDays,
    assumeCompleteOrderEvents: false,
  });
  const productMomentum = buildProductMomentum({ product, sales, windowDays, catalogBaseline: momentumCatalogBaseline });
  const reviewSourceStats = buildReviewSourceStats(reviews);
  const sourceCoverage = buildSourceCoverage({ shopifyData, judgeMeData, yotpoData, looxData, csvReviewData, soldUnits, returnUnits, refundUnits, reviewCount });
  const sourceFingerprint = buildDiagnosisSourceFingerprint({
    productContentSignature: productContentState.signature,
    sales,
    returns,
    refunds,
    judgeMeReviews,
    yotpoReviews,
    looxReviews,
    csvReviews,
    orderAccessDenied: shopifyData.orderAccessDenied,
    sourceCoverage,
    windowDays,
  });
  const previousSourceFingerprint = previousIncrementalCache.sourceFingerprint || null;
  const sourceEventFetch = buildIncrementalSourceFetchSummary(shopifyData.incrementalSource);
  const sourceExtractionComplete = sourceEventFetch.fetchComplete !== false;
  const sourceChanges = {
    mode: previousSourceFingerprint ? "compared" : "baseline_missing",
    previousFingerprint: previousSourceFingerprint,
    currentFingerprint: sourceFingerprint,
    unchanged: Boolean(previousSourceFingerprint && previousSourceFingerprint === sourceFingerprint),
    reason: previousSourceFingerprint
      ? previousSourceFingerprint === sourceFingerprint
        ? "all_source_fingerprints_match_previous_diagnosis"
        : "source_fingerprint_changed_since_previous_diagnosis"
      : "previous_source_fingerprint_missing",
    sourceExtractionComplete,
    sourceEventFetch,
    sourceFetchComplete,
  };
  const signalEvents = buildSignalEvents({ returns, refunds, negativeReviews });
  const analysisNow = new Date();
  const signalWeighting = buildTemporalSignalWeighting({ signalEvents, sales, now: analysisNow });
  const weightedSignalEvents = signalWeighting.events;
  const effectiveReturnUnits = signalWeighting.byType.return.effectiveValue;
  const effectiveRefundUnits = signalWeighting.byType.refund.effectiveValue;
  const effectiveRefundAmount = roundCurrency(signalWeighting.byType.refund.effectiveAmount || refundAmount);
  const effectiveNegativeReviewCount = signalWeighting.byType.review.effectiveValue;
  const effectiveReturnRate = calculateUnitRatePercent(effectiveReturnUnits, soldUnits, returnRate);
  const effectiveRefundRate = calculateUnitRatePercent(effectiveRefundUnits, soldUnits, refundRate);
  const effectiveNegativeReviewRate = roundRate(reviewCount ? (effectiveNegativeReviewCount / reviewCount) * 100 : 0);
  const effectiveRecentSignalUnits = countWeightedRecentSignalEvents(weightedSignalEvents, 30, analysisNow);
  const effectiveRecentNegativeReviewCount = countWeightedRecentSignalEvents(weightedSignalEvents, 30, analysisNow, "review");
  const analysisTextInsights = applyTemporalWeightingToTextInsights(textInsights, signalWeighting);
  const analysisRefundInsights = applyTemporalWeightingToRefundInsights(refundInsights, {
    effectiveRefundUnits,
    effectiveRefundRate,
    effectiveRefundAmount,
  });
  const analysisReviewSourceStats = applyTemporalWeightingToReviewSourceStats(reviewSourceStats, signalWeighting);
  const trendOptions = {
    startAt: getSinceDate(windowDays),
    endAt: analysisNow.toISOString(),
  };
  const weightedTrendEvents = weightedSignalEvents.map((event) => ({
    ...event,
    value: Number(event.weightedValue || 0),
  }));
  const signalTrendResult = buildDatedSignalTrend(weightedTrendEvents, trendOptions);
  const signalTrend = signalTrendResult.values;
  const issueSignalTrends = buildIssueTrendMap(weightedTrendEvents, trendOptions);
  const rawIssueSignalCounts = buildIssueSignalCountsFromAnalysis({
    customerTextCache: customerTextState.cache,
    refundTextCache: refundTextState.cache,
    fallback: { returns, refunds, reviews: negativeReviews },
  });
  applyRefundInsightsToIssueCounts(rawIssueSignalCounts, refundInsights);
  const issueSignalCounts = mergeWeightedIssueSignalCounts(
    buildWeightedIssueSignalCounts(weightedSignalEvents),
    rawIssueSignalCounts,
    signalWeighting.averageWeight,
  );
  const rawCustomerIssueSignalTotal = Object.values(rawIssueSignalCounts).reduce((total, count) => total + count, 0);
  const weightedCustomerIssueSignalTotal = Object.values(issueSignalCounts).reduce((total, count) => total + Number(count || 0), 0);
  deterministicContent.issues.forEach((issue) => {
    issueSignalCounts[issue.issueCode] = (issueSignalCounts[issue.issueCode] || 0) + 1;
  });
  const mainIssue = getMainIssueFromCounts(issueSignalCounts, snapshot.primaryIssue);
  const faqNeed = analyzeFaqOpportunity({
    mainIssue,
    issueSignalCounts,
    product,
    contentAnalysis: deterministicContent,
    textInsights: analysisTextInsights,
    topReturnReasons,
    affectedVariants,
    reviewCount,
    negativeReviewCount: effectiveNegativeReviewCount,
    returnUnits: effectiveReturnUnits,
    refundUnits: effectiveRefundUnits,
  });
  const customerSignalCount = Math.max(
    effectiveReturnUnits + effectiveRefundUnits + effectiveNegativeReviewCount,
    weightedCustomerIssueSignalTotal,
  );
  const signalCount = customerSignalCount + deterministicContent.issues.length;
  const scoringMetrics = {
    soldUnits,
    salesAmount,
    returnUnits: effectiveReturnUnits,
    refundUnits: effectiveRefundUnits,
    refundAmount: effectiveRefundAmount,
    returnRate: effectiveReturnRate,
    refundRate: effectiveRefundRate,
    reviewCount,
    avgRating,
    negativeReviewCount: effectiveNegativeReviewCount,
    negativeReviewRate: effectiveNegativeReviewRate,
    recentNegativeReviewCount: effectiveRecentNegativeReviewCount,
    signalCount,
    customerSignalCount,
    contentIssueCount: deterministicContent.issues.length,
    contentQualityRisk: deterministicContent.riskLift,
    textInsights: analysisTextInsights,
    refundInsights: analysisRefundInsights,
    sourceCoverage,
    signalEvents: weightedTrendEvents,
    signalTrend,
    signalRecencyWeighting: signalWeighting.summary,
    affectedVariants,
    reviewSourceStats: analysisReviewSourceStats,
  };
  const sourceAgreement = hasSourceAgreement({
    returnUnits: effectiveReturnUnits,
    refundUnits: effectiveRefundUnits,
    negativeReviewCount: effectiveNegativeReviewCount,
    reviewSourceStats: analysisReviewSourceStats,
  });
  const scoreSentiment = getScoreSentimentInputs(analysisTextInsights, analysisRefundInsights);
  const scoreModel = calculateProductScoreModel({
    ...scoringMetrics,
    salesAmount,
    storeReturnBaseline: snapshotMetrics.storeAvgReturnRate,
    storeRefundBaseline: snapshotMetrics.storeAvgRefundRate,
    storeNegativeReviewBaseline: snapshotMetrics.storeAvgNegativeReviewRate,
    sentimentTotal: scoreSentiment.total,
    sentimentNegativeCount: scoreSentiment.negative,
    subjectiveNegativeCount: analysisTextInsights?.subjectiveNegativity?.count || 0,
    subjectiveNegativeRatio: analysisTextInsights?.subjectiveNegativity?.ratio || 0,
    variantCount: product.variants?.length || Number(snapshotMetrics.variantCount || 0),
    affectedVariantCount: affectedVariants.length,
    affectedVariantSignalCount: affectedVariants.reduce((sum, variant) => sum + Number(variant.count || 0), 0),
    strongestVariantSignalCount: affectedVariants[0]?.count || 0,
    recentSignalUnits: effectiveRecentSignalUnits,
    signalEventCount: customerSignalCount,
    effectiveSampleSize: effectiveReturnUnits + effectiveRefundUnits + reviewCount + deterministicContent.issues.length,
    sourceCoverage,
    sourceAgreement,
    productMatchConfidence: Math.max(judgeMeData.matchConfidence || 0, yotpoData.matchConfidence || 0, looxData.matchConfidence || 0, csvReviewData.matchConfidence || 0, reviews.length ? 0 : 1),
    orderAccessDenied: shopifyData.orderAccessDenied,
    missingOrders: shopifyData.orderAccessDenied || sourceFetchComplete.sales === false,
    missingReturns: sourceFetchComplete.returns === false,
    missingRefunds: sourceFetchComplete.refunds === false,
    dataQualityIncomplete: shopifyData.orderAccessDenied || sourceExtractionComplete === false,
    subjectiveOnlyIssue: mainIssue === "subjective_negative_reaction" && !effectiveReturnUnits && !effectiveRefundUnits && effectiveNegativeReviewCount <= 2,
    calculationState: "calculated_from_persisted_components",
    windowDays,
    returnRefundRelationshipSummary,
    productPurchaseContextSummary,
    productRelationshipIntelligenceSummary,
  }, { sentimentSharesReviewSource: !(effectiveReturnUnits || effectiveRefundUnits) });
  const riskComponents = scoreModel.riskComponents;
  const riskScore = scoreModel.riskScore;
  const confidence = scoreModel.confidenceScore;
  const estimatedImpact = scoreModel.impactFactors;
  const riskTrend = buildRiskTrendFromSignalTrend(signalTrend, riskScore, snapshotMetrics.riskTrend);
  const reconstructedRiskHistory = buildReconstructedRiskHistory({
    snapshot,
    shopifyData,
    judgeMeData,
    yotpoData,
    looxData,
    csvReviewData,
    product,
    sales,
    returns,
    refunds,
    reviews,
    deterministicContent,
    windowDays,
    storedReconstructedRiskHistory,
    momentumCatalogBaseline,
    currentRiskScore: riskScore,
    currentConfidence: confidence,
    currentImpactFactors: estimatedImpact,
    currentMainIssue: mainIssue,
  });
  const evidenceSnippetInputs = buildIncrementalEvidenceSnippetInputs({
    returns,
    refunds,
    negativeReviews,
    productContentState,
    customerTextState,
    refundTextState,
  });
  const evidenceSnippets = buildEvidenceSnippets({
    returns: evidenceSnippetInputs.returns,
    refunds: evidenceSnippetInputs.refunds,
    reviews: evidenceSnippetInputs.reviews,
    product,
  });
  const productImage = getNormalizedProductImage(product, snapshotMetrics);

  return {
    product,
    metrics: {
      imageUrl: productImage.imageUrl,
      productImageUrl: productImage.imageUrl,
      featuredImageUrl: productImage.imageUrl,
      imageAlt: productImage.imageAlt,
      productImageAlt: productImage.imageAlt,
      featuredImageAlt: productImage.imageAlt,
      returnRate: effectiveReturnRate,
      refundRate: effectiveRefundRate,
      rawReturnRate: returnRate,
      rawRefundRate: refundRate,
      reviewRating: avgRating,
      avgRating,
      issueCount: signalCount,
      customerSignalCount,
      rawCustomerSignalCount: Math.max(
        returnUnits + refundUnits + negativeReviewCount,
        rawCustomerIssueSignalTotal,
      ),
      contentIssueCount: deterministicContent.issues.length,
      contentAdvisoryCount: deterministicContent.advisories.length,
      contentQualityScore: deterministicContent.score,
      contentQualityRisk: deterministicContent.riskLift,
      riskComponents,
      confidenceFactors: scoreModel.confidenceFactors,
      contentIssues: deterministicContent.issues,
      contentAdvisories: deterministicContent.advisories,
      faqNeed,
      textInsights: analysisTextInsights,
      rawTextInsights: textInsights,
      descriptionLength: deterministicContent.descriptionLength,
      descriptionWordCount: deterministicContent.descriptionWordCount,
      hasDescription: deterministicContent.hasDescription,
      titleNeedsReview: deterministicContent.titleNeedsReview,
      seoTitleNeedsReview: deterministicContent.seoTitleNeedsReview,
      metaDescriptionNeedsReview: deterministicContent.metaDescriptionNeedsReview,
      handleNeedsReview: deterministicContent.handleNeedsReview,
      specsBlockRecommended: deterministicContent.specsBlockRecommended,
      classificationNeedsReview: deterministicContent.classificationNeedsReview,
      templateNeedsReview: deterministicContent.templateNeedsReview,
      variantNamingAdvisory: deterministicContent.variantNamingAdvisory,
      mediaCount: deterministicContent.mediaCount,
      mediaWithoutAltCount: deterministicContent.mediaWithoutAltCount,
      revenueAtRisk: estimatedImpact.revenueAtRisk,
      marginAtRisk: estimatedImpact.marginAtRisk,
      estimatedImpact: estimatedImpact.estimatedImpact,
      impactRange: {
        low: estimatedImpact.impactLow,
        mid: estimatedImpact.impactMid,
        high: estimatedImpact.impactHigh,
      },
      impactFactors: estimatedImpact,
      priorityScore: scoreModel.priorityScore,
      evidenceStrengthScore: scoreModel.evidenceStrengthScore,
      scoreCalculationStatus: "Score calculated from persisted components",
      signalCount,
      rawSignalCount: Math.max(
        returnUnits + refundUnits + negativeReviewCount,
        rawCustomerIssueSignalTotal,
      ) + deterministicContent.issues.length,
      salesAmount,
      avgUnitRevenue: estimatedImpact.avgUnitRevenue,
      refundAmount: effectiveRefundAmount,
      rawRefundAmount: refundAmount,
      refundInsights: analysisRefundInsights,
      rawRefundInsights: refundInsights,
      returnRefundRelationshipSummary,
      productPurchaseContextSummary,
      productRelationshipIntelligenceSummary,
      productPurchaseContextFactors: scoreModel.purchaseContextFactors,
      productPurchaseContextScoringImpact: scoreModel.purchaseContextExplanations,
      purchaseContextSignalBreakdown: scoreModel.purchaseContextFactors.customerSignalBreakdown,
      productRelationshipFactors: scoreModel.productRelationshipFactors,
      productRelationshipScoringImpact: scoreModel.productRelationshipExplanations,
      returnRefundRelationshipFactors: scoreModel.relationshipFactors,
      returnRefundScoringImpact: scoreModel.relationshipExplanations,
      returnPressure: scoreModel.relationshipFactors.returnPressure,
      refundLeakage: scoreModel.relationshipFactors.refundLeakage,
      customerSignalBreakdown: scoreModel.relationshipFactors.customerSignalBreakdown,
      financialExposureBreakdown: scoreModel.relationshipFactors.financialExposure,
      scoringVersion: scoreModel.scoringVersion,
      monthlyOrderActivity,
      orderGeography,
      returnRatePrediction,
      productMomentum,
      productMomentumScore: productMomentum.score,
      productMomentumTier: productMomentum.tier,
      momentumDirection: productMomentum.direction,
      momentumConfidence: productMomentum.confidence,
      momentumConfidenceLabel: productMomentum.confidenceLabel,
      returnUnits: effectiveReturnUnits,
      refundUnits: effectiveRefundUnits,
      rawReturnUnits: returnUnits,
      rawRefundUnits: refundUnits,
      soldUnits,
      recentSignalUnits: effectiveRecentSignalUnits,
      rawRecentSignalUnits: countRecentSignalEvents(signalEvents, 30),
      signalRecencyWeighting: signalWeighting.summary,
      windowDays,
      storeAvgReturnRate: Number(snapshotMetrics.storeAvgReturnRate || 0),
      storeAvgRefundRate: Number(snapshotMetrics.storeAvgRefundRate || 0),
      lastSignalAt: getLatestEventDate(signalEvents),
      signalTrend,
      riskTrend,
      riskHistory: reconstructedRiskHistory,
      reconstructedRiskHistory,
      trendMeta: signalTrendResult.meta,
      issueSignalTrends,
      handle: product.handle || snapshot.handle,
      productType: product.productType || snapshotMetrics.productType || "",
      vendor: product.vendor || snapshotMetrics.vendor || "",
      category: normalizeProductCategory(product.category || snapshotMetrics.category),
      categoryId: normalizeProductCategory(product.category || snapshotMetrics.category).id,
      categoryName: normalizeProductCategory(product.category || snapshotMetrics.category).name,
      categoryFullName: normalizeProductCategory(product.category || snapshotMetrics.category).fullName,
      catalogProductTypes: Array.isArray(momentumCatalogBaseline?.productTypes) ? momentumCatalogBaseline.productTypes : [],
      catalogVendors: Array.isArray(momentumCatalogBaseline?.vendors) ? momentumCatalogBaseline.vendors : [],
      taxonomyCategorySuggestions: (Array.isArray(taxonomyCategorySuggestions) ? taxonomyCategorySuggestions : []).slice(0, 8),
      seoTitle: product.seoTitle || snapshotMetrics.seoTitle || "",
      seoDescription: product.seoDescription || snapshotMetrics.seoDescription || "",
      templateSuffix: product.templateSuffix || snapshotMetrics.templateSuffix || "",
      tags: product.tags || [],
      collections: product.collections || [],
      collectionRecords: product.collectionRecords || [],
      relationshipCollectionSuggestions: [],
      variantCount: product.variants?.length || Number(snapshotMetrics.variantCount || 0),
      skuCount: (product.variants || []).filter((variant) => variant.sku).length,
      optionNames: (product.options || []).map((option) => option.name).filter(Boolean),
      variants: (product.variants || []).map((variant) => ({
        id: variant.id,
        title: variant.title,
        sku: variant.sku,
        price: variant.price,
        compareAtPrice: variant.compareAtPrice,
        inventoryQuantity: variant.inventoryQuantity,
        inventoryPolicy: variant.inventoryPolicy,
        inventoryItemId: variant.inventoryItemId,
        inventoryTracked: variant.inventoryTracked,
        selectedOptions: variant.selectedOptions,
      })),
      media: (product.media || []).map((media) => ({
        id: media.id,
        alt: media.alt,
        mediaContentType: media.mediaContentType,
        status: media.status,
        url: media.url,
        width: media.width,
        height: media.height,
      })),
      topReturnReasons: topReturnReasons.map((item) => item.label),
      topReturnReasonDetails: topReturnReasons,
      topRefundReasons: topRefundReasons.map((item) => item.label),
      topRefundReasonDetails: topRefundReasons,
      affectedVariants: affectedVariants.map((item) => item.label),
      affectedVariantDetails: affectedVariants,
      variantInsights,
      reviewCount,
      negativeReviewCount: effectiveNegativeReviewCount,
      rawNegativeReviewCount: negativeReviewCount,
      negativeReviewRate: effectiveNegativeReviewRate,
      rawNegativeReviewRate: negativeReviewRate,
      recentNegativeReviewCount: effectiveRecentNegativeReviewCount,
      rawRecentNegativeReviewCount: recentNegativeReviewCount,
      recentNegativeReviewWindowDays: 30,
      judgeMeReviewCount: analysisReviewSourceStats.judgeMe.reviewCount,
      judgeMeNegativeReviewCount: analysisReviewSourceStats.judgeMe.negativeReviewCount,
      judgeMeAverageRating: analysisReviewSourceStats.judgeMe.avgRating,
      yotpoReviewCount: analysisReviewSourceStats.yotpo.reviewCount,
      yotpoNegativeReviewCount: analysisReviewSourceStats.yotpo.negativeReviewCount,
      yotpoAverageRating: analysisReviewSourceStats.yotpo.avgRating,
      looxReviewCount: analysisReviewSourceStats.loox.reviewCount,
      looxNegativeReviewCount: analysisReviewSourceStats.loox.negativeReviewCount,
      looxAverageRating: analysisReviewSourceStats.loox.avgRating,
      csvReviewCount: analysisReviewSourceStats.csv.reviewCount,
      csvNegativeReviewCount: analysisReviewSourceStats.csv.negativeReviewCount,
      csvAverageRating: analysisReviewSourceStats.csv.avgRating,
      reviewSourceStats: analysisReviewSourceStats,
      rawReviewSourceStats: reviewSourceStats,
      judgeMeInternalProductId: judgeMeData.internalProductId,
      judgeMeMatchConfidence: judgeMeData.matchConfidence,
      yotpoReviewMatchConfidence: yotpoData.matchConfidence,
      looxReviewMatchConfidence: looxData.matchConfidence,
      csvReviewMatchConfidence: csvReviewData.matchConfidence,
      orderAccessDenied: shopifyData.orderAccessDenied,
      sourceCoverage,
      incrementalDiagnosis: {
        schemaVersion: 1,
        mode: getOverallIncrementalMode({ productContentState, customerTextState, refundTextState, previousDetailedDiagnosisAt }),
        previousCompletedAt: toIso(previousDetailedDiagnosisAt),
        cutoffAt: toIso(previousDetailedDiagnosisAt),
        productContent: {
          mode: productContentState.reused ? "reused" : "analyzed",
          reused: productContentState.reused,
          changed: productContentState.changed,
          signature: productContentState.signature,
          productUpdatedAt: productContentState.productUpdatedAt,
          reason: productContentState.reason,
          canReuseContentGaps: productContentState.reused && Boolean(productContentState.cachedContentGaps),
        },
        customerText: {
          mode: customerTextState.mode,
          analyzedItems: customerTextState.analyzedItems,
          reusedItems: customerTextState.reusedItems,
          totalItems: (customerTextState.cache.returnItems || []).length + (customerTextState.cache.reviewItems || []).length,
          reason: customerTextState.reason,
        },
        refunds: {
          mode: refundTextState.mode,
          analyzedItems: refundTextState.analyzedItems,
          reusedItems: refundTextState.reusedItems,
          totalItems: (refundTextState.cache.items || []).length,
          reason: refundTextState.reason,
        },
        sourceEvents: sourceEventFetch,
        sourceChanges,
        aiEvidenceSnippetCount: evidenceSnippets.length,
        cache: {
          sourceFingerprint,
          sourceEvents: buildSourceEventCache({ sales, refunds, returns, windowDays, sourceEventFetch }),
          productContent: {
            signature: productContentState.signature,
            productUpdatedAt: productContentState.productUpdatedAt,
            deterministicContent: productContentState.deterministicContent,
            contentGaps: productContentState.cachedContentGaps || null,
          },
          customerText: customerTextState.cache,
          refunds: refundTextState.cache,
        },
      },
    },
    issueSignalCounts,
    evidenceSnippets,
    sourceCoverage,
    mainIssue,
    mainIssueLabel: getHumanIssueLabel(mainIssue),
    riskScore,
    confidence,
    estimatedImpact,
    sourceAgreement: hasSourceAgreement({
      returnUnits: effectiveReturnUnits,
      refundUnits: effectiveRefundUnits,
      negativeReviewCount: effectiveNegativeReviewCount,
      reviewSourceStats: analysisReviewSourceStats,
    }),
  };
}

function buildReconstructedRiskHistory({
  snapshot,
  shopifyData,
  judgeMeData,
  yotpoData = { connected: false, reviews: [], matchConfidence: 0 },
  looxData = { connected: false, reviews: [], matchConfidence: 0 },
  csvReviewData,
  product,
  sales = [],
  returns = [],
  refunds = [],
  reviews = [],
  deterministicContent,
  windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS,
  storedReconstructedRiskHistory = [],
  momentumCatalogBaseline = null,
  currentRiskScore,
  currentConfidence,
  currentImpactFactors,
  currentMainIssue,
} = {}) {
  const now = new Date();
  const storedHistory = normalizeStoredReconstructedRiskHistory(storedReconstructedRiskHistory);
  const datedEvents = [...sales, ...returns, ...refunds, ...reviews]
    .map((event) => getRiskHistoryEventDate(event))
    .filter(Boolean)
    .sort((first, second) => first.getTime() - second.getTime());
  if (!datedEvents.length) {
    if (storedHistory.length) {
      const currentPoint = buildCurrentRiskHistoryFallbackPoint({
        snapshot,
        product,
        currentRiskScore,
        currentConfidence,
        currentImpactFactors,
        currentMainIssue,
        windowDays,
        now,
      });
      return dedupeRiskHistoryPointsByRecordedAt([
        ...storedHistory,
        finalizeCurrentRiskHistoryPoint(currentPoint, {
          now,
          currentRiskScore,
          currentConfidence,
          currentImpactFactors,
          currentMainIssue,
        }),
      ].filter(Boolean));
    }
    return [buildCurrentRiskHistoryFallbackPoint({
      snapshot,
      product,
      currentRiskScore,
      currentConfidence,
      currentImpactFactors,
      currentMainIssue,
      windowDays,
      now,
    })];
  }
  const earliest = getReconstructedRiskHistoryStartDate({ datedEvents, now, windowDays });
  const granularity = chooseReconstructedRiskHistoryGranularity(earliest, now);
  const periodEnds = buildReconstructedRiskHistoryPeriodEnds({ earliest, now, granularity });
  const history = periodEnds
    .map((periodEnd, index) => buildReconstructedRiskHistoryPoint({
      snapshot,
      shopifyData,
      judgeMeData,
      yotpoData,
      looxData,
      csvReviewData,
      product,
      sales: filterEventsForRiskHistoryWindow(sales, periodEnd, { windowDays, includeUndated: isCurrentRiskHistoryPoint(periodEnd, now) }),
      returns: filterEventsForRiskHistoryWindow(returns, periodEnd, { windowDays, includeUndated: isCurrentRiskHistoryPoint(periodEnd, now) }),
      refunds: filterEventsForRiskHistoryWindow(refunds, periodEnd, { windowDays, includeUndated: isCurrentRiskHistoryPoint(periodEnd, now) }),
      reviews: filterEventsForRiskHistoryWindow(reviews, periodEnd, { windowDays, includeUndated: isCurrentRiskHistoryPoint(periodEnd, now) }),
      deterministicContent,
      periodEnd,
      granularity,
      sequence: index + 1,
      windowDays,
      now,
      momentumCatalogBaseline,
    }))
    .filter(Boolean);

  const currentPoint = history[history.length - 1] || buildCurrentRiskHistoryFallbackPoint({
    snapshot,
    product,
    currentRiskScore,
    currentConfidence,
    currentImpactFactors,
    currentMainIssue,
    windowDays,
    now,
  });

  finalizeCurrentRiskHistoryPoint(currentPoint, {
    now,
    currentRiskScore,
    currentConfidence,
    currentImpactFactors,
    currentMainIssue,
  });

  return dedupeRiskHistoryPointsByRecordedAt(history.length ? history : [currentPoint].filter(Boolean));
}

function normalizeStoredReconstructedRiskHistory(history = []) {
  return (Array.isArray(history) ? history : [])
    .map((point, index) => {
      if (!point?.recordedAt && !point?.periodEnd) return null;
      const recordedAt = parseValidDate(point.recordedAt || point.periodEnd);
      if (!recordedAt) return null;
      return {
        ...point,
        source: point.source || "full-diagnosis-reconstructed",
        recordedAt: toIso(recordedAt),
        periodEnd: point.periodEnd || toIso(recordedAt),
        isCurrent: false,
        sequence: Number(point.sequence || point.metrics?.sequence || index + 1),
        metrics: {
          ...(point.metrics || {}),
          reconstructedHistory: true,
          calculationState: point.metrics?.calculationState || "reconstructed_from_persisted_history",
        },
      };
    })
    .filter(Boolean)
    .sort((first, second) => new Date(first.recordedAt).getTime() - new Date(second.recordedAt).getTime());
}

function finalizeCurrentRiskHistoryPoint(currentPoint, {
  now,
  currentRiskScore,
  currentConfidence,
  currentImpactFactors,
  currentMainIssue,
} = {}) {
  if (!currentPoint) return null;
  currentPoint.isCurrent = true;
  currentPoint.recordedAt = toIso(now);
  currentPoint.periodEnd = toIso(now);
  currentPoint.riskScore = Math.round(Number(currentRiskScore ?? currentPoint.riskScore ?? 0));
  currentPoint.confidence = Math.round(Number(currentConfidence ?? currentPoint.confidence ?? 0));
  currentPoint.primaryIssue = getHumanIssueLabel(currentMainIssue || currentPoint.primaryIssue || "product_content");
  currentPoint.metrics = {
    ...(currentPoint.metrics || {}),
    calculationState: "current_deep_diagnosis",
    reconstructedHistory: true,
  };
  if (currentImpactFactors) {
    currentPoint.impactScore = calculateHistoryImpactScore(currentImpactFactors);
    currentPoint.metrics.marginAtRisk = currentImpactFactors.marginAtRisk || currentPoint.metrics.marginAtRisk || 0;
    currentPoint.metrics.revenueAtRisk = currentImpactFactors.revenueAtRisk || currentPoint.metrics.revenueAtRisk || 0;
    currentPoint.metrics.estimatedImpact = currentImpactFactors.estimatedImpact || currentPoint.metrics.estimatedImpact || 0;
  }
  return currentPoint;
}

function buildReconstructedRiskHistoryPoint({
  snapshot,
  shopifyData,
  judgeMeData,
  yotpoData = { connected: false, reviews: [], matchConfidence: 0 },
  looxData = { connected: false, reviews: [], matchConfidence: 0 },
  csvReviewData,
  product,
  sales,
  returns,
  refunds,
  reviews,
  deterministicContent,
  periodEnd,
  granularity,
  sequence,
  windowDays,
  now,
  momentumCatalogBaseline = null,
}) {
  const snapshotMetrics = snapshot.metrics || {};
  const soldUnits = sumBy(sales, "quantity");
  const salesAmount = roundCurrency(sumBy(sales, "amount"));
  const returnUnits = sumBy(returns, "quantity");
  const refundUnits = sumBy(refunds, "quantity");
  const refundAmount = roundCurrency(sumBy(refunds, "amount"));
  const returnRate = calculateUnitRatePercent(returnUnits, soldUnits);
  const refundRate = calculateUnitRatePercent(refundUnits, soldUnits);
  const negativeReviews = reviews.filter(isNegativeReviewSignal);
  const reviewCount = reviews.length;
  const avgRating = roundRate(reviewCount ? reviews.reduce((total, review) => total + Number(review.rating || 0), 0) / reviewCount : 0, 1);
  const negativeReviewCount = negativeReviews.length;
  const negativeReviewRate = roundRate(reviewCount ? (negativeReviewCount / reviewCount) * 100 : 0);
  const recentNegativeReviewCount = negativeReviews.filter((review) => isRecentDateFrom(review.createdAt, 30, periodEnd)).length;
  const variantInsights = buildDiagnosisVariantInsights({ product, sales, returns, refunds, reviews });
  const affectedVariants = buildAffectedVariantDetailsFromInsights(variantInsights)
    || countTopValues([...returns, ...refunds].map((item) => item.variantTitle || item.sku).filter(Boolean), 4);
  const textInsights = buildCustomerTextInsights({ returns, reviews });
  const refundInsights = buildRefundOperationalInsights({ refunds, refundRate, soldUnits, refundUnits, refundAmount });
  const reviewSourceStats = buildReviewSourceStats(reviews);
  const sourceCoverage = buildSourceCoverage({ shopifyData, judgeMeData, yotpoData, looxData, csvReviewData, soldUnits, returnUnits, refundUnits, reviewCount });
  const sourceFetchComplete = getDiagnosisSourceFetchCompleteness(shopifyData);
  const sourceExtractionComplete = shopifyData?.incrementalSource?.fetchComplete !== false;
  const signalEvents = buildSignalEvents({ returns, refunds, negativeReviews });
  const signalWeighting = buildTemporalSignalWeighting({ signalEvents, sales, now: periodEnd });
  const weightedSignalEvents = signalWeighting.events;
  const weightedTrendEvents = weightedSignalEvents.map((event) => ({ ...event, value: Number(event.weightedValue || 0) }));
  const trendOptions = {
    startAt: getSinceDate(windowDays),
    endAt: periodEnd.toISOString(),
  };
  const signalTrendResult = buildDatedSignalTrend(weightedTrendEvents, trendOptions);
  const signalTrend = signalTrendResult.values;
  const effectiveReturnUnits = signalWeighting.byType.return.effectiveValue;
  const effectiveRefundUnits = signalWeighting.byType.refund.effectiveValue;
  const effectiveRefundAmount = roundCurrency(signalWeighting.byType.refund.effectiveAmount || refundAmount);
  const effectiveNegativeReviewCount = signalWeighting.byType.review.effectiveValue;
  const effectiveReturnRate = calculateUnitRatePercent(effectiveReturnUnits, soldUnits, returnRate);
  const effectiveRefundRate = calculateUnitRatePercent(effectiveRefundUnits, soldUnits, refundRate);
  const effectiveNegativeReviewRate = roundRate(reviewCount ? (effectiveNegativeReviewCount / reviewCount) * 100 : 0);
  const effectiveRecentSignalUnits = countWeightedRecentSignalEvents(weightedSignalEvents, 30, periodEnd);
  const effectiveRecentNegativeReviewCount = countWeightedRecentSignalEvents(weightedSignalEvents, 30, periodEnd, "review");
  const analysisTextInsights = applyTemporalWeightingToTextInsights(textInsights, signalWeighting);
  const analysisRefundInsights = applyTemporalWeightingToRefundInsights(refundInsights, {
    effectiveRefundUnits,
    effectiveRefundRate,
    effectiveRefundAmount,
  });
  const analysisReviewSourceStats = applyTemporalWeightingToReviewSourceStats(reviewSourceStats, signalWeighting);
  const rawIssueSignalCounts = buildIssueSignalCounts({ returns, refunds, reviews: negativeReviews });
  applyRefundInsightsToIssueCounts(rawIssueSignalCounts, refundInsights);
  const issueSignalCounts = mergeWeightedIssueSignalCounts(
    buildWeightedIssueSignalCounts(weightedSignalEvents),
    rawIssueSignalCounts,
    signalWeighting.averageWeight,
  );
  const customerIssueSignalTotal = Object.values(issueSignalCounts).reduce((total, count) => total + Number(count || 0), 0);

  (deterministicContent?.issues || []).forEach((issue) => {
    issueSignalCounts[issue.issueCode] = (issueSignalCounts[issue.issueCode] || 0) + 1;
  });

  const mainIssue = getMainIssueFromCounts(issueSignalCounts, snapshot.primaryIssue);
  const customerSignalCount = Math.max(effectiveReturnUnits + effectiveRefundUnits + effectiveNegativeReviewCount, customerIssueSignalTotal);
  const contentIssueCount = deterministicContent?.issues?.length || 0;
  const signalCount = customerSignalCount + contentIssueCount;
  const sourceAgreement = hasSourceAgreement({
    returnUnits: effectiveReturnUnits,
    refundUnits: effectiveRefundUnits,
    negativeReviewCount: effectiveNegativeReviewCount,
    reviewSourceStats: analysisReviewSourceStats,
  });
  const recentSignalUnits = effectiveRecentSignalUnits;
  const productId = product?.id || snapshot?.productGid;
  const pointProducts = product ? [product] : [];
  const returnRefundRelationshipSummary = buildReturnRefundRelationshipSummary({
    shop: snapshot?.shop,
    productId,
    products: pointProducts,
    sales,
    returns,
    refunds,
  });
  const productPurchaseContextSummary = buildProductPurchaseContextSummary({
    shop: snapshot?.shop,
    productId,
    products: pointProducts,
    sales,
    returns,
    refunds,
    assumeCompleteOrderEvents: false,
  });
  const productRelationshipIntelligenceSummary = buildProductRelationshipSummary({
    shop: snapshot?.shop,
    productId,
    products: pointProducts,
    sales,
    returns,
    refunds,
    windowDays,
    assumeCompleteOrderEvents: false,
  });
  const productMomentum = buildProductMomentum({
    product,
    sales,
    windowDays,
    catalogBaseline: momentumCatalogBaseline,
    now: periodEnd,
  });
  const scoreSentiment = getScoreSentimentInputs(analysisTextInsights, analysisRefundInsights);
  const scoreModel = calculateProductScoreModel({
    soldUnits,
    salesAmount,
    returnUnits: effectiveReturnUnits,
    refundUnits: effectiveRefundUnits,
    refundAmount: effectiveRefundAmount,
    returnRate: effectiveReturnRate,
    refundRate: effectiveRefundRate,
    reviewCount,
    avgRating,
    negativeReviewCount: effectiveNegativeReviewCount,
    negativeReviewRate: effectiveNegativeReviewRate,
    recentNegativeReviewCount: effectiveRecentNegativeReviewCount,
    signalCount,
    customerSignalCount,
    contentIssueCount,
    contentQualityRisk: deterministicContent?.riskLift || 0,
    textInsights: analysisTextInsights,
    refundInsights: analysisRefundInsights,
    sourceCoverage,
    signalEvents: weightedTrendEvents,
    signalTrend,
    signalRecencyWeighting: signalWeighting.summary,
    affectedVariants,
    variantInsights,
    reviewSourceStats: analysisReviewSourceStats,
    storeReturnBaseline: snapshotMetrics.storeAvgReturnRate,
    storeRefundBaseline: snapshotMetrics.storeAvgRefundRate,
    storeNegativeReviewBaseline: snapshotMetrics.storeAvgNegativeReviewRate,
    sentimentTotal: scoreSentiment.total,
    sentimentNegativeCount: scoreSentiment.negative,
    subjectiveNegativeCount: analysisTextInsights?.subjectiveNegativity?.count || 0,
    subjectiveNegativeRatio: analysisTextInsights?.subjectiveNegativity?.ratio || 0,
    variantCount: product?.variants?.length || Number(snapshotMetrics.variantCount || 0),
    affectedVariantCount: affectedVariants.length,
    affectedVariantSignalCount: affectedVariants.reduce((sum, variant) => sum + Number(variant.count || 0), 0),
    strongestVariantSignalCount: affectedVariants[0]?.count || 0,
    recentSignalUnits,
    signalEventCount: customerSignalCount,
    effectiveSampleSize: effectiveReturnUnits + effectiveRefundUnits + reviewCount + contentIssueCount,
    sourceAgreement,
    productMatchConfidence: Math.max(judgeMeData?.matchConfidence || 0, yotpoData?.matchConfidence || 0, looxData?.matchConfidence || 0, csvReviewData?.matchConfidence || 0, reviews.length ? 0 : 1),
    orderAccessDenied: shopifyData?.orderAccessDenied,
    missingOrders: shopifyData?.orderAccessDenied || sourceFetchComplete.sales === false,
    missingReturns: sourceFetchComplete.returns === false,
    missingRefunds: sourceFetchComplete.refunds === false,
    dataQualityIncomplete: shopifyData?.orderAccessDenied || sourceExtractionComplete === false,
    subjectiveOnlyIssue: mainIssue === "subjective_negative_reaction" && !effectiveReturnUnits && !effectiveRefundUnits && effectiveNegativeReviewCount <= 2,
    scoreBreakdownReconstructed: !isCurrentRiskHistoryPoint(periodEnd, now),
    calculationState: isCurrentRiskHistoryPoint(periodEnd, now) ? "current_deep_diagnosis" : "reconstructed_from_deep_diagnosis_events",
    windowDays,
    returnRefundRelationshipSummary,
    productPurchaseContextSummary,
    productRelationshipIntelligenceSummary,
  }, { sentimentSharesReviewSource: !(effectiveReturnUnits || effectiveRefundUnits) });

  return {
    source: "full-diagnosis-reconstructed",
    granularity,
    sequence,
    periodEnd: toIso(periodEnd),
    recordedAt: toIso(periodEnd),
    isCurrent: isCurrentRiskHistoryPoint(periodEnd, now),
    riskScore: scoreModel.riskScore,
    confidence: scoreModel.confidenceScore,
    impactScore: calculateHistoryImpactScore(scoreModel.impactFactors),
    primaryIssue: getHumanIssueLabel(mainIssue),
    metrics: {
      reconstructedHistory: true,
      calculationState: scoreModel.riskComponents.calculationState,
      granularity,
      windowDays,
      soldUnits,
      salesAmount,
      returnUnits: effectiveReturnUnits,
      refundUnits: effectiveRefundUnits,
      refundAmount: effectiveRefundAmount,
      returnRate: effectiveReturnRate,
      refundRate: effectiveRefundRate,
      rawReturnUnits: returnUnits,
      rawRefundUnits: refundUnits,
      rawRefundAmount: refundAmount,
      rawReturnRate: returnRate,
      rawRefundRate: refundRate,
      reviewCount,
      avgRating,
      negativeReviewCount: effectiveNegativeReviewCount,
      negativeReviewRate: effectiveNegativeReviewRate,
      rawNegativeReviewCount: negativeReviewCount,
      rawNegativeReviewRate: negativeReviewRate,
      recentNegativeReviewCount: effectiveRecentNegativeReviewCount,
      rawRecentNegativeReviewCount: recentNegativeReviewCount,
      recentNegativeReviewWindowDays: 30,
      signalCount,
      customerSignalCount,
      rawSignalCount: returnUnits + refundUnits + negativeReviewCount + contentIssueCount,
      rawCustomerSignalCount: returnUnits + refundUnits + negativeReviewCount,
      contentIssueCount,
      recentSignalUnits,
      rawRecentSignalUnits: countRecentSignalEventsFrom(signalEvents, 30, periodEnd),
      signalRecencyWeighting: signalWeighting.summary,
      signalTrend,
      trendMeta: signalTrendResult.meta,
      priorityScore: scoreModel.priorityScore,
      mainIssueIntensity: scoreModel.priorityScore,
      evidenceStrengthScore: scoreModel.evidenceStrengthScore,
      sourceCount: sourceCoverage.length,
      affectedVariants: affectedVariants.map((item) => item.label),
      affectedVariantDetails: affectedVariants,
      variantInsights,
      marginAtRisk: scoreModel.impactFactors.marginAtRisk,
      revenueAtRisk: scoreModel.impactFactors.revenueAtRisk,
      estimatedImpact: scoreModel.impactFactors.estimatedImpact,
      sourceCoverage,
      sourceAgreement,
      returnRefundRelationshipSummary,
      productPurchaseContextSummary,
      productRelationshipIntelligenceSummary,
      returnRefundRelationshipFactors: scoreModel.relationshipFactors,
      returnPressure: scoreModel.relationshipFactors.returnPressure,
      refundLeakage: scoreModel.relationshipFactors.refundLeakage,
      returnPressureScore: scoreModel.relationshipFactors.returnPressure?.score,
      refundLeakageScore: scoreModel.relationshipFactors.refundLeakage?.score,
      productPurchaseContextFactors: scoreModel.purchaseContextFactors,
      productRelationshipFactors: scoreModel.productRelationshipFactors,
      scoringVersion: scoreModel.scoringVersion,
      productMomentum,
      productMomentumScore: productMomentum.score,
      productMomentumTier: productMomentum.tier,
      momentumDirection: productMomentum.direction,
      momentumConfidence: productMomentum.confidence,
      riskComponents: scoreModel.riskComponents,
      confidenceFactors: scoreModel.confidenceFactors,
    },
  };
}

function buildCurrentRiskHistoryFallbackPoint({
  snapshot,
  product,
  currentRiskScore,
  currentConfidence,
  currentImpactFactors,
  currentMainIssue,
  windowDays,
  now,
}) {
  const snapshotMetrics = snapshot?.metrics || {};
  const riskScore = Math.round(Number(currentRiskScore ?? snapshot?.riskScore ?? 0));
  return {
    source: "full-diagnosis-reconstructed",
    granularity: "current",
    sequence: 1,
    periodEnd: toIso(now),
    recordedAt: toIso(now),
    isCurrent: true,
    riskScore,
    confidence: Math.round(Number(currentConfidence ?? snapshot?.confidence ?? 0)),
    impactScore: calculateHistoryImpactScore(currentImpactFactors || { revenueAtRisk: snapshotMetrics.revenueAtRisk }),
    primaryIssue: getHumanIssueLabel(currentMainIssue || snapshot?.primaryIssue || "product_content"),
    metrics: {
      reconstructedHistory: true,
      calculationState: "current_deep_diagnosis",
      granularity: "current",
      windowDays,
      soldUnits: Number(snapshotMetrics.soldUnits || 0),
      salesAmount: Number(snapshotMetrics.salesAmount || 0),
      returnUnits: Number(snapshotMetrics.returnUnits || 0),
      refundUnits: Number(snapshotMetrics.refundUnits || 0),
      refundAmount: Number(snapshotMetrics.refundAmount || 0),
      returnRate: Number(snapshotMetrics.returnRate || 0),
      refundRate: Number(snapshotMetrics.refundRate || 0),
      reviewCount: Number(snapshotMetrics.reviewCount || 0),
      negativeReviewCount: Number(snapshotMetrics.negativeReviewCount || 0),
      negativeReviewRate: Number(snapshotMetrics.negativeReviewRate || 0),
      evidenceStrengthScore: Number(snapshotMetrics.evidenceStrengthScore || snapshotMetrics.confidenceFactors?.evidenceStrengthScore || 0),
      sourceCount: Array.isArray(snapshot?.sourceCoverage || snapshotMetrics.sourceCoverage) ? (snapshot?.sourceCoverage || snapshotMetrics.sourceCoverage).length : 0,
      sourceCoverage: snapshot?.sourceCoverage || snapshotMetrics.sourceCoverage || [],
      marginAtRisk: Number(currentImpactFactors?.marginAtRisk || snapshotMetrics.marginAtRisk || 0),
      revenueAtRisk: Number(currentImpactFactors?.revenueAtRisk || snapshotMetrics.revenueAtRisk || 0),
      estimatedImpact: Number(currentImpactFactors?.estimatedImpact || snapshotMetrics.estimatedImpact || 0),
      productTitle: product?.title || snapshot?.productTitle || "",
    },
  };
}

function chooseReconstructedRiskHistoryGranularity(earliest, now) {
  const spanDays = Math.max(1, Math.ceil((now.getTime() - earliest.getTime()) / (24 * 60 * 60 * 1000)));
  return spanDays > RECONSTRUCTED_RISK_HISTORY_MONTHLY_THRESHOLD_DAYS ? "monthly" : "weekly";
}

function getReconstructedRiskHistoryStartDate({ datedEvents = [], now = new Date(), windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS } = {}) {
  const lookbackDays = Math.max(RECONSTRUCTED_RISK_HISTORY_MIN_LOOKBACK_DAYS, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS));
  const lookbackStart = new Date(now.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  if (!Array.isArray(datedEvents) || !datedEvents.length) return lookbackStart;
  return lookbackStart;
}

function buildReconstructedRiskHistoryPeriodEnds({ earliest, now, granularity }) {
  const starts = granularity === "monthly"
    ? getMonthStartsBetween(startOfUtcMonth(earliest), startOfUtcMonth(now)).slice(-RECONSTRUCTED_RISK_HISTORY_MAX_MONTHLY_POINTS)
    : getWeekStartsBetween(startOfUtcWeek(earliest), startOfUtcWeek(now)).slice(-RECONSTRUCTED_RISK_HISTORY_MAX_WEEKLY_POINTS);
  const periodEnds = starts.map((start) => {
    const nextStart = granularity === "monthly" ? addUtcMonths(start, 1) : addUtcDays(start, 7);
    return new Date(Math.min(nextStart.getTime() - 1, now.getTime()));
  });
  const last = periodEnds[periodEnds.length - 1];
  if (!last || Math.abs(last.getTime() - now.getTime()) > 1000) {
    periodEnds.push(now);
  }
  return periodEnds;
}

function filterEventsForRiskHistoryWindow(events = [], periodEnd, { windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS, includeUndated = false } = {}) {
  const endDate = parseValidDate(periodEnd);
  if (!endDate) return [];
  const safeWindowDays = Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS));
  const startTime = endDate.getTime() - safeWindowDays * 24 * 60 * 60 * 1000;
  const endTime = endDate.getTime();
  return events.filter((event) => {
    const date = getRiskHistoryEventDate(event);
    if (!date) return includeUndated;
    const time = date.getTime();
    return time > startTime && time <= endTime;
  });
}

function getRiskHistoryEventDate(event = {}) {
  return parseValidDate(event.createdAt || event.processedAt || event.updatedAt || event.reviewDate || event.date);
}

function isCurrentRiskHistoryPoint(periodEnd, now) {
  return Math.abs(periodEnd.getTime() - now.getTime()) <= 1000;
}

function countRecentSignalEventsFrom(events, days, now) {
  return events
    .filter((event) => isRecentDateFrom(event.createdAt, days, now))
    .reduce((total, event) => total + Number(event.value || 1), 0);
}

function isRecentDateFrom(value, days, now) {
  const date = parseValidDate(value);
  const currentDate = parseValidDate(now);
  if (!date || !currentDate) return false;
  return currentDate.getTime() - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

function calculateHistoryImpactScore(impactFactors = {}) {
  return Math.min(100, Math.round(Number(impactFactors.revenueAtRisk || impactFactors.estimatedImpact || 0) / 100));
}

function dedupeRiskHistoryPointsByRecordedAt(history = []) {
  const byTimestamp = new Map();
  history.filter(Boolean).forEach((point) => {
    const key = point.recordedAt || point.periodEnd;
    if (!key) return;
    byTimestamp.set(key, point);
  });
  return [...byTimestamp.values()].sort((first, second) => new Date(first.recordedAt).getTime() - new Date(second.recordedAt).getTime());
}

function withAiPurchaseContextInterpretation(summary, ai) {
  if (!summary || typeof summary !== "object") return summary;
  const interpretation = cleanAiStoredInterpretation(
    ai?.report?.basket_context_interpretation || ai?.report?.basketContextInterpretation,
  );
  if (!interpretation) return summary;

  return {
    ...summary,
    interpretation,
    backend_interpretation: interpretation,
    ai_interpretation: interpretation,
    interpretation_source: "deep_diagnosis_final_report",
  };
}

function cleanAiStoredInterpretation(value) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 700);
}

function buildPersistedDiagnosis({ snapshot, shopifyData, judgeMeData, yotpoData, looxData, csvReviewData, deterministic, ai }) {
  const contentAnalysis = buildContentAnalysis(deterministic, ai.contentGaps);
  const semanticDeterministic = applyAiSemanticClassificationToDeterministic(deterministic, ai);
  const emergentSentiments = normalizeAiEmergentSentiments(ai);
  const knownEmotions = normalizeAiKnownEmotions(ai, semanticDeterministic.metrics.textInsights);
  const adjustedRiskComponents = adjustRiskComponentsForContentAnalysis(
    semanticDeterministic.metrics.riskComponents,
    contentAnalysis,
    semanticDeterministic.metrics,
  );
  const adjustedRiskScore = adjustedRiskComponents.riskScore;
  const adjustedRiskHistory = adjustReconstructedRiskHistoryForContentAnalysis(
    semanticDeterministic.metrics.reconstructedRiskHistory || semanticDeterministic.metrics.riskHistory,
    contentAnalysis,
    adjustedRiskScore,
  );
  const scoredDeterministic = {
    ...semanticDeterministic,
    riskScore: adjustedRiskScore,
    metrics: {
      ...semanticDeterministic.metrics,
      textInsights: {
        ...(semanticDeterministic.metrics.textInsights || {}),
        emotions: knownEmotions.length ? knownEmotions : semanticDeterministic.metrics.textInsights?.emotions || [],
        aiKnownEmotions: knownEmotions,
        aiEmergentSentiments: emergentSentiments,
      },
      contentAnalysis,
      contentQualityScore: contentAnalysis.score,
      contentQualityRisk: contentAnalysis.riskLift,
      contentIssueCount: contentAnalysis.issues.length,
      contentIssues: contentAnalysis.issues,
      contentAdvisoryCount: contentAnalysis.advisories.length,
      contentAdvisories: contentAnalysis.advisories,
      signalCount: semanticDeterministic.metrics.customerSignalCount + contentAnalysis.issues.length,
      issueCount: semanticDeterministic.metrics.customerSignalCount + contentAnalysis.issues.length,
      riskComponents: adjustedRiskComponents,
      riskTrend: buildRiskTrendFromSignalTrend(semanticDeterministic.metrics.signalTrend, adjustedRiskScore, semanticDeterministic.metrics.riskTrend),
      riskHistory: adjustedRiskHistory,
      reconstructedRiskHistory: adjustedRiskHistory,
    },
  };
  contentAnalysis.issues.forEach((issue) => {
    scoredDeterministic.issueSignalCounts[issue.issueCode] = Math.max(scoredDeterministic.issueSignalCounts[issue.issueCode] || 0, 1);
  });

  const sourceIntegritySignals = getSourceMismatchSignals(scoredDeterministic);
  const sourceIntegrityMode = isSourceIntegrityDiagnosis(scoredDeterministic, sourceIntegritySignals);
  const aiMainIssue = normalizeIssueCode(ai.classification?.main_issue) || scoredDeterministic.mainIssue;
  const contentShouldLead = contentAnalysis.issues.some((issue) => issue.severity === "high") && scoredDeterministic.metrics.customerSignalCount <= 1;
  const monitoringContentOnly = isLowRiskMonitoringOnlyDiagnosis(scoredDeterministic) && contentAnalysis.issues.length > 0;
  const evidencePreferredMainIssue = getEvidencePreferredMainIssue(scoredDeterministic, aiMainIssue);
  const mainIssue = sourceIntegrityMode
    ? "review_feed_integrity"
    : monitoringContentOnly
    ? "product_content"
    : contentShouldLead
    ? "product_content"
    : evidencePreferredMainIssue;
  scoredDeterministic.metrics.faqNeed = analyzeFaqOpportunity({
    mainIssue,
    issueSignalCounts: scoredDeterministic.issueSignalCounts,
    product: scoredDeterministic.product,
    contentAnalysis,
    textInsights: scoredDeterministic.metrics.textInsights,
    topReturnReasons: scoredDeterministic.metrics.topReturnReasonDetails,
    affectedVariants: scoredDeterministic.metrics.affectedVariantDetails,
    reviewCount: scoredDeterministic.metrics.reviewCount,
    negativeReviewCount: scoredDeterministic.metrics.negativeReviewCount,
    returnUnits: scoredDeterministic.metrics.returnUnits,
    refundUnits: scoredDeterministic.metrics.refundUnits,
  });
  const issueLabel = ai.classification?.main_issue_label || getHumanIssueLabel(mainIssue);
  const aiEvidenceSynthesisSections = normalizeAiEvidenceSynthesisSections(ai.report?.evidence_synthesis_sections);
  const mainFinding = {
    title: ai.report?.main_finding_title || `${issueLabel} signals need review`,
    detail: buildMainFindingDetail(ai.report?.main_finding_detail, scoredDeterministic, contentAnalysis),
    summary: ai.report?.evidence_summary || buildEvidenceSummary(scoredDeterministic),
  };
  const adjustedMainFinding = adjustMainFindingForSignalStrength(mainFinding, scoredDeterministic);
  const recommendations = buildFinalRecommendations({ snapshot, deterministic: scoredDeterministic, ai, mainIssue });
  const issues = buildFinalIssues({ deterministic: scoredDeterministic, ai, mainIssue, recommendations });
  const evidence = buildFinalEvidence({ deterministic: scoredDeterministic, ai, aiEvidenceSynthesisSections, judgeMeData, yotpoData, looxData, csvReviewData, shopifyData });
  const diagnosisReportIssueNames = buildDiagnosisReportIssueNames({ issues, mainIssue });
  const incrementalDiagnosis = buildPersistedIncrementalDiagnosisState({
    runtimeState: scoredDeterministic.metrics.incrementalDiagnosis,
    aiContentGaps: ai.contentGaps,
  });
  const productEvolution = scoredDeterministic.metrics.productEvolution || null;
  const postActionStatus = normalizeAiPostActionStatus(ai.report?.post_action_status, productEvolution);
  const productPurchaseContextSummary = withAiPurchaseContextInterpretation(
    scoredDeterministic.metrics.productPurchaseContextSummary,
    ai,
  );
  const metrics = {
    ...scoredDeterministic.metrics,
    productPurchaseContextSummary,
    incrementalDiagnosis,
    aiUsage: ai.aiUsage,
    chartInterpretations: ai.chartInterpretations || null,
    productRelationshipAiInsights: ai.relationshipInsights || null,
    diagnosisReport: {
      mainFinding: adjustedMainFinding,
      evidenceSummary: adjustedMainFinding.summary,
      evidenceSynthesisSections: aiEvidenceSynthesisSections,
      issueNames: diagnosisReportIssueNames,
      aiModels: ai.modelsUsed,
      aiUsage: ai.aiUsage,
      chartInterpretations: ai.chartInterpretations || null,
      relationshipInsights: ai.relationshipInsights || null,
      productEvolution: sanitizeProductEvolutionForAi(productEvolution),
      productEvolutionSummary: productEvolution?.summary || "",
      postActionStatus,
      knownEmotions,
      emergentSentiments,
      checkedSources: buildCheckedSources(semanticDeterministic),
    },
  };

  return jsonSafe({
    productGid: snapshot.productGid,
    productTitle: snapshot.productTitle,
    riskScore: scoredDeterministic.riskScore,
    impactScore: Math.min(100, Math.round((scoredDeterministic.estimatedImpact.revenueAtRisk || 0) / 100)),
    confidence: scoredDeterministic.confidence,
    likelyCause: issueLabel,
    mainIssue,
    issues,
    evidence,
    recommendations,
    sourceCoverage: scoredDeterministic.sourceCoverage,
    metrics,
    mainFinding: adjustedMainFinding,
  });
}

function normalizeAiPostActionStatus(rawStatus = null, productEvolution = null) {
  if (!hasEligibleProductEvolutionPostActionStatus(productEvolution)) return null;
  const fallback = productEvolution?.postActionStatus || null;
  if (!rawStatus || typeof rawStatus !== "object") return fallback;
  const value = (...keys) => String(
    keys.map((key) => rawStatus[key]).find(Boolean)
      || keys.map((key) => fallback?.[key]).find(Boolean)
      || "",
  ).replace(/\s+/g, " ").trim();
  const status = String(rawStatus.status || fallback?.status || "").replace(/\s+/g, "_").toLowerCase();
  return {
    ...(fallback || {}),
    title: value("title") || "Post-action status",
    status: status || fallback?.status || "changed",
    tone: String(rawStatus.tone || fallback?.tone || "info").toLowerCase(),
    summary: value("summary"),
    historicalDiagnosis: value("historicalDiagnosis", "historical_diagnosis"),
    postActionEvidence: value("postActionEvidence", "post_action_evidence"),
    nextBestStep: value("nextBestStep", "next_best_step"),
  };
}

function buildDiagnosisReportIssueNames({ issues = [], mainIssue = "" } = {}) {
  const mainIssueCode = normalizeIssueCode(mainIssue);
  const rows = (Array.isArray(issues) ? issues : [])
    .map((issue) => {
      const label = truncateText(issue?.issue || issue?.label || issue?.title || issue?.name || "", 96);
      if (!label) return null;
      const code = normalizeIssueCode(issue?.code || issue?.issueCode || issue?.category || "")
        || inferDiagnosisReportIssueCodeFromLabel(label, mainIssueCode)
        || mainIssueCode
        || "product_quality";
      return { code, label };
    })
    .filter(Boolean);
  if (!rows.length) {
    const code = mainIssueCode || "product_quality";
    rows.push({ code, label: getHumanIssueLabel(code) });
  }
  return uniqueBy(rows, (item) => `${item.code}:${normalizeText(item.label)}`).slice(0, 8);
}

function inferDiagnosisReportIssueCodeFromLabel(label = "", mainIssueCode = "") {
  const text = normalizeText(label);
  if (/\b(specs?|specifications?|dimension|dimensions|included|material|materials|description|content|guidance)\b/.test(text)) {
    return "product_content";
  }
  if (/\b(min fill|fill limit|auto shutoff|voltage|converter|adapter|clearance|mounting|surface|adhesive|included photo|included print|setup)\b/.test(text)) {
    return "setup_expectation";
  }
  return mainIssueCode || "";
}

async function persistDetailedDiagnosis({ shop, jobId, snapshot, payload }) {
  const completedAt = new Date();
  const diagnosis = await prisma.productDiagnosis.create({
    data: {
      shop,
      productGid: snapshot.productGid,
      productTitle: snapshot.productTitle,
      status: "Completed",
      riskScore: payload.riskScore,
      confidence: payload.confidence,
      likelyCause: payload.likelyCause,
      issues: payload.issues,
      evidence: payload.evidence,
      recommendations: payload.recommendations,
      metrics: payload.metrics,
      creditsConsumed: 1,
      createdAt: completedAt,
      completedAt,
    },
    select: {
      id: true,
      shop: true,
      productGid: true,
      productTitle: true,
      status: true,
      riskScore: true,
      confidence: true,
      likelyCause: true,
      issues: true,
      createdAt: true,
      completedAt: true,
    },
  });

  const updatedSnapshot = await prisma.productRiskSnapshot.update({
    where: { shop_productGid: { shop, productGid: snapshot.productGid } },
    data: {
      riskScore: payload.riskScore,
      impactScore: payload.impactScore,
      confidence: payload.confidence,
      primaryIssue: payload.likelyCause,
      sourceCoverage: payload.sourceCoverage,
      metrics: {
        ...payload.metrics,
        latestDiagnosisId: diagnosis.id,
        lastDetailedDiagnosisAt: new Date().toISOString(),
      },
      calculatedAt: new Date(),
    },
  });
  await upsertProductPulseProductRollup(updatedSnapshot, { latestDiagnosis: diagnosis }).catch(() => null);
  await Promise.all([
    recordReconstructedProductScoreHistory({
      shop,
      snapshot: updatedSnapshot,
      history: payload.metrics.reconstructedRiskHistory || payload.metrics.riskHistory,
      source: "full-diagnosis-reconstructed",
      diagnosisId: diagnosis.id,
    }),
    recordProductScoreHistory({ shop, snapshot: updatedSnapshot, source: "full-diagnosis", diagnosisId: diagnosis.id }),
    recordWatchlistScanActivities(shop, [updatedSnapshot], { source: "full-diagnosis", jobId }),
  ]);

  await Promise.all([
    recordTimelineForDiagnosis({ shop, snapshot: updatedSnapshot, diagnosis, jobId }),
    recordTimelineForLatestScoreSnapshots(shop, [updatedSnapshot], { source: "full-diagnosis", diagnosisId: diagnosis.id, jobId }),
  ]);

  const actionRecord = await prisma.productAction.create({
    data: {
      shop,
      diagnosisId: diagnosis.id,
      productGid: snapshot.productGid,
      actionType: "run-ai-diagnosis",
      label: "Run Product Diagnosis",
      status: "applied",
      payload: {
        diagnosisId: diagnosis.id,
        riskScore: payload.riskScore,
        confidence: payload.confidence,
        estimatedImpact: payload.metrics.estimatedImpact,
        mainFinding: payload.mainFinding,
      },
      appliedAt: new Date(),
    },
  });
  await recordTimelineForProductAction({ shop, snapshot: updatedSnapshot, actionRecord });

  return diagnosis;
}

async function calculateAndAttachProductRetentionForDiagnosis({
  shop,
  jobId,
  admin,
  snapshot,
  diagnosis,
  windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS,
  retentionPreview = null,
}) {
  if (!diagnosis?.id || !snapshot?.productGid) return null;
  try {
    const lookbackDays = Math.max(PRODUCT_RETENTION_DEFAULT_LOOKBACK_DAYS_FOR_DIAGNOSIS, Number(windowDays || 0));
    const includeTestOrders = shouldIncludeTestOrdersForProductRetention(snapshot);
    const canReusePreviewOrders = retentionPreview
      && Array.isArray(retentionPreview.orders)
      && retentionPreview.fetchStats?.truncated !== true
      && retentionPreview.status !== "failed";
    const result = await calculateProductRetentionMetrics({
      shopId: shop,
      productGid: snapshot.productGid,
      diagnosisId: diagnosis.id,
      admin,
      jobId,
      asOfDate: diagnosis.completedAt || new Date(),
      lookbackDays,
      maxCohortAgeDays: PRODUCT_RETENTION_MAX_COHORT_AGE_DAYS_FOR_DIAGNOSIS,
      includeTestOrders,
      orders: canReusePreviewOrders ? retentionPreview.orders : null,
      timezone: canReusePreviewOrders ? retentionPreview.timezone : "",
      currency: canReusePreviewOrders ? retentionPreview.currency : "",
      windowStartDate: canReusePreviewOrders ? retentionPreview.windowStartDate : null,
      windowEndDate: canReusePreviewOrders ? retentionPreview.windowEndDate : null,
    });
    result.reusedPreviewOrders = canReusePreviewOrders;
    await attachProductRetentionPayloadToDiagnosis({
      shopId: shop,
      productGid: snapshot.productGid,
      diagnosisId: diagnosis.id,
      payload: result.payload,
    });
    return result;
  } catch (error) {
    await recordJobLog({
      shop,
      jobId,
      level: "warn",
      event: "product_retention.attach_failed",
      message: "Product retention payload could not be attached to the diagnosis; the diagnosis remains completed.",
      data: { productGid: snapshot.productGid, diagnosisId: diagnosis.id, error: serializeError(error) },
    });
    return null;
  }
}

async function calculateProductRetentionPreviewForDiagnosis({
  shop,
  jobId,
  admin,
  snapshot,
  windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS,
}) {
  if (!snapshot?.productGid) return null;
  const lookbackDays = Math.max(PRODUCT_RETENTION_DEFAULT_LOOKBACK_DAYS_FOR_DIAGNOSIS, Number(windowDays || 0));
  const includeTestOrders = shouldIncludeTestOrdersForProductRetention(snapshot);
  return calculateProductRetentionPreview({
    shopId: shop,
    productGid: snapshot.productGid,
    admin,
    jobId,
    asOfDate: new Date(),
    lookbackDays,
    maxCohortAgeDays: PRODUCT_RETENTION_MAX_COHORT_AGE_DAYS_FOR_DIAGNOSIS,
    includeTestOrders,
  });
}

function attachProductRetentionPreviewToDeterministic(deterministic = {}, payload = null) {
  if (!payload?.summary) return deterministic;
  return {
    ...deterministic,
    metrics: {
      ...(deterministic.metrics || {}),
      productRetention: payload,
      productRetentionSummary: payload.summary || null,
    },
  };
}

function shouldIncludeTestOrdersForProductRetention(snapshot) {
  const title = String(snapshot?.productTitle || snapshot?.title || "").trim().toUpperCase();
  const handle = String(snapshot?.handle || snapshot?.productHandle || "").trim().toLowerCase();
  return title.startsWith("GEN ") && handle.startsWith("gen-");
}

async function ensureProductRelationshipCandidateSnapshots({
  shop,
  jobId,
  sourceSnapshot,
  relationshipSummary,
} = {}) {
  const payloads = buildProductRelationshipCandidateSnapshotPayloads({
    shop,
    sourceSnapshot,
    relationshipSummary,
  });
  if (!payloads.length) return { created: 0, updated: 0 };

  try {
    const productGids = payloads.map((payload) => payload.productGid).filter(Boolean);
    const existing = await prisma.productRiskSnapshot.findMany({
      where: { shop, productGid: { in: productGids } },
      select: {
        productGid: true,
        productTitle: true,
        handle: true,
        sourceCoverage: true,
      },
    });
    const existingByProductGid = new Map(existing.map((snapshot) => [snapshot.productGid, snapshot]));
    const missingPayloads = payloads.filter((payload) => !existingByProductGid.has(payload.productGid));
    const refreshPayloads = payloads.filter((payload) => {
      const current = existingByProductGid.get(payload.productGid);
      if (!current) return false;
      return isUnknownProductLabel(current.productTitle) || (!current.handle && payload.handle);
    });

    if (missingPayloads.length) {
      await prisma.productRiskSnapshot.createMany({ data: missingPayloads, skipDuplicates: true });
      await upsertProductPulseProductRollups(missingPayloads).catch(() => null);
    }

    const refreshedSnapshots = await Promise.all(refreshPayloads.map((payload) => prisma.productRiskSnapshot.update({
      where: { shop_productGid: { shop, productGid: payload.productGid } },
      data: {
        productTitle: payload.productTitle,
        handle: payload.handle,
        sourceCoverage: mergeSourceCoverage(existingByProductGid.get(payload.productGid)?.sourceCoverage, payload.sourceCoverage),
        calculatedAt: new Date(),
      },
    })));
    await upsertProductPulseProductRollups(refreshedSnapshots).catch(() => null);

    if (missingPayloads.length || refreshPayloads.length) {
      await recordJobLog({
        shop,
        jobId,
        event: "product_diagnosis.relationship_candidates_persisted",
        message: "Product relationship intelligence added related Shopify products to ProductPulse candidates.",
        data: {
          sourceProductGid: sourceSnapshot?.productGid,
          createdCandidates: missingPayloads.length,
          refreshedCandidates: refreshPayloads.length,
          relatedProducts: payloads.map((payload) => ({
            productGid: payload.productGid,
            handle: payload.handle,
            title: payload.productTitle,
          })),
        },
      });
    }

    return { created: missingPayloads.length, updated: refreshPayloads.length };
  } catch (error) {
    await recordJobLog({
      shop,
      jobId,
      level: "warn",
      event: "product_diagnosis.relationship_candidates_failed",
      message: "Product relationship candidates could not be persisted; diagnosis will continue.",
      data: { error: serializeError(error), sourceProductGid: sourceSnapshot?.productGid },
    });
    return { created: 0, updated: 0, error: serializeError(error) };
  }
}

function buildProductRelationshipCandidateSnapshotPayloads({
  shop,
  sourceSnapshot,
  relationshipSummary,
} = {}) {
  if (!shop || !relationshipSummary || typeof relationshipSummary !== "object") return [];
  const sourceProductGid = sourceSnapshot?.productGid || relationshipSummary.source_product_id || relationshipSummary.sourceProductId || "";
  const sourceProductTitle = sourceSnapshot?.productTitle || relationshipSummary.source_product_title || relationshipSummary.sourceProductTitle || "";
  const discoveredAt = new Date().toISOString();
  const byProductGid = new Map();

  getProductRelationshipCandidateItems(relationshipSummary).forEach((item) => {
    const productGid = item.related_product_id || item.relatedProductId || "";
    if (!productGid || productGid === sourceProductGid) return;
    const title = item.related_product_title || item.relatedProductTitle || item.title || "";
    const handle = item.related_product_handle || item.relatedProductHandle || item.handle || "";
    if (isUnknownProductLabel(title) && !handle) return;
    const previous = byProductGid.get(productGid);
    const candidate = {
      item,
      productGid,
      productTitle: isUnknownProductLabel(title) ? "Related Shopify product" : title,
      handle: handle || String(productGid).split("/").pop() || "related-product",
      confidence: Math.round(normalizePercentLike(item.confidence || item.confidence_score || 0)),
      sampleSize: Number(item.sample_size || item.sampleSize || item.co_order_count || item.customer_count || item.order_count || 0),
    };
    if (!previous || candidate.sampleSize > previous.sampleSize || candidate.confidence > previous.confidence) {
      byProductGid.set(productGid, candidate);
    }
  });

  return Array.from(byProductGid.values()).map(({ item, productGid, productTitle, handle, confidence, sampleSize }) => ({
    shop,
    productGid,
    productTitle,
    handle,
    riskScore: 0,
    impactScore: 0,
    confidence,
    primaryIssue: "Relationship candidate",
    sourceCoverage: ["Shopify orders", "Product relationship intelligence"],
    metrics: {
      relationshipCandidate: true,
      hasQuickScan: false,
      signalCount: 0,
      soldUnits: 0,
      returnUnits: 0,
      refundUnits: 0,
      refundAmount: 0,
      returnRate: 0,
      refundRate: 0,
      revenueAtRisk: 0,
      marginAtRisk: 0,
      estimatedImpact: 0,
      productRelationshipCandidate: {
        sourceProductGid,
        sourceProductTitle,
        discoveredAt,
        relationshipType: item.relationship_type || item.relationshipType || "",
        relationshipDirection: item.relationship_direction || item.relationshipDirection || "",
        timeWindow: item.time_window || item.timeWindow || "",
        relationshipRate: item.relationship_rate ?? item.relationshipRate ?? item.attach_rate ?? null,
        attachRate: item.attach_rate ?? item.attachRate ?? null,
        lift: item.lift ?? null,
        sampleSize,
        confidence,
      },
    },
  }));
}

function getProductRelationshipCandidateItems(summary = {}) {
  return [
    ...getNodes(summary.top_bought_together || summary.topBoughtTogether),
    ...getNodes(summary.top_bought_before || summary.topBoughtBefore),
    ...getNodes(summary.top_bought_after || summary.topBoughtAfter),
    ...getNodes(summary.same_order_relationships || summary.sameOrderRelationships),
    ...getNodes(summary.previous_purchase_relationships || summary.previousPurchaseRelationships),
    ...getNodes(summary.next_purchase_relationships || summary.nextPurchaseRelationships),
  ];
}

function isUnknownProductLabel(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return !normalized || normalized === "unknown product" || normalized === "related product";
}

function mergeSourceCoverage(current, additional) {
  return Array.from(new Set([
    ...getNodes(current),
    ...getNodes(additional),
  ].filter(Boolean)));
}

async function buildNoChangeDiagnosisReuseResult({ shop, jobId, snapshot, deterministic, reuseDecision }) {
  const reusableDiagnosis = await findReusableCompletedDiagnosis({ shop, snapshot });
  if (!reusableDiagnosis) return null;

  const refreshedSnapshot = await persistNoChangeDiagnosisRefresh({ shop, snapshot, deterministic, reuseDecision });
  const activitySnapshot = refreshedSnapshot || snapshot;

  const estimatedImpact = Number(activitySnapshot.metrics?.estimatedImpact ?? activitySnapshot.metrics?.impactRange?.mid ?? 0);
  const modelsUsed = {
    classification: buildCachedAiModelSummary("signal_classification"),
    emergentSentiment: buildCachedAiModelSummary("emergent_sentiment"),
    contentGap: buildCachedAiModelSummary("content_gap", "previous-product-content-analysis"),
    contentCoverageValidation: buildCachedAiModelSummary("content_coverage_validation"),
    actionRationale: buildCachedAiModelSummary("action_rationale"),
    chartInterpretations: buildCachedAiModelSummary("chart_interpretations"),
    relationshipInsights: buildCachedAiModelSummary("relationship_insights"),
    finalReport: buildCachedAiModelSummary("final_report"),
  };
  const aiUsage = summarizeAiUsage([], {
    productGid: snapshot.productGid,
    productHandle: snapshot.handle || null,
    diagnosisMode: "no_change_reuse",
    creditsConsumed: 0,
  });

  await recordJobLog({
    shop,
    jobId,
    event: "product_diagnosis.no_changes_reused",
    message: "No product, order, return, refund, review, or source changes were detected. ProductPulse refreshed deterministic date-based metrics and reused the previous Product Diagnosis without AI calls or credit consumption.",
    data: {
      productGid: activitySnapshot.productGid,
      previousDiagnosisId: reusableDiagnosis.id,
      previousCompletedAt: toIso(reusableDiagnosis.completedAt),
      creditsConsumed: 0,
      aiUsage,
      reuseDecision,
      incrementalDiagnosis: {
        mode: deterministic.metrics.incrementalDiagnosis?.mode || "incremental",
        productContent: deterministic.metrics.incrementalDiagnosis?.productContent || null,
        customerText: deterministic.metrics.incrementalDiagnosis?.customerText || null,
        refunds: deterministic.metrics.incrementalDiagnosis?.refunds || null,
        sourceEvents: deterministic.metrics.incrementalDiagnosis?.sourceEvents || null,
        sourceChanges: deterministic.metrics.incrementalDiagnosis?.sourceChanges || null,
      },
    },
  });

  await Promise.all([
    recordProductScoreHistory({ shop, snapshot: activitySnapshot, source: "full-diagnosis-date-refresh", diagnosisId: reusableDiagnosis.id }),
    recordWatchlistScanActivities(shop, [activitySnapshot], { source: "full-diagnosis", noChangesReused: true, jobId }),
    recordTimelineForNoChangeDiagnosis({ shop, snapshot: activitySnapshot, diagnosisId: reusableDiagnosis.id, jobId }),
  ]);

  return {
    status: "skipped",
    skipped: true,
    skipReason: "no_changes_since_previous_diagnosis",
    message: "No product, order, return, refund, review, or source changes were detected. Deterministic date-based metrics were refreshed, the previous Product Diagnosis was reused, and no credit was consumed.",
    diagnosisId: reusableDiagnosis.id,
    riskScore: activitySnapshot.riskScore,
    confidence: activitySnapshot.confidence,
    estimatedImpact,
    provider: "cache",
    model: "previous-detailed-diagnosis",
    modelsUsed,
    aiUsage,
    creditsConsumed: 0,
  };
}

async function findReusableCompletedDiagnosis({ shop, snapshot }) {
  const latestDiagnosisId = snapshot.metrics?.latestDiagnosisId;
  if (latestDiagnosisId) {
    const byId = await prisma.productDiagnosis.findFirst({
      where: {
        id: latestDiagnosisId,
        shop,
        productGid: snapshot.productGid,
        status: "Completed",
      },
    });
    if (byId) return byId;
  }

  return prisma.productDiagnosis.findFirst({
    where: {
      shop,
      productGid: snapshot.productGid,
      status: "Completed",
    },
    orderBy: [
      { completedAt: "desc" },
      { createdAt: "desc" },
    ],
  });
}

async function buildProductDiagnosisEvolutionContext({ shop, snapshot, deterministic, recommendationCandidates = [], db = prisma } = {}) {
  const previousDiagnosis = await findReusableCompletedDiagnosis({ shop, snapshot });
  if (!previousDiagnosis) {
    return buildProductDiagnosisEvolutionContextFromRecords({
      snapshot,
      deterministic,
      previousDiagnosis: null,
      actionRecords: [],
      recommendationCandidates,
    });
  }

  const actionRecords = await findProductEvolutionActionRecords({
    shop,
    productGid: snapshot.productGid,
    previousDiagnosis,
    db,
  });
  return buildProductDiagnosisEvolutionContextFromRecords({
    snapshot,
    deterministic,
    previousDiagnosis,
    actionRecords,
    recommendationCandidates,
  });
}

async function findProductEvolutionActionRecords({ shop, productGid, previousDiagnosis = null, db = prisma } = {}) {
  if (!shop || !productGid || typeof db?.productAction?.findMany !== "function") return [];
  const previousCompletedAt = parseValidDate(previousDiagnosis?.completedAt || previousDiagnosis?.createdAt);
  const filters = [];
  if (previousCompletedAt) {
    filters.push({ createdAt: { gte: previousCompletedAt } });
    filters.push({ appliedAt: { gte: previousCompletedAt } });
  }
  if (previousDiagnosis?.id) filters.push({ diagnosisId: previousDiagnosis.id });
  if (!filters.length) return [];

  return db.productAction.findMany({
    where: {
      shop,
      productGid,
      OR: filters,
    },
    orderBy: [
      { appliedAt: "desc" },
      { createdAt: "desc" },
    ],
    take: 80,
  });
}

function buildProductDiagnosisEvolutionContextFromRecords({
  snapshot = {},
  deterministic = {},
  previousDiagnosis = null,
  actionRecords = [],
  recommendationCandidates = [],
} = {}) {
  const hasPreviousDiagnosis = Boolean(previousDiagnosis?.id);
  const previousCompletedAt = toIso(previousDiagnosis?.completedAt || previousDiagnosis?.createdAt);
  const normalizedActions = normalizeProductEvolutionActions(actionRecords, { previousCompletedAt, previousDiagnosisId: previousDiagnosis?.id });
  const handledActions = normalizedActions.filter((action) => isHandledProductEvolutionActionStatus(action.status));
  const openActions = normalizedActions.filter((action) => isOpenProductEvolutionActionStatus(action.status));
  const comparisonBaseline = buildProductEvolutionComparisonBaseline({
    previousCompletedAt,
    handledActions,
    openActions,
  });
  const sourceSummary = buildProductEvolutionSourceSummary(deterministic, {
    baselineAt: hasPreviousDiagnosis ? comparisonBaseline.at : null,
    baselineType: comparisonBaseline.type,
    previousDiagnosis,
  });
  const metricChanges = hasPreviousDiagnosis
    ? buildProductEvolutionMetricChanges({ previousDiagnosis, deterministic })
    : [];
  const issueTransition = hasPreviousDiagnosis
    ? buildProductEvolutionIssueTransition({ previousDiagnosis, deterministic })
    : buildEmptyProductEvolutionIssueTransition();
  const handledActionKeys = buildHandledProductEvolutionActionKeys(handledActions);
  const openActionKeys = buildProductEvolutionActionKeys(openActions);
  const previousRecommendationLifecycle = buildProductEvolutionPreviousRecommendationLifecycle({
    hasPreviousDiagnosis,
    previousDiagnosis,
    normalizedActions,
    deterministic,
    previousCompletedAt,
    sourceSummary,
    issueTransition,
  });
  const postActionEvidence = buildProductEvolutionPostActionEvidence({
    hasPreviousDiagnosis,
    comparisonBaseline,
    sourceSummary,
    metricChanges,
    issueTransition,
  });
  const postActionStatus = buildProductEvolutionPostActionStatus({
    hasPreviousDiagnosis,
    previousDiagnosis,
    comparisonBaseline,
    handledActions,
    openActions,
    previousRecommendationLifecycle,
    postActionEvidence,
    sourceSummary,
    metricChanges,
    issueTransition,
  });
  const candidateTransitions = buildProductEvolutionCandidateTransitions({
    recommendationCandidates,
    handledActionKeys,
    openActionKeys,
    previousRecommendationLifecycle,
    sourceSummary,
    issueTransition,
    actionOnly: hasPreviousDiagnosis && handledActions.length > 0 && !sourceSummary.hasNewEvidence,
  });
  const hasUserActionChangesSincePreviousDiagnosis = Boolean(hasPreviousDiagnosis && handledActions.length);
  const hasConcreteProductChangesSincePreviousDiagnosis = Boolean(hasPreviousDiagnosis && (
    sourceSummary.hasNewEvidence
      || (comparisonBaseline.type === "diagnosis" && sourceSummary.hasProductContentChange)
  ));
  const transitionKind = getProductEvolutionTransitionKind({
    hasPreviousDiagnosis,
    hasUserActionChangesSincePreviousDiagnosis,
    hasConcreteProductChangesSincePreviousDiagnosis,
  });
  const context = {
    schemaVersion: 1,
    mode: hasPreviousDiagnosis ? "successive" : "baseline",
    transitionKind,
    hasPreviousDiagnosis,
    previousDiagnosis: hasPreviousDiagnosis ? summarizePreviousDiagnosisForEvolution(previousDiagnosis) : null,
    previousCompletedAt,
    currentRun: {
      productGid: snapshot.productGid || deterministic.product?.id || null,
      productTitle: snapshot.productTitle || deterministic.product?.title || null,
      riskScore: numberOrNull(deterministic.riskScore),
      confidence: numberOrNull(deterministic.confidence),
      mainIssue: deterministic.mainIssue || null,
      mainIssueLabel: deterministic.mainIssueLabel || getHumanIssueLabel(deterministic.mainIssue),
      analyzedAt: new Date().toISOString(),
      incrementalMode: deterministic.metrics?.incrementalDiagnosis?.mode || "full",
    },
    actionsSincePreviousDiagnosis: normalizedActions.slice(0, 12),
    handledActionsSincePreviousDiagnosis: handledActions.slice(0, 10),
    openActionsSincePreviousDiagnosis: openActions.slice(0, 6),
    actionCounts: countProductEvolutionActionStatuses(normalizedActions),
    hasUserActionChangesSincePreviousDiagnosis,
    hasConcreteProductChangesSincePreviousDiagnosis,
    sourceSummary,
    metricChanges,
    issueTransition,
    comparisonBaseline,
    postActionEvidence,
    postActionStatus,
    previousRecommendationLifecycle,
    handledActionKeys: Array.from(handledActionKeys).slice(0, 80),
    openActionKeys: Array.from(openActionKeys).slice(0, 80),
    candidateTransitions,
    recommendationPolicy: {
      actionOnlyReanalysis: transitionKind === "actions_changed",
      suppressExactHandledRecommendationsWhenNoNewEvidence: transitionKind === "actions_changed",
      keepHandledRecommendationsWhenNewEvidencePersists: sourceSummary.hasNewEvidence,
      explainFollowUpForHandledRecommendation: handledActions.length > 0,
      carryForwardPendingRecommendations: true,
      useMonitoringInsteadOfRepeatFixWhenEvidenceIsThin: true,
      markPersistentIssuesAsReopened: true,
    },
  };

  return {
    ...context,
    summary: buildProductEvolutionSummaryText(context),
  };
}

function attachProductEvolutionToDeterministic(deterministic = {}, productEvolution = null) {
  if (!productEvolution) return deterministic;
  return {
    ...deterministic,
    metrics: {
      ...(deterministic.metrics || {}),
      productEvolution,
    },
  };
}

function sanitizeProductEvolutionForAi(productEvolution = null) {
  if (!productEvolution || typeof productEvolution !== "object") return null;
  const postActionStatus = hasEligibleProductEvolutionPostActionStatus(productEvolution)
    ? productEvolution.postActionStatus || null
    : null;
  return {
    schemaVersion: productEvolution.schemaVersion || 1,
    mode: productEvolution.mode || "baseline",
    transitionKind: productEvolution.transitionKind || "baseline",
    hasPreviousDiagnosis: Boolean(productEvolution.hasPreviousDiagnosis || productEvolution.mode === "successive" || productEvolution.previousDiagnosis),
    summary: productEvolution.summary || "",
    previousDiagnosis: productEvolution.previousDiagnosis || null,
    previousCompletedAt: productEvolution.previousCompletedAt || productEvolution.previousDiagnosis?.completedAt || null,
    currentRun: productEvolution.currentRun || null,
    handledActionsSincePreviousDiagnosis: (productEvolution.handledActionsSincePreviousDiagnosis || []).slice(0, 8),
    openActionsSincePreviousDiagnosis: (productEvolution.openActionsSincePreviousDiagnosis || []).slice(0, 4),
    actionCounts: productEvolution.actionCounts || {},
    sourceSummary: productEvolution.sourceSummary || null,
    metricChanges: (productEvolution.metricChanges || []).slice(0, 10),
    issueTransition: productEvolution.issueTransition || null,
    comparisonBaseline: productEvolution.comparisonBaseline || null,
    postActionEvidence: productEvolution.postActionEvidence || null,
    postActionStatus,
    previousRecommendationLifecycle: (productEvolution.previousRecommendationLifecycle || []).slice(0, 10),
    candidateTransitions: (productEvolution.candidateTransitions || []).slice(0, 12),
    recommendationPolicy: productEvolution.recommendationPolicy || null,
  };
}

function summarizeProductEvolutionContext(productEvolution = {}) {
  return {
    mode: productEvolution?.mode || "baseline",
    transitionKind: productEvolution?.transitionKind || "baseline",
    hasPreviousDiagnosis: Boolean(productEvolution?.hasPreviousDiagnosis),
    handledActions: productEvolution?.handledActionsSincePreviousDiagnosis?.length || 0,
    openActions: productEvolution?.openActionsSincePreviousDiagnosis?.length || 0,
    metricChanges: productEvolution?.metricChanges?.length || 0,
    sourceChanges: productEvolution?.sourceSummary?.changes?.length || 0,
    hasNewEvidence: Boolean(productEvolution?.sourceSummary?.hasNewEvidence),
  };
}

function summarizeProductEvolutionForJobLog(productEvolution = {}) {
  return {
    mode: productEvolution?.mode || "baseline",
    transitionKind: productEvolution?.transitionKind || "baseline",
    summary: truncateText(productEvolution?.summary || "", 400),
    actionCounts: productEvolution?.actionCounts || {},
    sourceChanges: productEvolution?.sourceSummary?.changes || [],
    metricChanges: (productEvolution?.metricChanges || []).slice(0, 8),
    postActionStatus: hasEligibleProductEvolutionPostActionStatus(productEvolution) ? productEvolution?.postActionStatus || null : null,
  };
}

function hasEligibleProductEvolutionPostActionStatus(productEvolution = null) {
  if (!productEvolution || typeof productEvolution !== "object") return false;
  const hasPreviousDiagnosis = Boolean(
    productEvolution.hasPreviousDiagnosis
      || productEvolution.mode === "successive"
      || productEvolution.previousDiagnosis,
  );
  return hasPreviousDiagnosis && getProductEvolutionHandledActionCount(productEvolution) > 0;
}

function getProductEvolutionHandledActionCount(productEvolution = null) {
  if (!productEvolution || typeof productEvolution !== "object") return 0;
  const explicitCount = numberOrNull(productEvolution.actionCounts?.handled);
  if (explicitCount !== null) return Math.max(0, explicitCount);
  const handledActions = Array.isArray(productEvolution.handledActionsSincePreviousDiagnosis)
    ? productEvolution.handledActionsSincePreviousDiagnosis
    : [];
  return handledActions.length;
}

function normalizeProductEvolutionActions(actionRecords = [], { previousCompletedAt = null, previousDiagnosisId = null } = {}) {
  const cutoff = parseValidDate(previousCompletedAt);
  const previousId = String(previousDiagnosisId || "").trim();
  return (Array.isArray(actionRecords) ? actionRecords : [])
    .map(normalizeProductEvolutionAction)
    .filter(Boolean)
    .filter((action) => {
      if (!previousId && !cutoff) return true;
      if (previousId && action.sourceDiagnosisId === previousId) return true;
      const handledAt = parseValidDate(action.handledAt || action.appliedAt || action.createdAt);
      return Boolean(cutoff && handledAt && handledAt.getTime() >= cutoff.getTime());
    })
    .sort((first, second) => {
      const firstTime = parseValidDate(first.handledAt || first.appliedAt || first.createdAt)?.getTime() || 0;
      const secondTime = parseValidDate(second.handledAt || second.appliedAt || second.createdAt)?.getTime() || 0;
      return secondTime - firstTime;
    });
}

function normalizeProductEvolutionAction(action = {}) {
  if (!action || typeof action !== "object") return null;
  const payload = action.payload && typeof action.payload === "object" ? action.payload : {};
  const actionId = String(action.actionType || payload.canonicalActionId || payload.sourceActionId || "").trim();
  if (isProductEvolutionInternalAction(actionId, action.label, payload)) return null;
  const status = normalizeProductEvolutionActionStatus(action.status);
  const appliedAt = toIso(action.appliedAt);
  const createdAt = toIso(action.createdAt);
  const handledAt = toIso(action.appliedAt || action.createdAt);
  const label = String(action.label || payload.title || payload.label || actionId || "Product action").trim();
  const actionKeys = Array.from(buildProductEvolutionActionKeySet({
    id: actionId,
    label,
    payload,
    actionAliases: payload.actionAliases,
  })).slice(0, 20);
  return {
    actionId: actionId || normalizeRecommendationRationaleKey(label),
    label,
    status,
    createdAt,
    appliedAt,
    handledAt,
    sourceDiagnosisId: String(action.diagnosisId || payload.sourceDiagnosisId || payload.diagnosisId || "").trim() || null,
    field: payload.field || payload.shopifyField || null,
    operation: payload.operation || payload.placement || payload.changeStrategy || null,
    appliedChange: summarizeProductEvolutionAppliedChange(payload.appliedChange),
    hasDraftText: Boolean(payload.draftText),
    actionKeys,
  };
}

function isProductEvolutionInternalAction(actionId = "", label = "", payload = {}) {
  const normalized = normalizeRecommendationRationaleKey([
    actionId,
    label,
    payload?.sourceActionId,
    payload?.canonicalActionId,
  ].filter(Boolean).join(" "));
  return normalized.includes("run-ai-diagnosis");
}

function normalizeProductEvolutionActionStatus(status = "") {
  const normalized = String(status || "").trim().toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_+|_+$/g, "");
  if (["applied", "completed", "complete", "done"].includes(normalized)) return "applied";
  if (["reviewed", "review"].includes(normalized)) return "reviewed";
  if (["dismissed", "ignored", "cancelled", "canceled"].includes(normalized)) return normalized === "ignored" ? "ignored" : "dismissed";
  if (["active", "restored"].includes(normalized)) return "active";
  if (["pending", "draft"].includes(normalized)) return normalized;
  return normalized || "unknown";
}

function isHandledProductEvolutionActionStatus(status = "") {
  return ["applied", "reviewed", "dismissed", "ignored"].includes(normalizeProductEvolutionActionStatus(status));
}

function isOpenProductEvolutionActionStatus(status = "") {
  return ["draft", "pending", "active"].includes(normalizeProductEvolutionActionStatus(status));
}

function summarizeProductEvolutionAppliedChange(change = null) {
  if (!change || typeof change !== "object") return null;
  return {
    type: change.type || change.kind || null,
    field: change.field || change.shopifyField || null,
    operation: change.operation || change.action || null,
    status: change.status || null,
  };
}

function countProductEvolutionActionStatuses(actions = []) {
  return (Array.isArray(actions) ? actions : []).reduce((counts, action) => {
    const status = normalizeProductEvolutionActionStatus(action.status);
    counts.total += 1;
    counts[status] = (counts[status] || 0) + 1;
    if (isHandledProductEvolutionActionStatus(status)) counts.handled += 1;
    if (isOpenProductEvolutionActionStatus(status)) counts.open += 1;
    return counts;
  }, { total: 0, handled: 0, open: 0 });
}

function buildHandledProductEvolutionActionKeys(actions = []) {
  return buildProductEvolutionActionKeys(actions);
}

function buildProductEvolutionActionKeys(actions = []) {
  const keys = new Set();
  (Array.isArray(actions) ? actions : []).forEach((action) => {
    buildProductEvolutionActionKeySet(action).forEach((key) => keys.add(key));
  });
  return keys;
}

function buildProductEvolutionActionKeySet(action = {}) {
  const payload = action.payload && typeof action.payload === "object" ? action.payload : {};
  const aliases = Array.isArray(action.actionAliases)
    ? action.actionAliases
    : Array.isArray(payload.actionAliases)
      ? payload.actionAliases
      : Array.isArray(action.actionKeys)
        ? action.actionKeys
        : [];
  return new Set([
    action.id,
    action.actionId,
    action.actionType,
    action.label,
    payload.sourceActionId,
    payload.canonicalActionId,
    ...aliases,
  ].map(normalizeRecommendationRationaleKey).filter(Boolean));
}

function buildProductEvolutionComparisonBaseline({
  previousCompletedAt = null,
  handledActions = [],
  openActions = [],
} = {}) {
  const latestHandled = getLatestProductEvolutionAction(handledActions);
  if (latestHandled) {
    return {
      type: "action",
      actionId: latestHandled.actionId || null,
      label: latestHandled.label || "ProductPulse action",
      status: latestHandled.status || null,
      at: latestHandled.handledAt || latestHandled.appliedAt || latestHandled.createdAt || null,
    };
  }
  const latestOpen = getLatestProductEvolutionAction(openActions);
  if (latestOpen) {
    return {
      type: "pending_action",
      actionId: latestOpen.actionId || null,
      label: latestOpen.label || "ProductPulse action",
      status: latestOpen.status || null,
      at: latestOpen.handledAt || latestOpen.appliedAt || latestOpen.createdAt || null,
    };
  }
  return {
    type: "diagnosis",
    actionId: null,
    label: "Previous Product Diagnosis",
    status: "completed",
    at: previousCompletedAt || null,
  };
}

function getLatestProductEvolutionAction(actions = []) {
  return (Array.isArray(actions) ? actions : [])
    .map((action) => ({
      action,
      time: getProductEvolutionActionTime(action),
    }))
    .filter((entry) => entry.time > 0)
    .sort((first, second) => second.time - first.time)[0]?.action || null;
}

function getProductEvolutionActionTime(action = {}) {
  return parseValidDate(action.handledAt || action.appliedAt || action.createdAt)?.getTime() || 0;
}

function buildProductEvolutionPreviousRecommendationLifecycle({
  hasPreviousDiagnosis = false,
  previousDiagnosis = {},
  normalizedActions = [],
  deterministic = {},
  previousCompletedAt = null,
  sourceSummary = {},
  issueTransition = {},
} = {}) {
  if (!hasPreviousDiagnosis) return [];
  const previousRecommendations = normalizePreviousDiagnosisRecommendations(previousDiagnosis.recommendations);
  const usedActionIndexes = new Set();
  const lifecycle = [];

  previousRecommendations.forEach((recommendation) => {
    const match = findLatestProductEvolutionActionForKeys(recommendation, normalizedActions, usedActionIndexes);
    if (match) usedActionIndexes.add(match.index);
    lifecycle.push(buildProductEvolutionLifecycleEntry({
      recommendation,
      action: match?.action || null,
      deterministic,
      previousCompletedAt,
      sourceSummary,
      issueTransition,
    }));
  });

  normalizedActions.forEach((action, index) => {
    if (usedActionIndexes.has(index)) return;
    lifecycle.push(buildProductEvolutionLifecycleEntry({
      recommendation: null,
      action,
      deterministic,
      previousCompletedAt,
      sourceSummary,
      issueTransition,
    }));
  });

  return uniqueBy(lifecycle.filter(Boolean), (entry) => normalizeRecommendationRationaleKey(`${entry.actionId || ""}-${entry.label || ""}-${entry.actionStatus || ""}`)).slice(0, 20);
}

function findLatestProductEvolutionActionForKeys(subject = {}, actions = [], usedActionIndexes = new Set()) {
  const subjectKeys = buildProductEvolutionActionKeySet(subject);
  if (!subjectKeys.size) return null;
  return (Array.isArray(actions) ? actions : [])
    .map((action, index) => ({ action, index, time: getProductEvolutionActionTime(action) }))
    .filter((entry) => !usedActionIndexes.has(entry.index))
    .filter((entry) => {
      const actionKeys = buildProductEvolutionActionKeySet(entry.action);
      return Array.from(subjectKeys).some((key) => actionKeys.has(key));
    })
    .sort((first, second) => second.time - first.time)[0] || null;
}

function buildProductEvolutionLifecycleEntry({
  recommendation = null,
  action = null,
  deterministic = {},
  previousCompletedAt = null,
  sourceSummary = {},
  issueTransition = {},
} = {}) {
  const actionId = action?.actionId || recommendation?.actionId || recommendation?.id || "";
  const label = action?.label || recommendation?.label || actionId || "ProductPulse action";
  const actionStatus = normalizeProductEvolutionActionStatus(action?.status || recommendation?.status || (action ? "unknown" : "pending"));
  const baselineAt = action?.handledAt || action?.appliedAt || action?.createdAt || previousCompletedAt || null;
  const actionSourceSummary = baselineAt
    ? buildProductEvolutionSourceSummary(deterministic, {
      baselineAt,
      baselineType: action ? "action" : "diagnosis",
    })
    : sourceSummary;
  const subjectIssueKeys = buildProductEvolutionSubjectIssueKeys({ action, recommendation });
  const lifecycleState = getProductEvolutionLifecycleState({ actionStatus, action, sourceSummary: actionSourceSummary, issueTransition, subjectIssueKeys });
  return {
    actionId,
    label,
    type: recommendation?.type || action?.type || "",
    actionStatus,
    lifecycleState,
    lifecycleLabel: getProductEvolutionLifecycleLabel(lifecycleState),
    handledAt: action?.handledAt || action?.appliedAt || action?.createdAt || null,
    postActionEvidence: buildProductEvolutionPostActionEvidence({
      hasPreviousDiagnosis: true,
      comparisonBaseline: {
        type: action ? "action" : "diagnosis",
        actionId,
        label,
        status: actionStatus,
        at: baselineAt,
      },
      sourceSummary: actionSourceSummary,
      metricChanges: [],
      issueTransition,
      subjectIssueKeys,
    }),
    sourceDiagnosisId: action?.sourceDiagnosisId || null,
    matchedStoredAction: Boolean(action),
    issueKey: subjectIssueKeys[0] || action?.field || action?.operation || null,
    subjectIssueKeys,
    reason: buildProductEvolutionLifecycleReason({ label, actionStatus, lifecycleState, sourceSummary: actionSourceSummary, issueTransition, subjectIssueKeys }),
    actionKeys: Array.from(buildProductEvolutionActionKeySet({
      id: actionId,
      actionId,
      label,
      actionAliases: action?.actionKeys,
    })).slice(0, 20),
  };
}

function getProductEvolutionLifecycleState({
  actionStatus = "",
  action = null,
  sourceSummary = {},
  issueTransition = {},
  subjectIssueKeys = [],
} = {}) {
  const status = normalizeProductEvolutionActionStatus(actionStatus);
  if (!action || isOpenProductEvolutionActionStatus(status)) return "pending";
  if (hasPersistentPostActionIssue(sourceSummary, issueTransition, subjectIssueKeys)) return "reopened/persistent";
  if (["dismissed", "ignored"].includes(status)) return "superseded";
  if (["applied", "reviewed"].includes(status)) {
    if (!sourceSummary.hasNewEvidence) return "monitoring";
    if (hasResolvedPostActionIssue(issueTransition)) return "superseded";
    return "applied";
  }
  return "new";
}

function hasPersistentPostActionIssue(sourceSummary = {}, issueTransition = {}, subjectIssueKeys = []) {
  if (!sourceSummary.hasNewEvidence) return false;
  const persistingKeys = new Set((Array.isArray(issueTransition.persisting) ? issueTransition.persisting : [])
    .map((issue) => normalizeIssueCode(issue?.key || issue?.issueCode || issue?.label))
    .filter(Boolean));
  if (!persistingKeys.size) return false;
  const postActionIssueKeys = getProductEvolutionPostActionIssueKeySet(sourceSummary);
  if (!postActionIssueKeys.size) return false;
  const subjectKeys = normalizeProductEvolutionIssueKeys(subjectIssueKeys);
  const candidateKeys = subjectKeys.length ? subjectKeys : Array.from(persistingKeys);
  return candidateKeys.some((key) => persistingKeys.has(key) && postActionIssueKeys.has(key));
}

function hasResolvedPostActionIssue(issueTransition = {}) {
  const persisting = Array.isArray(issueTransition.persisting) ? issueTransition.persisting : [];
  const resolved = Array.isArray(issueTransition.noLongerDetected) ? issueTransition.noLongerDetected : [];
  return resolved.length > 0 && persisting.length === 0;
}

function getProductEvolutionLifecycleLabel(state = "") {
  const normalized = String(state || "").trim().toLowerCase();
  if (normalized === "pending") return "Pending";
  if (normalized === "applied") return "Applied";
  if (normalized === "monitoring") return "Monitoring";
  if (normalized === "reopened/persistent") return "Reopened / persistent";
  if (normalized === "superseded") return "Superseded";
  return "New";
}

function buildProductEvolutionLifecycleReason({
  label = "",
  actionStatus = "",
  lifecycleState = "",
  sourceSummary = {},
  issueTransition = {},
  subjectIssueKeys = [],
} = {}) {
  const actionLabel = label || "This action";
  if (lifecycleState === "pending") return `${actionLabel} is still pending from the prior diagnosis.`;
  if (lifecycleState === "reopened/persistent") {
    const issue = getProductEvolutionPostActionPersistingIssues(issueTransition, sourceSummary, subjectIssueKeys)[0]?.label
      || issueTransition.persisting?.[0]?.label;
    return `${actionLabel} was ${actionStatus}, but new post-action evidence still shows ${issue || "the same issue"}.`;
  }
  if (lifecycleState === "monitoring") return `${actionLabel} was ${actionStatus}, and there is not enough new post-action evidence to repeat the same fix.`;
  if (lifecycleState === "superseded") return `${actionLabel} was ${actionStatus}, and the previous issue is no longer the current best next step.`;
  if (lifecycleState === "applied") return `${actionLabel} was ${actionStatus}, and new evidence should be interpreted as follow-up context.`;
  if (sourceSummary.hasNewEvidence) return `${actionLabel} is new relative to the previous action history.`;
  return `${actionLabel} is a new recommendation for the current diagnosis.`;
}

function buildProductEvolutionPostActionEvidence({
  hasPreviousDiagnosis = false,
  comparisonBaseline = null,
  sourceSummary = {},
  metricChanges = [],
  issueTransition = {},
  subjectIssueKeys = [],
} = {}) {
  if (!hasPreviousDiagnosis) return null;
  const evidenceTypes = (Array.isArray(sourceSummary.changes) ? sourceSummary.changes : [])
    .map((change) => change.label || change.type)
    .filter(Boolean)
    .slice(0, 5);
  const issueChanges = buildProductEvolutionPostActionIssueChanges(issueTransition, sourceSummary, subjectIssueKeys);
  return {
    baselineType: comparisonBaseline?.type || "diagnosis",
    baselineLabel: comparisonBaseline?.label || "Previous Product Diagnosis",
    baselineAt: comparisonBaseline?.at || null,
    hasPostActionEvidence: Boolean(sourceSummary.hasNewEvidence),
    evidenceTypes,
    metricChanges: (Array.isArray(metricChanges) ? metricChanges : []).slice(0, 8),
    issueChanges,
    summary: buildProductEvolutionPostActionEvidenceText({ sourceSummary, metricChanges, issueTransition: issueChanges }),
  };
}

function buildProductEvolutionPostActionIssueChanges(issueTransition = {}, sourceSummary = {}, subjectIssueKeys = []) {
  const postActionIssueKeys = getProductEvolutionPostActionIssueKeySet(sourceSummary);
  const subjectKeys = new Set(normalizeProductEvolutionIssueKeys(subjectIssueKeys));
  const shouldFilterPersisting = Boolean(sourceSummary.hasNewEvidence && postActionIssueKeys.size);
  const matchesPostActionIssue = (issue = {}) => {
    const key = normalizeIssueCode(issue.key || issue.issueCode || issue.label);
    if (!key) return false;
    if (!postActionIssueKeys.has(key)) return false;
    return !subjectKeys.size || subjectKeys.has(key);
  };
  const filterPostActionIssueList = (issues = []) => (Array.isArray(issues) ? issues : [])
    .filter((issue) => {
      if (!sourceSummary.hasNewEvidence || !postActionIssueKeys.size) return true;
      const key = normalizeIssueCode(issue?.key || issue?.issueCode || issue?.label);
      return Boolean(key && postActionIssueKeys.has(key));
    });

  return {
    persisting: (shouldFilterPersisting
      ? (Array.isArray(issueTransition.persisting) ? issueTransition.persisting : []).filter(matchesPostActionIssue)
      : (issueTransition.persisting || [])
    ).slice(0, 4),
    noLongerDetected: (issueTransition.noLongerDetected || []).slice(0, 4),
    newlyDetected: filterPostActionIssueList(issueTransition.newlyDetected).slice(0, 4),
  };
}

function getProductEvolutionPostActionPersistingIssues(issueTransition = {}, sourceSummary = {}, subjectIssueKeys = []) {
  return buildProductEvolutionPostActionIssueChanges(issueTransition, sourceSummary, subjectIssueKeys).persisting || [];
}

function getProductEvolutionPostActionIssueKeySet(sourceSummary = {}) {
  return new Set(normalizeProductEvolutionIssueKeys([
    ...(Array.isArray(sourceSummary.postActionIssueKeys) ? sourceSummary.postActionIssueKeys : []),
    ...(Array.isArray(sourceSummary.postActionIssueCounts) ? sourceSummary.postActionIssueCounts.map((item) => item?.key || item?.issueCode || item?.label) : []),
    ...(Array.isArray(sourceSummary.postBaseline?.issueKeys) ? sourceSummary.postBaseline.issueKeys : []),
    ...(Array.isArray(sourceSummary.postBaseline?.issueCounts) ? sourceSummary.postBaseline.issueCounts.map((item) => item?.key || item?.issueCode || item?.label) : []),
  ]));
}

function buildProductEvolutionSubjectIssueKeys({ action = null, recommendation = null } = {}) {
  return normalizeProductEvolutionIssueKeys([
    collectProductEvolutionIssueCandidateValues(action),
    collectProductEvolutionIssueCandidateValues(recommendation),
  ].flat());
}

function collectProductEvolutionIssueCandidateValues(subject = null) {
  if (!subject || typeof subject !== "object") return [];
  const payload = subject.payload && typeof subject.payload === "object" ? subject.payload : {};
  return [
    subject.issue,
    subject.issueCode,
    subject.issueKey,
    subject.reasonCategory,
    subject.actionId,
    subject.id,
    subject.actionType,
    subject.label,
    subject.type,
    subject.field,
    subject.shopifyField,
    subject.operation,
    payload.issue,
    payload.issueCode,
    payload.issueKey,
    payload.reasonCategory,
    payload.trigger,
    payload.proposedChange,
    payload.canonicalActionId,
    payload.sourceActionId,
    payload.shopifyField,
    payload.field,
    payload.operation,
    ...(Array.isArray(subject.actionKeys) ? subject.actionKeys : []),
    ...(Array.isArray(subject.actionAliases) ? subject.actionAliases : []),
    ...(Array.isArray(payload.actionKeys) ? payload.actionKeys : []),
    ...(Array.isArray(payload.actionAliases) ? payload.actionAliases : []),
  ].filter(Boolean);
}

function normalizeProductEvolutionIssueKeys(values = []) {
  return uniqueBy((Array.isArray(values) ? values : [values])
    .flatMap((value) => {
      if (value == null) return [];
      if (Array.isArray(value)) return normalizeProductEvolutionIssueKeys(value);
      const key = inferProductEvolutionIssueKey(value);
      return key ? [key] : [];
    }), (key) => key);
}

function inferProductEvolutionIssueKey(value = "") {
  if (value == null) return "";
  if (typeof value === "object") {
    const payload = value.payload && typeof value.payload === "object" ? value.payload : {};
    return normalizeProductEvolutionIssueKeys([
      value.issueCode,
      value.issue,
      value.issueKey,
      value.category,
      value.issueCategory,
      value.reasonCategory,
      value.reasonCode,
      value.reasonLabel,
      value.reasonText,
      value.returnReason,
      value.refundReason,
      value.label,
      value.title,
      value.text,
      value.analysisText,
      value.source,
      payload.issue,
      payload.issueCode,
      payload.issueKey,
      payload.reasonCategory,
      payload.trigger,
    ])[0] || "";
  }

  const text = String(value || "").trim();
  if (!text) return "";
  const normalized = normalizeText(text).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!normalized) return "";
  if (normalized.includes("too_big")
    || normalized.includes("too_large")
    || normalized.includes("too_small")
    || normalized.includes("too_tight")
    || normalized.includes("too_loose")
    || normalized.includes("runs_small")
    || normalized.includes("runs_large")
    || normalized.includes("wrong_size")
  ) return "fit_sizing";

  const direct = normalizeIssueCode(text);
  if (direct) {
    if (direct === "product_quality") return "quality_defect";
    if (PRODUCT_EVOLUTION_KNOWN_ISSUE_KEYS.has(direct)) return direct;
  }

  if (normalized.includes("damaged")
    || normalized.includes("broken")
    || normalized.includes("defective")
    || normalized.includes("supplier")
    || normalized.includes("qa")
    || normalized.includes("quality_control")
  ) return "quality_defect";
  if (normalized.includes("seo")
    || normalized.includes("pdp")
    || normalized.includes("copy")
    || normalized.includes("description")
    || normalized.includes("metadata")
  ) return "product_content";
  return "";
}

function buildProductEvolutionPostActionEvidenceText({
  sourceSummary = {},
  metricChanges = [],
  issueTransition = {},
} = {}) {
  if (!sourceSummary.hasNewEvidence) {
    return "No new orders, returns, refunds, reviews, customer language or product-content changes were detected after the comparison point.";
  }
  const sourceText = summarizeProductEvolutionSourceText(sourceSummary).replace(/\.$/, "");
  const metricText = summarizeProductEvolutionMetricText(metricChanges).replace(/\.$/, "");
  const issueText = summarizeProductEvolutionIssueText(issueTransition).replace(/\.$/, "");
  return [sourceText, metricText, issueText].filter(Boolean).join(". ") || "New post-action evidence was detected in this run.";
}

function buildProductEvolutionPostActionStatus({
  hasPreviousDiagnosis = false,
  previousDiagnosis = {},
  comparisonBaseline = null,
  handledActions = [],
  openActions = [],
  previousRecommendationLifecycle = [],
  postActionEvidence = null,
  sourceSummary = {},
  metricChanges = [],
  issueTransition = {},
} = {}) {
  const handledCount = (Array.isArray(handledActions) ? handledActions : []).length;
  if (!hasPreviousDiagnosis || handledCount < 1) return null;
  const lifecycleCounts = countProductEvolutionLifecycleStates(previousRecommendationLifecycle);
  const reopenedCount = lifecycleCounts["reopened/persistent"] || 0;
  const pendingCount = lifecycleCounts.pending || 0;
  const monitoringCount = lifecycleCounts.monitoring || 0;
  const status = getProductEvolutionPostActionStatusState({
    reopenedCount,
    pendingCount,
    monitoringCount,
    handledCount,
    sourceSummary,
    metricChanges,
    issueTransition,
  });
  return {
    title: "Post-action status",
    status,
    tone: getProductEvolutionPostActionTone(status),
    summary: buildProductEvolutionPostActionStatusSummary({
      status,
      handledCount,
      pendingCount,
      reopenedCount,
      sourceSummary,
      issueTransition,
    }),
    historicalDiagnosis: buildProductEvolutionHistoricalDiagnosisText(previousDiagnosis),
    postActionEvidence: postActionEvidence?.summary || "",
    nextBestStep: buildProductEvolutionNextBestStepText({ status, pendingCount, reopenedCount, monitoringCount }),
    comparisonBaseline,
    lifecycleCounts,
    lifecycle: previousRecommendationLifecycle.slice(0, 10),
    alreadyDone: (Array.isArray(handledActions) ? handledActions : []).slice(0, 5).map((action) => ({
      label: action.label,
      status: action.status,
      handledAt: action.handledAt || action.appliedAt || action.createdAt || null,
    })),
    pendingActions: (Array.isArray(openActions) ? openActions : []).slice(0, 5).map((action) => ({
      label: action.label,
      status: action.status,
      createdAt: action.createdAt || null,
    })),
  };
}

function countProductEvolutionLifecycleStates(entries = []) {
  return (Array.isArray(entries) ? entries : []).reduce((counts, entry) => {
    const state = String(entry?.lifecycleState || "new").trim() || "new";
    counts.total += 1;
    counts[state] = (counts[state] || 0) + 1;
    return counts;
  }, { total: 0 });
}

function getProductEvolutionPostActionStatusState({
  reopenedCount = 0,
  pendingCount = 0,
  monitoringCount = 0,
  handledCount = 0,
  sourceSummary = {},
  metricChanges = [],
  issueTransition = {},
} = {}) {
  if (reopenedCount > 0) return "reopened_persistent";
  if (pendingCount > 0 && handledCount === 0) return "pending";
  if (monitoringCount > 0 && !sourceSummary.hasNewEvidence) return "monitoring";
  if (hasResolvedPostActionIssue(issueTransition)) return "improved";
  if (sourceSummary.hasNewEvidence) return "changed";
  if (hasMeaningfulRiskImprovement(metricChanges)) return "improved";
  return "no_material_change";
}

function hasMeaningfulRiskImprovement(metricChanges = []) {
  return (Array.isArray(metricChanges) ? metricChanges : []).some((change) => (
    ["riskScore", "returnRate", "refundRate", "negativeReviewCount", "contentIssueCount"].includes(change.key)
      && Number(change.delta || 0) < 0
  ));
}

function getProductEvolutionPostActionTone(status = "") {
  if (status === "reopened_persistent") return "critical";
  if (status === "pending" || status === "changed") return "warning";
  if (status === "improved") return "success";
  return "info";
}

function buildProductEvolutionPostActionStatusSummary({
  status = "",
  handledCount = 0,
  pendingCount = 0,
  reopenedCount = 0,
  sourceSummary = {},
  issueTransition = {},
} = {}) {
  if (status === "reopened_persistent") {
    const issue = issueTransition.persisting?.[0]?.label;
    return `${reopenedCount} prior action${reopenedCount === 1 ? "" : "s"} look reopened because new evidence still shows ${issue || "the same issue"}.`;
  }
  if (status === "pending") return `${pendingCount} prior recommendation${pendingCount === 1 ? " is" : "s are"} still pending before this diagnosis should create another fix.`;
  if (status === "improved") return "The product looks improved relative to the previous diagnosis or handled action.";
  if (status === "monitoring") return `${handledCount} action${handledCount === 1 ? " was" : "s were"} handled, but there is not enough post-action evidence yet to know whether ${handledCount === 1 ? "it worked" : "they worked"}.`;
  if (status === "changed") {
    const sourceLabel = sourceSummary.changes?.[0]?.label || "new evidence";
    return `The diagnosis includes ${sourceLabel.toLowerCase()} after the prior diagnosis/action.`;
  }
  return "No material post-action product or evidence movement was detected.";
}

function buildProductEvolutionHistoricalDiagnosisText(previousDiagnosis = {}) {
  const completedAt = toIso(previousDiagnosis.completedAt || previousDiagnosis.createdAt);
  const cause = previousDiagnosis.likelyCause || previousDiagnosis.metrics?.mainIssueLabel || previousDiagnosis.metrics?.primaryIssue || "a product issue";
  return `Previous diagnosis${completedAt ? ` completed at ${completedAt}` : ""} focused on ${cause}.`;
}

function buildProductEvolutionNextBestStepText({
  status = "",
  pendingCount = 0,
  reopenedCount = 0,
} = {}) {
  if (status === "reopened_persistent") return `Treat ${reopenedCount === 1 ? "the issue" : "these issues"} as persistent/reopened and escalate the next action instead of repeating the same fix.`;
  if (status === "pending") return `Review or complete the ${pendingCount === 1 ? "pending recommendation" : "pending recommendations"} before adding another similar action.`;
  if (status === "improved") return "Avoid unnecessary new fixes; keep monitoring and only act again if fresh evidence returns.";
  if (status === "monitoring") return `Wait for new orders, returns, refunds or reviews before judging the change; add the product to Watchlist if its Sales Momentum is worth tracking.`;
  if (status === "changed") return "Use the new evidence to decide whether the prior recommendation should stay pending, be superseded, or reopen as an escalation.";
  return "Keep the prior diagnosis as historical context and monitor for new orders, returns, refunds, reviews or customer language.";
}

function buildProductEvolutionSourceSummary(deterministic = {}, { baselineAt = null, baselineType = "diagnosis", previousDiagnosis = null } = {}) {
  const incremental = deterministic.metrics?.incrementalDiagnosis || {};
  const productContent = incremental.productContent || {};
  const customerText = incremental.customerText || {};
  const refunds = incremental.refunds || {};
  const sourceEvents = incremental.sourceEvents || incremental.sourceChanges?.sourceEventFetch || {};
  const rawCounts = sourceEvents.rawFetchedCounts || {};
  const changes = [];
  const baselineDate = parseValidDate(baselineAt);
  if (baselineDate) {
    const postBaseline = buildProductEvolutionPostBaselineSourceSummary(deterministic, baselineDate, { previousDiagnosis });
    const eventCounts = postBaseline.eventCounts || {};
    if (postBaseline.productContentChanged) {
      changes.push({
        type: "product_content",
        label: "Product content changed",
        count: 1,
        detail: "Product content changed after the comparison point.",
      });
    }
    if (eventCounts.salesEvents > 0) {
      changes.push({
        type: "orders",
        label: "New/current orders",
        count: eventCounts.salesEvents,
        detail: "Shopify order activity was detected after the comparison point or was newly present compared with the previous diagnosis cache.",
      });
    }
    if (eventCounts.returnEvents > 0) {
      changes.push({
        type: "returns",
        label: "New/current returns",
        count: eventCounts.returnEvents,
        detail: "Return activity was detected after the comparison point or was newly present compared with the previous diagnosis cache.",
      });
    }
    if (eventCounts.refundEvents > 0) {
      changes.push({
        type: "refunds",
        label: "New/current refunds",
        count: eventCounts.refundEvents,
        detail: "Refund activity was detected after the comparison point or was newly present compared with the previous diagnosis cache.",
      });
    }
    if (eventCounts.reviewEvents > 0) {
      changes.push({
        type: "reviews",
        label: "New reviews after action",
        count: eventCounts.reviewEvents,
        detail: "Review/customer-language activity was detected after the comparison point.",
      });
    }
    if (eventCounts.evidenceSnippets > 0 && !changes.some((change) => ["orders", "returns", "refunds", "reviews"].includes(change.type))) {
      changes.push({
        type: "dated_evidence",
        label: "New dated evidence after action",
        count: eventCounts.evidenceSnippets,
        detail: "Dated diagnosis evidence was detected after the comparison point.",
      });
    }

    return {
      mode: incremental.mode || "full",
      previousCompletedAt: incremental.previousCompletedAt || null,
      cutoffAt: incremental.cutoffAt || null,
      baselineAt: toIso(baselineDate),
      baselineType,
      hasNewEvidence: postBaseline.hasOutcomeEvidence,
      hasOutcomeEvidence: postBaseline.hasOutcomeEvidence,
      hasConcreteChange: postBaseline.hasOutcomeEvidence || postBaseline.productContentChanged,
      hasProductContentChange: postBaseline.productContentChanged,
      aiEvidenceSnippetCount: eventCounts.evidenceSnippets || 0,
      sourceFingerprintChanged: false,
      sourceExtractionComplete: incremental.sourceChanges?.sourceExtractionComplete !== false,
      eventCounts,
      postActionIssueCounts: postBaseline.issueCounts || [],
      postActionIssueKeys: postBaseline.issueKeys || [],
      postBaseline,
      changes: changes.slice(0, 8),
    };
  }

  const sourceEventChangeCount = ["salesEvents", "refundEvents", "returnEvents"]
    .reduce((total, key) => total + Math.max(0, Number(rawCounts[key] || 0)), 0);

  if (productContent.changed) {
    changes.push({
      type: "product_content",
      label: "Product content changed",
      detail: productContent.reason || "Product content was analyzed as changed since the previous diagnosis.",
    });
  }
  if (Number(customerText.analyzedItems || 0) > 0) {
    changes.push({
      type: "customer_text",
      label: "New customer text analyzed",
      count: Number(customerText.analyzedItems || 0),
      detail: customerText.reason || "",
    });
  }
  if (Number(refunds.analyzedItems || 0) > 0) {
    changes.push({
      type: "refund_text",
      label: "New refund context analyzed",
      count: Number(refunds.analyzedItems || 0),
      detail: refunds.reason || "",
    });
  }
  if (sourceEventChangeCount > 0) {
    changes.push({
      type: "source_events",
      label: "New source events fetched",
      counts: {
        salesEvents: Number(rawCounts.salesEvents || 0),
        returnEvents: Number(rawCounts.returnEvents || 0),
        refundEvents: Number(rawCounts.refundEvents || 0),
      },
      detail: sourceEvents.reason || sourceEvents.mode || "",
    });
  }

  const aiEvidenceSnippetCount = Number(incremental.aiEvidenceSnippetCount ?? deterministic.evidenceSnippets?.length ?? 0);
  const sourceFingerprintChanged = incremental.sourceChanges?.unchanged === false
    && !isIncrementalSourceFetchWithoutNewEvents(incremental.sourceChanges?.sourceEventFetch || sourceEvents);
  const hasNewEvidence = Boolean(
    changes.length
      || aiEvidenceSnippetCount > 0
      || sourceFingerprintChanged,
  );

  return {
    mode: incremental.mode || "full",
    previousCompletedAt: incremental.previousCompletedAt || null,
    cutoffAt: incremental.cutoffAt || null,
    hasNewEvidence,
    hasOutcomeEvidence: hasNewEvidence,
    hasConcreteChange: hasNewEvidence,
    hasProductContentChange: Boolean(productContent.changed),
    aiEvidenceSnippetCount,
    sourceFingerprintChanged,
    sourceExtractionComplete: incremental.sourceChanges?.sourceExtractionComplete !== false,
    changes: changes.slice(0, 8),
  };
}

function buildProductEvolutionPostBaselineSourceSummary(deterministic = {}, baselineDate = null, { previousDiagnosis = null } = {}) {
  const baseline = parseValidDate(baselineDate);
  const incremental = deterministic.metrics?.incrementalDiagnosis || {};
  const cache = incremental.cache || {};
  const cachedSourceEvents = cache.sourceEvents || {};
  const previousSourceEvents = previousDiagnosis?.metrics?.incrementalDiagnosis?.cache?.sourceEvents || {};
  const customerTextCache = cache.customerText || {};
  const refundCache = cache.refunds || {};
  const sourceSales = getProductEvolutionSourceItemsAfterOrNew(cachedSourceEvents.sales, previousSourceEvents.sales, "sales", baseline);
  const sourceReturns = getProductEvolutionSourceItemsAfterOrNew(cachedSourceEvents.returns, previousSourceEvents.returns, "returns", baseline);
  const sourceRefunds = getProductEvolutionSourceItemsAfterOrNew(cachedSourceEvents.refunds, previousSourceEvents.refunds, "refunds", baseline);
  const returnTextItems = getProductEvolutionDatedItemsAfter(customerTextCache.returnItems, baseline);
  const reviewTextItems = getProductEvolutionDatedItemsAfter(customerTextCache.reviewItems, baseline);
  const refundTextItems = getProductEvolutionDatedItemsAfter(refundCache.items, baseline);
  const evidenceSnippets = getProductEvolutionDatedItemsAfter(deterministic.evidenceSnippets, baseline);
  const productUpdatedAt = parseValidDate(incremental.productContent?.productUpdatedAt);
  const productContentChanged = Boolean(productUpdatedAt && baseline && productUpdatedAt.getTime() > baseline.getTime());
  const returnCount = Math.max(sourceReturns.length, returnTextItems.length);
  const refundCount = Math.max(sourceRefunds.length, refundTextItems.length);
  const reviewCount = reviewTextItems.length;
  const eventCounts = {
    salesEvents: sourceSales.length,
    returnEvents: returnCount,
    refundEvents: refundCount,
    reviewEvents: reviewCount,
    customerTextEvents: returnTextItems.length + reviewTextItems.length,
    refundTextEvents: refundTextItems.length,
    evidenceSnippets: evidenceSnippets.length,
  };
  const issueSummary = buildProductEvolutionPostBaselineIssueSummary([
    ...sourceReturns,
    ...sourceRefunds,
    ...returnTextItems,
    ...reviewTextItems,
    ...refundTextItems,
    ...evidenceSnippets,
    ...(productContentChanged ? [{ issueCode: "product_content", count: 1 }] : []),
  ]);
  const outcomeEvidenceCount = eventCounts.salesEvents
    + eventCounts.returnEvents
    + eventCounts.refundEvents
    + eventCounts.reviewEvents
    + eventCounts.customerTextEvents
    + eventCounts.refundTextEvents
    + eventCounts.evidenceSnippets;

  return {
    baselineAt: toIso(baseline),
    eventCounts,
    issueCounts: issueSummary.counts,
    issueKeys: issueSummary.keys,
    hasOutcomeEvidence: outcomeEvidenceCount > 0,
    productContentChanged,
    latestEvidenceAt: getLatestProductEvolutionEvidenceDate([
      ...sourceSales,
      ...sourceReturns,
      ...sourceRefunds,
      ...returnTextItems,
      ...reviewTextItems,
      ...refundTextItems,
      ...evidenceSnippets,
    ]),
  };
}

function getProductEvolutionDatedItemsAfter(items = [], baselineDate = null) {
  const baseline = parseValidDate(baselineDate);
  if (!baseline) return [];
  return (Array.isArray(items) ? items : []).filter((item) => {
    const date = getProductEvolutionEvidenceDate(item);
    return Boolean(date && date.getTime() > baseline.getTime());
  });
}

function buildProductEvolutionPostBaselineIssueSummary(items = []) {
  const counts = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = inferProductEvolutionIssueKey(item);
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + getProductEvolutionIssueEvidenceWeight(item));
  });
  const ordered = Array.from(counts.entries())
    .sort((first, second) => second[1] - first[1])
    .map(([key, count]) => ({
      key,
      label: getHumanIssueLabel(key),
      count,
    }));
  return {
    keys: ordered.map((item) => item.key),
    counts: ordered,
  };
}

function getProductEvolutionIssueEvidenceWeight(item = {}) {
  const quantity = Number(item.quantity ?? item.returnQuantity ?? item.refundedQuantity ?? item.count ?? 1);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

function getProductEvolutionSourceItemsAfterOrNew(items = [], previousItems = [], type = "", baselineDate = null) {
  const currentItems = Array.isArray(items) ? items : [];
  const datedItems = getProductEvolutionDatedItemsAfter(currentItems, baselineDate);
  const previousKeys = buildProductEvolutionSourceEventKeySet(previousItems, type);
  if (!previousKeys.size) return datedItems;

  const seen = new Set(datedItems.map((item) => getSourceEventCacheKey(type, item)).filter(Boolean));
  const newlyKnownItems = currentItems.filter((item) => {
    const key = getSourceEventCacheKey(type, item);
    if (!key || previousKeys.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...datedItems, ...newlyKnownItems];
}

function buildProductEvolutionSourceEventKeySet(items = [], type = "") {
  return new Set((Array.isArray(items) ? items : [])
    .map((item) => getSourceEventCacheKey(type, item))
    .filter(Boolean));
}

function getProductEvolutionEvidenceDate(item = {}) {
  return parseValidDate(
    item?.orderDate
      || item?.orderProcessedAt
      || item?.orderCreatedAt
      || item?.reviewDate
      || item?.date
      || item?.changedAt
      || item?.createdAt
      || item?.processedAt
      || item?.updatedAt,
  );
}

function getLatestProductEvolutionEvidenceDate(items = []) {
  const latest = (Array.isArray(items) ? items : [])
    .map((item) => getProductEvolutionEvidenceDate(item)?.getTime() || 0)
    .filter((time) => time > 0)
    .sort((first, second) => second - first)[0];
  return latest ? new Date(latest).toISOString() : null;
}

function buildProductEvolutionMetricChanges({ previousDiagnosis = {}, deterministic = {} } = {}) {
  const currentMetrics = deterministic.metrics || {};
  const previousMetrics = previousDiagnosis.metrics || {};
  const currentIssue = deterministic.mainIssueLabel || getHumanIssueLabel(deterministic.mainIssue);
  const previousIssue = previousDiagnosis.likelyCause || previousMetrics.mainIssueLabel || previousMetrics.primaryIssue || "";
  const changes = [];
  const addNumber = ({ key, label, previous, current, threshold = 1, unit = "" }) => {
    const previousNumber = numberOrNull(previous);
    const currentNumber = numberOrNull(current);
    if (previousNumber == null || currentNumber == null) return;
    const delta = roundRate(currentNumber - previousNumber, Math.abs(currentNumber - previousNumber) < 10 ? 2 : 0);
    if (Math.abs(delta) < threshold) return;
    changes.push({
      key,
      label,
      from: previousNumber,
      to: currentNumber,
      delta,
      unit,
      direction: delta > 0 ? "up" : "down",
    });
  };

  if (previousIssue && currentIssue && normalizeText(previousIssue) !== normalizeText(currentIssue)) {
    changes.push({
      key: "main_issue",
      label: "Main issue",
      from: previousIssue,
      to: currentIssue,
      direction: "changed",
    });
  }

  addNumber({ key: "riskScore", label: "Risk score", previous: previousDiagnosis.riskScore, current: deterministic.riskScore, threshold: 1, unit: "points" });
  addNumber({ key: "confidence", label: "Confidence", previous: previousDiagnosis.confidence, current: deterministic.confidence, threshold: 1, unit: "points" });
  addNumber({ key: "soldUnits", label: "Sold units", previous: previousMetrics.soldUnits, current: currentMetrics.soldUnits, threshold: 1, unit: "units" });
  addNumber({ key: "salesAmount", label: "Sales", previous: previousMetrics.salesAmount, current: currentMetrics.salesAmount, threshold: 1, unit: "currency" });
  addNumber({ key: "returnUnits", label: "Returned units", previous: previousMetrics.returnUnits, current: currentMetrics.returnUnits, threshold: 1, unit: "units" });
  addNumber({ key: "refundUnits", label: "Refunded units", previous: previousMetrics.refundUnits, current: currentMetrics.refundUnits, threshold: 1, unit: "units" });
  addNumber({ key: "refundAmount", label: "Refund amount", previous: previousMetrics.refundAmount, current: currentMetrics.refundAmount, threshold: 1, unit: "currency" });
  addNumber({ key: "returnRate", label: "Return rate", previous: previousMetrics.returnRate, current: currentMetrics.returnRate, threshold: 0.2, unit: "%" });
  addNumber({ key: "refundRate", label: "Refund rate", previous: previousMetrics.refundRate, current: currentMetrics.refundRate, threshold: 0.2, unit: "%" });
  addNumber({ key: "negativeReviewCount", label: "Negative reviews", previous: previousMetrics.negativeReviewCount, current: currentMetrics.negativeReviewCount, threshold: 1, unit: "reviews" });
  addNumber({ key: "reviewCount", label: "Review count", previous: previousMetrics.reviewCount, current: currentMetrics.reviewCount, threshold: 1, unit: "reviews" });
  addNumber({ key: "customerSignalCount", label: "Customer signals", previous: previousMetrics.customerSignalCount, current: currentMetrics.customerSignalCount, threshold: 1, unit: "signals" });
  addNumber({ key: "signalCount", label: "Evidence signals", previous: previousMetrics.signalCount || previousMetrics.issueCount, current: currentMetrics.signalCount || currentMetrics.issueCount, threshold: 1, unit: "signals" });
  addNumber({ key: "evidenceStrengthScore", label: "Evidence strength", previous: previousMetrics.evidenceStrengthScore, current: currentMetrics.evidenceStrengthScore, threshold: 2, unit: "points" });
  addNumber({ key: "contentIssueCount", label: "Content issues", previous: previousMetrics.contentIssueCount, current: currentMetrics.contentIssueCount, threshold: 1, unit: "issues" });
  addNumber({ key: "productMomentumScore", label: "Sales Momentum", previous: previousMetrics.productMomentumScore || previousMetrics.productMomentum?.score, current: currentMetrics.productMomentumScore || currentMetrics.productMomentum?.score, threshold: 3, unit: "points" });

  return changes.slice(0, 16);
}

function buildProductEvolutionIssueTransition({ previousDiagnosis = {}, deterministic = {} } = {}) {
  const previousIssues = getProductEvolutionIssueRows(previousDiagnosis.issues);
  const currentIssues = getCurrentProductEvolutionIssueRows(deterministic);
  const currentKeys = new Set(currentIssues.map((issue) => issue.key));
  const previousKeys = new Set(previousIssues.map((issue) => issue.key));
  return {
    previous: previousIssues.slice(0, 8),
    current: currentIssues.slice(0, 8),
    persisting: previousIssues.filter((issue) => currentKeys.has(issue.key)).slice(0, 6),
    noLongerDetected: previousIssues.filter((issue) => !currentKeys.has(issue.key)).slice(0, 6),
    newlyDetected: currentIssues.filter((issue) => !previousKeys.has(issue.key)).slice(0, 6),
  };
}

function buildEmptyProductEvolutionIssueTransition() {
  return {
    previous: [],
    current: [],
    persisting: [],
    noLongerDetected: [],
    newlyDetected: [],
  };
}

function getProductEvolutionIssueRows(issues = []) {
  return (Array.isArray(issues) ? issues : [])
    .map((issue) => {
      const label = String(issue.issue || issue.label || issue.title || issue.issueCode || "").trim();
      const key = normalizeIssueCode(issue.issueCode || issue.key || label) || normalizeRecommendationRationaleKey(label);
      if (!label || !key) return null;
      return {
        key,
        label,
        severity: issue.severity || null,
        confidence: numberOrNull(issue.confidence),
      };
    })
    .filter(Boolean);
}

function getCurrentProductEvolutionIssueRows(deterministic = {}) {
  const rows = [];
  const counts = deterministic.issueSignalCounts || {};
  Object.entries(counts).forEach(([issueCode, count]) => {
    if (Number(count || 0) <= 0) return;
    const key = normalizeIssueCode(issueCode);
    if (!key) return;
    rows.push({ key, label: getHumanIssueLabel(key), count: Number(count || 0) });
  });
  const contentIssues = [
    ...(Array.isArray(deterministic.metrics?.contentIssues) ? deterministic.metrics.contentIssues : []),
    ...(Array.isArray(deterministic.metrics?.contentAnalysis?.issues) ? deterministic.metrics.contentAnalysis.issues : []),
  ];
  contentIssues.forEach((issue) => {
    const key = normalizeIssueCode(issue.issueCode || issue.code || "product_content") || "product_content";
    rows.push({
      key,
      label: issue.label || getHumanIssueLabel(key),
      severity: issue.severity || null,
    });
  });
  if (deterministic.mainIssue) {
    const key = normalizeIssueCode(deterministic.mainIssue);
    if (key && !rows.some((row) => row.key === key)) {
      rows.push({ key, label: deterministic.mainIssueLabel || getHumanIssueLabel(key) });
    }
  }
  return uniqueBy(rows, (item) => item.key).slice(0, 12);
}

function summarizePreviousDiagnosisForEvolution(previousDiagnosis = {}) {
  const report = previousDiagnosis.metrics?.diagnosisReport || {};
  const mainFinding = report.mainFinding || previousDiagnosis.metrics?.mainFinding || {};
  return {
    id: previousDiagnosis.id || null,
    completedAt: toIso(previousDiagnosis.completedAt || previousDiagnosis.createdAt),
    riskScore: numberOrNull(previousDiagnosis.riskScore),
    confidence: numberOrNull(previousDiagnosis.confidence),
    likelyCause: previousDiagnosis.likelyCause || null,
    mainFindingTitle: mainFinding.title || null,
    mainFindingSummary: truncateText(mainFinding.summary || mainFinding.detail || report.evidenceSummary || "", 500),
    recommendations: normalizePreviousDiagnosisRecommendations(previousDiagnosis.recommendations),
  };
}

function normalizePreviousDiagnosisRecommendations(recommendations = []) {
  return (Array.isArray(recommendations) ? recommendations : [])
    .map((action) => ({
      actionId: action.id || action.actionId || "",
      label: action.label || action.title || "",
      type: action.type || "",
    }))
    .filter((action) => action.actionId || action.label)
    .slice(0, 8);
}

function buildProductEvolutionCandidateTransitions({
  recommendationCandidates = [],
  handledActionKeys = new Set(),
  openActionKeys = new Set(),
  previousRecommendationLifecycle = [],
  sourceSummary = {},
  issueTransition = {},
  actionOnly = false,
} = {}) {
  const productEvolution = {
    previousRecommendationLifecycle,
    handledActionKeys: Array.from(handledActionKeys),
    openActionKeys: Array.from(openActionKeys),
    sourceSummary,
    issueTransition,
    recommendationPolicy: {
      suppressExactHandledRecommendationsWhenNoNewEvidence: actionOnly,
    },
  };
  return (Array.isArray(recommendationCandidates) ? recommendationCandidates : [])
    .map((candidate) => {
      const candidateKeys = buildProductEvolutionActionKeySet(candidate);
      const matched = Array.from(candidateKeys).some((key) => handledActionKeys.has(key));
      const openMatched = Array.from(candidateKeys).some((key) => openActionKeys.has(key));
      const decision = getProductEvolutionRecommendationDecision(candidate, productEvolution);
      return {
        actionId: candidate.id || "",
        type: candidate.type || "",
        reason: candidate.reason || "",
        previouslyHandled: matched,
        previouslyPending: openMatched || decision.lifecycleState === "pending",
        lifecycleState: decision.lifecycleState,
        lifecycleLabel: getProductEvolutionLifecycleLabel(decision.lifecycleState),
        matchedPreviousAction: decision.matchedLifecycle ? {
          actionId: decision.matchedLifecycle.actionId || null,
          label: decision.matchedLifecycle.label || null,
          actionStatus: decision.matchedLifecycle.actionStatus || null,
          handledAt: decision.matchedLifecycle.handledAt || null,
        } : null,
        keepInCurrentDiagnosis: decision.keep,
        recommendedTreatment: decision.recommendedTreatment,
      };
    })
    .filter((candidate) => candidate.actionId)
    .slice(0, 16);
}

function getProductEvolutionTransitionKind({
  hasPreviousDiagnosis = false,
  hasUserActionChangesSincePreviousDiagnosis = false,
  hasConcreteProductChangesSincePreviousDiagnosis = false,
} = {}) {
  if (!hasPreviousDiagnosis) return "baseline";
  if (hasUserActionChangesSincePreviousDiagnosis && hasConcreteProductChangesSincePreviousDiagnosis) return "actions_and_evidence_changed";
  if (hasUserActionChangesSincePreviousDiagnosis) return "actions_changed";
  if (hasConcreteProductChangesSincePreviousDiagnosis) return "evidence_changed";
  return "no_material_change";
}

function buildProductEvolutionSummaryText(context = {}) {
  if (!context.hasPreviousDiagnosis) {
    return "This is the first Product Diagnosis for this product, so there is no previous diagnosis or action history to compare against.";
  }
  const previous = context.previousDiagnosis || {};
  const actionText = summarizeProductEvolutionActionsText(context.handledActionsSincePreviousDiagnosis);
  const sourceText = summarizeProductEvolutionSourceText(context.sourceSummary);
  const metricText = summarizeProductEvolutionMetricText(context.metricChanges);
  const issueText = summarizeProductEvolutionIssueText(context.issueTransition);
  return [
    `Previous diagnosis completed at ${previous.completedAt || "an earlier run"}${previous.likelyCause ? ` with ${previous.likelyCause}` : ""}.`,
    actionText,
    sourceText,
    metricText,
    issueText,
  ].filter(Boolean).join(" ");
}

function summarizeProductEvolutionActionsText(actions = []) {
  if (!Array.isArray(actions) || !actions.length) return "No merchant-facing actions were handled since the previous diagnosis.";
  const labels = actions.slice(0, 4).map((action) => `${action.label} (${action.status})`);
  const overflow = Math.max(0, actions.length - labels.length);
  return `Handled actions since then: ${labels.join(", ")}${overflow ? ` and ${overflow} more` : ""}.`;
}

function summarizeProductEvolutionSourceText(sourceSummary = {}) {
  const changes = Array.isArray(sourceSummary.changes) ? sourceSummary.changes : [];
  if (!sourceSummary.hasNewEvidence && sourceSummary.hasProductContentChange) {
    return "Product content changed, but no new orders, returns, refunds, reviews or customer language were detected after the comparison point.";
  }
  if (!sourceSummary.hasNewEvidence) return "No new orders, returns, refunds, reviews or customer language were detected after the comparison point; the transition is action-state driven.";
  const labels = changes.map((change) => change.label).filter(Boolean).slice(0, 4);
  return labels.length
    ? `New/current evidence in this run: ${labels.join(", ")}.`
    : "This run includes new or changed evidence compared with the previous diagnosis.";
}

function summarizeProductEvolutionMetricText(metricChanges = []) {
  if (!Array.isArray(metricChanges) || !metricChanges.length) return "";
  const labels = metricChanges.slice(0, 4).map((change) => {
    if (change.key === "main_issue") return `main issue changed from ${change.from} to ${change.to}`;
    const delta = Number(change.delta || 0);
    return `${change.label} ${delta > 0 ? "increased" : "decreased"} from ${change.from} to ${change.to}${change.unit === "%" ? "%" : ""}`;
  });
  return `Metric movement: ${labels.join("; ")}.`;
}

function summarizeProductEvolutionIssueText(issueTransition = {}) {
  const resolved = (issueTransition.noLongerDetected || []).map((issue) => issue.label).slice(0, 3);
  const newlyDetected = (issueTransition.newlyDetected || []).map((issue) => issue.label).slice(0, 3);
  const parts = [];
  if (resolved.length) parts.push(`no longer detected: ${resolved.join(", ")}`);
  if (newlyDetected.length) parts.push(`newly detected: ${newlyDetected.join(", ")}`);
  return parts.length ? `Issue transition: ${parts.join("; ")}.` : "";
}

function applyProductEvolutionToRecommendationCandidates(candidates = [], productEvolution = null) {
  if (!productEvolution?.hasPreviousDiagnosis && !productEvolution?.previousRecommendationLifecycle?.length) {
    return candidates;
  }
  return (Array.isArray(candidates) ? candidates : []).filter((candidate) => {
    const decision = getProductEvolutionRecommendationDecision(candidate, productEvolution);
    return decision.keep;
  });
}

function hasProductEvolutionActionChanges(productEvolution = null) {
  return Boolean(productEvolution?.hasUserActionChangesSincePreviousDiagnosis);
}

async function persistNoChangeDiagnosisRefresh({ shop, snapshot, deterministic, reuseDecision }) {
  const data = buildNoChangeDiagnosisRefreshData({ snapshot, deterministic, reuseDecision });
  const refreshedSnapshot = await prisma.productRiskSnapshot.update({
    where: { shop_productGid: { shop, productGid: snapshot.productGid } },
    data,
  });
  await upsertProductPulseProductRollup(refreshedSnapshot).catch(() => null);
  return refreshedSnapshot;
}

function buildNoChangeDiagnosisRefreshData({ snapshot = {}, deterministic = {}, reuseDecision = {} } = {}) {
  const currentMetrics = deterministic.metrics || {};
  const previousMetrics = snapshot.metrics || {};
  const previousIncremental = previousMetrics.incrementalDiagnosis || {};
  const currentIncremental = currentMetrics.incrementalDiagnosis || {};
  const refreshedAt = new Date().toISOString();
  const mergedIncremental = {
    ...previousIncremental,
    ...currentIncremental,
    cache: {
      ...(previousIncremental.cache || {}),
      ...(currentIncremental.cache || {}),
    },
    noChangeReuse: {
      checkedAt: refreshedAt,
      reason: reuseDecision.reason,
      matchedBy: reuseDecision.matchedBy,
    },
  };
  const mergedMetrics = {
    ...previousMetrics,
    ...pickNoChangeRefreshMetrics(currentMetrics),
    incrementalDiagnosis: mergedIncremental,
    latestDiagnosisId: previousMetrics.latestDiagnosisId || null,
    latestDiagnosisAt: previousMetrics.latestDiagnosisAt || null,
    lastDetailedDiagnosisAt: previousMetrics.lastDetailedDiagnosisAt || null,
    lastNoChangeDiagnosisAt: refreshedAt,
    noChangeRefresh: {
      checkedAt: refreshedAt,
      reason: reuseDecision.reason,
      matchedBy: reuseDecision.matchedBy,
      creditsConsumed: 0,
      aiCallsSkipped: true,
      dateDerivedMetricsRefreshed: true,
    },
  };
  const revenueAtRisk = Number(deterministic.estimatedImpact?.revenueAtRisk ?? currentMetrics.revenueAtRisk ?? previousMetrics.revenueAtRisk ?? 0);
  const riskScore = clampInteger(snapshot.riskScore ?? deterministic.riskScore, 0, 100);
  const confidence = clampInteger(deterministic.confidence ?? snapshot.confidence, 0, 100);
  const primaryIssue = snapshot.primaryIssue || deterministic.mainIssueLabel || "No primary issue";
  const sourceCoverage = Array.isArray(deterministic.sourceCoverage) && deterministic.sourceCoverage.length
    ? deterministic.sourceCoverage
    : snapshot.sourceCoverage || [];

  return {
    riskScore,
    impactScore: Math.min(100, Math.max(0, Math.round(revenueAtRisk / 100))),
    confidence,
    primaryIssue,
    sourceCoverage,
    metrics: mergedMetrics,
    calculatedAt: new Date(),
  };
}

function pickNoChangeRefreshMetrics(metrics = {}) {
  const keys = [
    "returnRate",
    "refundRate",
    "rawReturnRate",
    "rawRefundRate",
    "reviewRating",
    "avgRating",
    "issueCount",
    "customerSignalCount",
    "rawCustomerSignalCount",
    "textInsights",
    "rawTextInsights",
    "revenueAtRisk",
    "marginAtRisk",
    "estimatedImpact",
    "impactRange",
    "impactFactors",
    "priorityScore",
    "evidenceStrengthScore",
    "scoreCalculationStatus",
    "signalCount",
    "rawSignalCount",
    "salesAmount",
    "avgUnitRevenue",
    "refundAmount",
    "rawRefundAmount",
    "refundInsights",
    "rawRefundInsights",
    "returnRefundRelationshipSummary",
    "productPurchaseContextSummary",
    "productRelationshipIntelligenceSummary",
    "productPurchaseContextFactors",
    "productPurchaseContextScoringImpact",
    "purchaseContextSignalBreakdown",
    "productRelationshipFactors",
    "productRelationshipScoringImpact",
    "returnRefundRelationshipFactors",
    "returnRefundScoringImpact",
    "returnPressure",
    "refundLeakage",
    "customerSignalBreakdown",
    "financialExposureBreakdown",
    "scoringVersion",
    "monthlyOrderActivity",
    "orderGeography",
    "returnRatePrediction",
    "productMomentum",
    "productMomentumScore",
    "productMomentumTier",
    "momentumDirection",
    "momentumConfidence",
    "momentumConfidenceLabel",
    "returnUnits",
    "refundUnits",
    "rawReturnUnits",
    "rawRefundUnits",
    "soldUnits",
    "recentSignalUnits",
    "rawRecentSignalUnits",
    "signalRecencyWeighting",
    "windowDays",
    "lastSignalAt",
    "signalTrend",
    "trendMeta",
    "issueSignalTrends",
    "topReturnReasons",
    "topReturnReasonDetails",
    "topRefundReasons",
    "topRefundReasonDetails",
    "affectedVariants",
    "affectedVariantDetails",
    "variantInsights",
    "reviewCount",
    "negativeReviewCount",
    "rawNegativeReviewCount",
    "negativeReviewRate",
    "rawNegativeReviewRate",
    "recentNegativeReviewCount",
    "rawRecentNegativeReviewCount",
    "recentNegativeReviewWindowDays",
    "judgeMeReviewCount",
    "judgeMeNegativeReviewCount",
    "judgeMeAverageRating",
    "yotpoReviewCount",
    "yotpoNegativeReviewCount",
    "yotpoAverageRating",
    "looxReviewCount",
    "looxNegativeReviewCount",
    "looxAverageRating",
    "csvReviewCount",
    "csvNegativeReviewCount",
    "csvAverageRating",
    "reviewSourceStats",
    "rawReviewSourceStats",
    "judgeMeInternalProductId",
    "judgeMeMatchConfidence",
    "yotpoReviewMatchConfidence",
    "looxReviewMatchConfidence",
    "csvReviewMatchConfidence",
    "orderAccessDenied",
    "sourceCoverage",
    "productRetention",
    "productRetentionSummary",
  ];
  return keys.reduce((acc, key) => {
    if (metrics[key] !== undefined) acc[key] = metrics[key];
    return acc;
  }, {});
}

function clampInteger(value, min = 0, max = Number.POSITIVE_INFINITY) {
  const number = Number(value);
  if (!Number.isFinite(number)) return Math.max(0, Number(min || 0));
  return Math.round(Math.max(min, Math.min(max, number)));
}

function buildCachedAiModelSummary(task, model = "previous-detailed-diagnosis") {
  return {
    task,
    model,
    provider: "cache",
    usage: {
      provider: "cache",
      model,
      task,
      requestContext: "cache",
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      usageSource: "cache",
    },
  };
}

function getNoChangeDiagnosisReuseDecision({ snapshot = {}, deterministic = {} } = {}) {
  const previousMetrics = snapshot.metrics || {};
  const metrics = deterministic.metrics || {};
  const incremental = metrics.incrementalDiagnosis || {};
  const hasPreviousCompletedDiagnosis = Boolean(
    previousMetrics.latestDiagnosisId
      || previousMetrics.lastDetailedDiagnosisAt
      || previousMetrics.latestDiagnosisAt,
  );
  const productContentReused = incremental.productContent?.reused === true;
  const customerTextUnchanged = isIncrementalAnalysisUnchanged(incremental.customerText);
  const refundsUnchanged = isIncrementalAnalysisUnchanged(incremental.refunds);
  const aiEvidenceSnippetCount = Number(incremental.aiEvidenceSnippetCount ?? deterministic.evidenceSnippets?.length ?? 0);
  const noNewAiEvidence = aiEvidenceSnippetCount === 0;
  const sourceChanges = incremental.sourceChanges || {};
  const productEvolution = metrics.productEvolution || null;
  const productActionChanges = hasProductEvolutionActionChanges(productEvolution);
  const sourceExtractionComplete = sourceChanges.sourceExtractionComplete !== false;
  const sourceFingerprintCompared = Boolean(sourceChanges.previousFingerprint && sourceChanges.currentFingerprint);
  const sourceFingerprintUnchanged = sourceChanges.unchanged === true;
  const chartInterpretationReuse = getProductChartInterpretationReuseState(previousMetrics, metrics, deterministic);
  const materialComparison = compareMaterialDiagnosisMetrics(previousMetrics, {
    ...metrics,
    riskScore: deterministic.riskScore,
    confidence: deterministic.confidence,
    estimatedImpact: deterministic.estimatedImpact?.estimatedImpact ?? metrics.estimatedImpact,
    revenueAtRisk: deterministic.estimatedImpact?.revenueAtRisk ?? metrics.revenueAtRisk,
    marginAtRisk: deterministic.estimatedImpact?.marginAtRisk ?? metrics.marginAtRisk,
  });
  const materialUnchanged = !sourceFingerprintCompared && materialComparison.unchanged;
  const sourceMetricCorrection = hasUnsupportedSourceMetricCorrection({ previousMetrics, currentMetrics: metrics, sourceChanges });
  const dateOnlyRefresh = !sourceMetricCorrection && isDateOnlyDiagnosisRefresh({
    sourceChanges,
    productContentReused,
    customerTextUnchanged,
    refundsUnchanged,
    noNewAiEvidence,
  });
  let matchedBy = null;
  if (!sourceMetricCorrection && !productActionChanges) {
    if (sourceFingerprintUnchanged) matchedBy = "source_fingerprint";
    else if (materialUnchanged) matchedBy = "material_metrics";
    else if (dateOnlyRefresh) matchedBy = "date_derived_metrics";
  }
  const blockers = [
    !hasPreviousCompletedDiagnosis ? "missing_previous_completed_diagnosis" : null,
    productActionChanges ? "product_actions_changed_since_previous_diagnosis" : null,
    !productContentReused ? "product_content_changed_or_not_cached" : null,
    !customerTextUnchanged ? "customer_text_changed_or_not_incremental" : null,
    !refundsUnchanged ? "refunds_changed_or_not_incremental" : null,
    !sourceExtractionComplete ? "source_extraction_incomplete" : null,
    !noNewAiEvidence ? "new_ai_evidence_snippets_detected" : null,
    sourceMetricCorrection ? "stored_source_metrics_not_supported_by_current_source_events" : null,
    !matchedBy ? "source_or_material_metrics_changed" : null,
    !chartInterpretationReuse.available ? "missing_chart_interpretations" : null,
  ].filter(Boolean);
  const shouldReuse = blockers.length === 0;
  const recommendationReevaluation = buildRecommendationReevaluationDecision({
    shouldReuse,
    blockers,
    matchedBy,
    materialComparison,
    sourceChanges,
    productContentReused,
    customerTextUnchanged,
    refundsUnchanged,
    noNewAiEvidence,
    productActionChanges,
  });

  return {
    shouldReuse,
    reason: shouldReuse ? "no_changes_since_previous_diagnosis" : "changes_or_missing_cache_detected",
    matchedBy,
    blockers,
    hasPreviousCompletedDiagnosis,
    productContentReused,
    customerTextUnchanged,
    refundsUnchanged,
    productActionChanges,
    sourceExtractionComplete,
    noNewAiEvidence,
    sourceFingerprintCompared,
    sourceFingerprintUnchanged,
    dateOnlyRefresh,
    sourceMetricCorrection,
    sourceChanges,
    materialComparison,
    chartInterpretationReuse,
    recommendationReevaluation,
    productEvolution,
  };
}

function buildRecommendationReevaluationDecision({
  shouldReuse,
  blockers = [],
  matchedBy = null,
  materialComparison = {},
  sourceChanges = {},
  productContentReused = false,
  customerTextUnchanged = false,
  refundsUnchanged = false,
  noNewAiEvidence = false,
  productActionChanges = false,
} = {}) {
  const triggers = [...blockers];
  return {
    required: !shouldReuse,
    reason: shouldReuse
      ? "current_recommendations_remain_current"
      : productActionChanges
        ? "handled_actions_may_affect_recommendations"
        : "changes_may_affect_recommendations",
    matchedBy,
    triggers,
    sufficientToSkip: shouldReuse && !productActionChanges && productContentReused && customerTextUnchanged && refundsUnchanged && noNewAiEvidence && Boolean(matchedBy),
    materialMetricChanges: Array.isArray(materialComparison.changed) ? materialComparison.changed : [],
    sourceFingerprintChanged: sourceChanges.unchanged === false,
    productActionChanges,
    policy: [
      "Reevaluate recommendations when product content changed or was not comparable.",
      "Reevaluate when new return, refund, review, or customer-text evidence was analyzed.",
      "Reevaluate when merchant-facing ProductPulse actions were applied, reviewed, dismissed, or ignored after the previous Product Diagnosis.",
      "Reevaluate when source extraction is incomplete because reuse would be unsafe.",
      "Reevaluate when source fingerprints or material diagnosis metrics changed.",
      "Reuse existing recommendations when the only movement is date-window recalculation with no newly fetched source events.",
      "Reuse existing recommendations only when all concrete sources and material metrics are unchanged.",
    ],
  };
}

function isDateOnlyDiagnosisRefresh({
  sourceChanges = {},
  productContentReused = false,
  customerTextUnchanged = false,
  refundsUnchanged = false,
  noNewAiEvidence = false,
} = {}) {
  if (sourceChanges.sourceExtractionComplete === false) return false;
  return Boolean(
    productContentReused
      && customerTextUnchanged
      && refundsUnchanged
      && noNewAiEvidence
      && sourceChanges.unchanged === false
      && isIncrementalSourceFetchWithoutNewEvents(sourceChanges.sourceEventFetch),
  );
}

function hasUnsupportedSourceMetricCorrection({ previousMetrics = {}, currentMetrics = {}, sourceChanges = {} } = {}) {
  const previousSourceEvents = previousMetrics.incrementalDiagnosis?.cache?.sourceEvents || {};
  const currentIncremental = currentMetrics.incrementalDiagnosis || {};
  const sourceEventFetch = sourceChanges.sourceEventFetch || currentIncremental.sourceEvents || {};
  const sourceFetchComplete = sourceChanges.sourceFetchComplete || currentIncremental.sourceChanges?.sourceFetchComplete || {};

  return [
    { metricKey: "returnUnits", eventKey: "returns", countKey: "returnEvents", completeKey: "returns" },
    { metricKey: "refundUnits", amountKey: "refundAmount", eventKey: "refunds", countKey: "refundEvents", completeKey: "refunds" },
  ].some(({ metricKey, amountKey, eventKey, countKey, completeKey }) => {
    const previousUnits = Number(previousMetrics[metricKey] || 0);
    const previousAmount = amountKey ? Number(previousMetrics[amountKey] || 0) : 0;
    const currentUnits = Number(currentMetrics[metricKey] || 0);
    const currentAmount = amountKey ? Number(currentMetrics[amountKey] || 0) : 0;
    if (previousUnits <= 0 && previousAmount <= 0) return false;
    if (currentUnits > 0 || currentAmount > 0) return false;
    if (sourceFetchComplete[completeKey] === false) return false;
    return countSourceEventCacheItems(previousSourceEvents, eventKey) === 0
      && getSourceEventFetchCount(sourceEventFetch, countKey) === 0;
  });
}

function countSourceEventCacheItems(sourceEvents = {}, key = "") {
  const items = sourceEvents?.[key];
  return Array.isArray(items) ? items.length : 0;
}

function getSourceEventFetchCount(sourceEventFetch = {}, key = "") {
  const merged = Number(sourceEventFetch?.mergedCounts?.[key]);
  if (Number.isFinite(merged)) return merged;
  const raw = Number(sourceEventFetch?.rawFetchedCounts?.[key]);
  return Number.isFinite(raw) ? raw : 0;
}

function isIncrementalSourceFetchWithoutNewEvents(sourceEventFetch = {}) {
  if (!sourceEventFetch || typeof sourceEventFetch !== "object") return false;
  if (sourceEventFetch.fetchComplete === false) return false;
  if (sourceEventFetch.mode !== "incremental_fetch") return false;
  if (!sourceEventFetch.rawFetchedCounts || typeof sourceEventFetch.rawFetchedCounts !== "object") return false;
  const counts = sourceEventFetch.rawFetchedCounts || {};
  const knownKeys = ["salesEvents", "refundEvents", "returnEvents"];
  return knownKeys.every((key) => Number(counts[key] || 0) === 0);
}

function isIncrementalAnalysisUnchanged(state = {}) {
  return state?.mode === "incremental" && Number(state.analyzedItems || 0) === 0;
}

function getProductChartInterpretationReuseState(previousMetrics = {}, metrics = {}, deterministic = {}) {
  const required = hasProductChartInterpretationInputs(metrics, deterministic);
  if (!required) {
    return {
      required: false,
      available: true,
      textCount: 0,
      status: "not_required",
    };
  }

  const chartInterpretations = previousMetrics.chartInterpretations || previousMetrics.diagnosisReport?.chartInterpretations || null;
  const textCount = countStoredProductChartInterpretations(chartInterpretations);
  return {
    required: true,
    available: Boolean(chartInterpretations?.insightVersion) || textCount > 0,
    textCount,
    status: chartInterpretations?.status || null,
    insightVersion: chartInterpretations?.insightVersion || null,
  };
}

function hasProductChartInterpretationInputs(metrics = {}, deterministic = {}) {
  return hasMonthlyOrderActivityForChartInterpretation(metrics.monthlyOrderActivity)
    || hasReturnRatePredictionForChartInterpretation(metrics.returnRatePrediction)
    || hasProductRetentionForChartInterpretation(metrics.productRetention || metrics.productRetentionSummary)
    || hasProductRiskHistoryForChartInterpretation(metrics, deterministic)
    || hasProductMomentumForChartInterpretation(metrics.productMomentum);
}

function hasMonthlyOrderActivityForChartInterpretation(activity = null) {
  const months = Array.isArray(activity?.months) ? activity.months : [];
  const summary = activity?.summary || {};
  return months.some((month) => Number(month.orders || month.orderUnits || month.returnedUnits || month.refundedUnits || month.revenue || month.refundAmount || 0) > 0)
    || Number(summary.totalOrders || summary.totalOrderUnits || summary.totalRevenue || summary.totalReturnedUnits || summary.totalRefundedUnits || summary.totalRefundAmount || 0) > 0;
}

function hasReturnRatePredictionForChartInterpretation(prediction = null) {
  const observed = Array.isArray(prediction?.observedPoints) ? prediction.observedPoints : [];
  const forecast = Array.isArray(prediction?.forecastPoints) ? prediction.forecastPoints : [];
  const summary = prediction?.summary || {};
  return observed.some((point) => Number(point.orders || point.orderUnits || point.returnedUnits || point.smoothedReturnRate || point.rawReturnRate || 0) > 0)
    || forecast.some((point) => Number(point.predictedReturnRate || 0) > 0)
    || Number(summary.totalOrderUnits || summary.totalReturnedUnits || summary.totalReturnRate || summary.forecastNext90ReturnRate || 0) > 0;
}

function hasProductRetentionForChartInterpretation(retention = null) {
  const summary = retention?.summary || retention || {};
  return Boolean(retention?.available)
    || Number(summary.totalCustomersAnalyzed || summary.totalProductCohortCustomers || summary.retentionHealthScore || summary.productLtv90Cents || summary.productLtv180Cents || 0) > 0
    || (Array.isArray(retention?.retentionHealthTrend) && retention.retentionHealthTrend.length > 0)
    || (Array.isArray(retention?.ltvCurve) && retention.ltvCurve.length > 0);
}

function hasProductRiskHistoryForChartInterpretation(metrics = {}, deterministic = {}) {
  return (Array.isArray(metrics.reconstructedRiskHistory) && metrics.reconstructedRiskHistory.length > 0)
    || (Array.isArray(metrics.riskHistory) && metrics.riskHistory.length > 0)
    || Number.isFinite(Number(deterministic.riskScore ?? metrics.riskScore ?? metrics.riskComponents?.riskScore));
}

function hasProductMomentumForChartInterpretation(momentum = null) {
  const inputs = momentum?.inputs || {};
  const weeklyUnits = Array.isArray(inputs.weeklyUnitsLast4Weeks) ? inputs.weeklyUnitsLast4Weeks : [];
  return Boolean(momentum)
    && (Number.isFinite(Number(momentum.score))
      || weeklyUnits.some((value) => Number(value || 0) > 0)
      || Number(inputs.unitsLast30Days || inputs.revenueLast30Days || 0) > 0);
}

function countStoredProductChartInterpretations(chartInterpretations = null) {
  const raw = chartInterpretations?.interpretations
    || chartInterpretations?.chart_interpretations
    || chartInterpretations?.chartInterpretations
    || {};
  return Object.values(raw).filter((entry) => {
    const text = typeof entry === "string" ? entry : entry?.text || entry?.summary || entry?.interpretation || "";
    return String(text || "").trim().length > 0;
  }).length;
}

function compareMaterialDiagnosisMetrics(previousMetrics = {}, currentMetrics = {}) {
  const numericKeys = [
    "soldUnits",
    "salesAmount",
    "returnUnits",
    "returnRate",
    "refundUnits",
    "refundRate",
    "refundAmount",
    "reviewCount",
    "avgRating",
    "negativeReviewCount",
    "negativeReviewRate",
    "recentNegativeReviewCount",
    "judgeMeReviewCount",
    "judgeMeNegativeReviewCount",
    "judgeMeAverageRating",
    "yotpoReviewCount",
    "yotpoNegativeReviewCount",
    "yotpoAverageRating",
    "looxReviewCount",
    "looxNegativeReviewCount",
    "looxAverageRating",
    "csvReviewCount",
    "csvNegativeReviewCount",
    "csvAverageRating",
    "customerSignalCount",
    "contentIssueCount",
    "descriptionWordCount",
    "contentQualityScore",
    "contentQualityRisk",
    "mediaCount",
    "mediaWithoutAltCount",
    "signalCount",
    "riskScore",
    "confidence",
    "estimatedImpact",
    "revenueAtRisk",
    "marginAtRisk",
    "productMomentumScore",
  ];
  const changed = [];
  let compared = 0;

  numericKeys.forEach((key) => {
    const previousValue = Number(previousMetrics[key]);
    const currentValue = Number(currentMetrics[key]);
    if (!Number.isFinite(previousValue) || !Number.isFinite(currentValue)) return;
    compared += 1;
    const tolerance = key.toLowerCase().includes("rate") || key.toLowerCase().includes("rating") ? 0.05 : 0.5;
    if (Math.abs(previousValue - currentValue) > tolerance) {
      changed.push({ key, previousValue, currentValue });
    }
  });

  [
    "topReturnReasonDetails",
    "topRefundReasonDetails",
    "affectedVariantDetails",
    "orderGeography",
    "sourceCoverage",
    "reviewSourceStats",
  ].forEach((key) => {
    if (previousMetrics[key] === undefined || currentMetrics[key] === undefined) return;
    compared += 1;
    if (stableSignature(previousMetrics[key]) !== stableSignature(currentMetrics[key])) {
      changed.push({ key });
    }
  });

  return {
    unchanged: compared >= 8 && changed.length === 0,
    compared,
    changed: changed.slice(0, 12),
  };
}

function buildAiProductInput(product, snapshot) {
  return {
    id: product.id || snapshot.productGid,
    numericId: product.numericId || extractNumericShopifyId(snapshot.productGid),
    handle: product.handle || snapshot.handle,
    title: product.title || snapshot.productTitle,
    description: product.description || "",
    seoTitle: product.seoTitle || "",
    seoDescription: product.seoDescription || "",
    templateSuffix: product.templateSuffix || "",
    vendor: product.vendor || "",
    productType: product.productType || "",
    category: normalizeProductCategory(product.category),
    tags: product.tags || [],
    options: product.options || [],
    variants: (product.variants || []).slice(0, 100).map((variant) => ({
      id: variant.id,
      title: variant.title,
      sku: variant.sku,
      price: variant.price,
      compareAtPrice: variant.compareAtPrice,
      inventoryQuantity: variant.inventoryQuantity,
      inventoryPolicy: variant.inventoryPolicy,
      selectedOptions: variant.selectedOptions || [],
    })),
    collections: product.collections || [],
    metafields: product.metafields || [],
    media: (product.media || []).slice(0, 20).map((media) => ({
      id: media.id,
      type: media.mediaContentType,
      alt: media.alt,
      status: media.status,
      width: media.width,
      height: media.height,
    })),
  };
}

function buildAiDeterministicInput(deterministic) {
  const signalRelevance = buildSignalRelevanceGuidance(deterministic);
  const productEvolution = sanitizeProductEvolutionForAi(deterministic.metrics.productEvolution);
  const riskHistory = buildAiRiskHistoryInput(deterministic.metrics.reconstructedRiskHistory || deterministic.metrics.riskHistory);
  const temporalEvolution = buildAiTemporalEvolutionInput({
    deterministic,
    productEvolution,
    riskHistory,
  });
  return {
    riskScore: deterministic.riskScore,
    confidence: deterministic.confidence,
    mainIssue: deterministic.mainIssue,
    mainIssueLabel: deterministic.mainIssueLabel,
    estimatedImpact: deterministic.estimatedImpact,
    sourceAgreement: deterministic.sourceAgreement,
    evidenceSummary: buildEvidenceSummary(deterministic),
    signalRelevance,
    metrics: {
      soldUnits: deterministic.metrics.soldUnits,
      returnUnits: deterministic.metrics.returnUnits,
      returnRate: deterministic.metrics.returnRate,
      refundUnits: deterministic.metrics.refundUnits,
      refundRate: deterministic.metrics.refundRate,
      refundAmount: deterministic.metrics.refundAmount,
      reviewCount: deterministic.metrics.reviewCount,
      avgRating: deterministic.metrics.avgRating,
      negativeReviewCount: deterministic.metrics.negativeReviewCount,
      negativeReviewRate: deterministic.metrics.negativeReviewRate,
      recentNegativeReviewCount: deterministic.metrics.recentNegativeReviewCount,
      judgeMeReviewCount: deterministic.metrics.judgeMeReviewCount,
      judgeMeAverageRating: deterministic.metrics.judgeMeAverageRating,
      judgeMeNegativeReviewCount: deterministic.metrics.judgeMeNegativeReviewCount,
      yotpoReviewCount: deterministic.metrics.yotpoReviewCount,
      yotpoAverageRating: deterministic.metrics.yotpoAverageRating,
      yotpoNegativeReviewCount: deterministic.metrics.yotpoNegativeReviewCount,
      looxReviewCount: deterministic.metrics.looxReviewCount,
      looxAverageRating: deterministic.metrics.looxAverageRating,
      looxNegativeReviewCount: deterministic.metrics.looxNegativeReviewCount,
      csvReviewCount: deterministic.metrics.csvReviewCount,
      csvAverageRating: deterministic.metrics.csvAverageRating,
      csvNegativeReviewCount: deterministic.metrics.csvNegativeReviewCount,
      reviewSourceStats: deterministic.metrics.reviewSourceStats,
      signalCount: deterministic.metrics.signalCount,
      customerSignalCount: deterministic.metrics.customerSignalCount,
      contentQualityScore: deterministic.metrics.contentQualityScore,
      contentQualityRisk: deterministic.metrics.contentQualityRisk,
      contentIssueCount: deterministic.metrics.contentIssueCount,
      contentIssues: deterministic.metrics.contentIssues,
      contentAdvisoryCount: deterministic.metrics.contentAdvisoryCount,
      contentAdvisories: deterministic.metrics.contentAdvisories,
      faqNeed: deterministic.metrics.faqNeed,
      titleNeedsReview: deterministic.metrics.titleNeedsReview,
      seoTitleNeedsReview: deterministic.metrics.seoTitleNeedsReview,
      metaDescriptionNeedsReview: deterministic.metrics.metaDescriptionNeedsReview,
      handleNeedsReview: deterministic.metrics.handleNeedsReview,
      specsBlockRecommended: deterministic.metrics.specsBlockRecommended,
      classificationNeedsReview: deterministic.metrics.classificationNeedsReview,
      templateNeedsReview: deterministic.metrics.templateNeedsReview,
      variantNamingAdvisory: deterministic.metrics.variantNamingAdvisory,
      mediaCount: deterministic.metrics.mediaCount,
      mediaWithoutAltCount: deterministic.metrics.mediaWithoutAltCount,
      textInsights: deterministic.metrics.textInsights,
      refundInsights: deterministic.metrics.refundInsights,
      descriptionWordCount: deterministic.metrics.descriptionWordCount,
      hasDescription: deterministic.metrics.hasDescription,
      topReturnReasons: deterministic.metrics.topReturnReasons,
      topRefundReasons: deterministic.metrics.topRefundReasons,
      affectedVariants: deterministic.metrics.affectedVariants,
      variantInsights: deterministic.metrics.variantInsights,
      orderGeography: deterministic.metrics.orderGeography,
      monthlyOrderActivity: buildAiMonthlyOrderActivityInput(deterministic.metrics.monthlyOrderActivity),
      returnRatePrediction: buildAiReturnRatePredictionInput(deterministic.metrics.returnRatePrediction),
      productRetention: buildAiProductRetentionInput(deterministic.metrics.productRetention),
      productMomentum: buildAiProductMomentumInput(deterministic.metrics.productMomentum),
      riskHistory,
      productEvolution,
      productEvolutionSummary: productEvolution?.summary || "",
      temporalEvolution,
      windowDays: deterministic.metrics.windowDays,
      orderAccessDenied: deterministic.metrics.orderAccessDenied,
      incrementalDiagnosis: sanitizeIncrementalDiagnosisForAi(deterministic.metrics.incrementalDiagnosis),
    },
  };
}

function buildAiTemporalEvolutionInput({ deterministic = {}, productEvolution = null, riskHistory = [] } = {}) {
  const history = Array.isArray(riskHistory) ? riskHistory.filter(Boolean) : [];
  const firstPoint = history[0] || null;
  const lastPoint = history[history.length - 1] || null;
  const hasPreviousDiagnosis = Boolean(productEvolution?.hasPreviousDiagnosis || productEvolution?.mode === "successive" || productEvolution?.previousDiagnosis);
  const previousDiagnosisAt = productEvolution?.previousDiagnosis?.completedAt
    || productEvolution?.previousCompletedAt
    || (productEvolution?.comparisonBaseline?.type === "diagnosis" ? productEvolution.comparisonBaseline.at : null)
    || firstPoint?.recordedAt
    || null;
  const currentDiagnosisAt = productEvolution?.currentRun?.analyzedAt
    || lastPoint?.recordedAt
    || null;
  const previousRiskScore = firstNonNullNumber(
    productEvolution?.previousDiagnosis?.riskScore,
    firstPoint?.riskScore,
  );
  const currentRiskScore = firstNonNullNumber(
    productEvolution?.currentRun?.riskScore,
    deterministic.riskScore,
    lastPoint?.riskScore,
  );
  const previousConfidence = firstNonNullNumber(
    productEvolution?.previousDiagnosis?.confidence,
    firstPoint?.confidence,
  );
  const currentConfidence = firstNonNullNumber(
    productEvolution?.currentRun?.confidence,
    deterministic.confidence,
    lastPoint?.confidence,
  );
  const riskDelta = calculateMetricDelta(previousRiskScore, currentRiskScore);
  const confidenceDelta = calculateMetricDelta(previousConfidence, currentConfidence);

  return {
    available: Boolean(hasPreviousDiagnosis || history.length > 1 || productEvolution?.summary),
    mode: productEvolution?.mode || (history.length > 1 ? "successive" : "baseline"),
    transitionKind: productEvolution?.transitionKind || null,
    hasPreviousDiagnosis,
    previousDiagnosisAt,
    currentDiagnosisAt,
    elapsedSincePreviousDiagnosisDays: calculateElapsedDays(previousDiagnosisAt, currentDiagnosisAt),
    handledActionCount: getProductEvolutionHandledActionCount(productEvolution),
    openActionCount: numberOrNull(productEvolution?.actionCounts?.open) ?? (productEvolution?.openActionsSincePreviousDiagnosis || []).length,
    hasNewEvidence: Boolean(productEvolution?.sourceSummary?.hasNewEvidence),
    hasPostActionStatus: Boolean(productEvolution?.postActionStatus),
    summary: productEvolution?.summary || "",
    risk: {
      previousRiskScore,
      currentRiskScore,
      delta: riskDelta,
      direction: getMetricDeltaDirection(riskDelta, { lowerIsBetter: true }),
    },
    confidence: {
      previousConfidence,
      currentConfidence,
      delta: confidenceDelta,
      direction: getMetricDeltaDirection(confidenceDelta),
    },
    metricChanges: (productEvolution?.metricChanges || []).slice(0, 8),
    issueTransition: productEvolution?.issueTransition || null,
    sourceSummary: productEvolution?.sourceSummary || null,
    postActionStatus: productEvolution?.postActionStatus || null,
    riskHistoryPoints: history.slice(-6),
  };
}

function firstNonNullNumber(...values) {
  for (const value of values) {
    const number = numberOrNull(value);
    if (number !== null) return number;
  }
  return null;
}

function calculateMetricDelta(previousValue, currentValue) {
  if (previousValue === null || currentValue === null) return null;
  return Math.round((Number(currentValue) - Number(previousValue)) * 100) / 100;
}

function calculateElapsedDays(start, end) {
  const startDate = parseValidDate(start);
  const endDate = parseValidDate(end);
  if (!startDate || !endDate) return null;
  return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)));
}

function getMetricDeltaDirection(delta, { lowerIsBetter = false } = {}) {
  if (delta === null) return "unknown";
  if (Math.abs(delta) < 0.5) return "stable";
  const increased = delta > 0;
  if (lowerIsBetter) return increased ? "worsened" : "improved";
  return increased ? "increased" : "decreased";
}

function buildAiMonthlyOrderActivityInput(activity = null) {
  if (!activity) return null;
  const months = (Array.isArray(activity.months) ? activity.months : [])
    .slice(-14)
    .map((month) => ({
      key: month.key || null,
      label: month.label || month.key || null,
      startAt: month.startAt || null,
      orders: numberOrNull(month.orders),
      orderUnits: numberOrNull(month.orderUnits),
      revenue: numberOrNull(month.revenue),
      returnedOrders: numberOrNull(month.returnedOrders),
      returnedUnits: numberOrNull(month.returnedUnits),
      refundedOrders: numberOrNull(month.refundedOrders),
      refundedUnits: numberOrNull(month.refundedUnits),
      refundAmount: numberOrNull(month.refundAmount),
      returnRate: numberOrNull(month.returnRate),
      refundRate: numberOrNull(month.refundRate),
      resolvedReturnUnits: numberOrNull(month.resolvedReturnUnits ?? month.returnResolvedUnits ?? month.resolvedReturns),
      unresolvedReturnUnits: numberOrNull(month.unresolvedReturnUnits ?? month.openReturnUnits ?? month.pendingReturnUnits ?? month.unresolvedReturns),
    }));
  const summary = activity.summary || {};
  const hasActivity = months.some((month) => (
    Number(month.orders || 0) > 0
    || Number(month.orderUnits || 0) > 0
    || Number(month.returnedUnits || 0) > 0
    || Number(month.refundedUnits || 0) > 0
    || Number(month.revenue || 0) > 0
    || Number(month.refundAmount || 0) > 0
  ));

  return {
    available: hasActivity,
    source: activity.source || null,
    windowDays: numberOrNull(activity.windowDays),
    generatedAt: activity.generatedAt || null,
    summary: {
      totalOrders: numberOrNull(summary.totalOrders),
      totalOrderUnits: numberOrNull(summary.totalOrderUnits),
      totalRevenue: numberOrNull(summary.totalRevenue),
      totalReturnedUnits: numberOrNull(summary.totalReturnedUnits),
      totalRefundedUnits: numberOrNull(summary.totalRefundedUnits),
      totalRefundAmount: numberOrNull(summary.totalRefundAmount),
      returnRate: numberOrNull(summary.returnRate),
      refundRate: numberOrNull(summary.refundRate),
    },
    months,
  };
}

function buildAiReturnRatePredictionInput(prediction = null) {
  if (!prediction) return null;
  const observedPoints = (Array.isArray(prediction.observedPoints) ? prediction.observedPoints : [])
    .slice(-18)
    .map((point) => ({
      key: point.key || null,
      label: point.label || point.key || null,
      startAt: point.startAt || null,
      orders: numberOrNull(point.orders),
      orderUnits: numberOrNull(point.orderUnits),
      returnedOrders: numberOrNull(point.returnedOrders),
      returnedUnits: numberOrNull(point.returnedUnits),
      rawReturnRate: numberOrNull(point.rawReturnRate),
      smoothedReturnRate: numberOrNull(point.smoothedReturnRate ?? point.rawReturnRate),
    }));
  const forecastPoints = (Array.isArray(prediction.forecastPoints) ? prediction.forecastPoints : [])
    .slice(0, 14)
    .map((point) => ({
      key: point.key || null,
      label: point.label || point.key || null,
      startAt: point.startAt || null,
      predictedReturnRate: numberOrNull(point.predictedReturnRate),
      basePredictedReturnRate: numberOrNull(point.basePredictedReturnRate),
      baselineReturnRate: numberOrNull(point.baselineReturnRate),
      seasonalReturnRate: numberOrNull(point.seasonalReturnRate),
      lowerBound: numberOrNull(point.lowerBound),
      upperBound: numberOrNull(point.upperBound),
    }));
  const summary = prediction.summary || {};
  const actionAdjustment = prediction.actionAdjustment || {};
  const hasPrediction = observedPoints.some((point) => (
    Number(point.orders || 0) > 0
    || Number(point.orderUnits || 0) > 0
    || Number(point.returnedUnits || 0) > 0
    || point.smoothedReturnRate != null
  )) || forecastPoints.some((point) => point.predictedReturnRate != null);

  return {
    available: hasPrediction,
    source: prediction.source || null,
    granularity: prediction.granularity || "weekly",
    windowDays: numberOrNull(prediction.windowDays),
    generatedAt: prediction.generatedAt || null,
    summary: {
      totalOrderUnits: numberOrNull(summary.totalOrderUnits),
      totalReturnedUnits: numberOrNull(summary.totalReturnedUnits),
      totalReturnRate: numberOrNull(summary.totalReturnRate),
      last30DayReturnRate: numberOrNull(summary.last30DayReturnRate),
      last60DayReturnRate: numberOrNull(summary.last60DayReturnRate),
      forecastNext90ReturnRate: numberOrNull(summary.forecastNext90ReturnRate),
      confidence: summary.confidence || null,
    },
    actionAdjustment: {
      adjustmentPoints: numberOrNull(actionAdjustment.adjustmentPoints),
      uncertaintyLift: numberOrNull(actionAdjustment.uncertaintyLift),
      applied: numberOrNull(actionAdjustment.applied),
      reviewed: numberOrNull(actionAdjustment.reviewed),
      dismissed: numberOrNull(actionAdjustment.dismissed),
      pending: numberOrNull(actionAdjustment.pending),
      total: numberOrNull(actionAdjustment.total),
    },
    observedPoints,
    forecastPoints,
  };
}

function buildAiProductRetentionInput(retention = null) {
  const summary = retention?.summary || null;
  if (!summary) return null;
  const healthScore = numberOrNull(summary.retentionHealthScore);
  const repeat90 = numberOrNull(summary.repeatPurchaseRate90d);
  const same90 = numberOrNull(summary.sameProductRepurchaseRate90d);
  const crossSell90 = numberOrNull(summary.crossSellRetentionRate90d);
  const ltv90Cents = numberOrNull(summary.productLtv90Cents);
  const ltvDeltaCents = numberOrNull(summary.ltv90DeltaCents);
  const customers = Number(summary.totalCustomersAnalyzed || 0);
  const hasEnoughData = Boolean(summary.hasEnoughData);
  const opportunitySignals = [];
  if (hasEnoughData && healthScore != null && healthScore >= 75) opportunitySignals.push("strong_retention_health");
  if (hasEnoughData && healthScore != null && healthScore <= 45) opportunitySignals.push("weak_retention_health");
  if (hasEnoughData && repeat90 != null && repeat90 >= 0.30) opportunitySignals.push("high_repeat_purchase");
  if (hasEnoughData && repeat90 != null && repeat90 <= 0.05) opportunitySignals.push("low_repeat_purchase");
  if (hasEnoughData && same90 != null && same90 >= 0.18) opportunitySignals.push("same_product_repurchase");
  if (hasEnoughData && crossSell90 != null && crossSell90 >= 0.20) opportunitySignals.push("cross_sell_retention");
  if (hasEnoughData && ltvDeltaCents != null && Math.abs(ltvDeltaCents) >= Math.max(500, Math.abs(Number(ltv90Cents || 0)) * 0.08)) {
    opportunitySignals.push(ltvDeltaCents > 0 ? "ltv_improving" : "ltv_declining");
  }

  return {
    available: customers > 0 || Boolean(retention.run),
    hasEnoughData,
    lowSampleWarning: Boolean(summary.lowSampleWarning),
    shouldMention: opportunitySignals.length > 0,
    opportunitySignals,
    rateScale: "fraction_0_to_1",
    repeatPurchaseRate90d: repeat90,
    repeatPurchaseRate180d: numberOrNull(summary.repeatPurchaseRate180d),
    sameProductRepurchaseRate90d: same90,
    crossSellRetentionRate90d: crossSell90,
    returningRevenueShare: numberOrNull(summary.returningRevenueShare),
    medianDaysToSecondPurchase: numberOrNull(summary.medianDaysToSecondPurchase),
    productLtv90Cents: ltv90Cents,
    productLtv180Cents: numberOrNull(summary.productLtv180Cents),
    retentionHealthScore: healthScore,
    repeatPurchaseRate90dDelta: numberOrNull(summary.repeatPurchaseRate90dDelta),
    sameProductRepurchaseRate90dDelta: numberOrNull(summary.sameProductRepurchaseRate90dDelta),
    ltv90DeltaCents: ltvDeltaCents,
    totalProductCohortCustomers: customers,
    totalProductOrdersAnalyzed: Number(summary.totalProductOrdersAnalyzed || 0),
    trend: (Array.isArray(retention.retentionHealthTrend) ? retention.retentionHealthTrend : [])
      .slice(-8)
      .map((point) => ({
        date: point.date || null,
        retentionHealthScore: numberOrNull(point.retentionHealthScore),
        repeatPurchaseRate90d: numberOrNull(point.repeatPurchaseRate90d),
        productLtv90Cents: numberOrNull(point.productLtv90Cents),
      })),
  };
}

function buildAiProductMomentumInput(momentum = null) {
  if (!momentum) return null;
  const inputs = momentum.inputs || {};
  const weeklyUnits = Array.isArray(inputs.weeklyUnitsLast4Weeks)
    ? inputs.weeklyUnitsLast4Weeks.slice(-4).map((value) => Number(value || 0))
    : [];

  return {
    available: Boolean(
      numberOrNull(momentum.score) != null
      || weeklyUnits.some((value) => value > 0)
      || Number(inputs.unitsLast30Days || 0) > 0
      || Number(inputs.revenueLast30Days || 0) > 0
    ),
    score: numberOrNull(momentum.score),
    tier: momentum.tier || null,
    direction: momentum.direction || null,
    label: momentum.label || momentum.display?.label || momentum.direction || momentum.tier || null,
    confidence: numberOrNull(momentum.confidence),
    confidenceLabel: momentum.confidenceLabel || null,
    display: {
      label: momentum.display?.label || momentum.label || momentum.direction || momentum.tier || null,
      trendLabel: momentum.display?.trendLabel || null,
      growthLabel: momentum.display?.growthLabel || null,
      growthPercent: numberOrNull(momentum.display?.growthPercent),
      catalogPositionLabel: momentum.display?.catalogPositionLabel || null,
    },
    components: {
      currentVelocityScore: numberOrNull(momentum.components?.currentVelocityScore),
      growthScore: numberOrNull(momentum.components?.growthScore),
      catalogShareScore: numberOrNull(momentum.components?.catalogShareScore),
      trendConsistencyScore: numberOrNull(momentum.components?.trendConsistencyScore),
      recencyScore: numberOrNull(momentum.components?.recencyScore),
    },
    inputs: {
      unitsLast7Days: numberOrNull(inputs.unitsLast7Days),
      unitsLast30Days: numberOrNull(inputs.unitsLast30Days),
      unitsPrevious30Days: numberOrNull(inputs.unitsPrevious30Days),
      revenueLast30Days: numberOrNull(inputs.revenueLast30Days),
      weeklyUnitsLast4Weeks: weeklyUnits,
      lastSaleAt: inputs.lastSaleAt || null,
    },
  };
}

function buildAiRiskHistoryInput(history = []) {
  if (!Array.isArray(history)) return [];
  return history.slice(-16).map((point, index) => {
    const metrics = point.metrics || {};
    return {
      label: point.label || point.recordedAt || point.calculatedAt || `Point ${index + 1}`,
      recordedAt: point.recordedAt || point.calculatedAt || point.completedAt || null,
      riskScore: numberOrNull(point.riskScore ?? metrics.riskScore),
      confidence: numberOrNull(point.confidence ?? metrics.confidence),
      returnRate: numberOrNull(point.returnRate ?? metrics.returnRate),
      refundRate: numberOrNull(point.refundRate ?? metrics.refundRate),
      returnUnits: numberOrNull(point.returnUnits ?? metrics.returnUnits),
      refundUnits: numberOrNull(point.refundUnits ?? metrics.refundUnits),
      negativeReviewCount: numberOrNull(point.negativeReviewCount ?? metrics.negativeReviewCount),
      reviewCount: numberOrNull(point.reviewCount ?? metrics.reviewCount),
      avgRating: numberOrNull(point.avgRating ?? point.averageRating ?? metrics.avgRating ?? metrics.averageRating),
      refundAmount: numberOrNull(point.refundAmount ?? metrics.refundAmount),
      productMomentumScore: numberOrNull(point.productMomentumScore ?? metrics.productMomentumScore),
    };
  });
}

function buildAiIncrementalDiagnosisInput(deterministic = {}) {
  const incremental = deterministic.metrics?.incrementalDiagnosis || null;
  if (!incremental) return null;
  return {
    ...sanitizeIncrementalDiagnosisForAi(incremental),
    productContent: {
      ...(incremental.productContent || {}),
      cachedContentGaps: incremental.productContent?.canReuseContentGaps
        ? incremental.cache?.productContent?.contentGaps || null
        : null,
    },
  };
}

function sanitizeIncrementalDiagnosisForAi(incremental = null) {
  if (!incremental) return null;
  return {
    schemaVersion: incremental.schemaVersion || 1,
    mode: incremental.mode || "full",
    previousCompletedAt: incremental.previousCompletedAt || null,
    cutoffAt: incremental.cutoffAt || null,
    productContent: incremental.productContent || null,
    customerText: incremental.customerText || null,
    refunds: incremental.refunds || null,
    sourceEvents: incremental.sourceEvents || null,
    aiEvidenceSnippetCount: incremental.aiEvidenceSnippetCount || 0,
    note: incremental.mode === "incremental"
      ? "Evidence snippets contain only newly changed evidence since the previous Product Diagnosis. Aggregated deterministic metrics include reused prior analysis plus new analysis."
      : "This diagnosis analyzed the available product data for the configured window.",
  };
}

function buildPersistedIncrementalDiagnosisState({ runtimeState = {}, aiContentGaps = null } = {}) {
  const cache = runtimeState.cache || {};
  const productContentCache = cache.productContent || {};
  return {
    ...runtimeState,
    cache: {
      ...cache,
      productContent: {
        ...productContentCache,
        contentGaps: aiContentGaps || productContentCache.contentGaps || null,
      },
    },
  };
}

function applyAiSemanticClassificationToDeterministic(deterministic = {}, ai = {}) {
  const semantic = buildAiSemanticClassificationSummary(ai);
  if (!semantic.hasSignals) return deterministic;

  const fallbackTextInsights = deterministic.metrics?.textInsights || {};
  const aiAggregateReady = shouldUseAiAggregateTextInsights(deterministic, semantic);
  const nextTextInsights = mergeAiSemanticTextInsights(fallbackTextInsights, semantic, { replaceAggregate: aiAggregateReady });
  const nextIssueSignalCounts = mergeAiIssueSignalCounts(deterministic.issueSignalCounts || {}, semantic.issueSignalCounts, {
    preserveWeightedCounts: Boolean(deterministic.metrics?.signalRecencyWeighting),
    averageWeight: deterministic.metrics?.signalRecencyWeighting?.averageWeight,
  });
  const customerSemanticSignalCount = Object.values(semantic.customerIssueSignalCounts)
    .reduce((total, count) => total + Number(count || 0), 0)
    * Number(deterministic.metrics?.signalRecencyWeighting?.averageWeight || 1);
  const customerSignalCount = Math.max(
    Number(deterministic.metrics?.customerSignalCount || 0),
    customerSemanticSignalCount,
  );
  const signalCount = Math.max(
    Number(deterministic.metrics?.signalCount || 0),
    customerSignalCount + Number(deterministic.metrics?.contentIssueCount || 0),
  );
  const mainIssue = getEvidencePreferredMainIssue({
    ...deterministic,
    issueSignalCounts: nextIssueSignalCounts,
    metrics: {
      ...(deterministic.metrics || {}),
      textInsights: nextTextInsights,
      customerSignalCount,
      signalCount,
    },
  }, getMainIssueFromCounts(nextIssueSignalCounts, ai.classification?.main_issue || deterministic.mainIssue));

  return {
    ...deterministic,
    mainIssue,
    mainIssueLabel: getHumanIssueLabel(mainIssue),
    issueSignalCounts: nextIssueSignalCounts,
    metrics: {
      ...(deterministic.metrics || {}),
      textInsights: nextTextInsights,
      semanticClassification: {
        source: "ai_signal_classification",
        aggregateMode: aiAggregateReady ? "ai_primary" : "ai_delta_overlay",
        classifiedSignalCount: semantic.classifiedSignals.length,
        customerClassifiedSignalCount: semantic.customerSignals.length,
        issueSignalCounts: semantic.issueSignalCounts,
        customerIssueSignalCounts: semantic.customerIssueSignalCounts,
        dominantIssue: mainIssue,
        actionGuidance: semantic.actionGuidance,
      },
      customerSignalCount,
      signalCount,
      issueCount: signalCount,
    },
  };
}

function shouldUseAiAggregateTextInsights(deterministic = {}, semantic = {}) {
  const mode = deterministic.metrics?.incrementalDiagnosis?.mode || "full";
  const fallbackTotal = Number(deterministic.metrics?.textInsights?.sentiment?.total || 0);
  if (!fallbackTotal) return semantic.customerSignals.length > 0;
  if (mode === "full") return semantic.customerSignals.length >= Math.max(1, Math.ceil(fallbackTotal * 0.7));
  return semantic.customerSignals.length >= Math.max(4, Math.ceil(fallbackTotal * 0.85));
}

function buildAiSemanticClassificationSummary(ai = {}) {
  const classifiedSignals = normalizeAiClassifiedSignals(ai.classification?.classified_signals);
  const customerSignals = classifiedSignals.filter((signal) => !isOperationalRefundSignalSource(signal.source));
  const issueSignalCounts = countAiSignalsByIssue(classifiedSignals);
  const customerIssueSignalCounts = countAiSignalsByIssue(customerSignals);
  const sentiment = summarizeAiClassifiedSignalSentiment(customerSignals);
  const returns = summarizeAiClassifiedSignalSource(customerSignals, "returns");
  const reviews = summarizeAiClassifiedSignalSource(customerSignals, "reviews");
  const repeatedLanguage = getFilteredAiRepeatedLanguage(ai)
    .map(normalizeAiRepeatedLanguageItem)
    .filter(Boolean);
  const subjectiveSignals = customerSignals.filter((signal) => signal.issueCode === "subjective_negative_reaction" && signal.sentiment === "negative");
  const otherReturnClassifications = summarizeAiOtherReturnClassifications(customerSignals);
  const actionGuidance = normalizeAiActionGuidance(ai.classification?.action_guidance);

  return {
    hasSignals: Boolean(classifiedSignals.length || repeatedLanguage.length || Array.isArray(ai.classification?.clusters) && ai.classification.clusters.length),
    classifiedSignals,
    customerSignals,
    issueSignalCounts,
    customerIssueSignalCounts,
    sentiment,
    returns,
    reviews,
    repeatedLanguage,
    subjectiveNegativity: {
      count: subjectiveSignals.length,
      total: customerSignals.length,
      ratio: customerSignals.length ? roundRate(subjectiveSignals.length / customerSignals.length, 2) : 0,
      sourceCounts: countBy(subjectiveSignals.map((signal) => signal.sourceGroup)),
      examples: subjectiveSignals.slice(0, 4).map((signal) => truncateText(signal.text, 180)),
    },
    otherReturnClassifications,
    actionGuidance,
    summary: ai.classification?.sentiment_summary || {},
  };
}

function normalizeAiActionGuidance(value = {}) {
  if (!value || typeof value !== "object") return null;
  const issueNature = normalizeAiActionGuidanceEnum(value.issue_nature || value.issueNature, [
    "operational_quality",
    "subjective_expectation",
    "content_gap",
    "relationship_expectation",
    "source_integrity",
    "commercial_opportunity",
    "monitor_only",
    "unclear",
  ], "unclear");
  const subjectivityLevel = normalizeAiActionGuidanceEnum(value.subjectivity_level || value.subjectivityLevel, ["low", "medium", "high"], "medium");
  const operationalQualityConfidence = normalizeAiActionGuidanceEnum(value.operational_quality_confidence || value.operationalQualityConfidence, ["low", "medium", "high"], "low");
  const shopperExpectationConfidence = normalizeAiActionGuidanceEnum(value.shopper_expectation_confidence || value.shopperExpectationConfidence, ["low", "medium", "high"], "medium");
  const primaryActionFamily = normalizeAiActionGuidanceEnum(value.primary_action_family || value.primaryActionFamily, ACTION_GUIDANCE_FAMILIES, "");
  const recommendedActionFamilies = normalizeAiActionFamilies(value.recommended_action_families || value.recommendedActionFamilies);
  const blockedActionFamilies = normalizeAiActionFamilies(value.blocked_action_families || value.blockedActionFamilies);
  const shouldEscalateQa = value.should_escalate_qa === true || value.shouldEscalateQa === true;
  return {
    issueNature,
    subjectivityLevel,
    operationalQualityConfidence,
    shopperExpectationConfidence,
    shouldEscalateQa,
    qaReason: truncateText(value.qa_reason || value.qaReason || "", 260),
    primaryActionFamily,
    recommendedActionFamilies,
    blockedActionFamilies,
    rationale: truncateText(value.rationale || value.reason || "", 320),
  };
}

const ACTION_GUIDANCE_FAMILIES = [
  "description_update",
  "faq",
  "specs_block",
  "media_context",
  "qa_review",
  "variant_review",
  "source_integrity",
  "workflow_only",
  "monitor",
  "inventory_hold",
  "status_change",
];

function normalizeAiActionGuidanceEnum(value = "", allowed = [], fallback = "") {
  const normalized = String(value || "").toLowerCase().replace(/[-\s]+/g, "_").trim();
  return allowed.includes(normalized) ? normalized : fallback;
}

function normalizeAiActionFamilies(values = []) {
  const list = Array.isArray(values) ? values : String(values || "").split(/[,|]/);
  return uniqueBy(
    list.map((value) => normalizeAiActionGuidanceEnum(value, ACTION_GUIDANCE_FAMILIES, "")).filter(Boolean),
    String,
  ).slice(0, 8);
}

function normalizeAiClassifiedSignals(signals = []) {
  return (Array.isArray(signals) ? signals : [])
    .map((signal) => {
      const issueCode = normalizeAiSignalIssueCode(signal.issue_category || signal.issue || signal.issue_detail);
      const source = String(signal.source || "").trim().toLowerCase();
      const sourceGroup = getAiSignalSourceGroup(source);
      const text = String(signal.text || signal.evidence || "").replace(/\s+/g, " ").trim();
      const sentiment = normalizeSentimentForPositiveRecovery(normalizeAiSentiment(signal.sentiment), text);
      const rawEmotion = normalizeEmotionCode(signal.known_emotion) || "none";
      return {
        source,
        sourceGroup,
        text,
        issueCode,
        issueDetail: signal.issue_detail || "",
        sentiment,
        emotion: normalizeAiEmotionForSentiment(rawEmotion, sentiment, text),
        severity: normalizeSeverity(signal.severity || "medium"),
        productRelated: signal.product_related !== false,
      };
    })
    .filter((signal) => signal.productRelated && signal.issueCode && signal.text);
}

function normalizeAiEmotionForSentiment(emotionCode = "none", sentiment = "neutral", text = "") {
  const code = normalizeEmotionCode(emotionCode) || "none";
  if (code === "none") return code;
  const polarity = getEmotionPolarity(code);
  if (sentiment === "positive" && polarity === "negative") {
    const recoveredEmotion = classifyCustomerEmotion(text, 5);
    return recoveredEmotion && getEmotionPolarity(recoveredEmotion) === "positive" ? recoveredEmotion : "satisfaction";
  }
  if (sentiment === "negative" && polarity === "positive") return "frustration";
  return code;
}

function normalizeAiSignalIssueCode(value) {
  const issueCode = normalizeIssueCode(value);
  if (!issueCode || issueCode === "other") return "product_quality";
  return issueCode;
}

function normalizeAiSentiment(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "positive" || normalized === "negative" || normalized === "neutral") return normalized;
  return "neutral";
}

function getAiSignalSourceGroup(source = "") {
  const value = String(source || "").toLowerCase();
  if (value.includes("refund")) return "refunds";
  if (value.includes("return")) return "returns";
  if (value.includes("review") || value.includes("judgeme") || value.includes("yotpo") || value.includes("loox") || value.includes("csv")) return "reviews";
  return "customer_language";
}

function isOperationalRefundSignalSource(source = "") {
  return String(source || "").toLowerCase().includes("refund");
}

function countAiSignalsByIssue(signals = []) {
  return signals.reduce((counts, signal) => {
    if (String(signal.sentiment || "").toLowerCase() === "positive") return counts;
    const issue = normalizeIssueCode(signal.issueCode);
    if (!issue) return counts;
    counts[issue] = (counts[issue] || 0) + 1;
    return counts;
  }, {});
}

function summarizeAiClassifiedSignalSentiment(signals = []) {
  const counts = { positive: 0, neutral: 0, negative: 0 };
  signals.forEach((signal) => {
    counts[normalizeAiSentiment(signal.sentiment)] += 1;
  });
  const total = signals.length;
  const dominant = total
    ? Object.entries(counts).sort((first, second) => second[1] - first[1])[0][0]
    : "neutral";
  return {
    ...counts,
    total,
    dominant: counts.negative > 0 && counts.negative === counts.positive ? "mixed" : dominant,
    negativeRatio: total ? roundRate(counts.negative / total, 2) : 0,
  };
}

function summarizeAiClassifiedSignalSource(signals = [], sourceGroup) {
  const scoped = signals.filter((signal) => signal.sourceGroup === sourceGroup);
  return {
    total: scoped.length,
    sentiment: summarizeAiClassifiedSignalSentiment(scoped),
    emotions: summarizeAiSignalEmotions(scoped),
    subjectiveNegativity: {
      count: scoped.filter((signal) => signal.issueCode === "subjective_negative_reaction" && signal.sentiment === "negative").length,
      total: scoped.length,
      ratio: scoped.length ? roundRate(scoped.filter((signal) => signal.issueCode === "subjective_negative_reaction" && signal.sentiment === "negative").length / scoped.length, 2) : 0,
      sourceCounts: countBy(scoped.map((signal) => signal.sourceGroup)),
      examples: scoped
        .filter((signal) => signal.issueCode === "subjective_negative_reaction")
        .slice(0, 4)
        .map((signal) => truncateText(signal.text, 180)),
    },
    repeatedLanguage: [],
    examples: scoped
      .filter((signal) => signal.sentiment === "negative")
      .slice(0, 4)
      .map((signal) => ({
        text: truncateText(signal.text, 180),
        sentiment: signal.sentiment,
        emotion: signal.emotion,
        issueCode: signal.issueCode,
        source: signal.source,
        sourceLabel: sourceGroup === "returns" ? "Returns" : "Reviews",
      })),
  };
}

function summarizeAiSignalEmotions(signals = []) {
  const grouped = new Map();
  signals.forEach((signal) => {
    const code = normalizeEmotionCode(signal.emotion);
    if (!code || code === "none") return;
    const current = grouped.get(code) || {
      code,
      label: getEmotionLabel(code),
      polarity: getEmotionPolarity(code),
      count: 0,
      sources: new Set(),
      examples: [],
    };
    current.count += 1;
    if (signal.sourceGroup) current.sources.add(signal.sourceGroup);
    if (signal.text && current.examples.length < 3) current.examples.push(truncateText(signal.text, 140));
    grouped.set(code, current);
  });
  return Array.from(grouped.values())
    .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label))
    .map((item) => ({ ...item, sources: Array.from(item.sources) }));
}

function normalizeAiRepeatedLanguageItem(item = {}) {
  const term = String(item.term || item.label || item.phrase || "").replace(/\s+/g, " ").trim();
  if (!term) return null;
  const sourceTypes = normalizeSourceTypes(item.source_types || item.sources);
  const sentiment = normalizeAiSentiment(item.sentiment || item.dominantSentiment);
  return {
    term,
    count: Math.max(1, Number(item.count || 1)),
    sources: sourceTypes.length ? sourceTypes : ["ai_signal_classification"],
    sourceTypes,
    issueCode: normalizeIssueCode(item.issue_category || item.issueCode || "repeated_language") || "repeated_language",
    dominantSentiment: sentiment,
    sentiment,
    sentiments: {
      positive: sentiment === "positive" ? Math.max(1, Number(item.count || 1)) : 0,
      neutral: sentiment === "neutral" ? Math.max(1, Number(item.count || 1)) : 0,
      negative: sentiment === "negative" ? Math.max(1, Number(item.count || 1)) : 0,
    },
    emotion: normalizeEmotionCode(item.known_emotion) || "none",
    explanation: item.explanation || "",
    example: item.explanation || term,
    source: "ai_signal_classification",
  };
}

function summarizeAiOtherReturnClassifications(signals = []) {
  const grouped = new Map();
  signals
    .filter((signal) => signal.sourceGroup === "returns" && signal.issueCode && signal.issueCode !== "product_quality")
    .forEach((signal) => {
      const key = signal.issueCode;
      const current = grouped.get(key) || {
        issueCode: key,
        label: getHumanIssueLabel(key),
        count: 0,
        sentimentCounts: { positive: 0, neutral: 0, negative: 0 },
        examples: [],
      };
      current.count += 1;
      current.sentimentCounts[signal.sentiment] = (current.sentimentCounts[signal.sentiment] || 0) + 1;
      if (current.examples.length < 3) current.examples.push(truncateText(signal.text, 160));
      grouped.set(key, current);
    });
  return Array.from(grouped.values()).sort((first, second) => second.count - first.count).slice(0, 5);
}

function mergeAiSemanticTextInsights(fallback = {}, semantic = {}, { replaceAggregate = false } = {}) {
  const repeatedLanguage = mergeSemanticRepeatedLanguage(semantic.repeatedLanguage, fallback.repeatedLanguage);
  const textInsights = {
    ...fallback,
    repeatedLanguage,
    aiRepeatedLanguage: semantic.repeatedLanguage,
    aiSemanticSummary: semantic.summary,
  };

  if (replaceAggregate) {
    return {
      ...textInsights,
      sentiment: semantic.sentiment,
      returns: {
        ...(fallback.returns || {}),
        ...semantic.returns,
        repeatedLanguage: mergeSemanticRepeatedLanguage(
          semantic.repeatedLanguage.filter((item) => item.sources.some((source) => String(source).includes("return"))),
          fallback.returns?.repeatedLanguage,
        ),
      },
      reviews: {
        ...(fallback.reviews || {}),
        ...semantic.reviews,
        repeatedLanguage: mergeSemanticRepeatedLanguage(
          semantic.repeatedLanguage.filter((item) => item.sources.some((source) => String(source).includes("review") || String(source).includes("csv") || String(source).includes("judgeme") || String(source).includes("yotpo") || String(source).includes("loox"))),
          fallback.reviews?.repeatedLanguage,
        ),
      },
      subjectiveNegativity: semantic.subjectiveNegativity,
      otherReturnClassifications: semantic.otherReturnClassifications.length ? semantic.otherReturnClassifications : fallback.otherReturnClassifications || [],
    };
  }

  return {
    ...textInsights,
    subjectiveNegativity: {
      ...(fallback.subjectiveNegativity || {}),
      count: Math.max(Number(fallback.subjectiveNegativity?.count || 0), Number(semantic.subjectiveNegativity?.count || 0)),
      total: Math.max(Number(fallback.subjectiveNegativity?.total || 0), Number(semantic.subjectiveNegativity?.total || 0)),
      ratio: Math.max(Number(fallback.subjectiveNegativity?.ratio || 0), Number(semantic.subjectiveNegativity?.ratio || 0)),
      sourceCounts: {
        ...(fallback.subjectiveNegativity?.sourceCounts || {}),
        ...(semantic.subjectiveNegativity?.sourceCounts || {}),
      },
      examples: uniqueBy([
        ...(semantic.subjectiveNegativity?.examples || []),
        ...(fallback.subjectiveNegativity?.examples || []),
      ], normalizeText).slice(0, 4),
    },
    otherReturnClassifications: uniqueBy([
      ...(semantic.otherReturnClassifications || []),
      ...(fallback.otherReturnClassifications || []),
    ], (item) => item.issueCode || item.label).slice(0, 5),
  };
}

function mergeSemanticRepeatedLanguage(primary = [], fallback = []) {
  return uniqueBy([
    ...(Array.isArray(primary) ? primary : []),
    ...(Array.isArray(fallback) ? fallback : []),
  ].filter(isActionableRepeatedLanguageIssue), (item) => normalizeText(item.term || item.label || item.phrase))
    .sort((first, second) => Number(second.count || 0) - Number(first.count || 0))
    .slice(0, 10);
}

function mergeAiIssueSignalCounts(fallback = {}, aiCounts = {}, options = {}) {
  const next = { ...(fallback || {}) };
  const preserveWeightedCounts = Boolean(options.preserveWeightedCounts);
  const averageWeight = Number(options.averageWeight || 1);
  Object.entries(aiCounts || {}).forEach(([issueCode, count]) => {
    const normalized = normalizeIssueCode(issueCode);
    if (!normalized) return;
    const existing = Number(next[normalized] || 0);
    if (preserveWeightedCounts && existing > 0) {
      next[normalized] = roundWeightedSignalCount(existing);
      return;
    }
    const nextCount = preserveWeightedCounts
      ? Number(count || 0) * averageWeight
      : Number(count || 0);
    next[normalized] = Math.max(existing, roundWeightedSignalCount(nextCount));
  });
  return next;
}

function countBy(values = []) {
  return (Array.isArray(values) ? values : []).reduce((counts, value) => {
    const key = String(value || "").trim();
    if (!key) return counts;
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function buildRuleRecommendationCandidates(deterministic) {
  const issue = deterministic.mainIssue;
  const hasActionableMainIssue = hasActionableIssueEvidence(deterministic, issue);
  const faqNeed = deterministic.metrics?.faqNeed || {};
  const recipeSignals = getRecommendationRecipeSignals(deterministic);
  const contentIssues = getActionableContentIssues(deterministic.metrics || {});
  const lowRiskMonitoringOnly = isLowRiskMonitoringOnlyDiagnosis(deterministic);
  const canSurfaceCustomerFacingCandidate = !lowRiskMonitoringOnly
    || hasMaterialCustomerProblemEvidence(deterministic)
    || hasCriticalContentIssue(contentIssues);
  const candidates = [];
  if (issue === "fit_sizing" && hasActionableMainIssue) {
    candidates.push({ id: "draft-fit-note", type: "PDP copy", reason: "Fit or size language appears in returns/reviews." });
  }
  if (faqNeed.shouldRecommend && canSurfaceCustomerFacingCandidate) {
    candidates.push({
      id: "create-product-faq",
      type: "FAQ",
      reason: faqNeed.reasons?.[0] || "Repeated buyer uncertainty deserves a shopper-facing FAQ.",
      topics: faqNeed.topics || [],
      score: faqNeed.score,
    });
  }
  if (issue === "color_expectation" && hasActionableMainIssue) candidates.push({ id: "draft-color-expectation-note", type: "PDP copy", reason: "Customers mention color expectation mismatch." });
  if (issue === "safety_concern" && hasActionableMainIssue) candidates.push({ id: "draft-safety-expectation-note", type: "PDP copy", reason: "Customer return text expresses fear, safety concern, or discomfort." });
  if (issue === "subjective_negative_reaction" && hasActionableMainIssue) candidates.push({ id: "draft-subjective-expectation-note", type: "PDP copy", reason: "Repeated subjective negative customer language is present." });
  if (issue === "setup_expectation" && hasActionableMainIssue) candidates.push({ id: "improve-setup-guidance", type: "PDP copy", reason: "Setup or expectation mismatch signals were detected." });
  if ((issue === "quality_defect" || issue === "durability") && hasActionableMainIssue) candidates.push({ id: "draft-quality-note", type: "PDP copy", reason: "Quality or durability signals were detected." });
  if (deterministic.metrics.affectedVariants.length && (deterministic.metrics.returnUnits + deterministic.metrics.refundUnits) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) candidates.push({ id: "review-affected-variants", type: "Workflow", reason: "Signals are concentrated in specific variants." });
  if (deterministic.metrics.topReturnReasons.length && deterministic.metrics.returnUnits >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) candidates.push({ id: "review-return-reasons", type: "Workflow", reason: "Return reasons are available and repeated." });
  if (deterministic.metrics.refundInsights?.shouldSurface) candidates.push({ id: "review-refund-impact", type: "Workflow", reason: "Refund rate, refund value or refund notes indicate operational refund pressure." });
  if (deterministic.metrics.negativeReviewCount >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) candidates.push({ id: "review-negative-reviews", type: "Workflow", reason: "Connected negative review text is available." });
  if (deterministic.metrics.contentIssueCount > 0 && canSurfaceCustomerFacingCandidate) {
    const currentDescription = deterministic.product?.description || "";
    if (shouldRecommendFullDescriptionRewrite({ contentIssues, currentDescription })) {
      candidates.push({ id: "rewrite-product-description", type: "PDP copy", reason: "Product content analysis found missing, short or incoherent product copy." });
    } else if (getDescriptionReplacementsFromContentIssues(contentIssues).length) {
      candidates.push({ id: "correct-product-description", type: "PDP copy", reason: "Product content analysis found a specific contradiction that can be corrected without rewriting the full description." });
    } else if (buildTargetedDescriptionEnhancementPlan({ currentDescription, contentIssues, product: deterministic.product }).shouldRecommend) {
      candidates.push({ id: "correct-product-description", type: "PDP copy", reason: "Product content analysis found a partial copy gap that can be handled with a targeted description edit." });
    } else {
      candidates.push({ id: "add-product-description-guidance", type: "PDP copy", reason: "Product content analysis found a specific shopper guidance gap that can be added without rewriting the full description." });
    }
    candidates.push({ id: "align-product-metadata", type: "Workflow", reason: "Title, description, tags, collections and product type should tell a consistent story." });
  }
  if (recipeSignals.title.shouldRecommend) candidates.push({ id: "update-product-title", type: "Product title", reason: recipeSignals.title.reason });
  if (recipeSignals.seoTitle.shouldRecommend) candidates.push({ id: "rewrite-seo-title", type: "SEO title", reason: recipeSignals.seoTitle.reason });
  if (recipeSignals.metaDescription.shouldRecommend) candidates.push({ id: "rewrite-meta-description", type: "SEO meta description", reason: recipeSignals.metaDescription.reason });
  if (recipeSignals.handle.shouldRecommend) candidates.push({ id: "improve-url-handle", type: "URL handle", reason: recipeSignals.handle.reason });
  if (recipeSignals.specs.shouldRecommend) candidates.push({ id: "add-specs-details-block", type: "PDP copy", reason: recipeSignals.specs.reason });
  if (recipeSignals.variants.shouldRecommend) candidates.push({ id: "correct-variant-options", type: "Variant options", reason: recipeSignals.variants.reason });
  if (recipeSignals.pricing.shouldRecommend) candidates.push({ id: "review-product-pricing", type: "Commercial review", reason: recipeSignals.pricing.reason });
  if (recipeSignals.status.shouldRecommend) candidates.push({ id: "set-product-draft", type: "High-risk action", reason: recipeSignals.status.reason });
  if (recipeSignals.inventory.shouldRecommend) candidates.push({ id: "limit-variant-inventory", type: "Inventory hold", reason: recipeSignals.inventory.reason });
  if (recipeSignals.collection.shouldRecommend) candidates.push({ id: "move-to-review-collection", type: "Merchandising review", reason: recipeSignals.collection.reason });
  if (recipeSignals.media.shouldRecommend) candidates.push({ id: "improve-product-media", type: "Media guidance", reason: recipeSignals.media.reason });
  if (recipeSignals.mediaOrder.shouldRecommend) candidates.push({ id: "reorder-product-media", type: "Media order", reason: recipeSignals.mediaOrder.reason });
  if (recipeSignals.contextualMedia.shouldRecommend) candidates.push({ id: "add-contextual-media-recommendation", type: "Media guidance", reason: recipeSignals.contextualMedia.reason });
  if (recipeSignals.classification.shouldRecommend) candidates.push({ id: "update-product-classification", type: "Product classification", reason: recipeSignals.classification.reason });
  if (recipeSignals.structuredMetafields.shouldRecommend && !isDisabledProductAction("add-structured-metafields")) candidates.push({ id: "add-structured-metafields", type: "Product metafield", reason: recipeSignals.structuredMetafields.reason });
  if (recipeSignals.template.shouldRecommend && !isDisabledProductAction("switch-product-template")) candidates.push({ id: "switch-product-template", type: "Product template", reason: recipeSignals.template.reason });
  if (recipeSignals.sourceMismatch.shouldRecommend) candidates.push({ id: "fix-source-review-mismatch", type: "Source integrity", reason: recipeSignals.sourceMismatch.reason });
  if (recipeSignals.missingSource.shouldRecommend) candidates.push({ id: "connect-missing-source", type: "Evidence coverage", reason: recipeSignals.missingSource.reason });
  if (recipeSignals.baselineScan.shouldRecommend) candidates.push({ id: "create-baseline-scan", type: "Baseline scan", reason: recipeSignals.baselineScan.reason });
  if (recipeSignals.watchlist.shouldRecommend) candidates.push({ id: "add-to-watchlist", type: "Watchlist", reason: recipeSignals.watchlist.reason });
  if (recipeSignals.fullDiagnosis.shouldRecommend) candidates.push({ id: "run-full-diagnosis", type: "Diagnosis", reason: recipeSignals.fullDiagnosis.reason });
  if (recipeSignals.qa.shouldRecommend) candidates.push({ id: "recommend-qa-review", type: "Operational QA", reason: recipeSignals.qa.reason });
  if (recipeSignals.relationshipCompatibility.shouldRecommend) candidates.push({ id: "review-product-pairing-expectations", type: "Compatibility review", reason: recipeSignals.relationshipCompatibility.reason });
  if (recipeSignals.relationshipBundle.shouldRecommend) candidates.push({ id: "test-product-bundle", type: "Bundle opportunity", reason: recipeSignals.relationshipBundle.reason });
  if (recipeSignals.relationshipCrossSell.shouldRecommend) candidates.push({ id: "create-post-purchase-cross-sell", type: "Cross-sell", reason: recipeSignals.relationshipCrossSell.reason });
  if (recipeSignals.relationshipJourney.shouldRecommend) candidates.push({ id: "position-as-upgrade-path", type: "Journey insight", reason: recipeSignals.relationshipJourney.reason });
  if (recipeSignals.relationshipCollection.shouldRecommend) candidates.push({ id: "add-to-related-product-collection", type: "Collection merchandising", reason: recipeSignals.relationshipCollection.reason });
  if (recipeSignals.retentionRepurchaseCampaign.shouldRecommend) candidates.push({ id: "create-repurchase-campaign", type: "Retention campaign", reason: recipeSignals.retentionRepurchaseCampaign.reason });
  if (recipeSignals.retentionCrossSellCampaign.shouldRecommend) candidates.push({ id: "create-retention-cross-sell-campaign", type: "Lifecycle campaign", reason: recipeSignals.retentionCrossSellCampaign.reason });
  if (recipeSignals.retentionBundleOffer.shouldRecommend) candidates.push({ id: "test-retention-bundle-offer", type: "Bundle campaign", reason: recipeSignals.retentionBundleOffer.reason });
  if (recipeSignals.retentionDropReview.shouldRecommend) candidates.push({ id: "review-retention-drop", type: "Retention review", reason: recipeSignals.retentionDropReview.reason });
  if (!lowRiskMonitoringOnly && (hasActionableMainIssue || deterministic.metrics.contentIssueCount > 0)) candidates.push({ id: "copy-support-note", type: "Internal note", reason: "Support can use a concise product-specific note." });
  return candidates;
}

function analyzeFaqOpportunity({
  mainIssue,
  issueSignalCounts = {},
  contentAnalysis = {},
  textInsights = {},
  topReturnReasons = [],
  affectedVariants = [],
  reviewCount = 0,
  negativeReviewCount = 0,
  returnUnits = 0,
  refundUnits = 0,
} = {}) {
  const reasons = [];
  const topics = new Set();
  const sources = new Set();
  let score = 0;
  let signals = 0;

  const add = ({ topic, reason, weight = 1, signalCount = 0, source = "" }) => {
    if (topic) topics.add(topic);
    if (reason && !reasons.includes(reason)) reasons.push(reason);
    if (source) sources.add(source);
    score += weight;
    signals += Number(signalCount || 0);
  };

  const normalizedIssue = normalizeIssueCode(mainIssue);
  const issueSignals = Number(issueSignalCounts[normalizedIssue] || 0);
  const customerSignals = Number(returnUnits || 0) + Number(refundUnits || 0) + Number(negativeReviewCount || 0);
  const contentIssues = Array.isArray(contentAnalysis.issues) ? contentAnalysis.issues : [];
  const contentAdvisories = Array.isArray(contentAnalysis.advisories) ? contentAnalysis.advisories : [];
  const guidanceIssues = [...contentIssues, ...contentAdvisories].filter(isFaqRelevantContentGap);
  const emotions = Array.isArray(textInsights.emotions) ? textInsights.emotions : [];
  const repeatedLanguage = Array.isArray(textInsights.repeatedLanguage) ? textInsights.repeatedLanguage : [];
  const confusionSignals = emotions
    .filter((item) => ["confusion", "uncertainty", "distrust"].includes(normalizeEmotionCode(item.code)))
    .reduce((total, item) => total + Number(item.count || 0), 0);
  const repeatedFaqLanguage = repeatedLanguage
    .filter((item) => isFaqRelevantText(item.term) && Number(item.count || 0) >= 2);
  const returnReasonQuestions = (Array.isArray(topReturnReasons) ? topReturnReasons : [])
    .filter((item) => isFaqRelevantText(item.label || item));

  if (["fit_sizing", "compatibility", "color_expectation"].includes(normalizedIssue) && issueSignals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) {
    add({
      topic: getFaqTopicForIssue(normalizedIssue),
      reason: `${getHumanIssueLabel(normalizedIssue)} signals repeat enough to answer before purchase.`,
      weight: 3,
      signalCount: issueSignals,
      source: "Issue signals",
    });
  }

  if (normalizedIssue === "quality_defect" && issueSignals >= 3 && guidanceIssues.length) {
    add({
      topic: "Product expectations",
      reason: "Quality signals and product-content gaps indicate shoppers need clearer expectations.",
      weight: 2,
      signalCount: issueSignals,
      source: "Quality evidence",
    });
  }

  if (guidanceIssues.length >= 2 || (guidanceIssues.length && customerSignals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE)) {
    add({
      topic: "Product information",
      reason: `${guidanceIssues.length} product-content gap${guidanceIssues.length === 1 ? "" : "s"} can be answered as FAQ guidance.`,
      weight: Math.min(3, guidanceIssues.length),
      signalCount: guidanceIssues.length,
      source: "Product content",
    });
  }

  if (confusionSignals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) {
    add({
      topic: "Buyer uncertainty",
      reason: `${confusionSignals} customer text signal${confusionSignals === 1 ? "" : "s"} show confusion, uncertainty or distrust.`,
      weight: 3,
      signalCount: confusionSignals,
      source: "Customer language",
    });
  }

  if (repeatedFaqLanguage.length >= 2 || (repeatedFaqLanguage.length && customerSignals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE)) {
    const topTerm = repeatedFaqLanguage[0];
    add({
      topic: getFaqTopicForText(topTerm.term),
      reason: `Repeated customer language points to FAQ-worthy guidance: "${topTerm.term}".`,
      weight: Math.min(3, 1 + repeatedFaqLanguage.length),
      signalCount: repeatedFaqLanguage.reduce((total, item) => total + Number(item.count || 0), 0),
      source: "Repeated language",
    });
  }

  if (returnReasonQuestions.length && Number(returnUnits || 0) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) {
    add({
      topic: getFaqTopicForText(returnReasonQuestions[0].label || returnReasonQuestions[0]),
      reason: "Return reasons contain details that can be clarified before checkout.",
      weight: 2,
      signalCount: Number(returnUnits || 0),
      source: "Returns",
    });
  }

  if (affectedVariants.length && normalizedIssue === "fit_sizing" && customerSignals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) {
    add({
      topic: "Variant guidance",
      reason: "Affected variants suggest shoppers may need size, option or variant guidance.",
      weight: 1,
      signalCount: affectedVariants.length,
      source: "Variants",
    });
  }

  const topicCount = topics.size;
  const sourceCount = sources.size;
  const hasCustomerEvidence = customerSignals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE
    || confusionSignals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE
    || issueSignals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE
    || repeatedFaqLanguage.reduce((total, item) => total + Number(item.count || 0), 0) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE;
  const hasMultiAspectQuestion = topicCount >= 2
    || sourceCount >= 2
    || guidanceIssues.length >= 2
    || repeatedFaqLanguage.length >= 2
    || returnReasonQuestions.length >= 2;
  const hasBroadReviewContext = Number(reviewCount || 0) >= 4 && Number(negativeReviewCount || 0) >= 2;
  const hasEvidenceThreshold = hasCustomerEvidence && (hasMultiAspectQuestion || hasBroadReviewContext);
  const shouldRecommend = score >= 4 && hasEvidenceThreshold;

  return {
    shouldRecommend,
    score,
    signals,
    topics: Array.from(topics).slice(0, 5),
    reasons: reasons.slice(0, 5),
    sourceTypes: Array.from(sources),
    evidenceThreshold: hasEvidenceThreshold ? "met" : "not_met",
    topicCount,
    sourceCount,
  };
}

function isFaqRelevantContentGap(issue = {}) {
  const code = normalizeContentIssueCode(issue.code);
  const text = normalizeText(`${issue.label || ""} ${issue.evidence || ""} ${issue.suggested_action || ""}`);
  if (["missing_customer_guidance", "missing_specifications", "short_description", "missing_description"].includes(code)) return true;
  return /(faq|question|guidance|how to|how does|compatible|compatibility|fit|size|sizing|care|material|dimension|included|instruction|unclear|confus)/.test(text);
}

function isFaqRelevantText(value) {
  const text = normalizeText(value);
  if (!text) return false;
  return /(fit|size|sizing|compatible|compatibility|work with|works with|filter|color|material|care|wash|dimension|included|how|what|which|does|can|confus|unclear|instruction|setup|install|use)/.test(text);
}

function getFaqTopicForIssue(issueCode) {
  if (issueCode === "fit_sizing") return "Fit and sizing";
  if (issueCode === "compatibility") return "Compatibility";
  if (issueCode === "color_expectation") return "Color expectations";
  if (issueCode === "quality_defect") return "Product quality";
  return "Product guidance";
}

function getFaqTopicForText(value) {
  const text = normalizeText(value);
  if (/(fit|size|sizing)/.test(text)) return "Fit and sizing";
  if (/(compatible|compatibility|work with|works with|filter)/.test(text)) return "Compatibility";
  if (/(care|wash|material|fabric)/.test(text)) return "Materials and care";
  if (/(dimension|measure|width|height|length)/.test(text)) return "Dimensions";
  if (/(color|pictured|photo|image)/.test(text)) return "Color expectations";
  return "Product guidance";
}

function buildFinalRecommendations({ snapshot, deterministic, ai, mainIssue }) {
  const copy = ai.report?.recommendation_copy || {};
  const actionRationales = getAiActionRationaleMap(ai);
  const contentCoverage = getAiContentCoverageMap(ai);
  const recommendations = [];
  const issueLabel = getHumanIssueLabel(mainIssue);
  const topReasons = deterministic.metrics.topReturnReasons || [];
  const affectedVariants = deterministic.metrics.affectedVariants || [];
  const recipeSignals = getRecommendationRecipeSignals(deterministic);
  const relationshipExpectationMode = isRelationshipExpectationMismatchDiagnosis(deterministic);
  const sourceIntegrityMode = isSourceIntegrityDiagnosis(deterministic, recipeSignals.sourceMismatch?.signals);
  const rawPdpCopy = copy.pdp_copy || buildDefaultPdpCopy(snapshot.productTitle, issueLabel, topReasons);
  const pdpCopy = copy.pdp_copy
    ? applyAiContentCoverageToText({
        coverageMap: contentCoverage,
        id: "pdp_copy",
        text: rawPdpCopy,
      })
    : rawPdpCopy;
  const aiProductDescription = applyAiContentCoverageToText({
    coverageMap: contentCoverage,
    id: "product_description",
    text: copy.product_description || "",
  });
  const aiSpecsBlock = applyAiContentCoverageToText({
    coverageMap: contentCoverage,
    id: "specs_details_block",
    text: copy.specs_details_block || copy.specs_block || "",
  });
  const contentAnalysis = deterministic.metrics.contentAnalysis || {};
  const contentIssues = Array.isArray(contentAnalysis.issues) ? contentAnalysis.issues : [];
  const currentDescriptionText = getCurrentProductDescriptionText(deterministic.product);
  const currentDescriptionHtml = getCurrentProductDescriptionHtml(deterministic.product);
  const descriptionReplacements = getDescriptionReplacementsFromContentIssues(contentIssues);
  const correctedDescriptionDraft = buildCorrectedDescriptionDraft({
    currentDescription: currentDescriptionText,
    replacements: descriptionReplacements,
  });
  const shouldRewriteDescription = shouldRecommendFullDescriptionRewrite({
    contentIssues,
    currentDescription: currentDescriptionText,
  });
  const shouldCorrectDescription = !shouldRewriteDescription
    && descriptionReplacements.length > 0
    && isMeaningfullyDifferentDescription(currentDescriptionText, correctedDescriptionDraft);
  const targetedDescriptionEnhancement = !shouldRewriteDescription && !shouldCorrectDescription
    ? buildTargetedDescriptionEnhancementPlan({
      currentDescription: currentDescriptionText,
      contentIssues,
      product: deterministic.product,
    })
    : buildEmptyDescriptionEnhancementPlan("A rewrite or correction already covers the content issue.");
  const reviewSections = [];
  const supportNote = copy.support_note || `${snapshot.productTitle}: ${issueLabel}. Review ${topReasons.join(", ") || "stored customer signals"} and watch ${affectedVariants.join(", ") || "all variants"}.`;
  const subjectiveSummary = deterministic.metrics.textInsights?.subjectiveNegativity || {};
  const subjectiveExpectationOnly = isSubjectiveExpectationOnlyDiagnosis(deterministic);
  const shouldRecommendSubjectiveAction = mainIssue !== "subjective_negative_reaction" || hasActionableSubjectiveEvidence(subjectiveSummary);
  const hasActionableMainIssue = hasActionableIssueEvidence(deterministic, mainIssue);
  const pdpActionId = getPdpActionId(mainIssue);
  const pdpActionLabel = getPdpActionLabel(mainIssue);
  const focusedRemediationMode = isFocusedRemediationDiagnosis(deterministic, { subjectiveExpectationOnly });
  const canRecommendCustomerFacingCopy = !sourceIntegrityMode;
  const lowRiskMonitoringOnly = isLowRiskMonitoringOnlyDiagnosis(deterministic);
  const materialCustomerProblemEvidence = hasMaterialCustomerProblemEvidence(deterministic);
  const criticalContentIssue = hasCriticalContentIssue(contentIssues);
  const canRecommendCustomerFacingFix = canRecommendCustomerFacingCopy
    && (!lowRiskMonitoringOnly || materialCustomerProblemEvidence || criticalContentIssue);
  const primaryPdpDescriptionPlan = buildDescriptionCoveragePlan({
    currentDescription: currentDescriptionText,
    proposedText: pdpCopy,
    operation: getPdpCopyPlacement(mainIssue),
  });
  const primaryPdpDescriptionAction = Boolean(canRecommendCustomerFacingFix
    && hasActionableMainIssue
    && mainIssue !== "product_content"
    && shouldRecommendSubjectiveAction
    && primaryPdpDescriptionPlan.shouldRecommend
    && !shouldSuppressCoveredPdpDescriptionAction({
      mainIssue,
      proposedText: pdpCopy,
      currentDescriptionText,
      deterministic,
    }));
  const shopperGuidanceForDescription = primaryPdpDescriptionAction ? primaryPdpDescriptionPlan.draftText : "";
  const descriptionDraftForRewrite = shouldRewriteDescription ? buildEnhancedDescriptionDraft({
    title: snapshot.productTitle,
    currentDescription: currentDescriptionText,
    suggestedDescription: aiProductDescription || "",
    shopperGuidance: shopperGuidanceForDescription,
    contentAnalysis,
  }) : "";
  const appendedDescriptionGuidance = getAppendedDescriptionText(currentDescriptionText, descriptionDraftForRewrite);
  const initialRewriteDescriptionOperation = shouldRewriteDescription && appendedDescriptionGuidance ? "append" : "replace";
  const descriptionRewritePlan = shouldRewriteDescription ? buildDescriptionCoveragePlan({
    currentDescription: currentDescriptionText,
    proposedText: initialRewriteDescriptionOperation === "append"
      ? (appendedDescriptionGuidance || descriptionDraftForRewrite)
      : descriptionDraftForRewrite,
    operation: initialRewriteDescriptionOperation,
    allowReplace: true,
  }) : buildEmptyDescriptionCoveragePlan("No product description rewrite was needed.");
  const rewriteDescriptionOperation = descriptionRewritePlan.operation || initialRewriteDescriptionOperation;
  const hasRewriteDescriptionAction = Boolean(shouldRewriteDescription && descriptionRewritePlan.shouldRecommend);
  const rewriteDescriptionLabel = rewriteDescriptionOperation === "append" ? "Add text to end of description" : "Rewrite product description";
  const faqNeed = deterministic.metrics.faqNeed || {};
  const faqRecommendation = buildRecommendedFaqRecommendation({
    copy,
    snapshot,
    mainIssue,
    pdpCopy,
    faqNeed,
    currentDescriptionText,
    contentCoverage,
  });
  const faqItems = faqRecommendation.items;

  if (primaryPdpDescriptionAction) {
    recommendations.push({
      id: pdpActionId,
      label: pdpActionLabel,
      type: mainIssue === "fit_sizing" && copy.faq_answer ? "PDP copy" : "PDP copy",
      effort: "Low",
      status: "Draft",
        payload: {
          draftText: primaryPdpDescriptionPlan.draftText,
          issue: mainIssue,
          currentDescriptionText,
          currentDescriptionHtml,
          operation: primaryPdpDescriptionPlan.operation,
        placement: primaryPdpDescriptionPlan.operation,
        contentCoverage: primaryPdpDescriptionPlan.coverage,
        causeKey: getRecommendationCauseKey({ issue: mainIssue, text: primaryPdpDescriptionPlan.draftText, deterministic }),
        relatedActionIds: hasRewriteDescriptionAction ? ["rewrite-product-description"] : shouldCorrectDescription ? ["correct-product-description"] : [],
        relatedActionLabels: hasRewriteDescriptionAction ? [rewriteDescriptionLabel] : shouldCorrectDescription ? ["Correct product description"] : [],
      },
    });
  }

  if (contentIssues.length > 0 && canRecommendCustomerFacingFix) {
    if (hasRewriteDescriptionAction) {
      recommendations.push({
        id: "rewrite-product-description",
        label: rewriteDescriptionOperation === "append" ? "Add text to end of description" : "Rewrite product description",
        type: "PDP copy",
        effort: "Low",
        status: "Draft",
        payload: {
          draftText: descriptionRewritePlan.draftText,
          issue: "product_content",
          currentDescriptionText,
          currentDescriptionHtml,
          contentIssues: contentIssues.map((issue) => ({
            label: issue.label,
            evidence: issue.evidence,
            severity: issue.severity,
            code: issue.code,
          })),
          changeStrategy: rewriteDescriptionOperation === "append" ? "add-guidance" : currentDescriptionText ? "preserve-and-expand" : "write-from-scratch",
          operation: rewriteDescriptionOperation,
          placement: rewriteDescriptionOperation === "append" ? "append" : undefined,
          contentCoverage: descriptionRewritePlan.coverage,
          causeKey: getRecommendationCauseKey({ issue: "product_content", text: descriptionRewritePlan.draftText, deterministic }),
          relatedActionIds: primaryPdpDescriptionAction ? [pdpActionId] : [],
          relatedActionLabels: primaryPdpDescriptionAction ? [pdpActionLabel] : [],
        },
      });
    } else if (shouldCorrectDescription) {
      recommendations.push({
        id: "correct-product-description",
        label: "Correct product description",
        type: "PDP copy",
        effort: "Low",
        status: "Draft",
        payload: {
          draftText: correctedDescriptionDraft,
          issue: "product_content",
          currentDescriptionText,
          currentDescriptionHtml,
          contentIssues: contentIssues.map((issue) => ({
            label: issue.label,
            evidence: issue.evidence,
            severity: issue.severity,
            code: issue.code,
          })),
          descriptionReplacements,
          changeStrategy: "targeted-correction",
          operation: "replace",
          preserveHtml: true,
          causeKey: getRecommendationCauseKey({ issue: "product_content", text: correctedDescriptionDraft, deterministic }),
          relatedActionIds: primaryPdpDescriptionAction ? [pdpActionId] : [],
          relatedActionLabels: primaryPdpDescriptionAction ? [pdpActionLabel] : [],
        },
      });
    } else if (targetedDescriptionEnhancement.shouldRecommend) {
      recommendations.push({
        id: "correct-product-description",
        label: "Update product description details",
        type: "PDP copy",
        effort: "Low",
        status: "Draft",
        payload: {
          draftText: targetedDescriptionEnhancement.draftText,
          issue: "product_content",
          currentDescriptionText,
          currentDescriptionHtml,
          contentIssues: contentIssues.map((issue) => ({
            label: issue.label,
            evidence: issue.evidence,
            severity: issue.severity,
            code: issue.code,
          })),
          descriptionReplacements: targetedDescriptionEnhancement.descriptionReplacements,
          changeStrategy: "targeted-enhancement",
          operation: "replace",
          preserveHtml: true,
          contentCoverage: targetedDescriptionEnhancement.coverage,
          causeKey: getRecommendationCauseKey({ issue: "product_content", text: targetedDescriptionEnhancement.draftText, deterministic }),
          relatedActionIds: primaryPdpDescriptionAction ? [pdpActionId] : [],
          relatedActionLabels: primaryPdpDescriptionAction ? [pdpActionLabel] : [],
        },
      });
    } else {
      const descriptionGuidanceDraft = buildDescriptionGuidanceAddendum({
        title: snapshot.productTitle,
        contentIssues,
        suggestedDescription: aiProductDescription || "",
        shopperGuidance: primaryPdpDescriptionAction ? "" : pdpCopy,
      });
      const duplicatesPrimaryPdpAction = primaryPdpDescriptionAction && hasSubstantialOverlap(descriptionGuidanceDraft, pdpCopy);
      const descriptionGuidancePlan = buildDescriptionCoveragePlan({
        currentDescription: currentDescriptionText,
        proposedText: descriptionGuidanceDraft,
        operation: "append",
      });
      if (descriptionGuidancePlan.shouldRecommend && !duplicatesPrimaryPdpAction) {
        recommendations.push({
          id: "add-product-description-guidance",
          label: "Add product description guidance",
          type: "PDP copy",
          effort: "Low",
          status: "Draft",
          payload: {
            draftText: descriptionGuidancePlan.draftText,
            issue: "product_content",
            currentDescriptionText,
            currentDescriptionHtml,
            contentIssues: contentIssues.map((issue) => ({
              label: issue.label,
              evidence: issue.evidence,
              severity: issue.severity,
              code: issue.code,
            })),
            changeStrategy: "add-guidance",
            operation: descriptionGuidancePlan.operation,
            placement: descriptionGuidancePlan.operation,
            contentCoverage: descriptionGuidancePlan.coverage,
            causeKey: getRecommendationCauseKey({ issue: "product_content", text: descriptionGuidancePlan.draftText, deterministic }),
            relatedActionIds: primaryPdpDescriptionAction ? [pdpActionId] : [],
            relatedActionLabels: primaryPdpDescriptionAction ? [pdpActionLabel] : [],
          },
        });
      }
    }

    reviewSections.push({
      key: "content",
      label: "Title, tags and collection alignment",
      source: "Product content",
      count: contentIssues.length,
      items: contentIssues.map((issue) => ({
        label: issue.label,
        evidence: issue.evidence,
        severity: issue.severity,
      })),
    });
  }

  if (canRecommendCustomerFacingFix && faqNeed.shouldRecommend && faqItems.length) {
    recommendations.push({
      id: "create-product-faq",
      label: getFaqActionLabel(mainIssue, faqRecommendation.coverage),
      type: "FAQ",
      effort: "Low",
      status: "Draft",
      payload: {
        draftText: formatFaqItemsAsText(faqItems),
        faqItems,
        faqNeed,
        existingFaqDetected: faqRecommendation.coverage.existingFaqDetected,
        skippedExistingFaqItems: faqRecommendation.coverage.skippedItems,
        contentCoverage: faqRecommendation.coverage,
        issue: mainIssue,
        operation: "append",
        placement: "append",
        defaultApplyMode: "description-collapsible",
        applicationOptions: getFaqApplicationOptions(),
        metafield: {
          namespace: "productpulse",
          key: "faq_html",
          type: "multi_line_text_field",
        },
      },
    });
  }

  const suggestedProductTitle = normalizeSuggestedTitle(copy.product_title || buildSuggestedProductTitle(deterministic.product, mainIssue));
  if (recipeSignals.title.shouldRecommend && hasMeaningfulDraftFieldChange({
    currentValue: deterministic.product?.title || snapshot.productTitle,
    draftValue: suggestedProductTitle,
  })) {
    recommendations.push({
      id: "update-product-title",
      label: "Improve product title",
      type: "Product title",
      effort: "Low",
      status: "Draft",
      payload: {
        field: "title",
        draftTitle: suggestedProductTitle,
        currentTitle: deterministic.product?.title || snapshot.productTitle,
        issue: "product_content",
        trigger: recipeSignals.title.reason,
      },
    });
  }

  const suggestedSeoTitle = buildSuggestedSeoTitle({ product: deterministic.product, snapshot, mainIssue, aiTitle: copy.seo_title || copy.product_title });
  if (recipeSignals.seoTitle.shouldRecommend && hasMeaningfulDraftFieldChange({
    currentValue: deterministic.product?.seoTitle || "",
    draftValue: suggestedSeoTitle,
  })) {
    recommendations.push({
      id: "rewrite-seo-title",
      label: "Rewrite SEO title",
      type: "SEO title",
      effort: "Low",
      status: "Draft",
      payload: {
        field: "seo.title",
        draftText: suggestedSeoTitle,
        currentValue: deterministic.product?.seoTitle || "",
        issue: "seo_content",
        trigger: recipeSignals.seoTitle.reason,
      },
    });
  }

  const suggestedMetaDescription = buildSuggestedMetaDescription({ product: deterministic.product, snapshot, mainIssue, aiDescription: copy.meta_description || "" });
  if (recipeSignals.metaDescription.shouldRecommend && hasMeaningfulDraftFieldChange({
    currentValue: deterministic.product?.seoDescription || "",
    draftValue: suggestedMetaDescription,
  })) {
    recommendations.push({
      id: "rewrite-meta-description",
      label: "Rewrite meta description",
      type: "SEO meta description",
      effort: "Low",
      status: "Draft",
      payload: {
        field: "seo.description",
        draftText: suggestedMetaDescription,
        currentValue: deterministic.product?.seoDescription || "",
        issue: "seo_content",
        trigger: recipeSignals.metaDescription.reason,
      },
    });
  }

  const suggestedProductHandle = buildSuggestedProductHandle({ product: deterministic.product, snapshot });
  if (recipeSignals.handle.shouldRecommend && hasMeaningfulDraftFieldChange({
    currentValue: deterministic.product?.handle || snapshot.handle,
    draftValue: suggestedProductHandle,
  })) {
    recommendations.push({
      id: "improve-url-handle",
      label: "Improve URL handle",
      type: "URL handle",
      effort: "Low",
      status: "Draft",
      payload: {
        field: "handle",
        draftHandle: suggestedProductHandle,
        currentValue: deterministic.product?.handle || snapshot.handle,
        redirectNewHandle: true,
        issue: "seo_content",
        trigger: recipeSignals.handle.reason,
      },
    });
  }

  if (recipeSignals.specs.shouldRecommend) {
    const specsBlock = buildSpecsDetailsBlock({
      product: deterministic.product,
      contentIssues,
      mainIssue,
      deterministic,
      aiSpecsBlock,
    });
    const specsBlockPlan = buildDescriptionCoveragePlan({
      currentDescription: currentDescriptionText,
      proposedText: specsBlock,
      operation: "append",
    });
    if (specsBlockPlan.shouldRecommend) {
      recommendations.push({
        id: "add-specs-details-block",
        label: "Add specs/details block",
        type: "PDP copy",
        effort: "Low",
        status: "Draft",
        payload: {
          draftText: specsBlockPlan.draftText,
          issue: "product_content",
          currentDescriptionText,
          contentIssues: contentIssues.map((issue) => ({
            label: issue.label,
            evidence: issue.evidence,
            severity: issue.severity,
            code: issue.code,
          })),
          operation: specsBlockPlan.operation,
          placement: specsBlockPlan.operation,
          contentCoverage: specsBlockPlan.coverage,
          changeStrategy: "add-specs-block",
          causeKey: getRecommendationCauseKey({ issue: "specs_block", text: specsBlockPlan.draftText, deterministic }),
          trigger: recipeSignals.specs.reason,
        },
      });
    }
  }

  if (recipeSignals.media.shouldRecommend) {
    const mediaUpdates = buildMediaAltTextUpdates({
      deterministic,
      snapshot,
      mediaGuidance: copy.media_guidance,
      suggestedTitle: copy.product_title,
    });
    const mediaGuidance = copy.media_guidance || buildMediaGuidance(deterministic);
    recommendations.push({
      id: "improve-product-media",
      label: mediaUpdates.length ? "Add / update image alt text" : "Improve product media",
      type: mediaUpdates.length ? "Media alt text" : "Media guidance",
      effort: mediaUpdates.length ? "Low" : "Medium",
      status: mediaUpdates.length ? "Draft" : "Ready",
      payload: {
        draftText: mediaUpdates[0]?.suggestedAltText || "",
        mediaGuidance,
        mediaUpdates,
        imageBrief: buildRecommendedImageBrief(deterministic),
        mediaCount: deterministic.metrics.mediaCount || 0,
        mediaWithoutAltCount: deterministic.metrics.mediaWithoutAltCount || 0,
        issue: mainIssue,
        trigger: recipeSignals.media.reason,
        causeKey: getRecommendationCauseKey({ issue: "media", text: recipeSignals.media.reason, deterministic }),
      },
    });
  }

  if (recipeSignals.mediaOrder.shouldRecommend) {
    recommendations.push({
      id: "reorder-product-media",
      label: "Reorder product media",
      type: "Media order",
      effort: "Medium",
      status: "Manual approval required",
      payload: {
        mediaGuidance: buildMediaGuidance(deterministic),
        imageBrief: buildRecommendedImageBrief(deterministic),
        mediaCount: deterministic.metrics.mediaCount || 0,
        issue: mainIssue,
        trigger: recipeSignals.mediaOrder.reason,
      },
    });
  }

  if (recipeSignals.contextualMedia.shouldRecommend) {
    recommendations.push({
      id: "add-contextual-media-recommendation",
      label: "Add contextual media recommendation",
      type: "Media guidance",
      effort: "Medium",
      status: "Ready",
      payload: {
        mediaGuidance: buildMediaGuidance(deterministic),
        imageBrief: buildRecommendedImageBrief(deterministic),
        mediaCount: deterministic.metrics.mediaCount || 0,
        issue: mainIssue,
        trigger: recipeSignals.contextualMedia.reason,
      },
    });
  }

  if (topReasons.length && deterministic.metrics.returnUnits >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) {
    reviewSections.push({
      key: "returns",
      label: "Return reasons",
      source: "Shopify returns",
      count: deterministic.metrics.returnUnits,
      items: topReasons.map((reason) => ({ label: reason, evidence: `${deterministic.metrics.returnUnits} returned unit${deterministic.metrics.returnUnits === 1 ? "" : "s"}` })),
    });
  }

  if (affectedVariants.length && (deterministic.metrics.returnUnits + deterministic.metrics.refundUnits) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) {
    reviewSections.push({
      key: "variants",
      label: "Affected variants",
      source: "Shopify variants",
      count: affectedVariants.length,
      items: affectedVariants.map((variant) => ({ label: variant, evidence: "Variant concentration found in stored return/refund signals" })),
    });
  }

  if (!lowRiskMonitoringOnly && deterministic.metrics.negativeReviewCount >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) {
    const reviewLabel = getReviewEvidenceLabel(deterministic.metrics);
    reviewSections.push({
      key: "reviews",
      label: `Negative ${reviewLabel.toLowerCase()}`,
      source: reviewLabel,
      count: deterministic.metrics.negativeReviewCount,
      items: [{
        label: `${deterministic.metrics.negativeReviewCount} negative review${deterministic.metrics.negativeReviewCount === 1 ? "" : "s"}`,
        evidence: `${deterministic.metrics.avgRating || 0} average rating`,
      }],
    });
  }

  if (deterministic.metrics.refundInsights?.shouldSurface || (deterministic.metrics.refundUnits >= 3 && deterministic.metrics.refundAmount > 0)) {
    const refundReasons = deterministic.metrics.refundInsights?.topReasons?.length
      ? deterministic.metrics.refundInsights.topReasons
      : deterministic.metrics.topRefundReasonDetails || [];
    reviewSections.push({
      key: "refunds",
      label: "Refund impact",
      source: "Shopify refunds",
      count: deterministic.metrics.refundUnits,
      items: [
        {
          label: `${deterministic.metrics.refundUnits} refunded unit${deterministic.metrics.refundUnits === 1 ? "" : "s"}`,
          evidence: `${deterministic.metrics.refundRate || 0}% refund rate, ${deterministic.metrics.refundAmount || 0} refund amount`,
        },
        ...refundReasons.slice(0, 3).map((reason) => ({
          label: `Refund context: ${reason.label}`,
          evidence: `${reason.count} refund signal${reason.count === 1 ? "" : "s"}`,
        })),
      ],
    });
  }

  if (recipeSignals.sourceMismatch.shouldRecommend) {
    recommendations.push({
      id: "fix-source-review-mismatch",
      label: "Fix source/review mismatch",
      type: "Source integrity",
      effort: "Medium",
      status: "Manual verification required",
      payload: {
        mismatchSignals: recipeSignals.sourceMismatch.signals || [],
        reviewSections,
        issue: "source_integrity",
        trigger: recipeSignals.sourceMismatch.reason,
        whyThisAction: "ProductPulse is warning that some evidence may belong to another product, SKU, feed row or variant. Confirm the source mapping before changing this Shopify product.",
        expectedAction: "Check the raw review, return, refund or imported row against the product title, handle, SKU and variant. Fix the source mapping or dismiss the action if the evidence is correctly attached.",
        reviewChecklist: [
          "Compare the cited evidence text with this product title, handle, SKU and variant list.",
          "Look for references to another product, collection, bundle, feed item or variant.",
          "Fix the source import or mapping before applying PDP, QA or operational changes.",
        ],
        nextSteps: [
          "Open the supporting evidence for the suspicious source",
          "Correct the source mapping or import if the evidence belongs elsewhere",
          "Rerun Product Diagnosis after the source is corrected",
          "Dismiss only if the evidence is correctly attached to this product",
        ],
      },
    });
  }

  if (recipeSignals.variants.shouldRecommend) {
    const variantUpdates = buildVariantOptionUpdateSuggestions({
      product: deterministic.product,
      affectedVariants,
      variantDetails: deterministic.metrics.affectedVariantDetails || [],
    });
    recommendations.push({
      id: "correct-variant-options",
      label: "Fix variant names/options",
      type: "Variant options",
      effort: "Medium",
      status: "Ready",
      payload: {
        affectedVariants,
        variantCount: deterministic.metrics.variantCount || 0,
        variantDetails: deterministic.metrics.affectedVariantDetails || [],
        optionNames: deterministic.metrics.optionNames || [],
        variantUpdates,
        issue: mainIssue,
        trigger: recipeSignals.variants.reason,
      },
    });
  }

  if (recipeSignals.pricing.shouldRecommend) {
    recommendations.push({
      id: "review-product-pricing",
      label: "Adjust price / compare-at price",
      type: "Commercial review",
      effort: "Medium",
      status: "Ready",
      payload: {
        variants: (deterministic.metrics.variants || []).map((variant) => ({
          id: variant.id,
          title: variant.title,
          price: variant.price,
          compareAtPrice: variant.compareAtPrice,
        })),
        refundRate: deterministic.metrics.refundRate,
        returnRate: deterministic.metrics.returnRate,
        marginAtRisk: deterministic.metrics.marginAtRisk,
        issue: mainIssue,
        trigger: recipeSignals.pricing.reason,
        whyThisAction: "ProductPulse is not asking to change price automatically. It is flagging that customer language, returns, refunds or margin exposure may point to a value-perception issue that needs commercial review.",
        expectedAction: "Compare current price, compare-at price, refund pressure, return reasons and margin at risk. Change pricing only if the evidence shows shoppers are reacting to value, not a product defect or fulfillment issue.",
        reviewChecklist: [
          "Confirm the customer evidence explicitly mentions value, price, expensive, not worth it, or quality for the price.",
          "Compare refund and return pressure against margin exposure before changing any variant price.",
          "Check whether a PDP expectation fix or QA follow-up is safer than changing price.",
        ],
        nextSteps: [
          "Open the pricing and refund evidence",
          "Compare affected variants and current prices",
          "Decide whether to change price, improve PDP expectations, or dismiss",
          "Mark reviewed after the commercial decision is clear",
        ],
      },
    });
  }

  if (recipeSignals.classification.shouldRecommend) {
    const classificationDraft = buildProductClassificationDraft({
      product: deterministic.product,
      mainIssue,
      existingProductTypes: deterministic.metrics?.catalogProductTypes,
      categorySuggestions: deterministic.metrics?.taxonomyCategorySuggestions,
    });
    recommendations.push({
      id: "update-product-classification",
      label: "Update product classification",
      type: "Product classification",
      effort: "Medium",
      status: classificationDraft.draftVendor || classificationDraft.draftProductType ? "Draft" : "Manual approval required",
      payload: {
        field: "classification",
        currentVendor: deterministic.product?.vendor || "",
        currentProductType: deterministic.product?.productType || "",
        ...classificationDraft,
        issue: "product_content",
        trigger: recipeSignals.classification.reason,
      },
    });
  }

  if (recipeSignals.structuredMetafields.shouldRecommend && !isDisabledProductAction("add-structured-metafields")) {
    recommendations.push({
      id: "add-structured-metafields",
      label: "Add structured metafields",
      type: "Product metafield",
      effort: "Medium",
      status: "Draft",
      payload: {
        metafields: buildStructuredMetafieldRecommendations({ deterministic, mainIssue }),
        issue: mainIssue,
        trigger: recipeSignals.structuredMetafields.reason,
      },
    });
  }

  if (recipeSignals.template.shouldRecommend && !isDisabledProductAction("switch-product-template")) {
    recommendations.push({
      id: "switch-product-template",
      label: "Switch product template",
      type: "Product template",
      effort: "Medium",
      status: "Manual approval required",
      payload: {
        field: "templateSuffix",
        templateSuffix: "productpulse-guidance",
        currentTemplateSuffix: deterministic.product?.templateSuffix || "default",
        issue: mainIssue,
        trigger: recipeSignals.template.reason,
      },
    });
  }

  if (recipeSignals.collection.shouldRecommend) {
    const collectionName = getReviewCollectionName(deterministic);
    recommendations.push({
      id: "move-to-review-collection",
      label: "Review collection workflow",
      type: "Merchandising review",
      effort: "Low",
      status: "Manual review required",
      payload: {
        collectionName,
        suggestedTag: "needs-merchandising-review",
        issue: mainIssue,
        trigger: recipeSignals.collection.reason,
        whyThisAction: `ProductPulse is not asking you to create a public customer review collection. It is suggesting an internal merchandising or QA review workflow because ${recipeSignals.collection.reason.toLowerCase()} Grouping this product in "${collectionName}" or tagging it keeps the follow-up visible without changing shopper-facing copy.`,
        expectedAction: `Check whether your team uses an internal Shopify collection, saved view or tag like "${collectionName}" for products that need review. If it exists, add the product there manually or use the internal tag option. If the store does not use that workflow, mark this action reviewed or dismiss it after deciding who owns the follow-up.`,
        reviewChecklist: [
          "Confirm the product has enough risk, return, refund, review or content evidence to need a tracked internal follow-up.",
          `Check whether "${collectionName}" is an internal workflow collection, saved view or tag and not a customer-facing merchandising collection.`,
          "Decide who owns the next step: merchandising copy, QA/supplier review, operations follow-up or no action.",
          "Do not move the product into a public collection unless your store intentionally uses that collection for internal review only.",
        ],
        nextSteps: [
          "Open the strongest product evidence and confirm the workflow reason",
          `Add the product to "${collectionName}" or apply the internal review tag if your team uses that workflow`,
          "Assign the follow-up to merchandising, QA or operations",
          "Mark reviewed or dismiss if no internal routing is needed",
        ],
      },
    });
  }

  if (supportNote && !lowRiskMonitoringOnly && (hasActionableMainIssue || contentIssues.length > 0)) {
    recommendations.push({
      id: "copy-support-note",
      label: "Create internal note",
      type: "Internal note",
      effort: "Low",
      status: "Ready",
      payload: { note: supportNote },
    });
  }

  const tags = getRecommendedRiskTags({ mainIssue, deterministic });
  if (tags.length && deterministic.metrics.signalCount >= 2 && !lowRiskMonitoringOnly && !subjectiveExpectationOnly) {
    recommendations.push({
      id: "apply-risk-tags",
      label: "Add internal risk tags",
      type: "Product tag",
      effort: "Low",
      status: "Ready",
      payload: { tags, productGid: snapshot.productGid, issue: mainIssue },
    });
  }

  const workflowTags = getRecommendedWorkflowTags({ mainIssue, deterministic });
  if (workflowTags.length && deterministic.metrics.signalCount >= 2 && !lowRiskMonitoringOnly && !relationshipExpectationMode && !subjectiveExpectationOnly && !focusedRemediationMode) {
    recommendations.push({
      id: "add-workflow-tags",
      label: "Add workflow tags",
      type: "Product tag",
      effort: "Low",
      status: "Ready",
      payload: { tags: workflowTags, productGid: snapshot.productGid, issue: mainIssue },
    });
  }

  if (recipeSignals.missingSource.shouldRecommend) {
    const missingSources = recipeSignals.missingSource.sources || [];
    const missingSourceText = missingSources.join(", ") || "the missing evidence source";
    const missingSourceVerb = missingSources.length === 1 ? "is" : "are";
    const includeMonitoringContext = Boolean(recipeSignals.monitoringCoverage.shouldRecommend);
    recommendations.push({
      id: "connect-missing-source",
      label: "Review source coverage in Connect",
      type: "Evidence coverage",
      effort: "Medium",
      status: "Manual setup required",
      payload: {
        missingSources,
        productMomentumScore: includeMonitoringContext ? deterministic.metrics.productMomentumScore : undefined,
        issue: "coverage",
        trigger: includeMonitoringContext
          ? `${recipeSignals.missingSource.reason} ${recipeSignals.monitoringCoverage.reason}`
          : recipeSignals.missingSource.reason,
        whyThisAction: includeMonitoringContext
          ? `ProductPulse has enough product signal or commercial activity to care about this product, and Sales Momentum is high enough that missing coverage from ${missingSourceText} can hide expensive changes until they are already visible in returns, refunds or reviews.`
          : `ProductPulse has enough product signal or commercial activity to care about this product, but diagnosis confidence is limited because ${missingSourceText} ${missingSourceVerb} not connected or imported.`,
        expectedAction: `Open Connect and confirm whether ${missingSourceText} should exist for this shop. If it should, connect the provider or upload/import the source, then rerun Product Diagnosis for this product.${includeMonitoringContext ? " Keep this product on Watchlist if stronger monitoring coverage is still needed." : ""}`,
        reviewChecklist: [
          `Confirm whether this store actually uses ${missingSourceText}.`,
          "If the source exists, connect the provider or upload the latest file in Connect.",
          ...(includeMonitoringContext ? ["Because Sales Momentum is high, confirm coverage before relying on this diagnosis as complete monitoring."] : []),
          "If the source does not exist for this store, dismiss this action so it does not block product decisions.",
        ],
        nextSteps: [
          "Open Connect and inspect the missing source",
          "Connect or import the source when it exists for this shop",
          "Rerun Product Diagnosis so the product uses the new evidence",
          ...(includeMonitoringContext ? ["Keep the product on Watchlist if periodic monitoring still matters"] : []),
          "Dismiss if the shop does not use that source",
        ],
        destinationHref: "/app/connect",
        destinationLabel: "Open Connect",
      },
    });
  }

  if (recipeSignals.baselineScan.shouldRecommend) {
    recommendations.push({
      id: "create-baseline-scan",
      label: "Create baseline scan",
      type: "Baseline scan",
      effort: "Low",
      status: "Ready",
      payload: {
        productMomentumScore: deterministic.metrics.productMomentumScore,
        issue: "baseline",
        trigger: recipeSignals.baselineScan.reason,
      },
    });
  }

  if (recipeSignals.watchlist.shouldRecommend) {
    recommendations.push({
      id: "add-to-watchlist",
      label: "Add to Watchlist",
      type: "Watchlist",
      effort: "Low",
      status: "Ready",
      payload: {
        productMomentumScore: deterministic.metrics.productMomentumScore,
        productRiskScore: deterministic.riskScore,
        issue: "monitoring",
        trigger: recipeSignals.watchlist.reason,
      },
    });
  }

  if (recipeSignals.fullDiagnosis.shouldRecommend) {
    recommendations.push({
      id: "run-full-diagnosis",
      label: "Run product diagnosis",
      type: "Diagnosis",
      effort: "Medium",
      status: "Ready",
      payload: {
        productMomentumScore: deterministic.metrics.productMomentumScore,
        issue: "diagnosis",
        trigger: recipeSignals.fullDiagnosis.reason,
      },
    });
  }

  if (recipeSignals.relationshipCompatibility.shouldRecommend) {
    recommendations.push({
      id: "review-product-pairing-expectations",
      label: "Review pairing expectations",
      type: "Compatibility review",
      effort: "Medium",
      status: "Ready",
      payload: buildProductRelationshipRecommendationPayload(recipeSignals.relationshipCompatibility, {
        issue: "product_relationship",
        trigger: recipeSignals.relationshipCompatibility.reason,
        recommendationKind: "compatibility_warning",
      }),
    });
  }

  if (recipeSignals.relationshipBundle.shouldRecommend) {
    recommendations.push({
      id: "test-product-bundle",
      label: "Test bundle / frequently bought together",
      type: "Bundle opportunity",
      effort: "Medium",
      status: "Ready",
      payload: buildProductRelationshipRecommendationPayload(recipeSignals.relationshipBundle, {
        issue: "product_relationship",
        trigger: recipeSignals.relationshipBundle.reason,
        recommendationKind: "bundle_opportunity",
      }),
    });
  }

  if (recipeSignals.relationshipCrossSell.shouldRecommend) {
    recommendations.push({
      id: "create-post-purchase-cross-sell",
      label: "Create post-purchase cross-sell",
      type: "Cross-sell",
      effort: "Medium",
      status: "Ready",
      payload: buildProductRelationshipRecommendationPayload(recipeSignals.relationshipCrossSell, {
        issue: "product_relationship",
        trigger: recipeSignals.relationshipCrossSell.reason,
        recommendationKind: "cross_sell_opportunity",
      }),
    });
  }

  if (recipeSignals.relationshipJourney.shouldRecommend) {
    recommendations.push({
      id: "position-as-upgrade-path",
      label: "Position as upgrade / next step",
      type: "Journey insight",
      effort: "Medium",
      status: "Ready",
      payload: buildProductRelationshipRecommendationPayload(recipeSignals.relationshipJourney, {
        issue: "product_relationship",
        trigger: recipeSignals.relationshipJourney.reason,
        recommendationKind: "journey_insight",
      }),
    });
  }

  if (recipeSignals.relationshipCollection.shouldRecommend) {
    const suggestion = recipeSignals.relationshipCollection.suggestion;
    recommendations.push({
      id: "add-to-related-product-collection",
      label: `Add to ${suggestion.collectionName}`,
      type: "Collection merchandising",
      effort: "Low",
      status: "Ready",
      payload: buildProductRelationshipCollectionPayload(recipeSignals.relationshipCollection, {
        issue: "product_relationship",
        trigger: recipeSignals.relationshipCollection.reason,
        recommendationKind: "collection_placement",
      }),
    });
  }

  if (recipeSignals.retentionRepurchaseCampaign.shouldRecommend) {
    recommendations.push({
      id: "create-repurchase-campaign",
      label: "Create repurchase campaign",
      type: "Retention campaign",
      effort: "Medium",
      status: "Ready",
      payload: buildProductRetentionRecommendationPayload(recipeSignals.retentionRepurchaseCampaign, {
        issue: "product_retention",
        trigger: recipeSignals.retentionRepurchaseCampaign.reason,
        recommendationKind: "repurchase_campaign",
      }),
    });
  }

  if (recipeSignals.retentionCrossSellCampaign.shouldRecommend) {
    recommendations.push({
      id: "create-retention-cross-sell-campaign",
      label: "Create lifecycle cross-sell campaign",
      type: "Lifecycle campaign",
      effort: "Medium",
      status: "Ready",
      payload: buildProductRetentionRecommendationPayload(recipeSignals.retentionCrossSellCampaign, {
        issue: "product_retention",
        trigger: recipeSignals.retentionCrossSellCampaign.reason,
        recommendationKind: "retention_cross_sell_campaign",
      }),
    });
  }

  if (recipeSignals.retentionBundleOffer.shouldRecommend) {
    recommendations.push({
      id: "test-retention-bundle-offer",
      label: "Test retention bundle offer",
      type: "Bundle campaign",
      effort: "Medium",
      status: "Ready",
      payload: buildProductRetentionRecommendationPayload(recipeSignals.retentionBundleOffer, {
        issue: "product_retention",
        trigger: recipeSignals.retentionBundleOffer.reason,
        recommendationKind: "retention_bundle_offer",
      }),
    });
  }

  if (recipeSignals.retentionDropReview.shouldRecommend) {
    recommendations.push({
      id: "review-retention-drop",
      label: "Review retention drop",
      type: "Retention review",
      effort: "Medium",
      status: "Ready",
      payload: buildProductRetentionRecommendationPayload(recipeSignals.retentionDropReview, {
        issue: "product_retention",
        trigger: recipeSignals.retentionDropReview.reason,
        recommendationKind: "retention_drop_review",
      }),
    });
  }

  if (recipeSignals.qa.shouldRecommend) {
    const qaReviewBrief = copy.qa_note || buildQaReviewNote({ snapshot, deterministic, issueLabel });
    recommendations.push({
      id: "recommend-qa-review",
      label: "Supplier / QA review",
      type: "Operational QA",
      effort: "Medium",
      status: "Ready",
      payload: {
        qaNote: qaReviewBrief,
        issue: mainIssue,
        refundInsights: deterministic.metrics.refundInsights,
        topReturnReasons: deterministic.metrics.topReturnReasons,
        trigger: recipeSignals.qa.reason,
        whyThisAction: `ProductPulse is suggesting Supplier / QA review because ${recipeSignals.qa.reason.toLowerCase()} This is not a Shopify content change; it is an operational check before continuing to sell, promote, or rewrite around the issue.`,
        expectedAction: "Review the strongest return, refund, review and product-quality evidence with the owner who can inspect the item, supplier batch, packaging, sizing, durability or fulfillment path. Decide whether the product needs QA escalation, supplier follow-up, PDP expectation copy, variant action, or dismissal.",
        reviewChecklist: [
          "Confirm whether the evidence describes a physical product, supplier, durability, sizing, packaging, safety or fulfillment issue.",
          "Check if the problem is concentrated in a SKU, variant, batch, vendor, recent order window or repeat customer complaint.",
          "Use the QA note as the internal summary, but verify the raw evidence before escalating.",
          "Avoid changing PDP copy alone if the evidence points to a real defect or supplier problem.",
        ],
        nextSteps: [
          "Open the strongest returns, refunds and review evidence",
          "Send the QA note and examples to the responsible team if confirmed",
          "Apply a PDP or variant fix only if the evidence shows expectation mismatch",
          "Dismiss if the evidence is weak, unrelated or already resolved",
        ],
      },
    });
  }

  if (recipeSignals.inventory.shouldRecommend) {
    recommendations.push({
      id: "limit-variant-inventory",
      label: "Pause affected variant / reduce availability",
      type: "Inventory hold",
      effort: "High",
      status: "Manual approval required",
      payload: {
        affectedVariants,
        variants: deterministic.metrics.variants || [],
        issue: mainIssue,
        trigger: recipeSignals.inventory.reason,
        whyThisAction: "ProductPulse is suggesting an inventory review because the issue appears concentrated enough that continuing to sell every affected unit may create avoidable returns, refunds or support load.",
        expectedAction: "Confirm which variant, SKU or inventory group is affected, then decide whether to reduce availability, pause only that variant, escalate QA, or dismiss the action if the evidence is not concentrated.",
        reviewChecklist: [
          "Confirm the affected SKU or variant exists and matches the diagnosis evidence.",
          "Check whether returns, refunds or reviews are concentrated enough to justify an inventory hold.",
          "Avoid pausing unaffected variants when the issue is variant-specific.",
        ],
        nextSteps: [
          "Open the affected variant evidence",
          "Confirm inventory scope with Shopify variant data",
          "Pause or reduce availability only for confirmed affected units",
          "Mark reviewed or dismiss after the inventory decision",
        ],
      },
    });
  }

  if (recipeSignals.status.shouldRecommend) {
    recommendations.push({
      id: "set-product-draft",
      label: "Change product status",
      type: "High-risk action",
      effort: "High",
      status: "Manual approval required",
      payload: {
        field: "status",
        productStatus: "DRAFT",
        currentStatus: deterministic.product?.status || "Unknown",
        issue: mainIssue,
        trigger: recipeSignals.status.reason,
      },
    });
  }

  return prioritizeRecommendationActions(
    deduplicateRecommendationActions(uniqueBy(filterDisabledProductActions(recommendations), (item) => item.id))
      .filter(hasMeaningfulRecommendedActionChange),
    { deterministic, mainIssue, recipeSignals },
  )
    .filter((item) => shouldKeepRecommendationAfterProductEvolution(item, deterministic.metrics?.productEvolution))
    .map((item) => attachProductEvolutionContextToRecommendation(item, deterministic.metrics?.productEvolution))
    .map((item) => attachAiActionRationale(item, actionRationales))
    .map((item, index) => decorateRecommendationRecipe(item, { deterministic, mainIssue, index }));
}

function shouldKeepRecommendationAfterProductEvolution(action = {}, productEvolution = null) {
  return getProductEvolutionRecommendationDecision(action, productEvolution).keep;
}

function attachProductEvolutionContextToRecommendation(action = {}, productEvolution = null) {
  const decision = getProductEvolutionRecommendationDecision(action, productEvolution);
  const matchedAction = decision.matchedLifecycle || getMatchingProductEvolutionHandledAction(action, productEvolution);
  if (!productEvolution?.hasPreviousDiagnosis && !matchedAction) return action;
  const status = normalizeProductEvolutionActionStatus(matchedAction?.status || matchedAction?.actionStatus);
  const context = matchedAction ? {
    previousActionId: matchedAction.actionId || null,
    previousActionLabel: matchedAction.label || null,
    previousActionStatus: matchedAction.actionStatus || status,
    previousActionHandledAt: matchedAction.handledAt || matchedAction.appliedAt || matchedAction.createdAt || null,
    transitionKind: productEvolution?.transitionKind || null,
    lifecycleState: decision.lifecycleState,
    lifecycleLabel: decision.lifecycleLabel,
    recommendedTreatment: decision.recommendedTreatment,
    postActionEvidence: productEvolution?.postActionEvidence?.summary || "",
  } : null;
  return {
    ...action,
    payload: {
      ...(action.payload || {}),
      lifecycleState: decision.lifecycleState,
      lifecycleLabel: decision.lifecycleLabel,
      recommendedTreatment: decision.recommendedTreatment,
      productEvolutionContext: context || undefined,
      ...((matchedAction || action.payload?.whyThisAction) ? {
        whyThisAction: action.payload?.whyThisAction || buildProductEvolutionFollowUpRationale(action, matchedAction, productEvolution, decision),
      } : {}),
    },
  };
}

function getProductEvolutionRecommendationDecision(action = {}, productEvolution = null) {
  if (!productEvolution || typeof productEvolution !== "object") {
    return {
      keep: true,
      lifecycleState: "new",
      lifecycleLabel: getProductEvolutionLifecycleLabel("new"),
      recommendedTreatment: "new_or_unhandled",
      matchedLifecycle: null,
    };
  }
  const matchedLifecycle = getMatchingProductEvolutionLifecycleEntry(action, productEvolution);
  if (!matchedLifecycle) {
    return {
      keep: true,
      lifecycleState: "new",
      lifecycleLabel: getProductEvolutionLifecycleLabel("new"),
      recommendedTreatment: "new_or_unhandled",
      matchedLifecycle: null,
    };
  }
  const lifecycleState = matchedLifecycle.lifecycleState || "new";
  const monitoringAction = isProductEvolutionMonitoringRecommendation(action);
  let keep = true;
  let recommendedTreatment = "frame_as_follow_up";

  if (lifecycleState === "pending") {
    keep = true;
    recommendedTreatment = "carry_forward_pending";
  } else if (lifecycleState === "reopened/persistent") {
    keep = true;
    recommendedTreatment = "escalate_persistent_issue";
  } else if (lifecycleState === "monitoring") {
    keep = monitoringAction;
    recommendedTreatment = monitoringAction ? "monitor_after_handled_action" : "suppress_repeat_fix_monitoring";
  } else if (lifecycleState === "applied" || lifecycleState === "superseded") {
    keep = false;
    recommendedTreatment = lifecycleState === "superseded" ? "suppress_superseded_action" : "suppress_already_applied_action";
  }

  return {
    keep,
    lifecycleState,
    lifecycleLabel: getProductEvolutionLifecycleLabel(lifecycleState),
    recommendedTreatment,
    matchedLifecycle,
  };
}

function getMatchingProductEvolutionLifecycleEntry(action = {}, productEvolution = null) {
  const lifecycle = Array.isArray(productEvolution?.previousRecommendationLifecycle)
    ? productEvolution.previousRecommendationLifecycle
    : [];
  if (!lifecycle.length) return null;
  const actionKeys = buildProductEvolutionActionKeySet(action);
  if (!actionKeys.size) return null;
  return lifecycle.find((entry) => {
    const entryKeys = buildProductEvolutionActionKeySet({
      id: entry.actionId,
      actionId: entry.actionId,
      label: entry.label,
      actionAliases: entry.actionKeys,
    });
    return Array.from(actionKeys).some((key) => entryKeys.has(key));
  }) || null;
}

function isProductEvolutionMonitoringRecommendation(action = {}) {
  const text = normalizeRecommendationRationaleKey([
    action.id,
    action.actionId,
    action.label,
    action.type,
    action.payload?.issue,
  ].filter(Boolean).join(" "));
  return text.includes("watchlist") || text.includes("monitor");
}

function getMatchingProductEvolutionHandledAction(action = {}, productEvolution = null) {
  const handled = Array.isArray(productEvolution?.handledActionsSincePreviousDiagnosis)
    ? productEvolution.handledActionsSincePreviousDiagnosis
    : [];
  if (!handled.length) return null;
  const actionKeys = buildProductEvolutionActionKeySet(action);
  if (!actionKeys.size) return null;
  return handled.find((handledAction) => {
    const handledKeys = buildProductEvolutionActionKeySet(handledAction);
    return Array.from(actionKeys).some((key) => handledKeys.has(key));
  }) || null;
}

function buildProductEvolutionFollowUpRationale(action = {}, matchedAction = {}, productEvolution = {}, decision = {}) {
  const label = matchedAction?.label || action.label || "this action";
  const status = normalizeProductEvolutionActionStatus(matchedAction?.actionStatus || matchedAction?.status);
  if (decision.lifecycleState === "pending") {
    return `ProductPulse is carrying forward ${label} as pending context from the prior diagnosis, so the merchant can finish or review it before adding a similar new fix.`;
  }
  if (decision.lifecycleState === "reopened/persistent") {
    return `ProductPulse is treating ${label} as a persistent/reopened issue because it was already handled and new post-action evidence still supports the same problem. The next step should escalate or verify the prior fix rather than repeat the original action blindly.`;
  }
  if (productEvolution?.sourceSummary?.hasNewEvidence || decision.matchedLifecycle?.postActionEvidence?.hasPostActionEvidence) {
    const persistingIssues = decision.matchedLifecycle?.postActionEvidence?.issueChanges?.persisting || [];
    if (persistingIssues.length) {
      return `ProductPulse is treating ${label} as previous context because it was ${status} after the last diagnosis. Current post-action evidence still touches ${persistingIssues[0].label || "the same issue"}, so this should be read as follow-up context rather than a fresh baseline recommendation.`;
    }
    return `ProductPulse is treating ${label} as previous context because it was ${status} after the last diagnosis. Current post-action evidence changes the diagnosis context, but it does not show this same issue persisted, so this should not be repeated as the same baseline fix.`;
  }
  return `ProductPulse found that ${label} was already ${status} after the last diagnosis. This action should not be repeated as a new baseline recommendation unless new evidence appears or the merchant decides the prior handling was incomplete.`;
}

function getAiActionRationaleMap(ai = {}) {
  const entries = Array.isArray(ai.actionRationales?.action_rationales)
    ? ai.actionRationales.action_rationales
    : [];
  return new Map(entries
    .map((item) => [
      normalizeRecommendationRationaleKey(item?.action_id || item?.id || item?.actionId),
      normalizeRecommendationRationaleText(item?.rationale || item?.why_this_action || item?.why || ""),
    ])
    .filter(([key, value]) => key && value));
}

function getAiContentCoverageMap(ai = {}) {
  const entries = Array.isArray(ai.contentCoverageValidation?.coverage)
    ? ai.contentCoverageValidation.coverage
    : [];
  return new Map(entries
    .map((item) => {
      const id = normalizeAiContentCoverageId(item?.id || item?.candidate_id || item?.candidateId);
      if (!id) return null;
      return [id, {
        id,
        status: normalizeAiContentCoverageStatus(item?.status),
        confidence: normalizeAiContentCoverageConfidence(item?.confidence),
        recommendedApplication: normalizeAiContentCoverageApplication(item?.recommended_application || item?.recommendedApplication),
        remainingText: normalizeDraftParagraph(item?.remaining_text || item?.remainingText || ""),
        remainingQuestion: normalizeDraftParagraph(item?.remaining_question || item?.remainingQuestion || ""),
        remainingAnswer: normalizeDraftParagraph(item?.remaining_answer || item?.remainingAnswer || ""),
        matchedExistingText: normalizeDraftParagraph(item?.matched_existing_text || item?.matchedExistingText || ""),
        reason: normalizeDraftParagraph(item?.reason || ""),
      }];
    })
    .filter(Boolean));
}

function applyAiContentCoverageToText({ coverageMap, id, text = "" } = {}) {
  const original = normalizeDraftParagraph(text);
  if (!original) return "";
  const coverage = getAiContentCoverageEntry(coverageMap, id);
  if (!coverage || coverage.confidence === "low") return original;
  if (coverage.status === "already_covered") return "";
  if (coverage.status === "partially_covered") return coverage.remainingText || "";
  return original;
}

function applyAiContentCoverageToFaqItem(item = {}, coverageMap, id) {
  const coverage = getAiContentCoverageEntry(coverageMap, id);
  if (!coverage || coverage.confidence === "low") return item;
  if (coverage.status === "already_covered") return null;
  if (coverage.status !== "partially_covered") return item;
  if (coverage.recommendedApplication && coverage.recommendedApplication !== "faq") return null;
  const question = coverage.remainingQuestion || item.question;
  const answer = coverage.remainingAnswer || coverage.remainingText || "";
  if (!question || !answer) return null;
  return {
    ...item,
    question,
    answer,
    reason: item.reason || coverage.reason,
    aiContentCoverage: coverage,
  };
}

function getAiContentCoverageEntry(coverageMap, id) {
  if (!(coverageMap instanceof Map)) return null;
  return coverageMap.get(normalizeAiContentCoverageId(id)) || null;
}

function normalizeAiContentCoverageId(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeAiContentCoverageStatus(value = "") {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z_]+/g, "_");
  if (["already_covered", "covered", "duplicate"].includes(normalized)) return "already_covered";
  if (["partially_covered", "partial"].includes(normalized)) return "partially_covered";
  if (["not_covered", "missing", "new"].includes(normalized)) return "not_covered";
  return "unclear";
}

function normalizeAiContentCoverageConfidence(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.includes("high")) return "high";
  if (normalized.includes("medium") || normalized.includes("moderate")) return "medium";
  return "low";
}

function normalizeAiContentCoverageApplication(value = "") {
  const normalized = String(value || "").trim().toLowerCase().replace(/[^a-z]+/g, "_").replace(/^_+|_+$/g, "");
  if (["skip", "description_note", "faq", "description_addendum", "keep_original"].includes(normalized)) return normalized;
  return "";
}

function attachAiActionRationale(action = {}, rationaleMap = new Map()) {
  const key = normalizeRecommendationRationaleKey(action.id);
  const rationale = rationaleMap.get(key);
  if (!rationale) return action;
  const evolutionSuffix = buildProductEvolutionRationaleSuffix(action.payload?.productEvolutionContext);
  return {
    ...action,
    payload: {
      ...(action.payload || {}),
      whyThisAction: evolutionSuffix ? `${rationale} ${evolutionSuffix}` : rationale,
      rationaleSource: "ai_action_rationale",
    },
  };
}

function buildProductEvolutionRationaleSuffix(context = null) {
  if (!context?.previousActionLabel || !context.previousActionStatus) return "";
  if (context.lifecycleState === "reopened/persistent") {
    return `Previous context: ${context.previousActionLabel} was ${context.previousActionStatus}, and current post-action evidence suggests the issue is persistent/reopened, so this should be handled as an escalation rather than a first-time fix.`;
  }
  if (context.lifecycleState === "pending") {
    return `Previous context: ${context.previousActionLabel} is still pending, so this recommendation is carried forward rather than created as a new first-time action.`;
  }
  if (context.lifecycleState === "monitoring") {
    return `Previous context: ${context.previousActionLabel} was ${context.previousActionStatus}, and there is not enough new evidence yet to repeat the same fix.`;
  }
  return `Previous context: ${context.previousActionLabel} was ${context.previousActionStatus}${context.previousActionHandledAt ? ` at ${context.previousActionHandledAt}` : ""}, so this recommendation should be treated as a follow-up rather than a first-time baseline action.`;
}

function normalizeRecommendationRationaleKey(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeRecommendationRationaleText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 700);
}

function deduplicateRecommendationActions(actions = []) {
  return actions.reduce((kept, action) => {
    if (!isDescriptionRecommendation(action)) {
      kept.push(action);
      return kept;
    }

    const duplicateIndex = kept.findIndex((existing) => isDuplicateDescriptionRecommendation(existing, action));
    if (duplicateIndex < 0) {
      kept.push(action);
      return kept;
    }

    const existing = kept[duplicateIndex];
    const preferred = choosePreferredDescriptionRecommendation(existing, action);
    const skipped = preferred === existing ? action : existing;
    kept[duplicateIndex] = mergeRecommendationRelationship(preferred, skipped);
    return kept;
  }, []);
}

function isDescriptionRecommendation(action = {}) {
  const payload = action.payload || {};
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""}`.toLowerCase();
  if (normalized.includes("create-product-faq") || normalized.includes(" faq")) return false;
  return Boolean(payload.draftText && (
    normalized.includes("description")
    || normalized.includes("pdp")
    || normalized.includes("note")
    || normalized.includes("expectation")
    || normalized.includes("specs")
    || ["prepend", "append", "replace"].includes(payload.operation)
  ));
}

function isDuplicateDescriptionRecommendation(first = {}, second = {}) {
  if (!isDescriptionRecommendation(first) || !isDescriptionRecommendation(second)) return false;
  const firstCause = String(first.payload?.causeKey || "").trim();
  const secondCause = String(second.payload?.causeKey || "").trim();
  if (firstCause && secondCause && firstCause === secondCause) return true;
  return hasSubstantialOverlap(first.payload?.draftText || "", second.payload?.draftText || "");
}

function choosePreferredDescriptionRecommendation(first = {}, second = {}) {
  const score = (action) => {
    const normalized = `${action.id || ""} ${action.label || ""}`.toLowerCase();
    const operation = action.payload?.operation || action.payload?.placement || "";
    let total = 0;
    if (operation === "replace") total += 30;
    if (operation === "prepend") total += 22;
    if (operation === "append") total += 12;
    if (normalized.includes("expectation") || normalized.includes("fit-note") || normalized.includes("quality-note") || normalized.includes("subjective")) total += 8;
    if (normalized.includes("guidance")) total += 2;
    return total;
  };
  return score(second) > score(first) ? second : first;
}

function mergeRecommendationRelationship(preferred = {}, skipped = {}) {
  const payload = preferred.payload || {};
  return {
    ...preferred,
    payload: {
      ...payload,
      relatedActionIds: uniqueBy([...(payload.relatedActionIds || []), skipped.id].filter(Boolean), String),
      relatedActionLabels: uniqueBy([...(payload.relatedActionLabels || []), skipped.label].filter(Boolean), String),
    },
  };
}

function prioritizeRecommendationActions(actions = [], { deterministic = {}, mainIssue = "", recipeSignals = {} } = {}) {
  const sourceIntegrityMode = isSourceIntegrityDiagnosis(deterministic, recipeSignals.sourceMismatch?.signals);
  const refundOperationalMode = isRefundDrivenOperationalDiagnosis(deterministic);
  const monitoringOnlyMode = isLowRiskMonitoringOnlyDiagnosis(deterministic);
  const relationshipExpectationMode = isRelationshipExpectationMismatchDiagnosis(deterministic);
  return [...actions]
    .map((action, index) => ({
      action,
      index,
      score: getServerRecommendationPriorityScore(action, { sourceIntegrityMode, refundOperationalMode, monitoringOnlyMode, relationshipExpectationMode, mainIssue }),
    }))
    .sort((first, second) => second.score - first.score || first.index - second.index)
    .map((item) => item.action);
}

function getServerRecommendationPriorityScore(action = {}, { sourceIntegrityMode = false, refundOperationalMode = false, monitoringOnlyMode = false, relationshipExpectationMode = false, mainIssue = "" } = {}) {
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""}`.toLowerCase();
  const normalizedMainIssue = normalizeIssueCode(mainIssue);
  let score = 0;
  if (/description|pdp|expectation|faq|spec/.test(normalized)) score += 60;
  if (/source.*mismatch|source integrity/.test(normalized)) score += 55;
  if (/supplier|qa/.test(normalized)) score += 50;
  if (/compatibility review|pairing/.test(normalized)) score += 48;
  if (/bundle|cross-sell|journey|upgrade|product relationship/.test(normalized)) score += 28;
  if (/retention|lifecycle|repurchase|campaign/.test(normalized)) score += 26;
  if (/seo|meta|handle|media|image|alt text/.test(normalized)) score += 30;
  if (/tag|collection|workflow|internal|evidence/.test(normalized)) score -= 10;
  if (normalizedMainIssue === "color_expectation") {
    if (/media|image|alt text|contextual/.test(normalized)) score += 70;
    if (/expectation|faq|description|pdp/.test(normalized)) score += 20;
    if (/supplier|qa|variant|inventory|status/.test(normalized)) score -= 45;
  }
  if (sourceIntegrityMode) {
    if (/source.*mismatch|source integrity/.test(normalized)) score += 220;
    if (/description|pdp|expectation|faq|spec|variant|pricing|price|compare-at/.test(normalized)) score -= 120;
  }
  if (refundOperationalMode) {
    if (/supplier|qa/.test(normalized)) score += 120;
    if (/pricing|price|compare-at/.test(normalized)) score -= 80;
  }
  if (relationshipExpectationMode) {
    if (/description|pdp|quality-note|expectation/.test(normalized) && !/faq/.test(normalized)) score += 190;
    if (/compatibility review|pairing/.test(normalized)) score += 50;
    if (/cross-sell|journey|upgrade/.test(normalized)) score -= 45;
    if (/status|inventory|template|metafield|tag|collection|media|alt text/.test(normalized)) score -= 85;
  }
  if (monitoringOnlyMode) {
    if (/watchlist|baseline/.test(normalized)) score += 160;
    if (/description|pdp|expectation|faq|spec|supplier|qa|variant|pricing|price|compare-at|media|image|alt text|template/.test(normalized)) score -= 120;
    if (/seo|meta|handle|classification|metafield|tag|collection|workflow|internal|evidence/.test(normalized)) score -= 30;
  }
  return score;
}

function isLowRiskMonitoringOnlyDiagnosis(deterministic = {}) {
  const contentIssues = getActionableContentIssues(deterministic.metrics || {});
  const riskScore = Number(deterministic.riskScore || 0);
  return riskScore < 50
    && !hasMaterialCustomerProblemEvidence(deterministic)
    && !hasCriticalContentIssue(contentIssues);
}

function hasMaterialCustomerProblemEvidence(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  const textSentiment = metrics.textInsights?.sentiment || {};
  const negativeTextSignals = Number(textSentiment.negative || 0);
  const negativeTextRatio = Number(textSentiment.negativeRatio || 0);
  const negativeReviewCount = Number(metrics.negativeReviewCount || 0);
  const reviewCount = Number(metrics.reviewCount || 0);
  const negativeReviewRate = Number.isFinite(Number(metrics.negativeReviewRate))
    ? Number(metrics.negativeReviewRate)
    : reviewCount > 0 ? (negativeReviewCount / reviewCount) * 100 : 0;
  const materialNegativeReviewPressure = negativeReviewCount >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE
    && (
      negativeReviewCount >= 4
      || negativeReviewRate >= 20
      || (reviewCount > 0 && reviewCount <= 5 && negativeReviewRate >= 40)
    );
  return Number(metrics.returnUnits || 0) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE
    || Number(metrics.refundUnits || 0) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE
    || materialNegativeReviewPressure
    || (negativeTextSignals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE && negativeTextRatio >= 0.35);
}

function hasCriticalContentIssue(contentIssues = []) {
  return (Array.isArray(contentIssues) ? contentIssues : []).some((issue) => {
    const code = normalizeContentIssueCode(issue?.code);
    const severity = String(issue?.severity || "").toLowerCase();
    return severity === "high" || [
      "missing_description",
      "title_description_mismatch",
      "description_variant_mismatch",
      "wrong_product_description",
      "incoherent_description",
      "generic_title",
    ].includes(code);
  });
}

function getRecommendationRecipeSignals(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  const product = deterministic.product || {};
  const mainIssue = normalizeIssueCode(deterministic.mainIssue);
  const aiActionGuidance = getAiActionGuidance(deterministic);
  const contentIssues = getActionableContentIssues(metrics);
  const contentAdvisories = Array.isArray(metrics.contentAnalysis?.advisories) ? metrics.contentAnalysis.advisories : metrics.contentAdvisories || [];
  const hasCustomerEvidence = hasMaterialCustomerProblemEvidence(deterministic);
  const hasActionableEvidence = hasCustomerEvidence || contentIssues.length > 0;
  const lowRiskMonitoringOnly = isLowRiskMonitoringOnlyDiagnosis(deterministic);
  const variantCount = Number(metrics.variantCount || product.variants?.length || 0);
  const affectedVariantCount = Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants.length : 0;
  const hasVariantConcentration = hasAffectedVariantConcentration(metrics);
  const valueSignals = getValuePerceptionSignals(deterministic);
  const mediaIssue = Number(metrics.mediaWithoutAltCount || 0) > 0
    || Number(metrics.mediaCount || 0) === 0
    || mainIssue === "color_expectation"
    || contentAdvisories.some((item) => ["missing_media_context", "missing_media_alt_text"].includes(normalizeContentIssueCode(item.code)));
  const highRiskOperationalIssue = ["safety_concern", "quality_defect", "durability", "refund_impact"].includes(mainIssue);
  const aiSuppressesQa = shouldAiSuppressActionFamily(aiActionGuidance, "qa_review");
  const aiRecommendsQa = shouldAiRecommendQaReview(aiActionGuidance);
  const operationalQualityTextSignals = hasOperationalQualityTextSignals(deterministic);
  const refundInsights = metrics.refundInsights || {};
  const sourceMismatchSignals = getSourceMismatchSignals(deterministic);
  const sourceIntegrityMode = isSourceIntegrityDiagnosis(deterministic, sourceMismatchSignals);
  const purchaseContextSignals = getPurchaseContextRecommendationSignals(deterministic);
  const productRelationshipSignals = getProductRelationshipRecommendationSignals(deterministic);
  const productRetentionSignals = getProductRetentionRecommendationSignals(deterministic, { productRelationshipSignals });
  const relationshipExpectationMode = isRelationshipExpectationMismatchDiagnosis(deterministic, productRelationshipSignals);
  const subjectiveExpectationOnly = isSubjectiveExpectationOnlyDiagnosis(deterministic);
  const classificationDraft = buildProductClassificationDraft({
    product,
    mainIssue,
    existingProductTypes: metrics.catalogProductTypes,
    categorySuggestions: metrics.taxonomyCategorySuggestions,
  });
  const hasClassificationChange = hasProductClassificationDraftChange(classificationDraft, product);
  const focusedRemediationMode = isFocusedRemediationDiagnosis(deterministic, {
    aiActionGuidance,
    subjectiveExpectationOnly,
  });
  const suppressSubjectiveMerchandisingRelationshipActions = shouldSuppressMerchandisingRelationshipActions({
    subjectiveExpectationOnly,
    aiActionGuidance,
  });
  const merchandisingRelationshipSuppressionReason = suppressSubjectiveMerchandisingRelationshipActions
    ? "Suppressed because the active diagnosis is a subjective expectation issue, so merchandising relationship insights should stay in analytics instead of recommended actions."
    : focusedRemediationMode
      ? "Suppressed because the active diagnosis has a high-priority remediation path, so merchandising relationship insights should stay in analytics until the core product issue is reviewed."
      : "";
  const missingSourceSignals = getMissingSourceSignals(deterministic);
  const productMomentumScore = Number(metrics.productMomentumScore || metrics.productMomentum?.score || 0);
  const staleAnalysis = isStaleDiagnosis(metrics.lastAnalyzedAt || metrics.lastDiagnosisAt || metrics.latestDiagnosisAt);
  const hasVariantNamingProblem = Boolean(metrics.variantNamingAdvisory)
    || contentAdvisories.some((item) => normalizeContentIssueCode(item.code) === "unclear_variant_names");
  const variantConcentrationNeedsOptionFix = hasVariantConcentration
    && affectedVariantCount > 0
    && ["fit_sizing", "quality_defect", "durability", "safety_concern"].includes(mainIssue);
  const hasPricingContext = valueSignals.length >= 2;
  const stopSaleOperationalRisk = hasStopSaleOperationalRisk(deterministic);
  const hasMissingMediaContext = contentAdvisories.some((item) => normalizeContentIssueCode(item.code) === "missing_media_context");
  const missingAltOnlyMediaIssue = Number(metrics.mediaWithoutAltCount || 0) > 0
    && Number(metrics.mediaCount || 0) > 0
    && !hasMissingMediaContext
    && mainIssue !== "color_expectation";
  const shouldRecommendMedia = Boolean(!lowRiskMonitoringOnly && mediaIssue && (
    mainIssue === "color_expectation"
    || hasMissingMediaContext
    || Number(metrics.mediaCount || 0) === 0
    || (hasActionableEvidence && !relationshipExpectationMode && !missingAltOnlyMediaIssue)
    || (missingAltOnlyMediaIssue && stopSaleOperationalRisk)
  ));

  return {
    title: {
      shouldRecommend: Boolean(metrics.titleNeedsReview || contentIssues.some((item) => ["generic_title", "title_description_mismatch"].includes(normalizeContentIssueCode(item.code)))),
      reason: "The product title is generic, misleading, or clearly disconnected from the product content.",
    },
    seoTitle: {
      shouldRecommend: Boolean(!lowRiskMonitoringOnly && metrics.seoTitleNeedsReview && (hasActionableEvidence || productMomentumScore >= 70)),
      reason: "The SEO title is missing, duplicated, too long, too generic or weak for the product keywords.",
    },
    metaDescription: {
      shouldRecommend: Boolean(!lowRiskMonitoringOnly && metrics.metaDescriptionNeedsReview && (hasActionableEvidence || productMomentumScore >= 70)),
      reason: "The meta description is missing, too short, too long or unclear for search-result shoppers.",
    },
    handle: {
      shouldRecommend: Boolean(!lowRiskMonitoringOnly && metrics.handleNeedsReview && (hasActionableEvidence || productMomentumScore >= 70)),
      reason: "The product URL handle is confusing, inconsistent with the title, or missing useful product keywords.",
    },
    specs: {
      shouldRecommend: Boolean(!lowRiskMonitoringOnly && !sourceIntegrityMode && (
        metrics.specsBlockRecommended
        || purchaseContextSignals.productLevelPriority.shouldRecommend
        || purchaseContextSignals.basketContext.shouldRecommend
      ) && (hasActionableEvidence || contentIssues.length || ["fit_sizing", "compatibility", "color_expectation"].includes(mainIssue))),
      reason: purchaseContextSignals.basketContext.shouldRecommend
        ? purchaseContextSignals.basketContext.reason
        : purchaseContextSignals.productLevelPriority.shouldRecommend
          ? purchaseContextSignals.productLevelPriority.reason
          : "A compact specs/details block would clarify dimensions, compatibility, materials, care, included items or product limits.",
    },
    variants: {
      shouldRecommend: Boolean(!sourceIntegrityMode && variantCount > 1 && (
        variantConcentrationNeedsOptionFix
        || (hasVariantNamingProblem && !subjectiveExpectationOnly)
        || purchaseContextSignals.variantClarity.shouldRecommend
      ) && (hasCustomerEvidence || hasVariantNamingProblem)),
      reason: purchaseContextSignals.variantClarity.shouldRecommend
        ? purchaseContextSignals.variantClarity.reason
        : hasVariantConcentration && affectedVariantCount
        ? "Signals are concentrated in specific variants, SKUs or options."
        : "Variant names or option labels are unclear enough to review.",
    },
    pricing: {
      shouldRecommend: Boolean(!sourceIntegrityMode && hasPricingContext),
      reason: hasPricingContext
        ? `Customer language points to value or price perception: ${valueSignals.slice(0, 3).join(", ")}.`
        : "Price review requires explicit value or price perception evidence.",
    },
    status: {
      shouldRecommend: Boolean(hasActionableEvidence && stopSaleOperationalRisk && Number(deterministic.riskScore || 0) >= 75 && Number(deterministic.confidence || 0) >= 65),
      reason: mainIssue === "safety_concern"
        ? "Risk and confidence are high for a safety concern, so sales should pause while the team reviews the issue."
        : "Risk and confidence are high and the evidence points to an operational product defect, not only expectation or merchandising confusion.",
    },
    inventory: {
      shouldRecommend: Boolean(!sourceIntegrityMode && !subjectiveExpectationOnly && variantCount > 1 && hasVariantConcentration && affectedVariantCount > 0 && Number(metrics.returnUnits || 0) + Number(metrics.refundUnits || 0) >= 4 && Number(deterministic.riskScore || 0) >= 65),
      reason: "The problem appears concentrated enough to consider holding a specific affected variant.",
    },
    collection: {
      shouldRecommend: Boolean(hasActionableEvidence && Number(deterministic.riskScore || 0) >= 55 && !subjectiveExpectationOnly && (!relationshipExpectationMode || stopSaleOperationalRisk)),
      reason: "The product should be grouped for internal review or quality workflow tracking.",
    },
    media: {
      shouldRecommend: shouldRecommendMedia,
      reason: Number(metrics.mediaWithoutAltCount || 0) > 0
        ? `${metrics.mediaWithoutAltCount} product media item${Number(metrics.mediaWithoutAltCount) === 1 ? "" : "s"} need clearer alt text.`
        : "Customer expectations may depend on images, scale, color, material or visual context.",
    },
    mediaOrder: {
      shouldRecommend: Boolean(Number(metrics.mediaCount || 0) > 1 && (mainIssue === "color_expectation" || contentAdvisories.some((item) => normalizeContentIssueCode(item.code) === "missing_media_context"))),
      reason: "The current media sequence may not put the clearest context, scale, color or format image first.",
    },
    contextualMedia: {
      shouldRecommend: Boolean(!shouldRecommendMedia && !lowRiskMonitoringOnly && (Number(metrics.mediaCount || 0) === 0 || ["color_expectation", "subjective_negative_reaction"].includes(mainIssue)) && (hasActionableEvidence || mainIssue === "color_expectation")),
      reason: "Customers may need an additional contextual image showing scale, packaging, color, material or real use.",
    },
    classification: {
      shouldRecommend: Boolean(!lowRiskMonitoringOnly && metrics.classificationNeedsReview && hasClassificationChange && (hasActionableEvidence || productMomentumScore >= 70)),
      reason: classificationDraft.draftCategoryId
        ? "Shopify category is missing, and ProductPulse matched a standard Shopify taxonomy category for this product."
        : classificationDraft.draftProductType
        ? "Product type is missing or too generic, and ProductPulse matched a better existing Shopify product type for this store."
        : "Vendor, product type or category data is incomplete enough to weaken catalog workflows and reporting.",
    },
    structuredMetafields: {
      shouldRecommend: Boolean(!lowRiskMonitoringOnly && !relationshipExpectationMode && !subjectiveExpectationOnly && !focusedRemediationMode && hasActionableEvidence && (contentIssues.length || highRiskOperationalIssue || productMomentumScore >= 70)),
      reason: "Structured product metadata can preserve warnings, QA status, SEO notes or risk flags for themes and reporting.",
    },
    template: {
      shouldRecommend: Boolean(!lowRiskMonitoringOnly && !relationshipExpectationMode && !subjectiveExpectationOnly && metrics.templateNeedsReview && (metrics.faqNeed?.shouldRecommend || metrics.specsBlockRecommended || hasActionableEvidence)),
      reason: "The product may need a richer template to display FAQ, specs or warning content beyond plain description text.",
    },
    sourceMismatch: {
      shouldRecommend: Boolean(sourceIntegrityMode),
      reason: "Reviews, returns or text appear to reference another product, SKU, feed item or variant.",
      signals: sourceMismatchSignals,
    },
    missingSource: {
      shouldRecommend: Boolean(missingSourceSignals.length && (hasActionableEvidence || productMomentumScore >= 70)),
      reason: `Diagnosis coverage is limited by missing sources: ${missingSourceSignals.join(", ")}.`,
      sources: missingSourceSignals,
    },
    monitoringCoverage: {
      shouldRecommend: Boolean(productMomentumScore >= 70 && missingSourceSignals.length),
      reason: "This product has enough Sales Momentum to deserve stronger monitoring coverage before issues become expensive.",
    },
    baselineScan: {
      shouldRecommend: Boolean(productMomentumScore >= 75 && Number(deterministic.riskScore || 0) < 50 && !hasActionableEvidence),
      reason: "The product is commercially important but currently has limited problem evidence, so a baseline can help monitor future changes.",
    },
    watchlist: {
      shouldRecommend: Boolean(productMomentumScore >= 75 && Number(deterministic.riskScore || 0) < 70),
      reason: "Sales Momentum is high enough that this product should be watched periodically even if risk is not currently high.",
    },
    fullDiagnosis: {
      shouldRecommend: Boolean(productMomentumScore >= 70 && staleAnalysis),
      reason: "This product has enough momentum and the current diagnosis is old enough to justify a fresh product diagnosis.",
    },
    qa: {
      shouldRecommend: Boolean(!lowRiskMonitoringOnly && !sourceIntegrityMode && hasActionableEvidence && !aiSuppressesQa && (
        aiRecommendsQa
        || (!subjectiveExpectationOnly && (
          ["safety_concern", "durability", "refund_impact"].includes(mainIssue)
          || (highRiskOperationalIssue && operationalQualityTextSignals)
          || (refundInsights.shouldSurface && operationalQualityTextSignals)
          || purchaseContextSignals.bulkReview.shouldRecommend
        ))
      )),
      reason: purchaseContextSignals.bulkReview.shouldRecommend
        ? purchaseContextSignals.bulkReview.reason
        : aiRecommendsQa && aiActionGuidance?.qaReason
        ? aiActionGuidance.qaReason
        : refundInsights.shouldSurface
        ? "Refund pressure or refund notes point to an operational quality review."
        : "Returns, reviews or language suggest a possible supplier, QA, durability or safety concern.",
    },
    relationshipBundle: merchandisingRelationshipSuppressionReason
      ? suppressRecommendationSignal(productRelationshipSignals.bundleOpportunity, merchandisingRelationshipSuppressionReason)
      : productRetentionSignals.bundleOffer.shouldRecommend
        ? suppressRecommendationSignal(productRelationshipSignals.bundleOpportunity, "Covered by the retention bundle campaign action.")
      : productRelationshipSignals.bundleOpportunity,
    relationshipCrossSell: merchandisingRelationshipSuppressionReason
      ? suppressRecommendationSignal(productRelationshipSignals.crossSellOpportunity, merchandisingRelationshipSuppressionReason)
      : productRetentionSignals.crossSellCampaign.shouldRecommend
        ? suppressRecommendationSignal(productRelationshipSignals.crossSellOpportunity, "Covered by the retention lifecycle campaign action.")
      : productRelationshipSignals.crossSellOpportunity,
    relationshipCompatibility: productRelationshipSignals.compatibilityWarning,
    relationshipJourney: merchandisingRelationshipSuppressionReason
      ? suppressRecommendationSignal(productRelationshipSignals.journeyInsight, merchandisingRelationshipSuppressionReason)
      : productRelationshipSignals.journeyInsight,
    relationshipCollection: productRelationshipSignals.collectionPlacement,
    retentionRepurchaseCampaign: productRetentionSignals.repurchaseCampaign,
    retentionCrossSellCampaign: productRetentionSignals.crossSellCampaign,
    retentionBundleOffer: productRetentionSignals.bundleOffer,
    retentionDropReview: productRetentionSignals.dropReview,
  };
}

function shouldSuppressMerchandisingRelationshipActions({ subjectiveExpectationOnly = false, aiActionGuidance = null } = {}) {
  if (!subjectiveExpectationOnly) return false;
  return !["commercial_opportunity", "relationship_expectation"].includes(aiActionGuidance?.issueNature);
}

function isFocusedRemediationDiagnosis(deterministic = {}, { aiActionGuidance = null, subjectiveExpectationOnly = null } = {}) {
  const guidance = aiActionGuidance || getAiActionGuidance(deterministic);
  const subjectiveOnly = subjectiveExpectationOnly ?? isSubjectiveExpectationOnlyDiagnosis(deterministic);
  if (subjectiveOnly || isLowRiskMonitoringOnlyDiagnosis(deterministic)) return false;
  if (Number(deterministic.riskScore || 0) < 70) return false;
  if (!hasMaterialCustomerProblemEvidence(deterministic)) return false;
  if (["commercial_opportunity", "monitor_only"].includes(guidance?.issueNature)) return false;
  return shouldAiRecommendQaReview(guidance)
    || hasOperationalQualityTextSignals(deterministic)
    || isRefundDrivenOperationalDiagnosis(deterministic);
}

function suppressRecommendationSignal(signal = {}, suppressionReason = "Suppressed because this relationship insight should stay in analytics instead of recommended actions for the current diagnosis.") {
  return {
    ...(signal || {}),
    shouldRecommend: false,
    suppressionReason,
  };
}

function getAiActionGuidance(deterministic = {}) {
  const guidance = deterministic.metrics?.semanticClassification?.actionGuidance
    || deterministic.metrics?.semanticClassification?.action_guidance
    || deterministic.metrics?.aiActionGuidance
    || deterministic.aiActionGuidance
    || null;
  if (!guidance || typeof guidance !== "object") return null;
  return normalizeStoredAiActionGuidance(guidance);
}

function normalizeStoredAiActionGuidance(guidance = {}) {
  const issueNature = normalizeAiActionGuidanceEnum(guidance.issueNature || guidance.issue_nature, [
    "operational_quality",
    "subjective_expectation",
    "content_gap",
    "relationship_expectation",
    "source_integrity",
    "commercial_opportunity",
    "monitor_only",
    "unclear",
  ], "unclear");
  return {
    issueNature,
    subjectivityLevel: normalizeAiActionGuidanceEnum(guidance.subjectivityLevel || guidance.subjectivity_level, ["low", "medium", "high"], "medium"),
    operationalQualityConfidence: normalizeAiActionGuidanceEnum(guidance.operationalQualityConfidence || guidance.operational_quality_confidence, ["low", "medium", "high"], "low"),
    shopperExpectationConfidence: normalizeAiActionGuidanceEnum(guidance.shopperExpectationConfidence || guidance.shopper_expectation_confidence, ["low", "medium", "high"], "medium"),
    shouldEscalateQa: guidance.shouldEscalateQa === true || guidance.should_escalate_qa === true,
    qaReason: guidance.qaReason || guidance.qa_reason || "",
    primaryActionFamily: normalizeAiActionGuidanceEnum(guidance.primaryActionFamily || guidance.primary_action_family, ACTION_GUIDANCE_FAMILIES, ""),
    recommendedActionFamilies: normalizeAiActionFamilies(guidance.recommendedActionFamilies || guidance.recommended_action_families),
    blockedActionFamilies: normalizeAiActionFamilies(guidance.blockedActionFamilies || guidance.blocked_action_families),
    rationale: guidance.rationale || "",
  };
}

function shouldAiSuppressActionFamily(guidance = null, family = "") {
  if (!guidance) return false;
  if (guidance.blockedActionFamilies?.includes(family)) return true;
  if (family !== "qa_review") return false;
  const subjective = guidance.issueNature === "subjective_expectation"
    || guidance.issueNature === "content_gap"
    || guidance.subjectivityLevel === "high";
  const weakOperational = guidance.operationalQualityConfidence !== "high";
  return subjective && weakOperational && guidance.shouldEscalateQa !== true;
}

function shouldAiRecommendQaReview(guidance = null) {
  if (!guidance) return false;
  if (guidance.shouldEscalateQa !== true) return false;
  if (guidance.blockedActionFamilies?.includes("qa_review")) return false;
  return guidance.recommendedActionFamilies?.includes("qa_review")
    || guidance.primaryActionFamily === "qa_review"
    || guidance.issueNature === "operational_quality"
    || guidance.operationalQualityConfidence === "high";
}

function getPurchaseContextRecommendationSignals(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  const context = metrics.productPurchaseContextSummary || {};
  const factors = metrics.productPurchaseContextFactors || {};
  const actionSignals = factors.recommendedActionSignals || {};
  const confidence = normalizePercentLike(context.purchase_context_confidence);
  const totalOrders = Number(context.total_orders_containing_product || 0);
  const enoughContext = totalOrders >= 5 && confidence >= 55;
  const returnUnits = Number(metrics.returnUnits || 0);
  const refundUnits = Number(metrics.refundUnits || 0);
  const highReturnOrRefundEvidence = returnUnits + refundUnits >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE;
  const topPairing = Array.isArray(context.top_co_purchased_products) ? context.top_co_purchased_products[0] : null;

  return {
    variantClarity: {
      shouldRecommend: Boolean(enoughContext && highReturnOrRefundEvidence && actionSignals.variantClarity),
      reason: "Multi-variant purchases are common and returns are elevated, so size, color, option labels, variant photos or comparison guidance should be reviewed.",
    },
    basketContext: {
      shouldRecommend: Boolean(enoughContext && highReturnOrRefundEvidence && actionSignals.basketContext && topPairing),
      reason: topPairing
        ? `Returns are high in basket context; review compatibility, cross-sell copy or expectations for purchases with ${topPairing.title || "a commonly paired product"}.`
        : "Returns are high in basket context; review compatibility, cross-sell copy or bundle expectations.",
    },
    bulkReview: {
      shouldRecommend: Boolean(enoughContext && highReturnOrRefundEvidence && actionSignals.bulkReview),
      reason: "Bulk or multi-unit purchases have enough return/refund evidence to review packaging, fulfillment consistency, batch quality or B2B usage expectations.",
    },
    productLevelPriority: {
      shouldRecommend: Boolean(enoughContext && highReturnOrRefundEvidence && actionSignals.productLevelPriority),
      reason: "The product is usually bought alone, so product-page expectations, quality notes, photos or description gaps are more directly attributable to this product.",
    },
  };
}

function getProductRelationshipRecommendationSignals(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  const factors = metrics.productRelationshipFactors || {};
  const actionSignals = factors.recommendedActionSignals || {};
  const summary = metrics.productRelationshipIntelligenceSummary || {};
  const confidence = normalizePercentLike(summary.confidence?.score ?? factors.context?.confidenceScore);
  const orderCount = Number(summary.data_basis?.order_count || factors.context?.orderCount || 0);
  const enoughSummary = orderCount >= 3 && confidence >= 55;
  const collectionSuggestion = getPrimaryRelationshipCollectionSuggestion(deterministic);

  const normalizeSignal = (signal, fallbackReason) => {
    const relationship = signal || null;
    const title = relationship?.relatedProductTitle || relationship?.related_product_title || "a related product";
    const lift = Number(relationship?.lift || 0);
    const sampleSize = Number(relationship?.sampleSize || relationship?.sample_size || 0);
    const signalConfidence = normalizePercentLike(relationship?.confidence || confidence);
    return {
      relationship,
      title,
      lift,
      sampleSize,
      confidence: signalConfidence,
      shouldRecommend: Boolean(enoughSummary && relationship && sampleSize >= 3 && signalConfidence >= 55),
      reason: fallbackReason(title, lift, sampleSize),
    };
  };

  return {
    bundleOpportunity: normalizeSignal(
      actionSignals.bundleOpportunityRelationship,
      (title, lift, sampleSize) => `${title} is a meaningful same-order companion${lift ? ` (${roundRate(lift, 1)}x lift` : ""} across ${sampleSize} matched order${sampleSize === 1 ? "" : "s"}; review a bundle or frequently-bought-together placement.`,
    ),
    crossSellOpportunity: normalizeSignal(
      actionSignals.crossSellOpportunityRelationship,
      (title, lift, sampleSize) => `${title} appears as a follow-on purchase after this product${lift ? ` (${roundRate(lift, 1)}x lift` : ""} across ${sampleSize} customer sequence${sampleSize === 1 ? "" : "s"}; review post-purchase cross-sell or lifecycle flow positioning.`,
    ),
    compatibilityWarning: normalizeSignal(
      actionSignals.compatibilityWarningRelationship,
      (title) => `Returns or refunds are higher when this product is bought with ${title}; review compatibility messaging, expectations or the recommendation pair before promoting it.`,
    ),
    journeyInsight: normalizeSignal(
      actionSignals.journeyInsightRelationship,
      (title) => `Customers often buy ${title} before this product; review whether this product should be positioned as an upgrade, refill, replacement or next step.`,
    ),
    collectionPlacement: {
      suggestion: collectionSuggestion,
      shouldRecommend: Boolean(
        collectionSuggestion?.collectionId
        && !hasProductCollectionMembership(deterministic.product || {})
        && !hasProductCollectionMembership({ collections: metrics.collections, collectionRecords: metrics.collectionRecords }),
      ),
      reason: collectionSuggestion?.collectionName
        ? `This product is not in a collection, and related products point to the existing "${collectionSuggestion.collectionName}" collection.`
        : "This product is not in a collection, but relationship evidence did not identify a strong existing collection.",
    },
  };
}

function getPrimaryRelationshipCollectionSuggestion(deterministic = {}) {
  const suggestions = deterministic.metrics?.relationshipCollectionSuggestions;
  if (!Array.isArray(suggestions) || !suggestions.length) return null;
  return suggestions
    .filter((suggestion) => suggestion?.collectionId && suggestion.collectionName)
    .sort((first, second) => Number(second.score || 0) - Number(first.score || 0))[0] || null;
}

function isRelationshipExpectationMismatchDiagnosis(deterministic = {}, productRelationshipSignals = null) {
  const metrics = deterministic.metrics || {};
  const mainIssue = normalizeIssueCode(deterministic.mainIssue);
  const signals = productRelationshipSignals || getProductRelationshipRecommendationSignals(deterministic);
  const compatibility = signals.compatibilityWarning || {};
  const relationship = compatibility.relationship || {};
  const deltaReturnRate = Number(relationship.deltaReturnRate ?? relationship.delta_return_rate ?? 0);
  const deltaRefundRate = Number(relationship.deltaRefundRate ?? relationship.delta_refund_rate ?? 0);
  const hasPairingRiskImpact = Boolean(compatibility.shouldRecommend && (deltaReturnRate > 0 || deltaRefundRate > 0));
  if (!hasPairingRiskImpact) return false;

  const contentIssues = [
    ...(Array.isArray(metrics.contentIssues) ? metrics.contentIssues : []),
    ...(Array.isArray(metrics.contentAnalysis?.issues) ? metrics.contentAnalysis.issues : []),
    ...(Array.isArray(metrics.contentAnalysis?.advisories) ? metrics.contentAnalysis.advisories : []),
  ];
  const repeatedLanguage = [
    ...(Array.isArray(metrics.textInsights?.repeatedLanguage) ? metrics.textInsights.repeatedLanguage : []),
    ...(Array.isArray(metrics.textInsights?.reviews?.repeatedLanguage) ? metrics.textInsights.reviews.repeatedLanguage : []),
    ...(Array.isArray(metrics.textInsights?.returns?.repeatedLanguage) ? metrics.textInsights.returns.repeatedLanguage : []),
  ];
  const text = [
    mainIssue,
    metrics.primaryIssue,
    metrics.likelyCause,
    compatibility.reason,
    relationship.relatedProductTitle,
    relationship.related_product_title,
    ...(Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : []),
    ...(Array.isArray(metrics.topReturnReasonDetails) ? metrics.topReturnReasonDetails.map((item) => item.label || item.reason || "") : []),
    ...contentIssues.map((issue) => `${issue.code || ""} ${issue.label || ""} ${issue.evidence || ""}`),
    ...repeatedLanguage.map((item) => item.term || item.label || item.phrase || ""),
    ...(Array.isArray(deterministic.evidenceSnippets) ? deterministic.evidenceSnippets.map((item) => item.text || item.body || item.summary || "") : []),
  ].map(String).join(" ");
  const expectationLanguage = /\b(bundle|bought[ -]?together|pairing|companion|kit|expectation|expected|not as described|description|what.*receive|included|pack|confus|unclear)\b/i.test(text);
  return expectationLanguage || (!hasStopSaleOperationalRisk(deterministic) && ["compatibility", "product_content", "product_quality", "quality_defect"].includes(mainIssue));
}

function getProductRetentionRecommendationSignals(deterministic = {}, { productRelationshipSignals = null } = {}) {
  const metrics = deterministic.metrics || {};
  const retention = metrics.productRetention || {};
  const summary = retention.summary || {};
  const relationshipSignals = productRelationshipSignals || getProductRelationshipRecommendationSignals(deterministic);
  const cohortCustomers = Number(summary.totalCustomersAnalyzed || 0);
  const productOrders = Number(summary.totalProductOrdersAnalyzed || 0);
  const hasEnoughData = Boolean(summary.hasEnoughData) && cohortCustomers >= 10 && productOrders >= 10;
  const healthScore = numberOrNull(summary.retentionHealthScore);
  const repeat90 = numberOrNull(summary.repeatPurchaseRate90d);
  const same90 = numberOrNull(summary.sameProductRepurchaseRate90d);
  const crossSell90 = numberOrNull(summary.crossSellRetentionRate90d);
  const ltv90Cents = numberOrNull(summary.productLtv90Cents) || 0;
  const ltvDeltaCents = numberOrNull(summary.ltv90DeltaCents);
  const riskScore = Number(deterministic.riskScore || metrics.productRiskScore || 0);
  const returnRate = Number(metrics.returnRate || 0);
  const refundRate = Number(metrics.refundRate || 0);
  const hasHardProductRisk = riskScore >= 75 || returnRate >= 25 || refundRate >= 20 || hasStopSaleOperationalRisk(deterministic);
  const relationshipExpectationMode = isRelationshipExpectationMismatchDiagnosis(deterministic, relationshipSignals);
  const sourceIntegrityMode = isSourceIntegrityDiagnosis(deterministic);
  const hasRetentionDropConcern = Boolean(
    (healthScore != null && healthScore <= 45)
      || (repeat90 != null && repeat90 <= 0.05 && cohortCustomers >= 20)
      || (ltvDeltaCents != null && ltvDeltaCents <= -Math.max(500, Math.abs(ltv90Cents) * 0.08)),
  );
  const canRecommendCommercialRetention = hasEnoughData
    && !hasHardProductRisk
    && !hasRetentionDropConcern
    && !relationshipExpectationMode
    && !sourceIntegrityMode;
  const metricsPayload = {
    healthScore,
    repeatPurchaseRate90d: repeat90,
    sameProductRepurchaseRate90d: same90,
    crossSellRetentionRate90d: crossSell90,
    productLtv90Cents: ltv90Cents,
    productLtv180Cents: numberOrNull(summary.productLtv180Cents) || 0,
    ltv90DeltaCents: ltvDeltaCents,
    medianDaysToSecondPurchase: numberOrNull(summary.medianDaysToSecondPurchase),
    totalProductCohortCustomers: cohortCustomers,
    totalProductOrdersAnalyzed: productOrders,
  };

  const repurchase = {
    kind: "repurchase_campaign",
    score: Number(same90 || 0) * 100 + Number(healthScore || 0) / 2,
    summary: metricsPayload,
    shouldRecommend: Boolean(canRecommendCommercialRetention && healthScore >= 65 && same90 >= 0.18),
    reason: `Same-product repurchase is ${formatRetentionPercent(same90)} across ${cohortCustomers} product cohort customers; test a conservative replenishment or repurchase reminder.`,
    campaignPlan: buildRetentionCampaignPlan({
      kind: "repurchase_campaign",
      summary: metricsPayload,
    }),
  };
  const crossSellRelationship = getRetentionRelationshipSignal(relationshipSignals.crossSellOpportunity);
  const crossSell = {
    kind: "retention_cross_sell_campaign",
    score: Number(crossSell90 || 0) * 100 + Number(crossSellRelationship.sampleSize || 0) * 3 + Number(crossSellRelationship.lift || 0) * 4,
    summary: metricsPayload,
    relationship: crossSellRelationship.relationship,
    shouldRecommend: Boolean(canRecommendCommercialRetention && crossSell90 >= 0.20 && crossSellRelationship.hasActionableRelationship),
    reason: `${formatRetentionPercent(crossSell90)} of product cohort customers buy another product within 90 days, and ${crossSellRelationship.title} appears as a reliable follow-on purchase.`,
    campaignPlan: buildRetentionCampaignPlan({
      kind: "retention_cross_sell_campaign",
      summary: metricsPayload,
      relatedProductTitle: crossSellRelationship.title,
    }),
  };
  const bundleRelationship = getRetentionRelationshipSignal(relationshipSignals.bundleOpportunity);
  const bundle = {
    kind: "retention_bundle_offer",
    score: Number(crossSell90 || 0) * 100 + Number(bundleRelationship.sampleSize || 0) * 3 + Number(bundleRelationship.lift || 0) * 5,
    summary: metricsPayload,
    relationship: bundleRelationship.relationship,
    shouldRecommend: Boolean(canRecommendCommercialRetention && crossSell90 >= 0.15 && bundleRelationship.hasActionableRelationship),
    reason: `${bundleRelationship.title} is a stable bought-together product, and retention LTV includes meaningful cross-sell contribution.`,
    campaignPlan: buildRetentionCampaignPlan({
      kind: "retention_bundle_offer",
      summary: metricsPayload,
      relatedProductTitle: bundleRelationship.title,
    }),
  };
  const drop = {
    kind: "retention_drop_review",
    score: 100 - Number(healthScore || 100),
    summary: metricsPayload,
    shouldRecommend: Boolean(hasEnoughData && !sourceIntegrityMode && hasRetentionDropConcern),
    reason: buildRetentionDropReason({ healthScore, repeat90, ltvDeltaCents, ltv90Cents, cohortCustomers }),
    campaignPlan: buildRetentionCampaignPlan({
      kind: "retention_drop_review",
      summary: metricsPayload,
    }),
  };

  const opportunitySignals = [repurchase, crossSell, bundle].filter((signal) => signal.shouldRecommend);
  const winner = opportunitySignals.sort((first, second) => second.score - first.score)[0] || null;
  const keepOnlyWinner = (signal) => ({
    ...signal,
    shouldRecommend: Boolean(winner && signal.kind === winner.kind),
    suppressionReason: winner && signal.kind !== winner.kind
      ? `Suppressed because ${winner.kind} is the strongest retention action for this diagnosis.`
      : signal.suppressionReason,
  });

  return {
    repurchaseCampaign: keepOnlyWinner(repurchase),
    crossSellCampaign: keepOnlyWinner(crossSell),
    bundleOffer: keepOnlyWinner(bundle),
    dropReview: drop,
  };
}

function getRetentionRelationshipSignal(signal = {}) {
  const relationship = signal?.relationship && typeof signal.relationship === "object" ? signal.relationship : null;
  const title = relationship?.relatedProductTitle || relationship?.related_product_title || signal.title || "a related product";
  const sampleSize = Number(signal.sampleSize || relationship?.sampleSize || relationship?.sample_size || 0);
  const confidence = normalizePercentLike(signal.confidence || relationship?.confidence || 0);
  const lift = Number(signal.lift ?? relationship?.lift ?? 0);
  return {
    relationship: relationship || {},
    title,
    sampleSize,
    confidence,
    lift,
    hasActionableRelationship: Boolean(relationship && sampleSize >= 3 && confidence >= 55),
  };
}

function buildRetentionDropReason({ healthScore, repeat90, ltvDeltaCents, ltv90Cents, cohortCustomers }) {
  if (healthScore != null && healthScore <= 45) {
    return `Retention health is ${Math.round(healthScore)}/100 across ${cohortCustomers} product cohort customers; review onboarding, expectation fit, and lifecycle follow-up before adding growth campaigns.`;
  }
  if (repeat90 != null && repeat90 <= 0.05) {
    return `90-day repeat purchase is only ${formatRetentionPercent(repeat90)} across ${cohortCustomers} product cohort customers; review whether buyers have a clear reason to return.`;
  }
  const deltaText = ltvDeltaCents == null ? "down" : `${formatMoney(ltvDeltaCents / 100)} ${ltvDeltaCents < 0 ? "down" : "changed"}`;
  return `90-day product LTV is ${deltaText} against the previous period from a ${formatMoney(ltv90Cents / 100)} baseline; review whether retention quality is weakening.`;
}

function buildRetentionCampaignPlan({ kind, summary = {}, relatedProductTitle = "" } = {}) {
  const timing = summary.medianDaysToSecondPurchase == null
    ? "Use the normal replenishment or post-purchase timing for this category."
    : `Start around ${Math.max(7, Math.round(summary.medianDaysToSecondPurchase * 0.75))} days after purchase, before the median ${Math.round(summary.medianDaysToSecondPurchase)}-day second-purchase point.`;
  if (kind === "repurchase_campaign") {
    return {
      objective: "Increase repeat purchases from customers who already showed same-product repurchase behavior.",
      audience: "Customers who bought this product and have not purchased it again within the expected repeat window.",
      timing,
      messageAngle: "Remind customers why they bought it, when replacement or replenishment makes sense, and what to check before reordering.",
      offerIdea: "Start with a light reminder or small loyalty incentive; avoid deep discounting until the campaign proves incremental.",
      successMetric: "Same-product repurchase rate, repeat revenue per cohort customer, unsubscribe/complaint rate.",
      guardrail: "Do not run this if recent returns, refunds, or reviews indicate unresolved product quality risk.",
    };
  }
  if (kind === "retention_cross_sell_campaign") {
    return {
      objective: `Turn the observed follow-on purchase pattern into a measured lifecycle cross-sell for ${relatedProductTitle || "the related product"}.`,
      audience: "Customers who bought this product but have not yet bought the related follow-on product.",
      timing,
      messageAngle: `Explain why ${relatedProductTitle || "the related product"} is the next useful step and how it complements the original purchase.`,
      offerIdea: "Test product education first, then a modest cross-sell incentive only if the education email is healthy.",
      successMetric: "Cross-sell conversion, incremental LTV, return/refund rate on cross-sell orders.",
      guardrail: "Keep the campaign paused if the related-product pair has elevated return/refund pressure or unclear compatibility expectations.",
    };
  }
  if (kind === "retention_bundle_offer") {
    return {
      objective: `Test whether a bundle with ${relatedProductTitle || "the related product"} increases LTV without adding post-purchase friction.`,
      audience: "New shoppers considering this product, plus returning customers who bought only one item.",
      timing: "Use PDP merchandising, cart recommendation, or a small audience test before making the bundle permanent.",
      messageAngle: "Make the bundle purpose explicit: what each item does, what is included, and when the pair is useful.",
      offerIdea: "Start as a frequently-bought-together module or limited bundle offer rather than a mandatory kit.",
      successMetric: "Attach rate, bundle conversion, return/refund delta versus source-only orders.",
      guardrail: "Do not promote the bundle if pairing evidence shows expectation mismatch or higher returns.",
    };
  }
  return {
    objective: "Understand why product cohorts are not returning before launching retention campaigns.",
    audience: "Recent product buyers segmented by variant, first-order quantity, discount use, and acquisition channel.",
    timing: "Review cohorts before sending new growth messaging; use the next diagnosis run to check whether retention recovers.",
    messageAngle: "If messaging is needed, focus on education, setup, care, replenishment timing, or expectation reset rather than discounting.",
    offerIdea: "No offer by default; first verify whether the drop is product fit, timing, channel quality, or missing lifecycle follow-up.",
    successMetric: "Retention health, 90-day repeat rate, LTV delta, and post-purchase complaint rate.",
    guardrail: "Do not create a growth campaign from weak retention until product-quality and expectation evidence is reviewed.",
  };
}

function formatRetentionPercent(value) {
  if (value == null) return "unavailable";
  return `${roundRate(Number(value) * 100, 1)}%`;
}

function hasStopSaleOperationalRisk(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  const mainIssue = normalizeIssueCode(deterministic.mainIssue);
  if (mainIssue === "safety_concern") return true;
  if (!["quality_defect", "durability", "refund_impact"].includes(mainIssue)) return false;
  if (!hasOperationalQualityTextSignals(deterministic)) return false;

  const returnRefundUnits = Number(metrics.returnUnits || 0) + Number(metrics.refundUnits || 0);
  const highRates = Number(metrics.returnRate || 0) >= 25
    || Number(metrics.refundRate || 0) >= 20
    || Boolean(metrics.refundInsights?.highPressure);
  return returnRefundUnits >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE
    && (Number(deterministic.riskScore || 0) >= 70 || highRates);
}

function buildProductRelationshipRecommendationPayload(signal = {}, extra = {}) {
  const relationship = signal.relationship || {};
  return {
    ...extra,
    relatedProductId: relationship.relatedProductId || relationship.related_product_id || null,
    relatedProductTitle: relationship.relatedProductTitle || relationship.related_product_title || signal.title || "",
    relationshipType: relationship.relationshipType || relationship.relationship_type || "",
    relationshipDirection: relationship.direction || relationship.relationshipDirection || relationship.relationship_direction || "",
    timeWindow: relationship.timeWindow || relationship.time_window || "",
    lift: relationship.lift ?? null,
    confidence: signal.confidence || relationship.confidence || null,
    confidenceLabel: relationship.confidenceLabel || relationship.confidence_label || "",
    sampleSize: signal.sampleSize || relationship.sampleSize || relationship.sample_size || 0,
    relationshipStrength: relationship.relationshipStrength || relationship.relationship_strength || "",
    trend: relationship.trend || "",
    deltaReturnRate: relationship.deltaReturnRate || relationship.delta_return_rate || 0,
    deltaRefundRate: relationship.deltaRefundRate || relationship.delta_refund_rate || 0,
    source: "product_relationship_intelligence",
    readOnly: true,
  };
}

function buildProductRelationshipCollectionPayload(signal = {}, extra = {}) {
  const suggestion = signal.suggestion || {};
  return {
    ...extra,
    field: "collection",
    collectionId: suggestion.collectionId || "",
    collectionName: suggestion.collectionName || "",
    collectionHandle: suggestion.collectionHandle || "",
    relationshipCollectionScore: suggestion.score || 0,
    relationshipEvidence: Array.isArray(suggestion.evidence) ? suggestion.evidence : [],
    relatedProducts: Array.isArray(suggestion.relatedProducts) ? suggestion.relatedProducts : [],
    source: "product_relationship_intelligence",
    readOnly: false,
  };
}

function buildProductRetentionRecommendationPayload(signal = {}, extra = {}) {
  const summary = signal.summary || {};
  const relationship = signal.relationship || {};
  const campaignPlan = signal.campaignPlan || buildRetentionCampaignPlan({ kind: signal.kind, summary });
  return {
    ...extra,
    source: "product_retention",
    retentionActionKind: signal.kind || extra.recommendationKind || "",
    retentionMetrics: {
      healthScore: summary.healthScore ?? null,
      repeatPurchaseRate90d: summary.repeatPurchaseRate90d ?? null,
      sameProductRepurchaseRate90d: summary.sameProductRepurchaseRate90d ?? null,
      crossSellRetentionRate90d: summary.crossSellRetentionRate90d ?? null,
      productLtv90Cents: summary.productLtv90Cents || 0,
      productLtv180Cents: summary.productLtv180Cents || 0,
      ltv90DeltaCents: summary.ltv90DeltaCents ?? null,
      medianDaysToSecondPurchase: summary.medianDaysToSecondPurchase ?? null,
      totalProductCohortCustomers: summary.totalProductCohortCustomers || 0,
      totalProductOrdersAnalyzed: summary.totalProductOrdersAnalyzed || 0,
    },
    campaignPlan,
    campaignBrief: formatRetentionCampaignBrief(campaignPlan),
    relatedProductId: relationship.relatedProductId || relationship.related_product_id || null,
    relatedProductTitle: relationship.relatedProductTitle || relationship.related_product_title || "",
    relationshipType: relationship.relationshipType || relationship.relationship_type || "",
    relationshipDirection: relationship.direction || relationship.relationshipDirection || relationship.relationship_direction || "",
    timeWindow: relationship.timeWindow || relationship.time_window || "",
    lift: relationship.lift ?? null,
    sampleSize: signal.sampleSize || relationship.sampleSize || relationship.sample_size || 0,
    readOnly: true,
  };
}

function formatRetentionCampaignBrief(plan = {}) {
  return [
    plan.objective ? `Objective: ${plan.objective}` : "",
    plan.audience ? `Audience: ${plan.audience}` : "",
    plan.timing ? `Timing: ${plan.timing}` : "",
    plan.messageAngle ? `Message: ${plan.messageAngle}` : "",
    plan.offerIdea ? `Offer: ${plan.offerIdea}` : "",
    plan.successMetric ? `Success metric: ${plan.successMetric}` : "",
    plan.guardrail ? `Guardrail: ${plan.guardrail}` : "",
  ].filter(Boolean).join("\n");
}

function normalizePercentLike(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return numeric <= 1 ? numeric * 100 : numeric;
}

function getActionableContentIssues(metrics = {}) {
  const issues = Array.isArray(metrics.contentAnalysis?.issues) ? metrics.contentAnalysis.issues : metrics.contentIssues || [];
  return issues.filter((issue) => issue && typeof issue === "object");
}

function getValuePerceptionSignals(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  const textInsights = metrics.textInsights || {};
  const repeated = [
    ...(Array.isArray(textInsights.repeatedLanguage) ? textInsights.repeatedLanguage : []),
    ...(Array.isArray(textInsights.reviews?.repeatedLanguage) ? textInsights.reviews.repeatedLanguage : []),
    ...(Array.isArray(textInsights.returns?.repeatedLanguage) ? textInsights.returns.repeatedLanguage : []),
  ];
  const snippets = Array.isArray(deterministic.evidenceSnippets) ? deterministic.evidenceSnippets : [];
  const values = [
    ...repeated.map((item) => item.term || item.label || ""),
    ...snippets.map((item) => item.text || item.body || item.summary || ""),
  ].map(String);

  return uniqueBy(values.filter((value) => /\b(expensive|price|priced|cost|costly|cheap|not worth|worth it|value|overpriced|quality for the price)\b/i.test(value)), (value) => normalizeText(value))
    .slice(0, 5);
}

function isSourceIntegrityDiagnosis(deterministic = {}, sourceMismatchSignals = null) {
  const metrics = deterministic.metrics || {};
  const signals = Array.isArray(sourceMismatchSignals) ? sourceMismatchSignals : getSourceMismatchSignals(deterministic);
  if (signals.length >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) return true;
  const contentIssues = [
    ...(Array.isArray(metrics.contentIssues) ? metrics.contentIssues : []),
    ...(Array.isArray(metrics.contentAnalysis?.issues) ? metrics.contentAnalysis.issues : []),
    ...(Array.isArray(metrics.contentAnalysis?.advisories) ? metrics.contentAnalysis.advisories : []),
  ];
  const issueText = [
    deterministic.mainIssue,
    metrics.primaryIssue,
    metrics.mainIssue,
    ...contentIssues.map((issue) => `${issue.code || ""} ${issue.label || ""} ${issue.evidence || ""}`),
  ].map(String).join(" ");
  return /\b(source integrity|review feed|feed integrity|feed mismatch|metadata mismatch|review mismatch|wrong product|wrong sku)\b/i.test(issueText);
}

function isSubjectiveExpectationOnlyDiagnosis(deterministic = {}) {
  const aiActionGuidance = getAiActionGuidance(deterministic);
  if (aiActionGuidance) {
    const subjectiveByAi = aiActionGuidance.issueNature === "subjective_expectation"
      || aiActionGuidance.subjectivityLevel === "high";
    const operationalByAi = aiActionGuidance.shouldEscalateQa === true
      || aiActionGuidance.issueNature === "operational_quality"
      || aiActionGuidance.operationalQualityConfidence === "high";
    if (subjectiveByAi && !operationalByAi) return true;
  }
  const mainIssue = normalizeIssueCode(deterministic.mainIssue);
  const textValues = getOperationalSignalTextValues(deterministic);
  const text = textValues.join(" ");
  const subjectiveIssue = ["fit_sizing", "compatibility", "color_expectation", "subjective_negative_reaction"].includes(mainIssue);
  const subjectiveLanguage = /\b(too soft|too firm|softness|soft|cushion|cushioned|balance|pose|comfort|comfortable|preference|expected|expectation|subjective|fit|sizing|size|color|appearance)\b/i.test(text);
  if (!subjectiveIssue && !subjectiveLanguage) return false;
  return !hasOperationalQualityTextSignals(deterministic);
}

function isRefundDrivenOperationalDiagnosis(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  return Boolean(
    Number(metrics.refundUnits || 0) >= 3
    && Number(metrics.refundRate || 0) >= 20
    && hasOperationalQualityTextSignals(deterministic)
  );
}

function hasAffectedVariantConcentration(metrics = {}) {
  const variants = Array.isArray(metrics.affectedVariantDetails)
    ? metrics.affectedVariantDetails
    : Array.isArray(metrics.affectedVariants)
      ? metrics.affectedVariants.map((label) => ({ label, count: 1 }))
      : [];
  if (variants.length < 1) return false;
  const counts = variants.map((variant) => Number(variant.count || 0)).filter((count) => count > 0);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const strongest = Math.max(0, ...counts);
  if (strongest < 3 || total < 4) return false;
  const strongestRatio = strongest / Math.max(total, 1);
  const variantCount = Number(metrics.variantCount || 0);
  const affectedCount = Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants.length : variants.length;
  if (variantCount > 1 && affectedCount >= variantCount && strongestRatio < 0.85) return false;
  return strongestRatio >= 0.65;
}

function hasOperationalQualityTextSignals(deterministic = {}) {
  const aiActionGuidance = getAiActionGuidance(deterministic);
  if (shouldAiSuppressActionFamily(aiActionGuidance, "qa_review")) return false;
  if (shouldAiRecommendQaReview(aiActionGuidance)) return true;
  return getOperationalSignalTextValues(deterministic)
    .some(hasOperationalQualityLanguage);
}

function hasProductFailureTextSignals(deterministic = {}) {
  return getOperationalSignalTextValues(deterministic).some((value) => {
    const text = String(value || "").toLowerCase();
    if (!text) return false;
    const explicitTransitIssue = /\b(shipping|delivery|shipment|carrier|in transit|transit|arrived damaged|damaged in transit|lost package)\b/i.test(text);
    const productFailure = /\b(leak|leaking|deflat|lost air|hold pressure|wobbl|sliding|tilt|unstable|unsafe|safety|broken|break|broke|crack|cracked|chip|chipped|tear|tore|ripped|malfunction|failed|failure|seal)\b/i.test(text);
    return productFailure && !explicitTransitIssue;
  });
}

function hasOperationalQualityLanguage(value = "") {
  const text = String(value || "").toLowerCase();
  if (!text) return false;
  const normalized = normalizeText(text);
  const setupDependentApplianceLanguage = /\b(min line|minimum fill|min fill|fill line|120v|120 v|voltage|converter|travel converter|power bank|car socket|steam vent|vent clearance|first boil|first use|silicone smell|odor|odour|descale|mineral buildup)\b/.test(normalized);
  if (setupDependentApplianceLanguage && isSetupExpectationMismatchText(normalized)) return false;
  const hardOperationalPattern = /\b(leak|leaking|spill|spilled|broken|break|broke|crack|cracked|chip|chipped|unsafe|safety|hazard|durability|malfunction|failed|failure|lid|seal|tear|tore|ripped|stain|mold|battery|burn|sharp|packaging|package|shipping|arrived damaged)\b/i;
  if (hardOperationalPattern.test(text)) return true;
  const defectOnlyPattern = /\b(defect|defective|damaged|damage|quality problem|manufacturing issue|supplier issue)\b/i;
  if (!defectOnlyPattern.test(text)) return false;
  return !/\b(not|no|without|isn't|is not|wasn't|was not|not necessarily|personal preference|preference issue)\b.{0,60}\b(defect|defective|damaged|damage|quality problem)\b/i.test(text);
}

function getOperationalSignalTextValues(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  const contentIssues = [
    ...(Array.isArray(metrics.contentIssues) ? metrics.contentIssues : []),
    ...(Array.isArray(metrics.contentAnalysis?.issues) ? metrics.contentAnalysis.issues : []),
    ...(Array.isArray(metrics.contentAnalysis?.advisories) ? metrics.contentAnalysis.advisories : []),
  ];
  const repeated = [
    ...(Array.isArray(metrics.textInsights?.repeatedLanguage) ? metrics.textInsights.repeatedLanguage : []),
    ...(Array.isArray(metrics.textInsights?.reviews?.repeatedLanguage) ? metrics.textInsights.reviews.repeatedLanguage : []),
    ...(Array.isArray(metrics.textInsights?.returns?.repeatedLanguage) ? metrics.textInsights.returns.repeatedLanguage : []),
  ];
  const topReasons = Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : [];
  const snippets = Array.isArray(deterministic.evidenceSnippets) ? deterministic.evidenceSnippets : [];
  const values = [
    ...contentIssues.map((issue) => `${issue.code || ""} ${issue.label || ""} ${issue.evidence || ""}`),
    ...repeated.map((item) => `${item.term || item.label || item.phrase || ""}`),
    ...topReasons.map((item) => `${item.label || item}`),
    ...snippets.map((item) => `${item.text || item.body || item.quote || item.summary || ""}`),
  ].map(String);
  return values;
}

function getSourceMismatchSignals(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  const contentIssues = [
    ...(Array.isArray(metrics.contentIssues) ? metrics.contentIssues : []),
    ...(Array.isArray(metrics.contentAnalysis?.issues) ? metrics.contentAnalysis.issues : []),
    ...(Array.isArray(metrics.contentAnalysis?.advisories) ? metrics.contentAnalysis.advisories : []),
  ];
  const textValues = [
    ...(Array.isArray(deterministic.evidenceSnippets) ? deterministic.evidenceSnippets : []).map((item) => item.text || item.body || item.quote || item.summary || ""),
    ...contentIssues.map((item) => `${item.code || ""} ${item.label || ""} ${item.evidence || ""}`),
    ...(Array.isArray(metrics.textInsights?.repeatedLanguage) ? metrics.textInsights.repeatedLanguage : []).map((item) => item.term || item.label || item.phrase || ""),
  ].map(String);
  return uniqueBy(
    textValues.filter((value) => /\b(wrong product|different product|another product|not this product|wrong sku|sku mismatch|review mismatch|feed mismatch|wrong variant|not the item|different item)\b/i.test(value)),
    (value) => normalizeText(value),
  ).slice(0, 5);
}

function getMissingSourceSignals(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  const sourceCoverage = new Set((deterministic.sourceCoverage || metrics.sourceCoverage || []).map((source) => normalizeText(source)));
  const missing = [];
  if (metrics.orderAccessDenied) missing.push("Shopify orders");
  if (
    !sourceCoverageHas(sourceCoverage, "csv")
    && !sourceCoverageHas(sourceCoverage, "judge")
    && !sourceCoverageHas(sourceCoverage, "yotpo")
    && !sourceCoverageHas(sourceCoverage, "loox")
    && !Number(metrics.reviewCount || 0)
  ) missing.push("external reviews");
  return uniqueBy(missing, normalizeText).slice(0, 4);
}

function sourceCoverageHas(sourceCoverage, needle) {
  const normalizedNeedle = normalizeText(needle);
  return [...sourceCoverage].some((source) => source.includes(normalizedNeedle));
}

function isStaleDiagnosis(value, staleDays = 14) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() > staleDays * 24 * 60 * 60 * 1000;
}

function decorateRecommendationRecipe(action, { deterministic, mainIssue, index }) {
  const recipe = getRecommendationRecipeMetadata(action, { deterministic, mainIssue, index });
  const compact = getRecommendationCompactMetadata(action, { deterministic, mainIssue, recipe });
  return {
    ...action,
    priorityGroup: recipe.priorityGroup,
    payload: {
      ...(action.payload || {}),
      recipe: true,
      recipeState: "Suggested",
      trigger: action.payload?.trigger || recipe.trigger,
      proposedChange: recipe.proposedChange,
      shopifyField: recipe.shopifyField,
      expectedImpact: recipe.expectedImpact,
      applicationRisk: recipe.applicationRisk,
      approval: recipe.approval,
      reviewApplyFlow: "Review -> Apply",
      priorityGroup: recipe.priorityGroup,
      impactLevel: recipe.impactLevel,
      impact: compact.impact,
      actionTier: recipe.actionTier,
      visibility: compact.visibility,
      confidence: compact.confidence,
      evidenceStrength: compact.evidenceStrength,
      reversibility: compact.reversibility,
      approvalLevel: compact.approvalLevel,
      reasonCategory: compact.reasonCategory,
      expectedBenefit: compact.expectedBenefit,
    },
  };
}

function getRecommendationCompactMetadata(action, { deterministic, mainIssue, recipe }) {
  return {
    impact: getCompactImpactLabel(recipe.impact || recipe.impactLevel),
    visibility: getRecommendationVisibility(action),
    confidence: getRecommendationConfidenceLabel(deterministic.confidence),
    evidenceStrength: getRecommendationEvidenceStrengthLabel(deterministic, action),
    reversibility: getRecommendationReversibility(action),
    approvalLevel: getRecommendationApprovalLevel(action, recipe),
    reasonCategory: getRecommendationReasonCategory(action, mainIssue),
    expectedBenefit: getRecommendationExpectedBenefit(action, recipe),
  };
}

function getCompactImpactLabel(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("high")) return "High";
  if (normalized.includes("medium")) return "Medium";
  return "Optional";
}

function getRecommendationConfidenceLabel(confidence) {
  const score = Number(confidence || 0);
  if (score >= 75) return "High";
  if (score >= 50) return "Medium";
  return "Low";
}

function getRecommendationEvidenceStrengthLabel(deterministic = {}, action = {}) {
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""}`.toLowerCase();
  if (normalized.includes("mismatch") || normalized.includes("conflict")) return "Conflicting";
  const metrics = deterministic.metrics || {};
  if (/\b(retention|repurchase|lifecycle|campaign)\b/.test(normalized)) {
    const cohortCustomers = Number(metrics.productRetention?.summary?.totalCustomersAnalyzed || 0);
    if (cohortCustomers >= 50) return "Strong";
    if (cohortCustomers >= 10) return "Moderate";
    return "Weak";
  }
  const sourceCount = Array.isArray(deterministic.sourceCoverage) ? deterministic.sourceCoverage.length : Array.isArray(metrics.sourceCoverage) ? metrics.sourceCoverage.length : 0;
  const signalCount = Number(metrics.customerSignalCount || metrics.signalCount || 0);
  if (signalCount >= 10 && sourceCount >= 3) return "Strong";
  if (signalCount >= 5 || sourceCount >= 2) return "Moderate";
  return "Weak";
}

function getRecommendationVisibility(action = {}) {
  const value = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.payload?.shopifyField || ""}`.toLowerCase();
  if (/\b(retention|repurchase|lifecycle|campaign)\b/.test(value)) return "Customer-facing";
  if (/\b(pairing|compatibility review|bundle expectations)\b/.test(value)) return "Customer-facing";
  if (/\b(description|pdp|faq|title|seo|meta|handle|media|image|alt text|specs|details)\b/.test(value)) return "Customer-facing";
  if (/\b(status|price|compare-at|inventory|variant|supplier|qa|fulfillment|safety)\b/.test(value)) return "Operational";
  return "Internal";
}

function getRecommendationReversibility(action = {}) {
  const value = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.payload?.shopifyField || ""}`.toLowerCase();
  if (/\b(status|archive|draft|inventory|price|compare-at|variant)\b/.test(value)) return "Hard";
  if (/\b(description|pdp|title|seo|meta|handle|template|media|collection|classification)\b/.test(value)) return "Moderate";
  return "Easy";
}

function getRecommendationApprovalLevel(action = {}, recipe = {}) {
  const value = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${recipe.applicationRisk || ""} ${recipe.approval || ""}`.toLowerCase();
  if (/\b(high|status|archive|draft|inventory|price|compare-at|strong|manual approval)\b/.test(value)) return "Strong confirmation required";
  if (/\b(retention|repurchase|lifecycle|campaign)\b/.test(value)) return "Review required";
  if (/\b(tag|metafield|watchlist|baseline|internal note|copy-support|connect-missing-source|monitoring)\b/.test(value)) return "Auto-safe";
  return "Review required";
}

function getRecommendationReasonCategory(action = {}, mainIssue = "") {
  const value = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.payload?.trigger || ""} ${mainIssue || ""}`.toLowerCase();
  if (/\b(retention|repurchase|lifecycle|campaign|ltv)\b/.test(value)) return "Retention";
  if (/\b(bundle|cross-sell|pairing|journey|upgrade|product relationship)\b/.test(value)) return "Product relationship";
  if (/\b(momentum|watchlist|baseline)\b/.test(value)) return "Sales Momentum";
  if (/\b(seo|meta|handle)\b/.test(value)) return "SEO";
  if (/\b(variant|sku|option)\b/.test(value)) return "Variant issue";
  if (/\b(sentiment|subjective|fear|safety|emotion)\b/.test(value)) return "Sentiment";
  if (/\b(review|rating|judge|csv)\b/.test(value)) return "Reviews";
  if (/\b(refund|price|margin|value)\b/.test(value)) return "Refunds";
  if (/\b(return)\b/.test(value)) return "Returns";
  if (/\b(description|content|pdp|faq|spec|title|media|image)\b/.test(value)) return "Content gap";
  return "Content gap";
}

function getRecommendationExpectedBenefit(action = {}, recipe = {}) {
  const value = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${recipe.expectedImpact || ""}`.toLowerCase();
  if (/\b(retention|repurchase|lifecycle|campaign|ltv)\b/.test(value)) return "Improve retention";
  if (/\b(bundle|cross-sell|journey|upgrade)\b/.test(value)) return "Improve merchandising";
  if (/\b(pairing|compatibility review)\b/.test(value)) return "Reduce returns";
  if (/\b(seo|meta|handle)\b/.test(value)) return "Improve SEO";
  if (/\b(tag|collection|metafield|workflow|support|note|coverage|watchlist|baseline)\b/.test(value)) return "Improve workflow";
  if (/\b(status|inventory|draft|archive|safety|qa|supplier|bad purchase)\b/.test(value)) return "Prevent bad purchases";
  if (/\b(return|refund|variant|fit|size|quality|durability)\b/.test(value)) return "Reduce returns";
  return "Reduce confusion";
}

function getRecommendationRecipeMetadata(action, { deterministic, mainIssue, index }) {
  const id = String(action.id || "");
  const payload = action.payload || {};
  const metrics = deterministic.metrics || {};
  const relationshipExpectationMode = isRelationshipExpectationMismatchDiagnosis(deterministic);
  const primary = index === 0 ? "Primary customer-facing fix" : "Suggested action";
  const trigger = payload.trigger || action.reason || `ProductPulse found ${getHumanIssueLabel(mainIssue)} evidence.`;
  const common = {
    trigger,
    proposedChange: action.label || "Review recommended action",
    shopifyField: "ProductPulse workflow",
    expectedImpact: "Improve operational follow-through from the current diagnosis.",
    applicationRisk: "Low",
    approval: "Review required before applying",
    priorityGroup: primary,
    impactLevel: "Optional",
    actionTier: 3,
  };

  if (id === "correct-product-description") {
    const targetedEnhancement = payload.changeStrategy === "targeted-enhancement";
    return {
      ...common,
      proposedChange: targetedEnhancement
        ? "Make a targeted product-specific edit to the Shopify description while preserving the existing structure."
        : "Correct specific contradictory text in the Shopify product description while preserving the existing description structure.",
      shopifyField: "Product.descriptionHtml",
      expectedImpact: targetedEnhancement
        ? "Add only the missing shopper guidance without duplicating content already covered in the PDP."
        : "Remove a buyer-facing content contradiction without rewriting the full PDP copy.",
      applicationRisk: "Low",
      priorityGroup: "Customer-facing fix",
      impactLevel: "High impact",
      actionTier: 1,
    };
  }
  if ((id.includes("description") && id !== "rewrite-meta-description") || id.includes("fit-note") || id.includes("expectation") || id.includes("quality-note") || id.includes("subjective")) {
    return {
      ...common,
      proposedChange: payload.operation === "replace" ? "Rewrite the Shopify product description while preserving useful existing copy." : "Insert shopper-facing expectation guidance into the product description.",
      shopifyField: "Product.descriptionHtml",
      expectedImpact: "Reduce avoidable buyer confusion before checkout.",
      applicationRisk: "Low",
      priorityGroup: "Customer-facing fix",
      impactLevel: "High impact",
      actionTier: 1,
    };
  }
  if (id === "create-product-faq") {
    return {
      ...common,
      proposedChange: "Create generated FAQ content and apply it as description HTML or a product metafield.",
      shopifyField: "Product.descriptionHtml or productpulse.faq_html metafield",
      expectedImpact: "Answer repeated buyer uncertainty before purchase.",
      applicationRisk: "Low",
      priorityGroup: "Customer-facing fix",
      impactLevel: "High impact",
      actionTier: 1,
    };
  }
  if (id === "update-product-title") {
    return {
      ...common,
      proposedChange: `Change the title from "${payload.currentTitle || "current title"}" to "${payload.draftTitle || "a clearer title"}".`,
      shopifyField: "Product.title",
      expectedImpact: "Make the product easier to identify and reduce expectation mismatch.",
      applicationRisk: "Medium",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "rewrite-seo-title") {
    return {
      ...common,
      proposedChange: `Change the SEO title to "${payload.draftText || payload.draftTitle || "a clearer search title"}".`,
      shopifyField: "Product.seo.title",
      expectedImpact: "Improve search-result clarity without changing the visible PDP title.",
      applicationRisk: "Low",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "rewrite-meta-description") {
    return {
      ...common,
      proposedChange: "Rewrite the Shopify meta description for clearer search-result copy.",
      shopifyField: "Product.seo.description",
      expectedImpact: "Clarify search-result expectations and reduce low-intent clicks.",
      applicationRisk: "Low",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "improve-url-handle") {
    return {
      ...common,
      proposedChange: `Change the product URL handle to "${payload.draftHandle || payload.draftText || "a clearer handle"}" and create a redirect when Shopify supports it.`,
      shopifyField: "Product.handle",
      expectedImpact: "Make the URL easier to read, share and match to product keywords.",
      applicationRisk: "Medium",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "add-specs-details-block") {
    return {
      ...common,
      proposedChange: "Add a compact specs/details block to the Shopify product description.",
      shopifyField: "Product.descriptionHtml",
      expectedImpact: "Reduce confusion around dimensions, compatibility, materials, care, included items or product limits.",
      applicationRisk: "Low",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "review-product-pairing-expectations") {
    return {
      ...common,
      proposedChange: `Review compatibility messaging, cross-sell copy, or bundle expectations for purchases involving ${payload.relatedProductTitle || "the related product"}.`,
      shopifyField: "ProductPulse merchandising workflow",
      expectedImpact: "Reduce avoidable returns from a product pairing that shows higher return or refund pressure.",
      applicationRisk: "Low",
      priorityGroup: "Customer-facing fix",
      impactLevel: "High impact",
      actionTier: 1,
    };
  }
  if (id === "test-product-bundle") {
    return {
      ...common,
      proposedChange: `Review whether ${payload.relatedProductTitle || "the related product"} should be merchandised as a bundle or frequently-bought-together companion.`,
      shopifyField: "ProductPulse merchandising workflow",
      expectedImpact: "Improve merchandising from a high-lift same-order relationship without treating it as Product Risk.",
      applicationRisk: "Low",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "create-post-purchase-cross-sell") {
    return {
      ...common,
      proposedChange: `Review a post-purchase cross-sell or lifecycle flow that suggests ${payload.relatedProductTitle || "the related product"} after this product.`,
      shopifyField: "ProductPulse merchandising workflow",
      expectedImpact: relationshipExpectationMode
        ? "Keep the follow-on purchase pattern as merchandising context until the pairing/expectation risk is handled."
        : "Use a stable follow-on purchase pattern as a commercial opportunity.",
      applicationRisk: "Low",
      priorityGroup: relationshipExpectationMode ? "Merchandising insight" : "Medium-impact catalog fix",
      impactLevel: relationshipExpectationMode ? "Optional" : "Medium impact",
      actionTier: relationshipExpectationMode ? 3 : 2,
    };
  }
  if (id === "position-as-upgrade-path") {
    return {
      ...common,
      proposedChange: `Review product copy or merchandising that positions this product as a next step after ${payload.relatedProductTitle || "the previous product"}.`,
      shopifyField: "ProductPulse merchandising workflow",
      expectedImpact: relationshipExpectationMode
        ? "Keep the previous-purchase sequence as journey context until the pairing/expectation risk is handled."
        : "Clarify the customer journey when purchase sequence data shows an upgrade, refill, or next-step pattern.",
      applicationRisk: "Low",
      priorityGroup: relationshipExpectationMode ? "Merchandising insight" : "Medium-impact catalog fix",
      impactLevel: relationshipExpectationMode ? "Optional" : "Medium impact",
      actionTier: relationshipExpectationMode ? 3 : 2,
    };
  }
  if (id === "create-repurchase-campaign") {
    return {
      ...common,
      proposedChange: "Plan a measured repurchase reminder for customers whose cohort behavior shows same-product repeat purchase potential.",
      shopifyField: "Lifecycle marketing workflow",
      expectedImpact: "Increase same-product repurchase and repeat revenue without changing Product Risk.",
      applicationRisk: "Low",
      approval: "Manual setup required",
      priorityGroup: "Retention opportunity",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "create-retention-cross-sell-campaign") {
    return {
      ...common,
      proposedChange: `Plan a lifecycle cross-sell that suggests ${payload.relatedProductTitle || "the related product"} after this product.`,
      shopifyField: "Lifecycle marketing workflow",
      expectedImpact: "Increase follow-on product revenue from an observed retention path while monitoring post-purchase friction.",
      applicationRisk: "Low",
      approval: "Manual setup required",
      priorityGroup: "Retention opportunity",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "test-retention-bundle-offer") {
    return {
      ...common,
      proposedChange: `Test a bundle or frequently-bought-together offer with ${payload.relatedProductTitle || "the related product"}.`,
      shopifyField: "Merchandising / lifecycle workflow",
      expectedImpact: "Increase attach rate and LTV from a retention-supported pairing without forcing a permanent bundle.",
      applicationRisk: "Medium",
      approval: "Manual setup required",
      priorityGroup: "Retention opportunity",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "review-retention-drop") {
    return {
      ...common,
      proposedChange: "Review retention cohorts, repeat timing, LTV delta, and buyer segments before launching growth campaigns.",
      shopifyField: "ProductPulse retention workflow",
      expectedImpact: "Avoid amplifying weak retention until the cause is understood.",
      applicationRisk: "Low",
      approval: "Manual verification required",
      priorityGroup: "Suggested action",
      impactLevel: "Optional",
      actionTier: 3,
    };
  }
  if (id === "correct-variant-options") {
    return {
      ...common,
      proposedChange: "Review and correct unclear option names, variant labels, or affected SKU presentation.",
      shopifyField: "Product options and ProductVariant option values",
      expectedImpact: "Reduce wrong variant selection and focus remediation on the affected scope.",
      applicationRisk: "Medium",
      approval: "Manual approval required",
      priorityGroup: "High-impact product fix",
      impactLevel: "High impact",
      actionTier: 1,
    };
  }
  if (id === "review-product-pricing") {
    return {
      ...common,
      proposedChange: "Review variant prices and compare-at prices against value-perception evidence.",
      shopifyField: "ProductVariant.price and ProductVariant.compareAtPrice",
      expectedImpact: `Reduce value mismatch risk while protecting ${formatMoney(metrics.marginAtRisk || 0)} margin exposure.`,
      applicationRisk: "High",
      approval: "Manual approval required",
      priorityGroup: "High-impact product fix",
      impactLevel: "High impact",
      actionTier: 1,
    };
  }
  if (id === "set-product-draft") {
    return {
      ...common,
      proposedChange: "Set the Shopify product status to DRAFT while the team reviews the issue.",
      shopifyField: "Product.status",
      expectedImpact: "Temporarily stop the product from continuing to create customer-facing risk.",
      applicationRisk: "High",
      approval: "Manual approval required",
      priorityGroup: "High-impact product fix",
      impactLevel: "High impact",
      actionTier: 1,
    };
  }
  if (id === "limit-variant-inventory") {
    return {
      ...common,
      proposedChange: "Review inventory availability for the affected variant before holding or reducing sellable stock.",
      shopifyField: "InventoryLevel quantities",
      expectedImpact: "Limit exposure while preserving unaffected variants.",
      applicationRisk: "High",
      approval: "Manual approval required",
      priorityGroup: "High-impact product fix",
      impactLevel: "High impact",
      actionTier: 1,
    };
  }
  if (id === "apply-risk-tags") {
    return {
      ...common,
      proposedChange: `Add internal Shopify tags: ${(payload.tags || []).join(", ")}.`,
      shopifyField: "Product.tags",
      expectedImpact: "Make the product discoverable in internal workflows and automated collections.",
      applicationRisk: "Low",
      priorityGroup: "Optional workflow",
      impactLevel: "Optional",
      actionTier: 3,
    };
  }
  if (id === "move-to-review-collection") {
    return {
      ...common,
      proposedChange: `Review whether this product belongs in the internal "${payload.collectionName || "ProductPulse Needs Review"}" workflow or should get an internal review tag.`,
      shopifyField: "Internal workflow routing",
      expectedImpact: "Keep products with meaningful evidence visible for merchandising, QA or operations follow-up without changing shopper-facing content.",
      applicationRisk: "Low",
      approval: "Manual approval required",
      priorityGroup: "Internal workflow",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "add-to-related-product-collection") {
    return {
      ...common,
      proposedChange: `Add this product to the existing "${payload.collectionName || "related"}" collection.`,
      shopifyField: "Collection membership",
      expectedImpact: "Place an uncollected product near related catalog items that customers already buy together or in sequence.",
      applicationRisk: "Low",
      approval: payload.collectionId ? "Review required before applying" : "Manual approval required",
      priorityGroup: "Merchandising insight",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "improve-product-media") {
    const updates = Array.isArray(payload.mediaUpdates) ? payload.mediaUpdates : [];
    const proposedChange = updates.length
      ? `Update alt text for ${updates.length === 1 ? updates[0]?.targetLabel || "one product media item" : `${updates.length} product media items`}. Recommended image brief: ${payload.imageBrief || "make scale, material, color and format clear."}`
      : "Add image guidance, improve alt text, or review media order for clearer shopper expectations.";
    return {
      ...common,
      proposedChange,
      shopifyField: updates.length ? "Product media alt text" : "Product media and alt text",
      expectedImpact: "Reduce visual expectation mismatch and improve PDP clarity.",
      applicationRisk: updates.length ? "Low" : "Medium",
      approval: updates.length ? "Review required before applying" : "Manual approval required",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "reorder-product-media") {
    return {
      ...common,
      proposedChange: "Move the clearest scale, format, color or context media earlier in the product gallery.",
      shopifyField: "Product media order",
      expectedImpact: "Help shoppers understand the product visually before they read detailed copy.",
      applicationRisk: "Medium",
      approval: "Manual approval required",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "add-contextual-media-recommendation") {
    return {
      ...common,
      proposedChange: payload.imageBrief || "Add a contextual product image that shows scale, material, packaging, color or real use.",
      shopifyField: "Product media",
      expectedImpact: "Reduce visual surprise and expectation mismatch before purchase.",
      applicationRisk: "Medium",
      approval: "Manual approval required",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "update-product-classification") {
    const proposedFields = [
      payload.draftProductType ? "product type" : "",
      payload.draftCategoryId ? "Shopify category" : "",
      payload.draftVendor ? "vendor" : "",
    ].filter(Boolean).join(", ");
    return {
      ...common,
      proposedChange: proposedFields
        ? `Review and update ${proposedFields}.`
        : "Review and update product type, vendor or Shopify category classification.",
      shopifyField: payload.draftCategoryId
        ? "Product.category, Product.productType or Product.vendor"
        : "Product.productType, Product.vendor or category",
      expectedImpact: "Improve catalog reporting, filters, automatic collections and operational routing.",
      applicationRisk: "Medium",
      approval: payload.draftVendor || payload.draftProductType || payload.draftCategoryId ? "Review required before applying" : "Manual approval required",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "add-structured-metafields") {
    return {
      ...common,
      proposedChange: "Save ProductPulse risk, QA or content notes as structured product metafields.",
      shopifyField: "Product metafields",
      expectedImpact: "Make diagnosis context reusable in themes, workflows and reporting.",
      applicationRisk: "Low",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "switch-product-template") {
    return {
      ...common,
      proposedChange: `Switch this product to the "${payload.templateSuffix || "productpulse-guidance"}" product template after theme review.`,
      shopifyField: "Product.templateSuffix",
      expectedImpact: "Give this product a layout that can display FAQ, specs or warnings more clearly.",
      applicationRisk: "Medium",
      approval: "Manual approval required",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "copy-support-note") {
    return {
      ...common,
      proposedChange: "Create an internal support note or macro.",
      shopifyField: "Internal support workflow",
      expectedImpact: "Help support answer repeated product questions consistently.",
      applicationRisk: "Low",
      priorityGroup: "Optional workflow",
      impactLevel: "Optional",
      actionTier: 3,
    };
  }
  if (id === "recommend-qa-review") {
    return {
      ...common,
      proposedChange: "Send this product to supplier, QA or merchandising review with the captured evidence.",
      shopifyField: "Operational QA workflow",
      expectedImpact: "Address potential physical, supplier or durability issues outside the PDP.",
      applicationRisk: "Low",
      approval: "Manual approval required",
      priorityGroup: "High-impact product fix",
      impactLevel: "High impact",
      actionTier: 1,
    };
  }
  if (id === "fix-source-review-mismatch") {
    return {
      ...common,
      proposedChange: "Verify whether reviews, returns, CSV rows or feed data are attached to the wrong product, SKU or variant.",
      shopifyField: "Evidence source integrity",
      expectedImpact: "Prevent the merchant from changing the wrong product based on mismatched evidence.",
      applicationRisk: "Low",
      approval: "Manual verification required",
      priorityGroup: "High-impact product fix",
      impactLevel: "High impact",
      actionTier: 1,
    };
  }
  if (id === "add-workflow-tags") {
    return {
      ...common,
      proposedChange: `Add workflow tags: ${(payload.tags || []).join(", ")}.`,
      shopifyField: "Product.tags",
      expectedImpact: "Route the product into team workflows without changing customer-facing copy.",
      applicationRisk: "Low",
      priorityGroup: "Optional workflow",
      impactLevel: "Optional",
      actionTier: 3,
    };
  }
  if (id === "connect-missing-source") {
    return {
      ...common,
      proposedChange: `Connect or enable missing source coverage: ${(payload.missingSources || []).join(", ") || "missing sources"}.`,
      shopifyField: "ProductPulse evidence coverage",
      expectedImpact: "Increase diagnosis confidence before taking bigger product changes.",
      applicationRisk: "Low",
      approval: "Manual setup required",
      priorityGroup: "Optional workflow",
      impactLevel: "Optional",
      actionTier: 3,
    };
  }
  if (id === "improve-monitoring-coverage") {
    return {
      ...common,
      proposedChange: "Improve monitoring coverage for a commercially important product.",
      shopifyField: "ProductPulse monitoring workflow",
      expectedImpact: "Catch risk changes earlier for products that matter commercially.",
      applicationRisk: "Low",
      approval: "Manual setup required",
      priorityGroup: "Optional workflow",
      impactLevel: "Optional",
      actionTier: 3,
    };
  }
  if (id === "create-baseline-scan") {
    return {
      ...common,
      proposedChange: "Create a baseline scan so future changes can be compared against a clean starting point.",
      shopifyField: "ProductPulse diagnosis history",
      expectedImpact: "Make future risk and momentum changes easier to detect.",
      applicationRisk: "Low",
      priorityGroup: "Optional workflow",
      impactLevel: "Optional",
      actionTier: 3,
    };
  }
  if (id === "add-to-watchlist") {
    return {
      ...common,
      proposedChange: "Add this product to the Watchlist for periodic Product Diagnosis.",
      shopifyField: "ProductPulse Watchlist",
      expectedImpact: "Monitor commercially important products before small issues grow.",
      applicationRisk: "Low",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  if (id === "run-full-diagnosis") {
    return {
      ...common,
      proposedChange: "Run or re-run the full product diagnosis.",
      shopifyField: "ProductPulse diagnosis job",
      expectedImpact: "Refresh diagnosis confidence for important or stale products.",
      applicationRisk: "Low",
      priorityGroup: "Medium-impact catalog fix",
      impactLevel: "Medium impact",
      actionTier: 2,
    };
  }
  return common;
}

function buildSuggestedProductTitle(product = {}, mainIssue = "") {
  const current = String(product.title || "").trim();
  if (current && !isGenericProductTitle(current)) return current;
  const parts = [
    product.vendor,
    product.productType,
    getHumanIssueLabel(mainIssue) !== "Product quality" ? getHumanIssueLabel(mainIssue) : "",
  ].filter(Boolean);
  return parts.length ? uniqueBy(parts, normalizeText).join(" ") : current || "Clarified product title";
}

function buildSuggestedSeoTitle({ product = {}, snapshot = {}, mainIssue = "", aiTitle = "" } = {}) {
  const base = normalizeSuggestedTitle(aiTitle || product.title || snapshot.productTitle || buildSuggestedProductTitle(product, mainIssue));
  const vendor = String(product.vendor || "").trim();
  const withVendor = vendor && !normalizeText(base).includes(normalizeText(vendor)) ? `${base} | ${vendor}` : base;
  return limitSeoText(normalizeSuggestedTitle(withVendor), SEO_TITLE_MAX_LENGTH);
}

function buildSuggestedMetaDescription({ product = {}, snapshot = {}, mainIssue = "", aiDescription = "" } = {}) {
  const title = String(product.title || snapshot.productTitle || "This product").trim();
  const description = stripHtml(product.description || product.descriptionHtml || "").replace(/\s+/g, " ").trim();
  const issueLabel = getHumanIssueLabel(mainIssue).toLowerCase();
  const base = aiDescription || description || `${title} with clear product details, specifications, included items and expectation-setting guidance for shoppers.`;
  const prefix = base.toLowerCase().startsWith(title.toLowerCase()) ? base : `${title}: ${base}`;
  const suffix = issueLabel && !["product quality", "no issue"].includes(issueLabel) ? ` Includes guidance around ${issueLabel}.` : "";
  return limitSeoText(`${prefix}${suffix}`, SEO_META_DESCRIPTION_MAX_LENGTH, { terminalPeriod: true });
}

function buildSuggestedProductHandle({ product = {}, snapshot = {} } = {}) {
  const source = String(product.title || snapshot.productTitle || product.handle || snapshot.handle || "product").trim();
  const handle = normalizeText(source)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 80);
  return handle || String(product.handle || snapshot.handle || "product").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
}

function buildVariantOptionUpdateSuggestions({ product = {}, affectedVariants = [], variantDetails = [] } = {}) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (!variants.length) return [];

  const affectedLabels = uniqueBy([
    ...affectedVariants,
    ...variantDetails.map((item) => item.label || item.title || item.sku || ""),
  ].map((value) => String(value || "").trim()).filter(Boolean), normalizeText);
  const affectedSet = new Set(affectedLabels.map(normalizeText));
  const targetVariants = variants
    .filter((variant) => {
      if (!affectedSet.size) return isGenericVariantTitle(variant.title);
      return affectedSet.has(normalizeText(variant.title))
        || affectedSet.has(normalizeText(variant.sku))
        || (Array.isArray(variant.selectedOptions) && variant.selectedOptions.some((option) => affectedSet.has(normalizeText(option.value))));
    })
    .slice(0, 4);

  return targetVariants
    .map((variant) => buildVariantOptionUpdateSuggestion(variant, { product }))
    .filter(Boolean);
}

function buildVariantOptionUpdateSuggestion(variant = {}, { product = {} } = {}) {
  const selectedOptions = Array.isArray(variant.selectedOptions) ? variant.selectedOptions : [];
  const optionValues = selectedOptions
    .map((option) => {
      const optionName = String(option.name || "").trim();
      const currentValue = String(option.value || "").trim();
      const suggestedValue = buildSuggestedVariantOptionValue({ optionName, currentValue, variant, product });
      if (!optionName || !suggestedValue || suggestedValue === currentValue) return null;
      return { optionName, currentValue, suggestedValue };
    })
    .filter(Boolean);
  const suggestedLabel = optionValues.length
    ? optionValues.map((option) => option.suggestedValue).join(" / ")
    : buildSuggestedVariantLabel({ variant, product });
  if (!variant.id || (!optionValues.length && suggestedLabel === variant.title)) return null;
  return {
    variantId: variant.id,
    variantTitle: variant.title || "",
    sku: variant.sku || "",
    currentLabel: variant.title || variant.sku || "Variant",
    suggestedLabel,
    optionValues,
  };
}

function buildSuggestedVariantOptionValue({ optionName = "", currentValue = "", variant = {}, product = {} } = {}) {
  const normalizedValue = String(currentValue || "").trim();
  const normalizedOption = String(optionName || "").trim();
  if (!normalizedValue || /^default title$/i.test(normalizedValue)) {
    return buildSuggestedVariantLabel({ variant, product });
  }
  if (/^(one size|default)$/i.test(normalizedValue) && product.productType) {
    return `${normalizedValue} ${product.productType}`.replace(/\s+/g, " ").trim();
  }
  if (/^(color|colour)$/i.test(normalizedOption) && product.title && !normalizeText(product.title).includes(normalizeText(normalizedValue))) {
    return normalizedValue;
  }
  return normalizedValue;
}

function buildSuggestedVariantLabel({ variant = {}, product = {} } = {}) {
  const selectedOptions = Array.isArray(variant.selectedOptions) ? variant.selectedOptions : [];
  const currentValues = selectedOptions.map((option) => option.value).filter((value) => value && !/^default title$/i.test(value));
  if (currentValues.length) return currentValues.join(" / ");
  const firstOptionName = String(selectedOptions[0]?.name || product.options?.[0]?.name || "").toLowerCase();
  if (firstOptionName.includes("size")) return "One size";
  if (firstOptionName.includes("color") || firstOptionName.includes("colour")) return "Standard color";
  return "Standard";
}

function isGenericVariantTitle(value = "") {
  return /^default title$/i.test(String(value || "").trim());
}

function buildSpecsDetailsBlock({ product = {}, contentIssues = [], mainIssue = "", deterministic = {}, aiSpecsBlock = "" } = {}) {
  const normalizedAiBlock = normalizeSpecsDetailsBlock(aiSpecsBlock);
  if (normalizedAiBlock) return normalizedAiBlock;

  const context = buildSpecsDetailsContext({ product, contentIssues, mainIssue, deterministic });
  const items = buildTechnicalSpecItems(context);
  return [
    "Technical details to confirm before buying:",
    ...items.map((item) => `- ${item.label}: ${item.detail}`),
  ].join("\n");
}

function normalizeSpecsDetailsBlock(value = "") {
  const text = String(value || "").replace(/\r\n?/g, "\n").trim();
  if (!text) return "";
  const normalized = normalizeText(text);
  const metadataOnly = [
    "product type",
    "brand vendor",
    "available options",
    "variants skus",
  ].filter((needle) => normalized.includes(needle)).length >= 3;
  const hasTechnicalDetail = /\b(voltage|capacity|dimension|height|width|length|weight|temperature|timer|alarm|power|battery|material|care|compatib|clean|water|humidity|condensation|range|included|limit|setup|firmware|connectivity|size chart|loft|seal|leak|heat|brew)\b/i.test(text);
  if (metadataOnly && !hasTechnicalDetail) return "";
  return text;
}

function buildSpecsDetailsContext({ product = {}, contentIssues = [], mainIssue = "", deterministic = {} } = {}) {
  const metrics = deterministic.metrics || {};
  const sourceText = [
    product.title,
    product.productType,
    product.description,
    stripHtml(product.descriptionHtml || ""),
    ...(Array.isArray(product.tags) ? product.tags : []),
    ...(Array.isArray(product.collections) ? product.collections : []),
    getHumanIssueLabel(mainIssue),
    ...contentIssues.flatMap((issue) => [issue.code, issue.label, issue.evidence]),
    ...(Array.isArray(deterministic.evidenceSnippets) ? deterministic.evidenceSnippets : []).map((item) => item.text || item.body || item.quote || item.summary || ""),
    ...(Array.isArray(metrics.topReturnReasonDetails) ? metrics.topReturnReasonDetails : []).map((item) => `${item.label || ""} ${item.detail || ""}`),
    ...(Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : []),
    ...(Array.isArray(metrics.textInsights?.repeatedLanguage) ? metrics.textInsights.repeatedLanguage : []).map((item) => `${item.term || item.label || item.phrase || ""}`),
  ].filter(Boolean).join(" ");
  const variants = Array.isArray(product.variants) ? product.variants : [];
  return {
    product,
    mainIssue: normalizeIssueCode(mainIssue),
    text: sourceText,
    normalizedText: normalizeText(sourceText),
    variantLabels: uniqueBy(
      variants.map((variant) => String(variant.title || variant.sku || "").trim()).filter(Boolean),
      normalizeText,
    ).slice(0, 4),
  };
}

function buildTechnicalSpecItems(context = {}) {
  const text = context.normalizedText || "";
  const issue = context.mainIssue || "";
  let items = [];

  if (isApparelSpecsContext(context) || issue === "fit_sizing") {
    items = [
      ["Fit measurements", "[confirm chest, shoulder, sleeve, body length, and finished garment measurements by size]"],
      ["Layering guidance", "[confirm whether the style is intended for tees, thin knits, sweatshirts, or outerwear layering]"],
      ["Material composition", "[confirm fabric blend, handfeel, stretch, and whether it may shrink]"],
      ["Care instructions", "[confirm wash, dry, ironing/steaming, and shrinkage guidance]"],
      ["Packability details", "[confirm how the garment packs, pocket location, and packed dimensions if relevant]"],
    ];
  } else if (/\b(kettle|electric kettle|steam kettle|foldaway kettle)\b/.test(text)) {
    items = [
      ["Capacity and fill limits", "[confirm total capacity, MIN fill line, and maximum safe fill level]"],
      ["Power input", "[confirm voltage, plug type, wattage, and whether converters/adapters are supported]"],
      ["Steam clearance", "[confirm required overhead/side clearance and surfaces to avoid]"],
      ["Materials and heated base", "[confirm food-contact materials, base construction, and silicone/body care]"],
      ["Cleaning and folded storage", "[confirm cleaning method, drying steps, and travel/storage limits]"],
    ];
  } else if (/\b(photo light|light panel|backlit|magnetic panel|photo panel|glossy print|wall panel|adhesive tab)\b/.test(text)) {
    items = [
      ["Visible size and print fit", "[confirm panel dimensions, visible image area, and supported print/card size]"],
      ["Included items", "[confirm whether prints, art cards, stand foot, adhesive tabs, cable, or adapter are included]"],
      ["Power and light modes", "[confirm power source, brightness/mode behavior, and expected warm/cool color shift]"],
      ["Mounting surfaces", "[confirm approved surfaces, texture limits, cure time, and tabletop fallback]"],
      ["Finish and reflection guidance", "[confirm how glossy/matte prints, white borders, and room lighting may affect appearance]"],
    ];
  } else if (/\b(coffee|brew|brewer|alarm clock|small appliance|appliance|heater)\b/.test(text)) {
    items = [
      ["Power input", "[confirm voltage, plug type, and whether an adapter is required]"],
      ["Brew capacity", "[confirm water tank capacity and maximum cup size]"],
      ["Brew temperature range", "[confirm target brew temperature or safe operating range]"],
      ["Timer and alarm behavior", "[confirm scheduling accuracy, alarm volume, backup behavior, and what happens after power loss]"],
      ["Water and condensation guidance", "[confirm required surface, clearance, and expected condensation or humidity]"],
      ["Cleaning and removable parts", "[confirm which tank, tray, filter, or cup components are washable]"],
    ];
  } else if (/\b(pillow|bedding|cooling|loft|sleep|insert)\b/.test(text)) {
    items = [
      ["Dimensions and loft", "[confirm length, width, height/loft, and whether loft varies by option]"],
      ["Cooling insert details", "[confirm insert material, expected cooling duration, and whether it should be aired out before use]"],
      ["Cover material and care", "[confirm cover fabric, wash instructions, and insert cleaning limits]"],
      ["Comfort guidance", "[confirm which sleep positions each loft is intended for]"],
      ["Odor or airing guidance", "[confirm any first-use airing instructions]"],
    ];
  } else if (/\b(inflatable|standing desk|desk|furniture|riser|pump)\b/.test(text)) {
    items = [
      ["Inflated dimensions", "[confirm height, width, depth, and usable work surface]"],
      ["Maximum supported weight", "[confirm safe laptop/monitor weight limit]"],
      ["Inflation and deflation", "[confirm pump type, inflation time, and pressure guidance]"],
      ["Stability limits", "[confirm approved surfaces, typing limits, and items not recommended for use]"],
      ["Packed size and included items", "[confirm packed dimensions and whether pump/patch kit are included]"],
    ];
  } else if (/\b(safe|lock|security|voice|keypad)\b/.test(text)) {
    items = [
      ["Unlock methods", "[confirm voice, keypad, key, app, or backup access methods]"],
      ["Voice setup requirements", "[confirm training steps, quiet-room requirement, and supported languages/phrases]"],
      ["Power and battery", "[confirm battery type, expected battery life, and low-battery behavior]"],
      ["Interior dimensions", "[confirm usable internal height, width, depth, and shelf layout]"],
      ["Security limits", "[confirm false-open protections, reset process, and emergency access]"],
    ];
  } else if (/\b(luggage|tag|tracking|qr|bluetooth|gps|travel)\b/.test(text)) {
    items = [
      ["Tracking method", "[confirm whether updates are GPS, Bluetooth, QR scan-based, or network-assisted]"],
      ["Compatibility", "[confirm supported phones, operating systems, and app/account requirements]"],
      ["Battery", "[confirm battery type, battery life, and replacement or charging steps]"],
      ["QR privacy controls", "[confirm which owner details are visible after scan and how to edit them]"],
      ["Range and limitations", "[confirm Bluetooth range, delayed-update behavior, and travel limitations]"],
    ];
  } else if (/\b(mat|yoga|fitness|cushion|balance|thick|firm)\b/.test(text)) {
    items = [
      ["Dimensions", "[confirm length, width, thickness, and weight]"],
      ["Firmness level", "[confirm cushion/firmness rating and intended workout style]"],
      ["Material and grip", "[confirm surface material, underside grip, and floor compatibility]"],
      ["Care", "[confirm cleaning method and drying guidance]"],
      ["Use limits", "[confirm whether this is recommended for balance poses or floor work only]"],
    ];
  } else if (/\b(mug|drinkware|lid|leak|seal|insulated|bottle)\b/.test(text)) {
    items = [
      ["Capacity", "[confirm fluid capacity]"],
      ["Lid and seal limits", "[confirm whether the lid is leakproof, splash-resistant, or upright-only]"],
      ["Temperature retention", "[confirm hot/cold retention window]"],
      ["Cleaning", "[confirm dishwasher safety and removable seal care]"],
      ["Bag-use guidance", "[confirm whether it is safe for bags or near electronics]"],
    ];
  } else if (/\b(earbud|bluetooth|electronics|battery|charging|case)\b/.test(text)) {
    items = [
      ["Battery life", "[confirm earbud and case battery life]"],
      ["Charging", "[confirm cable type, charge time, and included accessories]"],
      ["Connectivity", "[confirm Bluetooth version and supported devices]"],
      ["Fit and included tips", "[confirm included tip sizes or fit accessories]"],
      ["Variant appearance", "[confirm real-life color/material differences by variant]"],
    ];
  } else if (/\b(ceramic|dinner|plate|bowl|kitchen|dishwasher|fragile)\b/.test(text)) {
    items = [
      ["Pieces included", "[confirm exact plate, bowl, and serving-piece count]"],
      ["Dimensions", "[confirm plate and bowl diameters/capacity]"],
      ["Material and finish", "[confirm ceramic type, glaze variation, and finish notes]"],
      ["Care", "[confirm dishwasher, microwave, and oven safety]"],
      ["Packaging and arrival check", "[confirm protective packaging and what to do if an item arrives damaged]"],
    ];
  } else if (/\b(planter|wifi|wi-fi|app|garden|seed|led)\b/.test(text)) {
    items = [
      ["Compatibility", "[confirm Wi-Fi band, app language, phone OS, and account requirements]"],
      ["Power", "[confirm plug type, voltage, and cord length]"],
      ["Dimensions", "[confirm counter footprint and grow-light height]"],
      ["Included items", "[confirm seed pods, accessories, and replacement parts]"],
      ["Setup guidance", "[confirm router/app setup steps before first use]"],
    ];
  } else if (/\b(print|art|wall|frame|poster|canvas)\b/.test(text)) {
    items = [
      ["Dimensions", "[confirm print size and visible image area]"],
      ["Material and finish", "[confirm paper/canvas material, matte/gloss finish, and color tone]"],
      ["Frame", "[confirm whether a frame, hanger, or mounting hardware is included]"],
      ["Room context", "[confirm lighting, scale, and visual mood guidance]"],
      ["Shipping format", "[confirm rolled, flat, or framed shipping format]"],
    ];
  } else {
    items = [
      ["Dimensions or size", "[confirm product dimensions, weight, and size guidance]"],
      ["Materials or components", "[confirm materials, included parts, and replacement components]"],
      ["Compatibility or setup", "[confirm requirements, supported use cases, and setup steps]"],
      ["Care or maintenance", "[confirm cleaning, storage, and maintenance guidance]"],
      ["Use limits", "[confirm safety limits, product boundaries, and expectation-setting details]"],
    ];
  }

  const issueItem = buildIssueSpecificSpecItem(context);
  if (issueItem) items.splice(Math.min(3, items.length), 0, issueItem);
  const variantItem = buildVariantSpecificSpecItem(context);
  if (variantItem) items.push(variantItem);
  return dedupeSpecItems(items).slice(0, 8).map(([label, detail]) => ({ label, detail }));
}

function buildIssueSpecificSpecItem(context = {}) {
  const text = context.normalizedText || "";
  if (isApparelSpecsContext(context) && /\b(layer|layering|sweatshirt|shoulder|upper arm|sleeve|broad shoulder)\b/.test(text)) {
    return ["Layering fit check", "[confirm body measurements vs finished garment measurements for shoulders, sleeves, and upper-arm room]"];
  }
  if (/\b(condensation|humidity|wet|water ring|nightstand|surface)\b/.test(text)) {
    return ["Moisture guidance", "[confirm expected condensation, clearance, and safe surface requirements]"];
  }
  if (/\b(clock|timer|alarm|schedule|early|late|drift|firmware)\b/.test(text)) {
    return ["Timing accuracy", "[confirm timer tolerance, firmware/reset steps, and alarm fallback behavior]"];
  }
  if (/\b(leak|seal|drip|spill)\b/.test(text)) {
    return ["Leak or seal limit", "[confirm exact leakproof/splash-resistant claim and testing conditions]"];
  }
  if (/\b(odor|smell|chemical|air out|airing)\b/.test(text)) {
    return ["First-use airing", "[confirm expected odor, airing time, and when a customer should contact support]"];
  }
  if (/\b(wobble|unstable|tilt|sliding|deflat|air loss)\b/.test(text)) {
    return ["Stability test", "[confirm stability standard, safe weight, and pressure-loss tolerance]"];
  }
  if (/\b(privacy|qr|location|gps|tracking)\b/.test(text)) {
    return ["Privacy and tracking limits", "[confirm visible profile fields, update source, and non-GPS limitations]"];
  }
  if (/\b(voice|false open|lockout|battery drain)\b/.test(text)) {
    return ["Voice-lock safeguards", "[confirm false-open protections, lockout/reset flow, and battery-drain expectations]"];
  }
  return null;
}

function buildVariantSpecificSpecItem(context = {}) {
  if (!context.variantLabels?.length) return null;
  const text = context.normalizedText || "";
  let detail = `[confirm whether ${context.variantLabels.join(", ")} differ in specs, setup, finish, capacity, care, or limitations]`;
  if (isApparelSpecsContext(context)) {
    detail = `[confirm whether ${context.variantLabels.join(", ")} differ in fit, finished measurements, color appearance, fabric handfeel, care, or shrinkage guidance]`;
  } else if (/\b(kettle|electric kettle|steam kettle|foldaway kettle)\b/.test(text)) {
    detail = `[confirm whether ${context.variantLabels.join(", ")} differ in capacity, voltage, finish, lid/base setup, care, or use limits]`;
  } else if (/\b(photo light|light panel|backlit|magnetic panel|photo panel|glossy print|wall panel|adhesive tab)\b/.test(text)) {
    detail = `[confirm whether ${context.variantLabels.join(", ")} differ in finish, lighting appearance, included items, mounting method, or visible dimensions]`;
  } else if (/\b(safe|lock|security|voice|keypad)\b/.test(text)) {
    detail = `[confirm whether ${context.variantLabels.join(", ")} differ in finish, unlock setup, battery behavior, interior layout, or security limits]`;
  }
  return [
    "Variant-specific details",
    detail,
  ];
}

function isApparelSpecsContext(context = {}) {
  const text = context.normalizedText || "";
  return /\b(shirt|overshirt|apparel|garment|linen|jacket|coat|fit|size|sizing|sleeve|shoulder|upper arm|chest measurement|body measurement)\b/.test(text);
}

function dedupeSpecItems(items = []) {
  return uniqueBy(
    items.filter((item) => Array.isArray(item) && item[0] && item[1]),
    (item) => normalizeText(item[0]),
  );
}

function buildProductClassificationDraft({ product = {}, mainIssue = "", existingProductTypes = [], categorySuggestions = [] } = {}) {
  const title = String(product.title || "").trim();
  const categories = detectProductCategoryGroups([
    title,
    product.description,
    ...(Array.isArray(product.tags) ? product.tags : []),
    ...(Array.isArray(product.collections) ? product.collections : []),
  ].join(" "));
  const [category] = [...categories];
  const currentProductType = String(product.productType || "").replace(/\s+/g, " ").trim();
  const currentCategory = normalizeProductCategory(product.category);
  const matchedProductType = chooseCatalogProductType({
    product,
    category,
    mainIssue,
    existingProductTypes,
  });
  const matchedCategory = !currentCategory.id ? chooseProductCategorySuggestion({ product, categorySuggestions }) : null;
  const draftProductType = !currentProductType
    ? matchedProductType
    : isWeakProductType(currentProductType) && matchedProductType && normalizeText(matchedProductType) !== normalizeText(currentProductType)
    ? matchedProductType
    : "";
  return {
    draftVendor: "",
    draftProductType: draftProductType || "",
    draftCategory: matchedCategory?.fullName || matchedCategory?.name || category || "",
    draftCategoryId: matchedCategory?.id || "",
    draftCategoryName: matchedCategory?.name || "",
    draftCategoryFullName: matchedCategory?.fullName || "",
    currentCategoryId: currentCategory.id,
    currentCategoryName: currentCategory.name,
    currentCategoryFullName: currentCategory.fullName,
    classificationSource: draftProductType ? "store_existing_product_type" : "",
    categorySource: matchedCategory?.source || "",
    productTypeOptions: (Array.isArray(existingProductTypes) ? existingProductTypes : [])
      .map((value) => String(value || "").replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, 8),
    categoryOptions: (Array.isArray(categorySuggestions) ? categorySuggestions : [])
      .map(normalizeProductCategory)
      .filter((item) => item.id)
      .slice(0, 5),
  };
}

function hasProductClassificationDraftChange(classificationDraft = {}, product = {}) {
  const currentVendor = String(product.vendor || "").replace(/\s+/g, " ").trim();
  const currentProductType = String(product.productType || "").replace(/\s+/g, " ").trim();
  const currentCategory = normalizeProductCategory(product.category);
  const draftVendor = String(classificationDraft.draftVendor || "").replace(/\s+/g, " ").trim();
  const draftProductType = String(classificationDraft.draftProductType || "").replace(/\s+/g, " ").trim();
  const draftCategoryId = String(classificationDraft.draftCategoryId || "").trim();
  return Boolean(
    draftVendor && normalizeText(draftVendor) !== normalizeText(currentVendor)
    || draftProductType && normalizeText(draftProductType) !== normalizeText(currentProductType)
    || draftCategoryId && draftCategoryId !== currentCategory.id,
  );
}

function isWeakProductType(value = "") {
  const normalized = normalizeText(value);
  return !normalized || [
    "product",
    "products",
    "item",
    "items",
    "general",
    "misc",
    "miscellaneous",
    "uncategorized",
    "other",
    "default",
  ].includes(normalized) || normalized.length <= 2;
}

function chooseCatalogProductType({ product = {}, category = "", mainIssue = "", existingProductTypes = [] } = {}) {
  const options = uniqueBy(
    (Array.isArray(existingProductTypes) ? existingProductTypes : [])
      .map((value) => String(value || "").replace(/\s+/g, " ").trim())
      .filter(Boolean),
    (value) => normalizeText(value),
  );
  if (!options.length) return "";

  const productText = [
    product.title,
    product.description,
    ...(Array.isArray(product.tags) ? product.tags : []),
    ...(Array.isArray(product.collections) ? product.collections : []),
    category,
    mainIssue,
  ].filter(Boolean).join(" ");
  const productTokens = new Set(meaningfulTokens(productText));
  const categoryGroups = new Set([
    category,
    ...detectProductCategoryGroups(productText),
  ].filter(Boolean));
  const fallbackType = getProductTypeFromCategory(category, mainIssue);

  const scored = options
    .filter((option) => normalizeText(option) !== normalizeText(product.productType))
    .map((option) => {
      const optionTokens = meaningfulTokens(option);
      const optionGroups = detectProductCategoryGroups(option);
      const sharedTokens = optionTokens.filter((token) => productTokens.has(token)).length;
      const groupOverlap = [...optionGroups].filter((group) => categoryGroups.has(group)).length;
      const directTextMatch = normalizeText(productText).includes(normalizeText(option));
      const fallbackMatch = fallbackType && normalizeText(option).includes(normalizeText(fallbackType));
      const score = (directTextMatch ? 8 : 0)
        + (groupOverlap * 6)
        + (sharedTokens * 3)
        + (fallbackMatch ? 4 : 0);
      return { option, score };
    })
    .filter((item) => item.score >= 3)
    .sort((first, second) => second.score - first.score || first.option.length - second.option.length || first.option.localeCompare(second.option));

  return scored[0]?.option || "";
}

function chooseProductCategorySuggestion({ product = {}, categorySuggestions = [] } = {}) {
  const options = (Array.isArray(categorySuggestions) ? categorySuggestions : [])
    .map(normalizeProductCategory)
    .filter((category) => category.id && !category.isArchived);
  if (!options.length) return null;
  return rankProductTaxonomyCategories(options, product)[0] || null;
}

function getProductTypeFromCategory(category = "", mainIssue = "") {
  if (category === "apparel") return "Apparel";
  if (category === "toy") return "Toys & Games";
  if (category === "art") return "Art & Decor";
  if (category === "electronics") return "Electronics";
  if (category === "beauty") return "Beauty";
  if (category === "home") return "Home";
  if (category === "food") return "Food & Beverage";
  const issue = normalizeIssueCode(mainIssue);
  if (issue === "fit_sizing") return "Apparel";
  if (issue === "compatibility") return "Electronics";
  return "";
}

function buildStructuredMetafieldRecommendations({ deterministic = {}, mainIssue = "" } = {}) {
  const metrics = deterministic.metrics || {};
  const issue = normalizeIssueCode(mainIssue || deterministic.mainIssue);
  const riskLevel = Number(deterministic.riskScore || 0) >= 75 ? "high" : Number(deterministic.riskScore || 0) >= 55 ? "medium" : "low";
  return [
    {
      namespace: "productpulse",
      key: "risk_level",
      type: "single_line_text_field",
      value: riskLevel,
    },
    {
      namespace: "productpulse",
      key: "main_issue",
      type: "single_line_text_field",
      value: issue || "none",
    },
    {
      namespace: "productpulse",
      key: "diagnosis_summary",
      type: "json",
      value: JSON.stringify({
        riskScore: deterministic.riskScore || 0,
        confidence: deterministic.confidence || 0,
        returnRate: metrics.returnRate || 0,
        refundRate: metrics.refundRate || 0,
        issue,
      }),
    },
  ];
}

function getRecommendedWorkflowTags({ mainIssue, deterministic = {} } = {}) {
  const issue = normalizeIssueCode(mainIssue);
  const metrics = deterministic.metrics || {};
  const qaSupported = !shouldAiSuppressActionFamily(getAiActionGuidance(deterministic), "qa_review")
    && (shouldAiRecommendQaReview(getAiActionGuidance(deterministic)) || hasOperationalQualityTextSignals(deterministic));
  const tags = [];
  if ((issue === "quality_defect" || issue === "durability") && qaSupported) tags.push("qa-review-needed");
  if (issue === "safety_concern") tags.push("safety-review-needed");
  if (metrics.seoTitleNeedsReview || metrics.metaDescriptionNeedsReview || metrics.handleNeedsReview) tags.push("seo-fix-needed");
  if (Number(metrics.productMomentumScore || metrics.productMomentum?.score || 0) >= 70) tags.push("watchlist-candidate");
  if (metrics.classificationNeedsReview) tags.push("catalog-classification-review");
  return uniqueBy(tags, normalizeText);
}

function limitSeoText(value = "", maxLength, options = {}) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length <= maxLength) return finishSeoText(text, maxLength, options);
  const clipped = text.slice(0, maxLength + 1);
  const sentenceEnd = findLastSeoSentenceEnd(clipped, maxLength);
  const candidate = sentenceEnd >= Math.min(80, Math.floor(maxLength * 0.55))
    ? clipped.slice(0, sentenceEnd)
    : clipped.replace(/\s+\S*$/, "");
  return finishSeoText(candidate || clipped.slice(0, maxLength), maxLength, options);
}

function findLastSeoSentenceEnd(value = "", maxLength) {
  let lastEnd = -1;
  const regex = /[.!?](?=\s|$)/g;
  let match = regex.exec(value);
  while (match) {
    const end = match.index + 1;
    if (end <= maxLength) lastEnd = end;
    match = regex.exec(value);
  }
  return lastEnd;
}

function finishSeoText(value = "", maxLength, options = {}) {
  let text = String(value || "")
    .replace(/(?:\.\.\.|…)$/g, "")
    .replace(/\s+[|/-]?\s*$/g, "")
    .replace(/\b(?:and|or|with|for|to|of|the|a|an|y|o|con|para|de|del|la|el|los|las)$/i, "")
    .replace(/[,:;|\-–—]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (options.terminalPeriod && text && !/[.!?]$/.test(text) && text.length + 1 <= maxLength) {
    text = `${text}.`;
  }
  return text.length > maxLength ? text.slice(0, maxLength).replace(/\s+\S*$/, "").replace(/[,:;|\-–—.]+$/g, "").trim() : text;
}

function normalizeSuggestedTitle(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 140);
}

function getRecommendationCauseKey({ issue = "", text = "", deterministic = {} }) {
  const metrics = deterministic.metrics || {};
  const reasons = [
    ...(Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : []),
    ...(Array.isArray(metrics.topReturnReasonDetails) ? metrics.topReturnReasonDetails.map((item) => item.label || item.reason || "") : []),
    ...(Array.isArray(metrics.contentAnalysis?.issues) ? metrics.contentAnalysis.issues.map((item) => item.code || item.label || "") : []),
  ];
  const base = [
    issue,
    reasons.slice(0, 3).join(" "),
    text,
  ].join(" ");
  return normalizeText(base).split(/\s+/).slice(0, 18).join("-");
}

function buildMediaAltTextUpdates({ deterministic = {}, snapshot = {}, mediaGuidance = "", suggestedTitle = "" }) {
  const media = Array.isArray(deterministic.product?.media) ? deterministic.product.media : [];
  const missingAltMedia = media
    .filter((item) => item?.id && !String(item.alt || "").trim())
    .slice(0, 4);
  if (!missingAltMedia.length) return [];

  return missingAltMedia.map((item, index) => ({
    id: item.id,
    targetLabel: index === 0 ? "Primary product media" : `Product media ${index + 1}`,
    currentAltText: String(item.alt || ""),
    suggestedAltText: buildSuggestedMediaAltText({
      title: getBestMediaAltTitle({ deterministic, snapshot, suggestedTitle }),
      issue: deterministic.mainIssue,
      guidance: mediaGuidance || buildMediaGuidance(deterministic),
      media: item,
    }),
    mediaContentType: item.mediaContentType || item.type || "IMAGE",
    width: item.width || null,
    height: item.height || null,
  }));
}

function getBestMediaAltTitle({ deterministic = {}, snapshot = {}, suggestedTitle = "" }) {
  const currentTitle = String(deterministic.product?.title || snapshot.productTitle || snapshot.title || "").replace(/\s+/g, " ").trim();
  const aiTitle = String(suggestedTitle || "").replace(/\s+/g, " ").trim();
  if (aiTitle && (!currentTitle || isGenericProductTitle(currentTitle))) return aiTitle;
  return currentTitle || aiTitle || "Product";
}

function buildSuggestedMediaAltText({ title = "", issue = "", guidance = "", media = {} }) {
  const productTitle = String(title || "Product").replace(/\s+/g, " ").trim();
  const issueLabel = getHumanIssueLabel(issue).toLowerCase();
  const dimensions = media.width && media.height ? ` (${media.width}x${media.height})` : "";
  const focus = normalizeDraftParagraph(guidance)
    .replace(/^review product media and\s*/i, "")
    .replace(/^add product media that\s*/i, "")
    .replace(/\.$/, "");
  const suffix = focus && focus.length < 120
    ? `, highlighting ${focus.toLowerCase()}`
    : `, with visual context for ${issueLabel || "buyer expectations"}`;
  return `${productTitle} product image${dimensions}${suffix}.`.replace(/\s+/g, " ").slice(0, 250);
}

function buildRecommendedImageBrief(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  if (Number(metrics.mediaCount || 0) === 0) {
    return "Add at least one clear product image that shows the product, scale, material, color and what is included in the purchase.";
  }
  if (deterministic.mainIssue === "color_expectation") {
    return "Add or move forward an image that shows the product color in neutral lighting, including a close-up material or finish view if available.";
  }
  if (Number(metrics.mediaWithoutAltCount || 0) > 0) {
    return "Keep the current image order, but add descriptive alt text to media without alt text so product context is explicit.";
  }
  return "Review whether the first product image clearly shows scale, format, material and what the shopper receives.";
}

function buildMediaGuidance(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  if (Number(metrics.mediaCount || 0) === 0) return "Add product media that clearly shows scale, material, color and what the shopper receives.";
  if (Number(metrics.mediaWithoutAltCount || 0) > 0) return "Review product media and add descriptive alt text that explains the visible product, variant, color, material or scale.";
  if (deterministic.mainIssue === "color_expectation") return "Review image order and add visual context so color, lighting and material expectations are clearer before purchase.";
  return "Review product media for scale, material, color and format clarity.";
}

function getReviewCollectionName(deterministic = {}) {
  if (Number(deterministic.riskScore || 0) >= 75) return "ProductPulse High Return Risk";
  if (deterministic.mainIssue === "product_content") return "ProductPulse Content Fix Needed";
  return "ProductPulse Needs Review";
}

function buildQaReviewNote({ snapshot, deterministic, issueLabel }) {
  const metrics = deterministic.metrics || {};
  const parts = [
    `${snapshot.productTitle} should be reviewed for ${issueLabel}.`,
    metrics.returnUnits ? `${metrics.returnUnits} return unit${metrics.returnUnits === 1 ? "" : "s"} were analyzed.` : "",
    metrics.refundUnits ? `${metrics.refundUnits} refund unit${metrics.refundUnits === 1 ? "" : "s"} were analyzed.` : "",
    metrics.topReturnReasons?.length ? `Top return reasons: ${metrics.topReturnReasons.slice(0, 3).join(", ")}.` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

function getRecommendedRiskTags({ mainIssue, deterministic }) {
  const metrics = deterministic.metrics || {};
  const tags = [];
  if (Number(deterministic.riskScore || 0) >= 75) tags.push("risk-high");
  else if (Number(deterministic.riskScore || 0) >= 55) tags.push("risk-medium");
  else tags.push("risk-low");
  const issueTag = getIssueTag(mainIssue);
  if (issueTag) tags.push(issueTag);
  if (Number(metrics.contentIssueCount || 0) > 0) tags.push("needs-description-review");
  if (Number(metrics.returnUnits || 0) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) tags.push("return-anomaly");
  if (metrics.refundInsights?.shouldSurface) tags.push("refund-pressure");
  if (Number(metrics.textInsights?.sentiment?.negative || 0) >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) tags.push("sentiment-negative");
  if (Array.isArray(metrics.affectedVariants) && metrics.affectedVariants.length) tags.push("variant-issue");
  return uniqueBy(tags, normalizeText).slice(0, 10);
}

function buildRecommendedFaqRecommendation({ copy = {}, snapshot, mainIssue, pdpCopy = "", faqNeed = {}, currentDescriptionText = "", contentCoverage = new Map() }) {
  const normalizedAiItems = normalizeFaqItemsWithFallback(copy.faq_items, { snapshot, mainIssue, faqNeed });
  const normalizedLegacyItems = normalizeLegacyFaqItems({
    question: copy.faq_question,
    answer: copy.faq_answer,
    snapshot,
    mainIssue,
    faqNeed,
    reason: "AI generated from product diagnosis signals.",
  });
  const hadPreferredItems = normalizedAiItems.length > 0 || normalizedLegacyItems.length > 0;
  const aiItems = tagFaqItemSource(normalizedAiItems
    .map((item, index) => applyAiContentCoverageToFaqItem(item, contentCoverage, `faq_item_${index + 1}`))
    .filter(Boolean), "ai");
  const legacyItem = tagFaqItemSource(normalizedLegacyItems
    .map((item) => applyAiContentCoverageToFaqItem(item, contentCoverage, "legacy_faq"))
    .filter(Boolean), "ai");
  const fallbackItems = tagFaqItemSource(buildDefaultFaqItems({ snapshot, mainIssue, pdpCopy, faqNeed }), "fallback");
  const preferredItems = uniqueBy([...aiItems, ...legacyItem], (item) => normalizeText(item.question));
  const allCandidates = uniqueBy([...preferredItems, ...fallbackItems], (item) => normalizeText(item.question));
  const coverage = getFaqContentCoverage({
    items: allCandidates,
    preferredItems,
    currentDescriptionText,
    pdpCopy,
    mainIssue,
    faqNeed,
    hadPreferredItems,
  });
  const retainedItems = allCandidates
    .filter((item) => !coverage.skippedItemKeys.has(normalizeFaqQuestionKey(item.question)))
    .filter((item) => coverage.allowFallbackItems || item.source !== "fallback");

  return {
    items: retainedItems
      .map((item) => Object.fromEntries(Object.entries(item).filter(([key]) => key !== "source")))
      .slice(0, 4),
    coverage: {
      existingFaqDetected: coverage.existingFaqDetected,
      skippedItems: coverage.skippedItems,
      skippedQuestionCount: coverage.skippedItems.length,
      currentContentCoveredPreferredItems: coverage.currentContentCoveredPreferredItems,
    },
  };
}

function buildRecommendedFaqItems(args = {}) {
  return buildRecommendedFaqRecommendation(args).items;
}

function tagFaqItemSource(items = [], source = "") {
  return (Array.isArray(items) ? items : []).map((item) => ({ ...item, source }));
}

function normalizeFaqItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const question = String(item?.question || "").replace(/\s+/g, " ").trim();
      const answer = String(item?.answer || "").replace(/\s+/g, " ").trim();
      if (!question || !answer) return null;
      return {
        question: question.endsWith("?") ? question : `${question}?`,
        answer,
        reason: String(item?.reason || "").replace(/\s+/g, " ").trim(),
      };
    })
    .filter(Boolean);
}

function normalizeFaqItemsWithFallback(items = [], context = {}) {
  return (Array.isArray(items) ? items : [])
    .flatMap((item) => {
      const normalized = normalizeFaqItems([item]);
      if (normalized.length) return normalized;
      const answer = String(item?.answer || item?.faq_answer || item?.text || "").replace(/\s+/g, " ").trim();
      if (!answer) return [];
      return normalizeFaqItems([{
        question: inferLegacyFaqQuestionFromAnswer({ ...context, answer }),
        answer,
        reason: String(item?.reason || "AI generated from product diagnosis signals.").replace(/\s+/g, " ").trim(),
      }]);
    });
}

function normalizeLegacyFaqItems({ question = "", answer = "", snapshot = {}, mainIssue = "", faqNeed = {}, reason = "" } = {}) {
  const normalized = normalizeFaqItems([{ question, answer, reason }]);
  if (normalized.length) return normalized;

  const fallbackAnswer = String(answer || "").replace(/\s+/g, " ").trim();
  if (!fallbackAnswer) return [];
  const fallbackQuestion = inferLegacyFaqQuestionFromAnswer({
    answer: fallbackAnswer,
    snapshot,
    mainIssue,
    faqNeed,
  });
  return normalizeFaqItems([{
    question: fallbackQuestion,
    answer: fallbackAnswer,
    reason: reason || "AI generated from product diagnosis signals.",
  }]);
}

function inferLegacyFaqQuestionFromAnswer({ answer = "", snapshot = {}, mainIssue = "", faqNeed = {} } = {}) {
  const normalized = String(answer || "").toLowerCase();
  const title = snapshot?.productTitle || snapshot?.product?.title || "this product";
  const topics = Array.isArray(faqNeed.topics) ? faqNeed.topics : [];
  if (/\b(case|cases|wallet flaps?|card sleeves?|ring holders?|pop-?grips?|metal plates?|bumpers?|raised case lips?|magsafe|magnetic|alignment|charging|charger)\b/i.test(normalized)) {
    return "Which phone cases may prevent proper alignment or charging?";
  }
  if (mainIssue === "compatibility" || topics.includes("Compatibility") || /\b(compatible|compatibility|works? with|adapter|device|model)\b/i.test(normalized)) {
    return `What should shoppers confirm about compatibility before ordering ${title}?`;
  }
  if (mainIssue === "fit_sizing" || topics.includes("Fit and sizing") || /\b(size|sizing|fit|fits|measurements?|waist|chest|sleeve|inseam|between sizes)\b/i.test(normalized)) {
    return `What should shoppers know about fit before ordering ${title}?`;
  }
  if (mainIssue === "setup_expectation" || topics.includes("Setup guidance") || /\b(setup|install|installation|mount|assembly|assemble)\b/i.test(normalized)) {
    return `What setup details should shoppers confirm before buying ${title}?`;
  }
  return `What should shoppers know before buying ${title}?`;
}

function buildDefaultFaqItems({ snapshot, mainIssue, pdpCopy = "", faqNeed = {} }) {
  const title = snapshot.productTitle || "this product";
  const topics = Array.isArray(faqNeed.topics) ? faqNeed.topics : [];
  const items = [];
  const add = (question, answer, reason) => {
    items.push({ question, answer, reason });
  };

  if (mainIssue === "fit_sizing" || topics.includes("Fit and sizing")) {
    add(
      `How does ${title} fit?`,
      "Customer signals suggest shoppers may need clearer sizing guidance before purchase. Review the selected size and fit notes, and consider sizing up or checking measurements if you are between sizes.",
      "Fit or size language repeated in product signals.",
    );
  }

  if (mainIssue === "compatibility" || topics.includes("Compatibility")) {
    add(
      `What is ${title} compatible with?`,
      "Check the selected variant, product options and any compatibility notes before purchase. ProductPulse detected buyer uncertainty around whether this product works with a specific setup or related item.",
      "Compatibility or usage uncertainty appeared in product evidence.",
    );
  }

  if (mainIssue === "setup_expectation" || topics.includes("Setup guidance")) {
    add(
      `What setup details should shoppers confirm before buying ${title}?`,
      pdpCopy || "Review the setup checklist, included items, mounting or installation requirements, and any use limits before checkout.",
      "Setup or expectation mismatch appeared in product evidence.",
    );
  }

  if (mainIssue === "color_expectation" || topics.includes("Color expectations")) {
    add(
      `Will the color look exactly like the product photos?`,
      "Color can vary by screen, lighting and production batch. Review the product images and any color notes before purchase.",
      "Customer signals suggest expectation-setting around color may reduce avoidable confusion.",
    );
  }

  if (topics.includes("Materials and care")) {
    add(
      `What should shoppers know about materials or care for ${title}?`,
      "Use the product description, tags and variant details to confirm material and care expectations before purchase.",
      "Product content gaps or customer language point to material or care questions.",
    );
  }

  if (!items.length) {
    add(
      `What should shoppers know before buying ${title}?`,
      pdpCopy || "ProductPulse detected product signals that would benefit from clearer pre-purchase guidance. Review the description, options and evidence before buying.",
      "ProductPulse found FAQ-worthy buyer uncertainty in the diagnosis.",
    );
  }

  return normalizeFaqItems(items);
}

function formatFaqItemsAsText(items = []) {
  return normalizeFaqItems(items)
    .map((item) => `${item.question}\n${item.answer}`)
    .join("\n\n");
}

function getFaqContentCoverage({
  items = [],
  preferredItems = [],
  currentDescriptionText = "",
  hadPreferredItems = false,
}) {
  const current = normalizeDraftParagraph(currentDescriptionText);
  const existingQuestions = extractExistingFaqQuestions(current);
  const existingFaqDetected = hasExistingFaqContent(current, existingQuestions);
  const skippedItems = [];
  const skippedItemKeys = new Set();

  (Array.isArray(items) ? items : []).forEach((item) => {
    if (!isFaqItemCoveredByCurrentContent(item, current, existingQuestions)) return;
    const key = normalizeFaqQuestionKey(item.question);
    skippedItemKeys.add(key);
    skippedItems.push({
      question: item.question,
      reason: existingQuestions.some((question) => faqQuestionsOverlap(question, item.question))
        ? "Existing FAQ already covers this question."
        : "Current product copy already covers this answer.",
    });
  });

  const retainedPreferredCount = (Array.isArray(preferredItems) ? preferredItems : [])
    .filter((item) => !skippedItemKeys.has(normalizeFaqQuestionKey(item.question)))
    .length;
  const currentContentCoveredPreferredItems = preferredItems.length > 0 && retainedPreferredCount === 0;

  return {
    existingFaqDetected,
    skippedItems: uniqueBy(skippedItems, (item) => normalizeFaqQuestionKey(item.question)),
    skippedItemKeys,
    currentContentCoveredPreferredItems,
    allowFallbackItems: !hadPreferredItems || retainedPreferredCount > 0,
  };
}

function hasExistingFaqContent(currentDescriptionText = "", existingQuestions = []) {
  const normalized = normalizeText(currentDescriptionText);
  if (!normalized) return false;
  if (/\b(faq|faqs|frequently asked|questions and answers|q\s*:|question\s*:)\b/.test(normalized)) return true;
  return existingQuestions.length >= 2;
}

function extractExistingFaqQuestions(value = "") {
  const text = stripHtml(value);
  const candidates = [];
  text.split(/\n+/).forEach((line) => {
    const cleaned = line.replace(/^\s*(q|question)\s*[:.-]\s*/i, "").trim();
    if (cleaned.endsWith("?")) candidates.push(cleaned);
  });
  const inlineMatches = text.match(/[^.!?\n]{8,180}\?/g) || [];
  candidates.push(...inlineMatches.map((match) => match.trim()));
  return uniqueBy(candidates, normalizeFaqQuestionKey);
}

function isFaqItemCoveredByCurrentContent(item = {}, currentDescriptionText = "", existingQuestions = []) {
  const current = normalizeDraftParagraph(currentDescriptionText);
  if (!current) return false;
  const question = String(item.question || "").trim();
  const answer = String(item.answer || "").trim();
  if (question && existingQuestions.some((existingQuestion) => faqQuestionsOverlap(existingQuestion, question))) return true;
  if (question && normalizeText(current).includes(normalizeFaqQuestionKey(question))) return true;
  if (isExpectationFaqCoveredByCurrentContent({ question, answer }, current)) return true;
  if (answer && isTextCoveredByCurrentContent(answer, current, { minTokenCoverage: 0.76 })) return true;
  const combined = [question, answer].filter(Boolean).join(" ");
  return Boolean(combined && isTextCoveredByCurrentContent(combined, current, { minTokenCoverage: 0.72 }));
}

function isExpectationFaqCoveredByCurrentContent(item = {}, currentDescriptionText = "") {
  const currentTopics = getExpectationGuidanceTopics(currentDescriptionText);
  if (!currentTopics.size) return false;
  const combined = `${item.question || ""} ${item.answer || ""}`;
  const proposedTopics = getExpectationGuidanceTopics(combined);
  if (proposedTopics.size) return [...proposedTopics].every((topic) => currentTopics.has(topic));
  const questionKey = normalizeFaqQuestionKey(item.question || "");
  const setupQuestion = /\b(setup|install|mount|mounting|surface|adapter|cable|camera|webcam|glare|reflection|included)\b/.test(questionKey);
  return setupQuestion && currentTopics.size >= 2;
}

function faqQuestionsOverlap(firstQuestion = "", secondQuestion = "") {
  const first = normalizeFaqQuestionKey(firstQuestion);
  const second = normalizeFaqQuestionKey(secondQuestion);
  if (!first || !second) return false;
  if (first === second || first.includes(second) || second.includes(first)) return true;
  const overlap = Math.max(tokenCoverage(second, first), tokenCoverage(first, second));
  if (overlap >= 0.72) return true;
  const anchorTokens = new Set(["fit", "size", "sizing", "color", "colour", "variant", "wash", "washing", "material", "fabric", "compatible", "compatibility", "setup", "mount", "mounting", "surface", "adapter", "cable", "camera", "webcam"]);
  const firstTokens = new Set(meaningfulTokens(first));
  const secondTokens = new Set(meaningfulTokens(second));
  const sharedAnchors = [...anchorTokens].filter((token) => firstTokens.has(token) && secondTokens.has(token));
  return sharedAnchors.length > 0 && overlap >= 0.5;
}

function normalizeFaqQuestionKey(value = "") {
  return normalizeText(value)
    .replace(/^\s*(q|question)\s+/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(this|that|with|from|your|shopper|shoppers|customer|customers|before|buying|product|products|does|should|would|could|will|what|when|where|which|are|all|same|way|vary|expected|option|options)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getFaqActionLabel(mainIssue, coverage = {}) {
  const prefix = coverage.existingFaqDetected ? "Add missing" : "Create";
  if (mainIssue === "fit_sizing") return `${prefix} fit FAQ`;
  if (mainIssue === "compatibility") return `${prefix} compatibility FAQ`;
  if (mainIssue === "setup_expectation") return `${prefix} setup FAQ`;
  if (mainIssue === "color_expectation") return `${prefix} color expectations FAQ`;
  return `${prefix} product FAQ`;
}

function getFaqApplicationOptions() {
  return [
    {
      id: "description-section",
      label: "Full FAQ in description",
      target: "Product description",
      operation: "Append FAQ section",
    },
    {
      id: "description-collapsible",
      label: "Collapsible FAQ in description",
      target: "Product description",
      operation: "Append collapsible FAQ",
    },
    {
      id: "description-modal",
      label: "Modal-style FAQ in description",
      target: "Product description",
      operation: "Append modal-style FAQ",
    },
    {
      id: "metafield-html",
      label: "Save FAQ metafield",
      target: "Product metafield",
      operation: "Save HTML metafield",
    },
  ];
}

function buildFinalIssues({ deterministic, ai, mainIssue, recommendations }) {
  const clusters = Array.isArray(ai.classification?.clusters) && ai.classification.clusters.length
    ? ai.classification.clusters
    : buildFallbackClusters(deterministic, mainIssue);
  const firstAction = recommendations[0]?.label || "Review product signals";
  const contentIssues = deterministic.metrics.contentAnalysis?.issues || [];
  const sourceMismatchSignals = getSourceMismatchSignals(deterministic);
  const sourceIntegrityMode = isSourceIntegrityDiagnosis(deterministic, sourceMismatchSignals);
  const granularTextIssues = buildGranularTextIssues({ deterministic, ai, recommendations });
  let mappedIssues = clusters.slice(0, 5).map((cluster, index) => {
    const issueCode = normalizeIssueCode(cluster.issue_category || cluster.issue || mainIssue) || mainIssue;
    const trend = getIssueTrend(deterministic, issueCode);
    const severity = cluster.severity || getSeverityLabel(deterministic.riskScore);
    const signals = Number(cluster.signals || deterministic.issueSignalCounts[issueCode] || Math.max(1, Math.round(deterministic.metrics.signalCount / (index + 1))));

    return {
      issue: cluster.human_name || cluster.label || getHumanIssueLabel(issueCode),
      issueCode,
      severity: capitalize(severity),
      tone: getRiskToneFromSeverity(severity, deterministic.riskScore),
      confidence: Math.max(35, Math.min(99, deterministic.confidence - index * 7)),
      signals,
      sourceTypes: normalizeSourceTypes(cluster.source_types || cluster.sources),
      evidence: [
        cluster.summary,
        ...(Array.isArray(cluster.evidence) ? cluster.evidence : []),
      ].filter(Boolean).length ? [
        cluster.summary,
        ...(Array.isArray(cluster.evidence) ? cluster.evidence : []),
      ].filter(Boolean).slice(0, 4) : deterministic.metrics.topReturnReasons,
      trend,
      trendTone: getTrendTone(trend, deterministic.riskScore),
      action: getIssueSuggestedActionLabel(issueCode, recommendations, recommendations[index]?.label || firstAction),
    };
  });

  if (sourceIntegrityMode) {
    mappedIssues = mappedIssues.filter((issue) => isSourceIntegrityIssueCode(issue.issueCode) || normalizeIssueCode(issue.issueCode) === "product_content");
    if (!mappedIssues.some((issue) => isSourceIntegrityIssueCode(issue.issueCode))) {
      mappedIssues.unshift(buildSourceIntegrityIssue(deterministic, recommendations, sourceMismatchSignals));
    }
  }

  granularTextIssues.forEach((issue) => {
    if (sourceIntegrityMode && !isSourceIntegrityIssueCode(issue.issueCode) && normalizeIssueCode(issue.issueCode) !== "product_content") return;
    if (mappedIssues.some((item) => item.issue === issue.issue)) return;
    mappedIssues.push(issue);
  });

  if (contentIssues.length > 0 && !mappedIssues.some((issue) => issue.issueCode === "product_content")) {
    const primaryContentIssue = contentIssues[0];
    mappedIssues.push({
      issue: primaryContentIssue.label || "Product content needs review",
      issueCode: "product_content",
      severity: capitalize(primaryContentIssue.severity || "Medium"),
      tone: getRiskToneFromSeverity(primaryContentIssue.severity || "medium", deterministic.riskScore),
      confidence: Math.max(45, Math.min(92, deterministic.confidence - 4)),
      signals: contentIssues.length,
      evidence: contentIssues.map((issue) => issue.evidence || issue.detail || issue.label).filter(Boolean).slice(0, 4),
      trend: [],
      trendTone: "orange",
      action: getIssueSuggestedActionLabel("product_content", recommendations, "Update product description"),
    });
  }

  const refundIssue = buildRefundOperationalIssue(deterministic, recommendations);
  if (refundIssue && !mappedIssues.some((issue) => issue.issueCode === refundIssue.issueCode)) {
    mappedIssues.push(refundIssue);
  }

  return mappedIssues
    .map((issue) => scaleSubjectiveIssueForEvidence(issue, deterministic))
    .map((issue) => scaleWeakReviewIssueForEvidence(issue, deterministic))
    .filter((issue) => isMerchantFacingIssueSupported(issue, deterministic))
    .reduce(mergeRelatedMerchantIssues, [])
    .slice(0, 10);
}

function isSourceIntegrityIssueCode(value) {
  const issueCode = normalizeIssueCode(value);
  return issueCode === "review_feed_integrity" || issueCode === "source_integrity";
}

function buildSourceIntegrityIssue(deterministic, recommendations, sourceMismatchSignals = []) {
  const metrics = deterministic.metrics || {};
  const contentIssues = [
    ...(Array.isArray(metrics.contentIssues) ? metrics.contentIssues : []),
    ...(Array.isArray(metrics.contentAnalysis?.issues) ? metrics.contentAnalysis.issues : []),
    ...(Array.isArray(metrics.contentAnalysis?.advisories) ? metrics.contentAnalysis.advisories : []),
  ].filter((issue) => /\b(source integrity|review feed|feed mismatch|metadata mismatch|review mismatch|wrong product|wrong sku)\b/i.test(`${issue.code || ""} ${issue.label || ""} ${issue.evidence || ""}`));
  const issueCode = "review_feed_integrity";
  const trend = getIssueTrend(deterministic, issueCode);
  const signals = Math.max(
    Number(metrics.negativeReviewCount || 0),
    sourceMismatchSignals.length,
    contentIssues.length,
    Number(deterministic.issueSignalCounts?.[issueCode] || 0),
    MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE,
  );

  return {
    issue: "Review feed mismatch",
    issueCode,
    severity: signals >= 6 ? "High" : "Medium",
    tone: signals >= 6 ? "red" : "orange",
    confidence: Math.max(50, Math.min(92, Number(deterministic.confidence || 70))),
    signals,
    sourceTypes: ["reviews", "source_integrity", "product_content"],
    evidence: [
      "Customer evidence appears to reference a different product, SKU, variant or feed item.",
      ...sourceMismatchSignals.slice(0, 3).map((value) => `Mismatch signal: "${truncateText(value, 160)}"`),
      ...contentIssues.slice(0, 2).map((issue) => issue.evidence || issue.detail || issue.label).filter(Boolean),
    ].filter(Boolean).slice(0, 5),
    trend,
    trendTone: "orange",
    action: getIssueSuggestedActionLabel(issueCode, recommendations, "Fix source/review mismatch"),
  };
}

function getIssueSuggestedActionLabel(issueCode, recommendations = [], fallback = "Review product signals") {
  const normalizedIssue = normalizeIssueCode(issueCode);
  const preferredPatterns = getIssueActionPreferredPatterns(normalizedIssue);
  const avoidPatterns = [/seo|meta|handle|workflow tag|risk tag|watchlist|collection|monitoring|baseline|internal note/i];
  const preferred = findRecommendedActionLabel(recommendations, preferredPatterns, avoidPatterns);
  if (preferred) return preferred;

  if (["quality_defect", "product_quality", "product_content", "fit_sizing", "compatibility", "color_expectation", "subjective_negative_reaction"].includes(normalizedIssue)) {
    const customerFacing = findRecommendedActionLabel(
      recommendations,
      [/description|pdp|expectation|quality note|fit note|faq|spec|details/i],
      avoidPatterns,
    );
    if (customerFacing) return customerFacing;
  }

  return fallback;
}

function getIssueActionPreferredPatterns(issueCode) {
  if (isSourceIntegrityIssueCode(issueCode)) return [/source.*mismatch|source integrity|review feed integrity|feed mismatch/i];
  if (issueCode === "refund_impact" || issueCode === "shipping_delivery") return [/supplier|qa|refund impact|description|quality note|packaging|shipping/i];
  if (issueCode === "fit_sizing") return [/fit note|fit faq|faq|description|spec/i];
  if (issueCode === "product_content") return [/description|spec|details|faq/i];
  if (issueCode === "quality_defect" || issueCode === "product_quality" || issueCode === "durability" || issueCode === "safety_concern") return [/supplier|qa|description|quality note|expectation|faq|spec/i];
  if (issueCode === "negative_sentiment") return [/sentiment evidence|description|quality note|expectation/i];
  if (issueCode === "repeated_language") return [/repeated language|description|quality note|expectation/i];
  return [/description|pdp|evidence/i];
}

function findRecommendedActionLabel(recommendations = [], preferredPatterns = [], avoidPatterns = []) {
  const candidates = (Array.isArray(recommendations) ? recommendations : []).filter((action) => {
    const text = `${action.id || ""} ${action.type || ""} ${action.label || ""} ${action.payload?.shopifyField || ""}`.toLowerCase();
    if (!preferredPatterns.some((pattern) => pattern.test(text))) return false;
    return !avoidPatterns.some((pattern) => pattern.test(text));
  });
  return candidates[0]?.label || "";
}

function buildRefundOperationalIssue(deterministic, recommendations) {
  const refundInsights = deterministic.metrics.refundInsights || {};
  if (!refundInsights.shouldSurface) return null;
  const issueCode = refundInsights.dominantIssueCode && refundInsights.dominantIssueCode !== "product_quality"
    ? refundInsights.dominantIssueCode
    : "refund_impact";
  const trend = getIssueTrend(deterministic, issueCode);
  const severity = refundInsights.highPressure ? "medium" : "low";
  const signals = Math.max(Number(refundInsights.total || 0), Number(refundInsights.noteCount || 0));
  return {
    issue: refundInsights.highPressure ? "High refund pressure" : "Refund pattern needs review",
    issueCode,
    severity: capitalize(severity),
    tone: getRiskToneFromSeverity(severity, deterministic.riskScore),
    confidence: Math.max(40, Math.min(86, deterministic.confidence - (refundInsights.highPressure ? 8 : 16))),
    signals,
    sourceTypes: ["shopify_refund_note", "shopify_refunds"],
    evidence: [
      `${refundInsights.total} refunded unit${refundInsights.total === 1 ? "" : "s"} across ${refundInsights.soldUnits} sold unit${refundInsights.soldUnits === 1 ? "" : "s"} (${refundInsights.refundRate}% refund rate).`,
      refundInsights.highPressure ? "Refund pressure is above the high-signal threshold: refund rate >20% and sold units >10." : "",
      refundInsights.noteCount ? `${refundInsights.noteCount} refund note${refundInsights.noteCount === 1 ? "" : "s"} available for operational pattern review.` : "",
      refundInsights.reasonCount ? `${refundInsights.reasonCount} refund reason/restock context signal${refundInsights.reasonCount === 1 ? "" : "s"} available for operational pattern review.` : "",
      ...((refundInsights.topReasons || []).slice(0, 3).map((item) => `Refund reason/context: "${item.label}" (${item.count})`)),
      ...((refundInsights.repeatedLanguage || []).slice(0, 3).map((item) => `Repeated refund-note language: "${item.term}" (${item.count})`)),
      ...((refundInsights.examples || []).slice(0, 2).map((item) => `Refund note: "${item.text}"`)),
    ].filter(Boolean),
    trend,
    trendTone: getTrendTone(trend, deterministic.riskScore),
    action: recommendations.find((item) => item.id === "review-refund-impact")?.label || "Review refund impact",
  };
}

function buildGranularTextIssues({ deterministic, ai, recommendations }) {
  const textInsights = deterministic.metrics.textInsights || {};
  const aiFindings = Array.isArray(ai.classification?.granular_findings) ? ai.classification.granular_findings : [];
  const aiRepeatedLanguage = getFilteredAiRepeatedLanguage(ai);
  const aiEmergentSentiments = normalizeAiEmergentSentiments(ai);
  const deterministicIssues = Array.isArray(textInsights.granularIssues) ? textInsights.granularIssues : [];
  const aiHasMerchantFacingTextFindings = Boolean(
    aiFindings.length
    || aiRepeatedLanguage.length
    || aiEmergentSentiments.length
    || (Array.isArray(ai.classification?.clusters) && ai.classification.clusters.length),
  );
  const issues = [];

  aiFindings.slice(0, 5).forEach((finding, index) => {
    const issueCode = normalizeIssueCode(finding.issue_category || finding.issue_detail || "product_quality") || "product_quality";
    const trend = getIssueTrend(deterministic, issueCode);
    const severity = normalizeSeverity(finding.severity || "medium");
    issues.push({
      issue: finding.finding || finding.label || getHumanIssueLabel(issueCode),
      issueCode,
      severity: capitalize(severity),
      tone: getRiskToneFromSeverity(severity, deterministic.riskScore),
      confidence: Math.max(42, Math.min(94, deterministic.confidence - 5 - index * 3)),
      signals: Number(finding.signals || 1),
      sourceTypes: normalizeSourceTypes(finding.source_types || finding.sources),
      evidence: Array.isArray(finding.evidence) ? finding.evidence.slice(0, 4) : [finding.summary || finding.explanation].filter(Boolean),
      trend,
      trendTone: getTrendTone(trend, deterministic.riskScore),
      action: finding.suggested_action || recommendations[index]?.label || "Review text evidence",
    });
  });

  deterministicIssues.slice(0, aiHasMerchantFacingTextFindings ? 0 : 5).forEach((issue, index) => {
    const issueCode = normalizeIssueCode(issue.issueCode || issue.issue) || "product_quality";
    const trend = getIssueTrend(deterministic, issueCode);
    issues.push({
      issue: issue.issue,
      issueCode,
      severity: capitalize(issue.severity || "Low"),
      tone: getRiskToneFromSeverity(issue.severity || "low", deterministic.riskScore),
      confidence: Math.max(38, Math.min(90, deterministic.confidence - 8 - index * 3)),
      signals: Number(issue.signals || 1),
      sourceTypes: normalizeSourceTypes(issue.sourceTypes || issue.sources),
      evidence: Array.isArray(issue.evidence) ? issue.evidence.slice(0, 4) : [],
      trend,
      trendTone: getTrendTone(trend, deterministic.riskScore),
      action: issue.action || "Review text evidence",
    });
  });

  aiRepeatedLanguage.slice(0, 4).forEach((item, index) => {
    const term = String(item.term || "").trim();
    if (!term) return;
    const issueCode = getRepeatedLanguageIssueCode(item, deterministic);
    const trend = getIssueTrend(deterministic, issueCode);
    issues.push({
      issue: `Repeated customer language: "${term}"`,
      issueCode,
      severity: capitalize(normalizeSeverity(item.severity || (Number(item.count || 0) >= 4 ? "medium" : "low"))),
      tone: getRiskToneFromSeverity(item.severity || "low", deterministic.riskScore),
      confidence: Math.max(38, Math.min(88, deterministic.confidence - 12 - index * 2)),
      signals: Number(item.count || 1),
      sourceTypes: normalizeSourceTypes(item.source_types || item.sources),
      evidence: [item.explanation, `${term} appears ${item.count || 1} times.`].filter(Boolean),
      trend,
      trendTone: getTrendTone(trend, deterministic.riskScore),
      action: "Review repeated language",
    });
  });

  aiEmergentSentiments.slice(0, 4).forEach((item, index) => {
    const issueCode = normalizeIssueCode(item.issueCategory || `emergent_sentiment_${item.normalizedLabel}`) || `emergent_sentiment_${item.normalizedLabel}`;
    const trend = getIssueTrend(deterministic, issueCode);
    const severity = normalizeEmergentSentimentSeverity(item);
    issues.push({
      issue: `Emergent customer sentiment: ${item.label}`,
      issueCode,
      severity: capitalize(severity),
      tone: getRiskToneFromSeverity(severity, deterministic.riskScore),
      confidence: getEmergentSentimentConfidenceScore(item, deterministic.confidence, index),
      signals: item.signals,
      sourceTypes: normalizeSourceTypes(item.sourceTypes || item.source_types),
      evidence: [
        item.merchantSummary,
        item.mergedFrom.length ? `Merged similar reactions: ${item.mergedFrom.join(", ")}.` : "",
        ...item.evidence,
      ].filter(Boolean).slice(0, 5),
      trend,
      trendTone: getTrendTone(trend, deterministic.riskScore),
      action: item.suggestedAction || "Review emergent customer sentiment",
    });
  });

  return uniqueBy(issues.filter((issue) => issue.issue), (issue) => `${issue.issueCode}-${issue.issue}`);
}

function getRepeatedLanguageIssueCode(item = {}, deterministic = {}, fallbackIssue = "") {
  const term = String(item.term || item.label || item.phrase || "").trim();
  const text = [
    term,
    item.explanation,
    item.example,
    item.issue_category,
    item.issueCode,
    item.issueCategory,
  ].filter(Boolean).join(" ");
  const mainIssue = normalizeIssueCode(fallbackIssue || deterministic.mainIssue);
  if (shouldTreatRepeatedLanguageAsSetupExpectation(text, mainIssue)) return "setup_expectation";
  return normalizeIssueCode(item.issue_category || item.issueCode || item.issueCategory || term) || "repeated_language";
}

function shouldTreatRepeatedLanguageAsSetupExpectation(value = "", mainIssue = "") {
  const text = normalizeText(value);
  if (!text) return false;
  const setupTerm = /\b(setup|install|installation|mount|mounting|adhesive|surface|surfaces|clamp|cure|oiled|textured|porous|sealed|shelf|cable|routing|left|right|adapter|wall brick|usb c|usb-c|webcam|camera|banding|flicker|glossy|reflection|glare|monitor|min line|minimum fill|min fill|fill line|voltage|120v|120 v|converter|travel converter|power bank|car socket|steam vent|vent clearance|counter placement|outlet|boil|boiling)\b/.test(text);
  if (!setupTerm) return false;
  if (mainIssue === "setup_expectation") return true;
  return isSetupExpectationMismatchText(text)
    || /\b(expectation|mismatch|confusing|confusion|unclear|not obvious|missed|listing|description|pdp|before checkout|before buying)\b/.test(text);
}

function getFilteredAiRepeatedLanguage(ai) {
  return (Array.isArray(ai?.classification?.repeated_language) ? ai.classification.repeated_language : [])
    .filter((item) => isActionableRepeatedLanguageIssue(item));
}

function isMerchantFacingIssueSupported(issue, deterministic) {
  const issueCode = normalizeIssueCode(issue.issueCode);
  if (issueCode === "product_content") return true;
  if (isExpectationIssueCode(issueCode)) {
    return hasStrongExpectationIssueEvidence(deterministic, issueCode);
  }

  const support = getMerchantIssueSupport(issue, deterministic);
  if (support.sources >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE && support.signals >= 1) return true;
  if (support.signals >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) return true;

  return false;
}

function hasActionableIssueEvidence(deterministic, issueCode) {
  const normalizedIssueCode = normalizeIssueCode(issueCode);
  if (normalizedIssueCode === "product_content") return Number(deterministic.metrics?.contentIssueCount || 0) > 0;
  return isMerchantFacingIssueSupported({
    issueCode: normalizedIssueCode,
    signals: deterministic.issueSignalCounts?.[normalizedIssueCode] || 0,
  }, deterministic);
}

function getMerchantIssueSupport(issue, deterministic) {
  const issueCode = normalizeIssueCode(issue.issueCode);
  const metrics = deterministic.metrics || {};
  const sourceTypes = normalizeSourceTypes(issue.sourceTypes || issue.source_types || issue.sources);
  const explicitSignals = Number(issue.signals || 0);
  const issueSignals = Number(deterministic.issueSignalCounts?.[issueCode] || 0);
  const fallbackSignals = getDeterministicIssueSupport(issueCode, metrics);

  return {
    signals: Math.max(explicitSignals, issueSignals, fallbackSignals),
    sources: sourceTypes.length,
  };
}

function getDeterministicIssueSupport(issueCode, metrics) {
  if (issueCode === "refund_impact") return Number(metrics.refundUnits || 0);
  if (issueCode === "negative_sentiment") return Number(metrics.textInsights?.sentiment?.negative || 0);
  if (issueCode === "subjective_negative_reaction") return Number(metrics.textInsights?.subjectiveNegativity?.count || 0);
  if (issueCode === "repeated_language") {
    return Math.max(...(metrics.textInsights?.repeatedLanguage || []).map((item) => Number(item.count || 0)), 0);
  }
  return 0;
}

function isExpectationIssueCode(issueCode) {
  return EXPECTATION_ISSUE_CODES.has(normalizeIssueCode(issueCode));
}

function hasStrongExpectationIssueEvidence(deterministic = {}, issueCode = "") {
  const normalizedIssue = normalizeIssueCode(issueCode);
  if (!isExpectationIssueCode(normalizedIssue)) return false;

  const metrics = deterministic.metrics || {};
  const issueSignals = getExpectationIssueSignalCount(deterministic, normalizedIssue);
  const returnUnits = Number(metrics.returnUnits || 0);
  const refundUnits = Number(metrics.refundUnits || 0);
  const hardEvents = returnUnits + refundUnits;
  const negativeReviewCount = Number(metrics.negativeReviewCount || 0);
  const customerSignalCount = Number(metrics.customerSignalCount || metrics.signalEventCount || 0);
  const textSentiment = metrics.textInsights?.sentiment || {};
  const negativeTextSignals = Number(textSentiment.negative || 0);
  const negativeTextRatio = Number(textSentiment.negativeRatio || 0);

  if (issueSignals >= MIN_EXPECTATION_ISSUE_SIGNALS_FOR_MERCHANT_ISSUE
    && hardEvents >= MIN_EXPECTATION_HARD_EVENTS_FOR_MERCHANT_ISSUE) {
    return true;
  }

  if (issueSignals >= 4
    && negativeReviewCount >= 4
    && customerSignalCount >= 4
    && negativeTextRatio >= 0.35) {
    return true;
  }

  if (issueSignals >= 5 && negativeTextSignals >= 5 && negativeTextRatio >= 0.45) {
    return true;
  }

  return false;
}

function getExpectationIssueSignalCount(deterministic = {}, issueCode = "") {
  const normalizedIssue = normalizeIssueCode(issueCode);
  const metrics = deterministic.metrics || {};
  const counts = deterministic.issueSignalCounts || {};
  const refundIssueCount = countIssueCountRows(metrics.refundInsights?.issueCounts, normalizedIssue);
  const repeatedLanguageCount = countRepeatedLanguageIssueRows(metrics.textInsights?.repeatedLanguage, normalizedIssue);
  const granularIssueCount = countGranularTextIssueRows(metrics.textInsights?.granularIssues, normalizedIssue);
  return Math.max(
    Number(counts[normalizedIssue] || 0),
    refundIssueCount,
    repeatedLanguageCount,
    granularIssueCount,
  );
}

function countGranularTextIssueRows(rows = [], issueCode = "") {
  const normalizedIssue = normalizeIssueCode(issueCode);
  return (Array.isArray(rows) ? rows : []).reduce((total, row) => {
    const label = normalizeIssueCode(row?.issueCode || row?.issue || row?.label);
    return total + (label === normalizedIssue ? Number(row?.signals || row?.count || 1) : 0);
  }, 0);
}

function mergeRelatedMerchantIssues(mergedIssues, issue) {
  const existingIndex = mergedIssues.findIndex((candidate) => getIssueMergeKey(candidate) === getIssueMergeKey(issue));
  if (existingIndex === -1) return [...mergedIssues, issue];

  const existing = mergedIssues[existingIndex];
  const preferred = compareIssueStrength(issue, existing) > 0 ? issue : existing;
  const secondary = preferred === issue ? existing : issue;
  const combined = {
    ...preferred,
    signals: Math.max(Number(preferred.signals || 0), Number(secondary.signals || 0)),
    confidence: Math.max(Number(preferred.confidence || 0), Number(secondary.confidence || 0)),
    evidence: uniqueBy([
      ...(Array.isArray(preferred.evidence) ? preferred.evidence : []),
      ...(Array.isArray(secondary.evidence) ? secondary.evidence : []),
    ].filter(Boolean), (item) => normalizeText(item)).slice(0, 5),
    sourceTypes: uniqueBy([
      ...normalizeSourceTypes(preferred.sourceTypes),
      ...normalizeSourceTypes(secondary.sourceTypes),
    ], (item) => item),
  };

  return [
    ...mergedIssues.slice(0, existingIndex),
    combined,
    ...mergedIssues.slice(existingIndex + 1),
  ];
}

function compareIssueStrength(first, second) {
  const firstScore = getSeverityRank(first.severity) * 100 + Number(first.signals || 0) * 10 + Number(first.confidence || 0);
  const secondScore = getSeverityRank(second.severity) * 100 + Number(second.signals || 0) * 10 + Number(second.confidence || 0);
  return firstScore - secondScore;
}

function getIssueMergeKey(issue) {
  const issueCode = normalizeIssueCode(issue.issueCode);
  if (issueCode === "product_content") return `${issueCode}-${normalizeText(issue.issue)}`;
  return issueCode || normalizeText(issue.issue);
}

function getSeverityRank(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("high")) return 3;
  if (normalized.includes("medium") || normalized.includes("moderate")) return 2;
  return 1;
}

function normalizeSourceTypes(value) {
  const values = Array.isArray(value) ? value : String(value || "").split(",");
  return uniqueBy(
    values
      .map((item) => String(item || "").trim().toLowerCase().replace(/\s+/g, "_"))
      .filter(Boolean),
    (item) => item,
  );
}

function scaleSubjectiveIssueForEvidence(issue, deterministic) {
  if (issue.issueCode !== "subjective_negative_reaction") return issue;
  const summary = deterministic.metrics.textInsights?.subjectiveNegativity || {};
  const severity = getSubjectiveIssueSeverity(summary);
  const evidence = Array.isArray(issue.evidence) ? issue.evidence.filter(Boolean) : [];
  const policyText = getSubjectiveEvidencePolicyText(summary);
  return {
    ...issue,
    severity: capitalize(severity),
    tone: getRiskToneFromSeverity(severity, deterministic.riskScore),
    confidence: Math.min(Number(issue.confidence || deterministic.confidence || 0), getSubjectiveConfidenceCap(summary)),
    signals: Math.max(Number(issue.signals || 0), Number(summary.count || 0), 1),
    evidence: evidence.includes(policyText) ? evidence : [policyText, ...evidence].filter(Boolean).slice(0, 5),
  };
}

function getSubjectiveConfidenceCap(summary) {
  const count = Number(summary?.count || 0);
  const ratio = Number(summary?.ratio || 0);
  if (count <= 1) return 45;
  if (!hasActionableSubjectiveEvidence(summary)) return 62;
  if (count < 5 && ratio < 0.5) return 76;
  return 88;
}

function scaleWeakReviewIssueForEvidence(issue, deterministic) {
  const relevance = buildSignalRelevanceGuidance(deterministic);
  if (relevance.reviewSignals.level === "normal") return issue;
  if (issue.issueCode === "product_content") return issue;
  const negativeReviews = Number(deterministic.metrics.negativeReviewCount || 0);
  const severity = negativeReviews >= 3 ? "Medium" : "Low";
  const confidenceCap = negativeReviews >= 3 ? 64 : 49;
  const policyText = relevance.reviewSignals.guidance;
  const evidence = Array.isArray(issue.evidence) ? issue.evidence.filter(Boolean) : [];
  return {
    ...issue,
    severity,
    tone: getRiskToneFromSeverity(severity, deterministic.riskScore),
    confidence: Math.min(Number(issue.confidence || deterministic.confidence || 0), confidenceCap),
    evidence: evidence.includes(policyText) ? evidence : [policyText, ...evidence].filter(Boolean).slice(0, 5),
  };
}

const KNOWN_CUSTOMER_SENTIMENT_CODES = new Set([
  "frustration",
  "disappointment",
  "anger",
  "fear",
  "confusion",
  "distrust",
  "regret",
  "uncertainty",
  "indifference",
  "satisfaction",
  "trust",
  "relief",
  "delight",
  "none",
]);

function normalizeAiKnownEmotions(ai, textInsights = {}) {
  const grouped = new Map();
  let aiEmotionCount = 0;

  const addEmotion = ({ code, count = 1, source = "", evidence = "" }) => {
    const normalizedCode = normalizeEmotionCode(code);
    if (!normalizedCode || normalizedCode === "none" || !KNOWN_CUSTOMER_SENTIMENT_CODES.has(normalizedCode)) return;
    const current = grouped.get(normalizedCode) || {
      code: normalizedCode,
      label: getEmotionLabel(normalizedCode),
      polarity: getEmotionPolarity(normalizedCode),
      count: 0,
      sources: new Set(),
      examples: [],
    };
    current.count += Math.max(1, Number(count || 1));
    if (source) current.sources.add(source);
    if (evidence && current.examples.length < 3) current.examples.push(truncateText(evidence, 140));
    grouped.set(normalizedCode, current);
  };

  (Array.isArray(ai?.classification?.classified_signals) ? ai.classification.classified_signals : []).forEach((signal) => {
    if (normalizeEmotionCode(signal.known_emotion) && normalizeEmotionCode(signal.known_emotion) !== "none") aiEmotionCount += 1;
    addEmotion({
      code: signal.known_emotion,
      source: signal.source,
      evidence: signal.text,
    });
  });

  (Array.isArray(ai?.classification?.granular_findings) ? ai.classification.granular_findings : []).forEach((finding) => {
    if (normalizeEmotionCode(finding.known_emotion) && normalizeEmotionCode(finding.known_emotion) !== "none") aiEmotionCount += 1;
    addEmotion({
      code: finding.known_emotion,
      count: finding.signals,
      source: Array.isArray(finding.source_types) ? finding.source_types.join(", ") : "",
      evidence: Array.isArray(finding.evidence) ? finding.evidence[0] : finding.finding,
    });
  });

  getFilteredAiRepeatedLanguage(ai).forEach((item) => {
    if (normalizeEmotionCode(item.known_emotion) && normalizeEmotionCode(item.known_emotion) !== "none") aiEmotionCount += 1;
    addEmotion({
      code: item.known_emotion,
      count: item.count,
      source: Array.isArray(item.source_types) ? item.source_types.join(", ") : "",
      evidence: item.term,
    });
  });

  if (!aiEmotionCount) {
    (Array.isArray(textInsights.emotions) ? textInsights.emotions : []).forEach((item) => {
      addEmotion({
        code: item.code,
        count: item.count,
        source: Array.isArray(item.sources) ? item.sources.join(", ") : "",
        evidence: Array.isArray(item.examples) ? item.examples[0] : "",
      });
    });
  }

  return Array.from(grouped.values())
    .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label))
    .map((item) => ({
      ...item,
      sources: Array.from(item.sources),
    }))
    .slice(0, 8);
}

function normalizeAiEmergentSentiments(ai) {
  const items = Array.isArray(ai?.emergentSentiments?.emergent_sentiments)
    ? ai.emergentSentiments.emergent_sentiments
    : [];

  return uniqueBy(
    items
      .map(normalizeAiEmergentSentiment)
      .filter(Boolean),
    (item) => item.normalizedLabel,
  ).slice(0, 6);
}

function normalizeAiEmergentSentiment(item) {
  const label = String(item?.label || item?.normalized_label || "").replace(/\s+/g, " ").trim();
  const normalizedLabel = normalizeText(item?.normalized_label || label)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (!label || !normalizedLabel || KNOWN_CUSTOMER_SENTIMENT_CODES.has(normalizedLabel)) return null;

  const evidence = Array.isArray(item.evidence)
    ? item.evidence.map((value) => truncateText(value, 180)).filter(Boolean).slice(0, 4)
    : [];
  const mergedFrom = Array.isArray(item.merged_from)
    ? item.merged_from.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 6)
    : [];
  const signals = Math.max(0, Math.round(Number(item.signals || 0)), evidence.length);
  const hasSufficientEvidence = item.has_sufficient_evidence === true || signals >= 2;
  if (!hasSufficientEvidence || signals < 2) return null;

  return {
    label,
    normalizedLabel,
    polarity: normalizePolarity(item.polarity),
    signals,
    confidence: normalizeEmergentConfidence(item.confidence),
    mergedFrom,
    sourceTypes: Array.isArray(item.source_types)
      ? item.source_types.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 5)
      : [],
    issueCategory: normalizeIssueCode(item.issue_category || `emergent_sentiment_${normalizedLabel}`),
    merchantSummary: truncateText(item.merchant_summary || item.summary || `${label} appeared in repeated customer language.`, 220),
    evidence,
    suggestedAction: item.suggested_action || "Review emergent customer sentiment",
  };
}

function normalizeEmotionCode(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function getEmotionLabel(code) {
  const labels = {
    frustration: "Frustration",
    disappointment: "Disappointment",
    anger: "Anger",
    fear: "Fear",
    confusion: "Confusion",
    distrust: "Distrust",
    regret: "Regret",
    uncertainty: "Uncertainty",
    indifference: "Indifference",
    satisfaction: "Satisfaction",
    trust: "Trust",
    relief: "Relief",
    delight: "Delight",
  };
  return labels[code] || capitalize(String(code || "Emotion").replace(/_/g, " "));
}

function getEmotionPolarity(code) {
  if (["satisfaction", "trust", "relief", "delight"].includes(code)) return "positive";
  if (["uncertainty", "indifference"].includes(code)) return "neutral";
  return "negative";
}

function formatEmotionCounts(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => item?.label && Number(item.count || item.signals || 0) > 0)
    .map((item) => `${item.label} ${Number(item.count || item.signals || 0)}`)
    .join(", ");
}

function normalizePolarity(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("positive")) return "positive";
  if (normalized.includes("mixed")) return "mixed";
  if (normalized.includes("neutral")) return "neutral";
  return "negative";
}

function normalizeEmergentConfidence(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("high")) return "high";
  if (normalized.includes("low")) return "low";
  return "medium";
}

function normalizeEmergentSentimentSeverity(item) {
  if (item.polarity === "positive") return "low";
  if (item.confidence === "high" && item.signals >= 4) return "high";
  if (item.polarity === "negative" && item.signals >= 2) return "medium";
  return "low";
}

function getEmergentSentimentConfidenceScore(item, baseConfidence, index) {
  const confidenceLift = item.confidence === "high" ? 8 : item.confidence === "low" ? -8 : 0;
  const signalLift = Math.min(8, item.signals * 2);
  return Math.max(38, Math.min(92, baseConfidence - 12 - index * 3 + confidenceLift + signalLift));
}

function getIssueTrend(deterministic, issueCode) {
  const issueSignalTrends = deterministic.metrics.issueSignalTrends || {};
  const directTrend = issueSignalTrends[issueCode]?.trend || issueSignalTrends[issueCode];

  if (Array.isArray(directTrend) && directTrend.length) return directTrend;
  if (issueCode === deterministic.mainIssue && Array.isArray(deterministic.metrics.signalTrend)) {
    return deterministic.metrics.signalTrend;
  }
  return [];
}

function buildFinalEvidence({ deterministic, ai, aiEvidenceSynthesisSections = [], judgeMeData, yotpoData, looxData, csvReviewData, shopifyData }) {
  const textInsights = deterministic.metrics.textInsights || {};
  const aiKnownEmotions = normalizeAiKnownEmotions(ai, textInsights);
  const aiEmergentSentiments = normalizeAiEmergentSentiments(ai);
  const evidence = [{
    source: "Shopify product",
    quote: `${deterministic.metrics.productType || "Product"}${deterministic.metrics.vendor ? ` by ${deterministic.metrics.vendor}` : ""}`,
    weight: `${deterministic.metrics.variantCount || 0} variants, ${deterministic.metrics.skuCount || 0} SKUs`,
  }];

  if (deterministic.metrics.soldUnits > 0) {
    evidence.push({
      source: "Shopify orders",
      quote: `${deterministic.metrics.soldUnits} units sold in the scan window`,
      weight: `${deterministic.metrics.windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS}-day order window`,
    });
  }

  if (deterministic.metrics.returnUnits > 0 || deterministic.metrics.topReturnReasons.length) {
    const returnInsights = textInsights.returns || {};
    const otherClassifications = Array.isArray(textInsights.otherReturnClassifications) ? textInsights.otherReturnClassifications : [];
    evidence.push({
      source: "Shopify returns",
      quote: deterministic.metrics.topReturnReasons.length ? deterministic.metrics.topReturnReasons.join(", ") : "Return units detected",
      weight: `${deterministic.metrics.returnUnits} return units, ${deterministic.metrics.returnRate}% return rate`,
      points: [
        returnInsights.sentiment?.total
          ? `Return-note sentiment: ${returnInsights.sentiment.negative} negative, ${returnInsights.sentiment.neutral} neutral, ${returnInsights.sentiment.positive} positive`
          : "",
        returnInsights.emotions?.length
          ? `Return-note emotions: ${formatEmotionCounts(returnInsights.emotions)}`
          : "",
        returnInsights.subjectiveNegativity?.count
          ? `Subjective return-note reactions: ${returnInsights.subjectiveNegativity.count} of ${returnInsights.subjectiveNegativity.total}`
          : "",
        ...otherClassifications.map((item) => `"Other" notes classified as ${item.label} ${item.count} time${item.count === 1 ? "" : "s"}`),
        ...((returnInsights.repeatedLanguage || []).slice(0, 3).map((item) => `Repeated return language: "${item.term}" (${item.count})`)),
        ...((returnInsights.examples || []).slice(0, 3).map((item) => `Return text: "${item.text}"`)),
      ].filter(Boolean),
    });
  }

  if (deterministic.metrics.refundUnits > 0 || deterministic.metrics.refundAmount > 0) {
    const refundInsights = deterministic.metrics.refundInsights || {};
    evidence.push({
      source: "Shopify refunds",
      quote: `${formatMoney(deterministic.metrics.refundAmount)} refunded`,
      weight: `${deterministic.metrics.refundUnits} refunded units, ${deterministic.metrics.refundRate}% refund rate`,
      points: [
        refundInsights.highPressure
          ? `High refund pressure: ${refundInsights.refundRate}% refund rate across ${refundInsights.soldUnits} sold units`
          : "",
        refundInsights.noteCount
          ? `Operational refund notes: ${refundInsights.noteCount} analyzed`
          : "",
        refundInsights.reasonCount
          ? `Refund reasons/restock context: ${refundInsights.reasonCount} signal${refundInsights.reasonCount === 1 ? "" : "s"} analyzed`
          : "",
        refundInsights.sentiment?.total
          ? `Refund-note tone: ${refundInsights.sentiment.negative} negative, ${refundInsights.sentiment.neutral} neutral, ${refundInsights.sentiment.positive} positive`
          : "",
        ...((refundInsights.topReasons || []).slice(0, 3).map((item) => `Refund reason/context: "${item.label}" (${item.count})`)),
        ...((refundInsights.repeatedLanguage || []).slice(0, 3).map((item) => `Repeated refund-note language: "${item.term}" (${item.count})`)),
        ...((refundInsights.examples || []).slice(0, 3).map((item) => `Refund note: "${item.text}"`)),
      ].filter(Boolean),
    });
  }

  buildReviewEvidenceEntries({ deterministic, textInsights, judgeMeData, yotpoData, looxData, csvReviewData }).forEach((entry) => evidence.push(entry));

  if (textInsights.sentiment?.total || textInsights.repeatedLanguage?.length || ai.classification?.sentiment_summary?.summary) {
    const refundInsights = deterministic.metrics.refundInsights || {};
    const customerLanguageTotal = Number(textInsights.sentiment?.total || 0) + Number(refundInsights.sentiment?.total || 0);
    const customerLanguageNegative = Number(textInsights.sentiment?.negative || 0) + Number(refundInsights.sentiment?.negative || 0);
    const customerLanguageNeutral = Number(textInsights.sentiment?.neutral || 0) + Number(refundInsights.sentiment?.neutral || 0);
    const customerLanguagePositive = Number(textInsights.sentiment?.positive || 0) + Number(refundInsights.sentiment?.positive || 0);
    evidence.push({
      source: "Customer language analysis",
      quote: ai.classification?.sentiment_summary?.summary || `Dominant sentiment: ${textInsights.sentiment?.dominant || "neutral"}`,
      weight: `${customerLanguageTotal || 0} customer text signal${customerLanguageTotal === 1 ? "" : "s"} analyzed across reviews, returns and refund notes`,
      points: [
        customerLanguageTotal
          ? `${customerLanguageNegative} negative, ${customerLanguageNeutral} neutral, ${customerLanguagePositive} positive customer-language signals`
          : "",
        textInsights.returns?.sentiment?.total
          ? `Returns sentiment: ${textInsights.returns.sentiment.negative} negative, ${textInsights.returns.sentiment.neutral} neutral, ${textInsights.returns.sentiment.positive} positive`
          : "",
        textInsights.reviews?.sentiment?.total
          ? `Reviews sentiment: ${textInsights.reviews.sentiment.negative} negative, ${textInsights.reviews.sentiment.neutral} neutral, ${textInsights.reviews.sentiment.positive} positive`
          : "",
        refundInsights.sentiment?.total
          ? `Refund-note sentiment: ${refundInsights.sentiment.negative} negative, ${refundInsights.sentiment.neutral} neutral, ${refundInsights.sentiment.positive} positive`
          : "",
        refundInsights.noteCount
          ? `Refund-note patterns: ${refundInsights.noteCount} operational note${refundInsights.noteCount === 1 ? "" : "s"} analyzed as customer language`
          : "",
        refundInsights.reasonCount
          ? `Refund reason/context patterns: ${refundInsights.reasonCount} operational signal${refundInsights.reasonCount === 1 ? "" : "s"} analyzed as customer language`
          : "",
        textInsights.emotions?.length
          ? `Known emotion taxonomy: ${formatEmotionCounts(textInsights.emotions)}`
          : "",
        textInsights.subjectiveNegativity?.count
          ? `Subjective negative reactions: ${textInsights.subjectiveNegativity.count} of ${textInsights.subjectiveNegativity.total} customer text signals`
          : "",
        aiKnownEmotions.length
          ? `AI emotion taxonomy: ${formatEmotionCounts(aiKnownEmotions)}`
          : "",
        ...((Array.isArray(textInsights.otherReturnClassifications) ? textInsights.otherReturnClassifications : []).slice(0, 5).map((item) => `"Other" return notes classified as ${item.label} ${item.count} time${item.count === 1 ? "" : "s"}`)),
        ...((textInsights.repeatedLanguage || []).slice(0, 5).map((item) => `"${item.term}" repeated ${item.count} time${item.count === 1 ? "" : "s"} across ${item.sources.join(" and ")}`)),
        ...((refundInsights.repeatedLanguage || []).slice(0, 4).map((item) => `Refund-note language: "${item.term}" repeated ${item.count} time${item.count === 1 ? "" : "s"}`)),
        ...getFilteredAiRepeatedLanguage(ai).slice(0, 3).map((item) => `AI repeated-language finding: "${item.term}" - ${item.explanation || item.sentiment || "review"}`),
        ...aiEmergentSentiments.slice(0, 4).map((item) => `Emergent sentiment: ${item.label} (${item.signals} signal${item.signals === 1 ? "" : "s"}) - ${item.merchantSummary}`),
      ].filter(Boolean),
    });
  }

  if (deterministic.metrics.affectedVariants.length) {
    evidence.push({
      source: "Variants",
      quote: deterministic.metrics.affectedVariants.join(", "),
      weight: "Signals are concentrated by variant/SKU.",
    });
  }

  if (deterministic.metrics.contentAnalysis?.issues?.length) {
    const contentAnalysis = deterministic.metrics.contentAnalysis;
    evidence.push({
      source: "Product content",
      quote: contentAnalysis.summary || contentAnalysis.issues.map((issue) => issue.label).join(", "),
      weight: `${deterministic.metrics.descriptionWordCount || 0} description words, content score ${contentAnalysis.score}/100`,
    });
  }

  if (shopifyData.orderAccessDenied) {
    evidence.push({
      source: "Shopify order access",
      quote: "Order access was denied by Shopify for this app installation.",
      weight: "ProductPulse reused stored Catalog Scan metrics where available.",
    });
  }

  const aiEvidence = buildAiEvidenceSynthesisEntry(ai, aiEvidenceSynthesisSections);
  if (aiEvidence) {
    evidence.unshift(aiEvidence);
  }

  return evidence.slice(0, 8);
}

function buildAiEvidenceSynthesisEntry(ai = {}, sections = []) {
  const summary = String(ai.report?.evidence_summary || "").trim();
  if (!summary && !sections.length) return null;
  return {
    source: "AI evidence synthesis",
    quote: summary,
    weight: "Generated from deterministic metrics and stored snippets.",
    points: sections.map((section) => ({
      section_key: section.sectionKey,
      source_key: section.sourceKey,
      source_title: section.sourceTitle,
      title: section.title,
      body: section.body,
    })),
  };
}

function normalizeAiEvidenceSynthesisSections(sections = []) {
  return (Array.isArray(sections) ? sections : [])
    .map((section, index) => normalizeAiEvidenceSynthesisSection(section, index))
    .filter(Boolean)
    .filter((section, index, allSections) => allSections.findIndex((item) => item.sectionKey === section.sectionKey && item.body === section.body) === index)
    .slice(0, 8);
}

function normalizeAiEvidenceSynthesisSection(section, index = 0) {
  if (typeof section === "string") {
    const [rawLabel, ...rest] = section.split(":");
    const body = (rest.length ? rest.join(":") : section).trim();
    if (!body) return null;
    const sectionKey = normalizeAiEvidenceSynthesisSectionKey(rest.length ? rawLabel : "");
    return {
      sectionKey,
      title: getAiEvidenceSynthesisSectionTitle(sectionKey, rest.length ? rawLabel : "", index),
      body,
    };
  }
  if (!section || typeof section !== "object") return null;
  const body = String(section.body || section.text || section.summary || section.detail || "").replace(/\s+/g, " ").trim();
  if (!body) return null;
  const rawKey = section.section_key || section.sectionKey || section.key || section.section || section.title || section.label || "";
  const sourceTitle = String(section.source_title || section.sourceTitle || section.provider_title || section.providerTitle || "").replace(/\s+/g, " ").trim();
  const sourceKey = normalizeAiEvidenceProviderKey(section.source_key || section.sourceKey || section.provider_key || section.providerKey || sourceTitle);
  const sectionKey = normalizeAiEvidenceSynthesisSectionKey(rawKey);
  return {
    sectionKey,
    sourceKey,
    sourceTitle,
    title: getAiEvidenceSynthesisSectionTitle(sectionKey, section.title || section.label || "", index),
    body,
  };
}

function normalizeAiEvidenceSynthesisSectionKey(value = "") {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (normalized.includes("product_orders_retention") || normalized.includes("product_order_retention") || normalized.includes("orders_retention") || normalized.includes("order_retention") || normalized.includes("retention") || normalized.includes("ltv")) return "product_orders_retention";
  if (normalized.includes("refund") || normalized.includes("return") || normalized.includes("post_purchase") || normalized.includes("postpurchase")) return "post_purchase";
  if (normalized.includes("customer") || normalized.includes("language") || normalized.includes("review") || normalized.includes("sentiment")) return "customer_language";
  if (normalized.includes("variant") || normalized.includes("sku") || normalized.includes("option")) return "variant_scope";
  if (normalized.includes("pdp") || normalized.includes("catalog") || normalized.includes("content") || normalized.includes("description") || normalized.includes("shopify_product")) return "pdp_catalog";
  if (normalized.includes("operational") || normalized.includes("risk") || normalized.includes("confidence") || normalized.includes("impact") || normalized.includes("exposure")) return "operational_interpretation";
  if (normalized.includes("cross") || normalized.includes("source")) return "cross_source";
  return "stored_synthesis";
}

function getAiEvidenceSynthesisSectionTitle(sectionKey = "", fallback = "", index = 0) {
  if (sectionKey === "cross_source") return "Cross-source reading";
  if (sectionKey === "customer_language") return "Customer language";
  if (sectionKey === "product_orders_retention") return "Product, orders and retention";
  if (sectionKey === "post_purchase") return "Refund and return evidence";
  if (sectionKey === "pdp_catalog") return "PDP and catalog context";
  if (sectionKey === "variant_scope") return "Variant scope";
  if (sectionKey === "operational_interpretation") return "Operational interpretation";
  const fallbackTitle = String(fallback || "").trim();
  return fallbackTitle || (index === 0 ? "Stored synthesis" : "Additional synthesis");
}

function normalizeAiEvidenceProviderKey(value = "") {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  if (!normalized) return "";
  if (normalized.includes("csv")) return "csv_reviews";
  if (normalized.includes("judge") || normalized.includes("judgeme")) return "judgeme_reviews";
  if (normalized.includes("yotpo")) return "yotpo_reviews";
  if (normalized.includes("loox")) return "loox_reviews";
  if (normalized.includes("review")) return normalized;
  return normalized;
}

function buildReviewEvidenceEntries({ deterministic, textInsights, judgeMeData, yotpoData, looxData, csvReviewData }) {
  const stats = deterministic.metrics.reviewSourceStats || {};
  const reviewInsights = textInsights.reviews || {};
  const entries = [];
  const sources = [
    { key: "judgeMe", label: "Judge.me reviews", connected: Boolean(judgeMeData?.connected) },
    { key: "yotpo", label: "Yotpo reviews", connected: Boolean(yotpoData?.connected) },
    { key: "loox", label: "Loox reviews", connected: Boolean(looxData?.connected) },
    { key: "csv", label: "CSV reviews", connected: Boolean(csvReviewData?.connected) },
  ];

  sources.forEach((source) => {
    const sourceStats = stats[source.key] || {};
    if (!sourceStats.reviewCount) return;

    entries.push({
      source: source.label,
      quote: `${sourceStats.negativeReviewCount || 0} negative reviews out of ${sourceStats.reviewCount || 0}`,
      weight: `${sourceStats.avgRating || 0} average rating, ${sourceStats.negativeReviewRate || 0}% negative review rate`,
      points: [
        sourceStats.recentNegativeReviewCount
          ? `${sourceStats.recentNegativeReviewCount} recent negative review${sourceStats.recentNegativeReviewCount === 1 ? "" : "s"}`
          : "",
        source.key === "csv" && sourceStats.reviewCount
          ? "CSV review text, rating and review date were included in AI classification."
          : "",
        source.key === "judgeMe" && sourceStats.reviewCount
          ? "Judge.me review text, rating and review date were included in AI classification."
          : "",
        source.key === "yotpo" && sourceStats.reviewCount
          ? "Yotpo review text, rating and review date were included in AI classification."
          : "",
        source.key === "loox" && sourceStats.reviewCount
          ? "Loox review text, rating and review date were included in AI classification."
          : "",
        ...getReviewExamplesForSource(reviewInsights, source.key),
      ].filter(Boolean),
    });
  });

  if (!entries.length && deterministic.metrics.reviewCount > 0) {
    entries.push({
      source: "Reviews",
      quote: `${deterministic.metrics.negativeReviewCount} negative reviews out of ${deterministic.metrics.reviewCount}`,
      weight: `${deterministic.metrics.avgRating || 0} average rating, ${deterministic.metrics.negativeReviewRate}% negative review rate`,
    });
  }

  if (entries.length && reviewInsights.sentiment?.total) {
    const reviewEmotionText = formatReviewEvidenceEmotionCounts(textInsights, reviewInsights);
    entries[0].points = [
      `Review sentiment: ${reviewInsights.sentiment.negative} negative, ${reviewInsights.sentiment.neutral} neutral, ${reviewInsights.sentiment.positive} positive`,
      reviewEmotionText ? `Review emotions: ${reviewEmotionText}` : "",
      ...((reviewInsights.repeatedLanguage || []).slice(0, 3).map((item) => `Repeated review language: "${item.term}" (${item.count})`)),
      ...(entries[0].points || []),
    ].filter(Boolean);
  }

  return entries;
}

function formatReviewEvidenceEmotionCounts(textInsights = {}, reviewInsights = {}) {
  const sentiment = reviewInsights.sentiment || {};
  const sourceEmotions = Array.isArray(reviewInsights.emotions) ? reviewInsights.emotions : [];
  const aiKnownEmotions = Array.isArray(textInsights.aiKnownEmotions) ? textInsights.aiKnownEmotions : [];
  let rows = sourceEmotions;
  if (Number(sentiment.total || 0) && Number(sentiment.negative || 0) === 0 && Number(sentiment.positive || 0) > 0) {
    const positiveAiRows = aiKnownEmotions.filter((item) => getEmotionPolarity(normalizeEmotionCode(item.code || item.label)) === "positive");
    const nonNegativeRows = sourceEmotions.filter((item) => getEmotionPolarity(normalizeEmotionCode(item.code || item.label)) !== "negative");
    rows = positiveAiRows.length ? positiveAiRows : nonNegativeRows;
  }
  return formatEmotionCounts(rows);
}

function getReviewEvidenceLabel(metrics = {}) {
  const hasJudgeMe = Number(metrics.judgeMeReviewCount || 0) > 0;
  const hasYotpo = Number(metrics.yotpoReviewCount || 0) > 0;
  const hasLoox = Number(metrics.looxReviewCount || 0) > 0;
  const hasCsv = Number(metrics.csvReviewCount || 0) > 0;
  if ([hasJudgeMe, hasYotpo, hasLoox, hasCsv].filter(Boolean).length > 1) return "Connected reviews";
  if (hasCsv) return "CSV reviews";
  if (hasLoox) return "Loox reviews";
  if (hasYotpo) return "Yotpo reviews";
  if (hasJudgeMe) return "Judge.me reviews";
  return "Reviews";
}

function getReviewExamplesForSource(reviewInsights, sourceKey) {
  const sourceType = sourceKey === "csv"
    ? "csv_review"
    : sourceKey === "yotpo"
      ? "yotpo_review"
      : sourceKey === "loox"
        ? "loox_review"
        : "judgeme_review";
  return (Array.isArray(reviewInsights.examples) ? reviewInsights.examples : [])
    .filter((item) => !item.source || item.source === sourceType)
    .slice(0, 3)
    .map((item) => `Review text: "${item.text}"`);
}

function buildCheckedSources(deterministic) {
  return deterministic.sourceCoverage.map((source) => ({
    source,
    checked: true,
    windowDays: source.toLowerCase().includes("order") || source.toLowerCase().includes("return") || source.toLowerCase().includes("refund")
      ? deterministic.metrics.windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS
      : null,
  }));
}

async function shopifyGraphql(admin, query, variables = {}) {
  const response = await admin.graphql(query, { variables });
  const json = await response.json();
  if (json.errors?.length) {
    const error = new Error(json.errors.map((item) => item.message).join("; "));
    error.graphqlErrors = json.errors;
    throw error;
  }
  return json.data || {};
}

async function judgeMeGet({ baseUrl, path, shop, token, params = {} }) {
  const url = new URL(`${baseUrl}${path}`);
  url.searchParams.set("shop_domain", shop);
  url.searchParams.set("api_token", token);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  });

  const response = await fetch(url);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json.error || json.message || `Judge.me request failed with HTTP ${response.status}.`);
    error.status = response.status;
    throw error;
  }
  return json;
}

function normalizeShopifyProduct(product, snapshot) {
  if (!product) return normalizeSnapshotProduct(snapshot);
  const collectionRecords = getProductCollectionRecords(product);
  const variants = getNodes(product.variants).map((variant) => ({
    id: variant.id,
    numericId: String(variant.legacyResourceId || extractNumericShopifyId(variant.id) || ""),
    title: variant.title || "",
    sku: variant.sku || "",
    price: normalizeMoneyValue(variant.price),
    compareAtPrice: normalizeMoneyValue(variant.compareAtPrice),
    inventoryQuantity: Number.isFinite(Number(variant.inventoryQuantity)) ? Number(variant.inventoryQuantity) : null,
    inventoryPolicy: variant.inventoryPolicy || "",
    inventoryItemId: variant.inventoryItem?.id || "",
    inventoryTracked: Boolean(variant.inventoryItem?.tracked),
    selectedOptions: variant.selectedOptions || [],
  }));
  const media = getNodes(product.media).map((item) => {
    const image = item.image || item.preview?.image || {};
    return {
      id: item.id || "",
      alt: item.alt || image.altText || "",
      mediaContentType: item.mediaContentType || "",
      status: item.status || "",
      url: image.url || "",
      width: Number(image.width || 0),
      height: Number(image.height || 0),
    };
  });
  const primaryImage = media.find((item) => item.url) || media[0] || {};

  return {
    id: product.id || snapshot.productGid,
    numericId: String(product.legacyResourceId || extractNumericShopifyId(product.id) || ""),
    title: product.title || snapshot.productTitle,
    handle: product.handle || snapshot.handle,
    imageUrl: primaryImage.url || "",
    imageAlt: primaryImage.alt || product.title || snapshot.productTitle || "",
    createdAt: toIso(product.createdAt),
    updatedAt: toIso(product.updatedAt || product.createdAt),
    description: cleanProductDescription(product),
    descriptionHtml: String(product.descriptionHtml || ""),
    seoTitle: String(product.seo?.title || ""),
    seoDescription: String(product.seo?.description || ""),
    templateSuffix: String(product.templateSuffix || ""),
    vendor: product.vendor || "",
    productType: product.productType || "",
    category: normalizeProductCategory(product.category),
    status: product.status || "Unknown",
    tags: Array.isArray(product.tags) ? product.tags : [],
    options: Array.isArray(product.options) ? product.options : [],
    variants,
    collections: collectionRecords.map((collection) => collection.title).filter(Boolean),
    collectionRecords,
    metafields: getNodes(product.metafields).map((metafield) => ({
      namespace: metafield.namespace,
      key: metafield.key,
      type: metafield.type,
      value: String(metafield.value || "").slice(0, 500),
    })),
    media,
  };
}

function getNormalizedProductImage(product = {}, fallbackMetrics = {}) {
  const firstMedia = Array.isArray(product.media) ? product.media.find((item) => item?.url) || product.media[0] || {} : {};
  const imageUrl = [
    product.imageUrl,
    product.productImageUrl,
    product.featuredImageUrl,
    product.featuredImage?.url,
    product.featuredMedia?.image?.url,
    product.featuredMedia?.preview?.image?.url,
    firstMedia.url,
    firstMedia.imageUrl,
    firstMedia.image?.url,
    firstMedia.preview?.image?.url,
    fallbackMetrics.imageUrl,
    fallbackMetrics.productImageUrl,
    fallbackMetrics.featuredImageUrl,
  ].map((value) => String(value || "").trim()).find(Boolean) || "";
  const imageAlt = [
    product.imageAlt,
    product.productImageAlt,
    product.featuredImageAlt,
    product.featuredImage?.altText,
    product.featuredMedia?.image?.altText,
    product.featuredMedia?.preview?.image?.altText,
    firstMedia.alt,
    firstMedia.imageAlt,
    firstMedia.image?.altText,
    firstMedia.preview?.image?.altText,
    fallbackMetrics.imageAlt,
    fallbackMetrics.productImageAlt,
    fallbackMetrics.featuredImageAlt,
    product.title,
  ].map((value) => String(value || "").trim()).find(Boolean) || "";

  return { imageUrl, imageAlt };
}

function normalizeSnapshotProduct(snapshot) {
  const metrics = snapshot.metrics || {};
  const collectionRecords = getProductCollectionRecords(metrics.collectionRecords || metrics.collections || []);
  return {
    id: snapshot.productGid,
    numericId: extractNumericShopifyId(snapshot.productGid),
    title: snapshot.productTitle,
    handle: snapshot.handle,
    imageUrl: metrics.imageUrl || metrics.productImageUrl || metrics.featuredImageUrl || "",
    imageAlt: metrics.imageAlt || metrics.productImageAlt || metrics.featuredImageAlt || snapshot.productTitle || "",
    createdAt: null,
    updatedAt: null,
    description: "",
    descriptionHtml: "",
    seoTitle: metrics.seoTitle || "",
    seoDescription: metrics.seoDescription || "",
    templateSuffix: metrics.templateSuffix || "",
    vendor: metrics.vendor || "",
    productType: metrics.productType || "",
    category: normalizeProductCategory(metrics.category || {
      id: metrics.categoryId,
      name: metrics.categoryName,
      fullName: metrics.categoryFullName,
    }),
    status: "Unknown",
    tags: Array.isArray(metrics.tags) ? metrics.tags : [],
    options: [],
    variants: [],
    collections: collectionRecords.map((collection) => collection.title).filter(Boolean),
    collectionRecords,
    metafields: [],
    media: [],
  };
}

function getProductCollectionRecords(source = {}) {
  const raw = Array.isArray(source)
    ? source
    : getNodes(source.collections).length
      ? getNodes(source.collections)
      : Array.isArray(source.collectionRecords)
        ? source.collectionRecords
        : [];
  return raw
    .map(normalizeCollectionRecord)
    .filter((collection) => collection.id || collection.title || collection.handle);
}

function normalizeCollectionRecord(collection = {}) {
  if (typeof collection === "string") {
    return {
      id: "",
      title: collection.replace(/\s+/g, " ").trim(),
      handle: "",
      isRuleBased: false,
    };
  }
  return {
    id: String(collection.id || collection.collectionId || "").trim(),
    title: String(collection.title || collection.collectionName || collection.name || "").replace(/\s+/g, " ").trim(),
    handle: String(collection.handle || collection.collectionHandle || "").trim(),
    isRuleBased: Boolean(collection.ruleSet || collection.isRuleBased || collection.smartCollection),
  };
}

function hasProductCollectionMembership(product = {}) {
  return getProductCollectionRecords(product).length > 0;
}

function normalizeProductCategory(category = null) {
  if (!category || typeof category !== "object") {
    return { id: "", name: "", fullName: "", isLeaf: false, isArchived: false, level: 0 };
  }
  const id = String(category.id || category.categoryId || "").trim();
  const name = String(category.name || category.label || category.categoryName || "").replace(/\s+/g, " ").trim();
  const fullName = String(category.fullName || category.full_name || category.path || category.categoryFullName || name).replace(/\s+/g, " ").trim();
  return {
    id,
    name,
    fullName,
    isLeaf: Boolean(category.isLeaf),
    isArchived: Boolean(category.isArchived),
    level: Number.isFinite(Number(category.level)) ? Number(category.level) : 0,
    source: String(category.source || "").trim(),
  };
}

function cleanProductDescription(product = {}) {
  const plainDescription = String(product.description || "").trim();
  if (plainDescription) return stripHtml(plainDescription);
  return stripHtml(product.descriptionHtml || "");
}

function normalizeMoneyValue(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "object") return Number(value.amount || value.value || 0);
  const amount = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(amount) ? amount : null;
}

function lineItemMatchesProduct(lineItem, product, snapshot) {
  const lineProduct = lineItem?.product || {};
  const variantProduct = lineItem?.variant?.product || {};
  if (lineProduct.id && (lineProduct.id === product.id || lineProduct.id === snapshot.productGid)) return true;
  if (variantProduct.id && (variantProduct.id === product.id || variantProduct.id === snapshot.productGid)) return true;
  if (lineProduct.handle && (lineProduct.handle === product.handle || lineProduct.handle === snapshot.handle)) return true;
  if (variantProduct.handle && (variantProduct.handle === product.handle || variantProduct.handle === snapshot.handle)) return true;
  const numericProductId = product.numericId || extractNumericShopifyId(snapshot.productGid);
  if (numericProductId && String(lineProduct.id || "").endsWith(`/${numericProductId}`)) return true;
  if (numericProductId && String(lineProduct.legacyResourceId || "") === String(numericProductId)) return true;
  if (numericProductId && String(variantProduct.id || "").endsWith(`/${numericProductId}`)) return true;
  if (numericProductId && String(variantProduct.legacyResourceId || "") === String(numericProductId)) return true;

  const lineSku = normalizeText(lineItem?.sku || lineItem?.variant?.sku || "");
  const productSkus = new Set((product.variants || []).map((variant) => normalizeText(variant.sku)).filter(Boolean));
  if (lineSku && productSkus.has(lineSku)) return true;

  const lineVariantId = extractNumericShopifyId(lineItem?.variant?.id);
  const productVariantIds = new Set((product.variants || []).flatMap((variant) => [
    String(variant.id || ""),
    String(variant.numericId || ""),
    extractNumericShopifyId(variant.id),
  ]).filter(Boolean));
  if (lineVariantId && productVariantIds.has(lineVariantId)) return true;

  const hasStableIdentifier = Boolean(
    lineProduct.id
      || variantProduct.id
      || lineProduct.handle
      || variantProduct.handle
      || lineItem?.variant?.id
      || lineItem?.sku
      || lineItem?.variant?.sku,
  );
  if (hasStableIdentifier) return false;

  const lineTitle = normalizeText(lineItem?.title);
  const productTitle = normalizeText(product.title || snapshot.productTitle);
  if (lineTitle && productTitle && (lineTitle === productTitle || lineTitle.includes(productTitle) || productTitle.includes(lineTitle))) return true;
  if (hasStrongTextOverlap(lineTitle, productTitle)) return true;

  const handleAsTitle = normalizeText(product.handle || snapshot.handle).replace(/-/g, " ");
  return hasStrongTextOverlap(lineTitle, handleAsTitle);
}

function getReturnReasonValue(returnLineItem) {
  const definition = returnLineItem?.returnReasonDefinition || {};
  return String(definition.handle || returnLineItem?.returnReason || definition.name || "").trim();
}

function getReturnReasonLabel(returnLineItem) {
  const definition = returnLineItem?.returnReasonDefinition || {};
  return String(definition.name || definition.handle || returnLineItem?.returnReason || "").trim();
}

function getReturnLineItemReasonNote(returnLineItem) {
  return String(returnLineItem?.returnReasonNote || "").replace(/\s+/g, " ").trim();
}

function getReturnLineItemCustomerNote(returnLineItem) {
  return String(returnLineItem?.customerNote || "").replace(/\s+/g, " ").trim();
}

function getReturnLineItemNoteText(returnLineItem) {
  return [getReturnLineItemReasonNote(returnLineItem), getReturnLineItemCustomerNote(returnLineItem)].filter(Boolean).join(" ");
}

function getRefundAdjustmentReasons(refund = {}) {
  return getNodes(refund.orderAdjustments)
    .map((adjustment) => normalizeRefundReasonLabel(adjustment.reason))
    .filter((reason) => reason && !isDefaultCustomerLanguageTerm(reason));
}

function getRefundNoteText(item = {}) {
  return String(item.note || item.refundNote || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getRefundReasonText(item = {}) {
  const noteText = getRefundNoteText(item);
  const primaryReasons = [
    ...(Array.isArray(item.adjustmentReasons) ? item.adjustmentReasons : []),
    item.reasonLabel,
    item.reason,
  ]
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter((value) => value && !isDefaultCustomerLanguageTerm(value) && !isLowInformationRefundReason(value, { hasNote: Boolean(noteText) }));
  const restockReason = normalizeRefundReasonLabel(item.restockType);
  const reasons = primaryReasons.length
    ? primaryReasons
    : [restockReason].filter((value) => value && !isDefaultCustomerLanguageTerm(value) && !isLowInformationRefundReason(value, { hasNote: Boolean(noteText) }));

  const uniqueReasons = uniqueBy(reasons, (value) => normalizeText(value));
  const compactReasons = uniqueReasons.filter((reason, index) => {
    const normalized = normalizeText(reason);
    return !uniqueReasons.some((otherReason, otherIndex) => {
      if (otherIndex === index) return false;
      const otherNormalized = normalizeText(otherReason);
      return otherNormalized.length > normalized.length && otherNormalized.includes(normalized);
    });
  });

  return compactReasons.join(" - ");
}

function isLowInformationRefundReason(value, { hasNote = false } = {}) {
  const normalized = normalizeText(value);
  if (!normalized) return true;
  if (normalized === "refund discrepancy") return true;
  if (hasNote && ["no restock", "no_restock", "restock discrepancy", "order level refund"].includes(normalized)) return true;
  return false;
}

function normalizeRefundReasonLabel(value) {
  const normalized = String(value || "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) return "";
  if (normalized === "no restock") return "No restock";
  if (normalized === "cancel") return "Canceled before fulfillment";
  if (normalized === "return") return "Returned item restocked";
  if (normalized === "damage") return "Damage";
  if (normalized === "customer") return "Customer request";
  if (normalized === "restock") return "Restock discrepancy";
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function extractJudgeMeProduct(json) {
  return json?.product || json?.data?.product || json?.data || json || null;
}

function extractJudgeMeReviews(json) {
  const candidates = [
    json?.reviews,
    json?.data?.reviews,
    json?.product_reviews,
    json?.data?.product_reviews,
    json?.review ? [json.review] : null,
  ];
  return candidates.find((candidate) => Array.isArray(candidate)) || [];
}

function normalizeJudgeMeReview(review, snapshot, product) {
  if (!review) return null;
  const body = stripHtml(review.body || review.review || review.content || review.text || "");
  const title = review.title || review.review_title || "";
  return {
    id: String(review.id || review.review_id || `${snapshot.productGid}-${title}-${body}`),
    rating: Number(review.rating || review.score || 0),
    title,
    body,
    createdAt: toIso(review.created_at || review.createdAt || review.date),
    published: review.published ?? review.published_at ?? true,
    productId: String(review.product_id || review.product?.id || ""),
    externalProductId: String(review.external_product_id || review.product_external_id || review.product?.external_id || product.numericId || ""),
    handle: review.product_handle || review.handle || review.product?.handle || snapshot.handle,
    photos: review.pictures || review.photos || review.images || [],
    sourceType: "judgeme_review",
    sourceLabel: "Judge.me reviews",
  };
}

function normalizeYotpoReview(review, snapshot, product, matchConfidence = 0) {
  if (!review) return null;
  const body = stripHtml(review.content || review.body || review.review || review.text || review.comment || "");
  const title = stripHtml(review.title || review.review_title || "");
  const rating = Number(review.score || review.rating || review.stars || 0);
  if (!rating || (!body && !title)) return null;
  const productId = getYotpoReviewProductId(review);
  return {
    id: String(review.id || review.review_id || `yotpo-review-${stableSignature([snapshot.productGid, productId, rating, title, body].join("|"))}`),
    rating,
    title,
    body,
    createdAt: toIso(review.created_at || review.createdAt || review.date || review.created),
    published: review.published ?? review.deleted !== true,
    productId,
    externalProductId: String(review.domain_key || review.product?.domain_key || review.product?.external_id || product.numericId || ""),
    handle: getYotpoReviewProductHandle(review) || snapshot.handle,
    reviewerName: review.user?.display_name || review.user?.name || review.name || review.reviewer_name || "",
    photos: review.images || review.pictures || review.photos || [],
    sourceType: "yotpo_review",
    sourceLabel: "Yotpo reviews",
    matchConfidence,
  };
}

function normalizeLooxReview(review, snapshot, product, matchConfidence = 0) {
  if (!review) return null;
  const body = stripHtml(review.body || review.content || review.review || review.text || review.comment || review.message || "");
  const title = stripHtml(review.title || review.review_title || "");
  const rating = Number(review.rating || review.score || review.stars || 0);
  if (!rating || (!body && !title)) return null;
  const productId = getLooxReviewProductId(review);
  return {
    id: String(review.id || review.review_id || `loox-review-${stableSignature([snapshot.productGid, productId, rating, title, body].join("|"))}`),
    rating,
    title,
    body,
    createdAt: toIso(review.date || review.createdAt || review.created_at || review.created),
    published: review.status ? String(review.status).toLowerCase() === "published" : review.published ?? true,
    productId,
    externalProductId: String(review.product_id || review.productId || review.product?.id || product.numericId || ""),
    handle: getLooxReviewProductHandle(review) || snapshot.handle,
    reviewerName: review.reviewer?.name || review.user?.display_name || review.user?.name || review.name || review.reviewer_name || "",
    photos: review.media || review.images || review.pictures || review.photos || [],
    sourceType: "loox_review",
    sourceLabel: "Loox reviews",
    matchConfidence,
  };
}

function normalizeCsvDiagnosisReview(row, snapshot, product, matchConfidence = 0) {
  if (!row) return null;
  const body = stripHtml(row.reviewBody || "");
  const title = stripHtml(row.reviewTitle || "");
  const rating = Number(row.rating || 0);
  if (!rating || (!body && !title)) return null;
  const createdAt = toIso(row.reviewDate);
  const stableReviewId = stableSignature([
    snapshot.productGid,
    row.sourceProductId || "",
    row.shopifyProductId || product.numericId || "",
    row.productHandle || snapshot.handle || "",
    rating,
    title,
    body,
    getReviewDateCacheBucket(createdAt),
    row.reviewerName || "",
  ].join("|"));

  return {
    id: String(row.id || `csv-review-${stableReviewId}`),
    rating,
    title,
    body,
    createdAt,
    published: true,
    productId: String(row.sourceProductId || ""),
    externalProductId: String(row.shopifyProductId || product.numericId || ""),
    handle: row.productHandle || snapshot.handle,
    reviewerName: row.reviewerName || "",
    reviewStatus: row.reviewStatus || "",
    sourceProductId: row.sourceProductId || "",
    sourceRow: row.sourceRow || null,
    sourceType: "csv_review",
    sourceLabel: "CSV reviews",
    matchConfidence,
    photos: [],
  };
}

function normalizeReviewSource(review, sourceType, sourceLabel) {
  return {
    ...review,
    sourceType: review.sourceType || sourceType,
    sourceLabel: review.sourceLabel || sourceLabel,
  };
}

function filterReviewsByLookbackWindow(reviews = [], windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS) {
  const cutoff = Date.now() - Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS)) * 24 * 60 * 60 * 1000;
  return reviews.filter((review) => {
    if (!review?.createdAt) return true;
    const time = new Date(review.createdAt).getTime();
    return !Number.isFinite(time) || time >= cutoff;
  });
}

function getReturnCustomerLanguageText(item) {
  const rawReason = String(item?.reason || item?.reasonLabel || "").replace(/\s+/g, " ").trim();
  const reason = isGenericOtherReason(rawReason) || isDefaultCustomerLanguageTerm(rawReason)
    ? ""
    : rawReason;
  const noteText = [item?.reasonNote, item?.customerNote]
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ");
  return [reason, noteText].filter(Boolean).join(" - ");
}

function getRefundOperationalText(item) {
  const noteText = getRefundNoteText(item);
  const reasonText = getRefundReasonText(item);
  const restockText = normalizeRefundReasonLabel(item?.restockType);
  const includeRestock = !noteText && restockText && !normalizeText(reasonText).includes(normalizeText(restockText));
  return [
    noteText,
    reasonText,
    includeRestock ? restockText : "",
  ].filter(Boolean).join(" - ");
}

function getCustomerAnalysisText(item) {
  return String(item?.analysisText || item?.noteText || item?.text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function getJudgeMeReviewMatchConfidence(review, snapshot, product) {
  const numericId = String(product.numericId || extractNumericShopifyId(snapshot.productGid) || "");
  const identifiers = [
    review.external_product_id,
    review.product_external_id,
    review.external_id,
    review.product?.external_id,
    review.product?.id,
  ].map((value) => String(value || ""));
  if (numericId && identifiers.includes(numericId)) return 1;

  const handle = String(snapshot.handle || product.handle || "").toLowerCase();
  const reviewHandle = String(review.product_handle || review.handle || review.product?.handle || "").toLowerCase();
  if (handle && reviewHandle === handle) return 0.9;

  const reviewUrl = String(review.product_url || review.url || "").toLowerCase();
  if (handle && reviewUrl.includes(`/${handle}`)) return 0.86;

  const title = normalizeText(snapshot.productTitle || product.title);
  const reviewTitle = normalizeText(review.product_title || review.product?.title || "");
  if (title && reviewTitle && title === reviewTitle) return 0.82;
  if (title && reviewTitle && (title.includes(reviewTitle) || reviewTitle.includes(title))) return 0.76;
  return 0;
}

function getYotpoReviewMatchConfidence(review, snapshot, product) {
  const numericId = String(product.numericId || extractNumericShopifyId(snapshot.productGid) || "");
  const identifiers = [
    getYotpoReviewProductId(review),
    review.domain_key,
    review.product_id,
    review.product?.id,
    review.product?.domain_key,
    review.product?.external_id,
  ].map((value) => String(value || ""));
  if (numericId && identifiers.includes(numericId)) return 1;

  const handle = String(snapshot.handle || product.handle || "").trim().toLowerCase();
  const reviewHandle = String(getYotpoReviewProductHandle(review)).trim().toLowerCase();
  if (handle && reviewHandle === handle) return 0.92;

  const reviewUrl = String(review.product_url || review.product?.url || review.url || "").toLowerCase();
  if (handle && reviewUrl.includes(`/${handle}`)) return 0.86;

  const title = normalizeText(snapshot.productTitle || product.title);
  const reviewTitle = normalizeText(review.product_title || review.product?.name || review.product?.title || "");
  if (title && reviewTitle && title === reviewTitle) return 0.82;
  if (title && reviewTitle && (title.includes(reviewTitle) || reviewTitle.includes(title))) return 0.76;
  return 0;
}

function getLooxReviewMatchConfidence(review, snapshot, product) {
  const numericId = String(product.numericId || extractNumericShopifyId(snapshot.productGid) || "");
  const identifiers = [
    getLooxReviewProductId(review),
    review.product_id,
    review.productId,
    review.product?.id,
    review.product?.external_id,
  ].map((value) => String(value || ""));
  if (numericId && identifiers.includes(numericId)) return 1;

  const handle = String(snapshot.handle || product.handle || "").trim().toLowerCase();
  const reviewHandle = String(getLooxReviewProductHandle(review)).trim().toLowerCase();
  if (handle && reviewHandle === handle) return 0.92;

  const reviewUrl = String(review.product_url || review.product?.url || review.url || "").toLowerCase();
  if (handle && reviewUrl.includes(`/${handle}`)) return 0.86;

  const title = normalizeText(snapshot.productTitle || product.title);
  const reviewTitle = normalizeText(review.product_title || review.product?.name || review.product?.title || "");
  if (title && reviewTitle && title === reviewTitle) return 0.82;
  if (title && reviewTitle && (title.includes(reviewTitle) || reviewTitle.includes(title))) return 0.76;
  return 0;
}

function buildYotpoProductReviewIdCandidates(snapshot, product) {
  const numericId = String(product.numericId || extractNumericShopifyId(snapshot.productGid) || "").trim();
  const candidates = [
    numericId ? { productId: numericId, matchConfidence: 1 } : null,
    product.id && !String(product.id).startsWith("gid://") && product.id !== numericId
      ? { productId: String(product.id), matchConfidence: 1 }
      : null,
    snapshot.handle ? { productId: snapshot.handle, matchConfidence: 0.9 } : null,
    product.handle && product.handle !== snapshot.handle ? { productId: product.handle, matchConfidence: 0.9 } : null,
  ].filter(Boolean);
  return uniqueBy(candidates, (candidate) => String(candidate.productId).toLowerCase());
}

function buildLooxProductReviewIdCandidates(snapshot, product) {
  const numericId = String(product.numericId || extractNumericShopifyId(snapshot.productGid) || "").trim();
  const candidates = [
    numericId ? { productId: numericId, matchConfidence: 1 } : null,
    product.id && !String(product.id).startsWith("gid://") && product.id !== numericId
      ? { productId: String(product.id), matchConfidence: 1 }
      : null,
  ].filter(Boolean);
  return uniqueBy(candidates, (candidate) => String(candidate.productId).toLowerCase());
}

function attachYotpoProductIdentifiers(review, productId) {
  if (!productId || !review) return review;
  const product = review.product && typeof review.product === "object" ? review.product : {};
  return {
    ...review,
    product_id: review.product_id || productId,
    domain_key: review.domain_key || product.domain_key || productId,
    product: {
      ...product,
      id: product.id || productId,
      domain_key: product.domain_key || productId,
    },
  };
}

function attachLooxProductIdentifiers(review, productId) {
  if (!productId || !review) return review;
  const product = review.product && typeof review.product === "object" ? review.product : {};
  return {
    ...review,
    product_id: review.product_id || review.productId || productId,
    productId: review.productId || productId,
    product: {
      ...product,
      id: product.id || productId,
    },
  };
}

function getYotpoReviewProductId(review = {}) {
  return String(
    review.product_id
      || review.domain_key
      || review.product?.id
      || review.product?.domain_key
      || review.product?.external_id
      || "",
  );
}

function getLooxReviewProductId(review = {}) {
  return String(
    review.product_id
      || review.productId
      || review.product?.id
      || review.product?.external_id
      || "",
  );
}

function getYotpoReviewProductHandle(review = {}) {
  return String(
    review.product_handle
      || review.handle
      || review.product?.handle
      || review.product?.slug
      || "",
  );
}

function getLooxReviewProductHandle(review = {}) {
  const productUrl = String(review.product_url || review.product?.url || review.url || "");
  const urlHandle = productUrl.split("/products/")[1]?.split(/[?#/]/)[0] || "";
  return String(
    review.product_handle
      || review.handle
      || review.product?.handle
      || review.product?.slug
      || urlHandle
      || "",
  );
}

function getCsvReviewMatchConfidence(row, snapshot, product) {
  const numericId = String(product.numericId || extractNumericShopifyId(snapshot.productGid) || "");
  const productGid = String(product.id || snapshot.productGid || "").toLowerCase();
  const csvProductId = String(row.shopifyProductId || "").trim().toLowerCase();
  const csvProductNumericId = extractNumericShopifyId(csvProductId) || csvProductId;
  if (csvProductId && (csvProductId === productGid || csvProductId === String(snapshot.productGid || "").toLowerCase())) return 1;
  if (numericId && csvProductNumericId && csvProductNumericId === numericId) return 1;

  const handle = String(snapshot.handle || product.handle || "").trim().toLowerCase();
  const csvHandle = String(row.productHandle || "").trim().toLowerCase();
  if (handle && csvHandle === handle) return 0.94;
  if (handle && csvHandle && normalizeText(csvHandle).replace(/\s+/g, "-") === handle) return 0.9;
  return 0;
}

function buildReviewSourceStats(reviews = []) {
  const empty = { reviewCount: 0, negativeReviewCount: 0, avgRating: 0, negativeReviewRate: 0, recentNegativeReviewCount: 0, recentNegativeReviewWindowDays: 30 };
  const stats = {
    judgeMe: { ...empty },
    yotpo: { ...empty },
    loox: { ...empty },
    csv: { ...empty },
    total: { ...empty },
  };

  reviews.forEach((review) => {
    const sourceType = String(review.sourceType || "").toLowerCase();
    const key = sourceType.includes("csv")
      ? "csv"
      : sourceType.includes("yotpo")
        ? "yotpo"
        : sourceType.includes("loox")
          ? "loox"
          : "judgeMe";
    addReviewToStats(stats[key], review);
    addReviewToStats(stats.total, review);
  });

  Object.keys(stats).forEach((key) => finalizeReviewStats(stats[key]));
  return stats;
}

function addReviewToStats(stats, review) {
  stats.reviewCount += 1;
  stats.ratingSum = Number(stats.ratingSum || 0) + Number(review.rating || 0);
  const negative = isNegativeReviewSignal(review);
  if (negative) stats.negativeReviewCount += 1;
  if (negative && isRecentDate(review.createdAt, 30)) stats.recentNegativeReviewCount += 1;
}

function finalizeReviewStats(stats) {
  stats.avgRating = roundRate(stats.reviewCount ? Number(stats.ratingSum || 0) / stats.reviewCount : 0, 1);
  stats.negativeReviewRate = roundRate(stats.reviewCount ? (stats.negativeReviewCount / stats.reviewCount) * 100 : 0);
  delete stats.ratingSum;
  return stats;
}

function buildDiagnosisVariantInsights({ product = {}, sales = [], returns = [], refunds = [], reviews = [] } = {}) {
  const rows = new Map();
  const order = [];
  const productVariants = Array.isArray(product.variants) ? product.variants : [];

  const ensureRow = (variant = {}, source = "shopify") => {
    const normalized = normalizeDiagnosisVariantInsightIdentity(variant);
    if (!normalized.key) return null;
    if (!rows.has(normalized.key)) {
      rows.set(normalized.key, {
        key: normalized.key,
        variantId: normalized.id,
        variantTitle: normalized.title,
        sku: normalized.sku,
        price: normalized.price,
        selectedOptions: normalized.selectedOptions,
        source,
        sales: { units: 0, amount: 0, examples: [] },
        returns: { units: 0, reasons: [], examples: [] },
        refunds: { units: 0, amount: 0, reasons: [], examples: [] },
        reviews: { count: 0, negativeCount: 0, positiveCount: 0, neutralCount: 0, averageRating: 0, ratingSum: 0, sources: {}, examples: [] },
        timeline: new Map(),
      });
      order.push(normalized.key);
    }
    const row = rows.get(normalized.key);
    row.variantId ||= normalized.id;
    row.variantTitle ||= normalized.title;
    row.sku ||= normalized.sku;
    row.price ||= normalized.price;
    if (!row.selectedOptions?.length && normalized.selectedOptions.length) row.selectedOptions = normalized.selectedOptions;
    return row;
  };

  productVariants.forEach((variant) => ensureRow(variant, "shopify"));

  sales.forEach((event) => {
    const row = ensureRow(event, "sales");
    if (!row) return;
    const quantity = Number(event.quantity || 0);
    const amount = Number(event.amount || 0);
    row.sales.units += quantity;
    row.sales.amount += amount;
    addDiagnosisVariantTimelineMetric(row, getOrderCohortDate(event, { includeEventDate: true }), {
      salesUnits: quantity,
      salesAmount: amount,
    });
    if (row.sales.examples.length < 3) {
      row.sales.examples.push({
        quantity,
        amount: roundCurrency(amount),
        createdAt: event.createdAt || null,
      });
    }
  });

  returns.forEach((event) => {
    const row = ensureRow(event, "returns");
    if (!row) return;
    const quantity = Math.max(1, Number(event.quantity || 1));
    const reason = [event.reason, event.reasonNote, event.customerNote].filter(Boolean).join(" - ");
    row.returns.units += quantity;
    if (reason) row.returns.reasons.push(reason);
    addDiagnosisVariantTimelineMetric(row, event.createdAt || event.processedAt || getOrderCohortDate(event), {
      returnUnits: quantity,
    });
    if (row.returns.examples.length < 3) {
      row.returns.examples.push({
        quantity,
        reason: event.reason || "",
        reasonText: getReturnCustomerLanguageText(event) || reason,
        text: getReturnCustomerLanguageText(event) || reason,
        sentiment: classifyCustomerSentiment(getReturnCustomerLanguageText(event) || reason),
        createdAt: event.createdAt || null,
        variant: row.variantTitle,
        variantId: row.variantId,
        sku: row.sku,
      });
    }
  });

  refunds.forEach((event) => {
    const row = ensureRow(event, "refunds");
    if (!row) return;
    const quantity = Math.max(1, Number(event.quantity || 1));
    const amount = Number(event.amount || 0);
    const reason = getRefundOperationalText(event) || getRefundReasonText(event) || event.reasonLabel || event.reason || "";
    row.refunds.units += quantity;
    row.refunds.amount += amount;
    if (reason) row.refunds.reasons.push(reason);
    addDiagnosisVariantTimelineMetric(row, event.createdAt || event.processedAt || getOrderCohortDate(event), {
      refundUnits: quantity,
      refundAmount: amount,
    });
    if (row.refunds.examples.length < 3) {
      row.refunds.examples.push({
        quantity,
        amount: roundCurrency(amount),
        reason: event.reasonLabel || event.reason || event.restockType || "",
        reasonText: reason,
        text: getRefundOperationalText(event) || event.note || reason,
        noteText: event.note || "",
        sentiment: classifyCustomerSentiment(getRefundOperationalText(event) || event.note || reason),
        createdAt: event.createdAt || event.processedAt || null,
        variant: row.variantTitle,
        variantId: row.variantId,
        sku: row.sku,
      });
    }
  });

  reviews.forEach((review) => {
    const row = matchReviewToDiagnosisVariantInsight(review, rows, productVariants);
    if (!row) return;
    const rating = Number(review.rating || 0);
    const text = [review.title, review.body].filter(Boolean).join(" - ");
    const sentiment = classifyCustomerSentiment(text, rating);
    const negative = isNegativeReviewSignal(review);
    const positive = !negative && (sentiment === "positive" || rating >= 4);
    row.reviews.count += 1;
    row.reviews.ratingSum += rating;
    if (negative) row.reviews.negativeCount += 1;
    else if (positive) row.reviews.positiveCount += 1;
    else row.reviews.neutralCount += 1;
    addDiagnosisVariantTimelineMetric(row, review.createdAt, {
      reviewCount: 1,
      negativeReviewCount: negative ? 1 : 0,
      positiveReviewCount: positive ? 1 : 0,
    });
    const sourceLabel = review.sourceLabel || "Reviews";
    row.reviews.sources[sourceLabel] = (row.reviews.sources[sourceLabel] || 0) + 1;
    const storedNegativeExamples = row.reviews.examples.filter((example) => example.sentiment === "negative").length;
    const storedPositiveExamples = row.reviews.examples.filter((example) => example.sentiment === "positive").length;
    const storedNeutralExamples = row.reviews.examples.filter((example) => example.sentiment === "neutral").length;
    const shouldStoreExample = row.reviews.examples.length < 4 && (
      (negative && storedNegativeExamples < 2)
      || (positive && storedPositiveExamples < 2)
      || (!negative && !positive && storedNeutralExamples < 1)
      || row.reviews.examples.length < 1
    );
    if (shouldStoreExample) {
      row.reviews.examples.push({
        title: review.title || "",
        text: truncateText(text || review.body || "", 180),
        rating,
        sentiment,
        source: review.sourceType || "",
        sourceLabel,
        createdAt: review.createdAt || null,
        variant: row.variantTitle,
        variantId: row.variantId,
        sku: row.sku,
      });
    }
  });

  return order
    .map((key) => finalizeDiagnosisVariantInsight(rows.get(key)))
    .filter((row) => row.variantTitle || row.sku || row.variantId)
    .slice(0, 80);
}

function addDiagnosisVariantTimelineMetric(row = {}, dateValue = null, values = {}) {
  const date = parseValidDate(dateValue);
  if (!row?.timeline || !date) return;
  const monthDate = startOfUtcMonth(date);
  const key = formatUtcMonthKey(monthDate);
  const current = row.timeline.get(key) || {
    key,
    label: formatUtcMonthLabel(monthDate),
    shortLabel: formatUtcMonthShortLabel(monthDate),
    startAt: toIso(monthDate),
    salesUnits: 0,
    salesAmount: 0,
    returnUnits: 0,
    refundUnits: 0,
    refundAmount: 0,
    reviewCount: 0,
    negativeReviewCount: 0,
    positiveReviewCount: 0,
  };
  current.salesUnits += Number(values.salesUnits || 0);
  current.salesAmount += Number(values.salesAmount || 0);
  current.returnUnits += Number(values.returnUnits || 0);
  current.refundUnits += Number(values.refundUnits || 0);
  current.refundAmount += Number(values.refundAmount || 0);
  current.reviewCount += Number(values.reviewCount || 0);
  current.negativeReviewCount += Number(values.negativeReviewCount || 0);
  current.positiveReviewCount += Number(values.positiveReviewCount || 0);
  row.timeline.set(key, current);
}

function normalizeDiagnosisVariantTimeline(timeline = new Map()) {
  return [...(timeline instanceof Map ? timeline.values() : [])]
    .sort((first, second) => String(first.key || "").localeCompare(String(second.key || "")))
    .map((point) => ({
      ...point,
      salesUnits: Number(point.salesUnits || 0),
      salesAmount: roundCurrency(point.salesAmount || 0),
      returnUnits: Number(point.returnUnits || 0),
      refundUnits: Number(point.refundUnits || 0),
      refundAmount: roundCurrency(point.refundAmount || 0),
      reviewCount: Number(point.reviewCount || 0),
      negativeReviewCount: Number(point.negativeReviewCount || 0),
      positiveReviewCount: Number(point.positiveReviewCount || 0),
    }));
}

function finalizeDiagnosisVariantInsight(row = {}) {
  const soldUnits = Number(row.sales?.units || 0);
  const returnUnits = Number(row.returns?.units || 0);
  const refundUnits = Number(row.refunds?.units || 0);
  const reviewCount = Number(row.reviews?.count || 0);
  const negativeReviewCount = Number(row.reviews?.negativeCount || 0);
  const signalCount = returnUnits + refundUnits + negativeReviewCount;
  const reviewSources = Object.entries(row.reviews?.sources || {}).map(([label, count]) => ({ label, count }));
  return {
    key: row.key,
    variantId: row.variantId || null,
    variantTitle: row.variantTitle || row.sku || "Variant",
    sku: row.sku || "",
    price: row.price || null,
    selectedOptions: row.selectedOptions || [],
    sales: {
      units: soldUnits,
      amount: roundCurrency(row.sales?.amount || 0),
      examples: row.sales?.examples || [],
    },
    returns: {
      units: returnUnits,
      rate: calculateUnitRatePercent(returnUnits, soldUnits),
      topReasons: countTopValues(row.returns?.reasons || [], 3),
      examples: row.returns?.examples || [],
    },
    refunds: {
      units: refundUnits,
      amount: roundCurrency(row.refunds?.amount || 0),
      rate: calculateUnitRatePercent(refundUnits, soldUnits),
      topReasons: countTopValues(row.refunds?.reasons || [], 3),
      examples: row.refunds?.examples || [],
    },
    reviews: {
      count: reviewCount,
      negativeCount: negativeReviewCount,
      positiveCount: Number(row.reviews?.positiveCount || 0),
      neutralCount: Number(row.reviews?.neutralCount || 0),
      negativeRate: roundRate(reviewCount ? (negativeReviewCount / reviewCount) * 100 : 0),
      averageRating: roundRate(reviewCount ? Number(row.reviews?.ratingSum || 0) / reviewCount : 0, 1),
      sources: reviewSources,
      examples: row.reviews?.examples || [],
    },
    timeline: normalizeDiagnosisVariantTimeline(row.timeline),
    signalCount,
    hasVariantEvidence: Boolean(soldUnits || signalCount || reviewCount),
  };
}

function buildAffectedVariantDetailsFromInsights(variantInsights = []) {
  const rows = (Array.isArray(variantInsights) ? variantInsights : [])
    .map((item) => ({
      label: item.variantTitle || item.sku || "",
      count: Number(item.signalCount || 0),
      returnUnits: Number(item.returns?.units || 0),
      refundUnits: Number(item.refunds?.units || 0),
      negativeReviewCount: Number(item.reviews?.negativeCount || 0),
      detail: [
        Number(item.returns?.units || 0) ? `${item.returns.units} return unit${Number(item.returns.units) === 1 ? "" : "s"}` : "",
        Number(item.refunds?.units || 0) ? `${item.refunds.units} refunded unit${Number(item.refunds.units) === 1 ? "" : "s"}` : "",
        Number(item.reviews?.negativeCount || 0) ? `${item.reviews.negativeCount} negative review${Number(item.reviews.negativeCount) === 1 ? "" : "s"}` : "",
      ].filter(Boolean).join(" · "),
    }))
    .filter((item) => item.label && item.count > 0)
    .sort((first, second) => second.count - first.count)
    .slice(0, 4);
  return rows.length ? rows : null;
}

function normalizeDiagnosisVariantInsightIdentity(value = {}) {
  const selectedOptions = normalizeDiagnosisVariantSelectedOptions(value.selectedOptions || value.options);
  const optionLabel = selectedOptions.map((option) => option.value || option.name).filter(Boolean).join(" / ");
  const rawTitle = value.title || value.variantTitle || value.variant || value.variantName || value.label || "";
  const title = isGenericVariantTitle(rawTitle) ? optionLabel || rawTitle : rawTitle || optionLabel;
  const sku = String(value.sku || value.variantSku || "").trim();
  const id = value.variantId || value.id || null;
  const keyId = value.variantId || (/productvariant/i.test(String(value.id || "")) ? value.id : "");
  const key = normalizeDiagnosisVariantKey(keyId)
    || normalizeDiagnosisVariantKey(sku)
    || normalizeDiagnosisVariantKey(title)
    || normalizeDiagnosisVariantKey(optionLabel);
  return {
    key,
    id,
    title: title || sku || "Variant",
    sku,
    price: value.price || value.unitPrice || value.amount || null,
    selectedOptions,
  };
}

function normalizeDiagnosisVariantSelectedOptions(rawOptions) {
  if (Array.isArray(rawOptions)) {
    return rawOptions.map((option) => (
      typeof option === "string"
        ? { name: "", value: option }
        : { name: option.name || option.label || "", value: option.value || option.name || option.label || "" }
    )).filter((option) => option.value || option.name);
  }
  if (rawOptions && typeof rawOptions === "object") {
    return Object.entries(rawOptions).map(([name, value]) => ({ name, value: String(value || "") })).filter((option) => option.value);
  }
  return [];
}

function normalizeDiagnosisVariantKey(value = "") {
  return normalizeText(String(value || "").replace(/^gid:\/\/shopify\/productvariant\//i, "")).trim();
}

function matchReviewToDiagnosisVariantInsight(review = {}, rows = new Map(), productVariants = []) {
  const direct = normalizeDiagnosisVariantInsightIdentity(review);
  if (direct.key && rows.has(direct.key) && (review.variantId || review.variantTitle || review.variant || review.sku)) return rows.get(direct.key);
  const text = normalizeText([review.title, review.body].filter(Boolean).join(" "));
  if (!text) return null;
  const candidates = Array.from(rows.values());
  const matched = candidates.find((row) => diagnosisReviewMentionsVariant(text, row))
    || productVariants.map((variant) => normalizeDiagnosisVariantInsightIdentity(variant)).find((variant) => diagnosisReviewMentionsVariant(text, variant));
  if (!matched) return null;
  return rows.get(matched.key) || null;
}

function diagnosisReviewMentionsVariant(normalizedText, variant = {}) {
  return getDiagnosisVariantReviewTerms(variant).some((term) => containsNormalizedPhrase(normalizedText, term));
}

function getDiagnosisVariantReviewTerms(variant = {}) {
  const selectedOptions = normalizeDiagnosisVariantSelectedOptions(variant.selectedOptions);
  const values = [
    variant.sku,
    variant.variantTitle,
    variant.title,
    variant.variant,
    variant.variantName,
    ...(selectedOptions || []).map((option) => option.value),
  ];
  return [...new Set(values
    .map((value) => normalizeText(value))
    .filter((value) => value && value !== "default title" && value !== "default variant" && value.length >= 3))];
}

function isNegativeReviewSignal(review = {}) {
  const rating = Number(review.rating || 0);
  const text = [review.title, review.body].filter(Boolean).join(" ");
  return isNegativeReviewTextSignal({
    rating,
    sentiment: classifyCustomerSentiment(text, rating),
    subjectiveNegative: isSubjectiveNegativeText(text),
    text,
  });
}

function isNegativeReviewTextSignal({ rating = 0, sentiment = "", subjectiveNegative = false, text = "" } = {}) {
  const normalizedSentiment = String(sentiment || "").toLowerCase();
  if (Number(rating || 0) > 0 && Number(rating || 0) <= 2) return true;
  if (Number(rating || 0) >= 4) {
    return normalizedSentiment === "negative" && containsExplicitCustomerProblemLanguage(text);
  }
  return Boolean(
    normalizedSentiment === "negative"
    || subjectiveNegative
    || containsExplicitCustomerProblemLanguage(text)
  );
}

function buildSignalEvents({ returns, refunds, negativeReviews }) {
  return [
    ...returns.map((item) => {
      const text = getReturnCustomerLanguageText(item);
      return {
        type: "return",
        createdAt: item.createdAt,
        value: Number(item.quantity || 1),
        text,
        issueCode: classifyIssueText(text),
      };
    }),
    ...refunds.map((item) => {
      const text = getRefundOperationalText(item) || "Refund impact";
      const issueCode = classifyIssueText(text);
      return {
        type: "refund",
        createdAt: item.createdAt,
        value: Number(item.quantity || 1),
        amount: Number(item.amount || 0),
        text,
        issueCode: issueCode === "product_quality" ? "refund_impact" : issueCode,
      };
    }),
    ...negativeReviews.map((item) => {
      const text = [item.title, item.body].filter(Boolean).join(" ");
      return {
        type: "review",
        createdAt: item.createdAt,
        value: 1,
        text,
        issueCode: classifyIssueText(text),
      };
    }),
  ].filter((item) => item.createdAt && String(item.text || "").trim());
}

function buildTemporalSignalWeighting({ signalEvents = [], sales = [], now = new Date() } = {}) {
  const normalizedNow = parseValidDate(now) || new Date();
  const salesOrders = buildSignalWeightSalesOrderTimeline(sales);
  const weightedEvents = (Array.isArray(signalEvents) ? signalEvents : []).map((event) => {
    const signalAt = parseValidDate(event.createdAt);
    const ageDays = signalAt
      ? Math.max(0, (normalizedNow.getTime() - signalAt.getTime()) / (24 * 60 * 60 * 1000))
      : SIGNAL_WEIGHT_FULL_STRENGTH_DAYS;
    const ordersAfterSignal = signalAt ? countSalesOrdersAfterDate(salesOrders, signalAt) : 0;
    const ageWeight = getSignalAgeWeight(ageDays);
    const orderContinuityWeight = getPostSignalOrderContinuityWeight(ordersAfterSignal);
    const weight = clamp(ageWeight * orderContinuityWeight, SIGNAL_WEIGHT_MIN, 1);
    const value = Math.max(0, Number(event.value || 1));
    const amount = Math.max(0, Number(event.amount || 0));
    return {
      ...event,
      signalAt: signalAt ? signalAt.toISOString() : event.createdAt,
      ageDays: roundWeightedSignalCount(ageDays),
      ordersAfterSignal,
      ageWeight: roundWeightedSignalCount(ageWeight),
      orderContinuityWeight: roundWeightedSignalCount(orderContinuityWeight),
      weight: roundWeightedSignalCount(weight),
      weightedValue: roundWeightedSignalCount(value * weight),
      weightedAmount: roundCurrency(amount * weight),
    };
  });
  const byType = summarizeWeightedSignalsByType(weightedEvents);
  const rawValue = Object.values(byType).reduce((total, item) => total + Number(item.rawValue || 0), 0);
  const effectiveValue = Object.values(byType).reduce((total, item) => total + Number(item.effectiveValue || 0), 0);
  const issueSignalCounts = buildWeightedIssueSignalCounts(weightedEvents);
  return {
    events: weightedEvents,
    byType,
    issueSignalCounts,
    averageWeight: rawValue > 0 ? roundWeightedSignalCount(effectiveValue / rawValue) : 1,
    summary: {
      rawSignalCount: roundWeightedSignalCount(rawValue),
      effectiveSignalCount: roundWeightedSignalCount(effectiveValue),
      averageWeight: rawValue > 0 ? roundWeightedSignalCount(effectiveValue / rawValue) : 1,
      fullStrengthWindowDays: SIGNAL_WEIGHT_FULL_STRENGTH_DAYS,
      bucketDays: SIGNAL_WEIGHT_BUCKET_DAYS,
      byType,
    },
  };
}

function buildSignalWeightSalesOrderTimeline(sales = []) {
  const orders = new Map();
  (Array.isArray(sales) ? sales : []).forEach((event, index) => {
    const date = parseValidDate(
      event.orderDate
        || event.orderProcessedAt
        || event.processedAt
        || event.orderCreatedAt
        || event.createdAt
        || event.updatedAt,
    );
    if (!date) return;
    const key = String(event.orderId || event.orderName || event.name || event.id || `sale:${index}`);
    const quantity = Math.max(1, Number(event.quantity || 1));
    const current = orders.get(key);
    if (!current || date < current.date) {
      orders.set(key, { key, date, quantity });
    } else if (current && date.getTime() === current.date.getTime()) {
      current.quantity += quantity;
    }
  });
  return [...orders.values()].sort((first, second) => first.date - second.date);
}

function countSalesOrdersAfterDate(orders = [], date) {
  if (!date) return 0;
  return (Array.isArray(orders) ? orders : []).filter((order) => order.date > date).length;
}

function getSignalAgeWeight(ageDays = 0) {
  const normalizedAgeDays = Math.max(0, Number(ageDays || 0));
  if (normalizedAgeDays <= SIGNAL_WEIGHT_FULL_STRENGTH_DAYS) return 1;
  const bucketDistance = Math.ceil((normalizedAgeDays - SIGNAL_WEIGHT_FULL_STRENGTH_DAYS) / SIGNAL_WEIGHT_BUCKET_DAYS);
  return Math.exp(-SIGNAL_WEIGHT_AGE_DECAY_RATE * Math.pow(bucketDistance, SIGNAL_WEIGHT_AGE_DECAY_EXPONENT));
}

function getPostSignalOrderContinuityWeight(ordersAfterSignal = 0) {
  const orderCount = Math.max(0, Number(ordersAfterSignal || 0));
  return 1 / Math.sqrt(1 + (orderCount / SIGNAL_WEIGHT_ORDER_DECAY_INTERVAL));
}

function summarizeWeightedSignalsByType(events = []) {
  const seed = {
    return: emptyWeightedSignalSummary(),
    refund: emptyWeightedSignalSummary(),
    review: emptyWeightedSignalSummary(),
  };
  (Array.isArray(events) ? events : []).forEach((event) => {
    const key = seed[event.type] ? event.type : "review";
    const current = seed[key];
    current.count += 1;
    current.rawValue += Math.max(0, Number(event.value || 1));
    current.effectiveValue += Math.max(0, Number(event.weightedValue || 0));
    current.rawAmount += Math.max(0, Number(event.amount || 0));
    current.effectiveAmount += Math.max(0, Number(event.weightedAmount || 0));
    current.maxOrdersAfterSignal = Math.max(current.maxOrdersAfterSignal, Number(event.ordersAfterSignal || 0));
    current.minWeight = current.count === 1
      ? Number(event.weight || 1)
      : Math.min(current.minWeight, Number(event.weight || 1));
  });
  return Object.fromEntries(Object.entries(seed).map(([key, value]) => [key, normalizeWeightedSignalSummary(value)]));
}

function emptyWeightedSignalSummary() {
  return {
    count: 0,
    rawValue: 0,
    effectiveValue: 0,
    rawAmount: 0,
    effectiveAmount: 0,
    maxOrdersAfterSignal: 0,
    minWeight: 1,
  };
}

function normalizeWeightedSignalSummary(summary = {}) {
  return {
    count: Number(summary.count || 0),
    rawValue: roundWeightedSignalCount(summary.rawValue),
    effectiveValue: roundWeightedSignalCount(summary.effectiveValue),
    rawAmount: roundCurrency(summary.rawAmount),
    effectiveAmount: roundCurrency(summary.effectiveAmount),
    maxOrdersAfterSignal: Number(summary.maxOrdersAfterSignal || 0),
    minWeight: roundWeightedSignalCount(summary.count ? summary.minWeight : 1),
  };
}

function buildWeightedIssueSignalCounts(events = []) {
  return (Array.isArray(events) ? events : []).reduce((counts, event) => {
    const issue = normalizeIssueCode(event.issueCode);
    if (!issue) return counts;
    counts[issue] = roundWeightedSignalCount((counts[issue] || 0) + Number(event.weightedValue || 0));
    return counts;
  }, {});
}

function mergeWeightedIssueSignalCounts(weightedCounts = {}, rawCounts = {}, averageWeight = 1) {
  const next = { ...(weightedCounts || {}) };
  Object.entries(rawCounts || {}).forEach(([issueCode, count]) => {
    const issue = normalizeIssueCode(issueCode);
    if (!issue || next[issue]) return;
    next[issue] = roundWeightedSignalCount(Number(count || 0) * Number(averageWeight || 1));
  });
  return next;
}

function countWeightedRecentSignalEvents(events = [], days, now = new Date(), type = "") {
  const referenceDate = parseValidDate(now) || new Date();
  const normalizedType = String(type || "").trim();
  return roundWeightedSignalCount((Array.isArray(events) ? events : [])
    .filter((event) => (!normalizedType || event.type === normalizedType) && isRecentDateFrom(event.createdAt, days, referenceDate))
    .reduce((total, event) => total + Number(event.weightedValue || event.value || 0), 0));
}

function roundWeightedSignalCount(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.round(number * 100) / 100;
}

function applyTemporalWeightingToTextInsights(insights = {}, signalWeighting = {}) {
  const returnScale = getWeightedSignalTypeScale(signalWeighting, "return");
  const reviewScale = getWeightedSignalTypeScale(signalWeighting, "review");
  const aggregateScale = getWeightedAggregateSignalScale(signalWeighting, ["return", "review"]);
  const reviews = insights.reviews || {};
  return {
    ...(insights || {}),
    sentiment: scaleSentimentSummary(insights.sentiment, aggregateScale),
    emotions: scaleCountRows(insights.emotions, aggregateScale),
    returns: scaleTextSourceSummary(insights.returns, returnScale),
    reviews: {
      ...scaleTextSourceSummary(reviews, reviewScale),
      bySource: Object.fromEntries(Object.entries(reviews.bySource || {}).map(([key, value]) => [
        key,
        scaleTextSourceSummary(value, reviewScale),
      ])),
    },
    subjectiveNegativity: scaleSubjectiveNegativitySummary(insights.subjectiveNegativity, aggregateScale),
    otherReturnClassifications: scaleCountRows(insights.otherReturnClassifications, returnScale),
    repeatedLanguage: scaleCountRows(insights.repeatedLanguage, aggregateScale),
    granularIssues: scaleIssueSignalRows(insights.granularIssues, aggregateScale),
  };
}

function applyTemporalWeightingToRefundInsights(refundInsights = {}, { effectiveRefundUnits = 0, effectiveRefundRate = 0, effectiveRefundAmount = 0 } = {}) {
  const rawTotal = Math.max(Number(refundInsights.total || 0), Number(refundInsights.refundUnits || 0), 0);
  const scale = rawTotal > 0 ? Math.min(1, Number(effectiveRefundUnits || 0) / rawTotal) : 1;
  const noteCount = roundWeightedSignalCount(Number(refundInsights.noteCount || 0) * scale);
  const reasonCount = roundWeightedSignalCount(Number(refundInsights.reasonCount || 0) * scale);
  const highPressure = Number(refundInsights.soldUnits || 0) > 10
    && Number(effectiveRefundRate || 0) > 20
    && Number(effectiveRefundUnits || 0) >= 3;
  const monitorPressure = Number(effectiveRefundUnits || 0) >= 3 && Number(effectiveRefundRate || 0) >= 10;
  return {
    ...(refundInsights || {}),
    rawTotal,
    rawRefundRate: refundInsights.refundRate,
    rawRefundAmount: refundInsights.refundAmount,
    total: roundWeightedSignalCount(effectiveRefundUnits),
    refundUnits: roundWeightedSignalCount(effectiveRefundUnits),
    refundRate: roundRate(effectiveRefundRate),
    refundAmount: roundCurrency(effectiveRefundAmount),
    noteCount,
    reasonCount,
    highPressure,
    monitorPressure,
    riskLift: calculateRefundOperationalRiskLift({
      refundUnits: effectiveRefundUnits,
      refundRate: effectiveRefundRate,
      soldUnits: refundInsights.soldUnits,
      noteCount: Math.max(noteCount, reasonCount),
    }),
    shouldSurface: Boolean(
      highPressure
      || monitorPressure
      || (Number(effectiveRefundUnits || 0) >= 2 && Math.max(noteCount, reasonCount) >= 2)
    ),
    sentiment: scaleSentimentSummary(refundInsights.sentiment, scale),
    emotions: scaleCountRows(refundInsights.emotions, scale),
    topReasons: scaleCountRows(refundInsights.topReasons, scale),
    repeatedLanguage: scaleCountRows(refundInsights.repeatedLanguage, scale),
    issueCounts: scaleCountRows(refundInsights.issueCounts, scale),
  };
}

function applyTemporalWeightingToReviewSourceStats(reviewSourceStats = {}, signalWeighting = {}) {
  const scale = getWeightedSignalTypeScale(signalWeighting, "review");
  return Object.fromEntries(Object.entries(reviewSourceStats || {}).map(([key, stats]) => {
    const reviewCount = Number(stats?.reviewCount || 0);
    const negativeReviewCount = roundWeightedSignalCount(Number(stats?.negativeReviewCount || 0) * scale);
    return [key, {
      ...(stats || {}),
      rawNegativeReviewCount: Number(stats?.negativeReviewCount || 0),
      negativeReviewCount,
      negativeReviewRate: roundRate(reviewCount ? (negativeReviewCount / reviewCount) * 100 : 0),
    }];
  }));
}

function getWeightedSignalTypeScale(signalWeighting = {}, type = "") {
  const summary = signalWeighting.byType?.[type] || {};
  const rawValue = Number(summary.rawValue || 0);
  if (rawValue <= 0) return 1;
  return clamp(Number(summary.effectiveValue || 0) / rawValue, 0, 1);
}

function getWeightedAggregateSignalScale(signalWeighting = {}, types = []) {
  const selected = (Array.isArray(types) ? types : []).map((type) => signalWeighting.byType?.[type] || {});
  const rawValue = selected.reduce((total, item) => total + Number(item.rawValue || 0), 0);
  if (rawValue <= 0) return 1;
  const effectiveValue = selected.reduce((total, item) => total + Number(item.effectiveValue || 0), 0);
  return clamp(effectiveValue / rawValue, 0, 1);
}

function scaleTextSourceSummary(summary = {}, scale = 1) {
  if (!summary || typeof summary !== "object") return summary;
  return {
    ...summary,
    sentiment: scaleSentimentSummary(summary.sentiment, scale),
    emotions: scaleCountRows(summary.emotions, scale),
    subjectiveNegativity: scaleSubjectiveNegativitySummary(summary.subjectiveNegativity, scale),
    repeatedLanguage: scaleCountRows(summary.repeatedLanguage, scale),
    examples: summary.examples,
  };
}

function scaleSentimentSummary(summary = {}, scale = 1) {
  if (!summary || typeof summary !== "object") return summary;
  const positive = roundWeightedSignalCount(Number(summary.positive || 0) * scale);
  const neutral = roundWeightedSignalCount(Number(summary.neutral || 0) * scale);
  const negative = roundWeightedSignalCount(Number(summary.negative || 0) * scale);
  const total = roundWeightedSignalCount(positive + neutral + negative);
  const dominant = total
    ? Object.entries({ positive, neutral, negative }).sort((first, second) => second[1] - first[1])[0][0]
    : summary.dominant || "neutral";
  return {
    ...summary,
    positive,
    neutral,
    negative,
    total,
    dominant,
    negativeRatio: total ? roundRate(negative / total, 2) : 0,
  };
}

function scaleSubjectiveNegativitySummary(summary = {}, scale = 1) {
  if (!summary || typeof summary !== "object") return summary;
  const count = roundWeightedSignalCount(Number(summary.count || 0) * scale);
  const total = roundWeightedSignalCount(Number(summary.total || 0) * scale);
  return {
    ...summary,
    count,
    total,
    ratio: total ? roundRate(count / total, 2) : 0,
  };
}

function scaleCountRows(rows = [], scale = 1) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const count = row.count != null ? roundWeightedSignalCount(Number(row.count || 0) * scale) : row.count;
    const signals = row.signals != null ? roundWeightedSignalCount(Number(row.signals || 0) * scale) : row.signals;
    return {
      ...row,
      ...(row.count != null ? { count } : {}),
      ...(row.signals != null ? { signals } : {}),
      sentiments: row.sentiments ? {
        positive: roundWeightedSignalCount(Number(row.sentiments.positive || 0) * scale),
        neutral: roundWeightedSignalCount(Number(row.sentiments.neutral || 0) * scale),
        negative: roundWeightedSignalCount(Number(row.sentiments.negative || 0) * scale),
      } : row.sentiments,
    };
  }).filter((row) => Number(row?.count ?? row?.signals ?? 1) > 0);
}

function scaleIssueSignalRows(rows = [], scale = 1) {
  if (!Array.isArray(rows)) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    return {
      ...row,
      signals: roundWeightedSignalCount(Number(row.signals || row.count || 0) * scale),
    };
  }).filter((row) => Number(row?.signals || 0) > 0);
}

function buildIssueSignalCounts({ returns, refunds, reviews }) {
  const counts = {};
  [...returns, ...reviews].forEach((item) => {
    const text = item.source === "returns" || item.reason || item.reasonNote || item.customerNote
      ? getReturnCustomerLanguageText(item)
      : [item.title, item.body].filter(Boolean).join(" ");
    if (!text.trim()) return;
    const issue = classifyIssueText(text);
    counts[issue] = (counts[issue] || 0) + 1;
  });
  refunds.forEach((item) => {
    const text = getRefundOperationalText(item) || "Refund impact";
    const issue = classifyIssueText(text);
    const issueCode = issue === "product_quality" ? "refund_impact" : issue;
    counts[issueCode] = (counts[issueCode] || 0) + Number(item.quantity || 1);
  });
  return counts;
}

function buildCustomerTextInsights({ returns = [], reviews = [] }) {
  return summarizeCustomerTextAnalysisItems(buildCustomerTextAnalysisItems({ returns, reviews }));
}

function buildCustomerTextAnalysisItems({ returns = [], reviews = [] }) {
  return {
    returnTexts: returns.map(buildReturnTextAnalysisItem).filter(Boolean),
    reviewTexts: reviews.map(buildReviewTextAnalysisItem).filter(Boolean),
  };
}

function buildReturnTextAnalysisItem(item = {}) {
  const reason = String(item.reason || "").trim();
  const noteText = [item.reasonNote, item.customerNote].filter(Boolean).join(" ");
  const isOther = isGenericOtherReason(reason);
  const analysisText = getReturnCustomerLanguageText(item);
  const text = analysisText || noteText;
  if (!analysisText.trim()) return null;
  const issueCode = classifyIssueText(analysisText);
  return {
    key: getReturnTextCacheKey(item),
    source: "returns",
    text,
    analysisText,
    reason,
    noteText,
    issueCode,
    sentiment: classifyCustomerSentiment(analysisText),
    emotion: classifyCustomerEmotion(analysisText),
    subjectiveNegative: isSubjectiveNegativeText(analysisText),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt || item.processedAt || item.createdAt,
    variant: item.variantTitle || item.sku || "",
    quantity: Number(item.quantity || 1),
    isOther,
  };
}

function buildReviewTextAnalysisItem(review = {}) {
  const text = [review.title, review.body].filter(Boolean).join(" - ");
  if (!text.trim()) return null;
  const rating = Number(review.rating || 0);
  const sentiment = classifyCustomerSentiment(text, rating);
  return {
    key: getReviewTextCacheKey(review),
    source: review.sourceType || "reviews",
    sourceLabel: review.sourceLabel || "Reviews",
    text,
    analysisText: text,
    rating,
    issueCode: classifyIssueText(text, { sentiment, rating }),
    sentiment,
    emotion: classifyCustomerEmotion(text, rating),
    subjectiveNegative: isSubjectiveNegativeText(text),
    createdAt: review.createdAt,
    updatedAt: review.updatedAt || review.createdAt,
  };
}

function summarizeCustomerTextAnalysisItems({ returnTexts = [], reviewTexts = [] } = {}) {
  const allTexts = [...returnTexts, ...reviewTexts];
  const sentiment = summarizeSentiment(allTexts);
  const emotions = summarizeEmotionCounts(allTexts);
  const returnsSummary = summarizeTextSource(returnTexts);
  const reviewsSummary = {
    ...summarizeTextSource(reviewTexts),
    bySource: summarizeReviewTextSources(reviewTexts),
  };
  const subjectiveNegativity = summarizeSubjectiveNegativity(allTexts);
  const otherReturnClassifications = summarizeOtherReturnClassifications(returnTexts);
  const repeatedLanguage = extractRepeatedLanguage(allTexts);
  const granularIssues = buildDeterministicTextIssues({
    sentiment,
    returnsSummary,
    reviewsSummary,
    subjectiveNegativity,
    otherReturnClassifications,
    repeatedLanguage,
  });

  return {
    sentiment,
    emotions,
    returns: returnsSummary,
    reviews: reviewsSummary,
    subjectiveNegativity,
    otherReturnClassifications,
    repeatedLanguage,
    granularIssues,
  };
}

function summarizeReviewTextSources(reviewTexts = []) {
  const groups = new Map();
  reviewTexts.forEach((item) => {
    const key = getReviewSourceGroupKey(item.source, item.sourceLabel);
    if (!key) return;
    const current = groups.get(key) || {
      key,
      source: item.source || "",
      sourceLabel: item.sourceLabel || getReviewSourceLabelForKey(key),
      items: [],
    };
    current.items.push(item);
    if (item.sourceLabel) current.sourceLabel = item.sourceLabel;
    groups.set(key, current);
  });

  return Array.from(groups.values()).reduce((acc, group) => {
    acc[group.key] = {
      ...summarizeTextSource(group.items),
      source: group.source,
      sourceLabel: group.sourceLabel,
    };
    return acc;
  }, {});
}

function getReviewSourceGroupKey(source = "", sourceLabel = "") {
  const normalized = `${source} ${sourceLabel}`.toLowerCase();
  if (normalized.includes("csv")) return "csv";
  if (normalized.includes("judge") || normalized.includes("judgeme")) return "judgeMe";
  if (normalized.includes("yotpo")) return "yotpo";
  if (normalized.includes("loox")) return "loox";
  if (normalized.includes("review")) return normalizeText(sourceLabel || source).replace(/[^a-z0-9]+/g, "_") || "reviews";
  return "";
}

function getReviewSourceLabelForKey(key = "") {
  if (key === "csv") return "CSV reviews";
  if (key === "judgeMe") return "Judge.me reviews";
  if (key === "yotpo") return "Yotpo reviews";
  if (key === "loox") return "Loox reviews";
  return "Reviews";
}

function buildIncrementalCustomerTextInsights({ returns = [], reviews = [], previousCache = {}, cutoffAt = null, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS }) {
  const cutoff = parseValidDate(cutoffAt);
  const previousReturnItems = normalizeCachedAnalysisItems(previousCache.returnItems);
  const previousReviewItems = normalizeCachedAnalysisItems(previousCache.reviewItems);
  const returnCandidates = returns.map((item) => ({
    key: getReturnTextCacheKey(item),
    item,
    changedAt: item.updatedAt || item.processedAt || item.createdAt,
    hasText: Boolean(getReturnCustomerLanguageText(item).trim()),
  })).filter((candidate) => candidate.hasText);
  const reviewCandidates = reviews.map((item) => ({
    key: getReviewTextCacheKey(item),
    item,
    changedAt: item.updatedAt || item.createdAt,
    hasText: Boolean([item.title, item.body].filter(Boolean).join(" - ").trim()),
  })).filter((candidate) => candidate.hasText);
  if (cutoff && !returnCandidates.length && !reviewCandidates.length) {
    return {
      textInsights: summarizeCustomerTextAnalysisItems({ returnTexts: [], reviewTexts: [] }),
      cache: { returnItems: [], reviewItems: [] },
      mode: "incremental",
      analyzedItems: 0,
      reusedItems: 0,
      newReturnEvents: [],
      newReviewEvents: [],
      reason: "no_customer_text_in_window",
    };
  }
  const canUseIncremental = Boolean(cutoff && previousReturnItems.length + previousReviewItems.length > 0)
    && hasCachedCoverageForOldItems(returnCandidates, previousReturnItems, cutoff)
    && hasCachedCoverageForOldItems(reviewCandidates, previousReviewItems, cutoff);

  if (!canUseIncremental) {
    const fullItems = buildCustomerTextAnalysisItems({ returns, reviews });
    return {
      textInsights: summarizeCustomerTextAnalysisItems(fullItems),
      cache: {
        returnItems: trimAnalysisItemsForCache(filterAnalysisItemsByLookback(fullItems.returnTexts, windowDays)),
        reviewItems: trimAnalysisItemsForCache(filterAnalysisItemsByLookback(fullItems.reviewTexts, windowDays)),
      },
      mode: "full",
      analyzedItems: fullItems.returnTexts.length + fullItems.reviewTexts.length,
      reusedItems: 0,
      newReturnEvents: returns,
      newReviewEvents: reviews,
      reason: cutoff ? "previous_cache_missing_or_incomplete" : "no_previous_cutoff",
    };
  }

  const returnItemMap = new Map();
  filterAnalysisItemsByLookback(previousReturnItems, windowDays)
    .filter((item) => returnCandidates.some((candidate) => candidate.key === item.key))
    .forEach((item) => returnItemMap.set(item.key, item));
  const reviewItemMap = new Map();
  filterAnalysisItemsByLookback(previousReviewItems, windowDays)
    .filter((item) => reviewCandidates.some((candidate) => candidate.key === item.key))
    .forEach((item) => reviewItemMap.set(item.key, item));

  const newReturnEvents = returnCandidates
    .filter((candidate) => isChangedAfterCutoff(candidate.changedAt, cutoff) || !returnItemMap.has(candidate.key))
    .map((candidate) => candidate.item);
  const newReviewEvents = reviewCandidates
    .filter((candidate) => isChangedAfterCutoff(candidate.changedAt, cutoff) || !reviewItemMap.has(candidate.key))
    .map((candidate) => candidate.item);

  newReturnEvents.map(buildReturnTextAnalysisItem).filter(Boolean).forEach((item) => returnItemMap.set(item.key, item));
  newReviewEvents.map(buildReviewTextAnalysisItem).filter(Boolean).forEach((item) => reviewItemMap.set(item.key, item));

  const returnItems = Array.from(returnItemMap.values());
  const reviewItems = Array.from(reviewItemMap.values());
  return {
    textInsights: summarizeCustomerTextAnalysisItems({ returnTexts: returnItems, reviewTexts: reviewItems }),
    cache: {
      returnItems: trimAnalysisItemsForCache(returnItems),
      reviewItems: trimAnalysisItemsForCache(reviewItems),
    },
    mode: "incremental",
    analyzedItems: newReturnEvents.length + newReviewEvents.length,
    reusedItems: returnItems.length + reviewItems.length - newReturnEvents.length - newReviewEvents.length,
    newReturnEvents,
    newReviewEvents,
    reason: "previous_cache_reused",
  };
}

function buildRefundOperationalInsights({ refunds = [], refundRate = 0, soldUnits = 0, refundUnits = 0, refundAmount = 0 }) {
  const refundTexts = refunds.map(buildRefundTextAnalysisItem).filter(Boolean);
  return summarizeRefundOperationalAnalysisItems({ refundTexts, refunds, refundRate, soldUnits, refundUnits, refundAmount });
}

function buildRefundTextAnalysisItem(item = {}) {
  const text = getRefundOperationalText(item);
  if (!text.trim()) return null;
  const noteText = getRefundNoteText(item);
  const reasonText = getRefundReasonText(item);
  return {
    key: getRefundTextCacheKey(item),
    source: "refunds",
    text,
    analysisText: text,
    issueCode: classifyIssueText(text),
    sentiment: classifyCustomerSentiment(text),
    emotion: classifyCustomerEmotion(text),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt || item.processedAt || item.createdAt,
    variant: item.variantTitle || item.sku || "",
    quantity: Number(item.quantity || 1),
    amount: Number(item.amount || 0),
    restockType: item.restockType || "",
    noteText,
    reasonText,
    adjustmentReasons: Array.isArray(item.adjustmentReasons) ? item.adjustmentReasons : [],
  };
}

function summarizeRefundOperationalAnalysisItems({ refundTexts = [], refunds = [], refundRate = 0, soldUnits = 0, refundUnits = 0, refundAmount = 0 }) {
  const refundReasons = countTopValues(refunds
    .map(getRefundReasonText)
    .filter((value) => value && !isDefaultCustomerLanguageTerm(value)), 5);
  const sentiment = summarizeSentiment(refundTexts);
  const repeatedLanguage = extractRepeatedLanguage(refundTexts).slice(0, 5);
  const issueCounts = countTopValues(refundTexts.map((item) => item.issueCode).filter(Boolean), 5);
  const highPressure = Number(soldUnits || 0) > 10 && Number(refundRate || 0) > 20;
  const monitorPressure = Number(refundUnits || 0) >= 3 && Number(refundRate || 0) >= 10;
  const dominantIssue = issueCounts[0]?.label || "refund_impact";
  const noteCount = refundTexts.filter((item) => item.noteText).length;
  const reasonCount = refundReasons.reduce((total, item) => total + Number(item.count || 0), 0);
  const riskLift = calculateRefundOperationalRiskLift({ refundUnits, refundRate, soldUnits, noteCount: Math.max(noteCount, reasonCount) });

  return {
    total: Number(refundUnits || 0),
    noteCount,
    reasonCount,
    textSignalCount: refundTexts.length,
    refundRate: Number(refundRate || 0),
    refundAmount: Number(refundAmount || 0),
    soldUnits: Number(soldUnits || 0),
    highPressure,
    monitorPressure,
    level: highPressure ? "high" : monitorPressure ? "monitor" : "low",
    shouldSurface: highPressure || (monitorPressure && Number(refundUnits || 0) >= 3) || refundTexts.length >= 2 || Number(refundUnits || 0) >= 3,
    dominantIssueCode: normalizeIssueCode(dominantIssue) || "refund_impact",
    sentiment,
    repeatedLanguage,
    issueCounts,
    topReasons: refundReasons,
    riskLift,
    examples: buildRefundInsightExamples(refundTexts),
  };
}

function buildRefundInsightExamples(refundTexts = []) {
  const seen = new Set();
  const examples = [];
  (Array.isArray(refundTexts) ? refundTexts : []).forEach((item) => {
    const example = {
      text: truncateText(item.text, 180),
      noteText: truncateText(item.noteText, 180),
      reasonText: truncateText(item.reasonText, 180),
      sentiment: item.sentiment,
      emotion: item.emotion,
      issueCode: item.issueCode,
      variant: item.variant || "",
      amount: item.amount,
      adjustmentReasons: item.adjustmentReasons,
    };
    const key = getRefundInsightExampleKey(example);
    if (!key || seen.has(key)) return;
    seen.add(key);
    examples.push(example);
  });
  return examples.slice(0, 4);
}

function getRefundInsightExampleKey(example = {}) {
  const noteKey = normalizeText(example.noteText || "");
  if (noteKey) return `note:${noteKey}`;
  const textKey = normalizeText(example.text || "");
  if (textKey) return `text:${textKey}`;
  const reasonKey = normalizeText(example.reasonText || example.issueCode || "");
  return reasonKey ? `reason:${reasonKey}` : "";
}

function buildIncrementalRefundOperationalInsights({ refunds = [], refundRate = 0, soldUnits = 0, refundUnits = 0, refundAmount = 0, previousCache = {}, cutoffAt = null, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS }) {
  const cutoff = parseValidDate(cutoffAt);
  const previousItems = normalizeCachedAnalysisItems(previousCache.items);
  const candidates = refunds.map((item) => ({
    key: getRefundTextCacheKey(item),
    item,
    changedAt: item.updatedAt || item.processedAt || item.createdAt,
    hasText: Boolean(getRefundOperationalText(item).trim()),
  })).filter((candidate) => candidate.hasText);
  if (cutoff && !candidates.length) {
    return {
      refundInsights: summarizeRefundOperationalAnalysisItems({ refundTexts: [], refunds, refundRate, soldUnits, refundUnits, refundAmount }),
      cache: { items: [] },
      mode: "incremental",
      analyzedItems: 0,
      reusedItems: 0,
      newRefundEvents: [],
      reason: "no_refund_text_in_window",
    };
  }
  const canUseIncremental = Boolean(cutoff && previousItems.length)
    && hasCachedCoverageForOldItems(candidates, previousItems, cutoff);

  if (!canUseIncremental) {
    const items = refunds.map(buildRefundTextAnalysisItem).filter(Boolean);
    return {
      refundInsights: summarizeRefundOperationalAnalysisItems({ refundTexts: items, refunds, refundRate, soldUnits, refundUnits, refundAmount }),
      cache: { items: trimAnalysisItemsForCache(filterAnalysisItemsByLookback(items, windowDays)) },
      mode: "full",
      analyzedItems: items.length,
      reusedItems: 0,
      newRefundEvents: refunds,
      reason: cutoff ? "previous_cache_missing_or_incomplete" : "no_previous_cutoff",
    };
  }

  const itemMap = new Map();
  filterAnalysisItemsByLookback(previousItems, windowDays)
    .filter((item) => candidates.some((candidate) => candidate.key === item.key))
    .forEach((item) => itemMap.set(item.key, item));
  const newRefundEvents = candidates
    .filter((candidate) => isChangedAfterCutoff(candidate.changedAt, cutoff) || !itemMap.has(candidate.key))
    .map((candidate) => candidate.item);
  newRefundEvents.map(buildRefundTextAnalysisItem).filter(Boolean).forEach((item) => itemMap.set(item.key, item));
  const items = Array.from(itemMap.values());

  return {
    refundInsights: summarizeRefundOperationalAnalysisItems({ refundTexts: items, refunds, refundRate, soldUnits, refundUnits, refundAmount }),
    cache: { items: trimAnalysisItemsForCache(items) },
    mode: "incremental",
    analyzedItems: newRefundEvents.length,
    reusedItems: items.length - newRefundEvents.length,
    newRefundEvents,
    reason: "previous_cache_reused",
  };
}

function resolveProductContentAnalysisState({ product = {}, previousCache = {}, cutoffAt = null }) {
  const cutoff = parseValidDate(cutoffAt);
  const signature = buildProductContentSignature(product);
  const productUpdatedAt = toIso(product.updatedAt || product.createdAt);
  const cachedContent = previousCache?.deterministicContent;
  const cachedSignature = String(previousCache?.signature || "");
  const hasCachedSignature = Boolean(cachedSignature);
  const signatureChanged = hasCachedSignature && cachedSignature !== signature;
  const changed = Boolean(
    !cutoff
    || !cachedContent
    || !hasCachedSignature
    || signatureChanged,
  );

  if (!changed && cachedContent) {
    return {
      deterministicContent: cachedContent,
      signature,
      productUpdatedAt,
      cachedContentGaps: previousCache.contentGaps || null,
      reused: true,
      changed: false,
      reason: "product_content_unchanged_since_previous_diagnosis",
    };
  }

  return {
    deterministicContent: analyzeProductContentDeterministically(product),
    signature,
    productUpdatedAt,
    cachedContentGaps: null,
    reused: false,
    changed: true,
    reason: getProductContentAnalysisChangeReason({
      cutoff,
      cachedContent,
      hasCachedSignature,
      signatureChanged,
    }),
  };
}

function getProductContentAnalysisChangeReason({ cutoff = null, cachedContent = null, hasCachedSignature = false, signatureChanged = false } = {}) {
  if (!cutoff) return "no_previous_cutoff";
  if (!cachedContent) return "product_content_cache_missing";
  if (!hasCachedSignature) return "product_content_signature_missing";
  if (signatureChanged) return "product_content_signature_changed";
  return "product_content_changed";
}

function buildProductContentSignature(product = {}) {
  const normalized = {
    title: normalizeText(product.title),
    handle: normalizeText(product.handle),
    description: normalizeText(stripHtml(product.description || product.descriptionHtml || "")),
    seoTitle: normalizeText(product.seoTitle),
    seoDescription: normalizeText(product.seoDescription),
    templateSuffix: normalizeText(product.templateSuffix),
    vendor: normalizeText(product.vendor),
    productType: normalizeText(product.productType),
    category: normalizeProductCategory(product.category),
    tags: (Array.isArray(product.tags) ? product.tags : []).map(normalizeText).sort(),
    collections: (Array.isArray(product.collections) ? product.collections : []).map(normalizeText).sort(),
    options: (Array.isArray(product.options) ? product.options : []).map((option) => ({
      name: normalizeText(option.name),
      values: (Array.isArray(option.values) ? option.values : []).map(normalizeText).sort(),
    })),
    variants: (Array.isArray(product.variants) ? product.variants : []).map((variant) => ({
      id: String(variant.id || ""),
      title: normalizeText(variant.title),
      sku: normalizeText(variant.sku),
      price: normalizeMoneyValue(variant.price),
      compareAtPrice: normalizeMoneyValue(variant.compareAtPrice),
      selectedOptions: (Array.isArray(variant.selectedOptions) ? variant.selectedOptions : []).map((option) => ({
        name: normalizeText(option.name),
        value: normalizeText(option.value),
      })),
    })),
    media: (Array.isArray(product.media) ? product.media : []).map((item) => ({
      id: String(item.id || ""),
      alt: normalizeText(item.alt),
      type: normalizeText(item.mediaContentType),
      width: Number(item.width || 0),
      height: Number(item.height || 0),
    })),
  };
  return stableSignature(normalized);
}

function getOverallIncrementalMode({ productContentState, customerTextState, refundTextState, previousDetailedDiagnosisAt }) {
  if (!previousDetailedDiagnosisAt) return "full";
  const modes = [
    productContentState?.reused ? "incremental" : "full",
    customerTextState?.mode,
    refundTextState?.mode,
  ];
  return modes.every((mode) => mode === "incremental") ? "incremental" : "mixed";
}

function getIncrementalSourceFetchContext({ snapshot = {}, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS } = {}) {
  const metrics = snapshot.metrics || {};
  const previousIncrementalCache = metrics.incrementalDiagnosis?.cache || {};
  const sourceEvents = previousIncrementalCache.sourceEvents || null;
  const normalizedWindowDays = Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS));
  const sourceEventFetchComplete = sourceEvents?.fetchComplete !== false;
  const cachedSourceThroughAt = sourceEvents?.fetchedThroughAt || (sourceEventFetchComplete ? sourceEvents?.cachedAt : null);
  const fallbackThroughAt = !sourceEvents || sourceEventFetchComplete
    ? metrics.lastNoChangeDiagnosisAt || metrics.lastDetailedDiagnosisAt || metrics.latestDiagnosisAt || null
    : null;
  const previousCompletedAt = cachedSourceThroughAt || fallbackThroughAt;
  const previousWindowDays = Number(sourceEvents?.windowDays || 0);
  const previousSourceEvents = normalizeSourceEventsCache(sourceEvents, normalizedWindowDays);
  const base = {
    shopifyCanReuse: false,
    reason: "source_event_cache_missing",
    previousCompletedAt: toIso(previousCompletedAt),
    previousWindowDays: previousWindowDays || null,
    sinceDate: getSinceDate(normalizedWindowDays),
    previousSourceEvents,
  };

  if (!previousCompletedAt) {
    return { ...base, reason: "previous_source_fetch_cutoff_missing" };
  }
  if (!sourceEvents || typeof sourceEvents !== "object") {
    return base;
  }
  if (Number(sourceEvents.schemaVersion || 0) !== SOURCE_EVENT_CACHE_SCHEMA_VERSION) {
    return { ...base, reason: "source_event_cache_schema_mismatch" };
  }
  if (!previousWindowDays || previousWindowDays < normalizedWindowDays) {
    return { ...base, reason: "source_event_cache_window_too_short" };
  }

  return {
    ...base,
    shopifyCanReuse: true,
    reason: "source_event_cache_available",
    sinceDate: buildIncrementalSinceDate(previousCompletedAt, normalizedWindowDays),
    previousSourceEvents,
  };
}

function buildIncrementalSinceDate(previousCompletedAt, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS) {
  const safeWindowDays = Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS));
  const lookbackStart = new Date(Date.now() - safeWindowDays * 24 * 60 * 60 * 1000);
  const previousDate = parseValidDate(previousCompletedAt);
  const since = previousDate && previousDate.getTime() > lookbackStart.getTime() ? previousDate : lookbackStart;
  return since.toISOString().slice(0, 10);
}

function normalizeShopifySinceDate(sinceDate, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS) {
  const parsed = parseValidDate(sinceDate);
  return parsed ? parsed.toISOString().slice(0, 10) : getSinceDate(windowDays);
}

function mergeIncrementalSourceEvents({ previous = {}, current = {}, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS } = {}) {
  return {
    sales: mergeSourceEventList({ type: "sales", previous: previous.sales, current: current.sales, windowDays }),
    refunds: mergeSourceEventList({ type: "refunds", previous: previous.refunds, current: current.refunds, windowDays }),
    returns: mergeSourceEventList({ type: "returns", previous: previous.returns, current: current.returns, windowDays }),
  };
}

function mergeSourceEventList({ type, previous = [], current = [], windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS } = {}) {
  const map = new Map();
  normalizeSourceEventList(previous, type, windowDays).forEach((item) => {
    map.set(getSourceEventCacheKey(type, item), item);
  });
  normalizeSourceEventList(current, type, windowDays).forEach((item) => {
    map.set(getSourceEventCacheKey(type, item), item);
  });
  return limitSourceEventCacheItems(sortSourceEvents(Array.from(map.values()), type));
}

function selectDiagnosisRelationshipSalesForSummary({
  sourceSalesEvents = [],
  relationshipSales = [],
  backfilledSales = [],
} = {}) {
  const mergedSourceSales = Array.isArray(sourceSalesEvents) ? sourceSalesEvents : [];
  if (mergedSourceSales.length) return mergedSourceSales;
  const fetchedRelationshipSales = Array.isArray(relationshipSales) ? relationshipSales : [];
  if (fetchedRelationshipSales.length) return fetchedRelationshipSales;
  return Array.isArray(backfilledSales) ? backfilledSales : [];
}

function buildSourceEventCache({ sales = [], refunds = [], returns = [], windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS, sourceEventFetch = null } = {}) {
  const cachedAt = new Date().toISOString();
  const fetchComplete = sourceEventFetch?.fetchComplete !== false;
  return {
    schemaVersion: SOURCE_EVENT_CACHE_SCHEMA_VERSION,
    windowDays: Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS)),
    cachedAt,
    fetchedThroughAt: fetchComplete ? sourceEventFetch?.fetchedThroughAt || cachedAt : sourceEventFetch?.previousCompletedAt || null,
    fetchComplete,
    sales: normalizeSourceEventList(sales, "sales", windowDays),
    refunds: normalizeSourceEventList(refunds, "refunds", windowDays),
    returns: normalizeSourceEventList(returns, "returns", windowDays),
  };
}

function normalizeSourceEventsCache(cache = {}, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS) {
  return {
    sales: normalizeSourceEventList(cache?.sales, "sales", windowDays),
    refunds: normalizeSourceEventList(cache?.refunds, "refunds", windowDays),
    returns: normalizeSourceEventList(cache?.returns, "returns", windowDays),
  };
}

function normalizeSourceEventList(items = [], type, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS) {
  return limitSourceEventCacheItems(sortSourceEvents(
    (Array.isArray(items) ? items : [])
      .map((item) => trimSourceEventForCache(item, type))
      .filter(Boolean)
      .filter((item) => isSourceEventInsideLookback(item, windowDays, type)),
    type,
  ));
}

function trimSourceEventForCache(item = {}, type) {
  if (!item || typeof item !== "object") return null;
  const cacheKey = getSourceEventCacheKey(type, item);
  if (!cacheKey) return null;
  const orderDate = toIso(item.orderDate || item.orderProcessedAt || item.processedAt || item.orderCreatedAt || item.createdAt || item.updatedAt || item.date);
  const processedAt = toIso(item.processedAt || item.orderProcessedAt || (type === "sales" ? orderDate : null));
  const base = {
    cacheKey,
    id: item.id || null,
    orderId: item.orderId || null,
    lineItemId: item.lineItemId || item.orderLineItemId || item.line_item_id || null,
    productId: item.productId || item.productGid || item.product_id || null,
    orderDate,
    orderProcessedAt: toIso(item.orderProcessedAt || (type === "sales" ? processedAt || orderDate : null)),
    orderCreatedAt: toIso(item.orderCreatedAt || (type === "sales" ? item.createdAt || orderDate : null)),
    createdAt: toIso(item.createdAt || processedAt || orderDate || item.updatedAt || item.date),
    updatedAt: toIso(item.updatedAt || processedAt || item.createdAt || orderDate || item.date),
    customerKey: item.customerKey || item.customerId || item.customerGid || item.customer?.id || null,
    quantity: Number(item.quantity || 0),
    amount: Number(item.amount || 0),
    title: truncateText(item.title || "", 180),
    imageUrl: truncateText(item.imageUrl || item.image_url || "", 600),
    imageAlt: truncateText(item.imageAlt || item.image_alt || "", 220),
    sku: String(item.sku || ""),
    variantId: item.variantId || item.variantGid || item.variant_id || null,
    variantTitle: truncateText(item.variantTitle || "", 160),
    selectedOptions: Array.isArray(item.selectedOptions) ? item.selectedOptions.slice(0, 12).map((option) => ({
      name: truncateText(option?.name || "", 80),
      value: truncateText(option?.value || "", 120),
    })) : [],
    geography: normalizeSalesEventGeography(item),
    country: item.country || item.geography?.country || "",
    countryCode: normalizeGeographyCode(item.countryCode || item.geography?.countryCode),
    province: item.province || item.geography?.province || "",
    provinceCode: normalizeGeographyCode(item.provinceCode || item.geography?.provinceCode),
    city: item.city || item.geography?.city || "",
  };

  if (type === "sales") {
    return {
      ...base,
      basketFingerprint: item.basketFingerprint || "",
      basketLineItems: normalizeCachedBasketLineItems(item.basketLineItems),
    };
  }
  if (type === "returns") {
    return {
      ...base,
      returnId: item.returnId || null,
      status: item.status || "",
      processedQuantity: Number(item.processedQuantity || 0),
      refundedQuantity: Number(item.refundedQuantity || 0),
      reason: truncateText(item.reason || "", 180),
      reasonLabel: truncateText(item.reasonLabel || "", 180),
      reasonNote: truncateText(item.reasonNote || "", 600),
      customerNote: truncateText(item.customerNote || "", 600),
    };
  }
  if (type === "refunds") {
    return {
      ...base,
      refundId: item.refundId || null,
      processedAt: toIso(item.processedAt || item.createdAt),
      totalRefundedAmount: Number(item.totalRefundedAmount || 0),
      restockType: item.restockType || "",
      adjustmentReasons: Array.isArray(item.adjustmentReasons) ? item.adjustmentReasons.slice(0, 12).map(String) : [],
      reason: truncateText(item.reason || "", 220),
      reasonLabel: truncateText(item.reasonLabel || "", 220),
      note: truncateText(item.note || "", 800),
      fallbackSource: item.fallbackSource || "",
    };
  }
  return base;
}

function normalizeCachedBasketLineItems(lineItems = []) {
  return (Array.isArray(lineItems) ? lineItems : [])
    .slice(0, DIAGNOSIS_ORDER_LINE_ITEMS_PAGE_SIZE)
    .map((lineItem) => ({
      id: lineItem.id || null,
      lineItemId: lineItem.lineItemId || lineItem.orderLineItemId || lineItem.line_item_id || lineItem.id || null,
      productId: lineItem.productId || lineItem.productGid || lineItem.product_id || null,
      handle: truncateText(lineItem.handle || "", 160),
      title: truncateText(lineItem.title || "", 180),
      imageUrl: truncateText(lineItem.imageUrl || lineItem.image_url || "", 600),
      imageAlt: truncateText(lineItem.imageAlt || lineItem.image_alt || "", 220),
      variantId: lineItem.variantId || lineItem.variantGid || lineItem.variant_id || null,
      variantTitle: truncateText(lineItem.variantTitle || "", 160),
      sku: String(lineItem.sku || ""),
      quantity: Number(lineItem.quantity || 0),
      amount: Number(lineItem.amount || 0),
    }));
}

function getSourceEventCacheKey(type, item = {}) {
  if (item.cacheKey) return String(item.cacheKey);
  const lineItemId = item.lineItemId || item.orderLineItemId || item.line_item_id;
  const productId = item.productId || item.productGid || item.product_id;
  const variantId = item.variantId || item.variantGid || item.variant_id;
  if (type === "sales") {
    return stableEventCacheKey("sale", item, [item.id, item.orderId, lineItemId, productId, variantId, item.sku, item.quantity, item.amount, item.createdAt || item.orderDate || item.orderProcessedAt || item.processedAt]);
  }
  if (type === "returns") {
    return stableEventCacheKey("return-source", item, [item.id, item.returnId, item.orderId, lineItemId, productId, variantId, item.sku, item.reason, item.reasonNote, item.customerNote, item.createdAt || item.processedAt || item.updatedAt || item.orderDate]);
  }
  if (type === "refunds") {
    return stableEventCacheKey("refund-source", item, [item.id, item.refundId, item.orderId, lineItemId, productId, variantId, item.sku, item.reason, item.reasonLabel, item.note, item.restockType, item.createdAt || item.processedAt || item.updatedAt || item.orderDate]);
  }
  return stableEventCacheKey(String(type || "source"), item, [item.id, item.orderId, lineItemId, productId, variantId, item.createdAt || item.processedAt || item.updatedAt || item.orderDate]);
}

function isSourceEventInsideLookback(item = {}, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS, type = "") {
  const date = getSourceEventDate(item, type);
  if (!date) return true;
  const cutoff = Date.now() - Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS)) * 24 * 60 * 60 * 1000;
  return date.getTime() >= cutoff;
}

function getSourceEventDate(item = {}, type = "") {
  if (type === "sales") {
    return parseValidDate(item.orderDate || item.orderProcessedAt || item.processedAt || item.orderCreatedAt || item.createdAt || item.updatedAt || item.date);
  }
  return parseValidDate(item.processedAt || item.updatedAt || item.createdAt || item.orderDate || item.orderProcessedAt || item.orderCreatedAt || item.date);
}

function sortSourceEvents(items = [], type = "") {
  return (Array.isArray(items) ? items : []).sort((left, right) => {
    const leftDate = getSourceEventDate(left, type)?.getTime() || 0;
    const rightDate = getSourceEventDate(right, type)?.getTime() || 0;
    if (leftDate !== rightDate) return leftDate - rightDate;
    return getSourceEventCacheKey(type || "source", left).localeCompare(getSourceEventCacheKey(type || "source", right));
  });
}

function limitSourceEventCacheItems(items = []) {
  const normalized = Array.isArray(items) ? items : [];
  return normalized.length > MAX_SOURCE_EVENT_CACHE_ITEMS
    ? normalized.slice(normalized.length - MAX_SOURCE_EVENT_CACHE_ITEMS)
    : normalized;
}

function getShopSourceEventCacheKey(windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS) {
  return `${SHOP_SOURCE_EVENT_CACHE_KEY_PREFIX}:v${SOURCE_EVENT_CACHE_SCHEMA_VERSION}:window:${Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS))}`;
}

function hasShopSourceEventCacheModels() {
  return Boolean(prisma?.productPulseShopSourceEventCache && prisma?.productPulseShopSourceEvent);
}

function getShopSourceEventLookbackCutoffDate(windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS) {
  return new Date(Date.now() - Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS)) * 24 * 60 * 60 * 1000);
}

function getShopSourceEventCacheFreshness(fetchedThroughAt, { referenceAt = null } = {}) {
  const parsed = parseValidDate(fetchedThroughAt);
  if (!parsed) return { usable: false, stale: true, reason: "shop_source_event_cache_fetched_through_missing", ageMs: null };
  const reference = parseValidDate(referenceAt) || new Date();
  const ageMs = Math.max(0, reference.getTime() - parsed.getTime());
  if (ageMs > SHOP_SOURCE_EVENT_CACHE_FRESH_MS) {
    return { usable: false, stale: true, reason: "shop_source_event_cache_stale", ageMs };
  }
  if (ageMs > SHOP_SOURCE_EVENT_CACHE_MAX_HIT_LAG_MS) {
    return { usable: false, stale: true, reason: "shop_source_event_cache_behind_diagnosis", ageMs };
  }
  return { usable: true, stale: false, reason: "shop_source_event_cache_hit", ageMs };
}

async function getShopSourceEventCacheForDiagnosis({ shop, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS, referenceAt = null } = {}) {
  if (!shop || !hasShopSourceEventCacheModels()) {
    return { usable: false, reason: "shop_source_event_cache_unavailable", events: null };
  }

  const normalizedWindowDays = Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS));
  const cacheKey = getShopSourceEventCacheKey(normalizedWindowDays);
  const state = await prisma.productPulseShopSourceEventCache.findUnique({
    where: { shop_cacheKey: { shop, cacheKey } },
  });

  if (!state) return { usable: false, reason: "shop_source_event_cache_missing", events: null, cacheKey };
  if (Number(state.schemaVersion || 0) !== SOURCE_EVENT_CACHE_SCHEMA_VERSION) {
    return { usable: false, reason: "shop_source_event_cache_schema_mismatch", state, events: null, cacheKey };
  }
  if (state.fetchComplete === false) {
    return { usable: false, reason: "shop_source_event_cache_incomplete", state, events: null, cacheKey };
  }
  if (Number(state.windowDays || 0) < normalizedWindowDays) {
    return { usable: false, reason: "shop_source_event_cache_window_too_short", state, events: null, cacheKey };
  }

  const events = await readShopSourceEventsForWindow({ shop, windowDays: normalizedWindowDays });
  const counts = {
    salesEvents: events.sales.length,
    refundEvents: events.refunds.length,
    returnEvents: events.returns.length,
  };
  const expectedCounts = state.counts || {};
  const expectedRows = Number(expectedCounts.salesEvents || expectedCounts.refundEvents || expectedCounts.returnEvents || 0);
  if (expectedRows > 0 && counts.salesEvents + counts.refundEvents + counts.returnEvents === 0) {
    return { usable: false, reason: "shop_source_event_cache_rows_missing", state, events: null, cacheKey };
  }

  const fetchedThroughAt = toIso(state.fetchedThroughAt || state.updatedAt);
  const freshness = getShopSourceEventCacheFreshness(fetchedThroughAt, { referenceAt });
  return {
    usable: freshness.usable,
    stale: freshness.stale,
    reason: freshness.reason,
    state,
    events,
    counts,
    cacheKey,
    fetchedThroughAt,
    cacheAgeMs: freshness.ageMs,
    sinceDate: fetchedThroughAt ? buildIncrementalSinceDate(fetchedThroughAt, normalizedWindowDays) : getSinceDate(normalizedWindowDays),
  };
}

async function readShopSourceEventsForWindow({ shop, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS } = {}) {
  const cutoff = getShopSourceEventLookbackCutoffDate(windowDays);
  const readType = async (sourceType) => {
    const rows = await prisma.productPulseShopSourceEvent.findMany({
      where: {
        shop,
        sourceType,
        eventAt: { gte: cutoff },
      },
      select: { payload: true },
      orderBy: [{ eventAt: "desc" }, { updatedAt: "desc" }],
      take: MAX_SOURCE_EVENT_CACHE_ITEMS,
    });
    return normalizeSourceEventList(rows.map((row) => row.payload).filter(Boolean), sourceType, windowDays);
  };

  const [sales, refunds, returns] = await Promise.all([
    readType("sales"),
    readType("refunds"),
    readType("returns"),
  ]);
  return { sales, refunds, returns };
}

async function getShopProductSourceSalesCacheForDiagnosis({ shop, product = {}, snapshot = {}, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS } = {}) {
  if (!shop || !hasShopSourceEventCacheModels()) {
    return { usable: false, reason: "shop_source_event_cache_unavailable", events: [] };
  }
  const productIds = getDiagnosisProductIdCandidates(product, snapshot);
  const variantIds = getDiagnosisVariantIdCandidates(product);
  const filters = [];
  if (productIds.length) filters.push({ productGid: { in: productIds } });
  if (variantIds.length) filters.push({ variantGid: { in: variantIds } });
  if (!filters.length) return { usable: false, reason: "product_cache_identifiers_missing", events: [] };

  const normalizedWindowDays = Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS));
  const cutoff = getShopSourceEventLookbackCutoffDate(normalizedWindowDays);
  const rows = await prisma.productPulseShopSourceEvent.findMany({
    where: {
      shop,
      sourceType: "sales",
      eventAt: { gte: cutoff },
      OR: filters,
    },
    select: { payload: true },
    orderBy: [{ eventAt: "desc" }, { updatedAt: "desc" }],
    take: MAX_SOURCE_EVENT_CACHE_ITEMS,
  });
  const events = filterDiagnosisEventsForProduct(
    normalizeSourceEventList(rows.map((row) => row.payload).filter(Boolean), "sales", normalizedWindowDays),
    product,
    snapshot,
  );

  return {
    usable: events.length > 0,
    reason: events.length ? "shop_product_sales_cache_hit" : "shop_product_sales_cache_miss",
    events,
    counts: { salesEvents: events.length },
  };
}

async function appendShopSourceEventCacheRows({ shop, sourceType = "sales", events = [], windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS } = {}) {
  if (!shop || !hasShopSourceEventCacheModels()) return { skipped: true, reason: "shop_source_event_cache_unavailable" };
  const normalizedWindowDays = Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS));
  const normalized = normalizeSourceEventList(events, sourceType, normalizedWindowDays);
  const now = new Date();
  const rows = normalized.map((event) => buildShopSourceEventRow({
    shop,
    sourceType,
    event,
    now,
  })).filter(Boolean);
  if (!rows.length) return { skipped: true, reason: "source_event_rows_empty", rows: 0, inserted: 0 };

  const cutoff = getShopSourceEventLookbackCutoffDate(normalizedWindowDays);
  await prisma.productPulseShopSourceEvent.deleteMany({
    where: {
      shop,
      sourceType,
      eventAt: { lt: cutoff },
    },
  });
  const result = await prisma.productPulseShopSourceEvent.createMany({
    data: rows,
    skipDuplicates: true,
  });

  return {
    skipped: false,
    sourceType,
    rows: rows.length,
    inserted: Number(result?.count || 0),
  };
}

async function persistShopSourceEventCache({ shop, windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS, sourceEvents = {}, fetchedThroughAt = null, sourceFetchComplete = {} } = {}) {
  if (!shop || !hasShopSourceEventCacheModels()) return { skipped: true, reason: "shop_source_event_cache_unavailable" };
  const normalizedWindowDays = Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS));
  const fetchComplete = sourceFetchComplete.sales !== false && sourceFetchComplete.refunds !== false && sourceFetchComplete.returns !== false;
  if (!fetchComplete) return { skipped: true, reason: "source_fetch_incomplete" };

  const normalized = normalizeSourceEventsCache(sourceEvents, normalizedWindowDays);
  const cacheKey = getShopSourceEventCacheKey(normalizedWindowDays);
  const cutoff = getShopSourceEventLookbackCutoffDate(normalizedWindowDays);
  const sourceTypes = ["sales", "refunds", "returns"];
  const now = new Date();
  const fetchedThroughDate = parseValidDate(fetchedThroughAt) || now;
  const rows = sourceTypes.flatMap((sourceType) => normalized[sourceType].map((event) => buildShopSourceEventRow({
    shop,
    sourceType,
    event,
    now,
  }))).filter(Boolean);

  await prisma.productPulseShopSourceEvent.deleteMany({
    where: {
      shop,
      sourceType: { in: sourceTypes },
      OR: [
        { eventAt: { gte: cutoff } },
        { eventAt: null },
      ],
    },
  });

  for (let index = 0; index < rows.length; index += SHOP_SOURCE_EVENT_CACHE_WRITE_BATCH_SIZE) {
    await prisma.productPulseShopSourceEvent.createMany({
      data: rows.slice(index, index + SHOP_SOURCE_EVENT_CACHE_WRITE_BATCH_SIZE),
      skipDuplicates: true,
    });
  }

  await prisma.productPulseShopSourceEvent.deleteMany({
    where: {
      shop,
      sourceType: { in: sourceTypes },
      eventAt: { lt: cutoff },
    },
  });

  await prisma.productPulseShopSourceEventCache.upsert({
    where: { shop_cacheKey: { shop, cacheKey } },
    create: {
      shop,
      cacheKey,
      schemaVersion: SOURCE_EVENT_CACHE_SCHEMA_VERSION,
      windowDays: normalizedWindowDays,
      fetchComplete: true,
      fetchedThroughAt: fetchedThroughDate,
      sourceFetchComplete,
      counts: {
        salesEvents: normalized.sales.length,
        refundEvents: normalized.refunds.length,
        returnEvents: normalized.returns.length,
      },
    },
    update: {
      schemaVersion: SOURCE_EVENT_CACHE_SCHEMA_VERSION,
      windowDays: normalizedWindowDays,
      fetchComplete: true,
      fetchedThroughAt: fetchedThroughDate,
      sourceFetchComplete,
      counts: {
        salesEvents: normalized.sales.length,
        refundEvents: normalized.refunds.length,
        returnEvents: normalized.returns.length,
      },
    },
  });

  return {
    skipped: false,
    cacheKey,
    rows: rows.length,
    counts: {
      salesEvents: normalized.sales.length,
      refundEvents: normalized.refunds.length,
      returnEvents: normalized.returns.length,
    },
  };
}

function buildShopSourceEventRow({ shop, sourceType, event = {}, now = new Date() } = {}) {
  const payload = trimSourceEventForCache(event, sourceType);
  if (!payload) return null;
  const eventAt = getSourceEventDate(payload, sourceType) || parseValidDate(payload.orderDate) || now;
  return {
    shop,
    sourceType,
    cacheKey: getSourceEventCacheKey(sourceType, payload),
    productGid: payload.productId || null,
    variantGid: payload.variantId || null,
    orderGid: payload.orderId || null,
    lineItemGid: payload.lineItemId || payload.refundLineItemId || payload.returnLineItemId || null,
    eventAt,
    sourceUpdatedAt: parseValidDate(payload.updatedAt || payload.processedAt || payload.createdAt) || eventAt,
    quantity: Math.max(0, Math.trunc(Number(payload.quantity || 0))),
    amount: Number(payload.amount || payload.totalRefundedAmount || 0),
    payload: jsonSafe(payload),
    createdAt: now,
    updatedAt: now,
  };
}

function buildIncrementalSourceFetchSummary(source = null) {
  if (!source || typeof source !== "object") {
    return {
      mode: "full_window_fetch",
      reason: "source_fetch_state_missing",
      fetchComplete: true,
    };
  }
  return {
    mode: source.mode || (source.shopifyCanReuse ? "incremental_fetch" : "full_window_fetch"),
    reason: source.reason || null,
    sinceDate: source.sinceDate || null,
    previousCompletedAt: source.previousCompletedAt || null,
    previousWindowDays: source.previousWindowDays || null,
    fetchedThroughAt: source.fetchedThroughAt || null,
    rawFetchedCounts: source.rawFetchedCounts || null,
    mergedCounts: source.mergedCounts || null,
    sourceEventCounts: source.sourceEventCounts || null,
    sourceFetchComplete: source.sourceFetchComplete || null,
    salesExtraction: source.salesExtraction || null,
    shopSourceCache: source.shopSourceCache || null,
    fetchComplete: source.fetchComplete !== false,
  };
}

function buildIncrementalEvidenceSnippetInputs({ returns = [], refunds = [], negativeReviews = [], productContentState = {}, customerTextState = {}, refundTextState = {} }) {
  const incremental = customerTextState.mode === "incremental" || refundTextState.mode === "incremental" || productContentState.reused;
  if (!incremental) return { returns, refunds, reviews: negativeReviews };
  return {
    returns: customerTextState.newReturnEvents || [],
    refunds: refundTextState.newRefundEvents || [],
    reviews: customerTextState.newReviewEvents?.filter((review) => Number(review.rating || 0) <= 2 || containsIssueLanguage(review.body)) || [],
  };
}

function buildIssueSignalCountsFromAnalysis({ customerTextCache = {}, refundTextCache = {}, fallback = {} } = {}) {
  const counts = {};
  const customerItems = [
    ...(Array.isArray(customerTextCache.returnItems) ? customerTextCache.returnItems : []),
    ...(Array.isArray(customerTextCache.reviewItems) ? customerTextCache.reviewItems : []),
  ];
  customerItems.forEach((item) => {
    if (!shouldCountTextAnalysisItemAsIssueSignal(item)) return;
    const issue = normalizeIssueCode(item.issueCode) || classifyIssueText(item.analysisText || item.text || "");
    if (!issue) return;
    counts[issue] = (counts[issue] || 0) + Math.max(1, Number(item.quantity || 1));
  });
  const refundItems = Array.isArray(refundTextCache.items) ? refundTextCache.items : [];
  refundItems.forEach((item) => {
    const issue = normalizeIssueCode(item.issueCode) || classifyIssueText(item.analysisText || item.text || "");
    const issueCode = issue === "product_quality" ? "refund_impact" : issue;
    if (!issueCode) return;
    counts[issueCode] = (counts[issueCode] || 0) + Math.max(1, Number(item.quantity || 1));
  });
  if (Object.keys(counts).length) return counts;
  return buildIssueSignalCounts(fallback);
}

function shouldCountTextAnalysisItemAsIssueSignal(item = {}) {
  const source = String(item.source || "").toLowerCase();
  if (source === "returns" || source === "shopify_return_note") return true;
  const rating = Number(item.rating || 0);
  const sentiment = String(item.sentiment || "").toLowerCase();
  const text = item.analysisText || item.text || "";
  return isNegativeReviewTextSignal({
    rating,
    sentiment,
    subjectiveNegative: item.subjectiveNegative,
    text,
  });
}

function normalizeCachedAnalysisItems(items = []) {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && typeof item === "object" && item.key)
    .map((item) => {
      const text = String(item.text || "");
      const analysisText = String(item.analysisText || item.text || "");
      const rating = Number(item.rating || 0);
      const currentSentiment = ["positive", "neutral", "negative"].includes(item.sentiment)
        ? item.sentiment
        : classifyCustomerSentiment(analysisText || text, rating);
      const sentiment = normalizeSentimentForPositiveRecovery(currentSentiment, analysisText || text, rating);
      const rawEmotion = normalizeEmotionCode(item.emotion) || classifyCustomerEmotion(analysisText || text, rating);
      const emotion = sentiment === "positive" && getEmotionPolarity(rawEmotion) === "negative"
        ? classifyCustomerEmotion(analysisText || text, Math.max(rating, 5))
        : rawEmotion;
      const issueCode = normalizeCachedAnalysisIssueCode(item, analysisText || text, { sentiment, rating });
      return {
        ...item,
        key: String(item.key),
        text,
        analysisText,
        issueCode,
        sentiment,
        emotion: normalizeEmotionCode(emotion) || "none",
        subjectiveNegative: sentiment === "positive" ? false : Boolean(item.subjectiveNegative),
        createdAt: toIso(item.createdAt),
        updatedAt: toIso(item.updatedAt || item.createdAt),
      };
    });
}

function normalizeCachedAnalysisIssueCode(item = {}, text = "", context = {}) {
  const storedIssue = normalizeIssueCode(item.issueCode);
  const detectedIssue = classifyIssueText(text, context);
  if (!storedIssue) return detectedIssue;
  if (detectedIssue === "compatibility" && ["fit_sizing", "product_quality", "refund_impact"].includes(storedIssue)) {
    return detectedIssue;
  }
  return storedIssue;
}

function trimAnalysisItemsForCache(items = []) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    key: item.key,
    source: item.source,
    sourceLabel: item.sourceLabel,
    text: truncateText(item.text || item.analysisText || "", 900),
    analysisText: truncateText(item.analysisText || item.text || "", 900),
    reason: item.reason || "",
    noteText: truncateText(item.noteText || "", 500),
    reasonText: truncateText(item.reasonText || "", 500),
    rating: item.rating,
    issueCode: item.issueCode,
    sentiment: item.sentiment,
    emotion: item.emotion,
    subjectiveNegative: Boolean(item.subjectiveNegative),
    createdAt: toIso(item.createdAt),
    updatedAt: toIso(item.updatedAt || item.createdAt),
    variant: item.variant || "",
    quantity: Number(item.quantity || 1),
    amount: Number(item.amount || 0),
    restockType: item.restockType || "",
    adjustmentReasons: Array.isArray(item.adjustmentReasons) ? item.adjustmentReasons.slice(0, 8) : [],
    isOther: Boolean(item.isOther),
  }));
}

function filterAnalysisItemsByLookback(items = [], windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS) {
  const cutoff = Date.now() - Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS)) * 24 * 60 * 60 * 1000;
  return (Array.isArray(items) ? items : []).filter((item) => {
    const date = parseValidDate(item.createdAt || item.updatedAt);
    return !date || date.getTime() >= cutoff;
  });
}

function hasCachedCoverageForOldItems(candidates = [], cachedItems = [], cutoff) {
  const cachedKeys = new Set(cachedItems.map((item) => item.key).filter(Boolean));
  return candidates.every((candidate) => isChangedAfterCutoff(candidate.changedAt, cutoff) || cachedKeys.has(candidate.key));
}

function isChangedAfterCutoff(value, cutoff) {
  const date = parseValidDate(value);
  const cutoffDate = parseValidDate(cutoff);
  if (!date || !cutoffDate) return false;
  return date.getTime() > cutoffDate.getTime();
}

function getReturnTextCacheKey(item = {}) {
  return stableEventCacheKey("return", item, [item.id, item.returnId, item.orderId, item.variantId, item.reason, item.reasonNote, item.customerNote, item.createdAt]);
}

function getReviewTextCacheKey(review = {}) {
  const prefix = review.sourceType || "review";
  const explicitId = [review.id, review.externalId, review.sourceReviewId]
    .find((part) => part !== undefined && part !== null && String(part).trim());
  if (explicitId) return `${prefix}:${String(explicitId)}`;
  return `${prefix}:${stableSignature([
    review.productId,
    review.sourceProductId,
    review.handle,
    review.rating,
    review.title,
    review.body,
    getReviewDateCacheBucket(review.createdAt),
    review.reviewerName,
  ].map((part) => String(part || "")).join("|"))}`;
}

function getReviewDateCacheBucket(value = "") {
  const date = parseValidDate(value);
  if (date) return date.toISOString().slice(0, 10);
  return String(value || "").trim().slice(0, 10);
}

function getRefundTextCacheKey(item = {}) {
  return stableEventCacheKey("refund", item, [item.id, item.refundId, item.orderId, item.variantId, item.reason, item.reasonLabel, item.note, item.restockType, item.createdAt]);
}

function buildDiagnosisSourceFingerprint({
  productContentSignature = "",
  sales = [],
  returns = [],
  refunds = [],
  judgeMeReviews = [],
  yotpoReviews = [],
  looxReviews = [],
  csvReviews = [],
  orderAccessDenied = false,
  sourceCoverage = [],
  windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS,
} = {}) {
  return stableSignature({
    schemaVersion: 1,
    windowDays: Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS),
    orderAccessDenied: Boolean(orderAccessDenied),
    productContentSignature: String(productContentSignature || ""),
    sourceCoverage: (Array.isArray(sourceCoverage) ? sourceCoverage : []).map(String).sort(),
    sales: buildFingerprintEvents(sales, [
      "id",
      "orderId",
      "lineItemId",
      "productId",
      "variantId",
      "sku",
      "quantity",
      "amount",
      "basketFingerprint",
      "countryCode",
      "provinceCode",
      "country",
      "province",
      "orderDate",
      "orderProcessedAt",
      "orderCreatedAt",
      "createdAt",
      "updatedAt",
    ]),
    returns: buildFingerprintEvents(returns, [
      "id",
      "returnId",
      "orderId",
      "lineItemId",
      "variantId",
      "sku",
      "reason",
      "reasonNote",
      "customerNote",
      "quantity",
      "amount",
      "orderDate",
      "orderProcessedAt",
      "orderCreatedAt",
      "createdAt",
      "updatedAt",
      "processedAt",
    ]),
    refunds: buildFingerprintEvents(refunds, [
      "id",
      "refundId",
      "orderId",
      "lineItemId",
      "variantId",
      "sku",
      "reason",
      "reasonLabel",
      "note",
      "restockType",
      "quantity",
      "amount",
      "orderDate",
      "orderProcessedAt",
      "orderCreatedAt",
      "createdAt",
      "updatedAt",
      "processedAt",
      "adjustmentReasons",
    ]),
    judgeMeReviews: buildFingerprintEvents(judgeMeReviews, [
      "id",
      "productId",
      "handle",
      "rating",
      "title",
      "body",
      "reviewerName",
    ]),
    yotpoReviews: buildFingerprintEvents(yotpoReviews, [
      "id",
      "productId",
      "handle",
      "rating",
      "title",
      "body",
      "reviewerName",
    ]),
    looxReviews: buildFingerprintEvents(looxReviews, [
      "id",
      "productId",
      "handle",
      "rating",
      "title",
      "body",
      "reviewerName",
    ]),
    csvReviews: buildFingerprintEvents(csvReviews, [
      "id",
      "productId",
      "handle",
      "rating",
      "title",
      "body",
      "reviewerName",
      "sourceProductId",
    ]),
  });
}

function buildFingerprintEvents(items = [], keys = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => normalizeFingerprintEvent(item, keys))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function normalizeFingerprintEvent(item = {}, keys = []) {
  const normalized = {};
  keys.forEach((key) => {
    const value = item[key];
    if (value === undefined || value === null || value === "") return;
    if (Array.isArray(value)) {
      normalized[key] = value.map((entry) => String(entry || "").trim()).filter(Boolean).sort();
    } else if (typeof value === "number") {
      normalized[key] = roundCurrency(value);
    } else {
      normalized[key] = String(value).trim();
    }
  });
  const key = stableSignature(normalized);
  return { key, ...normalized };
}

function stableEventCacheKey(prefix, item = {}, parts = []) {
  const explicit = parts.find((part) => part !== undefined && part !== null && String(part).trim());
  if (explicit && (String(explicit).startsWith("gid://") || String(explicit).includes(":") || String(explicit).length >= 8)) {
    return `${prefix}:${String(explicit)}`;
  }
  return `${prefix}:${stableSignature(parts.map((part) => String(part || "")).join("|") || JSON.stringify(item || {}))}`;
}

function stableSignature(value) {
  const text = typeof value === "string" ? value : JSON.stringify(value || {});
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function calculateRefundOperationalRiskLift({ refundUnits = 0, refundRate = 0, soldUnits = 0, noteCount = 0 }) {
  const units = Number(refundUnits || 0);
  const rate = Number(refundRate || 0);
  if (units < 3) return 0;
  const noteSupport = noteCount >= 2 ? 1.2 : noteCount === 1 ? 0.5 : 0;
  if (Number(soldUnits || 0) > 10 && rate > 20) {
    return Math.min(10, 3.5 + (rate - 20) * 0.22 + Math.log2(units + 1) * 0.8 + noteSupport);
  }
  if (rate >= 10) {
    return Math.min(4, 1 + rate * 0.08 + Math.log2(units + 1) * 0.35 + noteSupport);
  }
  return 0;
}

function applyRefundInsightsToIssueCounts(issueSignalCounts, refundInsights) {
  if (!refundInsights?.shouldSurface) return;
  issueSignalCounts.refund_impact = Math.max(
    Number(issueSignalCounts.refund_impact || 0),
    Number(refundInsights.total || 0),
  );
  const dominantIssue = normalizeIssueCode(refundInsights.dominantIssueCode);
  if (dominantIssue && dominantIssue !== "product_quality" && dominantIssue !== "refund_impact") {
    issueSignalCounts[dominantIssue] = Math.max(
      Number(issueSignalCounts[dominantIssue] || 0),
      Math.max(2, Number(refundInsights.noteCount || 0)),
    );
  }
}

function summarizeTextSource(items) {
  const sentiment = summarizeSentiment(items);
  const emotions = summarizeEmotionCounts(items);
  return {
    total: items.length,
    sentiment,
    sentimentTrend: buildSentimentTrend(items),
    ratingTrend: buildRatingTrend(items),
    emotions,
    subjectiveNegativity: summarizeSubjectiveNegativity(items),
    repeatedLanguage: extractRepeatedLanguage(items).slice(0, 5),
    examples: uniqueBy(
      items
        .filter((item) => item.sentiment === "negative" || item.isOther)
        .filter((item) => item.text),
      (item) => normalizeText(item.text || item.noteText || ""),
    )
      .slice(0, 4)
      .map((item) => ({
        text: truncateText(item.text, 180),
        sentiment: item.sentiment,
        emotion: item.emotion,
        rating: item.rating,
        issueCode: item.issueCode,
        reason: item.reason || "",
        variant: item.variant || "",
        source: item.source || "",
        sourceLabel: item.sourceLabel || "",
        createdAt: toIso(item.createdAt),
      })),
  };
}

function buildSentimentTrend(items = []) {
  const rows = (Array.isArray(items) ? items : [])
    .map((item) => {
      const date = parseValidDate(item.createdAt || item.updatedAt);
      const sentiment = ["positive", "neutral", "negative"].includes(item.sentiment) ? item.sentiment : "neutral";
      return date ? { date, sentiment } : null;
    })
    .filter(Boolean)
    .sort((first, second) => first.date.getTime() - second.date.getTime());
  if (!rows.length) return [];

  const firstDate = rows[0].date;
  const lastDate = rows[rows.length - 1].date;
  const spanDays = Math.max(1, (lastDate.getTime() - firstDate.getTime()) / (24 * 60 * 60 * 1000));
  const bucketMode = spanDays > 120 ? "month" : spanDays > 28 ? "week" : "day";
  const buckets = new Map();

  rows.forEach((row) => {
    const key = getSentimentTrendBucketKey(row.date, bucketMode);
    const current = buckets.get(key) || {
      key,
      label: getSentimentTrendBucketLabel(row.date, bucketMode),
      date: row.date.toISOString(),
      positive: 0,
      neutral: 0,
      negative: 0,
      total: 0,
    };
    current[row.sentiment] += 1;
    current.total += 1;
    buckets.set(key, current);
  });

  return Array.from(buckets.values()).sort((first, second) => new Date(first.date).getTime() - new Date(second.date).getTime());
}

function buildRatingTrend(items = []) {
  const rows = (Array.isArray(items) ? items : [])
    .map((item) => {
      const date = parseValidDate(item.createdAt || item.updatedAt);
      const rating = Number(item.rating || 0);
      return date && rating > 0 ? { date, rating: clamp(rating, 0, 5) } : null;
    })
    .filter(Boolean)
    .sort((first, second) => first.date.getTime() - second.date.getTime());
  if (!rows.length) return [];

  const firstDate = rows[0].date;
  const lastDate = rows[rows.length - 1].date;
  const spanDays = Math.max(1, (lastDate.getTime() - firstDate.getTime()) / (24 * 60 * 60 * 1000));
  const bucketMode = spanDays > 120 ? "month" : spanDays > 28 ? "week" : "day";
  const buckets = new Map();

  rows.forEach((row) => {
    const key = getSentimentTrendBucketKey(row.date, bucketMode);
    const current = buckets.get(key) || {
      key,
      label: getSentimentTrendBucketLabel(row.date, bucketMode),
      date: row.date.toISOString(),
      ratingSum: 0,
      reviewCount: 0,
    };
    current.ratingSum += row.rating;
    current.reviewCount += 1;
    buckets.set(key, current);
  });

  return Array.from(buckets.values())
    .sort((first, second) => new Date(first.date).getTime() - new Date(second.date).getTime())
    .map((row) => ({
      key: row.key,
      label: row.label,
      date: row.date,
      averageRating: roundRate(row.reviewCount ? row.ratingSum / row.reviewCount : 0, 1),
      reviewCount: row.reviewCount,
    }));
}

function getSentimentTrendBucketKey(date, bucketMode = "month") {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  if (bucketMode === "day") return `${year}-${month}-${day}`;
  if (bucketMode === "week") {
    const weekStart = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()));
    weekStart.setUTCDate(weekStart.getUTCDate() - weekStart.getUTCDay());
    return `${weekStart.getUTCFullYear()}-${String(weekStart.getUTCMonth() + 1).padStart(2, "0")}-${String(weekStart.getUTCDate()).padStart(2, "0")}`;
  }
  return `${year}-${month}`;
}

function getSentimentTrendBucketLabel(date, bucketMode = "month") {
  if (bucketMode === "day") return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  if (bucketMode === "week") return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function summarizeEmotionCounts(items) {
  const grouped = new Map();
  items.forEach((item) => {
    const code = normalizeEmotionCode(item.emotion);
    if (!code || code === "none") return;
    const current = grouped.get(code) || {
      code,
      label: getEmotionLabel(code),
      polarity: getEmotionPolarity(code),
      count: 0,
      sources: new Set(),
      examples: [],
    };
    current.count += 1;
    if (item.source) current.sources.add(item.source);
    if (current.examples.length < 3 && item.text) current.examples.push(truncateText(item.text, 140));
    grouped.set(code, current);
  });

  return Array.from(grouped.values())
    .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label))
    .map((item) => ({
      ...item,
      sources: Array.from(item.sources),
    }));
}

function summarizeSentiment(items) {
  const counts = { positive: 0, neutral: 0, negative: 0 };
  items.forEach((item) => {
    const sentiment = ["positive", "neutral", "negative"].includes(item.sentiment) ? item.sentiment : "neutral";
    counts[sentiment] += 1;
  });
  const total = items.length;
  const dominant = total
    ? Object.entries(counts).sort((first, second) => second[1] - first[1])[0][0]
    : "neutral";
  return {
    ...counts,
    total,
    dominant: counts.negative > 0 && counts.negative === counts.positive ? "mixed" : dominant,
    negativeRatio: total ? roundRate(counts.negative / total, 2) : 0,
  };
}

function getScoreSentimentInputs(textInsights = {}, refundInsights = {}) {
  const customerSentiment = textInsights?.sentiment || {};
  const refundSentiment = refundInsights?.sentiment || {};
  return {
    total: Number(customerSentiment.total || 0) + Number(refundSentiment.total || 0),
    negative: Number(customerSentiment.negative || 0) + Number(refundSentiment.negative || 0),
  };
}

function summarizeSubjectiveNegativity(items) {
  const sourceCounts = {};
  const subjectiveItems = (Array.isArray(items) ? items : []).filter((item) => item?.subjectiveNegative);
  subjectiveItems.forEach((item) => {
    const source = item.source || "unknown";
    sourceCounts[source] = (sourceCounts[source] || 0) + 1;
  });
  const total = Array.isArray(items) ? items.length : 0;
  return {
    count: subjectiveItems.length,
    total,
    ratio: total ? roundRate(subjectiveItems.length / total, 2) : 0,
    sourceCounts,
    examples: subjectiveItems.slice(0, 4).map((item) => truncateText(item.noteText || item.text, 180)),
  };
}

function summarizeOtherReturnClassifications(returnTexts) {
  const otherItems = returnTexts.filter((item) => item.isOther && item.noteText);
  const grouped = new Map();
  otherItems.forEach((item) => {
    const key = item.issueCode || "product_quality";
    const current = grouped.get(key) || {
      issueCode: key,
      label: getHumanIssueLabel(key),
      count: 0,
      sentimentCounts: { positive: 0, neutral: 0, negative: 0 },
      examples: [],
    };
    current.count += 1;
    current.sentimentCounts[item.sentiment] = (current.sentimentCounts[item.sentiment] || 0) + 1;
    if (current.examples.length < 3) current.examples.push(truncateText(item.noteText || item.text, 160));
    grouped.set(key, current);
  });
  return Array.from(grouped.values()).sort((first, second) => second.count - first.count).slice(0, 5);
}

function buildDeterministicTextIssues({ sentiment, returnsSummary, reviewsSummary, subjectiveNegativity, otherReturnClassifications, repeatedLanguage }) {
  const issues = [];

  if (otherReturnClassifications.length) {
    otherReturnClassifications.forEach((item) => {
      if (Number(item.count || 0) < MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) return;
      const isSubjective = item.issueCode === "subjective_negative_reaction";
      const severity = isSubjective
        ? getSubjectiveIssueSeverity(subjectiveNegativity)
        : item.sentimentCounts.negative >= 2 || item.count >= 3 ? "medium" : "low";
      issues.push({
        issueCode: item.issueCode,
        issue: `"Other" returns indicate ${item.label}`,
        severity,
        signals: item.count,
        evidence: [
          `${item.count} generic return reason${item.count === 1 ? "" : "s"} reclassified from customer text as ${item.label}.`,
          isSubjective ? getSubjectiveEvidencePolicyText(subjectiveNegativity) : "",
          ...item.examples.map((example) => `Example: "${example}"`),
        ].filter(Boolean),
        action: "Review Other return notes",
        sourceTypes: ["shopify_return_note"],
      });
    });
  }

  if (hasActionableSubjectiveEvidence(subjectiveNegativity) && !otherReturnClassifications.some((item) => item.issueCode === "subjective_negative_reaction" && item.count >= MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE)) {
    issues.push({
      issueCode: "subjective_negative_reaction",
      issue: "Subjective negative customer reaction",
      severity: getSubjectiveIssueSeverity(subjectiveNegativity),
      signals: subjectiveNegativity.count,
      evidence: [
        `${subjectiveNegativity.count} of ${subjectiveNegativity.total} customer text signals are subjective negative reactions.`,
        getSubjectiveEvidencePolicyText(subjectiveNegativity),
        ...subjectiveNegativity.examples.map((example) => `Example: "${example}"`),
      ].filter(Boolean),
      action: hasActionableSubjectiveEvidence(subjectiveNegativity)
        ? "Review expectation-setting copy"
        : "Monitor for repeated subjective reactions",
      sourceTypes: Object.keys(subjectiveNegativity.sourceCounts || {}),
    });
  }

  if (sentiment.negative >= 2 && sentiment.negativeRatio >= 0.35) {
    const subjectiveOnly = subjectiveNegativity?.count >= sentiment.negative;
    if (!subjectiveOnly) {
      issues.push({
        issueCode: "negative_sentiment",
        issue: "Negative customer sentiment cluster",
        severity: sentiment.negativeRatio >= 0.6 ? "high" : "medium",
        signals: sentiment.negative,
        evidence: [
          `${sentiment.negative} of ${sentiment.total} customer text signals read as negative.`,
          `Returns: ${returnsSummary.sentiment.negative} negative. Reviews: ${reviewsSummary.sentiment.negative} negative.`,
        ].filter(Boolean),
        action: "Review customer sentiment evidence",
        sourceTypes: uniqueBy([
          returnsSummary.sentiment.negative > 0 ? "returns" : "",
          reviewsSummary.sentiment.negative > 0 ? "reviews" : "",
        ].filter(Boolean), (item) => item),
      });
    }
  }

  repeatedLanguage.filter(isActionableRepeatedLanguageIssue).slice(0, 3).forEach((item) => {
    if (item.count < 2) return;
    issues.push({
      issueCode: item.issueCode || "repeated_language",
      issue: `Repeated customer language: "${item.term}"`,
      severity: item.count >= 4 ? "medium" : "low",
      signals: item.count,
      evidence: [
        `"${item.term}" appears ${item.count} times across ${item.sources.join(" and ")}.`,
        item.example ? `Example context: "${item.example}"` : "",
      ].filter(Boolean),
      action: "Review repeated language",
      sourceTypes: item.sources,
    });
  });

  return issues;
}

function hasActionableSubjectiveEvidence(summary) {
  const count = Number(summary?.count || 0);
  const ratio = Number(summary?.ratio || 0);
  return count >= 4 || (count >= 2 && ratio >= 0.35);
}

function getSubjectiveIssueSeverity(summary) {
  const count = Number(summary?.count || 0);
  const ratio = Number(summary?.ratio || 0);
  if (count >= 8 && ratio >= 0.45) return "high";
  if (count >= 4 || (count >= 2 && ratio >= 0.35)) return "medium";
  return "low";
}

function getSubjectiveEvidencePolicyText(summary) {
  const count = Number(summary?.count || 0);
  if (count <= 1) {
    return "Subjective reactions are kept low-confidence until repeated by more customers.";
  }
  if (!hasActionableSubjectiveEvidence(summary)) {
    return "Subjective reactions are still below the action threshold and should be monitored.";
  }
  return "Subjective reactions are repeated enough to become merchant-facing evidence.";
}

function extractRepeatedLanguage(items) {
  const counts = new Map();
  items.forEach((item) => {
    const analysisText = getCustomerAnalysisText(item);
    if (!analysisText) return;
    const tokens = customerLanguageTokens(analysisText);
    const phrases = new Set([
      ...tokens.filter((token) => isUsefulRepeatedLanguageTerm(token)),
      ...tokens.slice(0, -1)
        .map((token, index) => `${token} ${tokens[index + 1]}`)
        .filter((term) => isUsefulRepeatedLanguageTerm(term)),
    ]);
    phrases.forEach((term) => {
      const current = counts.get(term) || {
        term,
        count: 0,
        sources: new Set(),
        issueCode: classifyIssueText(`${term} ${analysisText}`),
        sentiments: { positive: 0, neutral: 0, negative: 0 },
        example: "",
      };
      current.count += 1;
      current.sources.add(item.source);
      current.sentiments[item.sentiment] = (current.sentiments[item.sentiment] || 0) + 1;
      if (!current.example) current.example = truncateText(analysisText, 140);
      counts.set(term, current);
    });
  });
  return Array.from(counts.values())
    .filter((item) => item.count >= 2)
    .sort((first, second) => second.count - first.count || second.sources.size - first.sources.size)
    .slice(0, 10)
    .map((item) => ({
      ...item,
      sources: Array.from(item.sources),
      dominantSentiment: Object.entries(item.sentiments).sort((first, second) => second[1] - first[1])[0]?.[0] || "neutral",
    }));
}

function customerLanguageTokens(value) {
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3)
    .filter((token) => !CUSTOMER_TEXT_STOP_WORDS.has(token));
}

function maskResolvedNegativeCustomerLanguage(normalized) {
  return String(normalized || "")
    .replace(/\b(no|without|free from)\s+(chips?|damage|damaged|cracks?|cracked|breakage|broken|defects?|issues?|problems?)\b/g, " ")
    .replace(/\b(arrived safely|arrived intact|better packaging|better separators|packaging looked much better|problem is being handled|issue is being handled|handled well|resolved|fixed|improved|more confident)\b/g, " ");
}

function hasPositiveRecoveryCustomerLanguage(normalized) {
  return /\b(arrived safely|arrived intact|better packaging|better separators|packaging looked much better|no chips?|no damage|no cracks?|problem is being handled|issue is being handled|resolved|fixed|improved|more confident)\b/.test(normalized);
}

function hasUnresolvedNegativeCustomerLanguage(normalized) {
  return /\b(still broken|still cracked|still damaged|still missing|still a problem|still an issue|arrived broken|arrived damaged|arrived cracked|not fixed|not resolved|not improved|no improvement|continues? to|keeps? (breaking|leaking|failing)|doesn t work|doesnt work|not working|unusable|unsafe|dangerous|failed|leaks?|leaking)\b/.test(normalized);
}

function normalizeSentimentForPositiveRecovery(sentiment = "neutral", text = "", rating = 0) {
  const normalizedSentiment = normalizeAiSentiment(sentiment);
  const normalized = normalizeText(text);
  if (
    normalizedSentiment === "negative"
    && Number(rating || 0) >= 4
    && hasPositiveRecoveryCustomerLanguage(normalized)
    && !hasUnresolvedNegativeCustomerLanguage(normalized)
  ) return "positive";
  if (
    normalizedSentiment === "negative"
    && hasPositiveRecoveryCustomerLanguage(normalized)
    && !hasUnresolvedNegativeCustomerLanguage(normalized)
    && /\b(arrived safely|arrived intact|no chips?|no damage|no cracks?|more confident|reliable|handled)\b/.test(normalized)
  ) return "positive";
  return normalizedSentiment;
}

function classifyCustomerSentiment(text, rating = 0) {
  const normalized = normalizeText(text);
  const sentimentText = maskResolvedNegativeCustomerLanguage(normalized);
  const negativeMatches = countRegexMatches(sentimentText, /(bad|poor|cheap|thin|broken|defect|damage|damaged|disappointed|return|refund|small|large|tight|loose|wrong|issue|problem|unhappy|terrible|awful|not fit|doesn t fit|doesnt fit|not as pictured|late|scare|scary|scared|fear|afraid|fright|unsafe|danger|dangerous|creepy|asusta|asustado|miedo|temor|peligro|peligroso|terror)/g);
  const positiveMatches = countRegexMatches(normalized, /(great|good|love|loved|perfect|excellent|happy|quality|comfortable|recommend|works well|beautiful)/g);
  const ratingNumber = Number(rating || 0);
  if (ratingNumber > 0 && ratingNumber <= 2) return "negative";
  if (ratingNumber === 3 && Math.abs(negativeMatches - positiveMatches) <= 1) return "neutral";
  if (
    ratingNumber >= 4
    && hasPositiveRecoveryCustomerLanguage(normalized)
    && !hasUnresolvedNegativeCustomerLanguage(normalized)
  ) return "positive";
  if (negativeMatches > positiveMatches) return "negative";
  if (ratingNumber >= 4 && positiveMatches >= negativeMatches) return "positive";
  if (positiveMatches > negativeMatches) return "positive";
  return "neutral";
}

function classifyCustomerEmotion(text, rating = 0) {
  const normalized = normalizeText(text);
  const ratingNumber = Number(rating || 0);
  if (
    ratingNumber >= 4
    && hasPositiveRecoveryCustomerLanguage(normalized)
    && !hasUnresolvedNegativeCustomerLanguage(normalized)
  ) {
    if (/\b(confident|confidence|reliable|trust|handled|being handled|resolved|fixed)\b/.test(normalized)) return "trust";
    return "relief";
  }
  const emotionText = maskResolvedNegativeCustomerLanguage(normalized);
  if (/(scare|scary|scared|fear|afraid|fright|unsafe|danger|dangerous|creepy|asusta|asustado|miedo|temor|peligro|peligroso|terror)/.test(emotionText)) return "fear";
  if (/(angry|mad|furious|rage|annoyed|irritated|enojado|enojo|furioso|bronca)/.test(emotionText)) return "anger";
  if (/(confusing|confused|unclear|don t understand|doesnt understand|hard to use|no entiendo|confuso|confundido)/.test(emotionText)) return "confusion";
  if (/(disappointed|let down|not as expected|expected better|decepcion|decepcionado)/.test(emotionText)) return "disappointment";
  if (/(regret|waste|wish i hadn|shouldn t have|arrepent|arrepentido)/.test(emotionText)) return "regret";
  if (/(trust|fake|misleading|dishonest|not real|engaño|enganoso|desconf)/.test(emotionText)) return "distrust";
  if (/(frustrated|frustrating|problem|issue|return|refund|doesn t work|doesnt work|frustra|frustrante)/.test(emotionText)) return "frustration";
  if (/(not sure|maybe|uncertain|unsure|doubt|duda|incierto)/.test(emotionText)) return "uncertainty";
  if (rating >= 4 && /(love|great|excellent|perfect|beautiful|happy|encanta|excelente|perfecto)/.test(normalized)) return "delight";
  if (rating >= 4 && /(works|good|satisfied|quality|recom|bien|satisfecho)/.test(normalized)) return "satisfaction";
  if (rating >= 4 && /(relief|solved|easy|finally|alivio|resolvio|facil)/.test(normalized)) return "relief";
  if (rating >= 4) return "satisfaction";
  return "none";
}

function isObjectiveSafetyText(text) {
  const normalized = normalizeText(text);
  return /(unsafe|danger|dangerous|hazard|hazardous|injury|injured|sharp|toxic|poison|burn|choking|fire|electrical|peligro|peligroso|lastim|herid|toxico|quemad)/.test(normalized);
}

function isSubjectiveNegativeText(text) {
  const normalized = normalizeText(text);
  if (!normalized || isObjectiveSafetyText(normalized)) return false;
  return /(scare|scary|scared|fear|afraid|fright|creepy|creeped|unsettling|disturbing|weird|ugly|gross|hate|dislike|don t like|doesn t like|dont like|doesnt like|not my style|asusta|asustado|miedo|temor|terror|feo|horrible|raro|perturb|inquieta|no me gusta|me da miedo)/.test(normalized);
}

function countRegexMatches(value, regex) {
  return (String(value || "").match(regex) || []).length;
}

function isGenericOtherReason(value) {
  return /(^|\s)(other|unknown|not listed|uncategorized|misc|miscellaneous)(\s|$)/i.test(String(value || ""));
}

function isDefaultCustomerLanguageTerm(value) {
  const normalized = normalizeText(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return true;
  if (CUSTOMER_TEXT_STOP_WORDS.has(normalized)) return true;
  if (DEFAULT_CUSTOMER_LANGUAGE_PHRASES.has(normalized)) return true;
  const tokens = normalized.split(" ").filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => CUSTOMER_TEXT_STOP_WORDS.has(token));
}

function isUsefulRepeatedLanguageTerm(value) {
  const normalized = normalizeText(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  if (normalized.length < 4 || isDefaultCustomerLanguageTerm(normalized)) return false;
  const tokens = normalized.split(" ").filter(Boolean);
  if (!tokens.length) return false;
  if (tokens.length === 1 && tokens[0] === "not") return false;
  return tokens.some((token) => !CUSTOMER_TEXT_STOP_WORDS.has(token) && (token.length >= 4 || CUSTOMER_TEXT_SHORT_SIGNAL_WORDS.has(token)));
}

function isActionableRepeatedLanguageIssue(item = {}) {
  const normalized = normalizeText(item.term || item.label || item.phrase).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
  if (!isUsefulRepeatedLanguageTerm(normalized)) return false;
  const tokens = normalized.split(" ").filter(Boolean);
  if (tokens.every((token) => CUSTOMER_TEXT_POSITIVE_DESCRIPTOR_WORDS.has(token))) return false;
  const dominantSentiment = String(item.dominantSentiment || "").toLowerCase();
  const negativeCount = Number(item.sentiments?.negative || 0);
  if (dominantSentiment === "positive" && negativeCount === 0) return false;
  if (!hasRepeatedLanguageProblemCue(normalized) && negativeCount === 0) return false;
  return true;
}

function hasRepeatedLanguageProblemCue(value = "") {
  return /\b(too|not|missing|wrong|different|small|large|tight|loose|runs|leak|leaking|broken|break|broke|damaged|damage|cracked|chip|chipped|confusing|confusion|unclear|failed|failure|unsafe|scary|fear|frightening|creepy|heavy|wobbly|unstable|refund|returned|disappointed|poor|cheap|doesn|doesnt|didn|didnt|mismatch|mismatched|compatibility|incompatible|delayed|late|lost)\b/i.test(String(value || ""));
}

const CUSTOMER_TEXT_STOP_WORDS = new Set([
  "about",
  "above",
  "after",
  "again",
  "against",
  "also",
  "although",
  "always",
  "among",
  "and",
  "are",
  "but",
  "did",
  "does",
  "doing",
  "done",
  "get",
  "gets",
  "got",
  "had",
  "has",
  "having",
  "into",
  "its",
  "just",
  "many",
  "may",
  "might",
  "more",
  "most",
  "much",
  "must",
  "only",
  "onto",
  "our",
  "out",
  "own",
  "same",
  "shall",
  "some",
  "still",
  "such",
  "than",
  "their",
  "them",
  "then",
  "there",
  "these",
  "thing",
  "things",
  "those",
  "through",
  "took",
  "take",
  "taken",
  "taking",
  "under",
  "want",
  "wanted",
  "was",
  "way",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "will",
  "would",
  "with",
  "within",
  "without",
  "from",
  "that",
  "this",
  "been",
  "being",
  "have",
  "they",
  "very",
  "anything",
  "because",
  "before",
  "between",
  "could",
  "during",
  "even",
  "nothing",
  "over",
  "should",
  "something",
  "away",
  "back",
  "really",
  "product",
  "products",
  "return",
  "returns",
  "returned",
  "reason",
  "reasons",
  "refund",
  "refunds",
  "refunded",
  "order",
  "item",
  "customer",
  "review",
  "selected",
  "select",
  "default",
  "other",
  "unknown",
  "misc",
  "miscellaneous",
  "uncategorized",
]);

const CUSTOMER_TEXT_SHORT_SIGNAL_WORDS = new Set([
  "bad",
  "fit",
  "red",
]);

const CUSTOMER_TEXT_POSITIVE_DESCRIPTOR_WORDS = new Set([
  "accurate",
  "beautiful",
  "build",
  "clear",
  "complete",
  "comfortable",
  "cute",
  "excellent",
  "fast",
  "finished",
  "gift",
  "good",
  "great",
  "happy",
  "included",
  "includes",
  "listing",
  "love",
  "loved",
  "lovely",
  "matched",
  "matches",
  "matching",
  "nice",
  "perfect",
  "premium",
  "pretty",
  "quality",
  "recommend",
  "shipping",
  "solid",
  "satisfied",
  "satisfaction",
]);

const DEFAULT_CUSTOMER_LANGUAGE_PHRASES = new Set([
  "other reason",
  "other reasons",
  "return reason",
  "return reasons",
  "refund reason",
  "refund reasons",
  "reason selected",
  "selected reason",
  "default reason",
  "customer reason",
  "customer note",
  "reason note",
  "not listed",
  "unknown reason",
  "misc reason",
  "miscellaneous reason",
  "uncategorized reason",
]);

function getMainIssueFromCounts(counts, fallback) {
  const sorted = Object.entries(counts).sort((first, second) => second[1] - first[1]);
  if (sorted[0]?.[0]) return sorted[0][0];
  return normalizeIssueCode(fallback) || "product_quality";
}

function getEvidencePreferredMainIssue(deterministic = {}, proposedIssue = "") {
  const proposed = normalizeIssueCode(proposedIssue) || normalizeIssueCode(deterministic.mainIssue) || "product_quality";
  const counts = deterministic.issueSignalCounts || {};
  const rawCurrent = counts[proposed] ? proposed : normalizeIssueCode(deterministic.mainIssue) || proposed;
  const current = isExpectationIssueCode(rawCurrent) && !hasStrongExpectationIssueEvidence(deterministic, rawCurrent)
    ? getStrongestNonExpectationIssueFromCounts(counts) || "product_quality"
    : rawCurrent;
  if (Number(counts.setup_expectation || 0) > 0
    && hasSetupExpectationTextSignals(deterministic)
    && hasStrongExpectationIssueEvidence(deterministic, "setup_expectation")) {
    return "setup_expectation";
  }
  if (shouldPreferFitSizingMainIssue(deterministic, counts, current)) return "fit_sizing";
  if (["quality_defect", "durability", "safety_concern", "refund_impact"].includes(current)) return current;
  if (!hasProductFailureTextSignals(deterministic)) return current;
  if (Number(deterministic.riskScore || 0) < 70 || !hasMaterialCustomerProblemEvidence(deterministic)) return current;
  if (Number(counts.safety_concern || 0) > 0) return "safety_concern";
  if (Number(counts.durability || 0) > 0) return "durability";
  if (shouldPreferFitSizingMainIssue(deterministic, counts, current)) return "fit_sizing";
  if (Number(counts.quality_defect || 0) > 0) return "quality_defect";
  return "quality_defect";
}

function getStrongestNonExpectationIssueFromCounts(counts = {}) {
  const sorted = Object.entries(counts)
    .map(([issueCode, count]) => [normalizeIssueCode(issueCode), Number(count || 0)])
    .filter(([issueCode, count]) => issueCode && count > 0 && !isExpectationIssueCode(issueCode))
    .sort((first, second) => second[1] - first[1]);
  return sorted[0]?.[0] || "";
}

function shouldPreferFitSizingMainIssue(deterministic = {}, counts = {}, current = "") {
  if (!hasFitSizingTextSignals(deterministic)) return false;
  if (!hasStrongExpectationIssueEvidence(deterministic, "fit_sizing")) return false;
  const fitSignals = Number(counts.fit_sizing || 0)
    + countIssueCountRows(deterministic.metrics?.refundInsights?.issueCounts, "fit_sizing")
    + countRepeatedLanguageIssueRows(deterministic.metrics?.textInsights?.repeatedLanguage, "fit_sizing");
  const qualitySignals = Number(counts.quality_defect || 0)
    + Number(counts.product_quality || 0)
    + countIssueCountRows(deterministic.metrics?.refundInsights?.issueCounts, "quality_defect")
    + countIssueCountRows(deterministic.metrics?.refundInsights?.issueCounts, "product_quality")
    + countRepeatedLanguageIssueRows(deterministic.metrics?.textInsights?.repeatedLanguage, "quality_defect")
    + countRepeatedLanguageIssueRows(deterministic.metrics?.textInsights?.repeatedLanguage, "product_quality");
  if (fitSignals >= 2 && fitSignals >= qualitySignals) return true;
  const normalizedCurrent = normalizeIssueCode(current);
  return ["quality_defect", "product_quality"].includes(normalizedCurrent)
    && fitSignals >= 2
    && isApparelLikeDiagnosis(deterministic);
}

function countIssueCountRows(rows = [], issueCode = "") {
  const normalizedIssue = normalizeIssueCode(issueCode);
  return (Array.isArray(rows) ? rows : []).reduce((total, row) => {
    const label = normalizeIssueCode(row?.label || row?.issueCode || row?.issue_code || row?.issue);
    return total + (label === normalizedIssue ? Number(row?.count || 0) : 0);
  }, 0);
}

function countRepeatedLanguageIssueRows(rows = [], issueCode = "") {
  const normalizedIssue = normalizeIssueCode(issueCode);
  return (Array.isArray(rows) ? rows : []).reduce((total, row) => {
    const label = normalizeIssueCode(row?.issueCode || row?.issue_code || row?.issueCategory || row?.issue_category);
    return total + (label === normalizedIssue ? Number(row?.count || 1) : 0);
  }, 0);
}

function hasFitSizingTextSignals(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  const text = normalizeText([
    deterministic.mainIssue,
    deterministic.mainFinding?.title,
    deterministic.mainFinding?.summary,
    deterministic.mainFinding?.detail,
    deterministic.product?.title,
    deterministic.product?.productType,
    ...(Array.isArray(deterministic.product?.tags) ? deterministic.product.tags : []),
    ...(Array.isArray(deterministic.evidenceSnippets) ? deterministic.evidenceSnippets : []).map((item) => item.text || item.body || item.quote || item.summary || ""),
    ...(Array.isArray(metrics.topReturnReasonDetails) ? metrics.topReturnReasonDetails : []).flatMap((item) => [
      item.label,
      item.detail,
      ...(Array.isArray(item.subReasons) ? item.subReasons.map((subReason) => subReason.label) : []),
    ]),
    ...(Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : []),
    ...(Array.isArray(metrics.textInsights?.repeatedLanguage) ? metrics.textInsights.repeatedLanguage : []).map((item) => `${item.term || ""} ${item.example || ""} ${item.issueCode || ""}`),
    ...(Array.isArray(metrics.refundInsights?.examples) ? metrics.refundInsights.examples : []).map((item) => `${item.text || ""} ${item.noteText || ""} ${item.issueCode || ""}`),
  ].flat().filter(Boolean).join(" "));
  return /\b(fit|fits|fitting|size|sizing|too small|too large|runs small|runs large|chest|shoulder|sleeve|upper arm|garment measurement|body measurement|size chart|layering|sweatshirt|waist|inseam)\b/.test(text);
}

function isApparelLikeDiagnosis(deterministic = {}) {
  const product = deterministic.product || {};
  const text = normalizeText([
    product.title,
    product.productType,
    product.description,
    ...(Array.isArray(product.tags) ? product.tags : []),
  ].filter(Boolean).join(" "));
  return /\b(apparel|clothing|overshirt|shirt|garment|jacket|sleeve|shoulder|size chart|body measurement)\b/.test(text);
}

function classifyIssueText(text, context = {}) {
  const normalized = normalizeText(text);
  const sentiment = String(context.sentiment || "").toLowerCase();
  const rating = Number(context.rating || 0);
  const positiveContext = sentiment === "positive" || rating >= 4;
  const explicitIssue = containsIssueLanguage(normalized) || isObjectiveSafetyText(normalized) || isSubjectiveNegativeText(normalized);
  if (positiveContext && !explicitIssue) return "product_quality";
  if (/(not compatible|incompatible|compatibility issue|compatibility mismatch|compatibility gap|compatibility boundary|outside supported compatibility|doesn t work with|doesnt work with|won t work with|wont work with|does not work with|fit with)/.test(normalized)) return "compatibility";
  if (!positiveContext && /(compatibility|compatible)/.test(normalized) && /(case|setup|boundary|unsupported|supported|mismatch|gap|outside|discovering|confusion)/.test(normalized)) return "compatibility";
  if (isSetupExpectationMismatchText(normalized, { positiveContext })) return "setup_expectation";
  if (/(too small|too large|doesn t fit|doesnt fit|does not fit|didn t fit|didnt fit|not fit|wrong size|runs small|runs large|fit issue|fit problem|sizing issue|tight|loose|waist|chest|shoulder|sleeve|length)/.test(normalized)
    || (!positiveContext && /\b(fit|size|sizing|small|large)\b/.test(normalized) && explicitIssue)) return "fit_sizing";
  if (isObjectiveSafetyText(normalized)) return "safety_concern";
  if (isSubjectiveNegativeText(normalized)) return "subjective_negative_reaction";
  if (/(wrong color|different color|not as pictured|not pictured|picture|pictured|photo|image|shade|looks different|looked different|color mismatch|colour mismatch)/.test(normalized)
    || (!positiveContext && /(color|colour)/.test(normalized) && explicitIssue)) return "color_expectation";
  if (/(break|broken|defect|defective|damage|damaged|poor quality|cheap|durability|leak|leaking|spill|spilled|crack|cracked|chip|chipped|tear|ripped|malfunction|failed|failure|rough|scratchy|stiff|thin material|bad material|bad fabric)/.test(normalized)
    || (!positiveContext && /(quality|soft|softness|material|fabric|texture|build)/.test(normalized) && explicitIssue)) return "quality_defect";
  if (/(late|delayed|lost package|lost shipment|shipping problem|delivery problem|arrived damaged|damaged in transit)/.test(normalized)
    || (!positiveContext && /(shipping|delivery|arrived)/.test(normalized) && explicitIssue)) return "shipping_delivery";
  return "product_quality";
}

function isSetupExpectationMismatchText(normalizedText = "", { positiveContext = false } = {}) {
  if (positiveContext) return false;
  const setupTerms = /\b(setup|install|installation|mount|mounting|adhesive|surface|surfaces|clamp|clamps|cure|oiled|textured|porous|sealed|warm underside|shelf|cable|routing|left side|right side|flip|flipping|adapter|wall brick|wall adapter|usb c|usb-c|webcam|camera|banding|bands|flicker|glossy|reflection|glare|min line|minimum fill|min fill|fill line|120v|120 v|voltage|converter|travel converter|power bank|car socket|steam vent|vent clearance|counter placement|outlet|boil|boiling)\b/.test(normalizedText);
  if (!setupTerms) return false;
  const expectationTerms = /\b(expectation|mismatch|confusing|unclear|buried|missed|not obvious|did not understand|didn t understand|page|listing|description|pdp|checklist|rule|guidance|before checkout|before buying|support pointed|technically explains|probably present|not broken|conditional)\b/.test(normalizedText);
  const supportedSetupTerms = /\b(use clamps|clamp feet|smooth sealed|surface checklist|camera warning|no wall adapter|cable exits|flip option|control button|not a video|not video|not included|120 v only|120v only|above the min line|min fill line|steam vent|travel converters|power banks|car sockets)\b/.test(normalizedText);
  return expectationTerms || supportedSetupTerms;
}

function hasSetupExpectationTextSignals(deterministic = {}) {
  return getOperationalSignalTextValues(deterministic)
    .some((value) => isSetupExpectationMismatchText(normalizeText(value)));
}

function analyzeProductContentDeterministically(product) {
  const description = stripHtml(product.description || product.descriptionHtml || "").replace(/\s+/g, " ").trim();
  const descriptionWordCount = description ? description.split(/\s+/).filter(Boolean).length : 0;
  const normalizedDescription = normalizeText(description);
  const normalizedTitle = normalizeText(product.title);
  const productType = normalizeText(product.productType);
  const productCategory = normalizeProductCategory(product.category);
  const seoTitle = String(product.seoTitle || "").replace(/\s+/g, " ").trim();
  const seoDescription = String(product.seoDescription || "").replace(/\s+/g, " ").trim();
  const handle = String(product.handle || "").trim();
  const templateSuffix = String(product.templateSuffix || "").trim();
  const tags = Array.isArray(product.tags) ? product.tags.map(String).filter(Boolean) : [];
  const collections = Array.isArray(product.collections) ? product.collections.map(String).filter(Boolean) : [];
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const media = Array.isArray(product.media) ? product.media : [];
  const issues = [];
  const advisories = [];

  if (isGenericProductTitle(product.title)) {
    issues.push(buildContentIssue("generic_title", "Product title is too generic", "medium", "The Shopify title does not clearly identify the product.", 6));
  }

  if (!description) {
    issues.push(buildContentIssue("missing_description", "Missing product description", "high", "The Shopify product description is empty.", 12));
  } else if (descriptionWordCount < 25) {
    issues.push(buildContentIssue("short_description", "Short product description", "medium", `The description has ${descriptionWordCount} words.`, 7));
  }

  if (description && normalizedTitle && isClearlyDisconnectedTitleDescription(product, description)) {
    advisories.push(buildContentAdvisory("title_description_mismatch", "Title and description need semantic review", "The local content check found weak title/description overlap. ProductPulse AI must confirm a clear mismatch before this becomes a product issue."));
  }

  const variantMismatchIssue = buildDescriptionVariantMismatchIssue(product, description);
  if (variantMismatchIssue) issues.push(variantMismatchIssue);

  if (description && productType && !normalizedDescription.includes(productType) && productType.length > 3) {
    advisories.push(buildContentAdvisory("missing_product_type_context", "Product type could be clearer", `Product type "${product.productType}" is not reflected in the description.`));
  }

  const descriptiveTags = tags.filter((tag) => normalizeText(tag).length > 3).slice(0, 8);
  const matchedTags = descriptiveTags.filter((tag) => normalizedDescription.includes(normalizeText(tag)));
  if (description && descriptiveTags.length >= 3 && matchedTags.length === 0) {
    advisories.push(buildContentAdvisory("tag_description_mismatch", "Tags could be reflected in description", "Product tags do not appear to be represented in the description copy."));
  }

  if (description && collections.length && !collections.some((collection) => hasMeaningfulTokenOverlap(collection, description))) {
    advisories.push(buildContentAdvisory("collection_mismatch", "Collection context could be clearer", "Collections are not clearly reflected in the product description."));
  }

  if (variants.length > 1 && variants.some((variant) => isDefaultVariantTitle(variant.title))) {
    advisories.push(buildContentAdvisory("unclear_variant_names", "Variant names could be clearer", "At least one variant uses a default or unclear option name."));
  }

  if (!media.length) {
    advisories.push(buildContentAdvisory("missing_media_context", "Product media needs review", "No product media was available in Shopify product data."));
  } else if (media.some((item) => !String(item.alt || "").trim())) {
    advisories.push(buildContentAdvisory("missing_media_alt_text", "Media alt text could be improved", "One or more product media items have no alt text."));
  }

  if (!seoTitle) {
    advisories.push(buildContentAdvisory("missing_seo_title", "SEO title is missing", "The product has no explicit Shopify SEO title."));
  } else if (seoTitle.length > 70 || isGenericProductTitle(seoTitle)) {
    advisories.push(buildContentAdvisory("weak_seo_title", "SEO title could be stronger", `The SEO title is ${seoTitle.length > 70 ? "too long" : "too generic"} for search results.`));
  }

  if (!seoDescription) {
    advisories.push(buildContentAdvisory("missing_meta_description", "Meta description is missing", "The product has no explicit Shopify meta description."));
  } else if (seoDescription.length < 70 || seoDescription.length > 165) {
    advisories.push(buildContentAdvisory("weak_meta_description", "Meta description could be clearer", `The meta description is ${seoDescription.length < 70 ? "too short" : "too long"} for search results.`));
  }

  if (handle && shouldReviewProductHandle(handle, product.title)) {
    advisories.push(buildContentAdvisory("weak_product_handle", "URL handle could be clearer", "The product URL handle is hard to read, inconsistent with the title, or missing useful product keywords."));
  }

  const hasSpecsLanguage = /(dimension|dimensions|size|sizing|material|materials|compatible|compatibility|includes|included|care|weight|height|width|length|capacity|model|specification|specifications)/i.test(description);
  const specsBlockRecommended = Boolean(description && !hasSpecsLanguage && (descriptionWordCount < 80 || productType || variants.length > 1));
  if (specsBlockRecommended) {
    advisories.push(buildContentAdvisory("missing_specs_block", "Specs/details block could improve clarity", "The description does not clearly separate specifications, compatibility, included items, materials, care or limits."));
  }

  if (!String(product.vendor || "").trim() || !String(product.productType || "").trim() || !productCategory.id) {
    advisories.push(buildContentAdvisory("classification_incomplete", "Product classification needs review", "Vendor, product type or Shopify category is missing, which can weaken catalog workflows and reporting."));
  }

  const templateNeedsReview = Boolean(!templateSuffix && (specsBlockRecommended || issues.some((issue) => ["missing_description", "short_description", "description_variant_mismatch"].includes(issue.code))));
  if (templateNeedsReview) {
    advisories.push(buildContentAdvisory("template_may_need_special_layout", "Product template could support richer guidance", "This product may need a template that can show FAQ, specs or warning content more clearly than plain description text."));
  }

  const score = clamp(100 - issues.reduce((total, issue) => total + issue.riskLift * 3, 0), 0, 100);

  return {
    hasDescription: Boolean(description),
    descriptionLength: description.length,
    descriptionWordCount,
    titleNeedsReview: issues.some((issue) => issue.code === "generic_title"),
    seoTitleNeedsReview: advisories.some((issue) => ["missing_seo_title", "weak_seo_title"].includes(issue.code)),
    metaDescriptionNeedsReview: advisories.some((issue) => ["missing_meta_description", "weak_meta_description"].includes(issue.code)),
    handleNeedsReview: advisories.some((issue) => issue.code === "weak_product_handle"),
    specsBlockRecommended,
    classificationNeedsReview: advisories.some((issue) => issue.code === "classification_incomplete"),
    templateNeedsReview,
    variantNamingAdvisory: advisories.some((issue) => issue.code === "unclear_variant_names"),
    mediaCount: media.length,
    mediaWithoutAltCount: media.filter((item) => !String(item.alt || "").trim()).length,
    score,
    riskLift: Math.min(18, issues.reduce((total, issue) => total + issue.riskLift, 0)),
    issues,
    advisories,
  };
}

function isGenericProductTitle(value) {
  const normalized = normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
  if (!normalized) return true;
  if (["product", "untitled product", "sample product", "default title", "new product", "test product"].includes(normalized)) return true;
  const tokens = meaningfulTokens(normalized);
  return normalized.length < 8 && tokens.length <= 1;
}

function isDefaultVariantTitle(value) {
  const normalized = normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
  return !normalized || normalized === "default title" || normalized === "default";
}

function shouldReviewProductHandle(handle = "", title = "") {
  const normalizedHandle = String(handle || "").trim().toLowerCase();
  if (!normalizedHandle) return false;
  if (normalizedHandle.length < 6 || /[_%]|-{2,}/.test(normalizedHandle)) return true;
  if (/^\d+$/.test(normalizedHandle) || /^product-\d+$/.test(normalizedHandle)) return true;
  const handleTokens = new Set(meaningfulTokens(normalizedHandle.replace(/-/g, " ")));
  const titleTokens = meaningfulTokens(title);
  if (titleTokens.length < 2 || !handleTokens.size) return false;
  const shared = titleTokens.filter((token) => handleTokens.has(token)).length;
  return shared === 0;
}

function buildContentIssue(code, label, severity, evidence, riskLift) {
  return {
    issueCode: "product_content",
    code,
    label,
    severity,
    evidence,
    riskLift,
    findingType: "issue",
  };
}

function buildContentAdvisory(code, label, evidence) {
  return {
    issueCode: "product_content",
    code,
    label,
    severity: "low",
    evidence,
    riskLift: 0,
    findingType: "advisory",
  };
}

function buildDescriptionVariantMismatchIssue(product = {}, description = "") {
  const expectedColor = getSingleExpectedProductColor(product);
  if (!expectedColor) return null;

  const conflictingColor = findColorTermInText(description, new Set([expectedColor.canonical]));
  if (!conflictingColor) return null;

  return {
    ...buildContentIssue(
      "description_variant_mismatch",
      "Description and variant color conflict",
      "high",
      `The description mentions "${conflictingColor.label}", but the only color option found in Shopify is "${expectedColor.label}".`,
      8,
    ),
    replacements: [{
      from: conflictingColor.label,
      to: expectedColor.label,
      reason: "Align product description color copy with the only available Shopify variant.",
    }],
  };
}

function getSingleExpectedProductColor(product = {}) {
  const colors = [];
  const options = Array.isArray(product.options) ? product.options : [];
  const variants = Array.isArray(product.variants) ? product.variants : [];
  const colorOptionPattern = /\b(colou?r|shade)\b/i;

  options.forEach((option) => {
    if (!colorOptionPattern.test(String(option.name || ""))) return;
    (Array.isArray(option.values) ? option.values : []).forEach((value) => {
      const color = findColorTermInText(value);
      if (color) colors.push(color);
    });
  });

  variants.forEach((variant) => {
    (Array.isArray(variant.selectedOptions) ? variant.selectedOptions : []).forEach((option) => {
      if (!colorOptionPattern.test(String(option.name || ""))) return;
      const color = findColorTermInText(option.value);
      if (color) colors.push(color);
    });
  });

  if (!colors.length && variants.length === 1) {
    const color = findColorTermInText(variants[0]?.title);
    if (color) colors.push(color);
  }

  const uniqueByCanonical = uniqueBy(colors, (color) => color.canonical);
  return uniqueByCanonical.length === 1 ? uniqueByCanonical[0] : null;
}

function findColorTermInText(value, excludedCanonicals = new Set()) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  const terms = PRODUCT_COLOR_TERMS
    .flatMap((color) => color.terms.map((term) => ({ canonical: color.canonical, label: term.label, normalized: normalizeText(term.label) })))
    .sort((first, second) => second.normalized.length - first.normalized.length);
  return terms.find((term) => (
    term.normalized
    && !excludedCanonicals.has(term.canonical)
    && containsNormalizedPhrase(normalized, term.normalized)
  )) || null;
}

function containsNormalizedPhrase(normalizedText, normalizedPhrase) {
  return new RegExp(`(^|\\s)${escapeRegExp(normalizedPhrase)}(\\s|$)`).test(normalizedText);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PRODUCT_COLOR_TERMS = [
  { canonical: "black", terms: [{ label: "Jet Black" }, { label: "Black" }] },
  { canonical: "white", terms: [{ label: "True White" }, { label: "Off White" }, { label: "White" }, { label: "Ivory" }, { label: "Cream" }] },
  { canonical: "gray", terms: [{ label: "Charcoal" }, { label: "Grey" }, { label: "Gray" }, { label: "Silver" }] },
  { canonical: "blue", terms: [{ label: "Navy" }, { label: "Blue" }] },
  { canonical: "red", terms: [{ label: "Burgundy" }, { label: "Red" }] },
  { canonical: "green", terms: [{ label: "Olive" }, { label: "Green" }] },
  { canonical: "yellow", terms: [{ label: "Yellow" }] },
  { canonical: "orange", terms: [{ label: "Orange" }] },
  { canonical: "purple", terms: [{ label: "Purple" }, { label: "Violet" }] },
  { canonical: "pink", terms: [{ label: "Pink" }] },
  { canonical: "brown", terms: [{ label: "Brown" }, { label: "Tan" }, { label: "Beige" }] },
  { canonical: "gold", terms: [{ label: "Gold" }] },
];

function buildContentAnalysis(deterministic, contentGaps) {
  const deterministicIssues = Array.isArray(deterministic.metrics.contentIssues) ? deterministic.metrics.contentIssues : [];
  const deterministicAdvisories = Array.isArray(deterministic.metrics.contentAdvisories) ? deterministic.metrics.contentAdvisories : [];
  const aiFindings = normalizeAiContentFindings(contentGaps);
  const aiIssues = aiFindings.issues;
  const aiAdvisories = aiFindings.advisories;
  const issues = uniqueBy([...deterministicIssues, ...aiIssues], (issue) => `${issue.code}-${issue.label}`);
  const descriptionDepthAdvisory = buildDescriptionDepthAdvisory(deterministic.metrics);
  const advisories = uniqueBy([
    ...deterministicAdvisories,
    ...aiAdvisories,
    ...(descriptionDepthAdvisory ? [descriptionDepthAdvisory] : []),
  ], (issue) => `${issue.code}-${issue.label}`);
  const aiRiskLift = Math.min(18, aiIssues.reduce((total, issue) => total + issue.riskLift, 0));
  const deterministicRiskLift = Number(deterministic.metrics.contentQualityRisk || 0);
  const score = calculateContentQualityScore(deterministic.metrics, contentGaps, issues);
  const scoreRiskLift = getContentQualityScoreRiskLift(score);
  const riskLift = Math.min(18, Math.max(deterministicRiskLift, aiRiskLift, scoreRiskLift));
  const additionalRiskLift = Math.min(10, Math.max(0, riskLift - deterministicRiskLift));

  return {
    score,
    summary: contentGaps?.content_summary || contentGaps?.notes || summarizeContentIssues(issues),
    present: Array.isArray(contentGaps?.present) ? contentGaps.present : [],
    missing: Array.isArray(contentGaps?.missing) ? contentGaps.missing : [],
    issueSpecificGaps: Array.isArray(contentGaps?.issue_specific_gaps) ? contentGaps.issue_specific_gaps : [],
    issues,
    advisories,
    riskLift,
    additionalRiskLift,
  };
}

function calculateContentQualityScore(metrics = {}, contentGaps = {}, issues = []) {
  const deterministicScore = clamp(Number(metrics.contentQualityScore || 100), 0, 100);
  const aiScore = Number(contentGaps?.content_quality_score);
  const normalizedAiScore = Number.isFinite(aiScore) ? clamp(Math.round(aiScore), 0, 100) : null;
  const blendedScore = normalizedAiScore == null
    ? deterministicScore
    : Math.min(
      Math.round((deterministicScore * 0.35) + (normalizedAiScore * 0.65)),
      normalizedAiScore + 8,
    );
  const descriptionCap = getDescriptionDepthContentQualityCap(metrics, issues);
  return clamp(Math.min(blendedScore, descriptionCap), 0, 100);
}

function getDescriptionDepthContentQualityCap(metrics = {}, issues = []) {
  const wordCount = Number(metrics.descriptionWordCount || 0);
  const issueCodes = new Set((Array.isArray(issues) ? issues : []).map((issue) => normalizeContentIssueCode(issue.code)));

  if (issueCodes.has("missing_description") || wordCount <= 0) return 30;
  if (wordCount < 15) return 50;
  if (wordCount < 25) return 62;
  if (wordCount < 35) return 72;
  if (wordCount < 50) return 80;
  if (wordCount < 80) return issueCodes.has("missing_specifications") || issueCodes.has("missing_customer_guidance") ? 84 : 88;
  return 100;
}

function buildDescriptionDepthAdvisory(metrics = {}) {
  const wordCount = Number(metrics.descriptionWordCount || 0);
  if (wordCount <= 0 || wordCount >= 50) return null;
  return buildContentAdvisory(
    "thin_description",
    "Description depth is limited",
    `The description has ${wordCount} words, so ProductPulse caps content quality even when the copy is coherent.`,
  );
}

function getContentQualityScoreRiskLift(score) {
  const numericScore = Number(score);
  if (!Number.isFinite(numericScore)) return 0;
  if (numericScore < 45) return 12;
  if (numericScore < 60) return 8;
  if (numericScore < 75) return 5;
  if (numericScore < 85) return 2;
  return 0;
}

function adjustRiskComponentsForContentAnalysis(riskComponents = {}, contentAnalysis = {}, metrics = {}) {
  const next = { ...riskComponents };
  const existingContentScore = Number(next.contentGapScore ?? next.contentRisk ?? 0);
  const contentGapScore = clamp(Math.max(existingContentScore, Number(contentAnalysis.riskLift || 0)), 0, 15);
  const rawScore = Number(next.rawScore ?? next.calculated ?? next.riskScore ?? 0) - existingContentScore + contentGapScore;
  const calibratedScore = calibrateProductRiskScore(rawScore, {
    metrics,
    returnsScore: Number(next.returnsScore || 0),
    reviewsScore: Number(next.reviewsScore || 0),
    refundScore: Number(next.refundScore || 0),
    sentimentScore: Number(next.sentimentScore || 0),
    contentGapScore,
    relationshipScore: Number(next.relationshipScore || 0),
    activeFamilyCount: [
      Number(next.returnsScore || 0),
      Number(next.reviewsScore || 0),
      Number(next.sentimentScore || 0),
      contentGapScore,
      Number(next.refundScore || 0),
      Number(next.variantScore || 0),
      Number(next.relationshipScore || 0),
    ].filter((score) => score >= 3).length,
  });
  const riskScore = Math.round(calibratedScore);

  return {
    ...next,
    contentGapScore: roundRate(contentGapScore, 2),
    contentRisk: roundRate(contentGapScore, 2),
    rawScore: roundRate(rawScore, 2),
    calibratedScore: roundRate(calibratedScore, 2),
    calculated: riskScore,
    riskScore,
    calculationState: next.calculationState || "calculated_from_persisted_components",
  };
}

function adjustReconstructedRiskHistoryForContentAnalysis(history = [], contentAnalysis = {}, currentRiskScore = null) {
  const points = (Array.isArray(history) ? history : []).filter(Boolean);
  if (!points.length) return [];

  return points.map((point, index) => {
    const isLast = index === points.length - 1 || point.isCurrent;
    const currentComponents = point.metrics?.riskComponents || {};
    const adjustedComponents = adjustRiskComponentsForContentAnalysis(currentComponents, contentAnalysis, point.metrics || {});
    const riskScore = isLast && Number.isFinite(Number(currentRiskScore))
      ? Math.round(Number(currentRiskScore))
      : adjustedComponents.riskScore;

    return {
      ...point,
      riskScore,
      metrics: {
        ...(point.metrics || {}),
        contentQualityScore: contentAnalysis.score ?? point.metrics?.contentQualityScore ?? null,
        contentQualityRisk: contentAnalysis.riskLift ?? point.metrics?.contentQualityRisk ?? 0,
        contentIssueCount: Array.isArray(contentAnalysis.issues) ? contentAnalysis.issues.length : point.metrics?.contentIssueCount || 0,
        contentAdvisoryCount: Array.isArray(contentAnalysis.advisories) ? contentAnalysis.advisories.length : point.metrics?.contentAdvisoryCount || 0,
        riskComponents: {
          ...adjustedComponents,
          riskScore,
          calculated: riskScore,
        },
      },
    };
  });
}

function normalizeAiContentFindings(contentGaps) {
  const findings = (Array.isArray(contentGaps?.content_issues) ? contentGaps.content_issues : [])
    .map((issue) => {
      const severity = normalizeSeverity(issue.severity);
      const code = normalizeContentIssueCode(issue.code);
      const label = issue.label || getContentIssueLabel(code);
      const evidence = issue.evidence || issue.why_it_matters || issue.suggested_action || "";
      const advisory = isAdvisoryContentIssue(code, severity, evidence);
      return {
        issueCode: "product_content",
        code,
        label: advisory ? getContentAdvisoryLabel(code, label) : label,
        severity: advisory ? "low" : severity,
        evidence,
        suggestedAction: issue.suggested_action || "Review product content",
        riskLift: advisory ? 0 : severity === "high" ? 10 : severity === "medium" ? 6 : 3,
        findingType: advisory ? "advisory" : "issue",
      };
    })
    .filter((issue) => issue.label);
  return {
    issues: findings.filter((issue) => issue.findingType !== "advisory"),
    advisories: findings.filter((issue) => issue.findingType === "advisory"),
  };
}

function isAdvisoryContentIssue(code, severity, evidence) {
  if (CONTENT_ADVISORY_CODES.has(code)) return true;
  if (code === "title_description_mismatch") {
    const normalizedEvidence = normalizeText(evidence);
    return severity !== "high" || !/(wrong product|different product|unrelated product|about another product|contradict|clearly disconnect|clearly different)/.test(normalizedEvidence);
  }
  return false;
}

function getContentAdvisoryLabel(code, fallback) {
  if (code === "missing_product_type_context") return "Product type could be clearer";
  if (code === "tag_description_mismatch") return "Tags could be reflected in description";
  if (code === "collection_mismatch") return "Collection context could be clearer";
  if (code === "title_description_mismatch") return "Title and description alignment could be reviewed";
  if (code === "thin_description") return "Description depth is limited";
  return fallback;
}

const CONTENT_ADVISORY_CODES = new Set([
  "missing_product_type_context",
  "tag_description_mismatch",
  "collection_mismatch",
  "thin_description",
]);

function summarizeContentIssues(issues) {
  if (!issues.length) return "Product content appears coherent from the stored Shopify metadata.";
  return issues.slice(0, 3).map((issue) => issue.label).join(", ");
}

function normalizeContentIssueCode(value) {
  return String(value || "product_content_issue").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function getContentIssueLabel(code) {
  const normalized = normalizeContentIssueCode(code);
  if (normalized === "missing_description") return "Missing product description";
  if (normalized === "short_description") return "Short product description";
  if (normalized === "title_description_mismatch") return "Title and description mismatch";
  if (normalized === "description_variant_mismatch") return "Description and variant mismatch";
  if (normalized === "missing_product_type_context") return "Product type could be clearer";
  if (normalized === "tag_description_mismatch") return "Tags and description mismatch";
  if (normalized === "collection_mismatch") return "Collection context mismatch";
  if (normalized === "missing_specifications") return "Missing product specifications";
  if (normalized === "contradiction") return "Contradictory product content";
  return "Product content needs review";
}

function normalizeSeverity(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("high")) return "high";
  if (normalized.includes("low")) return "low";
  return "medium";
}

function buildMainFindingDetail(aiDetail, deterministic, contentAnalysis) {
  const base = normalizeMainFindingDetail(aiDetail || buildEvidenceSummary(deterministic), deterministic);
  if (!contentAnalysis?.issues?.length) return base;
  const contentLabels = contentAnalysis.issues
    .slice(0, 3)
    .map((issue) => issue.label || getContentIssueLabel(issue.code))
    .filter(Boolean);
  const contentSentence = `Product content analysis also found: ${contentLabels.join(", ") || "product content needs review"}.`;
  return String(base || "").toLowerCase().includes("product content")
    ? base
    : appendMainFindingQuestionDetail(base, "What is wrong?", contentSentence);
}

const MAIN_FINDING_REQUIRED_QUESTIONS = [
  "What is wrong?",
  "Why do we believe that?",
  "What should we do now?",
  "How much does it matter?",
];

function normalizeMainFindingDetail(value, deterministic = {}) {
  const paragraphs = splitMainFindingParagraphs(value);
  const fallbackSummary = buildMainFindingFallbackOverview(deterministic);
  if (!paragraphs.length) return fallbackSummary
    ? [fallbackSummary, ...MAIN_FINDING_REQUIRED_QUESTIONS.map((heading) => buildFallbackMainFindingQuestionBlock(heading, deterministic, fallbackSummary))].join("\n\n")
    : "";

  const questionBlocks = extractMainFindingQuestionBlocks(paragraphs);
  const overview = getMainFindingOverviewParagraph(paragraphs, questionBlocks.firstHeadingIndex) || fallbackSummary || paragraphs[0];
  return [
    overview,
    ...MAIN_FINDING_REQUIRED_QUESTIONS.map((heading) => questionBlocks.blocks.get(heading) || buildFallbackMainFindingQuestionBlock(heading, deterministic, overview)),
  ].slice(0, 5).join("\n\n");
}

function appendMainFindingParagraph(value, paragraph) {
  const paragraphs = splitMainFindingParagraphs(value);
  const nextParagraph = String(paragraph || "").replace(/\s+/g, " ").trim();
  if (!nextParagraph) return normalizeMainFindingDetail(value);
  if (paragraphs.length >= 5) return [...paragraphs.slice(0, 4), `${paragraphs[4]} ${nextParagraph}`.trim()].join("\n\n");
  return [...paragraphs, nextParagraph].slice(0, 5).join("\n\n");
}

function splitMainFindingParagraphs(value) {
  const raw = String(value || "").replace(/\r/g, "\n").trim();
  if (!raw) return [];
  const paragraphs = raw.split(/\n{2,}/)
    .map((paragraph) => paragraph.replace(/\n+/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (paragraphs.length > 1) return paragraphs;
  return [raw.replace(/\n+/g, " ").replace(/\s+/g, " ").trim()].filter(Boolean);
}

function extractMainFindingQuestionBlocks(paragraphs = []) {
  const text = paragraphs.join("\n\n");
  const lowerText = text.toLowerCase();
  const positions = MAIN_FINDING_REQUIRED_QUESTIONS
    .map((heading) => ({
      heading,
      lowerHeading: heading.toLowerCase(),
      index: lowerText.indexOf(heading.toLowerCase()),
    }))
    .filter((item) => item.index >= 0)
    .sort((first, second) => first.index - second.index);
  const blocks = new Map();
  positions.forEach((position, index) => {
    const answerStart = position.index + position.heading.length;
    const answerEnd = positions[index + 1]?.index ?? text.length;
    const answer = text.slice(answerStart, answerEnd)
      .replace(/\n{2,}/g, " ")
      .replace(/\s+/g, " ")
      .replace(/^[:\-–—\s]+/, "")
      .trim();
    if (answer) blocks.set(position.heading, `${position.heading} ${answer}`);
  });
  return {
    blocks,
    firstHeadingIndex: positions[0]?.index ?? -1,
  };
}

function getMainFindingOverviewParagraph(paragraphs = [], firstHeadingIndex = -1) {
  const text = paragraphs.join("\n\n");
  if (firstHeadingIndex > 0) {
    const beforeHeading = text.slice(0, firstHeadingIndex).replace(/\s+/g, " ").trim();
    if (beforeHeading) return beforeHeading;
  }
  return paragraphs.find((paragraph) => !MAIN_FINDING_REQUIRED_QUESTIONS.some((heading) => paragraph.toLowerCase().startsWith(heading.toLowerCase()))) || "";
}

function buildMainFindingFallbackOverview(deterministic = {}) {
  const summary = buildEvidenceSummarySafe(deterministic);
  const issueLabel = deterministic.mainIssueLabel || getHumanIssueLabel(deterministic.mainIssue || "product_quality");
  if (summary) return `${issueLabel} signals need review because ProductPulse found ${summary}.`;
  return `${issueLabel} signals need review for this product.`;
}

function buildFallbackMainFindingQuestionBlock(heading, deterministic = {}, overview = "") {
  const metrics = deterministic.metrics || {};
  const issueLabel = deterministic.mainIssueLabel || getHumanIssueLabel(deterministic.mainIssue || "product_quality");
  const summary = buildEvidenceSummarySafe(deterministic) || overview || "stored product evidence";
  if (heading === "What is wrong?") {
    return `${heading} ${issueLabel} signals need review based on the latest ProductPulse diagnosis.`;
  }
  if (heading === "Why do we believe that?") {
    return `${heading} ProductPulse found ${summary}.`;
  }
  if (heading === "What should we do now?") {
    const contentIssues = Number(metrics.contentIssueCount || 0);
    if (contentIssues > 0) return `${heading} Review the product page copy, variants, and the recommended content actions before applying changes.`;
    if (Number(metrics.returnUnits || 0) > 0 || Number(metrics.refundUnits || 0) > 0) return `${heading} Review the post-purchase evidence and use the recommended actions to reduce avoidable returns or refunds.`;
    return `${heading} Review the evidence and use the recommended actions before changing the product page or operations.`;
  }
  return `${heading} ${buildMainFindingImpactSentence(deterministic)}`;
}

function buildMainFindingImpactSentence(deterministic = {}) {
  const metrics = deterministic.metrics || {};
  const pieces = [];
  if (Number.isFinite(Number(deterministic.riskScore))) pieces.push(`risk score ${Math.round(Number(deterministic.riskScore))}/100`);
  if (Number.isFinite(Number(deterministic.confidence))) pieces.push(`${Math.round(Number(deterministic.confidence))}% confidence`);
  const impact = getMainFindingEstimatedImpact(deterministic);
  if (impact > 0) pieces.push(`${formatMoney(impact)} estimated impact`);
  const sourceCount = Array.isArray(deterministic.sourceCoverage)
    ? deterministic.sourceCoverage.length
    : Number(metrics.sourceCount || 0);
  if (sourceCount > 0) pieces.push(`${sourceCount} source${sourceCount === 1 ? "" : "s"}`);
  if (!pieces.length) return "The issue matters enough to monitor because ProductPulse found product-specific evidence that should be reviewed.";
  return `It matters because the diagnosis currently shows ${pieces.join(", ")}.`;
}

function getMainFindingEstimatedImpact(deterministic = {}) {
  const candidates = [
    deterministic.estimatedImpact?.estimatedImpact,
    deterministic.estimatedImpact?.impactMid,
    deterministic.estimatedImpact,
    deterministic.metrics?.estimatedImpact,
    deterministic.metrics?.impactScore,
    deterministic.metrics?.revenueAtRisk,
  ];
  return candidates.map((value) => Number(value)).find((value) => Number.isFinite(value) && value > 0) || 0;
}

function buildEvidenceSummarySafe(deterministic = {}) {
  if (!deterministic?.metrics) return "";
  return buildEvidenceSummary(deterministic);
}

function appendMainFindingQuestionDetail(value, heading, detail) {
  const paragraphs = splitMainFindingParagraphs(value);
  const nextDetail = String(detail || "").replace(/\s+/g, " ").trim();
  if (!paragraphs.length || !nextDetail) return value;
  const normalizedHeading = String(heading || "").toLowerCase();
  const nextParagraphs = paragraphs.map((paragraph) => (
    paragraph.toLowerCase().startsWith(normalizedHeading)
      ? `${paragraph} ${nextDetail}`.trim()
      : paragraph
  ));
  return nextParagraphs.slice(0, 5).join("\n\n");
}

function adjustMainFindingForSignalStrength(mainFinding, deterministic) {
  const relevance = buildSignalRelevanceGuidance(deterministic);
  const hasContentIssues = Number(deterministic.metrics.contentIssueCount || 0) > 0;
  if (relevance.customerEvidence?.level === "isolated" && !hasContentIssues) {
    return {
      title: "Customer signal needs monitoring",
      detail: normalizeMainFindingDetail(relevance.customerEvidence.guidance, deterministic),
      summary: relevance.customerEvidence.summary,
    };
  }

  if (relevance.reviewSignals.level === "normal") return mainFinding;

  if (hasContentIssues) {
    return {
      ...mainFinding,
      detail: appendMainFindingParagraph(mainFinding.detail, relevance.reviewSignals.guidance),
      summary: `${mainFinding.summary} ${relevance.reviewSignals.guidance}`,
    };
  }

  return {
    title: relevance.reviewSignals.level === "emerging"
      ? "Review signal is emerging, not confirmed"
      : "Review signal is still early",
    detail: normalizeMainFindingDetail(relevance.reviewSignals.guidance, deterministic),
    summary: relevance.reviewSignals.summary,
  };
}

function buildSignalRelevanceGuidance(deterministic) {
  const metrics = deterministic.metrics || {};
  const negativeReviews = Number(metrics.negativeReviewCount || 0);
  const reviewCount = Number(metrics.reviewCount || 0);
  const returnUnits = Number(metrics.returnUnits || 0);
  const refundUnits = Number(metrics.refundUnits || 0);
  const contentIssues = Number(metrics.contentIssueCount || 0);
  const customerEvidence = buildCustomerEvidenceRelevanceGuidance({ negativeReviews, returnUnits, refundUnits, contentIssues });
  const reviewOnly = negativeReviews > 0 && returnUnits === 0 && refundUnits === 0 && contentIssues === 0;

  if (!reviewOnly) {
    return {
      customerEvidence,
      reviewSignals: {
        level: "normal",
        summary: negativeReviews ? `${negativeReviews} negative connected reviews are available with other supporting signals.` : "No negative review pressure is leading the finding.",
        guidance: "Use reviews alongside stronger return, refund, content, or multi-source evidence.",
      },
    };
  }

  if (negativeReviews <= 2) {
    return {
      customerEvidence,
      reviewSignals: {
        level: "weak",
        summary: `${negativeReviews} negative connected review${negativeReviews === 1 ? "" : "s"} out of ${reviewCount} total reviews is an early signal only.`,
        guidance: `${negativeReviews} negative connected review${negativeReviews === 1 ? "" : "s"} is below the ProductPulse action threshold. Treat it as low-confidence monitoring evidence and do not lead the main finding with review wording.`,
      },
    };
  }

  if (negativeReviews <= 4) {
    return {
      customerEvidence,
      reviewSignals: {
        level: "emerging",
        summary: `${negativeReviews} negative connected reviews out of ${reviewCount} total reviews is an emerging signal.`,
        guidance: `${negativeReviews} negative connected reviews can support a low-to-medium finding, but confidence should start near 50 and increase only if returns, refunds, repeated language, or more reviews agree.`,
      },
    };
  }

  return {
    customerEvidence,
    reviewSignals: {
      level: "normal",
      summary: `${negativeReviews} negative connected reviews out of ${reviewCount} total reviews is enough review volume to support the finding.`,
      guidance: "Reviews have enough volume to inform the main finding when they are consistent.",
    },
  };
}

function buildCustomerEvidenceRelevanceGuidance({ negativeReviews, returnUnits, refundUnits, contentIssues }) {
  const customerSignalCount = Number(negativeReviews || 0) + Number(returnUnits || 0) + Number(refundUnits || 0);
  if (Number(contentIssues || 0) > 0) {
    return {
      level: "supported",
      summary: "Product content findings are deterministic and can be discussed independently from customer-signal volume.",
      guidance: "Use content issues when they are present, even if customer text volume is low.",
    };
  }
  if (customerSignalCount <= 1) {
    return {
      level: "isolated",
      summary: `${customerSignalCount} customer signal is isolated and should not become a confirmed issue by itself.`,
      guidance: "Keep isolated customer language in evidence, but do not turn one customer opinion into multiple issues, a strong recommendation, or a high-risk finding.",
    };
  }
  if (customerSignalCount < 4) {
    return {
      level: "emerging",
      summary: `${customerSignalCount} customer signals can support a low-confidence finding when they point to the same issue.`,
      guidance: "Treat two or three aligned customer signals as emerging evidence; severity should stay low or medium unless hard metrics agree.",
    };
  }
  return {
    level: "supported",
    summary: `${customerSignalCount} customer signals provide enough sample support for merchant-facing analysis.`,
    guidance: "Repeated customer evidence can support issues and recommendations when it is grouped by the same underlying problem.",
  };
}

function hasMeaningfulTokenOverlap(first, second) {
  const firstTokens = meaningfulTokens(first);
  const secondTokens = new Set(meaningfulTokens(second));
  return firstTokens.some((token) => secondTokens.has(token));
}

function isClearlyDisconnectedTitleDescription(product, description) {
  const title = String(product.title || "");
  const titleTokens = meaningfulTokens(title);
  const descriptionTokens = meaningfulTokens(description);
  if (titleTokens.length < 2 || descriptionTokens.length < 12) return false;
  if (hasStrongTextOverlap(title, description)) return false;
  if (hasProductIdentityOverlap(product, description)) return false;

  const titleCategories = detectProductCategoryGroups([
    title,
    product.productType,
    ...(Array.isArray(product.tags) ? product.tags : []),
    ...(Array.isArray(product.collections) ? product.collections : []),
  ].join(" "));
  const descriptionCategories = detectProductCategoryGroups(description);

  if (!titleCategories.size || !descriptionCategories.size) return false;
  return [...titleCategories].every((category) => !descriptionCategories.has(category));
}

function hasProductIdentityOverlap(product, description) {
  const identityParts = [
    product.title,
    product.vendor,
    product.productType,
    ...(Array.isArray(product.tags) ? product.tags : []),
    ...(Array.isArray(product.collections) ? product.collections : []),
  ].filter(Boolean);
  const descriptionTokens = new Set(meaningfulTokens(description));
  return identityParts.some((part) => meaningfulTokens(part).some((token) => descriptionTokens.has(token)));
}

function detectProductCategoryGroups(value) {
  const normalized = normalizeText(value);
  const groups = new Set();
  PRODUCT_CATEGORY_GROUPS.forEach(({ group, pattern }) => {
    if (pattern.test(normalized)) groups.add(group);
  });
  return groups;
}

const PRODUCT_CATEGORY_GROUPS = [
  { group: "apparel", pattern: /\b(shirt|tee|tshirt|t-shirt|trouser|pants|jeans|dress|skirt|jacket|hoodie|sweater|shorts|leggings|shoe|shoes|sneaker|boot|coat|top|blouse|linen|cotton|fit|waist|inseam|sleeve)\b/ },
  { group: "toy", pattern: /\b(toy|doll|figure|playset|lego|blocks|puzzle|game|kids|children|hatchimals|barbie|pony|playmobil|transformers)\b/ },
  { group: "art", pattern: /\b(art|print|poster|painting|canvas|rembrandt|wall decor|frame|framed|illustration|portrait)\b/ },
  { group: "electronics", pattern: /\b(phone|charger|cable|adapter|battery|speaker|headphone|earbuds|camera|laptop|tablet|device|electronic)\b/ },
  { group: "beauty", pattern: /\b(cream|serum|lotion|makeup|cosmetic|shampoo|conditioner|skincare|fragrance|perfume)\b/ },
  { group: "home", pattern: /\b(furniture|chair|table|lamp|rug|bedding|sheet|pillow|kitchen|mug|bottle|decor|home)\b/ },
  { group: "food", pattern: /\b(food|snack|coffee|tea|chocolate|candy|drink|beverage|sauce|spice)\b/ },
];

function hasStrongTextOverlap(first, second) {
  const firstTokens = meaningfulTokens(first);
  const secondTokens = meaningfulTokens(second);
  if (!firstTokens.length || !secondTokens.length) return false;
  const secondSet = new Set(secondTokens);
  const sharedCount = firstTokens.filter((token) => secondSet.has(token)).length;
  const smallerSize = Math.min(firstTokens.length, secondTokens.length);
  if (sharedCount >= Math.min(3, smallerSize)) return true;
  return sharedCount >= 2 && sharedCount / smallerSize >= 0.55;
}

function meaningfulTokens(value) {
  const stopWords = new Set(["and", "the", "for", "with", "from", "this", "that", "product", "products", "shopify", "new"]);
  return normalizeText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 3 && !stopWords.has(token));
}

function calculateRiskScore({ snapshot, metrics }) {
  return calculateRiskScoreBreakdown({ snapshot, metrics }).riskScore;
}

function calculateRiskScoreBreakdown({ snapshot, metrics }) {
  if (!metrics.signalCount && !metrics.contentIssueCount && Number(snapshot.riskScore || 0) > 0) {
    return {
      base: 0,
      returnsScore: 0,
      reviewsScore: 0,
      sentimentScore: 0,
      contentGapScore: 0,
      refundScore: 0,
      variantScore: 0,
      agreementBonus: 0,
      recencyBonus: 0,
      rawScore: Number(snapshot.riskScore),
      calculated: Number(snapshot.riskScore),
      riskScore: Number(snapshot.riskScore),
      recovery: "snapshot-fallback",
      calculationState: "score_breakdown_reconstructed",
    };
  }

  const scoreSentiment = getScoreSentimentInputs(metrics.textInsights, metrics.refundInsights);
  return calculateProductScoreModel({
    ...metrics,
    storeReturnBaseline: snapshot.metrics?.storeAvgReturnRate,
    storeRefundBaseline: snapshot.metrics?.storeAvgRefundRate,
    storeNegativeReviewBaseline: snapshot.metrics?.storeAvgNegativeReviewRate,
    sentimentTotal: scoreSentiment.total,
    sentimentNegativeCount: scoreSentiment.negative,
    subjectiveNegativeCount: metrics.textInsights?.subjectiveNegativity?.count || 0,
    subjectiveNegativeRatio: metrics.textInsights?.subjectiveNegativity?.ratio || 0,
    affectedVariantCount: metrics.affectedVariants?.length || 0,
    sourceAgreement: hasSourceAgreement({
      returnUnits: metrics.returnUnits,
      refundUnits: metrics.refundUnits,
      negativeReviewCount: metrics.negativeReviewCount,
      reviewSourceStats: metrics.reviewSourceStats,
    }),
    recentSignalUnits: countRecentSignalEvents(metrics.signalEvents, 30),
    effectiveSampleSize: Number(metrics.returnUnits || 0) + Number(metrics.refundUnits || 0) + Number(metrics.reviewCount || 0) + Number(metrics.contentIssueCount || 0),
    calculationState: "calculated_from_persisted_components",
  }, { sentimentSharesReviewSource: !(metrics.returnUnits || metrics.refundUnits) }).riskComponents;
}

function calculateConfidence({
  signalCount,
  sourceCoverage,
  judgeMeMatchConfidence,
  yotpoReviewMatchConfidence,
  looxReviewMatchConfidence,
  csvReviewMatchConfidence,
  orderAccessDenied,
  sourceAgreement,
  recentSignals,
  mainIssue = "",
  textInsights = null,
  returnUnits = 0,
  refundUnits = 0,
  negativeReviewCount = 0,
  contentIssueCount = 0,
}) {
  const sample = Math.min(26, Math.log2(signalCount + 1) * 8);
  const coverage = Math.min(28, sourceCoverage.length * 7);
  const match = Math.round(Math.max(judgeMeMatchConfidence || 0, yotpoReviewMatchConfidence || 0, looxReviewMatchConfidence || 0, csvReviewMatchConfidence || 0) * 16);
  const agreement = sourceAgreement ? 18 : 5;
  const recency = recentSignals ? 10 : 0;
  const penalty = orderAccessDenied ? 16 : 0;
  const baseConfidence = clamp(Math.round(18 + sample + coverage + match + agreement + recency - penalty), 0, 99);
  const sparseAdjustedConfidence = adjustSparseCustomerSignalConfidence(baseConfidence, {
    signalCount,
    sourceAgreement,
    returnUnits,
    refundUnits,
    negativeReviewCount,
    contentIssueCount,
  });
  const reviewAdjustedConfidence = adjustWeakReviewConfidence(sparseAdjustedConfidence, { returnUnits, refundUnits, negativeReviewCount });
  return adjustSubjectiveConfidence(reviewAdjustedConfidence, mainIssue, textInsights);
}

function adjustSparseCustomerSignalConfidence(confidence, { signalCount, sourceAgreement, returnUnits, refundUnits, negativeReviewCount, contentIssueCount }) {
  if (sourceAgreement || Number(contentIssueCount || 0) > 0) return confidence;
  const customerSignals = Number(returnUnits || 0) + Number(refundUnits || 0) + Number(negativeReviewCount || 0);
  const knownSignals = Math.max(Number(signalCount || 0), customerSignals);
  if (knownSignals <= 1) return Math.min(confidence, 45);
  if (knownSignals < MIN_CUSTOMER_SIGNALS_FOR_MERCHANT_ISSUE) return Math.min(confidence, 49);
  return confidence;
}

function adjustWeakReviewConfidence(confidence, { returnUnits, refundUnits, negativeReviewCount }) {
  const reviewOnly = Number(negativeReviewCount || 0) > 0 && Number(returnUnits || 0) === 0 && Number(refundUnits || 0) === 0;
  if (!reviewOnly) return confidence;
  if (negativeReviewCount <= 2) return Math.min(confidence, 49);
  if (negativeReviewCount <= 4) return Math.min(Math.max(confidence, 52), 64);
  return confidence;
}

function adjustSubjectiveConfidence(confidence, mainIssue, textInsights) {
  if (mainIssue !== "subjective_negative_reaction") return confidence;
  const summary = textInsights?.subjectiveNegativity || {};
  const count = Number(summary.count || 0);
  const ratio = Number(summary.ratio || 0);
  if (count <= 1) return Math.min(confidence, 45);
  if (!hasActionableSubjectiveEvidence(summary)) return Math.min(confidence, 62);
  if (count < 5 && ratio < 0.5) return Math.min(confidence, 76);
  return confidence;
}

function buildEvidenceSnippets({ returns, refunds, reviews, product }) {
  const snippets = [];
  returns.slice(0, 30).forEach((item) => {
    const text = getReturnCustomerLanguageText(item);
    if (!text) return;
    snippets.push({
      source: "shopify_return_note",
      text: text.slice(0, 700),
      createdAt: item.createdAt,
      variant: item.variantTitle || item.sku || "",
      quantity: item.quantity,
    });
  });
  refunds.slice(0, 20).forEach((item) => {
    const operationalText = getRefundOperationalText(item);
    snippets.push({
      source: operationalText ? "shopify_refund_note" : "shopify_refund",
      text: operationalText
        ? `${item.quantity} unit refund: ${operationalText}`
        : `${item.quantity} unit refund${item.restockType ? `, restock ${item.restockType}` : ""}`,
      createdAt: item.createdAt,
      variant: item.variantTitle || item.sku || "",
      amount: item.amount,
    });
  });
  reviews.slice(0, 40).forEach((review) => {
    snippets.push({
      source: review.sourceType || "judgeme_review",
      text: [review.title, review.body].filter(Boolean).join(" - ").slice(0, 900),
      createdAt: review.createdAt,
      rating: review.rating,
      reviewSource: review.sourceLabel || "Judge.me reviews",
      product: product.title,
    });
  });
  return snippets.slice(0, 60);
}

function buildSourceCoverage({ shopifyData, judgeMeData, yotpoData, looxData, csvReviewData, soldUnits, returnUnits, refundUnits, reviewCount }) {
  const sources = ["Shopify product"];
  if (soldUnits > 0 || !shopifyData.orderAccessDenied) sources.push("Shopify orders");
  if (returnUnits > 0) sources.push("Shopify returns");
  if (refundUnits > 0) sources.push("Shopify refunds");
  if (judgeMeData?.connected && judgeMeData.reviews?.length) sources.push("Judge.me reviews");
  if (yotpoData?.connected && yotpoData.reviews?.length) sources.push("Yotpo reviews");
  if (looxData?.connected && looxData.reviews?.length) sources.push("Loox reviews");
  if (csvReviewData?.connected && csvReviewData.reviews?.length) sources.push("CSV reviews");
  if (
    reviewCount > 0
    && !sources.includes("Judge.me reviews")
    && !sources.includes("Yotpo reviews")
    && !sources.includes("Loox reviews")
    && !sources.includes("CSV reviews")
  ) sources.push("Reviews");
  return sources;
}

function buildEvidenceSummary(deterministic) {
  const metrics = deterministic.metrics;
  const relevance = buildSignalRelevanceGuidance(deterministic);
  const contentIssues = Array.isArray(metrics.contentIssues) ? metrics.contentIssues : [];
  const contentAnalysisIssues = Array.isArray(metrics.contentAnalysis?.issues) ? metrics.contentAnalysis.issues : [];
  const productContentIssues = contentIssues.length ? contentIssues : contentAnalysisIssues;
  const affectedVariants = Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants : [];
  const pieces = [];
  if (metrics.returnUnits > 0) pieces.push(`${metrics.returnUnits} return units (${metrics.returnRate}% return rate)`);
  if (metrics.refundUnits > 0 || metrics.refundAmount > 0) pieces.push(`${metrics.refundUnits} refunds worth ${formatMoney(metrics.refundAmount)}`);
  if (metrics.reviewCount > 0 && metrics.negativeReviewCount > 0) {
    pieces.push(relevance.reviewSignals.level === "normal"
      ? `${metrics.negativeReviewCount} negative connected reviews out of ${metrics.reviewCount}`
      : relevance.reviewSignals.summary);
  }
  if (productContentIssues.length > 0) {
    pieces.push(`product content issues: ${productContentIssues.slice(0, 3).map((issue) => issue.label || getContentIssueLabel(issue.code)).filter(Boolean).join(", ")}`);
  } else if (Number(metrics.contentIssueCount || 0) > 0) {
    pieces.push(`${metrics.contentIssueCount} product content issue${Number(metrics.contentIssueCount) === 1 ? "" : "s"}`);
  }
  const retentionSummary = buildRetentionEvidenceSummary(metrics.productRetention);
  if (retentionSummary) pieces.push(retentionSummary);
  if (affectedVariants.length) pieces.push(`affected variants: ${affectedVariants.join(", ")}`);
  if (!pieces.length) return "The diagnosis has product metadata but no strong product-specific customer signal yet.";
  return pieces.join("; ");
}

function buildRetentionEvidenceSummary(retention = null) {
  const aiRetention = buildAiProductRetentionInput(retention);
  if (!aiRetention?.shouldMention) return "";
  const pieces = [];
  if (aiRetention.retentionHealthScore != null) pieces.push(`retention health ${Math.round(aiRetention.retentionHealthScore)}/100`);
  if (aiRetention.repeatPurchaseRate90d != null) pieces.push(`${Math.round(aiRetention.repeatPurchaseRate90d * 1000) / 10}% 90-day repeat`);
  if (aiRetention.productLtv90Cents != null && aiRetention.productLtv90Cents > 0) pieces.push(`${formatMoney(aiRetention.productLtv90Cents / 100)} 90-day LTV`);
  return pieces.length ? `retention context: ${pieces.join(", ")}` : "";
}

function buildFallbackClusters(deterministic, mainIssue) {
  return Object.entries(deterministic.issueSignalCounts).map(([issue, signals]) => ({
    issue_category: issue,
    human_name: getHumanIssueLabel(issue),
    summary: `${signals} deterministic signal${signals === 1 ? "" : "s"} detected.`,
    signals,
    severity: getSeverityLabel(deterministic.riskScore).toLowerCase(),
  })).concat([{
    issue_category: mainIssue,
    human_name: getHumanIssueLabel(mainIssue),
    summary: buildEvidenceSummary(deterministic),
    signals: Math.max(1, deterministic.metrics.signalCount),
    severity: getSeverityLabel(deterministic.riskScore).toLowerCase(),
  }]).filter((item, index, list) => list.findIndex((candidate) => candidate.issue_category === item.issue_category) === index);
}

function hasSourceAgreement({ returnUnits, refundUnits, negativeReviewCount, reviewSourceStats = null }) {
  const hasReturnSignal = Number(returnUnits || 0) >= 0.75;
  const hasRefundSignal = Number(refundUnits || 0) >= 0.75;
  const hasReviewSignal = Number(negativeReviewCount || 0) >= 0.75;
  const reviewSourceSignals = hasReviewSignal && reviewSourceStats
    ? [reviewSourceStats.judgeMe?.negativeReviewCount > 0, reviewSourceStats.yotpo?.negativeReviewCount > 0, reviewSourceStats.loox?.negativeReviewCount > 0, reviewSourceStats.csv?.negativeReviewCount > 0].filter(Boolean).length
    : (hasReviewSignal ? 1 : 0);
  const reviewSignalWeight = reviewSourceSignals >= 2 ? 2 : hasReviewSignal ? 1 : 0;
  const sourceSignalWeight = [hasReturnSignal, hasRefundSignal].filter(Boolean).length + reviewSignalWeight;
  return sourceSignalWeight >= 2;
}

function countRecentSignalEvents(events, days) {
  return events.filter((event) => isRecentDate(event.createdAt, days)).reduce((total, event) => total + Number(event.value || 1), 0);
}

function isRecentDate(value, days) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

function getLatestEventDate(events) {
  const latest = events
    .map((event) => new Date(event.createdAt).getTime())
    .filter((time) => !Number.isNaN(time))
    .sort((first, second) => second - first)[0];
  return latest ? new Date(latest).toISOString() : null;
}

function countTopValues(values, limit) {
  const counts = new Map();
  values.map((value) => String(value || "").trim()).filter(Boolean).forEach((value) => {
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return [...counts.entries()]
    .sort((first, second) => second[1] - first[1])
    .slice(0, limit)
    .map(([label, count]) => ({ label, count }));
}

function buildTopReturnReasonDetails(returns = [], limit = 4) {
  const groups = new Map();

  (Array.isArray(returns) ? returns : []).forEach((item) => {
    const category = normalizeReturnReasonLabel(item.reasonLabel || item.reason || "Return");
    if (!category) return;

    const key = normalizeReturnReasonKey(category);
    const quantity = Math.max(1, Number(item.quantity || item.processedQuantity || item.refundedQuantity || 1));
    const note = getReturnReasonNoteSummary(item);
    const group = groups.get(key) || {
      key,
      label: category,
      count: 0,
      subReasonMap: new Map(),
    };

    group.count += quantity;

    if (note && !isDefaultCustomerLanguageTerm(note)) {
      const noteKey = normalizeReturnReasonKey(note);
      const subReason = group.subReasonMap.get(noteKey) || {
        key: noteKey,
        label: note,
        count: 0,
      };
      subReason.count += quantity;
      group.subReasonMap.set(noteKey, subReason);
    }

    groups.set(key, group);
  });

  return [...groups.values()]
    .map((group) => {
      const subReasons = [...group.subReasonMap.values()]
        .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label));
      const dominantSubReason = subReasons[0] || null;
      const isOther = group.key === "other";
      const label = isOther && dominantSubReason
        ? `Other: ${dominantSubReason.label}`
        : group.label;

      return {
        key: group.key,
        label,
        category: group.label,
        count: group.count,
        detail: dominantSubReason
          ? `${group.label} · ${dominantSubReason.count} unit${dominantSubReason.count === 1 ? "" : "s"}`
          : `${group.count} unit${group.count === 1 ? "" : "s"}`,
        subReasons: subReasons.slice(0, 4),
      };
    })
    .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label))
    .slice(0, limit);
}

function getReturnReasonNoteSummary(item = {}) {
  const notes = [item.reasonNote, item.customerNote]
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const first = notes[0] || "";
  return first
    .replace(/^other\s*(reason)?\s*[:/-]\s*/i, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim();
}

function normalizeReturnReasonKey(value) {
  const normalized = normalizeText(value)
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "";
  if (isGenericOtherReason(normalized) || ["other reason", "other reasons"].includes(normalized)) return "other";
  if (["not as described", "not described"].includes(normalized)) return "not_as_described";
  if (["quality issue", "quality"].includes(normalized)) return "quality_issue";
  if (["wrong item", "wrong product"].includes(normalized)) return "wrong_item";
  if (["color", "colour"].includes(normalized)) return "color";
  return normalized;
}

function normalizeReturnReasonLabel(value) {
  const normalized = String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) return "";
  const key = normalizeReturnReasonKey(normalized);
  if (key === "other") return "Other";
  if (key === "not_as_described") return "Not as described";
  if (key === "quality_issue") return "Quality issue";
  if (key === "wrong_item") return "Wrong item";
  if (key === "color") return "Color";
  return normalized.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildOrderGeographyRows(sales = []) {
  const orders = new Map();

  (Array.isArray(sales) ? sales : []).forEach((event, index) => {
    const orderKey = event.orderId || event.id || `sale:${index}`;
    const geography = normalizeSalesEventGeography(event);
    const current = orders.get(orderKey) || { geography: null, units: 0, amount: 0 };
    current.units += Number(event.quantity || 0);
    current.amount += Number(event.amount || 0);
    if (!current.geography || isMoreSpecificGeography(geography, current.geography)) {
      current.geography = geography;
    }
    orders.set(orderKey, current);
  });

  const totalOrders = orders.size;
  if (!totalOrders) return [];

  const groups = new Map();
  orders.forEach((order) => {
    const region = getOrderGeographyRegion(order.geography);
    const current = groups.get(region.key) || {
      key: region.key,
      label: region.label,
      country: region.country,
      countryCode: region.countryCode,
      province: region.province,
      provinceCode: region.provinceCode,
      cityCounts: new Map(),
      orders: 0,
      units: 0,
      amount: 0,
    };
    current.orders += 1;
    current.units += Number(order.units || 0);
    current.amount += Number(order.amount || 0);
    if (order.geography?.city) {
      current.cityCounts.set(order.geography.city, (current.cityCounts.get(order.geography.city) || 0) + 1);
    }
    groups.set(region.key, current);
  });

  return [...groups.values()]
    .map((group) => {
      const share = roundRate((group.orders / totalOrders) * 100, 1);
      const topCities = [...group.cityCounts.entries()]
        .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
        .slice(0, 2)
        .map(([city, count]) => `${city}${count > 1 ? ` (${count})` : ""}`);
      return {
        key: group.key,
        label: group.label,
        count: group.orders,
        orders: group.orders,
        units: group.units,
        amount: roundCurrency(group.amount),
        share,
        percent: share,
        detail: [
          `${group.orders} order${group.orders === 1 ? "" : "s"}`,
          `${share}%`,
          topCities.length ? topCities.join(", ") : "",
        ].filter(Boolean).join(" · "),
        country: group.country,
        countryCode: group.countryCode,
        province: group.province,
        provinceCode: group.provinceCode,
      };
    })
    .sort((first, second) => second.count - first.count || first.label.localeCompare(second.label))
    .slice(0, 12);
}

function normalizeSalesEventGeography(event = {}) {
  return normalizeOrderAddressGeography(event.geography)
    || normalizeOrderAddressGeography(event)
    || null;
}

function isMoreSpecificGeography(candidate = null, current = null) {
  if (!candidate) return false;
  if (!current) return true;
  const score = (item) => ["countryCode", "country", "provinceCode", "province", "city"]
    .reduce((total, key) => total + (item?.[key] ? 1 : 0), 0);
  return score(candidate) > score(current);
}

function getOrderGeographyRegion(geography = null) {
  if (!geography) {
    return {
      key: "unknown",
      label: "Unknown location",
      country: "",
      countryCode: "",
      province: "",
      provinceCode: "",
    };
  }
  const countryCode = normalizeGeographyCode(geography.countryCode);
  const provinceCode = normalizeGeographyCode(geography.provinceCode);
  const country = geography.country || getCountryLabel(countryCode);
  const isUnitedStates = countryCode === "US" || normalizeText(country) === "united states" || normalizeText(country) === "united states of america";
  if (isUnitedStates && (provinceCode || geography.province)) {
    const stateLabel = US_STATE_NAMES[provinceCode] || geography.province || provinceCode;
    return {
      key: `US-${provinceCode || normalizeText(stateLabel)}`,
      label: `${stateLabel}, United States`,
      country: "United States",
      countryCode: "US",
      province: stateLabel,
      provinceCode,
    };
  }
  const countryLabel = country || countryCode || "Unknown location";
  return {
    key: `COUNTRY-${countryCode || normalizeText(countryLabel)}`,
    label: countryLabel,
    country: countryLabel === "Unknown location" ? "" : countryLabel,
    countryCode,
    province: "",
    provinceCode: "",
  };
}

function getCountryLabel(countryCode = "") {
  if (countryCode === "US") return "United States";
  if (countryCode && Intl?.DisplayNames) {
    try {
      return new Intl.DisplayNames(["en"], { type: "region" }).of(countryCode) || countryCode;
    } catch {
      return countryCode;
    }
  }
  return countryCode || "";
}

function buildMonthlyOrderActivity({
  sales = [],
  returns = [],
  refunds = [],
  windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS,
  now = new Date(),
} = {}) {
  const currentDate = parseValidDate(now) || new Date();
  const safeWindowDays = Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS));
  const sinceDate = new Date(currentDate.getTime() - safeWindowDays * 24 * 60 * 60 * 1000);
  const monthStarts = getMonthStartsBetween(startOfUtcMonth(sinceDate), startOfUtcMonth(currentDate))
    .slice(-MONTHLY_ORDER_ACTIVITY_MAX_MONTHS);
  const buckets = new Map(monthStarts.map((date) => [formatUtcMonthKey(date), createMonthlyOrderActivityBucket(date)]));
  const weekStarts = getWeekStartsBetween(startOfUtcWeek(sinceDate), startOfUtcWeek(currentDate))
    .slice(-RETURN_RATE_PREDICTION_MAX_WEEKS);
  const weekBuckets = new Map(weekStarts.map((date) => [formatUtcDateKey(date), createWeeklyOrderActivityBucket(date)]));
  const orderMonthById = new Map();
  const orderWeekById = new Map();

  sales.forEach((event, index) => {
    const cohortDate = getOrderCohortDate(event, { includeEventDate: true });
    const monthKey = getEventMonthKey(cohortDate);
    const weekKey = getEventWeekKey(cohortDate);
    const orderKey = event.orderId || event.id || `sale:${index}:${monthKey || weekKey}`;
    if (buckets.has(monthKey)) {
      if (event.orderId) orderMonthById.set(event.orderId, monthKey);
      addSaleToOrderActivityBucket(buckets.get(monthKey), orderKey, event);
    }
    if (weekBuckets.has(weekKey)) {
      if (event.orderId) orderWeekById.set(event.orderId, weekKey);
      addSaleToOrderActivityBucket(weekBuckets.get(weekKey), orderKey, event);
    }
  });

  returns.forEach((event, index) => {
    const monthKey = getOperationalEventMonthKey(event, orderMonthById);
    const weekKey = getOperationalEventWeekKey(event, orderWeekById);
    const orderKey = event.orderId || event.id || `return:${index}:${monthKey || weekKey}`;
    if (buckets.has(monthKey)) addReturnToOrderActivityBucket(buckets.get(monthKey), orderKey, event);
    if (weekBuckets.has(weekKey)) addReturnToOrderActivityBucket(weekBuckets.get(weekKey), orderKey, event);
  });

  refunds.forEach((event, index) => {
    const monthKey = getOperationalEventMonthKey(event, orderMonthById);
    const weekKey = getOperationalEventWeekKey(event, orderWeekById);
    const orderKey = event.orderId || event.id || `refund:${index}:${monthKey || weekKey}`;
    if (buckets.has(monthKey)) addRefundToOrderActivityBucket(buckets.get(monthKey), orderKey, event);
    if (weekBuckets.has(weekKey)) addRefundToOrderActivityBucket(weekBuckets.get(weekKey), orderKey, event);
  });

  const months = [...buckets.values()].map(normalizeMonthlyOrderActivityBucket);
  const weeks = [...weekBuckets.values()].map(normalizeMonthlyOrderActivityBucket);
  const summary = months.reduce((totals, month) => ({
    totalOrders: totals.totalOrders + month.orders,
    totalOrderUnits: totals.totalOrderUnits + month.orderUnits,
    totalRevenue: totals.totalRevenue + month.revenue,
    totalReturnedOrders: totals.totalReturnedOrders + month.returnedOrders,
    totalReturnedUnits: totals.totalReturnedUnits + month.returnedUnits,
    totalRefundedOrders: totals.totalRefundedOrders + month.refundedOrders,
    totalRefundedUnits: totals.totalRefundedUnits + month.refundedUnits,
    totalRefundAmount: totals.totalRefundAmount + month.refundAmount,
    maxOrders: Math.max(totals.maxOrders, month.orders, month.returnedOrders, month.refundedOrders),
  }), {
    totalOrders: 0,
    totalOrderUnits: 0,
    totalRevenue: 0,
    totalReturnedOrders: 0,
    totalReturnedUnits: 0,
    totalRefundedOrders: 0,
    totalRefundedUnits: 0,
    totalRefundAmount: 0,
    maxOrders: 0,
  });

  return {
    source: "shopify_orders_deep_diagnosis",
    windowDays: safeWindowDays,
    generatedAt: toIso(currentDate),
    months,
    weeks,
    summary: {
      ...summary,
      totalRevenue: roundCurrency(summary.totalRevenue),
      totalRefundAmount: roundCurrency(summary.totalRefundAmount),
      returnRate: calculateUnitRatePercent(
        summary.totalReturnedUnits,
        summary.totalOrderUnits,
        summary.totalOrders ? (summary.totalReturnedOrders / summary.totalOrders) * 100 : 0,
      ),
      refundRate: calculateUnitRatePercent(
        summary.totalRefundedUnits,
        summary.totalOrderUnits,
        summary.totalOrders ? (summary.totalRefundedOrders / summary.totalOrders) * 100 : 0,
      ),
      maxOrders: Math.max(summary.maxOrders, 1),
    },
  };
}

function buildReturnRatePrediction({
  sales = [],
  returns = [],
  refunds = [],
  windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS,
  now = new Date(),
} = {}) {
  const currentDate = parseValidDate(now) || new Date();
  const safeWindowDays = Math.max(1, Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS));
  const sinceDate = new Date(currentDate.getTime() - safeWindowDays * 24 * 60 * 60 * 1000);
  const weekStarts = getWeekStartsBetween(startOfUtcWeek(sinceDate), startOfUtcWeek(currentDate))
    .slice(-RETURN_RATE_PREDICTION_MAX_WEEKS);
  const buckets = new Map(weekStarts.map((date) => [formatUtcDateKey(date), createReturnRateWeekBucket(date)]));
  const orderWeekById = new Map();

  sales.forEach((event, index) => {
    const weekKey = getEventWeekKey(getOrderCohortDate(event, { includeEventDate: true }));
    if (!buckets.has(weekKey)) return;
    if (event.orderId) orderWeekById.set(event.orderId, weekKey);
    const bucket = buckets.get(weekKey);
    const orderKey = event.orderId || event.id || `sale:${index}:${weekKey}`;
    bucket.orderIds.add(orderKey);
    bucket.orderUnits += Number(event.quantity || 0);
  });

  returns.forEach((event, index) => {
    const weekKey = getOperationalEventWeekKey(event, orderWeekById);
    const bucket = buckets.get(weekKey);
    if (!bucket) return;
    const orderKey = event.orderId || event.id || `return:${index}:${weekKey}`;
    bucket.orderIds.add(orderKey);
    bucket.returnOrderIds.add(orderKey);
    bucket.returnedUnits += getOperationalEventQuantity(event);
  });

  refunds.forEach((event, index) => {
    const weekKey = getOperationalEventWeekKey(event, orderWeekById);
    const bucket = buckets.get(weekKey);
    if (!bucket) return;
    const orderKey = event.orderId || event.id || `refund:${index}:${weekKey}`;
    if (!bucket.orderIds.has(orderKey)) {
      bucket.orderIds.add(orderKey);
      bucket.orderUnits += Math.max(getOperationalEventQuantity(event), 1);
    }
  });

  const rawPoints = [...buckets.values()].map(normalizeReturnRateWeekBucket);
  const totalOrders = rawPoints.reduce((total, point) => total + point.orders, 0);
  const totalReturnedOrders = rawPoints.reduce((total, point) => total + point.returnedOrders, 0);
  const totalOrderUnits = rawPoints.reduce((total, point) => total + point.orderUnits, 0);
  const totalReturnedUnits = rawPoints.reduce((total, point) => total + point.returnedUnits, 0);
  const totalReturnRate = calculateUnitRatePercent(
    totalReturnedUnits,
    totalOrderUnits,
    totalOrders ? (totalReturnedOrders / totalOrders) * 100 : 0,
  );
  const observedPoints = buildSmoothedReturnRatePoints(rawPoints, totalReturnRate);
  const forecastPoints = totalOrders ? buildReturnRateForecastPoints({
    observedPoints,
    totalReturnRate,
    currentDate,
  }) : [];
  const forecastNext90ReturnRate = roundRate(average(forecastPoints.map((point) => point.predictedReturnRate)));
  const last30DayReturnRate = calculateReturnRateForRecentDays(rawPoints, currentDate, 30);
  const last60DayReturnRate = calculateReturnRateForRecentDays(rawPoints, currentDate, 60);

  return {
    source: "shopify_returns_deep_diagnosis",
    granularity: "weekly",
    windowDays: safeWindowDays,
    generatedAt: toIso(currentDate),
    observedPoints,
    forecastPoints,
    summary: {
      totalOrders,
      totalReturnedOrders,
      totalOrderUnits,
      totalReturnedUnits,
      totalReturnRate,
      last30DayReturnRate,
      last60DayReturnRate,
      forecastNext90ReturnRate,
      forecastWeeks: forecastPoints.length,
      predictionHorizonDays: 91,
      confidence: getReturnRatePredictionConfidence({ totalOrders, observedPoints }),
    },
    model: {
      method: "weekly_bayesian_rolling_trend_with_seasonality",
      forecastWeeks: RETURN_RATE_PREDICTION_FORECAST_WEEKS,
      usesSeasonality: hasReturnRateSeasonalitySignal(observedPoints),
      notes: [
        "Observed points are weekly order cohorts smoothed with a Bayesian prior.",
        "Returns are assigned to the original order week when the Shopify order ID is present.",
        "Future points blend recent trend, full-window baseline and same-month historical behavior when available.",
      ],
    },
  };
}

export function buildProductMomentum({
  product = {},
  sales = [],
  windowDays = DIAGNOSIS_DEFAULT_WINDOW_DAYS,
  catalogBaseline = null,
  now = new Date(),
} = {}) {
  const currentDate = parseValidDate(now) || new Date();
  const productCreatedAt = parseValidDate(product.createdAt);
  const productAgeDays = productCreatedAt
    ? Math.max(0, Math.floor((currentDate.getTime() - productCreatedAt.getTime()) / (24 * 60 * 60 * 1000)))
    : null;
  const safeSales = (Array.isArray(sales) ? sales : [])
    .map((event, index) => ({
      id: event.id || event.orderId || `sale:${index}`,
      orderId: event.orderId || event.id || `sale:${index}`,
      createdAt: parseValidDate(event.orderDate || event.orderProcessedAt || event.processedAt || event.orderCreatedAt || event.createdAt || event.updatedAt),
      quantity: Math.max(0, Number(event.quantity || 0)),
      amount: Math.max(0, Number(event.amount || 0)),
    }))
    .filter((event) => event.createdAt);

  const last7 = sumSalesInWindow(safeSales, currentDate, 7);
  const last14 = sumSalesInWindow(safeSales, currentDate, 14);
  const last30 = sumSalesInWindow(safeSales, currentDate, 30);
  const previous30 = sumSalesBetween(safeSales, addUtcDays(currentDate, -60), addUtcDays(currentDate, -30));
  const previous90 = sumSalesBetween(safeSales, addUtcDays(currentDate, -120), addUtcDays(currentDate, -30));
  const weeklyBuckets = buildProductMomentumWeeklyBuckets(safeSales, currentDate, 4);
  const extendedWeeklyBuckets = buildProductMomentumWeeklyBuckets(safeSales, currentDate, 8);
  const weeklyUnits = weeklyBuckets.map((bucket) => bucket.units);
  const weeklyRevenue = weeklyBuckets.map((bucket) => roundCurrency(bucket.revenue));
  const extendedWeeklyUnits = extendedWeeklyBuckets.map((bucket) => bucket.units);
  const extendedWeeklyRevenue = extendedWeeklyBuckets.map((bucket) => roundCurrency(bucket.revenue));
  const catalog = catalogBaseline || {};
  const unitsDistribution = Array.isArray(catalog.unitsLast30Distribution) ? catalog.unitsLast30Distribution : [];
  const revenueDistribution = Array.isArray(catalog.revenueLast30Distribution) ? catalog.revenueLast30Distribution : [];
  const unitsVelocityScore = percentileRank(last30.units, unitsDistribution);
  const revenueVelocityScore = percentileRank(last30.revenue, revenueDistribution);
  const currentVelocityScore = clamp((0.65 * unitsVelocityScore) + (0.35 * revenueVelocityScore), 0, 96);
  const smoothingUnits = Math.max(3, Number(catalog.medianUnitsLast30 || 0) * 0.10);
  const smoothingRevenue = Math.max(10, Number(catalog.medianRevenueLast30 || 0) * 0.10);
  const unitsGrowthRatio = (last30.units + smoothingUnits) / (previous30.units + smoothingUnits);
  const revenueGrowthRatio = (last30.revenue + smoothingRevenue) / (previous30.revenue + smoothingRevenue);
  const combinedGrowthRatio = (0.65 * unitsGrowthRatio) + (0.35 * revenueGrowthRatio);
  const growthScore = getValidatedMomentumGrowthScore({
    unitsLast30: last30.units,
    unitsPrevious30: previous30.units,
    revenueLast30: last30.revenue,
    revenuePrevious30: previous30.revenue,
  });
  const storeUnitsLast30 = Math.max(0, Number(catalog.storeUnitsLast30 || 0)) || last30.units;
  const storeUnitsPrevious90 = Math.max(0, Number(catalog.storeUnitsPrevious90 || 0)) || previous90.units;
  const productShareLast30 = last30.units / Math.max(storeUnitsLast30, 1);
  const productShareBaseline = previous90.units / Math.max(storeUnitsPrevious90, 1);
  const shareLiftRatio = (productShareLast30 + 0.0001) / (productShareBaseline + 0.0001);
  const topCatalogPercent = unitsDistribution.length
    ? Math.max(1, Math.round(100 - unitsVelocityScore))
    : null;
  const catalogShareScore = getValidatedMomentumCatalogShareScore({
    storedScore: 0,
    currentVelocityScore,
    topCatalogPercent,
    productShareBaseline: productShareBaseline * 100,
    shareLiftRatio,
    hasCatalogBaseline: catalog.hasCatalogBaseline,
    unitsLast30: last30.units,
  });
  const activeWeekRatio = weeklyUnits.filter((value) => Number(value || 0) > 0).length / 4;
  const weeklySlope = linearRegressionSlope(weeklyUnits);
  const averageWeeklyUnits = average(weeklyUnits);
  const normalizedSlope = weeklySlope / Math.max(averageWeeklyUnits, 1);
  const trendDirectionScore = clamp(50 + (70 * normalizedSlope), 0, 100);
  const trendConsistencyScore = clamp((0.58 * trendDirectionScore) + (0.42 * activeWeekRatio * 100), 0, 100);
  const recencyScore = getValidatedMomentumRecencyScore({
    weeklyUnits,
    unitsLast30: last30.units,
    unitsLast7Days: last7.units,
    unitsLast14Days: last14.units,
    lastSaleAt: getLatestEventDate(safeSales),
    now: currentDate,
  });
  const rawScore = (0.35 * currentVelocityScore)
    + (0.25 * growthScore)
    + (0.20 * catalogShareScore)
    + (0.15 * trendConsistencyScore)
    + (0.05 * recencyScore);
  let score = Math.round(clamp(rawScore, 0, 100));

  if (last30.units === 0 && last30.revenue === 0) score = 0;
  if (last30.units < 2 && revenueVelocityScore < 80) score = Math.min(score, 40);
  if (last30.units < 5 && currentVelocityScore < 80) score = Math.min(score, 65);
  if (previous30.units === 0 && previous30.revenue === 0 && last30.units > 0) {
    score = Math.min(score, Math.round(78 + Math.min(9, Math.log1p(last30.units) * 2.6)));
  }
  if (productAgeDays !== null && productAgeDays < 30) score = Math.min(score, 85);

  const historyConfidence = previous90.units > 0 || previous90.revenue > 0
    ? 100
    : previous30.units > 0 || previous30.revenue > 0
      ? 70
      : last30.units > 0 || last30.revenue > 0
        ? 40
        : 0;
  const coverageConfidence = getProductMomentumCoverageConfidence({ sales: safeSales, catalogBaseline: catalog, last30 });
  const sampleConfidence = clamp(100 * Math.log1p(last30.units + last30.orders) / Math.log1p(30), 0, 100);
  const trendConfidence = clamp(activeWeekRatio * 100, 0, 100);
  let confidence = Math.round(clamp(
    (0.35 * sampleConfidence)
      + (0.25 * historyConfidence)
      + (0.25 * coverageConfidence)
      + (0.15 * trendConfidence),
    0,
    100,
  ));
  const inventoryState = getProductMomentumInventoryState(product);
  if (inventoryState.inventoryConstraint) confidence = Math.min(confidence, 70);

  const tier = getProductMomentumTier(score);
  const direction = getProductMomentumDirection({
    score,
    productAgeDays,
    growthScore,
    trendConsistencyScore,
    currentVelocityScore,
    recencyScore,
    unitsPrevious30Days: previous30.units,
    unitsLast30Days: last30.units,
    smoothingUnits,
    inventoryConstraint: inventoryState.inventoryConstraint,
  });
  const label = direction || tier;
  const growthPercent = previous30.units || previous30.revenue
    ? roundRate((combinedGrowthRatio - 1) * 100, 1)
    : last30.units > 0
      ? 100
      : 0;

  return {
    source: "shopify_orders_deep_diagnosis",
    score,
    tier,
    direction,
    label,
    confidence,
    confidenceLabel: getProductMomentumConfidenceLabel(confidence),
    calculatedAt: toIso(currentDate),
    windowDays: Number(windowDays || DIAGNOSIS_DEFAULT_WINDOW_DAYS),
    baselineDays: PRODUCT_MOMENTUM_BASELINE_DAYS,
    components: {
      currentVelocityScore: Math.round(currentVelocityScore),
      growthScore: Math.round(growthScore),
      catalogShareScore: Math.round(catalogShareScore),
      trendConsistencyScore: Math.round(trendConsistencyScore),
      recencyScore: Math.round(recencyScore),
    },
    inputs: {
      productCreatedAt: product.createdAt || null,
      productAgeDays,
      unitsLast7Days: last7.units,
      unitsLast14Days: last14.units,
      unitsLast30Days: last30.units,
      unitsPrevious30Days: previous30.units,
      unitsPrevious90Days: previous90.units,
      revenueLast30Days: roundCurrency(last30.revenue),
      revenuePrevious30Days: roundCurrency(previous30.revenue),
      revenuePrevious90Days: roundCurrency(previous90.revenue),
      ordersLast30Days: last30.orders,
      uniqueCustomersLast30Days: null,
      weeklyUnitsLast4Weeks: weeklyUnits,
      weeklyRevenueLast4Weeks: weeklyRevenue,
      weeklyUnitsLast8Weeks: extendedWeeklyUnits,
      weeklyRevenueLast8Weeks: extendedWeeklyRevenue,
      lastSaleAt: getLatestEventDate(safeSales),
    },
    catalog: {
      unitsVelocityScore: Math.round(unitsVelocityScore),
      revenueVelocityScore: Math.round(revenueVelocityScore),
      storeUnitsLast30Days: Math.round(storeUnitsLast30),
      storeUnitsPrevious90Days: Math.round(storeUnitsPrevious90),
      storeRevenueLast30Days: roundCurrency(Number(catalog.storeRevenueLast30 || 0) || last30.revenue),
      storeRevenuePrevious90Days: roundCurrency(Number(catalog.storeRevenuePrevious90 || 0) || previous90.revenue),
      medianUnitsLast30Days: roundRate(Number(catalog.medianUnitsLast30 || 0), 1),
      medianRevenueLast30Days: roundCurrency(Number(catalog.medianRevenueLast30 || 0)),
      productShareLast30: roundRate(productShareLast30 * 100, 3),
      productShareBaseline: roundRate(productShareBaseline * 100, 3),
      shareLiftRatio: roundRate(shareLiftRatio, 3),
      topCatalogPercent,
      catalogProductCount: Number(catalog.productCount || 0),
      hasCatalogBaseline: Boolean(catalog.hasCatalogBaseline),
    },
    display: {
      label,
      growthPercent,
      growthLabel: formatSignedPercent(growthPercent),
      catalogPositionLabel: topCatalogPercent ? `Top ${topCatalogPercent}%` : "Catalog baseline pending",
      trendLabel: getProductMomentumTrendLabel(weeklyUnits),
      recommendedUse: score >= 70 ? "Add to Watchlist" : score >= 50 ? "Monitor if risk rises" : "No commercial follow-up needed",
    },
    flags: {
      inventoryConstraint: inventoryState.inventoryConstraint,
      availableDaysLast30Days: inventoryState.availableDaysLast30Days,
      missingCatalogBaseline: !catalog.hasCatalogBaseline,
      missingCustomerData: true,
      missingInventoryHistory: inventoryState.availableDaysLast30Days === null,
    },
  };
}

function getValidatedMomentumGrowthScore({ unitsLast30 = 0, unitsPrevious30 = 0, revenueLast30 = 0, revenuePrevious30 = 0 } = {}) {
  const currentUnits = Math.max(0, Number(unitsLast30 || 0));
  const previousUnits = Math.max(0, Number(unitsPrevious30 || 0));
  const currentRevenue = Math.max(0, Number(revenueLast30 || 0));
  const previousRevenue = Math.max(0, Number(revenuePrevious30 || 0));
  if (!currentUnits && !currentRevenue) return 0;
  if (!previousUnits && !previousRevenue) {
    const volumeConfidence = Math.log1p(currentUnits) / Math.log1p(Math.max(40, currentUnits));
    return clamp(66 + (22 * volumeConfidence), 0, 88);
  }
  const ratios = [];
  if (previousUnits > 0 || currentUnits > 0) {
    ratios.push({ ratio: (currentUnits + 3) / (previousUnits + 3), weight: previousUnits > 0 ? 0.72 : 0.35 });
  }
  if (previousRevenue > 0) {
    ratios.push({ ratio: (currentRevenue + 25) / (previousRevenue + 25), weight: 0.28 });
  }
  const totalWeight = ratios.reduce((total, item) => total + item.weight, 0);
  const combinedRatio = totalWeight
    ? ratios.reduce((total, item) => total + (item.ratio * item.weight), 0) / totalWeight
    : 1;
  return clamp(50 + (28 * safeLog2(combinedRatio)), 0, 96);
}

function getValidatedMomentumCatalogShareScore({
  storedScore = 0,
  currentVelocityScore = 0,
  topCatalogPercent = 0,
  productShareBaseline = 0,
  shareLiftRatio = 0,
  hasCatalogBaseline = false,
  unitsLast30 = 0,
} = {}) {
  const stored = clamp(Number(storedScore || 0), 0, 100);
  const velocity = clamp(Number(currentVelocityScore || 0), 0, 96);
  const baseline = Number(productShareBaseline || 0);
  const lift = Number(shareLiftRatio || 0);
  const topPercent = Number(topCatalogPercent || 0);
  if (hasCatalogBaseline && baseline > 0 && lift > 0) {
    const liftScore = clamp(50 + (26 * safeLog2(lift)), 0, 96);
    return clamp((0.55 * liftScore) + (0.45 * velocity), 0, 96);
  }
  if (topPercent > 0) {
    const positionScore = clamp(98 - (topPercent * 1.55), 42, 94);
    return clamp((0.65 * positionScore) + (0.35 * Math.min(stored || positionScore, 92)), 0, 94);
  }
  const volumeScore = clamp(42 + ((Math.log1p(Math.max(0, unitsLast30)) / Math.log1p(Math.max(40, unitsLast30))) * 36), 0, 82);
  return clamp(stored ? Math.min(stored, volumeScore) : volumeScore, 0, 86);
}

function getValidatedMomentumRecencyScore({ weeklyUnits = [], unitsLast30 = 0, unitsLast7Days = 0, unitsLast14Days = 0, lastSaleAt = null, now = new Date() } = {}) {
  const latestWeekUnits = Array.isArray(weeklyUnits) && weeklyUnits.length ? Number(weeklyUnits[weeklyUnits.length - 1] || 0) : 0;
  const recent7 = Math.max(0, Number(unitsLast7Days || 0) || latestWeekUnits);
  const recent14 = Math.max(0, Number(unitsLast14Days || 0));
  const currentUnits = Math.max(0, Number(unitsLast30 || 0));
  const currentDate = parseValidDate(now) || new Date();
  const lastSaleDate = parseValidDate(lastSaleAt);
  const daysSinceLastSale = lastSaleDate
    ? Math.max(0, Math.floor((currentDate.getTime() - lastSaleDate.getTime()) / (24 * 60 * 60 * 1000)))
    : null;
  let base = recent7 > 0 ? 82 : recent14 > 0 ? 64 : currentUnits > 0 ? 42 : 0;
  if (daysSinceLastSale !== null) {
    base = daysSinceLastSale <= 2 ? 86 : daysSinceLastSale <= 7 ? 78 : daysSinceLastSale <= 14 ? 60 : daysSinceLastSale <= 30 ? 38 : 0;
  }
  const recentShare = currentUnits ? clamp(recent7 / currentUnits, 0, 1) : 0;
  return clamp(base + (recentShare * 10) + (recent7 >= 5 ? 4 : 0), 0, 96);
}

function sumSalesInWindow(sales, currentDate, days) {
  return sumSalesBetween(sales, addUtcDays(currentDate, -days), currentDate);
}

function sumSalesBetween(sales = [], startDate, endDate) {
  const orderIds = new Set();
  let units = 0;
  let revenue = 0;
  sales.forEach((event) => {
    if (!event.createdAt || event.createdAt.getTime() < startDate.getTime() || event.createdAt.getTime() >= endDate.getTime()) return;
    units += Number(event.quantity || 0);
    revenue += Number(event.amount || 0);
    orderIds.add(event.orderId || event.id);
  });

  return {
    units: Math.round(units),
    revenue: roundCurrency(revenue),
    orders: orderIds.size,
  };
}

function buildProductMomentumWeeklyBuckets(sales = [], currentDate = new Date(), weekCount = 4) {
  const bucketCount = Math.max(1, Math.round(Number(weekCount || 4)));
  const startDate = addUtcDays(startOfUtcWeek(currentDate), -7 * (bucketCount - 1));
  const buckets = new Map(Array.from({ length: bucketCount }, (_, index) => {
    const date = addUtcDays(startDate, index * 7);
    return [formatUtcDateKey(date), { key: formatUtcDateKey(date), units: 0, revenue: 0 }];
  }));

  sales.forEach((event) => {
    const weekKey = getEventWeekKey(event.createdAt);
    const bucket = buckets.get(weekKey);
    if (!bucket) return;
    bucket.units += Number(event.quantity || 0);
    bucket.revenue += Number(event.amount || 0);
  });

  return [...buckets.values()].map((bucket) => ({
    ...bucket,
    units: Math.round(bucket.units),
    revenue: roundCurrency(bucket.revenue),
  }));
}

function percentileRank(value, distribution = []) {
  const number = Math.max(0, Number(value || 0));
  const values = (Array.isArray(distribution) ? distribution : [])
    .map((item) => Math.max(0, Number(item || 0)))
    .filter((item) => Number.isFinite(item));
  if (!values.length) {
    if (number <= 0) return 0;
    return clamp(25 + (Math.log1p(number) / Math.log1p(Math.max(number, 30))) * 55, 0, 80);
  }

  const less = values.filter((item) => item < number).length;
  const equal = values.filter((item) => item === number).length;
  return clamp(((less + equal * 0.5) / values.length) * 100, 0, 100);
}

function linearRegressionSlope(values = []) {
  const points = (Array.isArray(values) ? values : []).map((value, index) => ({ x: index + 1, y: Number(value || 0) }));
  if (points.length < 2) return 0;
  const meanX = average(points.map((point) => point.x));
  const meanY = average(points.map((point) => point.y));
  const denominator = points.reduce((total, point) => total + ((point.x - meanX) ** 2), 0);
  if (!denominator) return 0;
  return points.reduce((total, point) => total + ((point.x - meanX) * (point.y - meanY)), 0) / denominator;
}

function safeLog2(value) {
  return Math.log2(Math.max(Number(value || 0), 0.0001));
}

function getProductMomentumCoverageConfidence({ sales = [], catalogBaseline = {}, last30 = {} }) {
  if (!sales.length) return 30;
  const hasRevenue = Number(last30.revenue || 0) > 0 || sales.some((event) => Number(event.amount || 0) > 0);
  const hasCatalogBaseline = Boolean(catalogBaseline?.hasCatalogBaseline);
  if (hasRevenue && hasCatalogBaseline) return 100;
  if (hasRevenue) return 70;
  if (hasCatalogBaseline) return 60;
  return 50;
}

function getProductMomentumInventoryState(product = {}) {
  const variants = Array.isArray(product.variants) ? product.variants : [];
  if (!variants.length) {
    return { inventoryConstraint: false, availableDaysLast30Days: null };
  }
  const trackedVariants = variants.filter((variant) => variant.inventoryTracked);
  if (!trackedVariants.length) {
    return { inventoryConstraint: false, availableDaysLast30Days: null };
  }
  const currentlyAvailable = trackedVariants.some((variant) => Number(variant.inventoryQuantity || 0) > 0 || variant.inventoryPolicy === "CONTINUE");
  return {
    inventoryConstraint: !currentlyAvailable,
    availableDaysLast30Days: currentlyAvailable ? 30 : 0,
  };
}

function getProductMomentumTier(score) {
  const value = Number(score || 0);
  if (value >= 80) return "Hot";
  if (value >= 60) return "Rising";
  if (value >= 40) return "Stable";
  if (value >= 20) return "Cooling";
  return "Low activity";
}

function getProductMomentumConfidenceLabel(confidence) {
  const value = Number(confidence || 0);
  if (value >= 80) return "High confidence";
  if (value >= 60) return "Medium confidence";
  if (value >= 40) return "Low confidence";
  return "Very low confidence";
}

function getProductMomentumDirection({
  growthScore = 0,
  trendConsistencyScore = 0,
  currentVelocityScore = 0,
  recencyScore = 0,
  unitsPrevious30Days = 0,
  unitsLast30Days = 0,
  smoothingUnits = 3,
  productAgeDays = null,
  inventoryConstraint = false,
} = {}) {
  if (inventoryConstraint) return "Inventory constrained";
  if (unitsLast30Days === 0) return "Dormant";
  if (productAgeDays !== null && productAgeDays < 30) return "New activity";
  if (unitsPrevious30Days <= smoothingUnits && unitsLast30Days >= 5 && growthScore >= 75) return "New spike";
  if (growthScore >= 70 && trendConsistencyScore >= 65) return "Accelerating";
  if (currentVelocityScore >= 80 && growthScore >= 40 && growthScore <= 65) return "High-volume stable";
  if (growthScore >= 75 && currentVelocityScore >= 45 && (productAgeDays === null || productAgeDays >= 14)) return "Emerging";
  if (growthScore < 40 && recencyScore < 70) return "Cooling";
  return getProductMomentumTrendLabelFromScores({ growthScore, trendConsistencyScore });
}

function getProductMomentumTrendLabelFromScores({ growthScore = 0, trendConsistencyScore = 0 } = {}) {
  if (growthScore >= 60 && trendConsistencyScore >= 55) return "Gaining traction";
  if (growthScore < 45) return "Softening";
  return "Steady";
}

function getProductMomentumTrendLabel(weeklyUnits = []) {
  const values = (Array.isArray(weeklyUnits) ? weeklyUnits : [])
    .map((value) => Math.max(0, Number(value || 0)))
    .slice(-4);
  const normalizedValues = [...Array(Math.max(0, 4 - values.length)).fill(0), ...values].slice(-4);
  const activeWeeks = normalizedValues.filter((value) => value > 0).length;
  const first = normalizedValues[0] || 0;
  const last = normalizedValues[normalizedValues.length - 1] || 0;
  const peak = Math.max(0, ...normalizedValues);
  const averageUnits = average(normalizedValues);
  const slope = linearRegressionSlope(normalizedValues);

  if (!activeWeeks) return "No recent sales activity";
  if (activeWeeks === 1 && last > 0) return "Latest-week sales spike after quiet weeks";
  if (activeWeeks <= 2 && last === 0) return "Intermittent activity; no latest-week sales";
  if (last > first && slope > 0) return "Sales increasing over the last 4 weeks";
  if (last < first && slope < 0) return "Sales decreasing over the last 4 weeks";
  if (activeWeeks === normalizedValues.length && peak - Math.min(...normalizedValues) <= Math.max(1, averageUnits * 0.25)) {
    return "Sales holding steady across active weeks";
  }
  return "Mixed sales activity across the last 4 weeks";
}

function formatSignedPercent(value) {
  const number = Number(value || 0);
  const rounded = roundRate(Math.abs(number), 1);
  if (number > 0) return `+${rounded}%`;
  if (number < 0) return `-${rounded}%`;
  return "0%";
}

function createReturnRateWeekBucket(date) {
  return {
    key: formatUtcDateKey(date),
    label: formatWeekLabel(date),
    startAt: toIso(date),
    orderIds: new Set(),
    returnOrderIds: new Set(),
    orderUnits: 0,
    returnedUnits: 0,
  };
}

function normalizeReturnRateWeekBucket(bucket) {
  const orders = bucket.orderIds.size;
  const returnedOrders = bucket.returnOrderIds.size;
  const returnedUnits = Math.max(Number(bucket.returnedUnits || 0), returnedOrders);
  const orderUnits = Math.max(Number(bucket.orderUnits || 0), returnedUnits, orders);
  return {
    key: bucket.key,
    label: bucket.label,
    startAt: bucket.startAt,
    orders,
    orderUnits,
    returnedOrders,
    returnedUnits,
    rawReturnRate: orders || orderUnits
      ? calculateUnitRatePercent(returnedUnits, orderUnits, orders ? (returnedOrders / orders) * 100 : 0)
      : null,
  };
}

function buildSmoothedReturnRatePoints(rawPoints = [], totalReturnRate = 0) {
  const priorRate = clamp(totalReturnRate / 100, 0, 1);
  const priorStrength = 4;
  let previousRate = 0;

  return rawPoints.map((point, index) => {
    const rolling = rawPoints.slice(Math.max(0, index - 2), index + 1);
    const rollingOrders = rolling.reduce((total, item) => total + item.orders, 0);
    const rollingReturns = rolling.reduce((total, item) => total + item.returnedOrders, 0);
    const rollingOrderUnits = rolling.reduce((total, item) => total + Number(item.orderUnits || 0), 0);
    const rollingReturnedUnits = rolling.reduce((total, item) => total + Number(item.returnedUnits || 0), 0);
    const smoothedRate = rollingOrders || rollingOrderUnits
      ? calculateUnitRatePercent(
        rollingReturnedUnits + priorStrength * priorRate,
        rollingOrderUnits + priorStrength,
        rollingOrders ? ((rollingReturns + priorStrength * priorRate) / (rollingOrders + priorStrength)) * 100 : previousRate,
      )
      : roundRate(previousRate);
    previousRate = smoothedRate;
    return {
      ...point,
      kind: "observed",
      rollingOrders,
      rollingReturnedOrders: rollingReturns,
      rollingOrderUnits,
      rollingReturnedUnits,
      smoothedReturnRate: smoothedRate,
    };
  });
}

function buildReturnRateForecastPoints({ observedPoints = [], totalReturnRate = 0, currentDate = new Date() } = {}) {
  const values = observedPoints.map((point) => Number(point.smoothedReturnRate)).filter((value) => Number.isFinite(value));
  if (values.length < 2) return [];

  const currentRate = values[values.length - 1];
  const recentValues = values.slice(-Math.min(values.length, 6));
  const recentDelta = recentValues.length > 1 ? recentValues[recentValues.length - 1] - recentValues[0] : 0;
  const recentSlope = linearRegressionSlope(recentValues);
  const flatThreshold = Math.max(0.5, Math.min(2.5, Math.abs(totalReturnRate) * 0.06));
  const trendDirection = Math.abs(recentDelta) <= flatThreshold && Math.abs(recentSlope) <= 0.35
    ? "flat"
    : recentDelta > 0 && recentSlope > 0
      ? "rising"
      : recentDelta < 0 && recentSlope < 0
        ? "falling"
        : "mixed";
  const recentOrderAvg = average(observedPoints.slice(-4).map((point) => Number(point.orders || point.orderUnits || 0)));
  const sampleWeight = clamp(recentOrderAvg / 8, 0.2, 1);
  const weeklySlope = trendDirection === "flat"
    ? 0
    : clamp(recentSlope * sampleWeight, -2.5, 2.5);
  const seasonalRates = buildReturnRateSeasonalityRates(observedPoints);
  const startDate = addUtcDays(startOfUtcWeek(currentDate), 7);
  const forecastPoints = [];
  let previousPrediction = currentRate;

  for (let index = 0; index < RETURN_RATE_PREDICTION_FORECAST_WEEKS; index += 1) {
    const date = addUtcDays(startDate, index * 7);
    const horizon = (index + 1) / RETURN_RATE_PREDICTION_FORECAST_WEEKS;
    const dampedTrend = currentRate + weeklySlope * (index + 1) * (1 - horizon * 0.62);
    const seasonalRate = seasonalRates.get(date.getUTCMonth()) ?? totalReturnRate;
    const anchorRate = trendDirection === "flat"
      ? currentRate
      : trendDirection === "falling"
        ? Math.min(currentRate, totalReturnRate)
        : totalReturnRate;
    const trendWeight = trendDirection === "flat" ? 0.72 : 0.66;
    const seasonalWeight = seasonalRates.has(date.getUTCMonth()) ? 0.12 : 0.06;
    const anchorWeight = 1 - trendWeight - seasonalWeight;
    const target = (dampedTrend * trendWeight) + (seasonalRate * seasonalWeight) + (anchorRate * anchorWeight);
    const easing = trendDirection === "flat" ? 0.22 : 0.30 + horizon * 0.14;
    const predictedReturnRate = clamp(previousPrediction + (target - previousPrediction) * easing, 0, 100);
    previousPrediction = predictedReturnRate;
    forecastPoints.push({
      kind: "forecast",
      key: formatUtcDateKey(date),
      label: formatWeekLabel(date),
      startAt: toIso(date),
      predictedReturnRate: roundRate(predictedReturnRate),
      baselineReturnRate: roundRate(totalReturnRate),
      seasonalReturnRate: roundRate(seasonalRate),
      trendSlope: roundRate(weeklySlope, 3),
      trendDirection,
    });
  }

  return forecastPoints;
}

function buildReturnRateSeasonalityRates(observedPoints = []) {
  const byMonth = new Map();
  observedPoints.forEach((point) => {
    const date = parseValidDate(point.startAt);
    const orders = Number(point.orders || 0);
    const orderUnits = Number(point.orderUnits || 0);
    if (!date || (!orders && !orderUnits)) return;
    const month = date.getUTCMonth();
    const current = byMonth.get(month) || { orders: 0, orderUnits: 0, returns: 0, returnedUnits: 0 };
    current.orders += orders;
    current.orderUnits += orderUnits;
    current.returns += Number(point.returnedOrders || 0);
    current.returnedUnits += Number(point.returnedUnits || 0);
    byMonth.set(month, current);
  });

  return new Map([...byMonth.entries()]
    .filter(([, value]) => value.orders > 0 || value.orderUnits > 0)
    .map(([month, value]) => [month, calculateUnitRatePercent(
      value.returnedUnits,
      value.orderUnits,
      value.orders ? (value.returns / value.orders) * 100 : 0,
    )]));
}

function hasReturnRateSeasonalitySignal(observedPoints = []) {
  const monthSet = new Set(observedPoints
    .map((point) => parseValidDate(point.startAt))
    .filter(Boolean)
    .map((date) => date.getUTCMonth()));
  return monthSet.size >= 6;
}

function calculateReturnRateForRecentDays(points = [], currentDate = new Date(), days = 30) {
  const since = new Date(currentDate.getTime() - days * 24 * 60 * 60 * 1000);
  const recent = points.filter((point) => {
    const date = parseValidDate(point.startAt);
    return date && date.getTime() >= since.getTime() && date.getTime() <= currentDate.getTime();
  });
  const orders = recent.reduce((total, point) => total + Number(point.orders || 0), 0);
  const returns = recent.reduce((total, point) => total + Number(point.returnedOrders || 0), 0);
  const orderUnits = recent.reduce((total, point) => total + Number(point.orderUnits || 0), 0);
  const returnedUnits = recent.reduce((total, point) => total + Number(point.returnedUnits || 0), 0);
  return calculateUnitRatePercent(returnedUnits, orderUnits, orders ? (returns / orders) * 100 : 0);
}

function getReturnRatePredictionConfidence({ totalOrders = 0, observedPoints = [] } = {}) {
  const activeWeeks = observedPoints.filter((point) => point.orders > 0).length;
  if (totalOrders >= 80 && activeWeeks >= 12) return "High";
  if (totalOrders >= 25 && activeWeeks >= 6) return "Medium";
  if (totalOrders > 0) return "Low";
  return "Unavailable";
}

function createMonthlyOrderActivityBucket(date) {
  return {
    key: formatUtcMonthKey(date),
    label: formatUtcMonthLabel(date),
    shortLabel: formatUtcMonthShortLabel(date),
    startAt: toIso(date),
    orderIds: new Set(),
    returnOrderIds: new Set(),
    refundOrderIds: new Set(),
    orderUnits: 0,
    revenue: 0,
    returnedUnits: 0,
    refundedUnits: 0,
    refundAmount: 0,
  };
}

function createWeeklyOrderActivityBucket(date) {
  return {
    key: formatUtcDateKey(date),
    label: formatWeekLabel(date),
    shortLabel: formatWeekLabel(date),
    startAt: toIso(date),
    orderIds: new Set(),
    returnOrderIds: new Set(),
    refundOrderIds: new Set(),
    orderUnits: 0,
    revenue: 0,
    returnedUnits: 0,
    refundedUnits: 0,
    refundAmount: 0,
  };
}

function addSaleToOrderActivityBucket(bucket, orderKey, event = {}) {
  if (!bucket || !orderKey) return;
  bucket.orderIds.add(orderKey);
  bucket.orderUnits += Number(event.quantity || 0);
  bucket.revenue += Number(event.amount || 0);
}

function addReturnToOrderActivityBucket(bucket, orderKey, event = {}) {
  if (!bucket || !orderKey) return;
  bucket.orderIds.add(orderKey);
  bucket.returnOrderIds.add(orderKey);
  bucket.returnedUnits += getOperationalEventQuantity(event);
}

function addRefundToOrderActivityBucket(bucket, orderKey, event = {}) {
  if (!bucket || !orderKey) return;
  bucket.orderIds.add(orderKey);
  bucket.refundOrderIds.add(orderKey);
  bucket.refundedUnits += getOperationalEventQuantity(event);
  bucket.refundAmount += Number(event.amount || event.totalRefundedAmount || 0);
}

function normalizeMonthlyOrderActivityBucket(bucket) {
  const orders = bucket.orderIds.size;
  const returnedOrders = bucket.returnOrderIds.size;
  const refundedOrders = bucket.refundOrderIds.size;
  const returnedUnits = Math.max(Number(bucket.returnedUnits || 0), returnedOrders);
  const refundedUnits = Math.max(Number(bucket.refundedUnits || 0), refundedOrders);
  const orderUnits = Math.max(Number(bucket.orderUnits || 0), returnedUnits, refundedUnits, orders);
  return {
    key: bucket.key,
    label: bucket.label,
    shortLabel: bucket.shortLabel,
    startAt: bucket.startAt,
    orders,
    orderUnits,
    revenue: roundCurrency(bucket.revenue),
    returnedOrders,
    returnedUnits,
    refundedOrders,
    refundedUnits,
    refundAmount: roundCurrency(bucket.refundAmount),
    returnRate: calculateUnitRatePercent(returnedUnits, orderUnits, orders ? (returnedOrders / orders) * 100 : 0),
    refundRate: calculateUnitRatePercent(refundedUnits, orderUnits, orders ? (refundedOrders / orders) * 100 : 0),
  };
}

function getOperationalEventQuantity(event = {}) {
  return Math.max(0, Number(event.quantity || event.processedQuantity || event.refundedQuantity || 0));
}

function getOperationalEventMonthKey(event, orderMonthById) {
  if (event?.orderId && orderMonthById.has(event.orderId)) return orderMonthById.get(event.orderId);
  const cohortMonthKey = getEventMonthKey(getOrderCohortDate(event));
  if (cohortMonthKey) return cohortMonthKey;
  return getEventMonthKey(event?.createdAt || event?.processedAt || event?.updatedAt);
}

function getOperationalEventWeekKey(event, orderWeekById) {
  if (event?.orderId && orderWeekById.has(event.orderId)) return orderWeekById.get(event.orderId);
  const cohortWeekKey = getEventWeekKey(getOrderCohortDate(event));
  if (cohortWeekKey) return cohortWeekKey;
  return getEventWeekKey(event?.createdAt || event?.processedAt || event?.updatedAt);
}

function getOrderCohortDate(event = {}, { includeEventDate = false } = {}) {
  return event.orderDate
    || event.orderProcessedAt
    || event.orderCreatedAt
    || event.orderCreated_at
    || (includeEventDate ? event.processedAt || event.createdAt || event.updatedAt : null);
}

function getEventMonthKey(value) {
  const date = parseValidDate(value);
  return date ? formatUtcMonthKey(date) : "";
}

function getEventWeekKey(value) {
  const date = parseValidDate(value);
  return date ? formatUtcDateKey(startOfUtcWeek(date)) : "";
}

function getMonthStartsBetween(startDate, endDate) {
  const months = [];
  let cursor = startOfUtcMonth(startDate);
  const end = startOfUtcMonth(endDate);
  while (cursor.getTime() <= end.getTime()) {
    months.push(cursor);
    cursor = addUtcMonths(cursor, 1);
  }
  return months;
}

function getWeekStartsBetween(startDate, endDate) {
  const weeks = [];
  let cursor = startOfUtcWeek(startDate);
  const end = startOfUtcWeek(endDate);
  while (cursor.getTime() <= end.getTime()) {
    weeks.push(cursor);
    cursor = addUtcDays(cursor, 7);
  }
  return weeks;
}

function startOfUtcMonth(value) {
  const date = parseValidDate(value) || new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function startOfUtcWeek(value) {
  const date = parseValidDate(value) || new Date();
  const day = date.getUTCDay();
  const mondayOffset = (day + 6) % 7;
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - mondayOffset);
  return start;
}

function addUtcMonths(date, count) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
}

function addUtcDays(date, count) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + count);
  return next;
}

function formatUtcMonthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatUtcDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function formatUtcMonthLabel(date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatUtcMonthShortLabel(date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(date);
}

function formatWeekLabel(date) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function parseValidDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function preferFreshNumber(fresh, fallback, { fallbackWhenZero = false } = {}) {
  const number = Number(fresh || 0);
  if (number > 0) return number;
  if (!fallbackWhenZero) return 0;
  return Number(fallback || 0);
}

function getDiagnosisSourceFetchCompleteness(shopifyData = {}) {
  const explicit = shopifyData.sourceFetchComplete || shopifyData.incrementalSource?.sourceFetchComplete || {};
  const accessDenied = shopifyData.orderAccessDenied === true;
  const allComplete = shopifyData.incrementalSource?.fetchComplete !== false && !accessDenied;
  return {
    sales: explicit.sales === undefined ? allComplete : explicit.sales !== false && !accessDenied,
    refunds: explicit.refunds === undefined ? allComplete : explicit.refunds !== false && !accessDenied,
    returns: explicit.returns === undefined ? allComplete : explicit.returns !== false && !accessDenied,
  };
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sumBy(items, field) {
  return items.reduce((total, item) => total + Number(item[field] || 0), 0);
}

function average(values) {
  const numbers = (Array.isArray(values) ? values : []).map(Number).filter((value) => Number.isFinite(value));
  if (!numbers.length) return 0;
  return numbers.reduce((total, value) => total + value, 0) / numbers.length;
}

function median(values) {
  const numbers = (Array.isArray(values) ? values : []).map(Number).filter((value) => Number.isFinite(value)).sort((first, second) => first - second);
  if (!numbers.length) return 0;
  const middle = Math.floor(numbers.length / 2);
  if (numbers.length % 2) return numbers[middle];
  return (numbers[middle - 1] + numbers[middle]) / 2;
}

function roundRate(value, decimals = 2) {
  const number = Number(value || 0);
  const factor = 10 ** decimals;
  return Math.round(number * factor) / factor;
}

function clampPercentRate(value) {
  return clamp(Number(value || 0), 0, 100);
}

function calculateUnitRatePercent(numeratorUnits, denominatorUnits, fallbackPercent = 0, decimals = 2) {
  const numerator = Number(numeratorUnits || 0);
  const denominator = Number(denominatorUnits || 0);
  const rawRate = denominator > 0 ? (numerator / denominator) * 100 : fallbackPercent;
  return roundRate(clampPercentRate(rawRate), decimals);
}

function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function truncateText(value, maxLength = 160) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function normalizeIssueCode(value) {
  const normalized = normalizeText(value).replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (!normalized) return "";
  if (normalized.includes("source_integrity")
    || normalized.includes("source_mismatch")
    || normalized.includes("review_feed")
    || normalized.includes("feed_integrity")
    || normalized.includes("feed_mismatch")
    || normalized.includes("review_mismatch")
    || normalized.includes("wrong_product")
    || normalized.includes("wrong_sku")
  ) return "review_feed_integrity";
  if (normalized.includes("fit") || normalized.includes("sizing") || normalized.includes("size")) return "fit_sizing";
  if (normalized.includes("color")) return "color_expectation";
  if (normalized.includes("safety") || normalized.includes("unsafe") || normalized.includes("danger") || normalized.includes("hazard") || normalized.includes("peligro")) return "safety_concern";
  if (normalized.includes("subjective") || normalized.includes("preference") || normalized.includes("dislike") || normalized.includes("fear") || normalized.includes("scare") || normalized.includes("creepy") || normalized.includes("miedo") || normalized.includes("asusta") || normalized.includes("terror")) return "subjective_negative_reaction";
  if (normalized.includes("durability")) return "durability";
  if (normalized.includes("compat")) return "compatibility";
  if (normalized.includes("setup") || normalized.includes("expectation") || normalized.includes("install") || normalized.includes("mount") || normalized.includes("adhesive") || normalized.includes("surface") || normalized.includes("adapter") || normalized.includes("cable") || normalized.includes("webcam") || normalized.includes("camera") || normalized.includes("banding") || normalized.includes("glare")) return "setup_expectation";
  if (normalized.includes("defect") || normalized.includes("quality") || normalized.includes("soft") || normalized.includes("rough") || normalized.includes("scratchy") || normalized.includes("stiff") || normalized.includes("material") || normalized.includes("fabric") || normalized.includes("texture")) return "quality_defect";
  if (normalized.includes("shipping")) return "shipping_delivery";
  if (normalized.includes("refund")) return "refund_impact";
  if (normalized.includes("content") || normalized.includes("description") || normalized.includes("metadata")) return "product_content";
  if (normalized.includes("product_quality")) return "product_quality";
  return normalized;
}

function getHumanIssueLabel(issue) {
  const labels = {
    fit_sizing: "Fit & sizing",
    color_expectation: "Color expectations",
    durability: "Durability",
    quality_defect: "Product quality",
    compatibility: "Compatibility",
    setup_expectation: "Setup expectations",
    shipping_delivery: "Shipping or delivery",
    product_content: "Product content",
    product_quality: "Product quality",
    safety_concern: "Safety concern",
    subjective_negative_reaction: "Subjective negative reaction",
    negative_sentiment: "Negative customer sentiment",
    repeated_language: "Repeated customer language",
    return_rate_anomaly: "Return rate anomaly",
    refund_impact: "Refund impact",
    review_feed_integrity: "Review feed mismatch",
    source_integrity: "Source integrity",
  };
  return labels[issue] || capitalize(String(issue || "Product quality").replace(/_/g, " "));
}

function getPdpActionId(issue) {
  if (issue === "fit_sizing") return "draft-fit-note";
  if (issue === "color_expectation") return "draft-color-expectation-note";
  if (issue === "safety_concern") return "draft-safety-expectation-note";
  if (issue === "subjective_negative_reaction") return "draft-subjective-expectation-note";
  if (issue === "compatibility") return "draft-compatibility-faq";
  if (issue === "setup_expectation") return "improve-setup-guidance";
  if (issue === "product_content") return "rewrite-product-description";
  if (issue === "quality_defect" || issue === "durability") return "draft-quality-note";
  return "draft-pdp-copy";
}

function getPdpActionLabel(issue) {
  if (issue === "fit_sizing") return "Draft fit note for product description";
  if (issue === "color_expectation") return "Draft color expectation note";
  if (issue === "safety_concern") return "Draft safety expectation note";
  if (issue === "subjective_negative_reaction") return "Draft expectation-setting note";
  if (issue === "compatibility") return "Draft compatibility FAQ";
  if (issue === "setup_expectation") return "Improve setup guidance";
  if (issue === "durability") return "Draft durability expectation note";
  if (issue === "product_content") return "Rewrite product description";
  return "Draft product quality note";
}

function getPdpCopyPlacement(issue) {
  if (issue === "compatibility" || issue === "setup_expectation") return "append";
  return "prepend";
}

function getIssueTag(issue) {
  if (issue === "fit_sizing") return "fit_issue";
  if (issue === "color_expectation") return "color_expectation_issue";
  if (issue === "durability") return "durability_issue";
  if (issue === "setup_expectation") return "setup_expectation_issue";
  if (issue === "quality_defect") return "quality_issue";
  if (issue === "safety_concern") return "safety_concern";
  if (issue === "subjective_negative_reaction") return "";
  if (issue === "product_content") return "content_issue";
  return "";
}

function buildDefaultPdpCopy(title, issueLabel, topReasons) {
  const reason = topReasons.length ? ` Customer signals mention ${topReasons.join(", ")}.` : "";
  return `${title}: ProductPulse detected ${issueLabel.toLowerCase()} signals.${reason} Add clear shopper-facing guidance before purchase to reduce avoidable returns and support questions.`;
}

function shouldRecommendFullDescriptionRewrite({ contentIssues = [], currentDescription = "" }) {
  const description = normalizeDraftParagraph(currentDescription);
  const wordCount = description ? description.split(/\s+/).filter(Boolean).length : 0;
  if (!description || wordCount < 25) return true;
  const hasTargetedCorrection = getDescriptionReplacementsFromContentIssues(contentIssues).length > 0;

  return (Array.isArray(contentIssues) ? contentIssues : []).some((issue) => {
    const code = normalizeContentIssueCode(issue.code);
    const label = normalizeText(`${issue.label || ""} ${issue.evidence || ""}`);
    const severity = normalizeSeverity(issue.severity);
    if (hasTargetedCorrection && TARGETED_DESCRIPTION_CORRECTION_CODES.has(code)) return false;
    if (FULL_DESCRIPTION_REWRITE_CODES.has(code)) return true;
    if (severity !== "high") return false;
    if (code === "title_description_mismatch") {
      return /(wrong product|different product|unrelated product|about another product|clearly disconnected|clearly different)/.test(label);
    }
    return /(wrong product|different product|unrelated product|about another product|clearly disconnected|clearly different|incoherent)/.test(label);
  });
}

const FULL_DESCRIPTION_REWRITE_CODES = new Set([
  "missing_description",
  "short_description",
  "incoherent_description",
  "wrong_product_description",
]);

const TARGETED_DESCRIPTION_CORRECTION_CODES = new Set([
  "description_variant_mismatch",
  "title_description_mismatch",
  "contradiction",
]);

function getDescriptionReplacementsFromContentIssues(contentIssues = []) {
  return (Array.isArray(contentIssues) ? contentIssues : [])
    .flatMap((issue) => {
      let replacements = [];
      if (Array.isArray(issue.replacements)) replacements = issue.replacements;
      else if (issue.replacement) replacements = [issue.replacement];
      return replacements.map((replacement) => ({
        from: String(replacement.from || "").trim(),
        to: String(replacement.to || "").trim(),
        reason: replacement.reason || issue.evidence || "",
      }));
    })
    .filter((replacement) => replacement.from && replacement.to && normalizeText(replacement.from) !== normalizeText(replacement.to));
}

function buildCorrectedDescriptionDraft({ currentDescription = "", replacements = [] } = {}) {
  return applyTextReplacements(normalizeDraftParagraph(currentDescription), replacements);
}

function buildEmptyDescriptionEnhancementPlan(reason = "") {
  return {
    shouldRecommend: false,
    draftText: "",
    descriptionReplacements: [],
    coverage: {
      skipped: true,
      reason,
    },
  };
}

function buildTargetedDescriptionEnhancementPlan({ currentDescription = "", contentIssues = [], product = {} } = {}) {
  const current = normalizeDraftParagraph(currentDescription);
  if (!current) return buildEmptyDescriptionEnhancementPlan("Current product copy is empty; use a rewrite instead.");
  const additions = buildTargetedDescriptionEnhancementSentences({ contentIssues, product, currentDescription: current });
  const missingAdditions = additions.filter((sentence) => !isTextCoveredByCurrentContent(sentence, current, { minTokenCoverage: 0.66 }));
  if (!missingAdditions.length) return buildEmptyDescriptionEnhancementPlan("Current product copy already covers the targeted enhancement.");
  const anchor = findDescriptionEnhancementAnchor(current, missingAdditions.join(" "), contentIssues);
  if (!anchor) return buildEmptyDescriptionEnhancementPlan("No stable sentence anchor was found for a targeted description edit.");
  const additionText = missingAdditions.join(" ");
  const replacement = {
    from: anchor,
    to: `${anchor} ${additionText}`.replace(/\s+/g, " ").trim(),
    reason: "Targeted ProductPulse description enhancement based on detected content gaps.",
  };
  const draftText = buildCorrectedDescriptionDraft({ currentDescription: current, replacements: [replacement] });
  if (!isMeaningfullyDifferentDescription(current, draftText)) return buildEmptyDescriptionEnhancementPlan("Targeted enhancement did not change the description.");
  return {
    shouldRecommend: true,
    draftText,
    descriptionReplacements: [replacement],
    coverage: {
      currentCoverage: "partial",
      extractedMissingOnly: true,
      changeStrategy: "targeted-enhancement",
      missingSentenceCount: missingAdditions.length,
    },
  };
}

function buildTargetedDescriptionEnhancementSentences({ contentIssues = [], product = {}, currentDescription = "" } = {}) {
  const issues = Array.isArray(contentIssues) ? contentIssues : [];
  const text = normalizeText([
    product.title,
    product.productType,
    currentDescription,
    ...issues.flatMap((issue) => [issue.code, issue.label, issue.evidence, issue.suggestedAction]),
  ].filter(Boolean).join(" "));
  const sentences = [];
  const context = getTargetedDescriptionProductContext(text);

  if (/\b(color temperature|brightness|lumen|lumens|cri|beam angle|optical|five brightness|three color temperatures)\b/.test(text)) {
    sentences.push(context.photoPanel
      ? "If color accuracy matters, compare the lighting mode examples and confirm brightness, color-temperature behavior, and print finish before purchase."
      : "If exact lighting measurements matter, verify color-temperature values, brightness or lumen range, CRI, and beam-angle details against the selected variant before purchase.");
  }
  if (/\b(width|height|dimension|dimensions|coverage|diffuser|rail|length|capacity|wattage|watt|voltage|power|min line|minimum fill|print area|card thickness|thickness|surface compatibility)\b/.test(text)) {
    sentences.push(context.photoPanel
      ? "Before purchase, confirm panel outer dimensions, visible 5 x 7 print area, card thickness, USB power needs, and the surface where adhesive tabs or the tabletop foot will be used."
      : context.railLike
        ? "For tight desks or shelves, verify rail width and height, diffuser dimensions, and coverage for the selected length before purchase."
        : context.apparel
          ? "For precise fit, compare the body-size chart with finished garment measurements such as shoulder width, chest width, sleeve length, and upper-arm ease for the selected size."
          : context.kettle
            ? "Before purchase, confirm kettle capacity, wattage, counter clearance, and that your intended use can stay above the MIN fill line on a 120 V outlet."
            : "Confirm product dimensions, included parts, materials, care, and setup limits for the selected variant before purchase.");
  }
  if (/\b(clean|cleaning|care|solvent|abrasive|maintenance)\b/.test(text)) {
    sentences.push(context.photoPanel
      ? "Clean the magnetic face and panel only with a soft dry or lightly damp cloth, and avoid solvents, abrasives, or soaking."
      : context.railLike
        ? "Clean the rail and diffuser only with a soft dry or lightly damp cloth, and avoid solvents, abrasives, or soaking unless the listed materials confirm otherwise."
        : context.apparel
          ? "For care, cold wash and hang dry; avoid tumble drying if shoulder, sleeve, or upper-arm fit is important."
          : context.kettle
            ? "For care, rinse before first use, descale when mineral buildup appears, keep the powered base out of water, and avoid abrasives on the silicone body, lid, and steam vent."
            : "Clean only according to the listed material guidance, and avoid solvents, abrasives, or soaking unless the product instructions explicitly allow it.");
  }
  if (/\b(variant|variants|both|same across|differs|differences|cable length|brightness levels)\b/.test(text)) {
    sentences.push(context.photoPanel
      ? "Check whether frame finish, brightness behavior, cable routing, and included mounting parts are identical across variants if those details matter for your setup."
      : context.kettle
        ? "Check whether capacity, wattage, cord length, and safety markings are identical across variants if those details matter for your setup."
        : context.apparel
          ? "Check which color and size combinations are available, and confirm whether finished garment measurements or fit notes differ by variant."
        : "Check variant-specific specs and setup details before purchase if those differences matter for your use case.");
  }

  return uniqueBy(sentences, normalizeText).slice(0, 3);
}

function getTargetedDescriptionProductContext(text = "") {
  const kettleCore = /\b(kettle|boil|boiling|min line|minimum fill|min fill|fill line|converter|power bank|car socket|silicone body|steam vent|descale)\b/.test(text)
    || (/\bsteam\b/.test(text) && /\b(vent|boil|boiling|kettle|fill|outlet|counter|descale)\b/.test(text));
  return {
    railLike: /\b(rail|diffuser|light bar|bar light|strip light|lumispan)\b/.test(text),
    apparel: /\b(apparel|overshirt|shirt|garment|fabric|sleeve|shoulder|upper arm|chest|body measurement|body-size chart|size chart|sizing chart)\b/.test(text),
    kettle: kettleCore,
    photoPanel: /\b(photo|print|panel|backlit|magnetic face|art card|5 x 7|5x7|gallery neutral|warm shelf|night amber|white border|edge shadow|wall tabs|tabletop foot)\b/.test(text),
  };
}

function findDescriptionEnhancementAnchor(currentDescription = "", additionText = "", contentIssues = []) {
  const sentences = splitDescriptionCoverageSentences(currentDescription);
  if (!sentences.length) return "";
  const issueTokens = new Set(meaningfulTokens([
    additionText,
    ...(Array.isArray(contentIssues) ? contentIssues : []).flatMap((issue) => [issue.label, issue.evidence, issue.suggestedAction]),
  ].filter(Boolean).join(" ")));
  const scored = sentences
    .map((sentence, index) => {
      const tokens = meaningfulTokens(sentence);
      const shared = tokens.filter((token) => issueTokens.has(token)).length;
      const setupBonus = /\b(spec|detail|variant|option|included|brightness|temperature|dimension|length|rail|diffuser|power|care|clean|size|fit|measurement|capacity|voltage|steam|print|panel|surface)\b/i.test(sentence) ? 2 : 0;
      return { sentence, index, score: shared + setupBonus };
    })
    .sort((first, second) => second.score - first.score || first.index - second.index);
  return scored[0]?.sentence || sentences[0] || "";
}

function applyTextReplacements(value, replacements = []) {
  return (Array.isArray(replacements) ? replacements : []).reduce((text, replacement) => {
    if (!replacement?.from || !replacement?.to) return text;
    return replaceTextCaseInsensitive(text, replacement.from, replacement.to);
  }, String(value || ""));
}

function replaceTextCaseInsensitive(value, from, to) {
  const source = String(from || "").trim();
  const escaped = escapeRegExp(source);
  if (!escaped) return value;
  const pattern = /[^\w\s]/.test(source) ? escaped : `\\b${escaped}\\b`;
  return String(value || "").replace(new RegExp(pattern, "gi"), to);
}

function isMeaningfullyDifferentDescription(currentDescription = "", nextDescription = "") {
  return Boolean(normalizeDraftParagraph(nextDescription))
    && normalizeText(currentDescription) !== normalizeText(nextDescription);
}

function hasMeaningfulDraftFieldChange({ currentValue = "", draftValue = "" } = {}) {
  return Boolean(normalizeComparableDraftFieldValue(draftValue))
    && normalizeComparableDraftFieldValue(currentValue) !== normalizeComparableDraftFieldValue(draftValue);
}

function hasMeaningfulRecommendedActionChange(action = {}) {
  const payload = action.payload || {};
  const comparisons = [
    [payload.currentValue, payload.draftText],
    [payload.currentValue, payload.draftTitle],
    [payload.currentValue, payload.draftHandle],
    [payload.currentTitle, payload.draftTitle],
    [payload.currentStatus, payload.productStatus],
    [payload.currentTemplateSuffix, payload.templateSuffix],
  ];
  const explicitComparison = comparisons.find(([currentValue, draftValue]) => currentValue !== undefined && draftValue !== undefined);
  if (!explicitComparison) return true;
  const [currentValue, draftValue] = explicitComparison;
  return hasMeaningfulDraftFieldChange({ currentValue, draftValue });
}

function normalizeComparableDraftFieldValue(value = "") {
  return stripHtml(value)
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDescriptionGuidanceAddendum({ title, contentIssues = [], suggestedDescription = "", shopperGuidance = "" }) {
  const issueGuidance = buildCustomerFacingDescriptionAddendum({ contentIssues, title });
  const focusedGuidance = normalizeDraftParagraph(shopperGuidance);
  if (focusedGuidance && !isGenericProductPulseDescriptionGuidance(focusedGuidance)) return focusedGuidance;

  const suggested = normalizeDraftParagraph(suggestedDescription);
  if (suggested && !looksLikeFullDescriptionRewrite(suggested, title) && !isInstructionalDescriptionDraft(suggested)) return suggested;

  return issueGuidance || focusedGuidance || buildDefaultCustomerFacingDescriptionAddendum(title);
}

function isGenericProductPulseDescriptionGuidance(value = "") {
  const text = normalizeText(value);
  if (!text) return false;
  return /productpulse detected .* signals/.test(text)
    || /add clear shopper-facing guidance before purchase/.test(text)
    || /review stored customer signals/.test(text);
}

function buildCustomerFacingDescriptionAddendum({ contentIssues = [], title = "" } = {}) {
  const issueText = normalizeText((Array.isArray(contentIssues) ? contentIssues : [])
    .map((issue) => `${issue.label || ""} ${issue.evidence || ""} ${issue.code || ""}`)
    .join(" "));
  const categoryText = normalizeText(title);
  const categories = detectProductCategoryGroups(categoryText);
  const context = getTargetedDescriptionProductContext(`${categoryText} ${issueText}`);
  const apparelLike = categories.has("apparel") || /\b(garment|apparel|clothing|shirt|overshirt|jacket|trouser|pants|shoe|sleeve)\b/.test(categoryText);
  const sentences = [];
  if (/\b(material|fiber|fabric|linen|cotton|composition|blend)\b/.test(issueText)) {
    sentences.push("Before ordering, confirm the fabric composition for the selected variant if exact material percentages are important to you.");
  }
  if (/\b(size chart|measurement|measurements|chest|shoulder|sleeve|inseam|waist|length|fit|sizing)\b/.test(issueText)) {
    sentences.push(apparelLike
      ? "Compare the selected size against the garment measurements, especially the fit points that matter most for how you want the item to sit."
      : context.photoPanel
        ? "Confirm panel outer dimensions, visible print area, card thickness, USB power needs, and mounting surface compatibility before purchase."
        : context.kettle
          ? "Confirm kettle capacity, wattage, counter clearance, and MIN fill requirements before purchase."
          : "Confirm product dimensions, coverage guidance, and variant-specific measurements where shoppers compare options.");
  } else if (context.photoPanel && /\b(spec|specification|dimension|dimensions|power|voltage|wattage|adapter|surface|adhesive|card thickness|print area)\b/.test(issueText)) {
    sentences.push("Confirm panel outer dimensions, visible print area, card thickness, USB power needs, and mounting surface compatibility before purchase.");
  } else if (context.kettle && /\b(spec|specification|capacity|power|voltage|wattage|counter|clearance|min line|minimum fill)\b/.test(issueText)) {
    sentences.push("Confirm kettle capacity, wattage, counter clearance, and MIN fill requirements before purchase.");
  }
  if (/\b(included|package|box|bundle|accessor|accessories|comes with|what.*include)\b/.test(issueText)) {
    sentences.push("Check the product details for what is included with the item before checkout.");
  }
  if (/\b(compatib|works with|adapter|device|model|setup)\b/.test(issueText)) {
    sentences.push(context.photoPanel
      ? "Confirm USB power needs, mounting surface compatibility, and tabletop versus wall setup before purchase."
      : context.kettle
        ? "Confirm the kettle will be used only with a supported 120 V outlet and above the MIN fill line before purchase."
        : "Confirm the selected variant is compatible with your setup before purchase.");
  }
  if (/\b(color|colour|photo|image|lighting|appearance|pictured)\b/.test(issueText)) {
    sentences.push("Review the selected variant photos and color name carefully, since lighting and screens can affect how the product appears.");
  }
  return uniqueBy(sentences, normalizeText).slice(0, 3).join(" ");
}

function buildDefaultCustomerFacingDescriptionAddendum(title = "") {
  const label = String(title || "this product").trim();
  return `Before ordering ${label}, review the selected variant, product details and any available measurements so the item matches your expectations.`;
}

function shouldSuppressCoveredPdpDescriptionAction({
  mainIssue = "",
  proposedText = "",
  currentDescriptionText = "",
  deterministic = {},
} = {}) {
  const issue = normalizeIssueCode(mainIssue);
  if (!["setup_expectation", "compatibility"].includes(issue)) return false;
  const proposed = normalizeDraftParagraph(proposedText);
  const current = normalizeDraftParagraph(currentDescriptionText);
  if (!proposed || !current) return false;
  if (isTextCoveredByCurrentContent(proposed, current)) return true;

  const proposedTopics = getExpectationGuidanceTopics(proposed);
  const currentTopics = getExpectationGuidanceTopics(current);
  if (proposedTopics.size > 0) {
    return [...proposedTopics].every((topic) => currentTopics.has(topic));
  }

  const genericGuidance = /\b(productpulse detected|detected|signals|guidance|before purchase|before checkout|shopper-facing|expectation|expectations|setup)\b/.test(normalizeText(proposed));
  if (!genericGuidance) return false;
  if (issue === "setup_expectation") return currentTopics.size >= 2 && hasSetupExpectationTextSignals(deterministic);
  return currentTopics.size >= 1;
}

function isInstructionalDescriptionDraft(value = "") {
  const normalized = normalizeText(value);
  return /\b(add|insert|create|write|draft|include|clarif(y|ies)|update)\b.{0,80}\b(shopper facing|customer facing|note|section|copy|description|faq)\b/.test(normalized)
    || /\bthis note is based on\b/.test(normalized)
    || /\bdescription says\b/.test(normalized)
    || /\bcopy repeatedly advises\b/.test(normalized);
}

function looksLikeFullDescriptionRewrite(value, title) {
  const text = normalizeDraftParagraph(value);
  if (!text) return false;
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount >= 45) return true;
  const titleTokens = meaningfulTokens(title);
  const textTokens = new Set(meaningfulTokens(text));
  return wordCount >= 30 && titleTokens.filter((token) => textTokens.has(token)).length >= Math.min(2, titleTokens.length);
}

function buildDefaultDescriptionRewrite(title, contentAnalysis) {
  const findings = [
    ...(Array.isArray(contentAnalysis?.issues) ? contentAnalysis.issues : []),
    ...(Array.isArray(contentAnalysis?.advisories) ? contentAnalysis.advisories : []),
  ];
  const issues = findings.length ? findings.map((issue) => issue.label).join(", ") : "product content gaps";
  return `${title}: rewrite the product description so it clearly explains what the product is, who it is for, key specifications, important options, and any expectation-setting details. ProductPulse found ${issues}.`;
}

function buildEnhancedDescriptionDraft({ title, currentDescription, suggestedDescription, shopperGuidance, contentAnalysis }) {
  const current = normalizeDraftParagraph(currentDescription);
  const suggested = normalizeDraftParagraph(suggestedDescription);
  const guidance = normalizeDraftParagraph(shopperGuidance);
  const fallback = normalizeDraftParagraph(buildDefaultDescriptionRewrite(title, contentAnalysis));
  const usableSuggested = suggested && (!current || !hasSubstantialOverlap(current, suggested)) ? suggested : "";
  const additions = [guidance, usableSuggested || fallback].filter(Boolean);
  const uniqueAdditions = [];

  additions.forEach((addition) => {
    if (!addition) return;
    const alreadyInCurrent = current && hasSubstantialOverlap(current, addition);
    const alreadyQueued = uniqueAdditions.some((existing) => hasSubstantialOverlap(existing, addition));
    if (!alreadyInCurrent && !alreadyQueued) uniqueAdditions.push(addition);
  });

  if (!current) return uniqueAdditions.join("\n\n") || fallback;
  if (!uniqueAdditions.length) return current;
  return [current, ...uniqueAdditions].join("\n\n");
}

function getAppendedDescriptionText(currentDescription = "", proposedDescription = "") {
  const current = normalizeDraftParagraph(currentDescription);
  const proposed = normalizeDraftParagraph(proposedDescription);
  if (!current || !proposed || proposed.length <= current.length) return "";
  if (!proposed.toLowerCase().startsWith(current.toLowerCase())) return "";
  return proposed
    .slice(current.length)
    .replace(/^[\s:;,.-]+/, "")
    .trim();
}

function getCurrentProductDescriptionText(product = {}) {
  const plain = normalizeDraftParagraph(product?.description || "");
  const html = normalizeDraftParagraph(stripHtml(product?.descriptionHtml || product?.bodyHtml || ""));
  if (!plain) return html;
  if (!html) return plain;
  const normalizedPlain = normalizeText(plain);
  const normalizedHtml = normalizeText(html);
  if (!normalizedPlain) return html;
  if (!normalizedHtml) return plain;
  if (normalizedHtml.includes(normalizedPlain)) return html;
  if (normalizedPlain.includes(normalizedHtml)) return plain;
  if (hasSubstantialOverlap(plain, html)) return plain;
  return `${plain}\n\n${html}`;
}

function getCurrentProductDescriptionHtml(product = {}) {
  return String(product?.descriptionHtml || product?.currentDescriptionHtml || product?.bodyHtml || "").trim();
}

function buildEmptyDescriptionCoveragePlan(reason = "") {
  return {
    shouldRecommend: false,
    draftText: "",
    operation: "",
    coverage: {
      skipped: true,
      reason,
    },
  };
}

function buildDescriptionCoveragePlan({
  currentDescription = "",
  proposedText = "",
  operation = "append",
  allowReplace = false,
} = {}) {
  const current = normalizeDraftParagraph(currentDescription);
  const proposed = normalizeDraftParagraph(cleanDescriptionDraftForCoverage(proposedText));
  const requestedOperation = ["replace", "prepend", "append"].includes(operation) ? operation : "append";
  if (!proposed) return buildEmptyDescriptionCoveragePlan("No proposed text was generated.");
  if (!current) {
    return {
      shouldRecommend: true,
      draftText: proposed,
      operation: allowReplace && requestedOperation === "replace" ? "replace" : requestedOperation,
      coverage: { currentCoverage: "none", extractedMissingOnly: false },
    };
  }

  const appended = getAppendedDescriptionText(current, proposed);
  if (appended && !isTextCoveredByCurrentContent(appended, current)) {
    return {
      shouldRecommend: true,
      draftText: appended,
      operation: "append",
      coverage: { currentCoverage: "partial", extractedMissingOnly: true },
    };
  }

  if (isTextCoveredByCurrentContent(proposed, current)) {
    return buildEmptyDescriptionCoveragePlan("Current product copy already covers the proposed text.");
  }

  const units = splitDraftIntoCoverageUnits(proposed);
  const missingUnits = units.filter((unit) => !isTextCoveredByCurrentContent(unit, current));
  if (missingUnits.length && missingUnits.length < units.length) {
    const draftText = missingUnits.join("\n\n").trim();
    return {
      shouldRecommend: Boolean(draftText),
      draftText,
      operation: requestedOperation === "prepend" ? "prepend" : "append",
      coverage: {
        currentCoverage: "partial",
        extractedMissingOnly: true,
        originalUnitCount: units.length,
        missingUnitCount: missingUnits.length,
      },
    };
  }

  if (requestedOperation === "replace" && allowReplace) {
    return {
      shouldRecommend: true,
      draftText: proposed,
      operation: "replace",
      coverage: { currentCoverage: "low", extractedMissingOnly: false },
    };
  }

  return {
    shouldRecommend: true,
    draftText: proposed,
    operation: requestedOperation === "replace" ? "append" : requestedOperation,
    coverage: { currentCoverage: "low", extractedMissingOnly: false },
  };
}

function splitDraftIntoCoverageUnits(value = "") {
  const text = normalizeDraftParagraph(value);
  if (!text) return [];
  return text
    .split(/\n{2,}/)
    .flatMap((paragraph) => {
      const trimmed = paragraph.trim();
      if (!trimmed) return [];
      const lines = trimmed.split(/\n/).map((line) => line.trim()).filter(Boolean);
      if (lines.length > 1) return lines.flatMap(splitDescriptionCoverageSentences);
      return splitDescriptionCoverageSentences(trimmed);
    })
    .map(cleanDescriptionDraftUnitForCoverage)
    .filter((unit) => !isInstructionalDescriptionDraft(unit))
    .filter((unit) => meaningfulTokens(unit).length >= 2 || unit.length >= 18);
}

function isTextCoveredByCurrentContent(proposedText = "", currentText = "", { minTokenCoverage = 0.8 } = {}) {
  const proposed = normalizeDraftParagraph(proposedText);
  const current = normalizeDraftParagraph(currentText);
  if (!proposed || !current) return false;
  const normalizedProposed = normalizeText(proposed);
  const normalizedCurrent = normalizeText(current);
  if (!normalizedProposed || !normalizedCurrent) return false;
  if (hasSpecificNewVariantOrOptionDetail(proposed, current)) return false;
  if (normalizedCurrent.includes(normalizedProposed)) return true;
  if (isExpectationGuidanceCoveredByCurrentContent(proposed, current)) return true;
  if (isCoveredFitOrCareGuidance(normalizedProposed, normalizedCurrent) && tokenCoverage(proposed, current) >= 0.45) return true;
  if (hasSubstantialOverlap(current, proposed)) return true;
  return tokenCoverage(proposed, current) >= minTokenCoverage;
}

function isExpectationGuidanceCoveredByCurrentContent(proposedText = "", currentText = "") {
  const proposedTopics = getExpectationGuidanceTopics(proposedText);
  if (!proposedTopics.size) return false;
  const currentTopics = getExpectationGuidanceTopics(currentText);
  return [...proposedTopics].every((topic) => currentTopics.has(topic));
}

function getExpectationGuidanceTopics(value = "") {
  const text = normalizeText(value);
  const topics = new Set();
  if (!text) return topics;
  if (/\b(adhesive|mount|mounting|surface|surfaces|clamp|clamps|oiled|textured|porous|sealed|cure|warm underside|shelf underside)\b/.test(text)) {
    topics.add("mounting_surface");
  }
  if (/\b(cable|left side|right side|left|right|routing|route|flip|flipping|control button|hub|outlet|usb c|usb-c)\b/.test(text)) {
    topics.add("cable_routing");
  }
  if (/\b(camera|webcam|video call|video calls|banding|bands|flicker|pulse|shutter|key light|studio light)\b/.test(text)) {
    topics.add("camera_flicker");
  }
  if (/\b(adapter|wall adapter|wall brick|power adapter|not included|box includes|included in the box|usb c cable|usb-c cable)\b/.test(text)) {
    topics.add("included_power_adapter");
  }
  if (/\b(glossy|reflection|reflect|glare|glass|monitor)\b/.test(text)) {
    topics.add("glare_reflection");
  }
  if (/\b(indoor|outdoor|waterproof|damp|wet|humidity)\b/.test(text)) {
    topics.add("environment_limits");
  }
  return topics;
}

function tokenCoverage(needleText = "", haystackText = "") {
  const needleTokens = meaningfulTokens(needleText);
  if (!needleTokens.length) return 0;
  const haystackTokens = new Set(meaningfulTokens(haystackText));
  if (!haystackTokens.size) return 0;
  const shared = needleTokens.filter((token) => haystackTokens.has(token)).length;
  return shared / needleTokens.length;
}

function splitDescriptionCoverageSentences(value = "") {
  return String(value || "")
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isCoveredFitOrCareGuidance(normalizedProposed = "", normalizedCurrent = "") {
  const proposesSizingGuidance = /\b(between sizes|size up|sizing up|roomier|extra room|snug|tight|fit)\b/.test(normalizedProposed);
  const currentHasSizingGuidance = /\b(between sizes|size up|sizing up|roomier|extra room|snug|tight|fit|size chart|measurements)\b/.test(normalizedCurrent);
  if (proposesSizingGuidance && currentHasSizingGuidance) return true;
  const proposesCareGuidance = /\b(wash|washing|washed|care instructions|hang dry|tighter after washing)\b/.test(normalizedProposed);
  const currentHasCareGuidance = /\b(wash|washing|washed|care instructions|hang dry|tighter after washing|tighter feel after washing)\b/.test(normalizedCurrent);
  return proposesCareGuidance && currentHasCareGuidance;
}

function cleanDescriptionDraftForCoverage(value = "") {
  return normalizeDraftParagraph(value)
    .split(/\n+/)
    .map(cleanDescriptionDraftUnitForCoverage)
    .filter(Boolean)
    .join("\n");
}

function cleanDescriptionDraftUnitForCoverage(value = "") {
  return String(value || "")
    .replace(/^\s*(fit note|product note|important note|note)\s*\([^)]*\)\s*:\s*/i, "")
    .replace(/^\s*(please\s+)?(add|insert|place)\s+[^:]{0,120}:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasSpecificNewVariantOrOptionDetail(proposedText = "", currentText = "") {
  const proposedTokens = new Set(meaningfulTokens(proposedText));
  const currentTokens = new Set(meaningfulTokens(currentText));
  const specificTokens = [
    "white", "black", "blue", "navy", "green", "red", "pink", "purple", "yellow", "brown", "gray", "grey", "beige", "cream", "orange",
    "xs", "small", "medium", "large", "xl", "xxl", "petite", "tall", "wide", "narrow",
  ];
  return specificTokens.some((token) => proposedTokens.has(token) && !currentTokens.has(token));
}

function normalizeDraftParagraph(value) {
  return String(value || "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function hasSubstantialOverlap(firstValue, secondValue) {
  const first = normalizeText(firstValue);
  const second = normalizeText(secondValue);
  if (!first || !second) return false;
  if (first.includes(second) || second.includes(first)) return true;
  const firstTokens = new Set(first.split(/\s+/).filter((token) => token.length > 4));
  const secondTokens = second.split(/\s+/).filter((token) => token.length > 4);
  if (!firstTokens.size || !secondTokens.length) return false;
  const shared = secondTokens.filter((token) => firstTokens.has(token)).length;
  return shared / Math.max(secondTokens.length, 1) >= 0.72;
}

function getSeverityLabel(score) {
  if (score >= 75) return "High";
  if (score >= 55) return "Medium";
  return "Low";
}

function getRiskToneFromSeverity(severity, score) {
  const normalized = String(severity || "").toLowerCase();
  if (normalized.includes("high") || normalized.includes("critical")) return "critical";
  if (normalized.includes("medium") || normalized.includes("moderate")) return "warning";
  if (normalized.includes("low")) return "success";
  if (score >= 75) return "critical";
  if (score >= 55) return "warning";
  return "success";
}

function getTrendTone(values, fallbackScore = 0) {
  const trendValues = (Array.isArray(values) ? values : []).map(Number).filter((value) => Number.isFinite(value));
  if (trendValues.length >= 2) {
    const first = trendValues[0];
    const last = trendValues[trendValues.length - 1];
    if (last > first) return "red";
    if (last < first) return "green";
  }
  if (fallbackScore >= 75) return "red";
  if (fallbackScore >= 55) return "orange";
  return "green";
}

function containsIssueLanguage(text) {
  const normalized = maskResolvedNegativeCustomerLanguage(normalizeText(text));
  return /(too small|too large|doesn.?t fit|does not fit|didn.?t fit|not fit|wrong size|runs small|runs large|broken|break|broke|poor quality|defect|defective|thin|softness|not soft|rough|scratchy|stiff|wrong color|different color|color mismatch|not as pictured|looks different|leak|leaking|spill|spilled|crack|cracked|chip|chipped|damaged|damage|unsafe|danger|hazard|not compatible|incompatible|late|delayed|lost|disappointed|return|refund|not worth|wobbly|unstable|confusing|unclear|missing)/i.test(normalized);
}

function containsExplicitCustomerProblemLanguage(text) {
  const normalized = maskResolvedNegativeCustomerLanguage(normalizeText(text));
  return /(too small|too large|doesn.?t fit|does not fit|didn.?t fit|not fit|wrong size|runs small|runs large|broken|break|broke|poor quality|defect|defective|not soft|rough|scratchy|stiff|wrong color|different color|color mismatch|not as pictured|looks different|leak|leaking|spill|spilled|crack|cracked|chip|chipped|damaged|damage|unsafe|danger|hazard|not compatible|incompatible|late|delayed|lost|disappointed|not worth|wobbly|unstable|confusing|unclear|misleading|doesn.?t work|does not work|failed|failure)/i.test(normalized);
}

function getNodes(connection) {
  if (Array.isArray(connection?.nodes)) return connection.nodes.filter(Boolean);
  if (Array.isArray(connection?.edges)) return connection.edges.map((edge) => edge?.node).filter(Boolean);
  if (Array.isArray(connection)) return connection.filter(Boolean);
  return [];
}

function getSinceDate(windowDays) {
  const date = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

function isShopifyOrderAccessDenied(error) {
  const message = `${error?.message || ""} ${JSON.stringify(error?.graphqlErrors || [])}`.toLowerCase();
  return message.includes("access_denied") || message.includes("not approved to access the order object") || message.includes("order object");
}

function isMissingReturnReasonDefinitionError(error) {
  const message = `${error?.message || ""} ${JSON.stringify(error?.graphqlErrors || [])}`.toLowerCase();
  return message.includes("returnreasondefinition") && message.includes("doesn") && message.includes("returnlineitem");
}

function isShopifyQueryCostLimitError(error) {
  const message = `${error?.message || ""} ${JSON.stringify(error?.graphqlErrors || [])}`.toLowerCase();
  return message.includes("query cost") && message.includes("exceeds") && message.includes("max cost");
}

function extractNumericShopifyId(gid) {
  return String(gid || "").split("/").pop() || "";
}

function escapeShopifyQueryValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function stripHtml(value) {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|li|ul|ol|h[1-6]|blockquote|tr|td|th)>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : " ";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const parsed = Number.parseInt(code, 16);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : " ";
    })
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeText(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim();
}

function capitalize(value) {
  const text = String(value || "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const __productPulseDiagnosisTestHooks = {
  buildDiagnosisSalesQuery,
  buildDiagnosisSalesOrderQuery,
  fetchShopifySalesEventBundle,
  getProductVariantSkusForOrderSearch,
  getSalesExtractionCompleteness,
  buildDiagnosisRefundsQuery,
  buildDiagnosisReturnsQuery,
  buildRefundOrderQueries,
  buildReturnOrderQueries,
  normalizeDiagnosisOrderLevelRefundLineItemEvent,
  shouldUseDiagnosisOrderLevelRefundFallback,
  getRefundOperationalText,
  getRefundReasonText,
  getRefundAdjustmentReasons,
  getReturnLineItemNoteText,
  getReturnReasonValue,
  buildTopReturnReasonDetails,
  getNodes,
  buildCustomerTextInsights,
  buildCustomerTextAnalysisItems,
  buildDiagnosisVariantInsights,
  buildOrderGeographyRows,
  buildIssueSignalCountsFromAnalysis,
  buildTemporalSignalWeighting,
  calculateDeterministicDiagnosis,
  buildAiDeterministicInput,
  buildMonthlyOrderActivity,
  buildReturnRatePrediction,
  buildProductMomentum,
  buildProductMomentumCatalogBaseline,
  buildRefundOperationalInsights,
  calculateConfidence,
  calculateRiskScore,
  calculateRiskScoreBreakdown,
  buildSignalRelevanceGuidance,
  buildFinalIssues,
  buildDiagnosisReportIssueNames,
  buildFinalRecommendations,
  hasStrongExpectationIssueEvidence,
  withAiPurchaseContextInterpretation,
  analyzeFaqOpportunity,
  buildRecommendedFaqItems,
  analyzeProductContentDeterministically,
  buildContentAnalysis,
  shouldRecommendFullDescriptionRewrite,
  getNoChangeDiagnosisReuseDecision,
  getIncrementalSourceFetchContext,
  getShopSourceEventCacheKey,
  getShopSourceEventCacheFreshness,
  buildShopSourceEventRow,
  mergeIncrementalSourceEvents,
  selectDiagnosisRelationshipSalesForSummary,
  filterDiagnosisEventsForProduct,
  backfillMissingSalesFromOperationalEvents,
  buildSourceEventCache,
  buildIncrementalSinceDate,
  buildDiagnosisSourceFingerprint,
  buildProductRelationshipCandidateSnapshotPayloads,
  buildSuggestedMetaDescription,
  buildSuggestedSeoTitle,
  buildNoChangeDiagnosisRefreshData,
  buildCachedAiModelSummary,
  buildProductDiagnosisEvolutionContextFromRecords,
  attachProductEvolutionToDeterministic,
  applyProductEvolutionToRecommendationCandidates,
  normalizeAiClassifiedSignals,
  countAiSignalsByIssue,
  classifyIssueText,
  getEvidencePreferredMainIssue,
  getReviewTextCacheKey,
  getCsvReviewMatchConfidence,
  isShopifyQueryCostLimitError,
  lineItemMatchesProduct,
  cleanProductDescription,
  buildCustomerFacingDescriptionAddendum,
  buildTargetedDescriptionEnhancementSentences,
  buildMainFindingDetail,
};

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function jsonSafe(value) {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, nestedValue]) => nestedValue !== undefined)
      .map(([key, nestedValue]) => [key, jsonSafe(nestedValue)]),
  );
}
