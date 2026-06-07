import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  getQuickScanWindowDays,
  runShopifyQuickScan,
} from "./product-pulse-quick-scan.server";
import { buildAnalyticsViewData, buildDashboardViewData } from "./product-pulse-data";
import {
  resumeDetailedProductDiagnosisFromOpenAiBatch,
  runDetailedProductDiagnosis,
} from "./product-pulse-diagnosis.server";
import { getProductDiagnosisOpenAiBatchAvailability } from "./product-pulse-ai.server";
import {
  getJobLogsForShop,
  recordJobLog,
  serializeError,
} from "./product-pulse-job-logs.server";
import { getProductRetentionPayloadForDiagnosis } from "./product-pulse-retention.server";
import {
  PRODUCT_PULSE_SETTINGS_SOURCE_KEY,
  PRODUCT_PULSE_BATCH_MODE_COOLDOWN_HOURS,
  PRODUCT_PULSE_BATCH_MODE_COOLDOWN_MS,
  getProductPulseSettings,
  getProductPulseBatchModeSummary,
  getRiskFilterValueForScore,
  getRiskLabelForScore,
  getRiskToneForScore,
  getStatusFilterValueForScore,
  getStatusLabelForScore,
  normalizeProductPulseSettings,
  withProductPulseBatchModeSummary,
} from "./product-pulse-settings.server";
import {
  PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS,
  getProductPulseHtmlStylePreset,
  getProductPulseHtmlStyleTemplate,
  normalizeProductPulseHtmlStyle,
} from "./product-pulse-html-style-presets";
import {
  filterDisabledProductActions,
  isDisabledProductAction,
} from "./product-pulse-disabled-actions";
import {
  getProductScoreHistoryForProductsForShop,
  getProductScoreHistoryForShop,
} from "./product-pulse-history.server";
import {
  getProductTimelineForShop,
  recordTimelineForProductAction,
} from "./product-pulse-timeline.server";
import { addWatchedProductForShop } from "./product-pulse-watchlist.server";
import {
  SHOPIFY_MOCK_DATASET_KIND,
  SHOPIFY_MOCK_DATASET_EXPECTED_ORDER_COUNTS,
  SHOPIFY_MOCK_DATASET_CUSTOMER_COUNT,
  SHOPIFY_MOCK_DATASET_PRODUCT_COUNT,
  SHOPIFY_MOCK_DATASET_STAGE_LABELS,
  getMissingShopifyMockDatasetScopes,
  normalizeShopifyMockDatasetStage,
  runShopifyMockDatasetJob,
} from "./product-pulse-shopify-mock-dataset.server";
import {
  creditStorePointsForShop,
  debitStorePointsForShop,
  getStorePointSummaryForShop,
  lockStorePointLedgerForShop,
  validateStorePointsForShop,
} from "./product-pulse-points.server";
import { measureProductPulseStep } from "./product-pulse-perf.server";
import {
  invalidateProductPulseBackgroundProcessCache,
  invalidateProductPulseDashboardAndAnalyticsCache,
  invalidateProductPulseJobMonitorCache,
  normalizeProductPulseShopCacheKey,
} from "./product-pulse-cache.server";
import { getProductPulseResourceConfig } from "./product-pulse-resource-config.server";
import { maybeSendWatchlistRunAlertForJob } from "./product-pulse-watchlist-alerts.server";
import {
  getProductPulseProductRollupMetricsForProducts,
  getProductPulseProductRollupSnapshotRowsForShop,
  upsertProductPulseProductRollup,
} from "./product-pulse-product-rollup.server";
import {
  claimOpenAiBatchGroupForResume,
  markOpenAiBatchGroupProcessed,
  markOpenAiBatchGroupResumeFailed,
  processOpenAiBatchWebhookEvent,
} from "./product-pulse-openai-batch.server";

const FAST_PRODUCT_SCAN_KIND = "fast-product-scan";
const PRODUCT_DIAGNOSIS_KIND = "product-diagnosis";
const PRODUCT_DIAGNOSIS_QUEUE_WORKER_KEY = "global-product-diagnosis-queue";
const PRODUCT_RISK_NAVIGATION_SELECT = {
  shop: true,
  productGid: true,
  productTitle: true,
  handle: true,
  riskScore: true,
};
const STALE_JOB_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const STALE_JOB_SWEEP_INTERVAL_MS = 60 * 1000;
const JOB_MONITOR_RECENT_JOB_LIMIT = 6;
const BACKGROUND_PROCESS_LOG_LIMIT = 1000;
const BACKGROUND_PROCESS_PAGE_SIZE = 10;
const SHOPIFY_DASHBOARD_COUNT_TIMEOUT_MS = 3 * 1000;
const SHOPIFY_CATALOG_PRODUCT_COUNT_CACHE_SOURCE_KEY = "__productpulse_shopify_catalog_count";
const SHOPIFY_CATALOG_PRODUCT_COUNT_CACHE_TTL_MS = getBoundedIntegerEnv("PRODUCT_PULSE_SHOPIFY_CATALOG_COUNT_CACHE_TTL_MS", 6 * 60 * 60 * 1000, { min: 60 * 1000, max: 7 * 24 * 60 * 60 * 1000 });
const SHOPIFY_PRODUCT_IMAGE_TIMEOUT_MS = 4 * 1000;
const DASHBOARD_CACHE_TTL_MS = getBoundedIntegerEnv("PRODUCT_PULSE_DASHBOARD_CACHE_TTL_MS", 15 * 1000, { min: 0, max: 5 * 60 * 1000 });
const DASHBOARD_ACTIVE_JOB_CACHE_TTL_MS = getBoundedIntegerEnv("PRODUCT_PULSE_DASHBOARD_ACTIVE_JOB_CACHE_TTL_MS", 5 * 1000, { min: 0, max: 60 * 1000 });
const DASHBOARD_CACHE_MAX_SHOPS = getBoundedIntegerEnv("PRODUCT_PULSE_DASHBOARD_CACHE_MAX_SHOPS", 25, { min: 1, max: 200 });
const ANALYTICS_CACHE_TTL_MS = getBoundedIntegerEnv("PRODUCT_PULSE_ANALYTICS_CACHE_TTL_MS", 60 * 1000, { min: 0, max: 10 * 60 * 1000 });
const ANALYTICS_ACTIVE_JOB_CACHE_TTL_MS = getBoundedIntegerEnv("PRODUCT_PULSE_ANALYTICS_ACTIVE_JOB_CACHE_TTL_MS", 10 * 1000, { min: 0, max: 60 * 1000 });
const ANALYTICS_CACHE_MAX_SHOPS = getBoundedIntegerEnv("PRODUCT_PULSE_ANALYTICS_CACHE_MAX_SHOPS", 25, { min: 1, max: 200 });
const JOB_MONITOR_CACHE_TTL_MS = getBoundedIntegerEnv("PRODUCT_PULSE_JOB_MONITOR_CACHE_TTL_MS", 10 * 1000, { min: 0, max: 60 * 1000 });
const JOB_MONITOR_CACHE_MAX_SHOPS = getBoundedIntegerEnv("PRODUCT_PULSE_JOB_MONITOR_CACHE_MAX_SHOPS", 50, { min: 1, max: 200 });
const JOB_MONITOR_ACTIVE_JOB_LIMIT = getBoundedIntegerEnv("PRODUCT_PULSE_JOB_MONITOR_ACTIVE_JOB_LIMIT", 20, { min: 1, max: 100 });
const BACKGROUND_PROCESS_CACHE_TTL_MS = getBoundedIntegerEnv("PRODUCT_PULSE_BACKGROUND_PROCESS_CACHE_TTL_MS", 10 * 1000, { min: 0, max: 60 * 1000 });
const BACKGROUND_PROCESS_CACHE_MAX_ENTRIES = getBoundedIntegerEnv("PRODUCT_PULSE_BACKGROUND_PROCESS_CACHE_MAX_ENTRIES", 80, { min: 5, max: 500 });
const ANALYTICS_RETROACTIVE_HISTORY_DAYS = 365;
const ANALYTICS_SCORE_HISTORY_TAKE = 520;
const ANALYTICS_HISTORY_BASELINE_BUFFER_DAYS = 7;
const SEO_TITLE_MAX_LENGTH = 70;
const SEO_META_DESCRIPTION_MAX_LENGTH = 160;
const JOB_WORKER_OWNER_ID = `${process.env.HOSTNAME || "local"}:${process.pid}:${randomUUID()}`;
const PRODUCT_RISK_SNAPSHOT_LIST_METRIC_KEYS = [
  "reviewRating",
  "avgRating",
  "reviewCount",
  "negativeReviewCount",
  "negativeReviewRate",
  "recentNegativeReviewCount",
  "positiveReviewCount",
  "returnRate",
  "refundRate",
  "returnUnits",
  "refundUnits",
  "recentSignalUnits",
  "windowDays",
  "soldUnits",
  "storeAvgReturnRate",
  "storeAvgRefundRate",
  "lastSignalAt",
  "signalCount",
  "signalsCount",
  "issueCount",
  "revenueAtRisk",
  "estimatedImpact",
  "financialExposure",
  "marginAtRisk",
  "salesAmount",
  "avgUnitRevenue",
  "refundAmount",
  "latestDiagnosisId",
  "lastDetailedDiagnosisAt",
  "productType",
  "vendor",
  "tags",
  "collections",
  "topReturnReasons",
  "topReturnReasonDetails",
  "topRefundReasons",
  "topRefundReasonDetails",
  "affectedVariants",
  "affectedVariantDetails",
  "variantCount",
  "skuCount",
  "optionNames",
  "signalTrend",
  "riskTrend",
  "productMomentum",
  "productMomentumScore",
  "productMomentumTier",
  "momentumDirection",
  "momentumConfidence",
  "momentumConfidenceLabel",
  "returnRefundRelationshipSummary",
  "financialExposureBreakdown",
  "returnPressure",
  "refundLeakage",
  "customerSignalBreakdown",
  "contentQualityScore",
  "contentQualityRisk",
  "contentIssueCount",
  "contentAdvisoryCount",
  "mediaCount",
  "mediaWithoutAltCount",
  "descriptionWordCount",
  "descriptionLength",
  "hasDescription",
  "titleNeedsReview",
  "variantNamingAdvisory",
  "orderAccessDenied",
  "csvAverageRating",
  "judgeMeAverageRating",
  "judgeMeReviewCount",
  "judgeMeNegativeReviewCount",
  "csvReviewCount",
  "csvNegativeReviewCount",
  "productPurchaseContextSummary",
  "productRelationshipIntelligenceSummary",
  "productRetentionSummary",
];
const PRODUCT_RISK_SNAPSHOT_LIST_METRIC_CHUNK_SIZE = 40;
const DASHBOARD_SNAPSHOT_METRIC_KEYS = [
  "reviewCount",
  "negativeReviewCount",
  "returnRate",
  "refundRate",
  "returnUnits",
  "refundUnits",
  "recentSignalUnits",
  "windowDays",
  "soldUnits",
  "storeAvgReturnRate",
  "storeAvgRefundRate",
  "signalCount",
  "signalsCount",
  "issueCount",
  "revenueAtRisk",
  "estimatedImpact",
  "marginAtRisk",
  "refundAmount",
  "latestDiagnosisId",
  "lastDetailedDiagnosisAt",
  "productMomentumScore",
  "productMomentumTier",
  "momentumDirection",
  "momentumConfidence",
  "momentumConfidenceLabel",
  "imageUrl",
  "productImageUrl",
  "featuredImageUrl",
  "imageAlt",
  "productImageAlt",
  "featuredImageAlt",
];
const ANALYTICS_SNAPSHOT_METRIC_KEYS = [
  "reviewRating",
  "avgRating",
  "reviewCount",
  "negativeReviewCount",
  "negativeReviewRate",
  "recentNegativeReviewCount",
  "returnRate",
  "refundRate",
  "returnUnits",
  "refundUnits",
  "recentSignalUnits",
  "windowDays",
  "soldUnits",
  "soldOrders",
  "storeAvgReturnRate",
  "storeAvgRefundRate",
  "lastSignalAt",
  "signalCount",
  "signalsCount",
  "issueCount",
  "revenueAtRisk",
  "estimatedImpact",
  "marginAtRisk",
  "salesAmount",
  "avgUnitRevenue",
  "refundAmount",
  "latestDiagnosisId",
  "lastDetailedDiagnosisAt",
  "productType",
  "vendor",
  "tags",
  "collections",
  "topReturnReasons",
  "affectedVariants",
  "signalTrend",
  "riskTrend",
  "contentIssueCount",
  "descriptionWords",
  "descriptionWordCount",
  "csvReviewCount",
  "csvReviewRatingCount",
  "csvNegativeReviewCount",
  "csvAverageRating",
  "judgeMeReviewCount",
  "judgeMeNegativeReviewCount",
  "judgeMeAverageRating",
  "yotpoReviewCount",
  "looxReviewCount",
  "customerTextSignals",
  "marginRate",
  "impactFactors",
  "estimatedImpactFactors",
];
const SCORE_HISTORY_ANALYTICS_METRIC_KEYS = [
  "returnRate",
  "refundRate",
  "negativeReviewRate",
  "marginAtRisk",
  "revenueAtRisk",
  "financialExposure",
  "salesAmount",
  "refundAmount",
  "soldUnits",
  "returnUnits",
  "refundUnits",
  "reviewCount",
  "negativeReviewCount",
  "avgRating",
  "reviewRating",
  "csvAverageRating",
  "customerSignalCount",
  "evidenceStrengthScore",
  "retentionHealthScore",
  "productMomentumScore",
];
const PRODUCT_TABLE_ROW_METRIC_KEYS = [
  "signalCount",
  "signalsCount",
  "issueCount",
  "latestDiagnosisId",
  "lastDetailedDiagnosisAt",
  "riskTrend",
  "productMomentum",
  "productMomentumScore",
  "productMomentumTier",
  "momentumDirection",
  "momentumConfidence",
  "momentumConfidenceLabel",
  "imageUrl",
  "productImageUrl",
  "featuredImageUrl",
  "imageAlt",
  "productImageAlt",
  "featuredImageAlt",
];
const activeWorkers = global.productPulseJobWorkers || new Set();
const activeDiagnosisQueueWorkers = global.productPulseDiagnosisQueueWorkers || new Set();
const activeMockDatasetWorkers = global.productPulseMockDatasetWorkers || new Set();
const inlineWorkerSkipLogKeys = global.productPulseInlineWorkerSkipLogKeys || new Set();
const staleFastProductScanSweeps = global.productPulseStaleFastProductScanSweeps || new Map();
const dashboardCache = global.productPulseDashboardCache || new Map();
const analyticsCache = global.productPulseAnalyticsCache || new Map();
const jobMonitorCache = global.productPulseJobMonitorCache || new Map();
const backgroundProcessCache = global.productPulseBackgroundProcessCache || new Map();

if (!global.productPulseJobWorkers) {
  global.productPulseJobWorkers = activeWorkers;
}

if (!global.productPulseStaleFastProductScanSweeps) {
  global.productPulseStaleFastProductScanSweeps = staleFastProductScanSweeps;
}

if (!global.productPulseDashboardCache) {
  global.productPulseDashboardCache = dashboardCache;
}

if (!global.productPulseAnalyticsCache) {
  global.productPulseAnalyticsCache = analyticsCache;
}

if (!global.productPulseJobMonitorCache) {
  global.productPulseJobMonitorCache = jobMonitorCache;
}

if (!global.productPulseBackgroundProcessCache) {
  global.productPulseBackgroundProcessCache = backgroundProcessCache;
}

if (!global.productPulseDiagnosisQueueWorkers) {
  global.productPulseDiagnosisQueueWorkers = activeDiagnosisQueueWorkers;
}

if (!global.productPulseMockDatasetWorkers) {
  global.productPulseMockDatasetWorkers = activeMockDatasetWorkers;
}

if (!global.productPulseInlineWorkerSkipLogKeys) {
  global.productPulseInlineWorkerSkipLogKeys = inlineWorkerSkipLogKeys;
}

function getBoundedIntegerEnv(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const value = Number.parseInt(process.env[name] || "", 10);
  const normalized = Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, normalized));
}

function getCachedProductPulseDashboard(shop, options = {}) {
  if (options.forceRefresh || DASHBOARD_CACHE_TTL_MS <= 0) return null;
  const key = normalizeDashboardCacheKey(shop);
  if (!key) return null;
  const entry = dashboardCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    dashboardCache.delete(key);
    return null;
  }
  return entry.dashboard;
}

function setCachedProductPulseDashboard(shop, dashboard, { activeJob = null, activeDiagnosisJobs = [] } = {}) {
  if (DASHBOARD_CACHE_TTL_MS <= 0 || !dashboard) return;
  const key = normalizeDashboardCacheKey(shop);
  if (!key) return;
  const hasActiveJob = Boolean(activeJob) || (Array.isArray(activeDiagnosisJobs) && activeDiagnosisJobs.length > 0);
  const ttlMs = hasActiveJob && DASHBOARD_ACTIVE_JOB_CACHE_TTL_MS > 0
    ? Math.min(DASHBOARD_CACHE_TTL_MS, DASHBOARD_ACTIVE_JOB_CACHE_TTL_MS)
    : DASHBOARD_CACHE_TTL_MS;
  if (ttlMs <= 0) return;
  while (dashboardCache.size >= DASHBOARD_CACHE_MAX_SHOPS) {
    const oldestKey = dashboardCache.keys().next().value;
    if (!oldestKey) break;
    dashboardCache.delete(oldestKey);
  }
  dashboardCache.set(key, {
    dashboard,
    expiresAt: Date.now() + ttlMs,
  });
}

export function invalidateProductPulseDashboardCache(shop) {
  invalidateProductPulseDashboardAndAnalyticsCache(shop);
}

function getCachedProductPulseAnalytics(shop, options = {}) {
  if (options.forceRefresh || ANALYTICS_CACHE_TTL_MS <= 0) return null;
  const key = normalizeDashboardCacheKey(shop);
  if (!key) return null;
  const entry = analyticsCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    analyticsCache.delete(key);
    return null;
  }
  return entry.analytics;
}

function setCachedProductPulseAnalytics(shop, analytics, { activeJob = null, activeDiagnosisJobs = [] } = {}) {
  if (ANALYTICS_CACHE_TTL_MS <= 0 || !analytics) return;
  const key = normalizeDashboardCacheKey(shop);
  if (!key) return;
  const hasActiveJob = Boolean(activeJob) || (Array.isArray(activeDiagnosisJobs) && activeDiagnosisJobs.length > 0);
  const ttlMs = hasActiveJob && ANALYTICS_ACTIVE_JOB_CACHE_TTL_MS > 0
    ? Math.min(ANALYTICS_CACHE_TTL_MS, ANALYTICS_ACTIVE_JOB_CACHE_TTL_MS)
    : ANALYTICS_CACHE_TTL_MS;
  if (ttlMs <= 0) return;
  while (analyticsCache.size >= ANALYTICS_CACHE_MAX_SHOPS) {
    const oldestKey = analyticsCache.keys().next().value;
    if (!oldestKey) break;
    analyticsCache.delete(oldestKey);
  }
  analyticsCache.set(key, {
    analytics,
    expiresAt: Date.now() + ttlMs,
  });
}

function getCachedJobMonitor(shop, options = {}) {
  if (options.forceRefresh || JOB_MONITOR_CACHE_TTL_MS <= 0) return null;
  const key = getJobMonitorCacheKey(shop, options);
  if (!key) return null;
  const entry = jobMonitorCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    jobMonitorCache.delete(key);
    return null;
  }
  return entry.monitor;
}

function setCachedJobMonitor(shop, monitor, options = {}) {
  if (JOB_MONITOR_CACHE_TTL_MS <= 0 || !monitor) return;
  const key = getJobMonitorCacheKey(shop, options);
  if (!key) return;
  while (jobMonitorCache.size >= JOB_MONITOR_CACHE_MAX_SHOPS) {
    const oldestKey = jobMonitorCache.keys().next().value;
    if (!oldestKey) break;
    jobMonitorCache.delete(oldestKey);
  }
  jobMonitorCache.set(key, {
    monitor,
    expiresAt: Date.now() + JOB_MONITOR_CACHE_TTL_MS,
  });
}

function invalidateJobMonitorCache(shop) {
  invalidateProductPulseJobMonitorCache(shop);
}

function getJobMonitorCacheKey(shop, options = {}) {
  const key = normalizeDashboardCacheKey(shop);
  if (!key) return "";
  const recentMode = options.includeRecentJobs ? "recent" : "active";
  const logsMode = options.includeLogs ? "full" : "summary";
  const pointMode = options.includePointSummary === false ? "no-points" : "points";
  return `${key}:${recentMode}:${logsMode}:${pointMode}`;
}

function getCachedBackgroundProcesses(shop, options = {}) {
  if (options.forceRefresh || BACKGROUND_PROCESS_CACHE_TTL_MS <= 0) return null;
  const key = getBackgroundProcessCacheKey(shop, options);
  if (!key) return null;
  const entry = backgroundProcessCache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    backgroundProcessCache.delete(key);
    return null;
  }
  return entry.backgroundProcesses;
}

function setCachedBackgroundProcesses(shop, backgroundProcesses, options = {}) {
  if (BACKGROUND_PROCESS_CACHE_TTL_MS <= 0 || !backgroundProcesses) return;
  const key = getBackgroundProcessCacheKey(shop, options);
  if (!key) return;
  while (backgroundProcessCache.size >= BACKGROUND_PROCESS_CACHE_MAX_ENTRIES) {
    const oldestKey = backgroundProcessCache.keys().next().value;
    if (!oldestKey) break;
    backgroundProcessCache.delete(oldestKey);
  }
  backgroundProcessCache.set(key, {
    backgroundProcesses,
    expiresAt: Date.now() + BACKGROUND_PROCESS_CACHE_TTL_MS,
  });
}

function invalidateBackgroundProcessCache(shop) {
  invalidateProductPulseBackgroundProcessCache(shop);
}

function getBackgroundProcessCacheKey(shop, options = {}) {
  const key = normalizeDashboardCacheKey(shop);
  if (!key) return "";
  const page = normalizeBackgroundProcessPage(options.page);
  const logsMode = options.includeLogs ? "logs" : "no-logs";
  return `${key}:page-${page}:${logsMode}`;
}

function normalizeDashboardCacheKey(shop) {
  return normalizeProductPulseShopCacheKey(shop);
}

export async function startFastProductScan(input, adminArg, scopesArg) {
  const { shop, admin, scopes } = normalizeStartArgs(input, adminArg, scopesArg);
  await failStaleFastProductScans(shop);

  const activeJob = await getActiveFastProductScan(shop);
  if (activeJob) {
    logProductPulseWorkerProgress("quick_scan.start.reused_active_job", { job: activeJob }, {
      inlineWorkersEnabled: getProductPulseResourceConfig().inlineWorkersEnabled,
      status: activeJob.status,
      source: activeJob.source,
    });
    ensureFastProductScanWorker(activeJob, { admin, scopes });
    await recordJobLog({
      shop,
      jobId: activeJob.id,
      event: "quick_scan.already_running",
      message: "Catalog Scan request reused the active background job.",
      data: { status: activeJob.status, source: activeJob.source },
    });
    return {
      status: "success",
      suppressBanner: true,
      message: "Catalog Scan is already running.",
      job: formatJob(activeJob),
    };
  }

  const settings = await getProductPulseSettings(shop);
  const windowDays = getQuickScanWindowDays(settings, scopes);
  const queuedAt = new Date();
  const job = await prisma.catalogSignalJob.create({
    data: {
      shop,
      kind: FAST_PRODUCT_SCAN_KIND,
      source: `Queued Shopify Catalog Scan - ${windowDays}-day order window`,
      status: "Queued",
      progress: 0,
      priority: 20,
      startedAt: queuedAt,
      payload: {
        pointCost: 0,
        creditCost: 0,
        pointsConsumed: 0,
        creditsConsumed: 0,
        pointDebitStatus: "not_charged",
        queuedAt: queuedAt.toISOString(),
      },
    },
  });
  logProductPulseWorkerProgress("quick_scan.start.job_created", { job }, {
    windowDays,
    inlineWorkersEnabled: getProductPulseResourceConfig().inlineWorkersEnabled,
    source: job.source,
    status: job.status,
  });

  ensureFastProductScanWorker(job, { admin, scopes });
  logProductPulseWorkerProgress("quick_scan.start.job_queued", { job }, {
    windowDays,
    inlineWorkersEnabled: getProductPulseResourceConfig().inlineWorkersEnabled,
    pointDebitStatus: "not_charged",
    workerMode: getProductPulseResourceConfig().inlineWorkersEnabled ? "inline" : "external-worker-required",
  });
  await recordJobLog({
    shop,
    jobId: job.id,
    event: "quick_scan.queued",
    message: "Catalog Scan queued as a persistent background job.",
    data: {
      windowDays,
      scopeMode: "configured_analysis_lookback",
      pointsConsumed: 0,
      pointLedgerEntryId: null,
      pointDebitStatus: "not_charged",
    },
  });

  invalidateProductPulseDashboardCache(shop);
  return {
    status: "success",
    suppressBanner: true,
    message: "Catalog Scan started. ProductPulse is checking native Shopify product, order, refund and return signals.",
    invalidateDashboardCache: true,
    job: formatJob(job),
  };
}

export async function startShopifyMockDataset(input, adminArg, scopesArg) {
  const { shop, admin, scopes } = normalizeStartArgs(input, adminArg, scopesArg);
  const stage = normalizeShopifyMockDatasetStage(typeof input === "object" ? input.stage : null);
  const missingScopes = getMissingShopifyMockDatasetScopes(scopes);
  if (missingScopes.length) {
    return {
      status: "validation_error",
      message: `Shopify mock dataset generation needs these scopes before it can create products, customers, orders, returns and refunds: ${missingScopes.join(", ")}. Reauthorize the app after updating Shopify app scopes.`,
      missingScopes,
    };
  }

  const activeJob = await getActiveShopifyMockDatasetJob(shop);
  if (activeJob) {
    ensureShopifyMockDatasetWorker(activeJob, { admin, scopes });
    await recordJobLog({
      shop,
      jobId: activeJob.id,
      event: "mock_dataset.already_running",
      message: "Mock dataset request reused the active background job.",
      data: { status: activeJob.status, source: activeJob.source },
    });
    return {
      status: "success",
      suppressBanner: true,
      message: "A Shopify mock dataset job is already running.",
      job: formatJob(activeJob),
    };
  }

  const queuedAt = new Date();
  const job = await prisma.catalogSignalJob.create({
    data: {
      shop,
      kind: SHOPIFY_MOCK_DATASET_KIND,
      source: "Queued Shopify mock dataset generation",
      status: "Queued",
      progress: 0,
      priority: 200,
      startedAt: queuedAt,
      payload: {
        queuedAt: queuedAt.toISOString(),
        stage,
        stageLabel: SHOPIFY_MOCK_DATASET_STAGE_LABELS[stage],
        expectedProducts: SHOPIFY_MOCK_DATASET_PRODUCT_COUNT,
        expectedCustomers: SHOPIFY_MOCK_DATASET_CUSTOMER_COUNT,
        expectedOrders: SHOPIFY_MOCK_DATASET_EXPECTED_ORDER_COUNTS[stage] ?? SHOPIFY_MOCK_DATASET_EXPECTED_ORDER_COUNTS.all,
      },
    },
  });

  ensureShopifyMockDatasetWorker(job, { admin, scopes, stage });
  await recordJobLog({
    shop,
    jobId: job.id,
    event: "mock_dataset.queued",
    message: `Shopify mock dataset stage queued: ${SHOPIFY_MOCK_DATASET_STAGE_LABELS[stage]}.`,
    data: {
      stage,
      expectedProducts: SHOPIFY_MOCK_DATASET_PRODUCT_COUNT,
      expectedCustomers: SHOPIFY_MOCK_DATASET_CUSTOMER_COUNT,
      expectedOrders: SHOPIFY_MOCK_DATASET_EXPECTED_ORDER_COUNTS[stage] ?? SHOPIFY_MOCK_DATASET_EXPECTED_ORDER_COUNTS.all,
    },
  });

  return {
    status: "success",
    suppressBanner: true,
    message: `Mock dataset stage started: ${SHOPIFY_MOCK_DATASET_STAGE_LABELS[stage]}.`,
    job: formatJob(job),
  };
}

function buildProductRiskSnapshotListMetricsSql() {
  const flatMetricObjects = [];
  for (let index = 0; index < PRODUCT_RISK_SNAPSHOT_LIST_METRIC_KEYS.length; index += PRODUCT_RISK_SNAPSHOT_LIST_METRIC_CHUNK_SIZE) {
    flatMetricObjects.push(buildProductRiskSnapshotMetricChunkSql(
      PRODUCT_RISK_SNAPSHOT_LIST_METRIC_KEYS.slice(index, index + PRODUCT_RISK_SNAPSHOT_LIST_METRIC_CHUNK_SIZE),
    ));
  }
  const flatMetricsSql = joinJsonbObjectsSql(flatMetricObjects);
  const nestedMetricsSql = Prisma.sql`jsonb_build_object(
    'monthlyOrderActivity',
    CASE
      WHEN jsonb_typeof(metrics_json -> 'monthlyOrderActivity') = 'object'
      THEN jsonb_strip_nulls(jsonb_build_object('summary', metrics_json #> '{monthlyOrderActivity,summary}'))
      ELSE NULL
    END,
    'textInsights',
    CASE
      WHEN jsonb_typeof(metrics_json -> 'textInsights') = 'object'
      THEN jsonb_strip_nulls(jsonb_build_object(
        'sentiment', metrics_json #> '{textInsights,sentiment}',
        'subjectiveNegativity', metrics_json #> '{textInsights,subjectiveNegativity}'
      ))
      ELSE NULL
    END,
    'diagnosisReport',
    CASE
      WHEN jsonb_typeof(metrics_json -> 'diagnosisReport') = 'object'
      THEN jsonb_strip_nulls(jsonb_build_object(
        'mainFinding', metrics_json #> '{diagnosisReport,mainFinding}',
        'checkedSources', metrics_json #> '{diagnosisReport,checkedSources}',
        'aiModels', metrics_json #> '{diagnosisReport,aiModels}',
        'chartInterpretations', metrics_json #> '{diagnosisReport,chartInterpretations}'
      ))
      ELSE NULL
    END
  )`;

  return Prisma.sql`jsonb_strip_nulls(${flatMetricsSql} || ${nestedMetricsSql})`;
}

function buildProductTableRowMetricsSql() {
  const flatMetricObjects = [];
  for (let index = 0; index < PRODUCT_TABLE_ROW_METRIC_KEYS.length; index += PRODUCT_RISK_SNAPSHOT_LIST_METRIC_CHUNK_SIZE) {
    flatMetricObjects.push(buildProductRiskSnapshotMetricChunkSql(
      PRODUCT_TABLE_ROW_METRIC_KEYS.slice(index, index + PRODUCT_RISK_SNAPSHOT_LIST_METRIC_CHUNK_SIZE),
    ));
  }
  const flatMetricsSql = joinJsonbObjectsSql(flatMetricObjects);
  return Prisma.sql`jsonb_strip_nulls(${flatMetricsSql})`;
}

function buildProductDashboardSnapshotMetricsSql() {
  const flatMetricObjects = [];
  for (let index = 0; index < DASHBOARD_SNAPSHOT_METRIC_KEYS.length; index += PRODUCT_RISK_SNAPSHOT_LIST_METRIC_CHUNK_SIZE) {
    flatMetricObjects.push(buildProductRiskSnapshotMetricChunkSql(
      DASHBOARD_SNAPSHOT_METRIC_KEYS.slice(index, index + PRODUCT_RISK_SNAPSHOT_LIST_METRIC_CHUNK_SIZE),
    ));
  }
  const flatMetricsSql = joinJsonbObjectsSql(flatMetricObjects);
  return Prisma.sql`jsonb_strip_nulls(${flatMetricsSql})`;
}

function buildProductAnalyticsSnapshotMetricsSql() {
  const flatMetricObjects = [];
  for (let index = 0; index < ANALYTICS_SNAPSHOT_METRIC_KEYS.length; index += PRODUCT_RISK_SNAPSHOT_LIST_METRIC_CHUNK_SIZE) {
    flatMetricObjects.push(buildProductRiskSnapshotMetricChunkSql(
      ANALYTICS_SNAPSHOT_METRIC_KEYS.slice(index, index + PRODUCT_RISK_SNAPSHOT_LIST_METRIC_CHUNK_SIZE),
    ));
  }
  const flatMetricsSql = joinJsonbObjectsSql(flatMetricObjects);
  const nestedMetricsSql = Prisma.sql`jsonb_build_object(
    'monthlyOrderActivity',
    CASE
      WHEN jsonb_typeof(metrics_json -> 'monthlyOrderActivity') = 'object'
      THEN jsonb_strip_nulls(jsonb_build_object('summary', metrics_json #> '{monthlyOrderActivity,summary}'))
      ELSE NULL
    END,
    'textInsights',
    CASE
      WHEN jsonb_typeof(metrics_json -> 'textInsights') = 'object'
      THEN jsonb_strip_nulls(jsonb_build_object('sentiment', metrics_json #> '{textInsights,sentiment}'))
      ELSE NULL
    END
  )`;

  return Prisma.sql`jsonb_strip_nulls(${flatMetricsSql} || ${nestedMetricsSql})`;
}

function buildProductScoreHistoryAnalyticsMetricsSql() {
  const flatMetricObjects = [];
  for (let index = 0; index < SCORE_HISTORY_ANALYTICS_METRIC_KEYS.length; index += PRODUCT_RISK_SNAPSHOT_LIST_METRIC_CHUNK_SIZE) {
    flatMetricObjects.push(buildProductRiskSnapshotMetricChunkSql(
      SCORE_HISTORY_ANALYTICS_METRIC_KEYS.slice(index, index + PRODUCT_RISK_SNAPSHOT_LIST_METRIC_CHUNK_SIZE),
    ));
  }

  return Prisma.sql`jsonb_strip_nulls(${joinJsonbObjectsSql(flatMetricObjects)})`;
}

function buildProductRiskSnapshotMetricChunkSql(keys) {
  const flatFields = keys.flatMap((key) => [
    Prisma.raw(`'${key}'`),
    Prisma.raw(`metrics_json -> '${key}'`),
  ]);

  return Prisma.sql`jsonb_build_object(${Prisma.join(flatFields)})`;
}

function joinJsonbObjectsSql(jsonbObjects) {
  if (!jsonbObjects.length) return Prisma.sql`'{}'::jsonb`;
  return jsonbObjects.reduce((combined, jsonbObject) => Prisma.sql`${combined} || ${jsonbObject}`);
}

async function getProductRiskSnapshotsForList(shop) {
  const rollupRows = await getProductPulseProductRollupSnapshotRowsForShop(shop);
  if (rollupRows.length) return rollupRows;

  return prisma.$queryRaw`
    WITH snapshot_rows AS (
      SELECT
        id,
        shop,
        "productGid",
        "productTitle",
        handle,
        "riskScore",
        "impactScore",
        confidence,
        "primaryIssue",
        "sourceCoverage",
        "calculatedAt",
        "updatedAt",
        metrics::jsonb AS metrics_json
      FROM "ProductRiskSnapshot"
      WHERE shop = ${shop}
    )
    SELECT
      id,
      shop,
      "productGid",
      "productTitle",
      handle,
      "riskScore",
      "impactScore",
      confidence,
      "primaryIssue",
      "sourceCoverage",
      ${buildProductRiskSnapshotListMetricsSql()} AS metrics,
      "calculatedAt",
      "updatedAt"
    FROM snapshot_rows
    ORDER BY "riskScore" DESC, "updatedAt" DESC
  `;
}

async function getProductRiskSnapshotsForAnalytics(shop) {
  const rollupRows = await getProductPulseProductRollupSnapshotRowsForShop(shop);
  if (rollupRows.length) return rollupRows;

  return prisma.$queryRaw`
    WITH snapshot_rows AS (
      SELECT
        id,
        shop,
        "productGid",
        "productTitle",
        handle,
        "riskScore",
        "impactScore",
        confidence,
        "primaryIssue",
        "sourceCoverage",
        "calculatedAt",
        "updatedAt",
        metrics::jsonb AS metrics_json
      FROM "ProductRiskSnapshot"
      WHERE shop = ${shop}
    )
    SELECT
      id,
      shop,
      "productGid",
      "productTitle",
      handle,
      "riskScore",
      "impactScore",
      confidence,
      "primaryIssue",
      "sourceCoverage",
      ${buildProductAnalyticsSnapshotMetricsSql()} AS metrics,
      "calculatedAt",
      "updatedAt"
    FROM snapshot_rows
    ORDER BY "riskScore" DESC, "updatedAt" DESC
  `;
}

async function getProductRiskSnapshotsForDashboard(shop) {
  const rollupRows = await getProductPulseProductRollupSnapshotRowsForShop(shop);
  if (rollupRows.length) return rollupRows;

  return prisma.$queryRaw`
    WITH snapshot_rows AS (
      SELECT
        id,
        shop,
        "productGid",
        "productTitle",
        handle,
        "riskScore",
        "impactScore",
        confidence,
        "primaryIssue",
        "sourceCoverage",
        "calculatedAt",
        "updatedAt",
        metrics::jsonb AS metrics_json
      FROM "ProductRiskSnapshot"
      WHERE shop = ${shop}
    )
    SELECT
      id,
      shop,
      "productGid",
      "productTitle",
      handle,
      "riskScore",
      "impactScore",
      confidence,
      "primaryIssue",
      "sourceCoverage",
      ${buildProductDashboardSnapshotMetricsSql()} AS metrics,
      "calculatedAt",
      "updatedAt"
    FROM snapshot_rows
    ORDER BY "riskScore" DESC, "updatedAt" DESC
  `;
}

async function getDashboardSnapshotsWithLatestDiagnosisMap(shop, perf) {
  const snapshots = await measureProductPulseStep(
    perf,
    "dashboard.snapshots.minimal",
    () => getProductRiskSnapshotsForDashboard(shop),
  );
  const latestDiagnosisByProductGid = await measureProductPulseStep(
    perf,
    "dashboard.latestDiagnosisMap.minimal",
    () => getLatestDashboardDiagnosisMap(shop, snapshots),
  );

  return { snapshots, latestDiagnosisByProductGid };
}

export async function getProductsQueueForShop(shop, admin, filters = {}, options = {}) {
  const perf = options.perf;
  const perfPrefix = options.perfPrefix || "products";
  await measureProductPulseStep(perf, `${perfPrefix}.failStaleFastProductScans`, () => failStaleFastProductScans(shop));
  const [snapshots, activeJob, activeDiagnosisJobs, settings, watchedItems] = await Promise.all([
    measureProductPulseStep(perf, `${perfPrefix}.snapshots.light`, () => getProductRiskSnapshotsForList(shop)),
    measureProductPulseStep(perf, `${perfPrefix}.activeFastScan`, () => getActiveFastProductScan(shop)),
    measureProductPulseStep(perf, `${perfPrefix}.activeDiagnosisJobs`, () => getActiveProductDiagnosisJobs(shop)),
    options.settings ? Promise.resolve(options.settings) : measureProductPulseStep(perf, `${perfPrefix}.settings`, () => getProductPulseSettings(shop)),
    measureProductPulseStep(perf, `${perfPrefix}.watchlistItems`, () => prisma.productWatchlistItem.findMany({
      where: { shop },
      select: { productGid: true, status: true },
    })),
  ]);
  perf?.mark(`${perfPrefix}.baseData.loaded`, {
    snapshots: snapshots.length,
    activeDiagnosisJobs: activeDiagnosisJobs.length,
    watchedItems: watchedItems.length,
  });

  if (activeJob) ensureFastProductScanWorker(activeJob);
  if (activeDiagnosisJobs.length) ensureProductDiagnosisQueueWorker(shop);
  const activeDiagnosisProductKeys = getActiveDiagnosisProductKeySet(activeDiagnosisJobs);
  const [latestDiagnosisByProductGid, resolvedActionsByProductGid] = await Promise.all([
    measureProductPulseStep(perf, `${perfPrefix}.latestDiagnosisMap.light`, () => getLatestCompletedDiagnosisMap(shop, snapshots, { light: true })),
    measureProductPulseStep(perf, `${perfPrefix}.resolvedActionsMap`, () => getResolvedProductActionsMap(shop, snapshots)),
  ]);
  const filterOptions = getProductTableFilterOptions(snapshots, settings, latestDiagnosisByProductGid, activeDiagnosisProductKeys);
  perf?.mark(`${perfPrefix}.filterOptions`);
  const filteredSnapshots = sortProductSnapshots(
    filterProductSnapshots(snapshots, filters, resolvedActionsByProductGid, settings, latestDiagnosisByProductGid, activeDiagnosisProductKeys),
    filters,
    resolvedActionsByProductGid,
  );
  perf?.mark(`${perfPrefix}.filterAndSort`, { filteredSnapshots: filteredSnapshots.length });
  const rowsPerPage = normalizeRowsPerPage(filters.rows);
  const totalPages = Math.max(1, Math.ceil(filteredSnapshots.length / rowsPerPage));
  const page = Math.min(normalizePositiveInteger(filters.page, 1), totalPages);
  const pageSnapshots = filteredSnapshots.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  const watchedByProductGid = new Map(watchedItems.map((item) => [item.productGid, item]));
  const scoreHistoryByProductGid = await measureProductPulseStep(perf, `${perfPrefix}.scoreHistory`, () => getProductScoreHistoryForProductsForShop(
    shop,
    pageSnapshots.map((snapshot) => snapshot.productGid),
    { take: 80 },
  ));
  const rows = pageSnapshots.map((snapshot) => formatProductRow(
    shop,
    snapshot,
    latestDiagnosisByProductGid.get(snapshot.productGid),
    resolvedActionsByProductGid.get(snapshot.productGid),
    settings,
    watchedByProductGid.get(snapshot.productGid),
    scoreHistoryByProductGid.get(snapshot.productGid) || [],
  ));
  perf?.mark(`${perfPrefix}.formatRows`, { rows: rows.length });
  const rowsWithImages = await measureProductPulseStep(perf, `${perfPrefix}.attachProductImages`, () => attachProductImages(rows, admin));
  const rowsWithJobs = attachActiveProductDiagnosisJobs(rowsWithImages, activeDiagnosisJobs);
  perf?.mark(`${perfPrefix}.attachActiveJobs`);

  return {
    rows: rowsWithJobs,
    total: filteredSnapshots.length,
    totalAll: snapshots.length,
    page,
    rowsPerPage,
    totalPages,
    filterOptions,
    settings,
    activeScanJob: activeJob ? formatJob(activeJob) : null,
    activeDiagnosisJobs: activeDiagnosisJobs.map(formatJob),
  };
}

export async function getProductsPageTablesForShop(shop, admin, options = {}) {
  const perf = options.perf;
  const activeTab = normalizeProductTableActiveTab(options.activeTab);
  const activeTableKey = getProductTableKeyForTab(activeTab);
  const settings = options.settings || await measureProductPulseStep(
    perf,
    `products.${activeTab}.settings`,
    () => getProductPulseSettings(shop),
  );
  const base = await loadProductsQueueSharedBaseForShop(shop, {
    settings,
    perf,
  });
  const tableContexts = {
    productTable: buildProductsQueueTableContext("productTable", { ...(options.mainFilters || {}), analysis: "full", resolution: "unresolved" }, base),
    candidateProductTable: buildProductsQueueTableContext("candidateProductTable", { ...(options.candidateFilters || {}), analysis: "quickscan", resolution: "unresolved" }, base),
    resolvedProductTable: buildProductsQueueTableContext("resolvedProductTable", { ...(options.resolvedFilters || {}), analysis: "all", resolution: "resolved" }, base),
  };
  perf?.mark(`products.${activeTab}.filterAndSort`, {
    productTable: tableContexts.productTable.filteredSnapshots.length,
    candidateProductTable: tableContexts.candidateProductTable.filteredSnapshots.length,
    resolvedProductTable: tableContexts.resolvedProductTable.filteredSnapshots.length,
  });

  const activeContext = tableContexts[activeTableKey] || tableContexts.productTable;
  const pageProductGids = [...new Set(activeContext.pageSnapshots.map((snapshot) => snapshot.productGid).filter(Boolean))];
  const rowMetricsByProductGid = await measureProductPulseStep(
    perf,
    `products.${activeTab}.rowMetrics.light`,
    () => getProductTableRowMetricsForProducts(shop, pageProductGids),
  );
  const scoreHistoryByProductGid = await measureProductPulseStep(
    perf,
    `products.${activeTab}.scoreHistory.light`,
    () => getProductScoreHistoryForProductsLight(shop, pageProductGids, { take: 12 }),
  );
  const watchedItems = await measureProductPulseStep(
    perf,
    `products.${activeTab}.watchlistItems`,
    () => pageProductGids.length ? prisma.productWatchlistItem.findMany({
      where: { shop, productGid: { in: pageProductGids } },
      select: { productGid: true, status: true },
    }) : [],
  );
  const activeBase = {
    ...base,
    watchedByProductGid: new Map(watchedItems.map((item) => [item.productGid, item])),
  };
  const activeRows = buildProductsQueueRowsForContext(
    shop,
    activeContext,
    activeBase,
    scoreHistoryByProductGid,
    rowMetricsByProductGid,
  );
  perf?.mark(`products.${activeTab}.formatRows`, { rows: activeRows.length });
  const backfilledImagesByProductGid = await measureProductPulseStep(
    perf,
    `products.${activeTab}.storedImages`,
    () => backfillMissingProductImagesForSnapshots(shop, activeContext.pageSnapshots, admin, { limit: 10 }),
  );
  const activeRowsWithImages = mergeBackfilledImagesIntoRows(activeRows, backfilledImagesByProductGid);

  return Object.fromEntries(Object.values(tableContexts).map((context) => [
    context.key,
    buildProductsQueueResultForContext(
      context,
      context.key === activeTableKey ? activeRowsWithImages : [],
      activeBase,
    ),
  ]));
}

async function loadProductsQueueSharedBaseForShop(shop, { settings, perf } = {}) {
  await measureProductPulseStep(perf, "products.base.failStaleFastProductScans", () => failStaleFastProductScans(shop));
  const baseRows = await measureProductPulseStep(
    perf,
    "products.base.rows.light",
    () => getProductTableBaseRowsForShop(shop),
  );
  const { snapshots, latestDiagnosisByProductGid, resolvedActionsByProductGid } = splitProductTableBaseRows(baseRows);
  const { activeJob, activeDiagnosisJobs } = await measureProductPulseStep(
    perf,
    "products.base.activeJobs",
    () => getActiveDashboardJobs(shop),
  );
  if (activeJob) ensureFastProductScanWorker(activeJob);
  if (activeDiagnosisJobs.length) ensureProductDiagnosisQueueWorker(shop);

  const activeDiagnosisProductKeys = getActiveDiagnosisProductKeySet(activeDiagnosisJobs);
  const filterOptions = getProductTableFilterOptions(snapshots, settings, latestDiagnosisByProductGid, activeDiagnosisProductKeys);
  perf?.mark("products.base.loaded", {
    snapshots: snapshots.length,
    activeDiagnosisJobs: activeDiagnosisJobs.length,
    resolvedActions: resolvedActionsByProductGid.size,
  });

  return {
    activeDiagnosisJobs,
    activeDiagnosisProductKeys,
    activeJob,
    filterOptions,
    latestDiagnosisByProductGid,
    resolvedActionsByProductGid,
    settings,
    snapshots,
    watchedByProductGid: new Map(),
  };
}

function buildProductsQueueTableContext(key, filters = {}, base = {}) {
  const filteredSnapshots = sortProductSnapshots(
    filterProductSnapshots(
      base.snapshots || [],
      filters,
      base.resolvedActionsByProductGid,
      base.settings,
      base.latestDiagnosisByProductGid,
      base.activeDiagnosisProductKeys,
    ),
    filters,
    base.resolvedActionsByProductGid,
  );
  const rowsPerPage = normalizeRowsPerPage(filters.rows);
  const totalPages = Math.max(1, Math.ceil(filteredSnapshots.length / rowsPerPage));
  const page = Math.min(normalizePositiveInteger(filters.page, 1), totalPages);
  const pageSnapshots = filteredSnapshots.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  return {
    key,
    filters,
    filteredSnapshots,
    page,
    pageSnapshots,
    rowsPerPage,
    totalPages,
  };
}

function buildProductsQueueRowsForContext(shop, context, base, scoreHistoryByProductGid, rowMetricsByProductGid = new Map()) {
  return context.pageSnapshots.map((snapshot) => {
    const rowMetrics = rowMetricsByProductGid.get(snapshot.productGid) || {};
    const rowSnapshot = {
      ...snapshot,
      metrics: {
        ...(snapshot.metrics || {}),
        ...rowMetrics,
      },
    };
    return formatProductRow(
      shop,
      rowSnapshot,
      base.latestDiagnosisByProductGid.get(snapshot.productGid),
      base.resolvedActionsByProductGid.get(snapshot.productGid),
      base.settings,
      base.watchedByProductGid.get(snapshot.productGid),
      scoreHistoryByProductGid.get(snapshot.productGid) || [],
    );
  });
}

function normalizeProductTableActiveTab(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["full", "candidates", "resolved"].includes(normalized) ? normalized : "full";
}

function getProductTableKeyForTab(tab) {
  if (tab === "candidates") return "candidateProductTable";
  if (tab === "resolved") return "resolvedProductTable";
  return "productTable";
}

async function getProductTableBaseRowsForShop(shop) {
  const rollupRows = await getProductPulseProductRollupSnapshotRowsForShop(shop);
  if (rollupRows.length) return rollupRows;

  return prisma.$queryRaw`
    WITH latest_diagnosis AS (
      SELECT DISTINCT ON ("productGid")
        id,
        shop,
        "productGid",
        "productTitle",
        status,
        "riskScore",
        confidence,
        "likelyCause",
        "createdAt",
        "completedAt"
      FROM "ProductDiagnosis"
      WHERE shop = ${shop}
        AND status = 'Completed'
      ORDER BY "productGid", "completedAt" DESC NULLS LAST, "createdAt" DESC
    ),
    latest_resolution_action AS (
      SELECT DISTINCT ON ("productGid")
        "productGid",
        "actionType",
        "createdAt",
        "appliedAt"
      FROM "ProductAction"
      WHERE shop = ${shop}
        AND status = 'applied'
        AND "actionType" IN ('mark-resolved', 'mark-unresolved')
      ORDER BY "productGid", "appliedAt" DESC NULLS LAST, "createdAt" DESC
    ),
    snapshot_rows AS (
      SELECT
        id,
        shop,
        "productGid",
        "productTitle",
        handle,
        "riskScore",
        "impactScore",
        confidence,
        "primaryIssue",
        "sourceCoverage",
        "calculatedAt",
        "updatedAt",
        metrics::jsonb AS metrics_json
      FROM "ProductRiskSnapshot"
      WHERE shop = ${shop}
    )
    SELECT
      snapshot_rows.id,
      snapshot_rows.shop,
      snapshot_rows."productGid",
      snapshot_rows."productTitle",
      snapshot_rows.handle,
      snapshot_rows."riskScore",
      snapshot_rows."impactScore",
      snapshot_rows.confidence,
      snapshot_rows."primaryIssue",
      snapshot_rows."sourceCoverage",
      jsonb_strip_nulls(jsonb_build_object(
        'vendor', snapshot_rows.metrics_json -> 'vendor',
        'productType', snapshot_rows.metrics_json -> 'productType',
        'tags', snapshot_rows.metrics_json -> 'tags',
        'collections', snapshot_rows.metrics_json -> 'collections',
        'latestDiagnosisId', snapshot_rows.metrics_json -> 'latestDiagnosisId',
        'lastDetailedDiagnosisAt', snapshot_rows.metrics_json -> 'lastDetailedDiagnosisAt'
      )) AS metrics,
      snapshot_rows."calculatedAt",
      snapshot_rows."updatedAt",
      latest_diagnosis.id AS "tableLatestDiagnosisId",
      latest_diagnosis.shop AS "tableLatestDiagnosisShop",
      latest_diagnosis."productGid" AS "tableLatestDiagnosisProductGid",
      latest_diagnosis."productTitle" AS "tableLatestDiagnosisProductTitle",
      latest_diagnosis.status AS "tableLatestDiagnosisStatus",
      latest_diagnosis."riskScore" AS "tableLatestDiagnosisRiskScore",
      latest_diagnosis.confidence AS "tableLatestDiagnosisConfidence",
      latest_diagnosis."likelyCause" AS "tableLatestDiagnosisLikelyCause",
      latest_diagnosis."createdAt" AS "tableLatestDiagnosisCreatedAt",
      latest_diagnosis."completedAt" AS "tableLatestDiagnosisCompletedAt",
      latest_resolution_action."actionType" AS "tableResolutionActionType",
      latest_resolution_action."createdAt" AS "tableResolutionCreatedAt",
      latest_resolution_action."appliedAt" AS "tableResolutionAppliedAt"
    FROM snapshot_rows
    LEFT JOIN latest_diagnosis
      ON latest_diagnosis.shop = snapshot_rows.shop
      AND latest_diagnosis."productGid" = snapshot_rows."productGid"
    LEFT JOIN latest_resolution_action
      ON latest_resolution_action."productGid" = snapshot_rows."productGid"
    ORDER BY snapshot_rows."riskScore" DESC, snapshot_rows."updatedAt" DESC
  `;
}

function splitProductTableBaseRows(rows = []) {
  const latestDiagnosisByProductGid = new Map();
  const resolvedActionsByProductGid = new Map();
  const snapshots = (Array.isArray(rows) ? rows : []).map((row) => {
    const {
      tableLatestDiagnosisId,
      tableLatestDiagnosisShop,
      tableLatestDiagnosisProductGid,
      tableLatestDiagnosisProductTitle,
      tableLatestDiagnosisStatus,
      tableLatestDiagnosisRiskScore,
      tableLatestDiagnosisConfidence,
      tableLatestDiagnosisLikelyCause,
      tableLatestDiagnosisCreatedAt,
      tableLatestDiagnosisCompletedAt,
      tableResolutionActionType,
      tableResolutionCreatedAt,
      tableResolutionAppliedAt,
      ...snapshot
    } = row;

    if (tableLatestDiagnosisId && snapshot.productGid) {
      latestDiagnosisByProductGid.set(snapshot.productGid, {
        id: tableLatestDiagnosisId,
        shop: tableLatestDiagnosisShop || snapshot.shop,
        productGid: tableLatestDiagnosisProductGid || snapshot.productGid,
        productTitle: tableLatestDiagnosisProductTitle || snapshot.productTitle,
        status: tableLatestDiagnosisStatus || "Completed",
        riskScore: tableLatestDiagnosisRiskScore,
        confidence: tableLatestDiagnosisConfidence,
        likelyCause: tableLatestDiagnosisLikelyCause,
        createdAt: tableLatestDiagnosisCreatedAt,
        completedAt: tableLatestDiagnosisCompletedAt,
      });
    }

    if (snapshot.productGid && tableResolutionActionType === "mark-resolved") {
      resolvedActionsByProductGid.set(snapshot.productGid, {
        actionType: tableResolutionActionType,
        status: "applied",
        createdAt: tableResolutionCreatedAt,
        appliedAt: tableResolutionAppliedAt,
      });
    }

    return snapshot;
  });

  return { snapshots, latestDiagnosisByProductGid, resolvedActionsByProductGid };
}

async function getProductTableRowMetricsForProducts(shop, productGids = []) {
  if (!shop) return new Map();
  const uniqueProductGids = [...new Set(productGids.filter(Boolean))];
  if (!uniqueProductGids.length) return new Map();

  const rollupMetrics = await getProductPulseProductRollupMetricsForProducts(shop, uniqueProductGids);
  if (rollupMetrics.size === uniqueProductGids.length) {
    await mergeFullProductMomentumMetricsForProducts(shop, uniqueProductGids, rollupMetrics);
    return rollupMetrics;
  }

  const rows = await prisma.$queryRaw`
    WITH snapshot_rows AS (
      SELECT
        "productGid",
        metrics::jsonb AS metrics_json
      FROM "ProductRiskSnapshot"
      WHERE shop = ${shop}
        AND "productGid" IN (${Prisma.join(uniqueProductGids)})
    )
    SELECT
      "productGid",
      ${buildProductTableRowMetricsSql()} AS metrics
    FROM snapshot_rows
  `;

  return new Map(rows.map((row) => [row.productGid, row.metrics || {}]));
}

async function mergeFullProductMomentumMetricsForProducts(shop, productGids = [], metricsByProductGid = new Map()) {
  if (!shop || !productGids.length || !metricsByProductGid.size) return metricsByProductGid;
  const rows = await prisma.$queryRaw`
    WITH snapshot_rows AS (
      SELECT
        "productGid",
        metrics::jsonb AS metrics_json
      FROM "ProductRiskSnapshot"
      WHERE shop = ${shop}
        AND "productGid" IN (${Prisma.join(productGids)})
    )
    SELECT
      "productGid",
      metrics_json -> 'productMomentum' AS "productMomentum"
    FROM snapshot_rows
    WHERE jsonb_typeof(metrics_json -> 'productMomentum') = 'object'
  `;

  rows.forEach((row) => {
    if (!row.productGid || !row.productMomentum) return;
    const currentMetrics = metricsByProductGid.get(row.productGid) || {};
    metricsByProductGid.set(row.productGid, {
      ...currentMetrics,
      productMomentum: row.productMomentum,
    });
  });
  return metricsByProductGid;
}

async function getProductScoreHistoryForProductsLight(shop, productGids = [], options = {}) {
  if (!shop) return new Map();
  const uniqueProductGids = [...new Set(productGids.filter(Boolean))];
  if (!uniqueProductGids.length) return new Map();
  const take = Math.round(Math.max(1, Math.min(24, Number(options.take || 12))));
  const rows = await prisma.$queryRaw`
    SELECT
      id,
      "productGid",
      source,
      "riskScore",
      "impactScore",
      confidence,
      "primaryIssue",
      "recordedAt"
    FROM (
      SELECT
        id,
        "productGid",
        source,
        "riskScore",
        "impactScore",
        confidence,
        "primaryIssue",
        "recordedAt",
        row_number() OVER (PARTITION BY "productGid" ORDER BY "recordedAt" DESC) AS row_number
      FROM "ProductScoreHistory"
      WHERE shop = ${shop}
        AND "productGid" IN (${Prisma.join(uniqueProductGids)})
    ) ranked_history
    WHERE row_number <= ${take}
    ORDER BY "productGid" ASC, "recordedAt" ASC
  `;
  const historyByProductGid = new Map(uniqueProductGids.map((productGid) => [productGid, []]));
  rows.forEach((row) => {
    const history = historyByProductGid.get(row.productGid) || [];
    history.push(row);
    historyByProductGid.set(row.productGid, history);
  });
  return historyByProductGid;
}

async function getProductScoreHistoryForProductsForAnalytics(shop, productGids = [], options = {}) {
  if (!shop) return new Map();
  const uniqueProductGids = [...new Set(productGids.filter(Boolean))];
  if (!uniqueProductGids.length) return new Map();
  const take = Math.round(Math.max(1, Math.min(ANALYTICS_SCORE_HISTORY_TAKE, Number(options.take || 90))));
  const sinceDate = getValidDate(options.since);
  const includeBaselineBefore = Boolean(options.includeBaselineBefore && sinceDate);
  const baselineUnionSql = includeBaselineBefore
    ? Prisma.sql`
      UNION ALL
      SELECT
        id,
        "productGid",
        source,
        "riskScore",
        "impactScore",
        confidence,
        "primaryIssue",
        "recordedAt",
        metrics_json
      FROM baseline_history
    `
    : Prisma.empty;

  const rows = sinceDate
    ? await prisma.$queryRaw`
      WITH recent_history AS (
        SELECT
          id,
          "productGid",
          source,
          "riskScore",
          "impactScore",
          confidence,
          "primaryIssue",
          "recordedAt",
          metrics::jsonb AS metrics_json,
          row_number() OVER (PARTITION BY "productGid" ORDER BY "recordedAt" DESC) AS row_number
        FROM "ProductScoreHistory"
        WHERE shop = ${shop}
          AND "productGid" IN (${Prisma.join(uniqueProductGids)})
          AND "recordedAt" >= ${sinceDate}
      ),
      baseline_history AS (
        SELECT DISTINCT ON ("productGid")
          id,
          "productGid",
          source,
          "riskScore",
          "impactScore",
          confidence,
          "primaryIssue",
          "recordedAt",
          metrics::jsonb AS metrics_json
        FROM "ProductScoreHistory"
        WHERE shop = ${shop}
          AND "productGid" IN (${Prisma.join(uniqueProductGids)})
          AND "recordedAt" < ${sinceDate}
        ORDER BY "productGid", "recordedAt" DESC
      ),
      combined_history AS (
        SELECT
          id,
          "productGid",
          source,
          "riskScore",
          "impactScore",
          confidence,
          "primaryIssue",
          "recordedAt",
          metrics_json
        FROM recent_history
        WHERE row_number <= ${take}
        ${baselineUnionSql}
      )
      SELECT
        id,
        "productGid",
        source,
        "riskScore",
        "impactScore",
        confidence,
        "primaryIssue",
        "recordedAt",
        ${buildProductScoreHistoryAnalyticsMetricsSql()} AS metrics
      FROM combined_history
      ORDER BY "productGid" ASC, "recordedAt" ASC
    `
    : await prisma.$queryRaw`
      WITH ranked_history AS (
        SELECT
          id,
          "productGid",
          source,
          "riskScore",
          "impactScore",
          confidence,
          "primaryIssue",
          "recordedAt",
          metrics::jsonb AS metrics_json,
          row_number() OVER (PARTITION BY "productGid" ORDER BY "recordedAt" DESC) AS row_number
        FROM "ProductScoreHistory"
        WHERE shop = ${shop}
          AND "productGid" IN (${Prisma.join(uniqueProductGids)})
      )
      SELECT
        id,
        "productGid",
        source,
        "riskScore",
        "impactScore",
        confidence,
        "primaryIssue",
        "recordedAt",
        ${buildProductScoreHistoryAnalyticsMetricsSql()} AS metrics
      FROM ranked_history
      WHERE row_number <= ${take}
      ORDER BY "productGid" ASC, "recordedAt" ASC
    `;

  const historyByProductGid = new Map(uniqueProductGids.map((productGid) => [productGid, []]));
  rows.forEach((row) => {
    const history = historyByProductGid.get(row.productGid) || [];
    history.push(row);
    historyByProductGid.set(row.productGid, history);
  });
  return historyByProductGid;
}

function getValidDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function buildProductsQueueResultForContext(context, rows, base) {
  const rowsWithJobs = attachActiveProductDiagnosisJobs(rows, base.activeDiagnosisJobs);
  return {
    rows: rowsWithJobs,
    total: context.filteredSnapshots.length,
    totalAll: base.snapshots.length,
    page: context.page,
    rowsPerPage: context.rowsPerPage,
    totalPages: context.totalPages,
    filterOptions: base.filterOptions,
    settings: base.settings,
    activeScanJob: base.activeJob ? formatJob(base.activeJob) : null,
    activeDiagnosisJobs: base.activeDiagnosisJobs.map(formatJob),
  };
}

export async function addShopifyProductCandidateForShop(shop, admin, productId) {
  const normalizedProductId = String(productId || "").trim();
  if (!normalizedProductId) {
    return { status: "validation_error", message: "Choose a Shopify product before adding it to Candidates." };
  }

  const existingSnapshot = await findProductRiskSnapshot(shop, normalizedProductId);
  if (existingSnapshot) {
    return {
      status: "success",
      message: `${existingSnapshot.productTitle || "This product"} is already stored in ProductPulse.`,
      action: {
        id: "add-shopify-product-candidate",
        productGid: existingSnapshot.productGid,
        handle: existingSnapshot.handle,
        alreadyStored: true,
      },
    };
  }

  const snapshot = await createManualProductRiskSnapshot(shop, admin, normalizedProductId);
  if (!snapshot) {
    return { status: "validation_error", message: "ProductPulse could not find that Shopify product." };
  }

  invalidateProductPulseDashboardCache(shop);
  return {
    status: "success",
    message: `${snapshot.productTitle || "Product"} was added to Candidates without running a diagnosis.`,
    invalidateDashboardCache: true,
    action: {
      id: "add-shopify-product-candidate",
      productGid: snapshot.productGid,
      handle: snapshot.handle,
    },
  };
}

export async function getDashboardDataForShop(shop, admin, options = {}) {
  const perf = options.perf;
  const cachedDashboard = getCachedProductPulseDashboard(shop, options);
  if (cachedDashboard) {
    perf?.mark("dashboard.cache.hit");
    return cachedDashboard;
  }
  perf?.mark("dashboard.cache.miss");

  const { snapshots, latestDiagnosisByProductGid } = await getDashboardSnapshotsWithLatestDiagnosisMap(
    shop,
    perf,
  );
  const settings = await measureProductPulseStep(perf, "dashboard.settings", () => getProductPulseSettings(shop));
  const actions = await measureProductPulseStep(perf, "dashboard.actions", () => prisma.productAction.findMany({
    where: { shop },
    select: {
      id: true,
      diagnosisId: true,
      productGid: true,
      actionType: true,
      label: true,
      status: true,
      payload: true,
      createdAt: true,
      appliedAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: 250,
  }));
  const actionsByProductGid = groupProductActionsByProductGid(actions);
  const { activeJob, activeDiagnosisJobs } = await measureProductPulseStep(perf, "dashboard.activeJobs", () => getActiveDashboardJobs(shop));
  const catalogProductCount = await measureProductPulseStep(
    perf,
    "dashboard.catalogProductCount.cached",
    () => getCachedShopifyCatalogProductCountForDashboard(shop, admin, snapshots.length),
  );
  perf?.mark("dashboard.baseData.loaded", {
    snapshots: snapshots.length,
    activeDiagnosisJobs: activeDiagnosisJobs.length,
    actions: actions.length,
    catalogProductCount,
  });
  await measureProductPulseStep(
    perf,
    "dashboard.storedImages",
    () => backfillMissingProductImagesForSnapshots(shop, snapshots, admin, { limit: 8 }),
  );

  if (activeJob) ensureFastProductScanWorker(activeJob);
  if (activeDiagnosisJobs.length) ensureProductDiagnosisQueueWorker(shop);

  const dashboardProducts = snapshots.map((snapshot) => formatSnapshotForDashboard(
    snapshot,
    actionsByProductGid.get(snapshot.productGid) || [],
    latestDiagnosisByProductGid.get(snapshot.productGid),
    settings,
  ));
  perf?.mark("dashboard.formatProducts.minimal", { products: dashboardProducts.length });
  const dashboardProductsWithJobs = attachActiveProductDiagnosisJobs(dashboardProducts, activeDiagnosisJobs);
  perf?.mark("dashboard.attachActiveJobs");

  const dashboard = buildDashboardViewData(dashboardProductsWithJobs, {
    catalogProductCount,
    settings,
  });
  perf?.mark("dashboard.buildDashboardViewData");
  setCachedProductPulseDashboard(shop, dashboard, { activeJob, activeDiagnosisJobs });
  return dashboard;
}

async function getCachedShopifyCatalogProductCountForDashboard(shop, admin, fallbackCount = 0) {
  const normalizedFallbackCount = Math.max(0, Number(fallbackCount || 0));
  const cached = await readShopifyCatalogProductCountCache(shop);
  if (cached?.fresh) return Math.max(cached.count, normalizedFallbackCount);

  if (cached?.count > 0) {
    if (admin?.graphql) {
      refreshShopifyCatalogProductCountCache(shop, admin, cached.count).catch(() => {});
    }
    return Math.max(cached.count, normalizedFallbackCount);
  }

  if (!admin?.graphql) return normalizedFallbackCount;

  try {
    const refreshed = await refreshShopifyCatalogProductCountCache(shop, admin, normalizedFallbackCount);
    return Math.max(refreshed, normalizedFallbackCount);
  } catch {
    return normalizedFallbackCount;
  }
}

async function readShopifyCatalogProductCountCache(shop) {
  if (!shop) return null;
  const record = await prisma.productPulseSource.findUnique({
    where: {
      shop_sourceKey: {
        shop,
        sourceKey: SHOPIFY_CATALOG_PRODUCT_COUNT_CACHE_SOURCE_KEY,
      },
    },
    select: {
      config: true,
      lastSyncedAt: true,
    },
  });
  if (!record) return null;

  const config = record.config && typeof record.config === "object" ? record.config : {};
  const count = Number(config.count || 0);
  if (!Number.isFinite(count) || count <= 0) return null;

  const countedAt = new Date(config.countedAt || record.lastSyncedAt || 0).getTime();
  const fresh = countedAt > 0 && Date.now() - countedAt <= SHOPIFY_CATALOG_PRODUCT_COUNT_CACHE_TTL_MS;
  return {
    count: Math.round(count),
    countedAt: Number.isFinite(countedAt) ? countedAt : 0,
    fresh,
  };
}

async function refreshShopifyCatalogProductCountCache(shop, admin, previousCount = 0) {
  const count = await getShopifyCatalogProductCount(admin);
  if (!Number.isFinite(count) || count <= 0) return Math.max(0, Number(previousCount || 0));

  const countedAt = new Date();
  await prisma.productPulseSource.upsert({
    where: {
      shop_sourceKey: {
        shop,
        sourceKey: SHOPIFY_CATALOG_PRODUCT_COUNT_CACHE_SOURCE_KEY,
      },
    },
    create: {
      shop,
      sourceKey: SHOPIFY_CATALOG_PRODUCT_COUNT_CACHE_SOURCE_KEY,
      category: "cache",
      name: "Shopify catalog product count",
      connected: true,
      active: true,
      available: true,
      health: "cached",
      coverageWeight: 0,
      config: {
        count,
        countedAt: countedAt.toISOString(),
        source: "shopify.productsCount",
      },
      lastSyncedAt: countedAt,
    },
    update: {
      connected: true,
      active: true,
      available: true,
      health: "cached",
      config: {
        count,
        countedAt: countedAt.toISOString(),
        source: "shopify.productsCount",
      },
      lastSyncedAt: countedAt,
    },
  });

  if (count !== Number(previousCount || 0)) invalidateProductPulseDashboardCache(shop);
  return count;
}

async function getShopifyCatalogProductCount(admin) {
  if (!admin?.graphql) return null;
  const data = await withTimeout(
    shopifyGraphql(admin, `#graphql
      query ProductPulseCatalogProductCount {
        productsCount {
          count
        }
      }
    `),
    SHOPIFY_DASHBOARD_COUNT_TIMEOUT_MS,
    "Shopify catalog product count timed out.",
  );
  const count = Number(data?.productsCount?.count || 0);
  return Number.isFinite(count) && count > 0 ? Math.round(count) : null;
}

function groupProductActionsByProductGid(actions = []) {
  const grouped = new Map();
  (Array.isArray(actions) ? actions : []).forEach((action) => {
    const productGid = action?.productGid;
    if (!productGid) return;
    const productActions = grouped.get(productGid) || [];
    productActions.push(action);
    grouped.set(productGid, productActions);
  });
  return grouped;
}

export async function getAnalyticsDataForShop(shop, options = {}) {
  const perf = options.perf || null;
  const cachedAnalytics = getCachedProductPulseAnalytics(shop, options);
  if (cachedAnalytics) {
    perf?.mark("analytics.cache.hit");
    return cachedAnalytics;
  }

  perf?.mark("analytics.cache.miss");
  await measureProductPulseStep(perf, "analytics.failStaleFastProductScans", () => failStaleFastProductScans(shop));
  const [snapshots, activeJob, activeDiagnosisJobs, sources, actions, settings] = await Promise.all([
    measureProductPulseStep(perf, "analytics.snapshots.optimized", () => getProductRiskSnapshotsForAnalytics(shop)),
    measureProductPulseStep(perf, "analytics.activeFastScan", () => getActiveFastProductScan(shop)),
    measureProductPulseStep(perf, "analytics.activeDiagnosisJobs", () => getActiveProductDiagnosisJobs(shop)),
    measureProductPulseStep(perf, "analytics.sources", () => prisma.productPulseSource.findMany({
      where: { shop, sourceKey: { not: PRODUCT_PULSE_SETTINGS_SOURCE_KEY }, category: { not: "cache" } },
      orderBy: [{ category: "asc" }, { sourceKey: "asc" }],
    })),
    measureProductPulseStep(perf, "analytics.actions", () => prisma.productAction.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 250,
    })),
    measureProductPulseStep(perf, "analytics.settings", () => getProductPulseSettings(shop)),
  ]);

  if (activeJob) ensureFastProductScanWorker(activeJob);
  if (activeDiagnosisJobs.length) ensureProductDiagnosisQueueWorker(shop);
  perf?.mark("analytics.base.loaded", {
    snapshots: snapshots.length,
    sources: sources.length,
    actions: actions.length,
    activeDiagnosisJobs: activeDiagnosisJobs.length,
  });

  const latestDiagnosisByProductGid = await measureProductPulseStep(
    perf,
    "analytics.latestDiagnosisMap.light",
    () => getLatestCompletedDiagnosisMap(shop, snapshots, { light: true }),
  );
  const analyticsHistoryWindowDays = Math.max(
    ANALYTICS_RETROACTIVE_HISTORY_DAYS,
    Number(settings?.analysis?.lookbackDays || 0),
  );
  const analyticsHistorySince = new Date(
    Date.now() - (analyticsHistoryWindowDays + ANALYTICS_HISTORY_BASELINE_BUFFER_DAYS) * 24 * 60 * 60 * 1000,
  );
  const scoreHistoryByProductGid = await measureProductPulseStep(
    perf,
    "analytics.scoreHistory",
    () => getProductScoreHistoryForProductsForAnalytics(
      shop,
      snapshots.map((snapshot) => snapshot.productGid),
      {
        take: Math.max(ANALYTICS_SCORE_HISTORY_TAKE, analyticsHistoryWindowDays + 30),
        since: analyticsHistorySince,
        includeBaselineBefore: true,
      },
    ),
  );
  const analyticsProducts = await measureProductPulseStep(perf, "analytics.formatProducts", () => {
    const actionsByProductGid = groupProductActionsByProductGid(actions);
    return snapshots.map((snapshot) => formatSnapshotForAnalytics(
      snapshot,
      actionsByProductGid.get(snapshot.productGid) || [],
      latestDiagnosisByProductGid.get(snapshot.productGid),
      settings,
      scoreHistoryByProductGid.get(snapshot.productGid) || [],
    ));
  }, { products: snapshots.length });

  const analytics = await measureProductPulseStep(perf, "analytics.buildAnalyticsViewData", () => buildAnalyticsViewData(analyticsProducts, {
    sources,
    actions,
    settings,
    windowDays: settings?.analysis?.lookbackDays,
  }));
  setCachedProductPulseAnalytics(shop, analytics, { activeJob, activeDiagnosisJobs });
  return analytics;
}

async function getLatestCompletedDiagnosisMap(shop, snapshots = [], options = {}) {
  const productGids = [...new Set(snapshots.map((snapshot) => snapshot.productGid).filter(Boolean))];
  if (!productGids.length) return new Map();

  if (options.light) {
    const diagnoses = await prisma.$queryRaw`
      SELECT DISTINCT ON ("productGid")
        id,
        shop,
        "productGid",
        "productTitle",
        status,
        "riskScore",
        confidence,
        "likelyCause",
        "createdAt",
        "completedAt"
      FROM "ProductDiagnosis"
      WHERE shop = ${shop}
        AND status = 'Completed'
        AND "productGid" IN (${Prisma.join(productGids)})
      ORDER BY "productGid", "completedAt" DESC NULLS LAST, "createdAt" DESC
    `;

    return new Map(diagnoses.map((diagnosis) => [diagnosis.productGid, diagnosis]));
  }

  const diagnoses = await prisma.productDiagnosis.findMany({
    where: {
      shop,
      productGid: { in: productGids },
      status: "Completed",
    },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
  });

  const latestByProductGid = new Map();
  diagnoses.forEach((diagnosis) => {
    if (!latestByProductGid.has(diagnosis.productGid)) {
      latestByProductGid.set(diagnosis.productGid, diagnosis);
    }
  });
  return latestByProductGid;
}

async function getLatestDashboardDiagnosisMap(shop, snapshots = []) {
  const productGids = [...new Set(snapshots.map((snapshot) => snapshot.productGid).filter(Boolean))];
  if (!productGids.length) return new Map();

  const diagnoses = await prisma.$queryRaw`
    SELECT DISTINCT ON ("productGid")
      id,
      shop,
      "productGid",
      "productTitle",
      status,
      "riskScore",
      confidence,
      "likelyCause",
      recommendations,
      "createdAt",
      "completedAt"
    FROM "ProductDiagnosis"
    WHERE shop = ${shop}
      AND status = 'Completed'
      AND "productGid" IN (${Prisma.join(productGids)})
    ORDER BY "productGid", "completedAt" DESC NULLS LAST, "createdAt" DESC
  `;

  return new Map(diagnoses.map((diagnosis) => [diagnosis.productGid, diagnosis]));
}

async function getResolvedProductActionsMap(shop, snapshots = []) {
  const productGids = [...new Set(snapshots.map((snapshot) => snapshot.productGid).filter(Boolean))];
  if (!productGids.length) return new Map();

  const actions = await prisma.productAction.findMany({
    where: {
      shop,
      productGid: { in: productGids },
      actionType: { in: ["mark-resolved", "mark-unresolved"] },
      status: "applied",
    },
    select: {
      id: true,
      productGid: true,
      actionType: true,
      status: true,
      createdAt: true,
      appliedAt: true,
    },
    orderBy: [{ appliedAt: "desc" }, { createdAt: "desc" }],
  });

  const latestByProductGid = new Map();
  actions.forEach((action) => {
    if (latestByProductGid.has(action.productGid)) return;
    latestByProductGid.set(action.productGid, action.actionType === "mark-resolved" ? action : null);
  });
  return new Map([...latestByProductGid.entries()].filter(([, action]) => action));
}

export async function runSelectedProductDiagnosesForShop(shop, productIds = [], options = {}) {
  const uniqueProductIds = [...new Set(productIds.filter(Boolean))];
  if (!uniqueProductIds.length) {
    return { status: "validation_error", message: "Select at least one product to analyze." };
  }

  const snapshotBatch = await getProductDiagnosisSnapshotsForProductIds(shop, uniqueProductIds);
  const batchResult = await createProductDiagnosisJobsForSnapshots(shop, snapshotBatch.snapshots);
  const jobs = [...batchResult.jobs];
  const pointFailures = [...batchResult.pointFailures];

  for (const productId of snapshotBatch.unmatchedProductIds) {
    const job = await createProductDiagnosisJob(shop, productId, options);
    if (job?.pointValidationError) {
      pointFailures.push(job.pointValidationError);
      continue;
    }
    if (job) jobs.push(job);
  }

  if (!jobs.length) {
    const pointFailure = pointFailures[0];
    return {
      status: "validation_error",
      message: pointFailure?.message || "Selected products were not found in ProductPulse or Shopify.",
      pointBalance: pointFailure?.balance,
      batchMode: pointFailure?.batchMode || null,
    };
  }

  ensureProductDiagnosisQueueWorker(shop);
  const skippedForPoints = pointFailures.length;
  const batchJobIds = new Set(batchResult.jobs.map((job) => job.id).filter(Boolean));
  const fallbackCount = jobs.filter((job) => !batchJobIds.has(job.id)).length;
  const createdCount = batchResult.createdCount + fallbackCount;
  const reusedCount = batchResult.reusedCount;
  const messageParts = [];
  if (createdCount) messageParts.push(`${createdCount} Product Diagnosis job${createdCount === 1 ? "" : "s"} queued`);
  if (reusedCount) messageParts.push(`${reusedCount} already in queue or running`);
  if (skippedForPoints) messageParts.push(`${skippedForPoints} skipped because credits or Batch mode capacity were no longer available`);

  invalidateProductPulseDashboardCache(shop);
  return {
    status: "success",
    suppressBanner: true,
    message: `${messageParts.join(". ")}. They will run one at a time.`,
    invalidateDashboardCache: true,
    requestedCount: uniqueProductIds.length,
    queuedCount: jobs.length,
    createdCount,
    reusedCount,
    skippedCount: skippedForPoints,
    jobs: jobs.map(formatJob),
  };
}

export async function getRecentJobsForShop(shop) {
  await failStaleFastProductScans(shop);
  const [jobs, activeJobs] = await Promise.all([
    prisma.catalogSignalJob.findMany({
      where: { shop },
      orderBy: [{ updatedAt: "desc" }],
      take: JOB_MONITOR_RECENT_JOB_LIMIT,
    }),
    prisma.catalogSignalJob.findMany({
      where: { shop, status: { in: ["Queued", "Running"] } },
      orderBy: [{ status: "desc" }, { updatedAt: "desc" }],
    }),
  ]);
  ensureWorkersForJobs(shop, activeJobs);
  return jobs.map(formatJob);
}

export async function getJobMonitorForShop(shop, options = {}) {
  const perf = options.perf || null;
  const includeRecentJobs = options.includeRecentJobs !== false;
  const includeLogs = Boolean(options.includeLogs);
  const includePointSummary = options.includePointSummary !== false;
  const cacheOptions = { ...options, includeRecentJobs, includeLogs, includePointSummary };
  const cachedMonitor = getCachedJobMonitor(shop, cacheOptions);
  if (cachedMonitor) {
    perf?.mark("jobStatus.cache.hit", {
      activeJobs: cachedMonitor.activeJobs?.length || 0,
      recentJobs: cachedMonitor.recentJobs?.length || 0,
      logs: cachedMonitor.logs?.length || 0,
      activeJobCount: cachedMonitor.activeJobCount ?? cachedMonitor.activeJobs?.length ?? 0,
    });
    return cachedMonitor;
  }

  perf?.mark("jobStatus.cache.miss");
  await measureProductPulseStep(perf, "jobStatus.failStaleFastProductScans", () => failStaleFastProductScans(shop));
  const activeWhere = { shop, status: { in: ["Queued", "Running"] } };
  const [recentJobs, activeJobsRaw, logs, pointSummary, settingsForPointSummary] = await Promise.all([
    includeRecentJobs ? measureProductPulseStep(perf, "jobStatus.recentJobs", () => prisma.catalogSignalJob.findMany({
      where: { shop },
      orderBy: [{ updatedAt: "desc" }],
      take: JOB_MONITOR_RECENT_JOB_LIMIT,
    })) : [],
    measureProductPulseStep(perf, "jobStatus.activeJobs", () => prisma.catalogSignalJob.findMany({
      where: activeWhere,
      orderBy: [{ status: "desc" }, { updatedAt: "desc" }],
      take: JOB_MONITOR_ACTIVE_JOB_LIMIT + 1,
    })),
    includeLogs
      ? measureProductPulseStep(perf, "jobStatus.logs", () => getJobLogsForShop(shop, 100))
      : [],
    includePointSummary
      ? measureProductPulseStep(perf, "jobStatus.pointSummary", () => getStorePointSummaryForShop(shop, { limit: 3 }))
      : null,
    includePointSummary
      ? measureProductPulseStep(perf, "jobStatus.settingsForPointSummary", () => getProductPulseSettings(shop))
      : null,
  ]);
  const enrichedPointSummary = pointSummary
    ? withProductPulseBatchModeSummary(pointSummary, settingsForPointSummary)
    : null;
  const activeJobsLimited = activeJobsRaw.length > JOB_MONITOR_ACTIVE_JOB_LIMIT;
  const activeJobs = activeJobsLimited ? activeJobsRaw.slice(0, JOB_MONITOR_ACTIVE_JOB_LIMIT) : activeJobsRaw;
  const activeJobCount = activeJobsLimited
    ? await measureProductPulseStep(perf, "jobStatus.activeJobCount", () => prisma.catalogSignalJob.count({ where: activeWhere }))
    : activeJobs.length;
  ensureWorkersForJobs(shop, activeJobs);

  const monitor = {
    activeJobs: activeJobs.map(formatJob),
    activeJobCount,
    activeJobsLimited,
    recentJobs: recentJobs.map(formatJob),
    recentJobsLoaded: includeRecentJobs,
    logs: logs.map(formatJobLog),
    logsLoaded: includeLogs,
    pointBalance: enrichedPointSummary?.balance || null,
    pointSummary: enrichedPointSummary,
    pointSummaryLoaded: includePointSummary,
    updatedAt: new Date().toISOString(),
  };
  setCachedJobMonitor(shop, monitor, cacheOptions);
  return monitor;
}

export async function cancelBackgroundJobForShop(shop, jobId) {
  const normalizedJobId = String(jobId || "").trim();
  if (!normalizedJobId) {
    return { status: "validation_error", message: "Choose a background job to cancel." };
  }

  const job = await prisma.catalogSignalJob.findFirst({
    where: {
      shop,
      id: normalizedJobId,
    },
  });

  if (!job) {
    return { status: "validation_error", message: "That background job could not be found." };
  }

  if (!isActiveStatus(job.status)) {
    return { status: "validation_error", message: "Only queued or running jobs can be cancelled." };
  }

  const cancellationRefund = await refundCancelledQueuedProductDiagnosisJob(job);
  const cancellationPayload = cancellationRefund?.refunded
    ? {
      ...(job.payload || {}),
      creditsConsumed: 0,
      pointsConsumed: 0,
      pointRefundLedgerEntryId: cancellationRefund.ledgerEntry?.id || null,
      pointDebitStatus: "refunded",
    }
    : job.payload;

  await prisma.catalogSignalJob.updateMany({
    where: {
      shop,
      id: normalizedJobId,
      status: { in: ["Queued", "Running"] },
    },
    data: getTerminalLeaseData({
      status: "Failed",
      progress: 100,
      source: "Canceled by user",
      errorMessage: cancellationRefund?.refunded
        ? "Canceled from Background processes. Reserved credit was refunded."
        : "Canceled from Background processes. Any credits already consumed by the queued job are not automatically refunded.",
      payload: cancellationPayload,
      finishedAt: new Date(),
    }),
  });

  await recordJobLog({
    shop,
    jobId: normalizedJobId,
    event: "job.cancelled",
    message: "Background job was cancelled from the job monitor.",
    data: {
      kind: job.kind,
      previousStatus: job.status,
      pointCost: getJobPointCost(job),
      pointRefundStatus: cancellationRefund?.status || null,
      pointRefundLedgerEntryId: cancellationRefund?.ledgerEntry?.id || null,
    },
  });

  const updatedJob = await prisma.catalogSignalJob.findUnique({ where: { id: normalizedJobId } });
  invalidateJobMonitorCache(shop);
  invalidateProductPulseDashboardCache(shop);
  invalidateBackgroundProcessCache(shop);

  return {
    status: "success",
    suppressBanner: true,
    message: "Background job cancelled.",
    invalidateDashboardCache: true,
    job: updatedJob ? formatJob(updatedJob) : null,
  };
}

export async function handleOpenAiWebhookEventForProductPulse(event, headers = {}) {
  const batchResult = await processOpenAiBatchWebhookEvent(event, headers);
  if (!batchResult.groupReady || !batchResult.group?.id) return batchResult;

  const resumeResult = await resumeProductDiagnosisJobFromOpenAiBatchGroup(batchResult.group.id);
  return {
    ...batchResult,
    resumeResult,
  };
}

async function refundCancelledQueuedProductDiagnosisJob(job) {
  if (job.kind !== PRODUCT_DIAGNOSIS_KIND || job.status !== "Queued") return null;
  const payload = job.payload || {};
  if (!payload.pointLedgerEntryId || payload.pointRefundLedgerEntryId) return null;

  const amount = Number(payload.pointCost || payload.pointsConsumed || payload.creditsConsumed || 1);
  const refund = await creditStorePointsForShop(job.shop, {
    amount: Number.isFinite(amount) && amount > 0 ? amount : 1,
    reason: `Product Diagnosis refund credit product-diagnosis-cancel-refund:${job.id} - ${payload.productTitle || "selected product"}`,
    idempotencyKey: `product-diagnosis-cancel-refund:${job.id}`,
    metadata: {
      source: "product_diagnosis_refund",
      jobId: job.id,
      originalLedgerEntryId: payload.pointLedgerEntryId,
      productGid: payload.productGid || null,
      productTitle: payload.productTitle || null,
      cancelled: true,
    },
  });

  if (!isPointCreditRecorded(refund)) {
    await recordJobLog({
      shop: job.shop,
      jobId: job.id,
      level: "error",
      event: "product_diagnosis.points_refund_failed",
      message: refund.message || "Cancelled Product Diagnosis refund credit could not be recorded.",
      data: {
        pointRefundStatus: refund.status,
        pointBalance: refund.balance || null,
      },
    });
    return { status: refund.status, refunded: false, balance: refund.balance || null };
  }

  return {
    status: refund.status,
    refunded: true,
    ledgerEntry: refund.ledgerEntry || null,
    balance: refund.balance || null,
  };
}

export async function getBackgroundProcessesForShop(shop, options = {}) {
  const requestedPage = normalizeBackgroundProcessPage(options.page);
  const includeLogs = Boolean(options.includeLogs);
  const perf = options.perf || null;
  const cacheOptions = { ...options, page: requestedPage, includeLogs };
  const cachedBackgroundProcesses = getCachedBackgroundProcesses(shop, cacheOptions);
  if (cachedBackgroundProcesses) {
    perf?.mark("backgroundProcesses.cache.hit", {
      page: requestedPage,
      processes: cachedBackgroundProcesses.processes?.length || 0,
      activeProcesses: cachedBackgroundProcesses.activeProcesses?.length || 0,
      logs: cachedBackgroundProcesses.logs?.length || 0,
    });
    return cachedBackgroundProcesses;
  }

  perf?.mark("backgroundProcesses.cache.miss", { page: requestedPage, includeLogs });
  await measureProductPulseStep(perf, "backgroundProcesses.failStaleFastProductScans", () => failStaleFastProductScans(shop));
  const [total, statusGroups, kindGroups, logs] = await Promise.all([
    measureProductPulseStep(perf, "backgroundProcesses.total", () => prisma.catalogSignalJob.count({ where: { shop } })),
    measureProductPulseStep(perf, "backgroundProcesses.statusGroups", () => prisma.catalogSignalJob.groupBy({
      by: ["status"],
      where: { shop },
      _count: { _all: true },
    })),
    measureProductPulseStep(perf, "backgroundProcesses.kindGroups", () => prisma.catalogSignalJob.groupBy({
      by: ["kind"],
      where: { shop },
      _count: { _all: true },
    })),
    includeLogs
      ? measureProductPulseStep(perf, "backgroundProcesses.logs", () => getJobLogsForShop(shop, BACKGROUND_PROCESS_LOG_LIMIT))
      : [],
  ]);
  const page = clampBackgroundProcessPage(requestedPage, total);
  const [jobs, activeJobs] = await Promise.all([
    measureProductPulseStep(perf, "backgroundProcesses.pageJobs", () => prisma.catalogSignalJob.findMany({
      where: { shop },
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * BACKGROUND_PROCESS_PAGE_SIZE,
      take: BACKGROUND_PROCESS_PAGE_SIZE,
    })),
    measureProductPulseStep(perf, "backgroundProcesses.activeJobs", () => prisma.catalogSignalJob.findMany({
      where: { shop, status: { in: ["Queued", "Running"] } },
      orderBy: [{ updatedAt: "desc" }],
      take: JOB_MONITOR_ACTIVE_JOB_LIMIT,
    })),
  ]);

  ensureWorkersForJobs(shop, activeJobs);

  const formattedLogs = logs.map(formatJobLog);
  const logsByJob = groupJobLogsByJobId(formattedLogs);
  const processes = jobs.map((job) => formatBackgroundProcess(job, logsByJob.get(job.id) || []));
  const activeProcesses = activeJobs.map((job) => formatBackgroundProcess(job, logsByJob.get(job.id) || []));
  const statusCounts = mapBackgroundProcessStatusCounts(statusGroups);
  const kindCounts = mapBackgroundProcessKindCounts(kindGroups);

  const backgroundProcesses = {
    processes,
    activeProcesses,
    activeProcessesLimited: ((statusCounts.Running || 0) + (statusCounts.Queued || 0)) > activeProcesses.length,
    logs: formattedLogs,
    stats: buildBackgroundProcessStats(jobs, formattedLogs, {
      total,
      statusCounts,
      kindCounts,
    }),
    pagination: buildBackgroundProcessPagination(page, total),
    logsLimited: formattedLogs.length >= BACKGROUND_PROCESS_LOG_LIMIT,
    logLimit: BACKGROUND_PROCESS_LOG_LIMIT,
    updatedAt: new Date().toISOString(),
  };
  setCachedBackgroundProcesses(shop, backgroundProcesses, cacheOptions);
  return backgroundProcesses;
}

export async function getProductSnapshotForShop(shop, productId, admin) {
  const snapshot = await findProductRiskSnapshot(shop, productId);
  if (!snapshot) return null;

  const [actions, latestDiagnosis, activeDiagnosisJobs, settings, watchedItem, scoreHistory, timeline, navigation] = await Promise.all([
    prisma.productAction.findMany({
      where: { shop, productGid: snapshot.productGid },
      orderBy: [{ createdAt: "desc" }],
      take: 20,
    }),
    prisma.productDiagnosis.findFirst({
      where: { shop, productGid: snapshot.productGid, status: "Completed" },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    }),
    getActiveProductDiagnosisJobs(shop),
    getProductPulseSettings(shop),
    prisma.productWatchlistItem.findUnique({
      where: { shop_productGid: { shop, productGid: snapshot.productGid } },
      select: { status: true },
    }),
    getProductScoreHistoryForShop(shop, snapshot.productGid, { take: 180 }),
    getProductTimelineForShop(shop, snapshot.productGid, { limit: 100 }),
    getProductRiskNavigationForShop(shop, snapshot),
  ]);
  if (activeDiagnosisJobs.length) ensureProductDiagnosisQueueWorker(shop);
  const storedProductRetention = await getProductRetentionPayloadForDiagnosis({
    shopId: shop,
    productGid: snapshot.productGid,
    diagnosisId: latestDiagnosis?.id || snapshot.metrics?.latestDiagnosisId || "",
  });
  const productRetention = hasStoredProductRetentionPayload(storedProductRetention)
    ? storedProductRetention
    : snapshot.metrics?.productRetention || null;
  const snapshotWithRetention = productRetention
    ? {
      ...snapshot,
      metrics: {
        ...(snapshot.metrics || {}),
        productRetention,
        productRetentionSummary: productRetention.summary || null,
      },
    }
    : snapshot;
  const activeJob = findActiveProductDiagnosisJobForSnapshot(snapshot, activeDiagnosisJobs);
  const product = {
    ...formatSnapshotForDiagnosis(snapshotWithRetention, actions, latestDiagnosis, settings, watchedItem, scoreHistory),
    timeline,
    navigation,
    ...(activeJob ? { diagnosisJob: formatJob(activeJob) } : {}),
  };
  const productWithUrls = withShopifyAdminUrl(product, shop);
  const productWithRelationshipImages = await attachProductRelationshipImagesToDiagnosis(productWithUrls, admin);
  return attachProductImageToDiagnosis(productWithRelationshipImages, admin);
}

function hasStoredProductRetentionPayload(retention = null) {
  const summary = retention?.summary || {};
  return Boolean(
    retention?.run
      || Number(summary.totalCustomersAnalyzed || 0) > 0
      || Number(summary.totalProductOrdersAnalyzed || 0) > 0
      || (Array.isArray(retention?.dailyRetentionTrend) && retention.dailyRetentionTrend.length)
      || (Array.isArray(retention?.retentionHealthTrend) && retention.retentionHealthTrend.length)
      || (Array.isArray(retention?.ltvCurve) && retention.ltvCurve.length)
  );
}

export async function getProductDetailForShop(shop, productId, admin) {
  const snapshotProduct = await getProductSnapshotForShop(shop, productId, admin);
  if (snapshotProduct) return snapshotProduct;
  return getLiveShopifyProductDetail(productId, admin, shop);
}

export async function rerunProductDiagnosisForShop(shop, productId, options = {}) {
  return queueProductDiagnosisForShop(shop, productId, options);
}

export async function queueProductDiagnosisForShop(shop, productId, options = {}) {
  const job = await createProductDiagnosisJob(shop, productId, options);
  if (!job) return null;
  if (job.pointValidationError) {
    return {
      status: "validation_error",
      message: job.pointValidationError.message,
      pointBalance: job.pointValidationError.balance,
      batchMode: job.pointValidationError.batchMode || null,
    };
  }
  ensureProductDiagnosisQueueWorker(shop);

  invalidateProductPulseDashboardCache(shop);
  return {
    status: "success",
    suppressBanner: true,
    message: `Product Diagnosis queued for ${job.payload?.productTitle || "selected product"}.`,
    invalidateDashboardCache: true,
    job: formatJob(job),
  };
}

export async function searchShopifyProductsForDiagnosis(shop, admin, rawQuery) {
  const query = String(rawQuery || "").trim();
  if (query.length < 2) {
    return { status: "validation_error", query, message: "Type at least 2 characters to search Shopify products.", products: [] };
  }
  if (!admin?.graphql) {
    return { status: "validation_error", query, message: "Shopify Admin API is not available for product search.", products: [] };
  }

  try {
    const data = await shopifyGraphql(admin, `#graphql
      query ProductPulseSearchShopifyProducts($query: String!, $first: Int!) {
        products(first: $first, query: $query, sortKey: TITLE) {
          nodes {
            id
            title
            handle
            status
            vendor
            productType
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
            variants(first: 1) {
              nodes {
                sku
              }
            }
            collections(first: 3) {
              nodes {
                title
                handle
              }
            }
          }
        }
      }`,
      {
        query: buildShopifyProductSearchQuery(query),
        first: 12,
      },
    );
    const products = Array.isArray(data?.products?.nodes) ? data.products.nodes.filter(Boolean) : [];
    const productGids = products.map((product) => product.id).filter(Boolean);
    const existingSnapshots = products.length
      ? await prisma.productRiskSnapshot.findMany({
        where: { shop, productGid: { in: productGids } },
        select: { productGid: true, metrics: true },
      })
      : [];
    const completedDiagnoses = productGids.length
      ? await prisma.productDiagnosis.findMany({
        where: { shop, productGid: { in: productGids }, status: "Completed" },
        select: { productGid: true },
        distinct: ["productGid"],
      })
      : [];
    const searchStatusByProductGid = getSearchProductPulseStatusMap(existingSnapshots, completedDiagnoses);

    return {
      status: "success",
      query,
      products: products.map((product) => formatShopifyProductSearchResult(product, searchStatusByProductGid)),
      message: products.length ? `${products.length} Shopify product${products.length === 1 ? "" : "s"} found.` : "No Shopify products matched that search.",
    };
  } catch (error) {
    return {
      status: "validation_error",
      query,
      message: `Unable to search Shopify products: ${error.message}`,
      products: [],
    };
  }
}

export async function recordProductDetailActionForShop(shop, productId, actionId, payloadOverride = {}, admin = null) {
  const snapshot = await findProductRiskSnapshot(shop, productId);
  if (!snapshot) return null;
  if (isDisabledProductAction(actionId)) {
    return { status: "validation_error", message: "This recommended action is disabled." };
  }
  const descriptionChangesOverride = normalizeDescriptionChangesOverride(payloadOverride.descriptionChangesJson || payloadOverride.descriptionChanges);

  const metrics = snapshot.metrics || {};
  const latestDiagnosis = await prisma.productDiagnosis.findFirst({
    where: { shop, productGid: snapshot.productGid, status: "Completed" },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
  });
  const diagnosisRecommendations = filterDisabledProductActions(Array.isArray(latestDiagnosis?.recommendations) ? latestDiagnosis.recommendations : []);
  let action = null;
  if (actionId === "mark-resolved") {
    action = getResolvedAction(snapshot);
  } else if (actionId === "mark-unresolved") {
    action = getUnresolvedAction(snapshot);
  } else if (actionId === "ignore-issue") {
    action = getIgnoredIssueAction(snapshot, payloadOverride);
  } else if (actionId === "unignore-issue") {
    action = getUnignoredIssueAction(snapshot, payloadOverride);
  } else {
    action = diagnosisRecommendations.find((item) => item.id === actionId)
      || getSnapshotRecommendedActions(snapshot, metrics).find((item) => item.id === actionId);
  }

  if (!action && payloadOverride.actionStatus) {
    action = getSyntheticProductActionForRecord(actionId, payloadOverride);
  }

  if (!action && (payloadOverride.draftText || descriptionChangesOverride.length)) {
    const isDescriptionFallback = actionId === "product-description-changes" || payloadOverride.descriptionOperation || descriptionChangesOverride.length;
    action = {
      id: actionId || "custom-draft",
      label: payloadOverride.label || "Custom product action draft",
      type: isDescriptionFallback ? "PDP copy" : "ProductPulse draft",
      effort: "Low",
      status: "Draft",
      payload: {
        draftText: payloadOverride.draftText,
        ...(payloadOverride.field ? { field: payloadOverride.field } : {}),
        ...(payloadOverride.descriptionOperation ? { operation: payloadOverride.descriptionOperation } : {}),
        ...(descriptionChangesOverride.length ? { descriptionChangeGroup: true, descriptionChanges: descriptionChangesOverride } : {}),
      },
    };
  }

  if (!action) {
    return { status: "validation_error", message: "Recommended action was not found." };
  }

  const payload = {
    ...(action.payload || {}),
    ...(payloadOverride.draftText ? { draftText: payloadOverride.draftText } : {}),
    ...(payloadOverride.field ? { field: payloadOverride.field } : {}),
    ...(payloadOverride.tag ? { tag: payloadOverride.tag } : {}),
    ...(payloadOverride.actionVariant ? { actionVariant: payloadOverride.actionVariant } : {}),
    ...(payloadOverride.descriptionOperation ? { operation: payloadOverride.descriptionOperation } : {}),
    ...(descriptionChangesOverride.length ? { descriptionChangeGroup: true, descriptionChanges: descriptionChangesOverride } : {}),
    ...(payloadOverride.metafieldNamespace ? { metafieldNamespace: payloadOverride.metafieldNamespace } : {}),
    ...(payloadOverride.metafieldKey ? { metafieldKey: payloadOverride.metafieldKey } : {}),
    ...(payloadOverride.metafieldType ? { metafieldType: payloadOverride.metafieldType } : {}),
  };
  const recordActionId = action.id || actionId || payloadOverride.label || "product-action";
  const recordLabel = action.label || payloadOverride.label || actionId || "Product action";
  const equivalentActionIds = getProductActionEquivalentIds(action, actionId, payloadOverride);
  const equivalentActionLabels = getProductActionEquivalentLabels(action, payloadOverride);
  payload.sourceActionId = actionId || action.id || "";
  payload.canonicalActionId = recordActionId;
  payload.actionAliases = equivalentActionIds;
  const requestedStatus = normalizeProductActionRecordStatus(payloadOverride.actionStatus);
  const shouldApplyToShopify = payloadOverride.applyMode === "apply";
  const applyResult = shouldApplyToShopify
    ? await applyProductRecommendationAction({ admin, snapshot, action, payload })
    : null;
  if (applyResult?.status === "validation_error") return applyResult;
  const appliedProductReviewToast = getAppliedProductReviewToastMetadata({ shop, snapshot, applyResult });

  if (requestedStatus === "active") {
    const restoreMatchers = [
      ...(equivalentActionIds.length ? [{ actionType: { in: equivalentActionIds } }] : []),
      ...(equivalentActionLabels.length ? [{ label: { in: equivalentActionLabels } }] : []),
    ];
    const restoreWhere = {
      shop,
      productGid: snapshot.productGid,
      status: "dismissed",
      OR: restoreMatchers.length ? restoreMatchers : [{ actionType: recordActionId }],
    };
    if (latestDiagnosis?.id) restoreWhere.diagnosisId = latestDiagnosis.id;
    await prisma.productAction.updateMany({
      where: restoreWhere,
      data: {
        status: "active",
        appliedAt: null,
      },
    });
    invalidateProductPulseDashboardCache(shop);
    return {
      status: "success",
      message: `${recordLabel} was restored for ${snapshot.productTitle}.`,
      invalidateDashboardCache: true,
      action,
      actionRecordStatus: "active",
    };
  }

  const status = requestedStatus || (action.id === "ignore-issue" ? "ignored" : action.id === "mark-resolved" || action.id === "mark-unresolved" || action.id === "unignore-issue" || action.applyImmediately || applyResult ? "applied" : "draft");
  if (action.id === "ignore-issue") {
    const existingIssueActions = await prisma.productAction.findMany({
      where: {
        shop,
        productGid: snapshot.productGid,
        actionType: { in: ["ignore-issue", "unignore-issue"] },
        status: { in: ["ignored", "applied"] },
      },
      orderBy: [{ appliedAt: "desc" }, { createdAt: "desc" }],
      take: 100,
    });
    const issueKey = String(payload.issueKey || "").trim();
    if (issueKey && isIssueCurrentlyIgnoredInActionRecords(existingIssueActions, issueKey)) {
      return {
        status: "success",
        message: `${payload.issue || "Issue"} is already ignored for ${snapshot.productTitle}.`,
        action,
        suppressBanner: true,
      };
    }
  }
  if (["dismissed", "reviewed"].includes(status)) {
    const duplicateMatchers = [
      ...(equivalentActionIds.length ? [{ actionType: { in: equivalentActionIds } }] : []),
      ...(equivalentActionLabels.length ? [{ label: { in: equivalentActionLabels } }] : []),
    ];
    const duplicateWhere = {
      shop,
      productGid: snapshot.productGid,
      status,
      OR: duplicateMatchers.length ? duplicateMatchers : [{ actionType: recordActionId }],
    };
    if (latestDiagnosis?.id) duplicateWhere.diagnosisId = latestDiagnosis.id;
    const existingCompletedAction = await prisma.productAction.findFirst({
      where: duplicateWhere,
      orderBy: { createdAt: "desc" },
    });
    if (existingCompletedAction) {
      return {
        status: "success",
        message: `${recordLabel} is already ${status} for ${snapshot.productTitle}.`,
        action,
        actionRecordStatus: status,
        suppressBanner: true,
      };
    }
  }

  const actionRecord = await prisma.productAction.create({
    data: {
      shop,
      diagnosisId: latestDiagnosis?.id || null,
      productGid: snapshot.productGid,
      actionType: recordActionId,
      label: recordLabel,
      status,
      payload: applyResult ? { ...payload, appliedChange: applyResult.change } : payload,
      appliedAt: isCompletedProductActionStatus(status) ? new Date() : null,
    },
  });
  await recordTimelineForProductAction({ shop, snapshot, actionRecord, action });
  if (status === "applied" && ["mark-resolved", "mark-unresolved"].includes(recordActionId)) {
    await upsertProductPulseProductRollup(snapshot, { latestDiagnosis, resolvedAction: actionRecord }).catch(() => null);
  }

  invalidateProductPulseDashboardCache(shop);
  return {
    status: "success",
    message: applyResult?.message || (status === "ignored"
      ? `${payload.issue || "Issue"} ignored. Related recommendations are hidden for this product.`
      : action.id === "unignore-issue"
      ? `${payload.issue || "Issue"} restored for ${snapshot.productTitle}. Related recommendations are visible again.`
      : action.id === "mark-unresolved"
      ? `${snapshot.productTitle} was marked as unresolved.`
      : status === "applied"
      ? `${recordLabel} was applied for ${snapshot.productTitle}.`
      : status === "dismissed"
      ? `${recordLabel} was dismissed for ${snapshot.productTitle}.`
      : status === "reviewed"
      ? `${recordLabel} was marked as reviewed for ${snapshot.productTitle}.`
      : `${recordLabel} was saved as a draft for ${snapshot.productTitle}.`),
    invalidateDashboardCache: true,
    action,
    actionRecordStatus: status,
    ...appliedProductReviewToast,
  };
}

function getAppliedProductReviewToastMetadata({ shop, snapshot, applyResult } = {}) {
  if (!applyResult?.change) return {};
  const reviewUrl = getShopifyProductAdminUrl(shop, snapshot?.productGid);
  if (!reviewUrl) return {};
  return {
    reviewUrl,
    reviewLabel: "Open product in Shopify admin",
    reviewMessage: "Please open this product in Shopify admin and verify that the applied changes are correct.",
    toastDurationMs: 12000,
  };
}

export async function deleteProductAnalysisForShop(shop, productId) {
  const snapshot = await findProductRiskSnapshot(shop, productId);
  if (!snapshot) {
    return {
      status: "validation_error",
      message: "ProductPulse could not find a stored analysis for that product.",
    };
  }

  const productGid = snapshot.productGid;
  const productTitle = snapshot.productTitle;
  const productJobIds = await getProductAnalysisJobIdsForDeletion(shop, snapshot, productId);

  const deleted = await prisma.$transaction(async (tx) => {
    const actions = await tx.productAction.deleteMany({ where: { shop, productGid } });
    const diagnoses = await tx.productDiagnosis.deleteMany({ where: { shop, productGid } });
    const scoreHistory = await tx.productScoreHistory.deleteMany({ where: { shop, productGid } });
    const timelineEvents = await tx.productTimelineEvent.deleteMany({ where: { shop, productGid } });
    const watchActivities = await tx.productWatchActivity.deleteMany({ where: { shop, productGid } });
    const watchlistItems = await tx.productWatchlistItem.deleteMany({ where: { shop, productGid } });
    const snapshots = await tx.productRiskSnapshot.deleteMany({ where: { shop, productGid } });
    const jobLogs = productJobIds.length
      ? await tx.productPulseJobLog.deleteMany({ where: { shop, jobId: { in: productJobIds } } })
      : { count: 0 };
    const jobs = productJobIds.length
      ? await tx.catalogSignalJob.deleteMany({ where: { shop, id: { in: productJobIds } } })
      : { count: 0 };

    return {
      actions: actions.count,
      diagnoses: diagnoses.count,
      scoreHistory: scoreHistory.count,
      timelineEvents: timelineEvents.count,
      watchActivities: watchActivities.count,
      watchlistItems: watchlistItems.count,
      snapshots: snapshots.count,
      jobLogs: jobLogs.count,
      jobs: jobs.count,
    };
  });

  const deletedRecords = Object.values(deleted).reduce((sum, count) => sum + Number(count || 0), 0);

  invalidateProductPulseDashboardCache(shop);
  return {
    status: "success",
    message: `${productTitle} analysis was deleted from ProductPulse. To analyze it again, use Find Shopify product and run a new diagnosis.`,
    invalidateDashboardCache: true,
    action: {
      id: "delete-product-analysis",
      productGid,
      handle: snapshot.handle,
      deletedRecords,
    },
    deleted,
  };
}

async function getProductAnalysisJobIdsForDeletion(shop, snapshot, productId) {
  const keys = new Set([
    snapshot?.productGid,
    snapshot?.handle,
    productId,
  ].filter(Boolean).map(String));

  if (!keys.size) return [];

  const jobs = await prisma.catalogSignalJob.findMany({
    where: {
      shop,
      kind: PRODUCT_DIAGNOSIS_KIND,
    },
    select: {
      id: true,
      payload: true,
    },
  });

  return jobs
    .filter((job) => getProductDiagnosisJobKeys(job).some((key) => keys.has(key)))
    .map((job) => job.id);
}

function getSyntheticProductActionForRecord(actionId, payloadOverride = {}) {
  const id = String(actionId || "").trim();
  const label = String(payloadOverride.label || "").trim();
  const normalized = `${id} ${label}`.toLowerCase();
  if (!id && !label) return null;
  if (id === "review-product-evidence") return null;

  if (id === "product-description-changes" || /\b(description|pdp|copy|expectation|quality note)\b/.test(normalized)) {
    return {
      id: id || "product-description-changes",
      label: label || "Update product description",
      type: "PDP copy",
      effort: "Low",
      status: "Ready",
      payload: {
        descriptionChangeGroup: id === "product-description-changes",
        operation: "replace",
        shopifyField: "Product description",
      },
    };
  }

  return {
    id,
    label: label || id || "Product action",
    type: inferProductActionTypeFromText(normalized),
    effort: "Low",
    status: "Ready",
    payload: {},
  };
}

function normalizeDescriptionChangesOverride(value) {
  const rawChanges = (() => {
    if (Array.isArray(value)) return value;
    const text = String(value || "").trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();

  return rawChanges
    .map((change, index) => {
      const operation = ["replace", "prepend", "append"].includes(change?.operation) ? change.operation : "append";
      const text = String(change?.text || change?.draftText || "").trim();
      if (!text) return null;
      const id = String(change?.id || change?.actionId || `description-change-${index + 1}`).trim() || `description-change-${index + 1}`;
      return {
        id,
        actionId: String(change?.actionId || id).trim() || id,
        title: String(change?.title || getDescriptionOperationTextForChange(operation)).trim(),
        operation,
        operationLabel: String(change?.operationLabel || getDescriptionOperationTextForChange(operation)).trim(),
        text,
        preserveHtml: Boolean(change?.preserveHtml),
        descriptionReplacements: normalizeDescriptionReplacementOverrides(change?.descriptionReplacements),
      };
    })
    .filter(Boolean);
}

function normalizeDescriptionReplacementOverrides(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((replacement) => ({
      from: String(replacement?.from || "").trim(),
      to: String(replacement?.to || "").trim(),
      reason: String(replacement?.reason || "").trim(),
    }))
    .filter((replacement) => replacement.from && replacement.to);
}

function getDescriptionOperationTextForChange(operation = "") {
  if (operation === "replace") return "Rewrite product description";
  if (operation === "prepend") return "Add to top of description";
  if (operation === "append") return "Add to end of description";
  return "Update product description";
}

function inferProductActionTypeFromText(value = "") {
  if (/\b(tag|collection|workflow)\b/.test(value)) return "Workflow";
  if (/\b(variant|sku|option)\b/.test(value)) return "Product variant";
  if (/\b(title|seo|meta)\b/.test(value)) return "Product metadata";
  if (/\b(image|media|alt text)\b/.test(value)) return "Product media";
  if (/\b(price|inventory|status|draft|archive|unlisted)\b/.test(value)) return "Commercial control";
  return "ProductPulse workflow";
}

function getProductActionEquivalentIds(action = {}, actionId = "", payloadOverride = {}) {
  const payload = action.payload || {};
  const aliases = new Set([
    action.id,
    action.actionId,
    action.actionType,
    actionId,
    payload.sourceActionId,
    payload.canonicalActionId,
    ...(Array.isArray(payload.actionAliases) ? payload.actionAliases : []),
  ].map(normalizeProductActionAlias).filter(Boolean));

  const matchText = `${action.id || ""} ${action.actionId || ""} ${action.actionType || ""} ${action.type || ""} ${action.label || ""} ${action.title || ""} ${payloadOverride.label || ""} ${payloadOverride.field || ""} ${payload.operation || ""} ${payload.field || ""} ${payload.shopifyField || ""}`.toLowerCase();
  if (isProductDescriptionEquivalentAction(action, payloadOverride, matchText)) {
    aliases.add("product-description-changes");
  }
  if (/\b(faq)\b/.test(matchText)) aliases.add("create-product-faq");
  if (/\b(title|seo|metadata)\b/.test(matchText)) aliases.add("title-metadata");
  if (/\b(variant|sku|option)\b/.test(matchText)) aliases.add("variant-options");
  if (/\b(tag|collection)\b/.test(matchText)) aliases.add("workflow-tag");
  if (/\b(image|media|alt text)\b/.test(matchText)) aliases.add("media-alt-text");
  if (/\b(price|inventory|status|draft|archive|unlisted)\b/.test(matchText)) aliases.add("commercial-control");

  return [...aliases];
}

function isProductDescriptionEquivalentAction(action = {}, payloadOverride = {}, matchText = "") {
  const payload = action.payload || {};
  const fieldText = `${payloadOverride.field || ""} ${payload.field || ""} ${payload.shopifyField || ""}`.toLowerCase();
  if (/\bseo\b|meta description|seo description|seo title|search engine|search title/.test(fieldText)) return false;
  if (/\bmeta description|seo description|seo title|search title|metadata\b/.test(matchText)) return false;
  return action.id === "product-description-changes"
    || payload.descriptionChangeGroup
    || /\b(product description|descriptionhtml|body html|body_html|pdp|pdp copy|expectation note|quality note|fit note)\b/.test(matchText);
}

function getProductActionEquivalentLabels(action = {}, payloadOverride = {}) {
  return [...new Set([
    action.label,
    action.title,
    payloadOverride.label,
  ].map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeProductActionAlias(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isIssueCurrentlyIgnoredInActionRecords(actions = [], issueKey = "") {
  const normalizedKey = normalizeIgnoredIssueKey(issueKey);
  if (!normalizedKey) return false;
  const latest = actions.find((record) => {
    const payload = record.payload || {};
    const recordKey = normalizeIgnoredIssueKey(payload.issueKey || payload.issueCode || payload.issue || record.label || "");
    return recordKey === normalizedKey;
  });
  return latest?.actionType === "ignore-issue" && ["ignored", "applied"].includes(String(latest.status || "").toLowerCase());
}

function normalizeProductActionRecordStatus(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (["active", "pending"].includes(normalized)) return "active";
  if (["dismissed", "reviewed"].includes(normalized)) return normalized;
  return "";
}

function isCompletedProductActionStatus(status) {
  return ["applied", "ignored", "dismissed", "reviewed"].includes(String(status || "").toLowerCase());
}

async function applyProductRecommendationAction({ admin, snapshot, action, payload }) {
  if (!admin?.graphql) {
    return { status: "validation_error", message: "Shopify Admin access is required to apply this action." };
  }

  const htmlStyle = normalizeProductPulseHtmlStyle((await getProductPulseSettings(snapshot.shop)).htmlStyle);
  const normalizedType = String(action.type || "").toLowerCase();
  const normalizedId = String(action.id || "").toLowerCase();
  const normalizedField = String(payload.field || "").toLowerCase();

  if (isFaqRecommendationAction(action, payload)) {
    return applyFaqRecommendationAction({ admin, snapshot, action, payload, htmlStyle });
  }

  if (normalizedId.includes("add-to-watchlist")) {
    const result = await addWatchedProductForShop(snapshot.shop, {
      productGid: snapshot.productGid,
      title: snapshot.productTitle,
      handle: snapshot.handle,
      imageUrl: snapshot.metrics?.imageUrl || snapshot.metrics?.image || "",
      imageAlt: snapshot.productTitle,
    });
    if (result.status === "validation_error") return result;
    return {
      message: result.message || `${snapshot.productTitle} added to the watchlist.`,
      change: {
        target: "ProductPulse Watchlist",
        operation: "add",
        value: snapshot.productGid,
      },
    };
  }

  if (payload.collectionId || normalizedId.includes("related-product-collection")) {
    const collectionId = String(payload.collectionId || "").trim();
    const collectionName = String(payload.collectionName || "selected collection").replace(/\s+/g, " ").trim();
    if (!collectionId) return { status: "validation_error", message: "This collection action does not include a Shopify collection ID to apply." };
    const result = await addProductToCollection(admin, snapshot.productGid, collectionId);
    if (result.status === "validation_error") return result;
    return {
      message: `${snapshot.productTitle} was added to ${collectionName}.`,
      change: {
        target: "Collection membership",
        operation: "add",
        value: {
          collectionId,
          collectionName,
          productGid: snapshot.productGid,
          jobId: result.jobId || null,
        },
      },
    };
  }

  if (payload.tag || Array.isArray(payload.tags) || normalizedType.includes("tag")) {
    const tags = uniqueActionTags([...(Array.isArray(payload.tags) ? payload.tags : []), payload.tag]);
    if (!tags.length) return { status: "validation_error", message: "This action does not include a product tag to apply." };
    const result = await addProductTags(admin, snapshot.productGid, tags);
    if (result.status === "validation_error") return result;
    return {
      message: `${tags.length === 1 ? "Product tag" : "Product tags"} "${tags.join(", ")}" added to ${snapshot.productTitle}.`,
      change: {
        target: "Product tags",
        operation: "add",
        value: tags,
      },
    };
  }

  if (Array.isArray(payload.mediaUpdates) && payload.mediaUpdates.length) {
    const altText = String(payload.draftText || payload.mediaUpdates[0]?.suggestedAltText || "").replace(/\s+/g, " ").trim();
    const mediaUpdates = payload.mediaUpdates
      .map((item) => ({
        id: String(item.id || "").trim(),
        alt: altText,
      }))
      .filter((item) => item.id && item.alt);
    if (!mediaUpdates.length) return { status: "validation_error", message: "This media action does not include a media ID and alt text to apply." };
    const result = await updateProductMediaAltText(admin, snapshot.productGid, mediaUpdates);
    if (result.status === "validation_error") return result;
    return {
      message: `${mediaUpdates.length === 1 ? "Product media alt text was updated" : "Product media alt text was updated"} for ${snapshot.productTitle}.`,
      change: {
        target: "Product media alt text",
        operation: "set",
        value: mediaUpdates,
      },
    };
  }

  if (Array.isArray(payload.variantUpdates) && payload.variantUpdates.length) {
    const variantUpdates = normalizeVariantOptionUpdatesForApply(payload.variantUpdates);
    if (!variantUpdates.length) return { status: "validation_error", message: "This variant action does not include safe variant option values to apply." };
    const result = await updateProductVariantOptionValues(admin, snapshot.productGid, variantUpdates);
    if (result.status === "validation_error") return result;
    return {
      message: `${variantUpdates.length === 1 ? "Variant option was updated" : "Variant options were updated"} for ${snapshot.productTitle}.`,
      change: {
        target: "Product variants/options",
        operation: "set",
        value: variantUpdates,
      },
    };
  }

  if (payload.field === "seo.title" || normalizedId.includes("seo-title")) {
    const title = limitSeoText(payload.draftText || payload.draftTitle || "", SEO_TITLE_MAX_LENGTH);
    if (!title) return { status: "validation_error", message: "This SEO title action does not include text to apply." };
    const result = await updateProductFields(admin, snapshot.productGid, { seo: { title } });
    if (result.status === "validation_error") return result;
    return {
      message: `SEO title was updated for ${snapshot.productTitle}.`,
      change: {
        target: "SEO title",
        operation: "set",
        value: title,
      },
    };
  }

  if (payload.field === "seo.description" || normalizedId.includes("meta-description")) {
    const description = limitSeoText(payload.draftText || "", SEO_META_DESCRIPTION_MAX_LENGTH, { terminalPeriod: true });
    if (!description) return { status: "validation_error", message: "This meta description action does not include text to apply." };
    const result = await updateProductFields(admin, snapshot.productGid, { seo: { description } });
    if (result.status === "validation_error") return result;
    return {
      message: `Meta description was updated for ${snapshot.productTitle}.`,
      change: {
        target: "Meta description",
        operation: "set",
        value: description,
      },
    };
  }

  if (payload.draftHandle || payload.field === "handle" || normalizedId.includes("url-handle")) {
    const handle = String(payload.draftText || payload.draftHandle || "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!handle) return { status: "validation_error", message: "This URL handle action does not include a handle to apply." };
    const result = await updateProductFields(admin, snapshot.productGid, { handle, redirectNewHandle: payload.redirectNewHandle !== false });
    if (result.status === "validation_error") return result;
    return {
      message: `Product URL handle was updated for ${snapshot.productTitle}.`,
      change: {
        target: "URL handle",
        operation: "set",
        value: handle,
      },
    };
  }

  if (payload.draftTitle || payload.field === "title" || normalizedId.includes("title")) {
    const title = String(payload.draftText || payload.draftTitle || "").replace(/\s+/g, " ").trim();
    if (!title) return { status: "validation_error", message: "This title action does not include a title to apply." };
    const result = await updateProductFields(admin, snapshot.productGid, { title });
    if (result.status === "validation_error") return result;
    return {
      message: `Product title was updated for ${snapshot.productTitle}.`,
      change: {
        target: "Product title",
        operation: "set",
        value: title,
      },
    };
  }

  const isProductStatusAction = payload.productStatus
    || normalizedField === "status"
    || normalizedId.includes("product-status")
    || normalizedId.includes("set-product-status")
    || normalizedId.includes("set-product-to-draft")
    || normalizedId.includes("put-product-in-draft")
    || normalizedId.includes("archive-product")
    || normalizedType.includes("product status");

  if (isProductStatusAction) {
    const inferredStatus = normalizedId.includes("archive") ? "ARCHIVED" : normalizedId.includes("draft") ? "DRAFT" : "";
    const status = normalizeShopifyProductStatus(payload.productStatus || payload.draftText || inferredStatus);
    if (!status) return { status: "validation_error", message: "This status action does not include a valid Shopify product status." };
    const result = await updateProductFields(admin, snapshot.productGid, { status });
    if (result.status === "validation_error") return result;
    return {
      message: `Product status was set to ${status} for ${snapshot.productTitle}.`,
      change: {
        target: "Product status",
        operation: "set",
        value: status,
      },
    };
  }

  if (payload.field === "classification" || normalizedId.includes("product-classification")) {
    const parsed = parseClassificationDraft(payload.draftText || payload.value || "");
    const vendor = String(payload.draftVendor || parsed.vendor || "").replace(/\s+/g, " ").trim();
    const productType = String(payload.draftProductType || parsed.productType || "").replace(/\s+/g, " ").trim();
    const categoryId = String(payload.draftCategoryId || payload.categoryId || "").trim();
    const currentVendor = String(snapshot.metrics?.vendor || "").replace(/\s+/g, " ").trim();
    const currentProductType = String(snapshot.metrics?.productType || "").replace(/\s+/g, " ").trim();
    const currentCategoryId = String(snapshot.metrics?.categoryId || snapshot.metrics?.category?.id || "").trim();
    const productFields = {};
    if (vendor && vendor.toLowerCase() !== currentVendor.toLowerCase()) productFields.vendor = vendor;
    if (productType && productType.toLowerCase() !== currentProductType.toLowerCase()) productFields.productType = productType;
    if (categoryId && categoryId !== currentCategoryId) productFields.category = categoryId;
    if (!Object.keys(productFields).length) return { status: "validation_error", message: "This classification action does not include a new vendor, product type or Shopify category to apply." };
    const result = await updateProductFields(admin, snapshot.productGid, productFields);
    if (result.status === "validation_error") return result;
    return {
      message: `Product classification was updated for ${snapshot.productTitle}.`,
      change: {
        target: "Product classification",
        operation: "set",
        value: productFields,
      },
    };
  }

  if (payload.templateSuffix || payload.field === "templateSuffix" || normalizedId.includes("product-template")) {
    const templateSuffix = String(payload.draftText || payload.templateSuffix || "").trim();
    if (!templateSuffix) return { status: "validation_error", message: "This template action does not include a template suffix to apply." };
    const result = await updateProductFields(admin, snapshot.productGid, { templateSuffix });
    if (result.status === "validation_error") return result;
    return {
      message: `Product template was updated for ${snapshot.productTitle}.`,
      change: {
        target: "Product template",
        operation: "set",
        value: templateSuffix,
      },
    };
  }

  const productMetafields = getProductMetafieldsForApply(payload);
  if (productMetafields.length) {
    const result = await setProductMetafields(admin, snapshot.productGid, productMetafields);
    if (result.status === "validation_error") return result;
    return {
      message: `${productMetafields.length === 1 ? "Product metafield was saved" : "Product metafields were saved"} for ${snapshot.productTitle}.`,
      change: {
        target: "Product metafields",
        operation: "set",
        value: productMetafields,
      },
    };
  }

  if (Array.isArray(payload.descriptionChanges) && payload.descriptionChanges.length && (normalizedType.includes("pdp") || normalizedId.includes("description") || payload.descriptionChangeGroup)) {
    const currentProduct = await getProductDescriptionForUpdate(admin, snapshot.productGid);
    if (currentProduct.status === "validation_error") return currentProduct;
    const descriptionHtml = buildUpdatedProductDescriptionHtmlFromChanges({
      currentHtml: currentProduct.descriptionHtml || "",
      changes: payload.descriptionChanges,
      action,
      htmlStyle,
    });
    if (!descriptionHtml) return { status: "validation_error", message: "This description action does not include text to apply." };
    const result = await updateProductDescription(admin, snapshot.productGid, descriptionHtml);
    if (result.status === "validation_error") return result;
    return {
      message: `Selected product description changes were applied for ${snapshot.productTitle}.`,
      change: {
        target: "Product description",
        operation: "apply_grouped_changes",
        value: payload.descriptionChanges,
      },
    };
  }

  if (payload.draftText && (normalizedType.includes("pdp") || normalizedType.includes("faq") || normalizedId.includes("description") || normalizedId.includes("fit"))) {
    const operation = getDescriptionOperationForAction({ ...action, payload });
    const currentProduct = await getProductDescriptionForUpdate(admin, snapshot.productGid);
    if (currentProduct.status === "validation_error") return currentProduct;
    const descriptionHtml = buildUpdatedProductDescriptionHtml({
      currentHtml: currentProduct.descriptionHtml || "",
      draftText: payload.draftText,
      operation,
      action,
      htmlStyle,
    });
    const result = await updateProductDescription(admin, snapshot.productGid, descriptionHtml);
    if (result.status === "validation_error") return result;
    return {
      message: `${getDescriptionOperationLabel(operation)} for ${snapshot.productTitle}.`,
      change: {
        target: "Product description",
        operation,
        value: payload.draftText,
      },
    };
  }

  return { status: "validation_error", message: "This recommended action is not connected to an automatic Shopify product change yet." };
}

function uniqueActionTags(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function parseClassificationDraft(value = "") {
  const lines = String(value || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const result = {};
  lines.forEach((line) => {
    const [label, ...rest] = line.split(":");
    const normalizedLabel = String(label || "").trim().toLowerCase();
    const content = rest.join(":").trim();
    if (!content) return;
    if (normalizedLabel.includes("vendor")) result.vendor = content;
    if (normalizedLabel.includes("product type")) result.productType = content;
  });
  return result;
}

function normalizeShopifyProductStatus(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return ["ACTIVE", "DRAFT", "ARCHIVED", "UNLISTED"].includes(normalized) ? normalized : "";
}

async function getProductDescriptionForUpdate(admin, productGid) {
  try {
    const response = await admin.graphql(
      `#graphql
      query ProductPulseProductDescription($id: ID!) {
        product(id: $id) {
          id
          descriptionHtml
          tags
        }
      }`,
      { variables: { id: productGid } },
    );
    const json = await response.json();
    const userErrors = json.errors || [];
    if (userErrors.length) return { status: "validation_error", message: userErrors.map((error) => error.message).join(" ") };
    if (!json.data?.product) return { status: "validation_error", message: "Shopify product was not found." };
    return json.data.product;
  } catch (error) {
    return { status: "validation_error", message: `Unable to read product description: ${error.message}` };
  }
}

async function updateProductDescription(admin, productGid, descriptionHtml) {
  return updateProductFields(admin, productGid, { descriptionHtml }, "Unable to update product description");
}

async function updateProductMediaAltText(admin, productGid, mediaUpdates) {
  try {
    const response = await admin.graphql(
      `#graphql
      mutation ProductPulseUpdateProductMedia($productId: ID!, $media: [UpdateMediaInput!]!) {
        productUpdateMedia(productId: $productId, media: $media) {
          media {
            id
            alt
            status
          }
          mediaUserErrors {
            field
            message
            code
          }
        }
      }`,
      { variables: { productId: productGid, media: mediaUpdates } },
    );
    const json = await response.json();
    const errors = json.errors || json.data?.productUpdateMedia?.mediaUserErrors || [];
    if (errors.length) return { status: "validation_error", message: errors.map((error) => error.message).join(" ") };
    return { status: "success" };
  } catch (error) {
    return { status: "validation_error", message: `Unable to update product media alt text: ${error.message}` };
  }
}

async function updateProductFields(admin, productGid, productFields, errorPrefix = "Unable to update product") {
  try {
    const response = await admin.graphql(
      `#graphql
      mutation ProductPulseUpdateProductDescription($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product {
            id
            title
          }
          userErrors {
            field
            message
          }
        }
      }`,
      { variables: { product: { id: productGid, ...productFields } } },
    );
    const json = await response.json();
    const errors = json.errors || json.data?.productUpdate?.userErrors || [];
    if (errors.length) return { status: "validation_error", message: errors.map((error) => error.message).join(" ") };
    return { status: "success" };
  } catch (error) {
    return { status: "validation_error", message: `${errorPrefix}: ${error.message}` };
  }
}

function normalizeVariantOptionUpdatesForApply(updates = []) {
  return updates
    .map((update) => ({
      id: String(update.variantId || update.id || "").trim(),
      optionValues: Array.isArray(update.optionValues)
        ? update.optionValues.map((option) => ({
            optionName: String(option.optionName || option.name || "").trim(),
            currentName: String(option.currentValue || option.currentName || "").trim(),
            name: String(option.suggestedValue || option.value || "").trim(),
          })).filter((option) => option.optionName && option.name && !sameNormalizedText(option.currentName, option.name))
            .map(({ optionName, name }) => ({ optionName, name }))
        : [],
    }))
    .filter((update) => update.id && update.optionValues.length);
}

function sameNormalizedText(first = "", second = "") {
  return String(first || "").replace(/\s+/g, " ").trim().toLowerCase()
    === String(second || "").replace(/\s+/g, " ").trim().toLowerCase();
}

async function updateProductVariantOptionValues(admin, productGid, variantUpdates) {
  try {
    const response = await admin.graphql(
      `#graphql
      mutation ProductPulseUpdateProductVariants($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants {
            id
            title
          }
          userErrors {
            field
            message
          }
        }
      }`,
      { variables: { productId: productGid, variants: variantUpdates } },
    );
    const json = await response.json();
    const errors = json.errors || json.data?.productVariantsBulkUpdate?.userErrors || [];
    if (errors.length) return { status: "validation_error", message: errors.map((error) => error.message).join(" ") };
    return { status: "success" };
  } catch (error) {
    return { status: "validation_error", message: `Unable to update product variants: ${error.message}` };
  }
}

async function addProductTags(admin, productGid, tags) {
  try {
    const response = await admin.graphql(
      `#graphql
      mutation ProductPulseAddProductTags($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          node {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      { variables: { id: productGid, tags } },
    );
    const json = await response.json();
    const errors = json.errors || json.data?.tagsAdd?.userErrors || [];
    if (errors.length) return { status: "validation_error", message: errors.map((error) => error.message).join(" ") };
    return { status: "success" };
  } catch (error) {
    return { status: "validation_error", message: `Unable to add product tag: ${error.message}` };
  }
}

async function addProductToCollection(admin, productGid, collectionId) {
  try {
    const response = await admin.graphql(
      `#graphql
      mutation ProductPulseAddProductToCollection($id: ID!, $productIds: [ID!]!) {
        collectionAddProductsV2(id: $id, productIds: $productIds) {
          job {
            id
          }
          userErrors {
            field
            message
          }
        }
      }`,
      { variables: { id: collectionId, productIds: [productGid] } },
    );
    const json = await response.json();
    const errors = json.errors || json.data?.collectionAddProductsV2?.userErrors || [];
    if (errors.length) return { status: "validation_error", message: errors.map((error) => error.message).join(" ") };
    return {
      status: "success",
      jobId: json.data?.collectionAddProductsV2?.job?.id || null,
    };
  } catch (error) {
    return { status: "validation_error", message: `Unable to add product to collection: ${error.message}` };
  }
}

async function applyFaqRecommendationAction({ admin, snapshot, action, payload, htmlStyle }) {
  const variant = getFaqApplyVariant(payload);
  const faqItems = normalizeFaqItemsForApply(payload.faqItems, payload.draftText);
  if (!faqItems.length) {
    return { status: "validation_error", message: "This FAQ action does not include questions and answers to apply." };
  }

  if (isFaqMetafieldApplyVariant(variant)) {
    const metafield = getFaqMetafieldConfig(payload);
    const result = await setProductFaqMetafield(admin, snapshot.productGid, {
      namespace: metafield.namespace,
      key: metafield.key,
      type: metafield.type,
      faqItems,
      sourceActionId: action.id,
      htmlStyle,
    });
    if (result.status === "validation_error") return result;
    return {
      message: `Product FAQ metafield ${metafield.namespace}.${metafield.key} was saved for ${snapshot.productTitle}.`,
      change: {
        target: "Product metafield",
        operation: "set",
        value: buildProductPulseFaqHtml({ faqItems, variant: "description-section", action, htmlStyle }),
        namespace: metafield.namespace,
        key: metafield.key,
        type: metafield.type,
      },
    };
  }

  const currentProduct = await getProductDescriptionForUpdate(admin, snapshot.productGid);
  if (currentProduct.status === "validation_error") return currentProduct;
  const faqHtml = buildProductPulseFaqHtml({ faqItems, variant, action, htmlStyle });
  const mergedFaqHtml = payload.existingFaqDetected
    ? mergeFaqItemsIntoExistingDescriptionHtml({
        descriptionHtml: currentProduct.descriptionHtml || "",
        faqItems,
      })
    : "";
  const operation = mergedFaqHtml ? "merge-existing-faq" : variant;
  const descriptionHtml = mergedFaqHtml || [currentProduct.descriptionHtml || "", faqHtml].filter(Boolean).join("\n");
  const result = await updateProductDescription(admin, snapshot.productGid, descriptionHtml);
  if (result.status === "validation_error") return result;

  return {
    message: `${getFaqApplyVariantLabel(operation)} for ${snapshot.productTitle}.`,
    change: {
      target: "Product description",
      operation,
      value: faqItems,
      descriptionHtml,
    },
  };
}

function isFaqRecommendationAction(action, payload = {}) {
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""}`.toLowerCase();
  return normalized.includes("faq") || Array.isArray(payload.faqItems);
}

function getFaqApplyVariant(payload = {}) {
  const variant = String(payload.actionVariant || payload.defaultApplyMode || "").trim();
  if (variant === "metafield-json") return "metafield-html";
  if (["description-section", "description-collapsible", "description-modal", "metafield-html"].includes(variant)) return variant;
  return "description-collapsible";
}

function isFaqMetafieldApplyVariant(variant = "") {
  return variant === "metafield-html" || variant === "metafield-json";
}

function getFaqApplyVariantLabel(variant) {
  if (variant === "merge-existing-faq") return "Missing FAQ questions were added to the existing FAQ";
  if (variant === "description-section") return "Product FAQ section was appended";
  if (variant === "description-modal") return "Product FAQ modal block was appended";
  if (isFaqMetafieldApplyVariant(variant)) return "Product FAQ metafield was saved";
  return "Product FAQ was appended";
}

function normalizeFaqItemsForApply(faqItems = [], draftText = "") {
  const parsed = parseFaqText(draftText);
  if (parsed.length) return parsed.slice(0, 6);

  const structured = (Array.isArray(faqItems) ? faqItems : [])
    .map((item) => ({
      question: normalizeFaqQuestion(item?.question),
      answer: normalizeFaqAnswer(item?.answer),
    }))
    .filter((item) => item.question && item.answer);
  if (structured.length) return structured.slice(0, 6);

  return buildFallbackFaqItemsFromDraftText(draftText).slice(0, 6);
}

function parseFaqText(draftText = "") {
  const lines = String(draftText || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isFaqQuestionLine(line)) continue;
    const answerLines = [];
    for (let answerIndex = index + 1; answerIndex < lines.length; answerIndex += 1) {
      if (isFaqQuestionLine(lines[answerIndex])) break;
      answerLines.push(stripFaqAnswerPrefix(lines[answerIndex]));
      index = answerIndex;
    }
    const answer = answerLines.join(" ");
    if (answer) parsed.push({ question: normalizeFaqQuestion(stripFaqQuestionPrefix(line)), answer: normalizeFaqAnswer(answer) });
  }
  return parsed;
}

function buildFallbackFaqItemsFromDraftText(draftText = "") {
  const answer = normalizeFaqAnswer(draftText);
  if (answer.length < 24) return [];
  const question = inferFaqQuestionFromAnswer(answer);
  if (!question) return [];
  return [{ question: normalizeFaqQuestion(question), answer }];
}

function inferFaqQuestionFromAnswer(answer = "") {
  const normalized = String(answer || "").toLowerCase();
  if (/\b(case|cases|wallet flaps?|card sleeves?|ring holders?|pop-?grips?|metal plates?|bumpers?|raised case lips?|magsafe|magnetic|alignment|charging|charger)\b/i.test(normalized)) {
    return "Which phone cases may prevent proper alignment or charging?";
  }
  if (/\b(compatible|compatibility|works? with|adapter|device|model)\b/i.test(normalized)) {
    return "What should shoppers confirm about compatibility before ordering?";
  }
  if (/\b(size|sizing|fit|fits|measurements?|waist|chest|sleeve|inseam|between sizes)\b/i.test(normalized)) {
    return "What should shoppers know about fit before ordering?";
  }
  if (/\b(setup|install|installation|mount|assembly|assemble)\b/i.test(normalized)) {
    return "What setup details should shoppers confirm before ordering?";
  }
  return "What should shoppers know before ordering?";
}

function isFaqQuestionLine(line = "") {
  const stripped = stripFaqQuestionPrefix(line);
  return /^[Qq](?:uestion)?\s*[:.-]\s*/.test(String(line || "").trim()) || /[?？]$/.test(stripped);
}

function stripFaqQuestionPrefix(line = "") {
  return String(line || "").replace(/^[Qq](?:uestion)?\s*[:.-]\s*/, "").trim();
}

function stripFaqAnswerPrefix(line = "") {
  return String(line || "").replace(/^[Aa](?:nswer)?\s*[:.-]\s*/, "").trim();
}

function normalizeFaqQuestion(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return /[?？]$/.test(text) ? text : `${text}?`;
}

function normalizeFaqAnswer(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function buildProductPulseDomId(prefix, value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${prefix}-${normalized || "item"}`;
}

function buildProductPulseFaqHtml({ faqItems, variant, action, htmlStyle }) {
  const actionId = escapeHtml(action.id || "product-faq");
  const headingHtml = buildProductPulseCalloutHeading("Frequently asked questions");
  const itemsHtml = buildProductPulseFaqItemsHtml(faqItems);

  if (variant === "description-section") {
    return buildProductPulseStyledHtmlBlock({
      actionId,
      className: "productpulse-faq",
      title: "Frequently asked questions",
      contentHtml: `<dl style="margin:0;">\n${itemsHtml}\n</dl>`,
      htmlStyle,
    });
  }

  if (variant === "description-modal") {
    const modalId = buildProductPulseDomId("productpulse-faq-dialog", action.id || "product-faq");
    const escapedModalId = escapeHtml(modalId);
    const modalItemsHtml = faqItems.map((item, index) => (
      `<div style="${index > 0 ? "border-top:1px solid #e5e7eb;" : ""}padding:${index > 0 ? "14px" : "0"} 0 0;">\n<dt style="font-weight:800;color:#111827;font-size:15px;line-height:1.35;margin:0 0 6px;">${escapeHtml(item.question)}</dt>\n<dd style="margin:0;color:#475569;line-height:1.6;font-size:14px;">${escapeHtml(item.answer)}</dd>\n</div>`
    )).join("\n");
    const modalStyles = [
      "<style>",
      `#${escapedModalId}::backdrop{background:rgba(15,23,42,.44);backdrop-filter:blur(2px);}`,
      `#${escapedModalId}{box-sizing:border-box;max-width:min(720px,calc(100vw - 32px));width:min(720px,calc(100vw - 32px));max-height:calc(100vh - 48px);border:1px solid rgba(148,163,184,.38);border-radius:18px;padding:0;background:#ffffff;color:#111827;box-shadow:0 24px 80px rgba(15,23,42,.28);overflow:hidden;}`,
      `#${escapedModalId}[open]{display:block;}`,
      "</style>",
    ].join("");
    return buildProductPulseStyledHtmlBlock({
      actionId,
      className: "productpulse-faq",
      title: "Frequently asked questions",
      contentHtml: `${modalStyles}\n<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;">\n<div>\n${headingHtml}\n<p style="margin:0;color:#475569;line-height:1.55;font-size:14px;">Open a focused FAQ without expanding the full product description.</p>\n</div>\n<button type="button" onclick="var d=document.getElementById('${escapedModalId}');if(d&&d.showModal)d.showModal();" style="appearance:none;border:0;border-radius:999px;background:#eef2ff;color:#3730a3;font-weight:800;padding:10px 14px;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(99,102,241,.18);">View FAQ</button>\n</div>\n<dialog id="${escapedModalId}" aria-label="Frequently asked questions">\n<div style="padding:24px;max-height:calc(100vh - 48px);overflow:auto;background:linear-gradient(135deg,#ffffff 0%,#f8fafc 100%);">\n<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:16px;border-bottom:1px solid #e5e7eb;padding-bottom:14px;margin-bottom:16px;">\n<div>\n<p style="margin:0 0 6px;color:#4f46e5;font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;">Product FAQ</p>\n<h3 style="margin:0;color:#111827;font-size:22px;line-height:1.2;font-weight:850;">Frequently asked questions</h3>\n<p style="margin:8px 0 0;color:#64748b;font-size:14px;line-height:1.5;">Quick answers based on the product details and customer evidence.</p>\n</div>\n<form method="dialog" style="margin:0;">\n<button type="submit" aria-label="Close FAQ modal" style="appearance:none;width:38px;height:38px;border:1px solid #dbe3ef;border-radius:12px;background:#ffffff;color:#334155;font-size:22px;line-height:1;cursor:pointer;box-shadow:0 1px 2px rgba(15,23,42,.06);">&times;</button>\n</form>\n</div>\n<dl style="margin:0;display:grid;gap:0;">\n${modalItemsHtml}\n</dl>\n<form method="dialog" style="margin:22px 0 0;display:flex;justify-content:flex-end;">\n<button type="submit" style="appearance:none;border:0;border-radius:12px;background:#1f2937;color:#ffffff;font-weight:800;padding:11px 18px;cursor:pointer;box-shadow:0 8px 18px rgba(15,23,42,.18);">Close</button>\n</form>\n</div>\n</dialog>`,
      htmlStyle,
      includeHeading: false,
    });
  }

  return buildProductPulseStyledHtmlBlock({
    actionId,
    className: "productpulse-faq",
    title: "Frequently asked questions",
    contentHtml: `<details>\n<summary style="cursor:pointer;font-weight:700;color:#1d4ed8;">Frequently asked questions</summary>\n<dl style="margin:12px 0 0;">\n${itemsHtml}\n</dl>\n</details>`,
    htmlStyle,
    includeHeading: false,
  });
}

function buildProductPulseFaqItemsHtml(faqItems = []) {
  return (Array.isArray(faqItems) ? faqItems : []).map((item) => (
    `<dt style="font-weight:700;color:#111827;margin-top:12px;">${escapeHtml(item.question)}</dt>\n<dd style="margin:4px 0 0;color:#374151;line-height:1.55;">${escapeHtml(item.answer)}</dd>`
  )).join("\n");
}

function mergeFaqItemsIntoExistingDescriptionHtml({ descriptionHtml = "", faqItems = [] } = {}) {
  const html = String(descriptionHtml || "");
  const itemsHtml = buildProductPulseFaqItemsHtml(faqItems);
  if (!html.trim() || !itemsHtml) return "";

  const patterns = [
    /(<section\b[^>]*class=(?:"[^"]*productpulse-faq[^"]*"|'[^']*productpulse-faq[^']*')[^>]*>[\s\S]*?<dl\b[^>]*>)([\s\S]*?)(<\/dl>)/i,
    /(<details\b[^>]*>[\s\S]*?(?:faq|frequently asked questions)[\s\S]*?<dl\b[^>]*>)([\s\S]*?)(<\/dl>)/i,
    /((?:faq|frequently asked questions)[\s\S]{0,1500}<dl\b[^>]*>)([\s\S]*?)(<\/dl>)/i,
  ];

  for (const pattern of patterns) {
    if (!pattern.test(html)) continue;
    return html.replace(pattern, (_match, opening, existingItems, closing) => (
      `${opening}${String(existingItems || "").trim()}\n${itemsHtml}\n${closing}`
    ));
  }

  return "";
}

function getFaqMetafieldConfig(payload = {}) {
  const metafield = payload.metafield || {};
  return {
    namespace: normalizeShopifyMetafieldNamespace(payload.metafieldNamespace || metafield.namespace || "productpulse"),
    key: normalizeShopifyMetafieldKey(payload.metafieldKey || metafield.key || "faq_html"),
    type: "multi_line_text_field",
  };
}

function normalizeShopifyMetafieldNamespace(value) {
  return normalizeOptionalShopifyMetafieldNamespace(value) || "productpulse";
}

function normalizeOptionalShopifyMetafieldNamespace(value) {
  const normalized = String(value || "").trim();
  if (/^\$app(?::[a-zA-Z0-9_-]+)?$/.test(normalized)) return normalized;
  return normalized.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
}

function normalizeShopifyMetafieldKey(value) {
  return normalizeOptionalShopifyMetafieldKey(value) || "faq_html";
}

function normalizeOptionalShopifyMetafieldKey(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
}

async function setProductFaqMetafield(admin, productGid, { namespace, key, type, faqItems, sourceActionId, htmlStyle }) {
  try {
    const normalizedMetafield = {
      ownerId: productGid,
      namespace: normalizeShopifyMetafieldNamespace(namespace),
      key: normalizeShopifyMetafieldKey(key),
      type: type || "multi_line_text_field",
      value: buildProductPulseFaqHtml({
        faqItems,
        variant: "description-section",
        action: { id: sourceActionId || "product-faq-metafield" },
        htmlStyle,
      }),
      definitionName: "ProductPulse FAQ HTML",
      definitionDescription: "Generated ProductPulse FAQ HTML for this product.",
    };
    const definitionResult = await ensureProductMetafieldDefinitions(admin, [normalizedMetafield]);
    if (definitionResult.status === "validation_error") return definitionResult;

    const setResult = await setNormalizedProductMetafields(admin, [normalizedMetafield], {
      failurePrefix: "Unable to set product FAQ metafield",
    });
    if (setResult.status === "validation_error") return setResult;
    return { status: "success", metafields: setResult.metafields, definitions: definitionResult.definitions };
  } catch (error) {
    return { status: "validation_error", message: `Unable to set product FAQ metafield: ${error.message}` };
  }
}

function getProductMetafieldsForApply(payload = {}) {
  const explicitMetafields = normalizeProductMetafieldsForSet("", payload.metafields);
  if (explicitMetafields.length) {
    return explicitMetafields.map((metafield) => {
      const copy = { ...metafield };
      delete copy.ownerId;
      return copy;
    });
  }

  const fieldParts = parseProductMetafieldField(payload.field || payload.shopifyField);
  const namespace = normalizeOptionalShopifyMetafieldNamespace(payload.metafieldNamespace || fieldParts.namespace || "");
  const key = normalizeOptionalShopifyMetafieldKey(payload.metafieldKey || fieldParts.key || "");
  const type = String(payload.metafieldType || payload.type || "single_line_text_field").trim();
  const value = getMetafieldActionValue(payload);
  if (!namespace || !key || !type || !value) return [];
  return [{
    namespace,
    key,
    type,
    value,
    label: payload.label || payload.metafieldLabel || "",
    definitionName: payload.metafieldName || payload.metafieldLabel || payload.label || "",
    definitionDescription: payload.metafieldDescription || payload.description || "",
  }];
}

function parseProductMetafieldField(field = "") {
  const match = String(field || "").trim().match(/^product\.metafield\.([^.\s]+)\.([^.\s]+)$/i);
  if (!match) return { namespace: "", key: "" };
  return { namespace: match[1], key: match[2] };
}

function getMetafieldActionValue(payload = {}) {
  const value = payload.draftText ?? payload.value ?? payload.metafieldValue ?? payload.note ?? "";
  return typeof value === "string" ? value.trim() : JSON.stringify(value ?? "");
}

async function setProductMetafields(admin, productGid, metafields = []) {
  const normalizedMetafields = normalizeProductMetafieldsForSet(productGid, metafields);
  if (!normalizedMetafields.length) {
    return { status: "validation_error", message: "This metafield action does not include valid metafields to save." };
  }

  try {
    const definitionResult = await ensureProductMetafieldDefinitions(admin, normalizedMetafields);
    if (definitionResult.status === "validation_error") return definitionResult;
    const setResult = await setNormalizedProductMetafields(admin, normalizedMetafields, {
      failurePrefix: "Unable to set product metafields",
    });
    if (setResult.status === "validation_error") return setResult;
    return { status: "success", metafields: setResult.metafields, definitions: definitionResult.definitions };
  } catch (error) {
    return { status: "validation_error", message: `Unable to set product metafields: ${error.message}` };
  }
}

function normalizeProductMetafieldsForSet(productGid, metafields = []) {
  return (Array.isArray(metafields) ? metafields : [])
    .map((metafield) => ({
      ownerId: productGid || metafield.ownerId || "",
      namespace: normalizeOptionalShopifyMetafieldNamespace(metafield.namespace || "productpulse"),
      key: normalizeOptionalShopifyMetafieldKey(metafield.key || ""),
      type: normalizeShopifyMetafieldType(metafield.type || "single_line_text_field"),
      value: normalizeShopifyMetafieldValue(metafield.value, metafield.type || "single_line_text_field"),
      label: String(metafield.label || "").replace(/\s+/g, " ").trim(),
      definitionName: String(metafield.definitionName || metafield.name || metafield.label || "").replace(/\s+/g, " ").trim(),
      definitionDescription: String(metafield.definitionDescription || metafield.description || "").replace(/\s+/g, " ").trim(),
    }))
    .filter((metafield) => metafield.namespace && metafield.key && metafield.type && metafield.value !== "");
}

function normalizeShopifyMetafieldType(type = "") {
  return String(type || "single_line_text_field").trim() || "single_line_text_field";
}

function normalizeShopifyMetafieldValue(value, type = "") {
  if (typeof value === "string") return value.trim();
  if (String(type || "").trim() === "json") return JSON.stringify(value ?? {});
  return JSON.stringify(value ?? "");
}

async function ensureProductMetafieldDefinitions(admin, metafields = []) {
  const definitions = [];
  const uniqueMetafields = uniqueProductMetafields(metafields);
  for (const metafield of uniqueMetafields) {
    const existing = await getProductMetafieldDefinition(admin, metafield);
    if (existing.status === "validation_error") return existing;
    if (existing.definition) {
      const existingType = existing.definition.type?.name || existing.definition.type || "";
      if (existingType && existingType !== metafield.type) {
        return {
          status: "validation_error",
          message: `Unable to set product metafield ${metafield.namespace}.${metafield.key}: the existing Shopify metafield definition uses type ${existingType}, but this action tried to write ${metafield.type}.`,
        };
      }
      definitions.push({ ...existing.definition, created: false });
      continue;
    }
    const created = await createProductMetafieldDefinition(admin, metafield);
    if (created.status === "validation_error") return created;
    if (created.definition) definitions.push({ ...created.definition, created: true });
  }
  return { status: "success", definitions };
}

function uniqueProductMetafields(metafields = []) {
  const seen = new Set();
  return (Array.isArray(metafields) ? metafields : []).filter((metafield) => {
    const key = `${metafield.namespace}.${metafield.key}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function getProductMetafieldDefinition(admin, metafield = {}) {
  try {
    const response = await admin.graphql(
      `#graphql
      query ProductPulseFindProductMetafieldDefinition($namespace: String!, $key: String!) {
        metafieldDefinitions(first: 1, ownerType: PRODUCT, namespace: $namespace, key: $key) {
          edges {
            node {
              id
              namespace
              key
              name
              type {
                name
              }
            }
          }
        }
      }`,
      { variables: { namespace: metafield.namespace, key: metafield.key } },
    );
    const json = await response.json();
    const errors = getShopifyGraphqlErrors(json, "metafieldDefinitions");
    if (errors.length) return { status: "validation_error", message: formatShopifyMetafieldErrorMessage(`Unable to inspect product metafield definition ${metafield.namespace}.${metafield.key}`, errors) };
    return {
      status: "success",
      definition: json.data?.metafieldDefinitions?.edges?.[0]?.node || null,
    };
  } catch (error) {
    return { status: "validation_error", message: `Unable to inspect product metafield definition ${metafield.namespace}.${metafield.key}: ${error.message}` };
  }
}

async function createProductMetafieldDefinition(admin, metafield = {}) {
  const definition = {
    namespace: metafield.namespace,
    key: metafield.key,
    name: getProductMetafieldDefinitionName(metafield),
    description: metafield.definitionDescription || `ProductPulse managed field for ${metafield.namespace}.${metafield.key}.`,
    type: metafield.type,
    ownerType: "PRODUCT",
  };
  if (String(metafield.namespace || "").startsWith("$app")) {
    definition.access = { admin: "MERCHANT_READ_WRITE" };
  }

  try {
    const response = await admin.graphql(
      `#graphql
      mutation ProductPulseCreateProductMetafieldDefinition($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition {
            id
            namespace
            key
            name
            type {
              name
            }
          }
          userErrors {
            field
            message
            code
          }
        }
      }`,
      { variables: { definition } },
    );
    const json = await response.json();
    const errors = getShopifyGraphqlErrors(json, "metafieldDefinitionCreate");
    if (errors.length) {
      if (errors.some((error) => String(error.code || "").toUpperCase() === "TAKEN")) {
        const existing = await getProductMetafieldDefinition(admin, metafield);
        if (existing.status === "validation_error" || !existing.definition) {
          return { status: "validation_error", message: formatShopifyMetafieldErrorMessage(`Unable to create product metafield definition ${metafield.namespace}.${metafield.key}`, errors) };
        }
        return { status: "success", definition: existing.definition };
      }
      return { status: "validation_error", message: formatShopifyMetafieldErrorMessage(`Unable to create product metafield definition ${metafield.namespace}.${metafield.key}`, errors) };
    }
    const definitionNode = json.data?.metafieldDefinitionCreate?.createdDefinition || null;
    if (!definitionNode) {
      return { status: "validation_error", message: `Shopify did not confirm creation of product metafield definition ${metafield.namespace}.${metafield.key}. The metafield value was not saved.` };
    }
    return { status: "success", definition: definitionNode };
  } catch (error) {
    return { status: "validation_error", message: `Unable to create product metafield definition ${metafield.namespace}.${metafield.key}: ${error.message}` };
  }
}

function getProductMetafieldDefinitionName(metafield = {}) {
  const explicit = String(metafield.definitionName || metafield.label || "").replace(/\s+/g, " ").trim();
  if (explicit) return explicit.slice(0, 255);
  return humanizeMetafieldKey(`${metafield.namespace || "productpulse"} ${metafield.key || "field"}`).slice(0, 255);
}

function humanizeMetafieldKey(value = "") {
  return String(value || "")
    .replace(/^\$app(?::)?/i, "App ")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

async function setNormalizedProductMetafields(admin, normalizedMetafields = [], { failurePrefix = "Unable to set product metafields" } = {}) {
  const mutationMetafields = normalizedMetafields.map((metafield) => ({
    ownerId: metafield.ownerId,
    namespace: metafield.namespace,
    key: metafield.key,
    type: metafield.type,
    value: metafield.value,
  }));
  if (!mutationMetafields.every((metafield) => metafield.ownerId)) {
    return { status: "validation_error", message: `${failurePrefix}: missing Shopify product ID for metafield write.` };
  }

  try {
    const response = await admin.graphql(
      `#graphql
      mutation ProductPulseSetProductMetafields($metafields: [MetafieldsSetInput!]!) {
        metafieldsSet(metafields: $metafields) {
          metafields {
            id
            namespace
            key
            type
            value
          }
          userErrors {
            field
            message
            code
          }
        }
      }`,
      { variables: { metafields: mutationMetafields } },
    );
    const json = await response.json();
    const errors = getShopifyGraphqlErrors(json, "metafieldsSet");
    if (errors.length) return { status: "validation_error", message: formatShopifyMetafieldErrorMessage(failurePrefix, errors) };
    const savedMetafields = Array.isArray(json.data?.metafieldsSet?.metafields)
      ? json.data.metafieldsSet.metafields.filter(Boolean)
      : [];
    if (savedMetafields.length < mutationMetafields.length) {
      return {
        status: "validation_error",
        message: `${failurePrefix}: Shopify did not confirm that all product metafields were saved. No success state was recorded.`,
      };
    }
    return { status: "success", metafields: savedMetafields };
  } catch (error) {
    return { status: "validation_error", message: `${failurePrefix}: ${error.message}` };
  }
}

function getShopifyGraphqlErrors(json = {}, payloadKey = "") {
  return [
    ...(Array.isArray(json.errors) ? json.errors : []),
    ...(Array.isArray(json.data?.[payloadKey]?.userErrors) ? json.data[payloadKey].userErrors : []),
  ].filter(Boolean);
}

function formatShopifyMetafieldErrorMessage(prefix = "Unable to set product metafields", errors = []) {
  const details = (Array.isArray(errors) ? errors : [])
    .map((error) => {
      const code = error.code ? ` (${error.code})` : "";
      const field = Array.isArray(error.field) && error.field.length ? ` [${error.field.join(".")}]` : "";
      return `${error.message || "Unknown Shopify error"}${code}${field}`;
    })
    .filter(Boolean)
    .join(" ");
  return `${prefix}: ${details || "Shopify returned an unknown error."}`;
}

function getDescriptionOperationForAction(action) {
  const payload = action.payload || {};
  if (["replace", "prepend", "append"].includes(payload.operation)) return payload.operation;
  if (["replace", "prepend", "append"].includes(payload.descriptionOperation)) return payload.descriptionOperation;
  if (["replace", "prepend", "append"].includes(payload.insertionPosition)) return payload.insertionPosition;
  if (["prepend", "append"].includes(payload.placement)) return payload.placement;
  const normalized = `${action.id || ""} ${action.type || ""} ${action.label || ""}`.toLowerCase();
  if (normalized.includes("rewrite-product-description") || normalized.includes("rewrite")) return "replace";
  if (normalized.includes("faq")) return "append";
  return "prepend";
}

function getDescriptionOperationLabel(operation) {
  if (operation === "replace") return "Product description was updated";
  if (operation === "append") return "Product description was appended";
  return "Product description was updated";
}

function buildUpdatedProductDescriptionHtml({ currentHtml, draftText, operation, action, htmlStyle }) {
  if (operation === "replace" && action?.payload?.preserveHtml && currentHtml) {
    const preservedHtml = buildPreservedProductDescriptionHtmlUpdate({
      currentHtml,
      draftText,
      action,
      htmlStyle,
    });
    if (preservedHtml) return preservedHtml;
  }
  if (operation === "replace" && currentHtml) {
    const placementDraft = extractPlacedDescriptionDraft({
      currentText: stripHtml(currentHtml),
      draftText,
    });
    if (placementDraft) {
      const blocks = [];
      if (placementDraft.prependText) blocks.push(buildProductPulseDescriptionBlock(placementDraft.prependText, action, htmlStyle));
      blocks.push(currentHtml);
      if (placementDraft.appendText) blocks.push(buildProductPulseDescriptionBlock(placementDraft.appendText, action, htmlStyle));
      return blocks.filter(Boolean).join("\n");
    }
  }
  if (operation === "replace") return buildProductPulseDescriptionReplacement(draftText, action, htmlStyle);
  const suggestionHtml = buildProductPulseDescriptionBlock(draftText, action, htmlStyle);
  if (operation === "append") return [currentHtml, suggestionHtml].filter(Boolean).join("\n");
  return [suggestionHtml, currentHtml].filter(Boolean).join("\n");
}

function buildUpdatedProductDescriptionHtmlFromChanges({ currentHtml, changes = [], action, htmlStyle }) {
  const normalizedChanges = normalizeDescriptionChangesOverride(changes);
  if (!normalizedChanges.length) return "";

  const prependChanges = normalizedChanges.filter((change) => change.operation === "prepend");
  const replacementChange = normalizedChanges.find((change) => change.operation === "replace");
  const appendChanges = normalizedChanges.filter((change) => change.operation === "append");
  const blocks = [];

  prependChanges.forEach((change) => {
    blocks.push(buildProductPulseDescriptionBlock(change.text, buildDescriptionChangeAction(action, change), htmlStyle));
  });

  if (replacementChange) {
    const replacementAction = buildDescriptionChangeAction(action, replacementChange);
    const preservedReplacementHtml = currentHtml && replacementAction.payload?.preserveHtml
      ? buildPreservedProductDescriptionHtmlUpdate({
        currentHtml,
        draftText: replacementChange.text,
        action: replacementAction,
        htmlStyle,
      })
      : "";
    if (preservedReplacementHtml) {
      blocks.push(preservedReplacementHtml);
    } else if (currentHtml) {
      const placementDraft = extractPlacedDescriptionDraft({
        currentText: stripHtml(currentHtml),
        draftText: replacementChange.text,
      });
      if (placementDraft) {
        if (placementDraft.prependText) blocks.push(buildProductPulseDescriptionBlock(placementDraft.prependText, replacementAction, htmlStyle));
        blocks.push(currentHtml);
        if (placementDraft.appendText) blocks.push(buildProductPulseDescriptionBlock(placementDraft.appendText, replacementAction, htmlStyle));
      } else {
        blocks.push(buildProductPulseDescriptionReplacement(replacementChange.text, replacementAction, htmlStyle));
      }
    } else {
      blocks.push(buildProductPulseDescriptionReplacement(replacementChange.text, replacementAction, htmlStyle));
    }
  } else if (currentHtml) {
    blocks.push(currentHtml);
  }

  appendChanges.forEach((change) => {
    blocks.push(buildProductPulseDescriptionBlock(change.text, buildDescriptionChangeAction(action, change), htmlStyle));
  });

  return blocks.filter(Boolean).join("\n");
}

function buildDescriptionChangeAction(action = {}, change = {}) {
  const id = change.actionId || change.id || action.id || "product-description-change";
  return {
    ...action,
    id,
    label: change.title || action.label,
    payload: {
      ...(action.payload || {}),
      operation: change.operation,
      preserveHtml: Boolean(change.preserveHtml || action.payload?.preserveHtml),
      ...(Array.isArray(change.descriptionReplacements) && change.descriptionReplacements.length
        ? { descriptionReplacements: change.descriptionReplacements }
        : {}),
    },
  };
}

function buildPreservedProductDescriptionHtmlUpdate({ currentHtml = "", draftText = "", action = {} } = {}) {
  const current = String(currentHtml || "").trim();
  if (!current) return "";
  const replacements = normalizeDescriptionReplacementOverrides(action?.payload?.descriptionReplacements);

  if (replacements.length) {
    const patchedHtml = applyDescriptionHtmlReplacements(current, replacements);
    if (patchedHtml.changed) return patchedHtml.html;

    const additionHtml = applyDescriptionHtmlAdditionsFromReplacements({
      currentHtml: current,
      replacements,
    });
    if (additionHtml.changed) return additionHtml.html;
  }

  const placementDraft = extractPlacedDescriptionDraft({
    currentText: stripHtml(current),
    draftText,
  });
  if (placementDraft) {
    const blocks = [];
    if (placementDraft.prependText) blocks.push(buildProductPulseDescriptionBodyHtml(placementDraft.prependText));
    blocks.push(current);
    if (placementDraft.appendText) blocks.push(buildProductPulseDescriptionBodyHtml(placementDraft.appendText));
    return blocks.filter(Boolean).join("\n");
  }

  const missingDraftText = extractMissingDescriptionDraftText({
    currentText: stripHtml(current),
    draftText,
  });
  if (missingDraftText) {
    return [current, buildProductPulseDescriptionBodyHtml(missingDraftText)].filter(Boolean).join("\n");
  }

  return "";
}

function applyDescriptionHtmlAdditionsFromReplacements({ currentHtml = "", replacements = [] } = {}) {
  let html = String(currentHtml || "");
  let changed = false;

  normalizeDescriptionReplacementOverrides(replacements).forEach((replacement) => {
    const addition = getDescriptionReplacementAddedText(replacement);
    if (!addition || isDescriptionTextCovered(addition, stripHtml(html))) return;
    const insertion = insertDescriptionHtmlAfterAnchor({
      currentHtml: html,
      anchorText: replacement.from,
      insertionHtml: buildProductPulseDescriptionBodyHtml(addition),
    });
    if (!insertion.changed) return;
    html = insertion.html;
    changed = true;
  });

  return { html, changed };
}

function getDescriptionReplacementAddedText(replacement = {}) {
  const from = String(replacement.from || "").trim();
  const to = String(replacement.to || "").trim();
  if (!from || !to) return "";
  const normalizedFrom = normalizeDescriptionComparisonText(from);
  const normalizedTo = normalizeDescriptionComparisonText(to);
  if (!normalizedFrom || !normalizedTo || !normalizedTo.startsWith(normalizedFrom)) return "";
  return to.slice(from.length).replace(/^[\s:;,.-]+/, "").trim();
}

function insertDescriptionHtmlAfterAnchor({ currentHtml = "", anchorText = "", insertionHtml = "" } = {}) {
  const html = String(currentHtml || "");
  const insertion = String(insertionHtml || "").trim();
  if (!html || !insertion) return { html, changed: false };
  const match = findBestDescriptionHtmlBlockMatch(html, anchorText);
  if (!match) return { html: [html, insertion].filter(Boolean).join("\n"), changed: true };
  return {
    html: `${html.slice(0, match.end)}\n${insertion}${html.slice(match.end)}`,
    changed: true,
  };
}

function findBestDescriptionHtmlBlockMatch(html = "", anchorText = "") {
  const patterns = [
    /<(?<tag>p|li|td|th|dd|dt|h[1-6])\b[^>]*>[\s\S]*?<\/\k<tag>>/gi,
    /<(?<tag>div|section|article)\b[^>]*>[\s\S]*?<\/\k<tag>>/gi,
  ];
  for (const blockPattern of patterns) {
    let best = null;
    let match = blockPattern.exec(String(html || ""));
    while (match) {
      const blockHtml = match[0] || "";
      const blockText = stripHtml(blockHtml);
      const score = getDescriptionTextMatchScore(blockText, anchorText);
      if (score >= 0.58 && (!best || score > best.score)) {
        best = {
          start: match.index,
          end: match.index + blockHtml.length,
          score,
        };
      }
      match = blockPattern.exec(String(html || ""));
    }
    if (best) return best;
  }
  return null;
}

function getDescriptionTextMatchScore(first = "", second = "") {
  const firstNormalized = normalizeDescriptionComparisonText(first);
  const secondNormalized = normalizeDescriptionComparisonText(second);
  if (!firstNormalized || !secondNormalized) return 0;
  if (firstNormalized === secondNormalized) return 1;
  if (firstNormalized.includes(secondNormalized) || secondNormalized.includes(firstNormalized)) return 0.95;
  const firstTokens = new Set(firstNormalized.split(/\s+/).filter((token) => token.length > 3));
  const secondTokens = secondNormalized.split(/\s+/).filter((token) => token.length > 3);
  if (!firstTokens.size || !secondTokens.length) return 0;
  const shared = secondTokens.filter((token) => firstTokens.has(token)).length;
  return shared / secondTokens.length;
}

function extractMissingDescriptionDraftText({ currentText = "", draftText = "" } = {}) {
  const current = String(currentText || "").trim();
  const units = splitDescriptionDraftUnits(draftText);
  if (!current || units.length < 2) return "";
  const missingUnits = units.filter((unit) => !isDescriptionTextCovered(unit, current));
  if (!missingUnits.length || missingUnits.length === units.length) return "";
  return missingUnits.join("\n\n").trim();
}

function splitDescriptionDraftUnits(value = "") {
  return String(value || "")
    .split(/\n{2,}/)
    .flatMap((block) => String(block || "").split(/(?<=[.!?])\s+/))
    .map((unit) => unit.trim())
    .filter((unit) => unit && (unit.length >= 18 || unit.split(/\s+/).length >= 3));
}

function isDescriptionTextCovered(proposed = "", current = "") {
  return getDescriptionTextMatchScore(current, proposed) >= 0.78;
}

function applyDescriptionHtmlReplacements(currentHtml, replacements = []) {
  const parts = String(currentHtml || "").split(/(<[^>]+>)/g);
  let changed = false;
  const html = parts.map((part) => {
    if (!part || part.startsWith("<")) return part;
    const next = applyTextReplacements(part, replacements);
    if (next !== part) changed = true;
    return next;
  }).join("");
  return { html, changed };
}

function applyTextReplacements(value, replacements = []) {
  return (Array.isArray(replacements) ? replacements : []).reduce((text, replacement) => {
    if (!replacement?.from || !replacement?.to) return text;
    return replaceTextCaseInsensitive(text, replacement.from, replacement.to);
  }, String(value || ""));
}

function replaceTextCaseInsensitive(value, from, to) {
  const escaped = escapeRegExp(String(from || "").trim());
  if (!escaped) return value;
  return String(value || "").replace(new RegExp(`\\b${escaped}\\b`, "gi"), to);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  return text.length > maxLength
    ? text.slice(0, maxLength).replace(/\s+\S*$/, "").replace(/[,:;|\-–—.]+$/g, "").trim()
    : text;
}

function buildProductPulseDescriptionBlock(text, action, htmlStyle) {
  const heading = String(action.id || "").includes("faq") ? "Product FAQ" : "Product note";
  const actionId = escapeHtml(action.id || "product-action");
  return buildProductPulseStyledHtmlBlock({
    actionId,
    className: "productpulse-note",
    title: heading,
    contentHtml: buildHtmlParagraphs(text, htmlStyle),
    htmlStyle,
  });
}

function buildProductPulseDescriptionReplacement(text) {
  return buildProductPulseDescriptionBodyHtml(text);
}

function buildProductPulseDescriptionBodyHtml(text) {
  if (containsAllowedProductPulseHtml(text)) return sanitizeProductPulseDescriptionBodyHtml(text);
  return String(text || "")
    .split(/\n{2,}|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("\n");
}

function buildHtmlParagraphs(text, htmlStyle) {
  if (containsAllowedProductPulseHtml(text)) return sanitizeProductPulseDescriptionHtml(text);
  const preset = getProductPulseHtmlStylePreset(normalizeProductPulseHtmlStyle(htmlStyle).preset);
  return String(text || "")
    .split(/\n{2,}|\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p style="${escapeHtml(preset.paragraphStyle)}">${escapeHtml(line)}</p>`)
    .join("\n");
}

function containsAllowedProductPulseHtml(value = "") {
  return /<\/?(p|br|strong|b|em|i|ul|ol|li|h3|h4)\b/i.test(String(value || ""));
}

function sanitizeProductPulseDescriptionHtml(value = "") {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (!part) return "";
      if (part.startsWith("<")) return sanitizeProductPulseDescriptionTag(part);
      return escapeHtml(part);
    })
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeProductPulseDescriptionBodyHtml(value = "") {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (!part) return "";
      if (part.startsWith("<")) return sanitizeProductPulseDescriptionBodyTag(part);
      return escapeHtml(part);
    })
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sanitizeProductPulseDescriptionTag(tag = "") {
  const match = String(tag || "").match(/^<\s*(\/)?\s*([a-z0-9]+)(?:\s[^>]*)?\s*(\/)?>$/i);
  if (!match) return escapeHtml(tag);
  const closing = Boolean(match[1]);
  const tagName = String(match[2] || "").toLowerCase();
  const selfClosing = Boolean(match[3]);
  const inlineTags = new Set(["strong", "b", "em", "i"]);
  if (inlineTags.has(tagName)) return closing ? `</${tagName}>` : `<${tagName}>`;
  if (tagName === "br") return "<br>";
  if (tagName === "p") return closing ? "</p>" : "<p style=\"margin:0 0 10px;color:#374151;line-height:1.6;\">";
  if (tagName === "h3") return closing ? "</h3>" : "<h3 style=\"margin:0 0 10px;color:#1f2937;font-size:16px;line-height:1.35;font-weight:800;\">";
  if (tagName === "h4") return closing ? "</h4>" : "<h4 style=\"margin:0 0 8px;color:#1f2937;font-size:14px;line-height:1.35;font-weight:800;\">";
  if (tagName === "ul") return closing ? "</ul>" : "<ul style=\"margin:0 0 10px 20px;padding:0;color:#374151;line-height:1.6;\">";
  if (tagName === "ol") return closing ? "</ol>" : "<ol style=\"margin:0 0 10px 20px;padding:0;color:#374151;line-height:1.6;\">";
  if (tagName === "li") return closing ? "</li>" : "<li style=\"margin:0 0 6px;\">";
  return escapeHtml(selfClosing ? `<${tagName} />` : tag);
}

function sanitizeProductPulseDescriptionBodyTag(tag = "") {
  const match = String(tag || "").match(/^<\s*(\/)?\s*([a-z0-9]+)(?:\s[^>]*)?\s*(\/)?>$/i);
  if (!match) return escapeHtml(tag);
  const closing = Boolean(match[1]);
  const tagName = String(match[2] || "").toLowerCase();
  const selfClosing = Boolean(match[3]);
  const allowedTags = new Set(["strong", "b", "em", "i", "br", "p", "h3", "h4", "ul", "ol", "li"]);
  if (!allowedTags.has(tagName)) return escapeHtml(selfClosing ? `<${tagName} />` : tag);
  if (tagName === "br") return "<br>";
  return closing ? `</${tagName}>` : `<${tagName}>`;
}

function buildProductPulseStyledHtmlBlock({ actionId, className, title, contentHtml, htmlStyle, includeHeading = true }) {
  const style = normalizeProductPulseHtmlStyle(htmlStyle);
  const preset = getProductPulseHtmlStylePreset(style.preset);
  const template = getProductPulseHtmlStyleTemplate(style);
  const attributes = buildProductPulseCalloutAttributes(actionId, className, style);
  const headingHtml = includeHeading ? buildProductPulseCalloutHeading(title, style) : "";
  const rendered = template
    .replaceAll(PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.attributes, attributes)
    .replaceAll(PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.title, escapeHtml(title))
    .replaceAll(PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.headingHtml, headingHtml)
    .replaceAll(PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.contentHtml, contentHtml || "");

  if (rendered.includes(PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.contentHtml)) {
    return `<section ${attributes}>\n${headingHtml}\n${contentHtml || ""}\n</section>`;
  }
  if (!rendered.includes("data-productpulse-action=") && !template.includes(PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS.attributes)) {
    return `<section ${attributes}>\n${rendered}\n</section>`;
  }
  return rendered.replaceAll("__PRODUCTPULSE_PRESET_TONE__", escapeHtml(preset.tone || "blue"));
}

function buildProductPulseCalloutAttributes(actionId, className = "productpulse-callout", htmlStyle) {
  const preset = getProductPulseHtmlStylePreset(normalizeProductPulseHtmlStyle(htmlStyle).preset);
  return [
    `data-productpulse-action="${actionId}"`,
    `class="${escapeHtml(className)} productpulse-callout"`,
    `style="${escapeHtml(preset.attributeStyle)}"`,
  ].join(" ");
}

function buildProductPulseCalloutHeading(label, htmlStyle) {
  const preset = getProductPulseHtmlStylePreset(normalizeProductPulseHtmlStyle(htmlStyle).preset);
  return `<p style="${escapeHtml(preset.headingStyle)}">${escapeHtml(label)}</p>`;
}

function extractPlacedDescriptionDraft({ currentText = "", draftText = "" } = {}) {
  const blocks = splitDescriptionDraftBlocks(draftText);
  const current = normalizeDescriptionComparisonText(currentText);
  if (!current || blocks.length < 2) return null;

  const currentIndex = blocks.findIndex((block) => descriptionsReferToSameText(block, currentText));
  if (currentIndex < 0) return null;
  const prependText = blocks.slice(0, currentIndex).join("\n\n").trim();
  const appendText = blocks.slice(currentIndex + 1).join("\n\n").trim();
  if (!prependText && !appendText) return null;
  return { prependText, appendText };
}

function splitDescriptionDraftBlocks(value = "") {
  return String(value || "")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function descriptionsReferToSameText(first = "", second = "") {
  const firstNormalized = normalizeDescriptionComparisonText(first);
  const secondNormalized = normalizeDescriptionComparisonText(second);
  if (!firstNormalized || !secondNormalized) return false;
  if (firstNormalized === secondNormalized) return true;
  if (firstNormalized.includes(secondNormalized) || secondNormalized.includes(firstNormalized)) return true;
  const firstTokens = new Set(firstNormalized.split(/\s+/).filter((token) => token.length > 4));
  const secondTokens = secondNormalized.split(/\s+/).filter((token) => token.length > 4);
  if (!firstTokens.size || !secondTokens.length) return false;
  const shared = secondTokens.filter((token) => firstTokens.has(token)).length;
  return shared / secondTokens.length >= 0.9;
}

function normalizeDescriptionComparisonText(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .trim()
    .toLowerCase();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function cleanProductDescription(product = {}) {
  const plainDescription = String(product.description || "").trim();
  if (plainDescription) return stripHtml(plainDescription);
  return stripHtml(product.descriptionHtml || "");
}

async function findProductRiskSnapshot(shop, productId) {
  return prisma.productRiskSnapshot.findFirst({
    where: {
      shop,
      OR: [
        { handle: productId },
        { productGid: productId },
      ],
    },
  });
}

async function getProductRiskNavigationForShop(shop, snapshot) {
  if (!shop || !snapshot) return { previous: null, next: null };
  const rollupNavigation = await getProductRiskNavigationFromRollups(shop, snapshot);
  if (rollupNavigation) return rollupNavigation;
  return getProductRiskNavigationFromSnapshots(shop, snapshot);
}

async function getProductRiskNavigationFromRollups(shop, snapshot) {
  if (!prisma.productPulseProductRollup) return null;
  try {
    const current = await prisma.productPulseProductRollup.findFirst({
      where: {
        shop,
        OR: [
          { productGid: snapshot.productGid },
          ...(snapshot.handle ? [{ handle: snapshot.handle }] : []),
        ],
      },
      select: PRODUCT_RISK_NAVIGATION_SELECT,
    });
    if (!current) return null;
    const [previous, next] = await Promise.all([
      findAdjacentProductRiskNavigationRow("productPulseProductRollup", current, "previous"),
      findAdjacentProductRiskNavigationRow("productPulseProductRollup", current, "next"),
    ]);
    return {
      previous: formatProductRiskNavigationItem(previous),
      next: formatProductRiskNavigationItem(next),
    };
  } catch (error) {
    if (isMissingProductRiskNavigationTargetError(error)) return null;
    throw error;
  }
}

async function getProductRiskNavigationFromSnapshots(shop, snapshot) {
  const current = {
    shop,
    productGid: snapshot.productGid,
    productTitle: snapshot.productTitle,
    handle: snapshot.handle,
    riskScore: snapshot.riskScore,
  };
  const [previous, next] = await Promise.all([
    findAdjacentProductRiskNavigationRow("productRiskSnapshot", current, "previous"),
    findAdjacentProductRiskNavigationRow("productRiskSnapshot", current, "next"),
  ]);
  return {
    previous: formatProductRiskNavigationItem(previous),
    next: formatProductRiskNavigationItem(next),
  };
}

async function findAdjacentProductRiskNavigationRow(modelName, current, direction) {
  const model = prisma[modelName];
  if (!model || !current?.shop || !current?.productGid) return null;
  const riskScore = Number(current.riskScore || 0);
  const productTitle = String(current.productTitle || "");
  const productGid = String(current.productGid || "");
  const isPrevious = direction === "previous";
  const titleOperator = isPrevious ? "lt" : "gt";
  const gidOperator = isPrevious ? "lt" : "gt";
  const riskOperator = isPrevious ? "gt" : "lt";
  return model.findFirst({
    where: {
      shop: current.shop,
      OR: [
        { riskScore: { [riskOperator]: riskScore } },
        {
          riskScore,
          productTitle: { [titleOperator]: productTitle },
        },
        {
          riskScore,
          productTitle,
          productGid: { [gidOperator]: productGid },
        },
      ],
    },
    orderBy: isPrevious
      ? [{ riskScore: "asc" }, { productTitle: "desc" }, { productGid: "desc" }]
      : [{ riskScore: "desc" }, { productTitle: "asc" }, { productGid: "asc" }],
    select: PRODUCT_RISK_NAVIGATION_SELECT,
  });
}

function formatProductRiskNavigationItem(row) {
  if (!row?.productGid && !row?.handle) return null;
  const identifier = row.handle || row.productGid;
  return {
    productGid: row.productGid || "",
    handle: row.handle || "",
    title: row.productTitle || "Product",
    riskScore: Number(row.riskScore || 0),
    href: `/app/products/${encodeURIComponent(identifier)}`,
  };
}

function isMissingProductRiskNavigationTargetError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "");
  return code === "P2021" || code === "P2022" || /table .* does not exist|column .* does not exist|no such table/i.test(message);
}

async function getProductDiagnosisSnapshotsForProductIds(shop, productIds = []) {
  const requestedIds = [...new Set(productIds.map((value) => String(value || "").trim()).filter(Boolean))];
  if (!requestedIds.length) return { snapshots: [], matchedProductIds: new Set(), unmatchedProductIds: [] };

  const snapshots = await prisma.productRiskSnapshot.findMany({
    where: {
      shop,
      OR: [
        { productGid: { in: requestedIds } },
        { handle: { in: requestedIds } },
      ],
    },
  });

  const snapshotByRequestedId = new Map();
  snapshots.forEach((snapshot) => {
    if (snapshot.productGid) snapshotByRequestedId.set(String(snapshot.productGid), snapshot);
    if (snapshot.handle) snapshotByRequestedId.set(String(snapshot.handle), snapshot);
  });

  const matchedProductIds = new Set();
  const seenProductGids = new Set();
  const orderedSnapshots = [];
  requestedIds.forEach((productId) => {
    const snapshot = snapshotByRequestedId.get(productId);
    if (!snapshot) return;
    matchedProductIds.add(productId);
    const snapshotKey = String(snapshot.productGid || snapshot.handle || productId);
    if (seenProductGids.has(snapshotKey)) return;
    seenProductGids.add(snapshotKey);
    orderedSnapshots.push(snapshot);
  });

  return {
    snapshots: orderedSnapshots,
    matchedProductIds,
    unmatchedProductIds: requestedIds.filter((productId) => !matchedProductIds.has(productId)),
  };
}

async function getProductPulseSettingsForShopInTransaction(tx, shop) {
  const record = await tx.productPulseSource.findUnique({
    where: {
      shop_sourceKey: {
        shop,
        sourceKey: PRODUCT_PULSE_SETTINGS_SOURCE_KEY,
      },
    },
  });
  return normalizeProductPulseSettings(record?.config);
}

async function updateProductPulseBatchModeSettingsInTransaction(tx, shop, updates = {}) {
  const currentSettings = await getProductPulseSettingsForShopInTransaction(tx, shop);
  const currentBatchMode = currentSettings.processing?.batchMode || {};
  const settings = normalizeProductPulseSettings({
    ...currentSettings,
    processing: {
      ...(currentSettings.processing || {}),
      batchMode: {
        ...currentBatchMode,
        ...updates,
        cooldownHours: PRODUCT_PULSE_BATCH_MODE_COOLDOWN_HOURS,
      },
    },
  });

  await tx.productPulseSource.upsert({
    where: {
      shop_sourceKey: {
        shop,
        sourceKey: PRODUCT_PULSE_SETTINGS_SOURCE_KEY,
      },
    },
    create: {
      shop,
      sourceKey: PRODUCT_PULSE_SETTINGS_SOURCE_KEY,
      category: "settings",
      name: "ProductPulse Settings",
      connected: true,
      active: true,
      available: true,
      health: "configured",
      coverageWeight: 0,
      config: settings,
    },
    update: {
      connected: true,
      active: true,
      available: true,
      health: "configured",
      config: settings,
    },
  });

  return settings;
}

async function resolveProductDiagnosisBatchModeQueue(tx, shop, { pointBalance, now = new Date() } = {}) {
  const availability = getProductDiagnosisOpenAiBatchAvailability({ force: true });
  const settings = await getProductPulseSettingsForShopInTransaction(tx, shop);
  const batchSummary = getProductPulseBatchModeSummary(settings, pointBalance, now);

  if (!availability.available) {
    return {
      ok: false,
      error: buildProductDiagnosisBatchModeQueueError({
        message: availability.message || "Batch mode is not available for this store.",
        pointBalance,
        batchSummary,
        reason: availability.reason,
      }),
    };
  }

  const activeBatchJob = await tx.catalogSignalJob.findFirst({
    where: {
      shop,
      kind: PRODUCT_DIAGNOSIS_KIND,
      status: { in: ["Queued", "Running"] },
      payload: { path: ["batchMode", "freeCreditMode"], equals: true },
    },
    orderBy: [{ updatedAt: "desc" }],
  });
  if (activeBatchJob) {
    return {
      ok: false,
      error: buildProductDiagnosisBatchModeQueueError({
        message: "Batch mode already has a Product Diagnosis in progress. Start the next free Batch analysis after the current one finishes and the 24-hour window is available.",
        pointBalance,
        batchSummary,
        reason: "batch_analysis_in_progress",
        activeJobId: activeBatchJob.id,
      }),
    };
  }

  const cutoff = new Date(now.getTime() - PRODUCT_PULSE_BATCH_MODE_COOLDOWN_MS);
  const recentBatchJob = await tx.catalogSignalJob.findFirst({
    where: {
      shop,
      kind: PRODUCT_DIAGNOSIS_KIND,
      createdAt: { gte: cutoff },
      payload: { path: ["batchMode", "freeCreditMode"], equals: true },
    },
    orderBy: [{ createdAt: "desc" }],
  });
  const lastFreeDate = maxDate(
    parseDate(batchSummary.lastFreeBatchDiagnosisAt),
    recentBatchJob?.createdAt,
  );
  if (lastFreeDate && now.getTime() - lastFreeDate.getTime() < PRODUCT_PULSE_BATCH_MODE_COOLDOWN_MS) {
    const nextAt = new Date(lastFreeDate.getTime() + PRODUCT_PULSE_BATCH_MODE_COOLDOWN_MS);
    return {
      ok: false,
      error: buildProductDiagnosisBatchModeQueueError({
        message: `Batch mode allows one Product Diagnosis every 24 hours. The next free Batch analysis is available ${formatJobDate(nextAt)}.`,
        pointBalance,
        batchSummary: {
          ...batchSummary,
          lastFreeBatchDiagnosisAt: lastFreeDate.toISOString(),
          nextFreeBatchDiagnosisAt: nextAt.toISOString(),
          canStartFreeBatchAnalysis: false,
        },
        reason: "batch_cooldown_active",
        nextFreeBatchDiagnosisAt: nextAt.toISOString(),
      }),
    };
  }

  const activatedAt = batchSummary.activatedAt || now.toISOString();
  return {
    ok: true,
    settings,
    batchSummary: {
      ...batchSummary,
      active: true,
      activatedAt,
      canStartFreeBatchAnalysis: true,
    },
  };
}

function buildProductDiagnosisBatchModePayload({ now = new Date(), batchSummary = {} } = {}) {
  const queuedAt = now.toISOString();
  return {
    enabled: true,
    freeCreditMode: true,
    forceOpenAiBatch: true,
    reason: "out_of_credits",
    activatedAt: batchSummary.activatedAt || queuedAt,
    queuedAt,
    cooldownHours: PRODUCT_PULSE_BATCH_MODE_COOLDOWN_HOURS,
    lastFreeBatchDiagnosisAt: queuedAt,
    nextFreeBatchDiagnosisAt: new Date(now.getTime() + PRODUCT_PULSE_BATCH_MODE_COOLDOWN_MS).toISOString(),
  };
}

function buildProductDiagnosisBatchModeQueueError({
  message,
  pointBalance = null,
  batchSummary = null,
  reason = "batch_mode_unavailable",
  nextFreeBatchDiagnosisAt = null,
  activeJobId = null,
} = {}) {
  return {
    status: "validation_error",
    message,
    balance: pointBalance || null,
    batchMode: {
      ...(batchSummary || {}),
      reason,
      activeJobId,
      nextFreeBatchDiagnosisAt: nextFreeBatchDiagnosisAt || batchSummary?.nextFreeBatchDiagnosisAt || null,
    },
  };
}

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function maxDate(...values) {
  return values
    .map(parseDate)
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime())[0] || null;
}

async function createProductDiagnosisJobsForSnapshots(shop, snapshots = []) {
  const uniqueSnapshots = [];
  const seenProductGids = new Set();
  snapshots.forEach((snapshot) => {
    const key = String(snapshot?.productGid || snapshot?.handle || "");
    if (!key || seenProductGids.has(key)) return;
    seenProductGids.add(key);
    uniqueSnapshots.push(snapshot);
  });
  if (!uniqueSnapshots.length) {
    return { jobs: [], createdCount: 0, reusedCount: 0, pointFailures: [] };
  }

  const result = await prisma.$transaction(async (tx) => {
    await lockStorePointLedgerForShop(tx, shop);

    const activeJobs = await tx.catalogSignalJob.findMany({
      where: {
        shop,
        kind: PRODUCT_DIAGNOSIS_KIND,
        status: { in: ["Queued", "Running"] },
      },
      orderBy: [{ status: "desc" }, { updatedAt: "desc" }],
    });

    const jobs = [];
    const snapshotsToCreate = [];
    uniqueSnapshots.forEach((snapshot) => {
      const activeJob = findActiveProductDiagnosisJobForSnapshot(snapshot, activeJobs);
      if (activeJob) {
        jobs.push(activeJob);
      } else {
        snapshotsToCreate.push(snapshot);
      }
    });

    const pointBalance = snapshotsToCreate.length
      ? await getStorePointSummaryForShop(shop, { db: tx, limit: 1 }).then((summary) => summary.balance)
      : null;
    const availableCreditSlots = Math.max(0, Math.floor(Number(pointBalance?.available || 0)));
    let batchModeEligibility = null;
    let batchModeUsed = false;
    if (snapshotsToCreate.length && availableCreditSlots < 1) {
      batchModeEligibility = await resolveProductDiagnosisBatchModeQueue(tx, shop, { pointBalance, now: new Date() });
      if (!batchModeEligibility.ok) {
        return {
          jobs,
          createdJobs: [],
          pointFailures: snapshotsToCreate.map(() => batchModeEligibility.error),
        };
      }
    }

    const createdJobs = [];
    const pointFailures = [];
    for (const [index, snapshot] of snapshotsToCreate.entries()) {
      const snapshotMetrics = snapshot.metrics || {};
      const snapshotImage = getSnapshotProductImage(snapshot);
      const jobId = randomUUID();
      const useCredit = index < availableCreditSlots;
      const useBatchMode = !useCredit && batchModeEligibility?.ok && !batchModeUsed;
      if (!useCredit && !useBatchMode) {
        pointFailures.push(batchModeEligibility?.error || {
          status: "validation_error",
          message: "Product Diagnosis could not be queued because credits were exhausted.",
          balance: pointBalance,
        });
        continue;
      }

      const now = new Date();
      const batchMode = useBatchMode
        ? buildProductDiagnosisBatchModePayload({ now, batchSummary: batchModeEligibility.batchSummary })
        : null;
      const pointDebit = useCredit
        ? await debitStorePointsForShop(shop, {
          db: tx,
          amount: 1,
          reason: `Product credit debit product-diagnosis:${jobId} - ${snapshot.productTitle || "selected product"}`,
          idempotencyKey: `product-diagnosis:${jobId}`,
          metadata: {
            source: "product_diagnosis",
            jobId,
            productGid: snapshot.productGid || null,
            productTitle: snapshot.productTitle || null,
            queued: true,
          },
        })
        : {
          status: "batch_mode_no_charge",
          amount: 0,
          charged: false,
          ledgerEntry: null,
          balance: pointBalance,
        };
      if (useCredit && !isPointDebitRecorded(pointDebit)) {
        pointFailures.push(pointDebit);
        continue;
      }
      const payload = {
        productId: snapshot.productGid || snapshot.handle,
        productGid: snapshot.productGid,
        handle: snapshot.handle,
        productTitle: snapshot.productTitle,
        imageUrl: snapshotImage.imageUrl || snapshotMetrics.imageUrl || snapshotMetrics.image || "",
        productImageUrl: snapshotImage.imageUrl || snapshotMetrics.productImageUrl || "",
        imageAlt: snapshotImage.imageAlt || snapshotMetrics.imageAlt || snapshot.productTitle,
        productImageAlt: snapshotImage.imageAlt || snapshotMetrics.productImageAlt || snapshot.productTitle,
        riskScore: snapshot.riskScore,
        pointCost: useBatchMode ? 0 : 1,
        pointLedgerEntryId: pointDebit.ledgerEntry?.id || null,
        pointDebitStatus: pointDebit.status,
        queuedAt: now.toISOString(),
      };
      if (batchMode) {
        payload.pointsConsumed = 0;
        payload.creditsConsumed = 0;
        payload.batchMode = batchMode;
      }

      const job = await tx.catalogSignalJob.create({
        data: {
          id: jobId,
          shop,
          kind: PRODUCT_DIAGNOSIS_KIND,
          source: `Queued Product Diagnosis - ${snapshot.productTitle}`,
          status: "Queued",
          progress: 0,
          priority: 50,
          startedAt: now,
          payload,
        },
      });

      if (batchMode) {
        batchModeUsed = true;
        await updateProductPulseBatchModeSettingsInTransaction(tx, shop, {
          active: true,
          activatedAt: batchMode.activatedAt,
          lastFreeBatchDiagnosisAt: batchMode.lastFreeBatchDiagnosisAt,
          nextFreeBatchDiagnosisAt: batchMode.nextFreeBatchDiagnosisAt,
          lastFreeBatchJobId: job.id,
          lastFreeBatchProductGid: snapshot.productGid || null,
        });
      }
      jobs.push(job);
      createdJobs.push({ job, snapshot, pointDebit, batchMode });
    }

    return { jobs, createdJobs, pointFailures };
  });

  for (const { job, snapshot, pointDebit } of result.createdJobs) {
    await recordJobLog({
      shop,
      jobId: job.id,
      event: "product_diagnosis.queued",
      message: "Product diagnosis queued as a persistent background job.",
      data: {
        productGid: snapshot.productGid,
        handle: snapshot.handle,
        title: snapshot.productTitle,
        riskScore: snapshot.riskScore,
        pointsConsumed: job.payload?.batchMode?.freeCreditMode ? 0 : 1,
        pointLedgerEntryId: pointDebit?.ledgerEntry?.id || null,
        batchMode: job.payload?.batchMode || null,
        bulkQueued: true,
      },
    });
  }

  return {
    jobs: result.jobs,
    createdCount: result.createdJobs.length,
    reusedCount: Math.max(0, result.jobs.length - result.createdJobs.length),
    pointFailures: result.pointFailures,
  };
}

async function createProductDiagnosisJob(shop, productId, options = {}) {
  let snapshot = await findProductRiskSnapshot(shop, productId);
  if (!snapshot && options.admin) {
    snapshot = await createManualProductRiskSnapshot(shop, options.admin, productId);
  }
  if (!snapshot) return null;

  const snapshotMetrics = snapshot.metrics || {};
  const snapshotImage = await resolveSnapshotProductImage(shop, snapshot, options.admin);
  const result = await prisma.$transaction(async (tx) => {
    await lockStorePointLedgerForShop(tx, shop);

    const activeJobs = await tx.catalogSignalJob.findMany({
      where: {
        shop,
        kind: PRODUCT_DIAGNOSIS_KIND,
        status: { in: ["Queued", "Running"] },
      },
      orderBy: [{ status: "desc" }, { updatedAt: "desc" }],
    });
    const activeJob = findActiveProductDiagnosisJobForSnapshot(snapshot, activeJobs);
    if (activeJob) return { job: activeJob, created: false };

    const pointSummary = await getStorePointSummaryForShop(shop, { db: tx, limit: 1 });
    const pointBalance = pointSummary.balance;
    let batchModeEligibility = null;
    if (!options.skipPointBalanceCheck && Number(pointBalance?.available || 0) < 1) {
      batchModeEligibility = await resolveProductDiagnosisBatchModeQueue(tx, shop, { pointBalance, now: new Date() });
      if (!batchModeEligibility.ok) return { pointValidationError: batchModeEligibility.error };
    } else if (!options.skipPointBalanceCheck) {
      const pointCheck = await validateStorePointsForShop(shop, 1, { db: tx });
      if (!pointCheck.valid) return { pointValidationError: pointCheck };
    }

    const jobId = randomUUID();
    const now = new Date();
    const batchMode = batchModeEligibility?.ok
      ? buildProductDiagnosisBatchModePayload({ now, batchSummary: batchModeEligibility.batchSummary })
      : null;
    const pointDebit = batchMode
      ? {
        status: "batch_mode_no_charge",
        amount: 0,
        charged: false,
        ledgerEntry: null,
        balance: pointBalance,
      }
      : await debitStorePointsForShop(shop, {
        db: tx,
        amount: 1,
        reason: `Product credit debit product-diagnosis:${jobId} - ${snapshot.productTitle || "selected product"}`,
        idempotencyKey: `product-diagnosis:${jobId}`,
        metadata: {
          source: "product_diagnosis",
          jobId,
          productGid: snapshot.productGid || null,
          productTitle: snapshot.productTitle || null,
          queued: true,
        },
      });
    if (!batchMode && !isPointDebitRecorded(pointDebit)) return { pointValidationError: pointDebit };
    const payload = {
      productId,
      productGid: snapshot.productGid,
      handle: snapshot.handle,
      productTitle: snapshot.productTitle,
      imageUrl: snapshotImage.imageUrl || snapshotMetrics.imageUrl || snapshotMetrics.image || "",
      productImageUrl: snapshotImage.imageUrl || snapshotMetrics.productImageUrl || "",
      imageAlt: snapshotImage.imageAlt || snapshotMetrics.imageAlt || snapshot.productTitle,
      productImageAlt: snapshotImage.imageAlt || snapshotMetrics.productImageAlt || snapshot.productTitle,
      riskScore: snapshot.riskScore,
      pointCost: batchMode ? 0 : 1,
      pointLedgerEntryId: pointDebit.ledgerEntry?.id || null,
      pointDebitStatus: pointDebit.status,
      queuedAt: now.toISOString(),
    };
    if (batchMode) {
      payload.pointsConsumed = 0;
      payload.creditsConsumed = 0;
      payload.batchMode = batchMode;
    }

    const job = await tx.catalogSignalJob.create({
      data: {
        id: jobId,
        shop,
        kind: PRODUCT_DIAGNOSIS_KIND,
        source: `Queued Product Diagnosis - ${snapshot.productTitle}`,
        status: "Queued",
        progress: 0,
        priority: 50,
        startedAt: now,
        payload,
      },
    });

    if (batchMode) {
      await updateProductPulseBatchModeSettingsInTransaction(tx, shop, {
        active: true,
        activatedAt: batchMode.activatedAt,
        lastFreeBatchDiagnosisAt: batchMode.lastFreeBatchDiagnosisAt,
        nextFreeBatchDiagnosisAt: batchMode.nextFreeBatchDiagnosisAt,
        lastFreeBatchJobId: job.id,
        lastFreeBatchProductGid: snapshot.productGid || null,
      });
    }

    return { job, created: true, pointDebit, batchMode };
  });

  if (result.pointValidationError) return { pointValidationError: result.pointValidationError };
  const { job, pointDebit, created } = result;
  if (!created) return job;

  await recordJobLog({
    shop,
    jobId: job.id,
    event: "product_diagnosis.queued",
    message: "Product diagnosis queued as a persistent background job.",
    data: {
      productGid: snapshot.productGid,
      handle: snapshot.handle,
      title: snapshot.productTitle,
      riskScore: snapshot.riskScore,
      pointsConsumed: job.payload?.batchMode?.freeCreditMode ? 0 : 1,
      pointLedgerEntryId: pointDebit?.ledgerEntry?.id || null,
      batchMode: job.payload?.batchMode || null,
    },
  });

  return job;
}

async function getActiveFastProductScan(shop) {
  return prisma.catalogSignalJob.findFirst({
    where: {
      shop,
      kind: FAST_PRODUCT_SCAN_KIND,
      status: { in: ["Queued", "Running"] },
    },
    orderBy: { startedAt: "desc" },
  });
}

async function getActiveProductDiagnosisJobs(shop) {
  return prisma.catalogSignalJob.findMany({
    where: {
      shop,
      kind: PRODUCT_DIAGNOSIS_KIND,
      status: { in: ["Queued", "Running"] },
    },
    orderBy: [{ status: "desc" }, { updatedAt: "desc" }],
  });
}

async function getActiveDashboardJobs(shop) {
  const jobs = await prisma.catalogSignalJob.findMany({
    where: {
      shop,
      kind: { in: [FAST_PRODUCT_SCAN_KIND, PRODUCT_DIAGNOSIS_KIND] },
      status: { in: ["Queued", "Running"] },
    },
    orderBy: [{ updatedAt: "desc" }],
  });

  const activeJob = jobs
    .filter((job) => job.kind === FAST_PRODUCT_SCAN_KIND)
    .sort((first, second) => new Date(second.startedAt || 0).getTime() - new Date(first.startedAt || 0).getTime())[0] || null;
  const activeDiagnosisJobs = jobs
    .filter((job) => job.kind === PRODUCT_DIAGNOSIS_KIND)
    .sort(compareActiveProductDiagnosisJobs);

  return { activeJob, activeDiagnosisJobs };
}

function compareActiveProductDiagnosisJobs(first, second) {
  const statusRank = (status) => (status === "Running" ? 2 : status === "Queued" ? 1 : 0);
  return statusRank(second.status) - statusRank(first.status)
    || new Date(second.updatedAt || 0).getTime() - new Date(first.updatedAt || 0).getTime();
}

async function getActiveShopifyMockDatasetJob(shop) {
  return prisma.catalogSignalJob.findFirst({
    where: {
      shop,
      kind: SHOPIFY_MOCK_DATASET_KIND,
      status: { in: ["Queued", "Running"] },
    },
    orderBy: { startedAt: "desc" },
  });
}

function findActiveProductDiagnosisJobForSnapshot(snapshot, jobs = []) {
  const keys = new Set([
    snapshot?.productGid,
    snapshot?.handle,
  ].filter(Boolean).map(String));
  if (!keys.size) return null;

  return jobs.find((job) => getProductDiagnosisJobKeys(job).some((key) => keys.has(key))) || null;
}

async function failStaleFastProductScans(shop) {
  const normalizedShop = String(shop || "").trim();
  if (!normalizedShop) return;
  const nowMs = Date.now();
  const lastSweepMs = staleFastProductScanSweeps.get(normalizedShop) || 0;
  if (nowMs - lastSweepMs < STALE_JOB_SWEEP_INTERVAL_MS) return;
  staleFastProductScanSweeps.set(normalizedShop, nowMs);

  const cutoff = new Date(Date.now() - STALE_JOB_TIMEOUT_MS);
  await prisma.catalogSignalJob.updateMany({
    where: {
      shop: normalizedShop,
      kind: FAST_PRODUCT_SCAN_KIND,
      status: { in: ["Queued", "Running"] },
      startedAt: { lte: cutoff },
    },
    data: {
      status: "Failed",
      errorMessage: "Catalog Scan worker timed out before completing.",
      source: "Catalog Scan failed",
      finishedAt: new Date(),
      leasedBy: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
    },
  });
}

export async function runProductPulseBackgroundWorker(options = {}) {
  const config = getProductPulseResourceConfig();
  let stopping = false;
  const stop = () => {
    stopping = true;
  };

  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  try {
    for (;;) {
      const result = await runProductPulseBackgroundWorkerCycle(options);
      if (options.once) return result;
      if (stopping) return { status: "stopped", processed: result.processed || 0 };
      if (!result.processed) await sleep(config.workerIdleSleepMs);
    }
  } finally {
    process.off("SIGTERM", stop);
    process.off("SIGINT", stop);
  }
}

export async function runProductPulseBackgroundWorkerCycle(options = {}) {
  const config = getProductPulseResourceConfig();
  const maxJobs = Number(options.maxJobsPerCycle || config.workerMaxJobsPerCycle);
  let processed = 0;
  logProductPulseWorkerProgress("background_worker.cycle_started", { shop: options.shop }, {
    maxJobs,
    ownerId: JOB_WORKER_OWNER_ID,
  });

  await requeueExpiredProductPulseJobs(options.shop);

  for (; processed < maxJobs; processed += 1) {
    const job = await claimNextProductPulseJob(options.shop);
    if (!job) break;
    logProductPulseWorkerProgress("background_worker.job_claimed", { job }, {
      processed,
      maxJobs,
      status: job.status,
      source: job.source,
      attempts: job.attempts,
    });

    try {
      await processClaimedProductPulseJob(job, options);
      logProductPulseWorkerProgress("background_worker.job_completed", { job }, {
        processed: processed + 1,
        kind: job.kind,
      });
    } catch (error) {
      logProductPulseWorkerProgress("background_worker.job_failed", { job }, {
        kind: job.kind,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }, "error");
      await recordJobLog({
        shop: job.shop,
        jobId: job.id,
        level: "error",
        event: "background_worker.job_failed",
        message: `${getJobDisplayName(job.kind)} worker failed.`,
        data: { kind: job.kind, error: serializeError(error), payload: job.payload },
      });
      await markJobFailed(job.id, error, `${getJobDisplayName(job.kind)} failed`);
      if (job.kind === PRODUCT_DIAGNOSIS_KIND) {
        await maybeSendWatchlistRunAlertForJob({
          ...job,
          status: "Failed",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  logProductPulseWorkerProgress("background_worker.cycle_finished", { shop: options.shop }, {
    processed,
    maxJobs,
  });
  return { status: "ok", processed };
}

function shouldStartInlineWorkers(options = {}) {
  return Boolean(options.force || getProductPulseResourceConfig().inlineWorkersEnabled);
}

function getLeaseExpiresAt() {
  return new Date(Date.now() + getProductPulseResourceConfig().jobLeaseTtlMs);
}

function getTerminalLeaseData(data = {}) {
  if (!["Completed", "Failed", "Canceled"].includes(String(data.status || ""))) return data;
  return {
    ...data,
    leasedBy: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
  };
}

async function claimSpecificCatalogSignalJob(job, { kind, source, progress = 1 } = {}) {
  const now = new Date();
  const claimed = await prisma.catalogSignalJob.updateMany({
    where: {
      id: job.id,
      kind,
      status: { in: ["Queued", "Running"] },
      OR: [
        { leasedBy: null },
        { leasedBy: JOB_WORKER_OWNER_ID },
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lte: now } },
      ],
    },
    data: {
      status: "Running",
      progress: Math.max(Number(job.progress || 0), progress),
      source,
      startedAt: job.status === "Queued" ? now : job.startedAt,
      leasedBy: JOB_WORKER_OWNER_ID,
      leaseExpiresAt: getLeaseExpiresAt(),
      lastHeartbeatAt: now,
      attempts: { increment: 1 },
    },
  });

  if (claimed.count !== 1) return null;
  return prisma.catalogSignalJob.findUnique({ where: { id: job.id } });
}

async function claimNextProductPulseJob(shop) {
  return (
    await claimNextQueuedJob(FAST_PRODUCT_SCAN_KIND, {
      shop,
      progress: 12,
      source: "Running Shopify Catalog Scan",
    })
  ) || (
    await claimNextQueuedJob(PRODUCT_DIAGNOSIS_KIND, {
      shop,
      progress: 5,
      source: "Running Product Diagnosis",
    })
  ) || (
    await claimNextQueuedJob(SHOPIFY_MOCK_DATASET_KIND, {
      shop,
      progress: 2,
      source: "Running Shopify mock dataset",
    })
  );
}

async function claimNextQueuedJob(kind, { shop, source, progress = 1 } = {}) {
  const shopFilter = shop ? Prisma.sql`AND "shop" = ${shop}` : Prisma.empty;
  const claimedAt = new Date();
  const leaseExpiresAt = getLeaseExpiresAt();
  const claimedAtUtc = Prisma.sql`(${claimedAt}::timestamptz AT TIME ZONE 'UTC')`;
  const leaseExpiresAtUtc = Prisma.sql`(${leaseExpiresAt}::timestamptz AT TIME ZONE 'UTC')`;
  const rows = await prisma.$queryRaw`
    WITH next_job AS (
      SELECT "id"
      FROM "CatalogSignalJob"
      WHERE "kind" = ${kind}
        AND "status" = 'Queued'
        AND ("notBefore" IS NULL OR "notBefore" <= ${claimedAtUtc})
        ${shopFilter}
      ORDER BY "priority" ASC, COALESCE("notBefore", "startedAt") ASC, "startedAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "CatalogSignalJob" AS job
    SET "status" = 'Running',
        "progress" = ${progress},
        "source" = ${source},
        "startedAt" = ${claimedAtUtc},
        "leasedBy" = ${JOB_WORKER_OWNER_ID},
        "leaseExpiresAt" = ${leaseExpiresAtUtc},
        "lastHeartbeatAt" = ${claimedAtUtc},
        "attempts" = job."attempts" + 1
    FROM next_job
    WHERE job."id" = next_job."id"
    RETURNING job.*;
  `;

  return rows[0] || null;
}

async function processClaimedProductPulseJob(job, options = {}) {
  if (job.kind === FAST_PRODUCT_SCAN_KIND) return runFastProductScanJob(job, options);
  if (job.kind === PRODUCT_DIAGNOSIS_KIND) {
    return withJobLeaseHeartbeat(job.id, PRODUCT_DIAGNOSIS_KIND, () => runProductDiagnosisJob(job));
  }
  if (job.kind === SHOPIFY_MOCK_DATASET_KIND) return runShopifyMockDatasetPersistedJob(job, options);
  return null;
}

async function withJobLeaseHeartbeat(jobId, kind, callback) {
  const config = getProductPulseResourceConfig();
  let stopped = false;
  const interval = setInterval(async () => {
    if (stopped) return;
    try {
      await touchJobLease(jobId, kind);
    } catch {
      // Heartbeat is best-effort; the job update paths still write terminal state.
    }
  }, config.jobHeartbeatMs);
  if (typeof interval.unref === "function") interval.unref();

  try {
    return await callback();
  } finally {
    stopped = true;
    clearInterval(interval);
  }
}

async function touchJobLease(jobId, kind) {
  await prisma.catalogSignalJob.updateMany({
    where: {
      id: jobId,
      kind,
      status: "Running",
      leasedBy: JOB_WORKER_OWNER_ID,
    },
    data: {
      leaseExpiresAt: getLeaseExpiresAt(),
      lastHeartbeatAt: new Date(),
    },
  });
}

async function clearJobLease(jobId, kind) {
  await prisma.catalogSignalJob.updateMany({
    where: {
      id: jobId,
      kind,
    },
    data: {
      leasedBy: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
    },
  });
}

function ensureFastProductScanWorker(job, options = {}) {
  const inlineWorkersEnabled = shouldStartInlineWorkers(options);
  if (!inlineWorkersEnabled || !job?.id || activeWorkers.has(job.id) || !isActiveStatus(job.status)) {
    logInlineWorkerSkipOnce("quick_scan.inline_worker_not_started", job, {
      inlineWorkersEnabled,
      hasJobId: Boolean(job?.id),
      alreadyActiveInProcess: Boolean(job?.id && activeWorkers.has(job.id)),
      isActiveStatus: Boolean(isActiveStatus(job?.status)),
      status: job?.status || null,
      source: job?.source || null,
      workerMode: inlineWorkersEnabled ? "inline" : "external-worker-required",
    });
    return;
  }

  activeWorkers.add(job.id);
  logProductPulseWorkerProgress("quick_scan.inline_worker_scheduled", { job }, {
    activeWorkers: activeWorkers.size,
    inlineWorkersEnabled: getProductPulseResourceConfig().inlineWorkersEnabled,
  });
  setTimeout(async () => {
    try {
      logProductPulseWorkerProgress("quick_scan.inline_worker_claiming", { job }, {
        status: job.status,
        source: job.source,
      });
      const claimedJob = await claimSpecificCatalogSignalJob(job, {
        kind: FAST_PRODUCT_SCAN_KIND,
        progress: 12,
        source: "Running Shopify Catalog Scan",
      });
      if (!claimedJob) {
        logProductPulseWorkerProgress("quick_scan.inline_worker_claim_skipped", { job }, {
          reason: "job_not_claimable",
        }, "warn");
        return;
      }
      logProductPulseWorkerProgress("quick_scan.inline_worker_claimed", { job: claimedJob }, {
        status: claimedJob.status,
        source: claimedJob.source,
        attempts: claimedJob.attempts,
      });
      await runFastProductScanJob(claimedJob, options);
      logProductPulseWorkerProgress("quick_scan.inline_worker_completed", { job: claimedJob });
    } catch (error) {
      logProductPulseWorkerProgress("quick_scan.inline_worker_failed", { job }, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }, "error");
      await recordJobLog({
        shop: job.shop,
        jobId: job.id,
        level: "error",
        event: "quick_scan.worker_failed",
        message: "Catalog Scan worker failed.",
        data: { error: serializeError(error) },
      });
      await markJobFailed(job.id, error);
    } finally {
      activeWorkers.delete(job.id);
      logProductPulseWorkerProgress("quick_scan.inline_worker_stopped", { job }, {
        activeWorkers: activeWorkers.size,
      });
      await recordJobLog({
        shop: job.shop,
        jobId: job.id,
        event: "quick_scan.worker_stopped",
        message: "Catalog Scan worker stopped.",
      });
    }
  }, 0);
}

async function runFastProductScanJob(job, options = {}) {
  logProductPulseWorkerProgress("quick_scan.worker_started", { job }, {
    status: job.status,
    source: job.source,
    ownerId: JOB_WORKER_OWNER_ID,
  });
  await recordJobLog({
    shop: job.shop,
    jobId: job.id,
    event: "quick_scan.worker_started",
    message: "Catalog Scan worker started or rehydrated from an active persisted job.",
    data: { status: job.status, source: job.source, leasedBy: JOB_WORKER_OWNER_ID },
  });

  await withJobLeaseHeartbeat(job.id, FAST_PRODUCT_SCAN_KIND, async () => {
    logProductPulseWorkerProgress("quick_scan.admin_resolving", { job }, {
      hasProvidedAdmin: Boolean(options.admin),
      hasSessionScopes: Boolean(options.session?.scope),
    });
    const admin = options.admin || await getOfflineAdmin(job.shop);
    const scopes = options.scopes || options.session?.scope || admin.productPulseScopes || "";
    logProductPulseWorkerProgress("quick_scan.admin_resolved", { job }, {
      hasAdmin: Boolean(admin),
      hasGraphql: Boolean(admin?.graphql),
      hasScopes: Boolean(scopes),
    });
    logProductPulseWorkerProgress("quick_scan.run_started", { job });
    await runShopifyQuickScan({
      shop: job.shop,
      admin,
      jobId: job.id,
      scopes,
    });
    invalidateJobMonitorCache(job.shop);
    invalidateProductPulseDashboardCache(job.shop);
    invalidateBackgroundProcessCache(job.shop);
    logProductPulseWorkerProgress("quick_scan.run_finished", { job });
  });

  await clearJobLease(job.id, FAST_PRODUCT_SCAN_KIND);
  logProductPulseWorkerProgress("quick_scan.lease_cleared", { job });
}

function ensureShopifyMockDatasetWorker(job, options = {}) {
  if (!shouldStartInlineWorkers(options) || !job?.id || activeMockDatasetWorkers.has(job.id) || !isActiveStatus(job.status)) return;

  activeMockDatasetWorkers.add(job.id);
  setTimeout(async () => {
    const stage = normalizeShopifyMockDatasetStage(options.stage || job.payload?.stage);
    try {
      const claimedJob = await claimSpecificCatalogSignalJob(job, {
        kind: SHOPIFY_MOCK_DATASET_KIND,
        progress: 2,
        source: `Running Shopify mock dataset stage: ${SHOPIFY_MOCK_DATASET_STAGE_LABELS[stage]}`,
      });
      if (!claimedJob) return;
      await runShopifyMockDatasetPersistedJob(claimedJob, { ...options, stage });
    } catch (error) {
      await recordJobLog({
        shop: job.shop,
        jobId: job.id,
        level: "error",
        event: "mock_dataset.worker_failed",
        message: `Shopify mock dataset worker failed during stage: ${SHOPIFY_MOCK_DATASET_STAGE_LABELS[stage]}.`,
        data: { stage, error: serializeError(error), payload: job.payload },
      });
      await markJobFailed(job.id, error, "Shopify mock dataset failed");
    } finally {
      activeMockDatasetWorkers.delete(job.id);
      await recordJobLog({
        shop: job.shop,
        jobId: job.id,
        event: "mock_dataset.worker_stopped",
        message: "Shopify mock dataset worker stopped.",
      });
    }
  }, 0);
}

async function runShopifyMockDatasetPersistedJob(job, options = {}) {
  const stage = normalizeShopifyMockDatasetStage(options.stage || job.payload?.stage);
  await withJobLeaseHeartbeat(job.id, SHOPIFY_MOCK_DATASET_KIND, async () => {
    await recordJobLog({
      shop: job.shop,
      jobId: job.id,
      event: "mock_dataset.worker_started",
      message: "Shopify mock dataset worker started or rehydrated from an active persisted job.",
      data: { status: job.status, source: job.source, stage, leasedBy: JOB_WORKER_OWNER_ID },
    });

    const adminContext = await getBackgroundShopifyAdmin(job.shop);
    const admin = adminContext.admin;
    const scopes = admin.productPulseScopes || options.scopes || "";
    await recordJobLog({
      shop: job.shop,
      jobId: job.id,
      event: "mock_dataset.admin_client_resolved",
      message: `Shopify mock dataset worker is using ${adminContext.source} Admin API credentials.`,
      data: { source: adminContext.source, hasScopes: Boolean(scopes) },
    });
    const summary = await runShopifyMockDatasetJob({
      shop: job.shop,
      admin,
      jobId: job.id,
      stage,
      onProgress: async (progress, source, data = null) => {
        await prisma.catalogSignalJob.updateMany({
          where: {
            id: job.id,
            kind: SHOPIFY_MOCK_DATASET_KIND,
            status: { in: ["Queued", "Running"] },
            leasedBy: JOB_WORKER_OWNER_ID,
          },
          data: {
            status: "Running",
            progress: Math.min(99, Math.max(0, Number(progress || 0))),
            source,
            payload: {
              ...(job.payload || {}),
              stage,
              stageLabel: SHOPIFY_MOCK_DATASET_STAGE_LABELS[stage],
              ...(data || {}),
            },
          },
        });
      },
    });

    await prisma.catalogSignalJob.updateMany({
      where: {
        id: job.id,
        kind: SHOPIFY_MOCK_DATASET_KIND,
        status: { in: ["Queued", "Running"] },
        leasedBy: JOB_WORKER_OWNER_ID,
      },
      data: getTerminalLeaseData({
        status: "Completed",
        progress: 100,
        source: `Mock dataset stage completed: ${SHOPIFY_MOCK_DATASET_STAGE_LABELS[stage]}.`,
        payload: summary,
        finishedAt: new Date(),
      }),
    });
  });
}

function ensureProductDiagnosisQueueWorker(shop, options = {}) {
  if (!shouldStartInlineWorkers(options) || !shop || activeDiagnosisQueueWorkers.has(PRODUCT_DIAGNOSIS_QUEUE_WORKER_KEY)) return;

  activeDiagnosisQueueWorkers.add(PRODUCT_DIAGNOSIS_QUEUE_WORKER_KEY);
  setTimeout(async () => {
    try {
      await requeueExpiredProductPulseJobs();

      for (;;) {
        const job = await claimNextProductPulseJob();
        if (!job) break;

        try {
          await processClaimedProductPulseJob(job, options);
        } catch (error) {
          await recordJobLog({
            shop: job.shop,
            jobId: job.id,
            level: "error",
            event: "product_diagnosis.worker_failed",
            message: `${getJobDisplayName(job.kind)} worker failed.`,
            data: { kind: job.kind, error: serializeError(error), payload: job.payload },
          });
          await markJobFailed(job.id, error, `${getJobDisplayName(job.kind)} failed`);
          if (job.kind === PRODUCT_DIAGNOSIS_KIND) {
            await maybeSendWatchlistRunAlertForJob({
              ...job,
              status: "Failed",
              errorMessage: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    } finally {
      activeDiagnosisQueueWorkers.delete(PRODUCT_DIAGNOSIS_QUEUE_WORKER_KEY);
      const queuedCount = await prisma.catalogSignalJob.count({
        where: {
          kind: { in: [FAST_PRODUCT_SCAN_KIND, PRODUCT_DIAGNOSIS_KIND, SHOPIFY_MOCK_DATASET_KIND] },
          status: "Queued",
        },
      });
      if (queuedCount > 0) ensureProductDiagnosisQueueWorker(shop, options);
    }
  }, 0);
}

async function requeueExpiredProductPulseJobs(shop) {
  const now = new Date();
  const staleUnleasedCutoff = new Date(Date.now() - STALE_JOB_TIMEOUT_MS);
  const where = {
    kind: { in: [FAST_PRODUCT_SCAN_KIND, PRODUCT_DIAGNOSIS_KIND, SHOPIFY_MOCK_DATASET_KIND] },
    status: "Running",
    OR: [
      { leaseExpiresAt: { lte: now } },
      { leaseExpiresAt: null, updatedAt: { lte: staleUnleasedCutoff } },
    ],
    NOT: {
      AND: [
        { kind: PRODUCT_DIAGNOSIS_KIND },
        { payload: { path: ["openAiBatch", "status"], equals: "waiting" } },
      ],
    },
    ...(shop ? { shop } : {}),
  };
  const recovered = await prisma.catalogSignalJob.updateMany({
    where,
    data: {
      status: "Queued",
      progress: 0,
      source: "Requeued after background worker lease expired",
      leasedBy: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
    },
  });

  if (recovered.count > 0) {
    const jobs = await prisma.catalogSignalJob.findMany({
      where: {
        kind: { in: [FAST_PRODUCT_SCAN_KIND, PRODUCT_DIAGNOSIS_KIND, SHOPIFY_MOCK_DATASET_KIND] },
        status: "Queued",
        ...(shop ? { shop } : {}),
      },
      orderBy: [{ updatedAt: "desc" }],
      take: recovered.count,
    });

    for (const job of jobs) {
      await recordJobLog({
        shop: job.shop,
        jobId: job.id,
        event: "background_worker.requeued",
        message: "Recovered expired background job lease and returned it to the queue.",
        data: { kind: job.kind, payload: job.payload },
      });
    }
  }
}

async function resumeProductDiagnosisJobFromOpenAiBatchGroup(groupId) {
  const group = await claimOpenAiBatchGroupForResume(groupId);
  if (!group) return { status: "already_claimed_or_processed", groupId };

  const job = await prisma.catalogSignalJob.findFirst({
    where: {
      id: group.jobId,
      shop: group.shop,
      kind: PRODUCT_DIAGNOSIS_KIND,
    },
  });

  if (!job) {
    const error = new Error("Product Diagnosis job was not found for OpenAI Batch resume.");
    await markOpenAiBatchGroupResumeFailed(group.id, error);
    throw error;
  }

  if (!isActiveStatus(job.status)) {
    await markOpenAiBatchGroupProcessed(group.id, {
      skipped: true,
      reason: "job_not_active",
      jobStatus: job.status,
    });
    return { status: "skipped", reason: "job_not_active", jobStatus: job.status, groupId: group.id };
  }

  const startedAt = Date.now();
  try {
    await recordJobLog({
      shop: job.shop,
      jobId: job.id,
      event: "product_diagnosis.openai_batch_resume_started",
      message: "OpenAI Batch API returned terminal Product Diagnosis AI results; resuming persisted diagnosis.",
      data: {
        groupId: group.id,
        openAiBatchIds: group.batches.map((batch) => batch.openAiBatchId).filter(Boolean),
        completedRequestCount: group.completedRequestCount,
        failedRequestCount: group.failedRequestCount,
      },
    });

    const productId = job.payload?.productGid || job.payload?.handle || job.payload?.productId || group.productGid;
    const snapshot = await findProductRiskSnapshot(job.shop, productId);
    if (!snapshot) throw new Error("Product snapshot was not found for OpenAI Batch diagnosis resume.");

    const admin = await getOfflineAdmin(job.shop);
    const pointDebit = await ensureProductDiagnosisPointDebit(job);
    const productImage = await resolveSnapshotProductImage(job.shop, snapshot, admin).catch(() => ({
      imageUrl: job.payload?.productImageUrl || job.payload?.imageUrl || "",
      imageAlt: job.payload?.productImageAlt || job.payload?.imageAlt || snapshot.productTitle,
    }));
    const diagnosis = await resumeDetailedProductDiagnosisFromOpenAiBatch({
      shop: job.shop,
      jobId: job.id,
      admin,
      batchGroupId: group.id,
    });

    await completeProductDiagnosisJobAfterDiagnosis({
      job,
      snapshot,
      diagnosis,
      pointDebit,
      productImage,
      startedAt,
    });
    await markOpenAiBatchGroupProcessed(group.id, {
      diagnosisId: diagnosis.diagnosisId,
      riskScore: diagnosis.riskScore,
      confidence: diagnosis.confidence,
      completedAt: new Date().toISOString(),
    });

    return {
      status: "completed",
      groupId: group.id,
      jobId: job.id,
      diagnosisId: diagnosis.diagnosisId,
    };
  } catch (error) {
    await markOpenAiBatchGroupResumeFailed(group.id, error).catch(() => {});
    await recordJobLog({
      shop: job.shop,
      jobId: job.id,
      level: "error",
      event: "product_diagnosis.openai_batch_resume_failed",
      message: "Product Diagnosis failed while resuming after OpenAI Batch completion.",
      data: {
        groupId: group.id,
        error: serializeError(error),
      },
    }).catch(() => {});
    await markJobFailed(job.id, error, "Product Diagnosis failed after OpenAI Batch completion");
    throw error;
  }
}

async function runProductDiagnosisJob(job) {
  const startedAt = Date.now();
  const productId = job.payload?.productGid || job.payload?.handle || job.payload?.productId;
  const snapshot = await measureProductDiagnosisWorkerStep(
    job,
    "snapshot_lookup",
    () => findProductRiskSnapshot(job.shop, productId),
    { productId },
    (result) => ({
      found: Boolean(result),
      productGid: result?.productGid || null,
      handle: result?.handle || null,
      riskScore: result?.riskScore ?? null,
      confidence: result?.confidence ?? null,
    }),
  );
  if (!snapshot) throw new Error("Product snapshot was not found for queued diagnosis job.");

  const metrics = snapshot.metrics || {};

  await measureProductDiagnosisWorkerStep(job, "record_started_log", () => recordJobLog({
    shop: job.shop,
    jobId: job.id,
    event: "product_diagnosis.started",
    message: "Product diagnosis job started from the persisted queue.",
    data: {
      productGid: snapshot.productGid,
      handle: snapshot.handle,
      title: snapshot.productTitle,
      riskScore: snapshot.riskScore,
      confidence: snapshot.confidence,
      primaryIssue: snapshot.primaryIssue,
      sourceCoverage: snapshot.sourceCoverage,
      metrics: {
        signalCount: metrics.signalCount,
        returnRate: metrics.returnRate,
        refundRate: metrics.refundRate,
        topReturnReasons: metrics.topReturnReasons,
      },
    },
  }));

  const pointDebit = await measureProductDiagnosisWorkerStep(
    job,
    "point_debit",
    () => ensureProductDiagnosisPointDebit(job),
    { productGid: snapshot.productGid },
    (result) => ({
      status: result?.status || null,
      amount: result?.amount ?? null,
      hasLedgerEntry: Boolean(result?.ledgerEntry?.id),
      balance: result?.balance ?? null,
    }),
  );

  await measureProductDiagnosisWorkerStep(job, "progress_preparing", () => updateProductDiagnosisJob(job.id, {
    progress: 18,
    source: `Preparing Product Diagnosis - ${snapshot.productTitle}`,
  }));

  await measureProductDiagnosisWorkerStep(job, "progress_analyzing", () => updateProductDiagnosisJob(job.id, {
    progress: 42,
    source: `Analyzing Shopify and Judge.me evidence - ${snapshot.productTitle}`,
  }));

  const admin = await measureProductDiagnosisWorkerStep(
    job,
    "offline_admin",
    () => getOfflineAdmin(job.shop),
    {},
    (result) => ({
      hasAdmin: Boolean(result),
      hasGraphql: Boolean(result?.graphql),
      hasScopes: Boolean(result?.productPulseScopes),
    }),
  );
  const productImage = await measureProductDiagnosisWorkerStep(
    job,
    "product_image",
    () => resolveSnapshotProductImage(job.shop, snapshot, admin),
    { productGid: snapshot.productGid },
    (result) => ({
      hasImage: Boolean(result?.imageUrl),
      imageSource: result?.source || null,
    }),
  );
  const diagnosis = await measureProductDiagnosisWorkerStep(
    job,
    "detailed_analysis",
    () => runDetailedProductDiagnosis({
      shop: job.shop,
      jobId: job.id,
      admin,
      snapshot,
      batchMode: job.payload?.batchMode || null,
    }),
    { productGid: snapshot.productGid },
    (result) => ({
      status: result?.status || null,
      diagnosisId: result?.diagnosisId || null,
      skipped: Boolean(result?.skipped),
      skipReason: result?.skipReason || null,
      riskScore: result?.riskScore ?? null,
      confidence: result?.confidence ?? null,
      provider: result?.provider || null,
      model: result?.model || null,
    }),
  );
  if (diagnosis?.status === "waiting_openai_batch") {
    await markProductDiagnosisJobWaitingForOpenAiBatch({ job, snapshot, diagnosis, productImage });
    return;
  }

  await completeProductDiagnosisJobAfterDiagnosis({
    job,
    snapshot,
    diagnosis,
    pointDebit,
    productImage,
    startedAt,
  });
}

async function markProductDiagnosisJobWaitingForOpenAiBatch({ job, snapshot, diagnosis, productImage }) {
  const openAiBatch = diagnosis.openAiBatch || {};
  await updateProductDiagnosisJob(job.id, {
    status: "Running",
    progress: 82,
    source: `Waiting on OpenAI Batch API - ${snapshot.productTitle}`,
    payload: {
      ...(job.payload || {}),
      imageUrl: job.payload?.imageUrl || productImage.imageUrl || "",
      productImageUrl: job.payload?.productImageUrl || productImage.imageUrl || "",
      imageAlt: job.payload?.imageAlt || productImage.imageAlt || snapshot.productTitle,
      productImageAlt: job.payload?.productImageAlt || productImage.imageAlt || snapshot.productTitle,
      openAiBatch: {
        status: "waiting",
        waitingSince: new Date().toISOString(),
        groupId: openAiBatch.groupId || null,
        requestCount: openAiBatch.requestCount || 0,
        tasks: openAiBatch.tasks || [],
        batches: openAiBatch.batches || [],
      },
    },
    leasedBy: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
  });

  await recordJobLog({
    shop: job.shop,
    jobId: job.id,
    event: "product_diagnosis.openai_batch_waiting",
    message: "Product Diagnosis synchronous AI work completed; the job is waiting for OpenAI Batch API webhook completion.",
    data: {
      productGid: snapshot.productGid,
      openAiBatch,
      provider: diagnosis.provider,
      model: diagnosis.model,
      aiUsage: diagnosis.aiUsage,
    },
  });

  invalidateJobMonitorCache(job.shop);
  invalidateProductPulseDashboardCache(job.shop);
  invalidateBackgroundProcessCache(job.shop);
}

async function completeProductDiagnosisJobAfterDiagnosis({
  job,
  snapshot,
  diagnosis,
  pointDebit,
  productImage = {},
  startedAt = Date.now(),
}) {
  const pointCharge = await measureProductDiagnosisWorkerStep(
    job,
    "point_finalize",
    () => finalizeProductDiagnosisPointCharge(job, diagnosis, pointDebit),
    {
      diagnosisId: diagnosis?.diagnosisId || null,
      skipped: Boolean(diagnosis?.skipped),
    },
    (result) => ({
      status: result?.status || null,
      pointsConsumed: result?.pointsConsumed ?? null,
      hasRefundLedgerEntry: Boolean(result?.refundLedgerEntry?.id),
      balance: result?.balance ?? null,
    }),
  );

  await measureProductDiagnosisWorkerStep(job, "progress_finalizing", () => updateProductDiagnosisJob(job.id, {
    progress: 92,
    source: diagnosis?.skipped
      ? `No product changes detected - reused diagnosis - ${snapshot.productTitle}`
      : `Finalizing Product Diagnosis - ${snapshot.productTitle}`,
  }));

  const completedPayload = {
    ...(job.payload || {}),
    imageUrl: job.payload?.imageUrl || productImage.imageUrl || "",
    productImageUrl: job.payload?.productImageUrl || productImage.imageUrl || "",
    imageAlt: job.payload?.imageAlt || productImage.imageAlt || snapshot.productTitle,
    productImageAlt: job.payload?.productImageAlt || productImage.imageAlt || snapshot.productTitle,
    openAiBatch: diagnosis?.openAiBatchGroupId
      ? {
        ...(job.payload?.openAiBatch || {}),
        status: "completed",
        groupId: diagnosis.openAiBatchGroupId,
        completedAt: new Date().toISOString(),
      }
      : job.payload?.openAiBatch || undefined,
    creditsConsumed: pointCharge.pointsConsumed,
    pointsConsumed: pointCharge.pointsConsumed,
    pointLedgerEntryId: pointCharge.ledgerEntry?.id || null,
    pointRefundLedgerEntryId: pointCharge.refundLedgerEntry?.id || null,
    pointDebitStatus: pointCharge.status || "not_charged",
  };
  if (!completedPayload.openAiBatch) delete completedPayload.openAiBatch;

  await measureProductDiagnosisWorkerStep(job, "job_complete_update", () => updateProductDiagnosisJob(job.id, {
    status: "Completed",
    progress: 100,
    source: diagnosis?.skipped
      ? `No changes detected; previous diagnosis reused - ${snapshot.productTitle}`
      : `Product Diagnosis completed - ${snapshot.productTitle}`,
    payload: completedPayload,
    finishedAt: new Date(),
  }), {
    diagnosisId: diagnosis?.diagnosisId || null,
    skipped: Boolean(diagnosis?.skipped),
  });

  await measureProductDiagnosisWorkerStep(job, "record_completion_log", () => recordJobLog({
    shop: job.shop,
    jobId: job.id,
    event: "product_diagnosis.completed",
    message: diagnosis?.skipped && pointCharge.pointsConsumed <= 0
      ? "Product diagnosis finished from cache because no source changes were detected. No credit was consumed."
      : diagnosis?.openAiBatchGroupId
        ? "Product diagnosis completed after OpenAI Batch API returned terminal AI results."
        : "Product diagnosis completed.",
    data: {
      durationMs: Date.now() - startedAt,
      diagnosisId: diagnosis?.diagnosisId,
      skipped: Boolean(diagnosis?.skipped),
      skipReason: diagnosis?.skipReason,
      creditsConsumed: pointCharge.pointsConsumed,
      pointsConsumed: pointCharge.pointsConsumed,
      pointDebitStatus: pointCharge.status || "not_charged",
      pointLedgerEntryId: pointCharge.ledgerEntry?.id || null,
      pointRefundLedgerEntryId: pointCharge.refundLedgerEntry?.id || null,
      pointBalance: pointCharge.balance || null,
      riskScore: diagnosis?.riskScore,
      confidence: diagnosis?.confidence,
      estimatedImpact: diagnosis?.estimatedImpact,
      provider: diagnosis?.provider,
      model: diagnosis?.model,
      modelsUsed: diagnosis?.modelsUsed,
      aiUsage: diagnosis?.aiUsage,
      openAiBatchGroupId: diagnosis?.openAiBatchGroupId || null,
    },
  }), {
    durationMs: Date.now() - startedAt,
    diagnosisId: diagnosis?.diagnosisId || null,
  });
  invalidateJobMonitorCache(job.shop);
  invalidateProductPulseDashboardCache(job.shop);
  invalidateBackgroundProcessCache(job.shop);

  await measureProductDiagnosisWorkerStep(job, "watchlist_alert", () => maybeSendWatchlistRunAlertForJob({
    ...job,
    status: "Completed",
    payload: completedPayload,
  }), {
    diagnosisId: diagnosis?.diagnosisId || null,
  });
}

function isPointDebitRecorded(pointDebit) {
  return ["success", "already_recorded"].includes(pointDebit?.status);
}

function isPointCreditRecorded(pointCredit) {
  return ["success", "already_recorded"].includes(pointCredit?.status);
}

function getExistingProductDiagnosisPointDebit(job) {
  const payload = job.payload || {};
  if (!payload.pointLedgerEntryId || !isPointDebitRecorded({ status: payload.pointDebitStatus })) return null;
  const amount = Number(payload.pointCost || payload.pointsConsumed || payload.creditsConsumed || 1);
  return {
    status: payload.pointDebitStatus,
    charged: false,
    amount: Number.isFinite(amount) && amount > 0 ? amount : 1,
    ledgerEntry: { id: payload.pointLedgerEntryId },
    balance: null,
  };
}

async function ensureProductDiagnosisPointDebit(job) {
  const existing = getExistingProductDiagnosisPointDebit(job);
  if (existing) return existing;
  if (job.payload?.batchMode?.freeCreditMode) {
    return {
      status: "batch_mode_no_charge",
      charged: false,
      amount: 0,
      pointsConsumed: 0,
      ledgerEntry: null,
      balance: null,
    };
  }

  const pointDebit = await debitStorePointsForShop(job.shop, {
    amount: 1,
    reason: `Product credit debit product-diagnosis:${job.id} - ${job.payload?.productTitle || "selected product"}`,
    idempotencyKey: `product-diagnosis:${job.id}`,
    metadata: {
      source: "product_diagnosis",
      jobId: job.id,
      productGid: job.payload?.productGid || null,
      productTitle: job.payload?.productTitle || null,
      queued: false,
    },
  });

  if (!isPointDebitRecorded(pointDebit)) {
    await recordJobLog({
      shop: job.shop,
      jobId: job.id,
      level: "error",
      event: "product_diagnosis.points_not_consumed",
      message: pointDebit.message || "Product credits could not be consumed.",
      data: {
        pointsConsumed: 1,
        pointDebitStatus: pointDebit.status,
        pointBalance: pointDebit.balance || null,
      },
    });
    throw new Error(pointDebit.message || "Product diagnosis needs 1.0 credit before it can start.");
  }

  await updateProductDiagnosisJob(job.id, {
    payload: {
      ...(job.payload || {}),
      pointCost: 1,
      pointLedgerEntryId: pointDebit.ledgerEntry?.id || null,
      pointDebitStatus: pointDebit.status,
    },
  });

  return pointDebit;
}

async function finalizeProductDiagnosisPointCharge(job, diagnosis, pointDebit) {
  if (job.payload?.batchMode?.freeCreditMode || pointDebit?.status === "batch_mode_no_charge") {
    return {
      ...pointDebit,
      status: pointDebit?.status || "batch_mode_no_charge",
      amount: 0,
      pointsConsumed: 0,
      ledgerEntry: null,
      balance: pointDebit?.balance || null,
    };
  }
  const chargedAmount = Number(pointDebit?.amount || pointDebit?.ledgerEntry?.amount || job.payload?.pointCost || 1);
  const normalizedChargedAmount = Number.isFinite(chargedAmount) && chargedAmount > 0 ? chargedAmount : 1;
  const diagnosisPointsConsumed = Number(diagnosis?.creditsConsumed ?? 1);
  if (!Number.isFinite(diagnosisPointsConsumed) || diagnosisPointsConsumed <= 0) {
    const refund = await creditStorePointsForShop(job.shop, {
      amount: normalizedChargedAmount,
      reason: `Product credit refund product-diagnosis-refund:${job.id} - ${job.payload?.productTitle || "selected product"}`,
      idempotencyKey: `product-diagnosis-refund:${job.id}`,
      metadata: {
        source: "product_diagnosis_refund",
        jobId: job.id,
        originalLedgerEntryId: pointDebit?.ledgerEntry?.id || null,
        diagnosisId: diagnosis?.diagnosisId || null,
        productGid: job.payload?.productGid || null,
        productTitle: job.payload?.productTitle || null,
        skipped: Boolean(diagnosis?.skipped),
      },
    });

    if (!isPointCreditRecorded(refund)) {
      await recordJobLog({
        shop: job.shop,
        jobId: job.id,
        level: "error",
        event: "product_diagnosis.points_refund_failed",
        message: refund.message || "Product credit refund could not be recorded.",
        data: {
          pointDebitStatus: pointDebit?.status || "unknown",
          pointRefundStatus: refund.status,
          pointBalance: refund.balance || null,
        },
      });
      return {
        ...pointDebit,
        status: `refund_${refund.status || "failed"}`,
        pointsConsumed: normalizedChargedAmount,
        balance: refund.balance || pointDebit?.balance || null,
      };
    }

    return {
      ...pointDebit,
      status: "refunded",
      pointsConsumed: 0,
      refundLedgerEntry: refund.ledgerEntry || null,
      balance: refund.balance || pointDebit?.balance || null,
    };
  }

  return {
    ...pointDebit,
    pointsConsumed: normalizedChargedAmount,
  };
}

async function getOfflineAdmin(shop) {
  const { admin, session } = await unauthenticated.admin(shop);
  return Object.assign(admin, { productPulseScopes: session.scope });
}

async function getBackgroundShopifyAdmin(shop) {
  return { admin: await getOfflineAdmin(shop), source: "offline" };
}

async function updateProductDiagnosisJob(jobId, data) {
  await prisma.catalogSignalJob.updateMany({
    where: {
      id: jobId,
      kind: PRODUCT_DIAGNOSIS_KIND,
      status: { in: ["Queued", "Running"] },
    },
    data: getTerminalLeaseData(data),
  });
}

async function shopifyGraphql(admin, query, variables) {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  const json = await response.json();
  const errors = json.errors || [];
  if (errors.length) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }
  return json.data;
}

async function markJobFailed(jobId, error, source = "Catalog Scan failed") {
  await prisma.catalogSignalJob.updateMany({
    where: {
      id: jobId,
      status: { in: ["Queued", "Running"] },
    },
    data: {
      ...getTerminalLeaseData({
        status: "Failed",
        progress: 100,
        source,
        errorMessage: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      }),
    },
  });
}

function normalizeStartArgs(input, adminArg, scopesArg) {
  if (typeof input === "string") {
    return { shop: input, admin: adminArg, scopes: scopesArg || adminArg?.productPulseScopes || "" };
  }

  return {
    shop: input.shop,
    admin: input.admin,
    scopes: input.scopes || input.session?.scope || input.admin?.productPulseScopes || "",
  };
}

function isActiveStatus(status) {
  return status === "Queued" || status === "Running";
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function logProductPulseWorkerProgress(event, context = {}, data = {}, level = "warn") {
  if (process.env.NODE_ENV === "test") return;
  if (shouldSuppressAggregatedWorkerProgress(event)) return;
  const method = level === "error" ? "error" : level === "info" ? "info" : "warn";
  const job = context.job || null;
  const payload = {
    event,
    at: new Date().toISOString(),
    shop: context.shop || job?.shop,
    jobId: job?.id,
    kind: job?.kind,
    ...getProductPulseWorkerMemorySnapshot(),
    ...data,
  };
  console[method]("[product-pulse-worker]", payload);
}

function shouldSuppressAggregatedWorkerProgress(event) {
  const normalized = String(event || "");
  return normalized.startsWith("quick_scan.") || normalized.startsWith("product_diagnosis.");
}

function logInlineWorkerSkipOnce(event, job, data = {}) {
  if (!job?.id) return;
  const key = `${event}:${job.id}:${job.status || ""}:${data.workerMode || ""}`;
  if (inlineWorkerSkipLogKeys.has(key)) return;
  inlineWorkerSkipLogKeys.add(key);
  logProductPulseWorkerProgress(event, { job }, data, "warn");
}

async function measureProductDiagnosisWorkerStep(job, stage, callback, data = {}, summarizeResult = null) {
  logProductPulseWorkerProgress(`product_diagnosis.${stage}.started`, { job }, data);
  const startedAt = Date.now();
  try {
    const result = await callback();
    const resultData = typeof summarizeResult === "function" ? summarizeResult(result) : {};
    logProductPulseWorkerProgress(`product_diagnosis.${stage}.done`, { job }, {
      durationMs: Date.now() - startedAt,
      ...data,
      ...resultData,
    });
    return result;
  } catch (error) {
    logProductPulseWorkerProgress(`product_diagnosis.${stage}.failed`, { job }, {
      durationMs: Date.now() - startedAt,
      ...data,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }, "error");
    throw error;
  }
}

function getProductPulseWorkerMemorySnapshot() {
  const memory = process.memoryUsage();
  return {
    heapUsedMb: productPulseWorkerToMb(memory.heapUsed),
    heapTotalMb: productPulseWorkerToMb(memory.heapTotal),
    rssMb: productPulseWorkerToMb(memory.rss),
    externalMb: productPulseWorkerToMb(memory.external),
  };
}

function productPulseWorkerToMb(value) {
  return Math.round((Number(value || 0) / 1024 / 1024) * 10) / 10;
}

function formatProductRow(shop, snapshot, latestDiagnosis = null, resolvedAction = null, settings = undefined, watchedItem = null, scoreHistory = []) {
  const metrics = snapshot.metrics || {};
  const image = getSnapshotProductImage(snapshot);
  const sources = Array.isArray(snapshot.sourceCoverage) ? snapshot.sourceCoverage : [];
  const analysisState = getProductAnalysisState(snapshot, latestDiagnosis);
  const resolvedAt = resolvedAction?.appliedAt || resolvedAction?.createdAt || null;
  const riskLabel = getRiskLabel(snapshot.riskScore, settings);
  const riskTone = getRiskTone(snapshot.riskScore, settings);
  const isWatched = Boolean(watchedItem);
  const signalCount = Number(metrics.signalCount || metrics.signalsCount || metrics.issueCount || 0);
  const sourceCount = sources.length;
  return {
    productGid: snapshot.productGid,
    handle: snapshot.handle,
    title: snapshot.productTitle,
    variant: getProductArtVariant(snapshot.handle),
    imageUrl: image.imageUrl || "",
    imageAlt: image.imageAlt || snapshot.productTitle || "",
    selected: false,
    risk: riskLabel,
    riskTone,
    riskScore: snapshot.riskScore,
    status: getStatusLabel(snapshot.riskScore, Boolean(resolvedAt), settings),
    statusTone: resolvedAt ? "success" : riskTone,
    resolvedAt: toIso(resolvedAt),
    resolvedLabel: resolvedAt ? `Resolved ${formatJobDate(resolvedAt)}` : "",
    analysisDepth: analysisState.depth,
    analysisLabel: analysisState.label,
    analysisDetail: analysisState.detail,
    analysisTone: analysisState.tone,
    analysisIcon: analysisState.icon,
    analysisCompletedAt: analysisState.completedAt,
    isWatched,
    watchlistStatus: watchedItem?.status || null,
    signals: signalCount,
    signalTone: getEvidenceToneForProduct(snapshot.riskScore, { signalCount }, settings),
    signalBars: getProductTableSignalBars(signalCount, sourceCount),
    signalStrengthLabel: getEvidenceStrengthLabel({ signalCount, sourceCount }),
    sourceCount,
    riskTrend: getProductRiskTrendForRow(metrics, scoreHistory),
    productMomentum: getProductTableMomentum(metrics),
    issue: snapshot.primaryIssue,
    sources: sources.map(getSourceToken),
    sourceOverflow: Math.max(0, sources.length - 3),
    lastAnalysis: formatJobDate(snapshot.updatedAt),
    lastAnalysisAt: toIso(snapshot.updatedAt),
    credits: 1,
    href: `/app/products/${snapshot.handle}`,
    shopifyAdminUrl: getShopifyProductAdminUrl(shop, snapshot.productGid),
    shopifyStorefrontUrl: getShopifyProductStorefrontUrl(shop, snapshot.handle),
  };
}

function getProductTableSignalBars(signalCount = 0, sourceCount = 0) {
  const normalizedSignalCount = Math.max(0, Number(signalCount || 0));
  if (!normalizedSignalCount) return [4, 4, 4];
  const activeBars = Math.max(1, Math.min(3, Number(sourceCount || 1)));
  const height = Math.min(100, Math.max(18, normalizedSignalCount * 8));
  return Array.from({ length: 3 }, (_, index) => (index < activeBars ? height : 8));
}

function getProductTableMomentum(metrics = {}) {
  if (metrics.productMomentum && typeof metrics.productMomentum === "object" && !Array.isArray(metrics.productMomentum)) {
    return metrics.productMomentum;
  }

  const scoreValue = Number(metrics.productMomentumScore);
  const confidenceValue = Number(metrics.momentumConfidence);
  const hasCompactMomentum = Number.isFinite(scoreValue)
    || hasText(metrics.productMomentumTier)
    || hasText(metrics.momentumDirection)
    || Number.isFinite(confidenceValue);
  if (!hasCompactMomentum) return null;

  const score = Number.isFinite(scoreValue) ? Math.round(scoreValue) : 0;
  const confidence = Number.isFinite(confidenceValue) ? Math.round(confidenceValue) : 0;
  const direction = hasText(metrics.momentumDirection) ? String(metrics.momentumDirection) : "Steady";

  return {
    source: "product-table",
    score,
    tier: hasText(metrics.productMomentumTier) ? String(metrics.productMomentumTier) : getProductTableMomentumTier(score),
    direction,
    confidence,
    confidenceLabel: hasText(metrics.momentumConfidenceLabel)
      ? String(metrics.momentumConfidenceLabel)
      : getProductTableMomentumConfidenceLabel(confidence),
    calculatedAt: null,
    windowDays: Number(metrics.windowDays || 30),
    baselineDays: 30,
    components: {
      currentVelocityScore: score,
      growthScore: 0,
      catalogShareScore: 0,
      trendConsistencyScore: 0,
      recencyScore: 0,
    },
    inputs: {
      unitsLast7Days: 0,
      unitsLast14Days: 0,
      unitsLast30Days: Number(metrics.soldUnits || 0),
      unitsPrevious30Days: 0,
      unitsPrevious90Days: 0,
      revenueLast30Days: Number(metrics.salesAmount || 0),
      revenuePrevious30Days: 0,
      revenuePrevious90Days: 0,
      ordersLast30Days: 0,
      weeklyUnitsLast4Weeks: [],
      weeklyRevenueLast4Weeks: [],
      weeklyUnitsLast8Weeks: [],
      weeklyRevenueLast8Weeks: [],
      lastSaleAt: null,
    },
    catalog: {
      unitsVelocityScore: 0,
      revenueVelocityScore: 0,
      productShareLast30: 0,
      productShareBaseline: 0,
      shareLiftRatio: 0,
      topCatalogPercent: null,
      catalogProductCount: 0,
      hasCatalogBaseline: false,
    },
    display: {
      growthPercent: 0,
      growthLabel: "0%",
      catalogPositionLabel: "Catalog baseline pending",
      trendLabel: direction,
      recommendedUse: "Open Product Diagnosis for full Sales Momentum context.",
    },
    flags: {},
  };
}

function getProductTableMomentumTier(score) {
  const value = Number(score || 0);
  if (value >= 80) return "Hot";
  if (value >= 60) return "Rising";
  if (value >= 40) return "Stable";
  if (value >= 20) return "Cooling";
  return "Low activity";
}

function getProductTableMomentumConfidenceLabel(confidence) {
  const value = Number(confidence || 0);
  if (value >= 80) return "High confidence";
  if (value >= 60) return "Medium confidence";
  if (value >= 40) return "Low confidence";
  return "Very low confidence";
}

function getProductRiskTrendForRow(metrics = {}, scoreHistory = []) {
  const scoreHistoryValues = formatProductRiskHistory(scoreHistory)
    .map((entry) => Number(entry.riskScore))
    .filter((value) => Number.isFinite(value));
  if (scoreHistoryValues.length >= 2) return scoreHistoryValues.slice(-12);
  const riskHistoryValues = (Array.isArray(metrics.riskHistory) ? metrics.riskHistory : [])
    .map((entry) => Number(entry?.riskScore))
    .filter((value) => Number.isFinite(value));
  if (riskHistoryValues.length >= 2) return riskHistoryValues.slice(-12);
  return (Array.isArray(metrics.riskTrend) ? metrics.riskTrend : [])
    .map(Number)
    .filter((value) => Number.isFinite(value))
    .slice(-12);
}

function getProductAnalysisState(snapshot, latestDiagnosis = null) {
  const metrics = snapshot.metrics || {};
  const completedAt = latestDiagnosis?.completedAt || metrics.lastDetailedDiagnosisAt || null;
  const hasFullDiagnosis = Boolean(latestDiagnosis || metrics.latestDiagnosisId || completedAt);
  if (hasFullDiagnosis) {
    return {
      depth: "full",
      label: "Product diagnosis",
      tone: "success",
      icon: "wand",
      completedAt: toIso(completedAt),
      detail: completedAt
        ? `Product Diagnosis completed ${formatJobDate(completedAt)}.`
        : "Product Diagnosis completed.",
    };
  }

  return {
    depth: "quickscan",
    label: "Catalog Scan only",
    tone: "info",
    icon: "search",
    completedAt: null,
    detail: "Preliminary Shopify scan only. Run Product Diagnosis for recommended actions.",
  };
}

function attachActiveProductDiagnosisJobs(rows, jobs) {
  if (!jobs.length) return rows;
  const jobByProductKey = new Map();

  jobs.forEach((job) => {
    getProductDiagnosisJobKeys(job).forEach((key) => {
      const current = jobByProductKey.get(key);
      if (!current || isPreferredProductDiagnosisJob(job, current)) {
        jobByProductKey.set(key, job);
      }
    });
  });

  return rows.map((row) => {
    const job = jobByProductKey.get(row.productGid) || jobByProductKey.get(row.handle);
    return job ? { ...row, diagnosisJob: formatJob(job) } : row;
  });
}

function getProductDiagnosisJobKeys(job) {
  return [
    job.payload?.productGid,
    job.payload?.handle,
    job.payload?.productId,
  ].filter(Boolean).map(String);
}

function getActiveDiagnosisProductKeySet(jobs = []) {
  const keys = new Set();
  jobs.forEach((job) => {
    getProductDiagnosisJobKeys(job).forEach((key) => keys.add(key));
  });
  return keys;
}

function isPreferredProductDiagnosisJob(candidate, current) {
  if (candidate.status === "Running" && current.status !== "Running") return true;
  if (candidate.status !== "Running" && current.status === "Running") return false;
  return new Date(candidate.updatedAt).getTime() > new Date(current.updatedAt).getTime();
}

function filterProductSnapshots(
  snapshots,
  filters = {},
  resolvedActionsByProductGid = new Map(),
  settings = undefined,
  latestDiagnosisByProductGid = new Map(),
  activeDiagnosisProductKeys = new Set(),
) {
  const query = String(filters.query || "").trim().toLowerCase();

  return snapshots.filter((snapshot) => {
    const metrics = snapshot.metrics || {};
    const sources = Array.isArray(snapshot.sourceCoverage) ? snapshot.sourceCoverage : [];
    const collections = Array.isArray(metrics.collections) ? metrics.collections : [];
    const tags = Array.isArray(metrics.tags) ? metrics.tags : [];
    const isResolved = resolvedActionsByProductGid.has(snapshot.productGid);
    const searchable = [
      snapshot.productTitle,
      snapshot.handle,
      snapshot.primaryIssue,
      isResolved ? "resolved" : "",
      metrics.vendor,
      metrics.productType,
      ...collections,
      ...tags,
      ...sources,
    ].filter(Boolean).join(" ").toLowerCase();

    if (query && !searchable.includes(query)) return false;
    if (filters.resolution === "resolved" && !isResolved) return false;
    if (["unresolved", "exclude-resolved"].includes(filters.resolution) && isResolved) return false;
    if (filters.analysis && filters.analysis !== "all" && getSnapshotAnalysisDepth(snapshot, latestDiagnosisByProductGid, activeDiagnosisProductKeys) !== filters.analysis) return false;
    if (filters.risk && filters.risk !== "all" && getRiskFilterValue(snapshot.riskScore, settings) !== filters.risk) return false;
    if (filters.status && filters.status !== "all" && getStatusFilterValue(snapshot.riskScore, isResolved, settings) !== filters.status) return false;
    if (filters.issue && filters.issue !== "all" && slugifyFilterValue(snapshot.primaryIssue) !== filters.issue) return false;
    if (filters.source && filters.source !== "all" && !sources.some((source) => slugifyFilterValue(source) === filters.source)) return false;

    if (filters.vendor && filters.vendor !== "all") {
      if (!matchesProductFilterText(metrics.vendor, filters.vendor)) return false;
    }

    if (filters.collection && filters.collection !== "all") {
      if (!collections.some((collection) => matchesProductFilterText(collection, filters.collection))) return false;
    }

    return true;
  });
}

function sortProductSnapshots(snapshots, filters = {}, resolvedActionsByProductGid = new Map()) {
  const sort = filters.sort === "lastAnalysis" ? "lastAnalysis" : "riskScore";
  const direction = filters.direction === "asc" ? 1 : -1;

  return [...snapshots].sort((first, second) => {
    const firstResolved = resolvedActionsByProductGid.has(first.productGid);
    const secondResolved = resolvedActionsByProductGid.has(second.productGid);
    if (firstResolved !== secondResolved) return firstResolved ? 1 : -1;

    const firstValue = sort === "lastAnalysis" ? new Date(first.updatedAt).getTime() : Number(first.riskScore || 0);
    const secondValue = sort === "lastAnalysis" ? new Date(second.updatedAt).getTime() : Number(second.riskScore || 0);

    if (firstValue === secondValue) return String(first.productTitle).localeCompare(String(second.productTitle));
    return (firstValue - secondValue) * direction;
  });
}

function getProductTableFilterOptions(
  snapshots,
  settings = undefined,
  latestDiagnosisByProductGid = new Map(),
  activeDiagnosisProductKeys = new Set(),
) {
  const issues = new Map();
  const sources = new Map();
  const vendors = new Map();
  const collections = new Map();
  const statuses = new Map();
  const analysisCounts = { all: snapshots.length, quickscan: 0, full: 0 };

  snapshots.forEach((snapshot) => {
    const metrics = snapshot.metrics || {};
    const analysisDepth = getSnapshotAnalysisDepth(snapshot, latestDiagnosisByProductGid, activeDiagnosisProductKeys);
    if (analysisCounts[analysisDepth] !== undefined) analysisCounts[analysisDepth] += 1;
    addFilterOption(issues, snapshot.primaryIssue);
    addFilterOption(statuses, getStatusLabel(snapshot.riskScore, false, settings), getStatusFilterValue(snapshot.riskScore, false, settings));
    (Array.isArray(snapshot.sourceCoverage) ? snapshot.sourceCoverage : []).forEach((source) => addFilterOption(sources, source));
    addFilterOption(vendors, metrics.vendor);
    (Array.isArray(metrics.collections) ? metrics.collections : []).forEach((collection) => addFilterOption(collections, collection));
  });

  return {
    analysis: [
      { value: "all", label: "All", count: analysisCounts.all },
      { value: "quickscan", label: "Catalog Scan", count: analysisCounts.quickscan },
      { value: "full", label: "Full diagnostic", count: analysisCounts.full },
    ],
    risks: [
      { value: "all", label: "All risk" },
      { value: "high", label: "High" },
      { value: "medium", label: "Medium" },
      { value: "low", label: "Low" },
    ],
    statuses: [{ value: "all", label: "All statuses" }, ...Array.from(statuses.values()).sort(compareFilterOptions)],
    issues: [{ value: "all", label: "Issue type" }, ...Array.from(issues.values()).sort(compareFilterOptions)],
    sources: [{ value: "all", label: "Source" }, ...Array.from(sources.values()).sort(compareFilterOptions)],
    vendors: [{ value: "all", label: "Vendor" }, ...Array.from(vendors.values()).sort(compareFilterOptions)],
    collections: [{ value: "all", label: "Collection" }, ...Array.from(collections.values()).sort(compareFilterOptions)],
  };
}

function getSnapshotAnalysisDepth(snapshot, latestDiagnosisByProductGid = new Map(), activeDiagnosisProductKeys = new Set()) {
  if (activeDiagnosisProductKeys?.has(snapshot.productGid) || activeDiagnosisProductKeys?.has(snapshot.handle)) return "full";
  return getProductAnalysisState(snapshot, latestDiagnosisByProductGid.get(snapshot.productGid)).depth;
}

function addFilterOption(map, label, value) {
  if (!label) return;
  const key = value || slugifyFilterValue(label);
  if (!key || map.has(key)) return;
  map.set(key, { value: key, label: String(label) });
}

function matchesProductFilterText(value, filterValue) {
  const normalizedFilter = slugifyFilterValue(filterValue);
  if (!normalizedFilter || normalizedFilter === "all") return true;
  const text = String(value || "");
  if (!text.trim()) return false;
  const normalizedValue = slugifyFilterValue(text);
  return normalizedValue === normalizedFilter || text.toLowerCase().includes(String(filterValue || "").trim().toLowerCase());
}

function compareFilterOptions(first, second) {
  return first.label.localeCompare(second.label);
}

function slugifyFilterValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function getRiskFilterValue(score, settings = undefined) {
  return getRiskFilterValueForScore(score, settings);
}

function getStatusFilterValue(score, resolved = false, settings = undefined) {
  return getStatusFilterValueForScore(score, resolved, settings);
}

function getStatusLabel(score, resolved = false, settings = undefined) {
  return getStatusLabelForScore(score, resolved, settings);
}

function normalizeRowsPerPage(value) {
  return Number(value) === 10 ? 10 : 5;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

async function resolveSnapshotProductImage(shop, snapshot, admin) {
  const currentImage = getSnapshotProductImage(snapshot);
  if (currentImage.imageUrl || !admin?.graphql || !snapshot?.productGid) return currentImage;

  const [rowWithImage] = await attachProductImages([{ productGid: snapshot.productGid }], admin);
  const imageUrl = normalizeJobPayloadString(rowWithImage?.imageUrl);
  if (!imageUrl) return currentImage;

  const imageAlt = normalizeJobPayloadString(rowWithImage?.imageAlt) || snapshot.productTitle || "";
  const nextMetrics = {
    ...(snapshot.metrics || {}),
    imageUrl,
    productImageUrl: imageUrl,
    imageAlt,
    productImageAlt: imageAlt,
  };

  await prisma.productRiskSnapshot.update({
    where: {
      shop_productGid: {
        shop,
        productGid: snapshot.productGid,
      },
    },
    data: {
      metrics: nextMetrics,
    },
  }).catch(() => null);

  snapshot.metrics = nextMetrics;
  await upsertProductPulseProductRollup(snapshot).catch(() => null);
  return { imageUrl, imageAlt };
}

async function backfillMissingProductImagesForSnapshots(shop, snapshots = [], admin, options = {}) {
  if (!shop || !admin?.graphql) return new Map();
  const limit = Math.max(1, Math.min(25, Number(options.limit || 10)));
  const candidates = [];
  const seen = new Set();

  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    if (!snapshot?.productGid || seen.has(snapshot.productGid)) continue;
    if (getSnapshotProductImage(snapshot).imageUrl) continue;
    seen.add(snapshot.productGid);
    candidates.push(snapshot);
    if (candidates.length >= limit) break;
  }

  if (!candidates.length) return new Map();

  const rows = await attachProductImages(candidates.map((snapshot) => ({ productGid: snapshot.productGid })), admin);
  const imageByProductGid = new Map(rows
    .map((row) => {
      const imageUrl = normalizeJobPayloadString(row?.imageUrl);
      if (!row?.productGid || !imageUrl) return null;
      return [row.productGid, {
        imageUrl,
        imageAlt: normalizeJobPayloadString(row.imageAlt),
      }];
    })
    .filter(Boolean));

  if (imageByProductGid.size) {
    for (const snapshot of candidates) {
      const image = imageByProductGid.get(snapshot.productGid);
      if (!image?.imageUrl) continue;
      snapshot.metrics = buildSnapshotMetricsWithProductImage(snapshot, image);
    }
    persistBackfilledSnapshotImages(shop, candidates, imageByProductGid).catch(() => null);
  }

  return imageByProductGid;
}

async function persistBackfilledSnapshotImages(shop, snapshots = [], imageByProductGid = new Map()) {
  for (const snapshot of snapshots) {
    const image = imageByProductGid.get(snapshot.productGid);
    if (!image?.imageUrl) continue;
    const nextMetrics = buildSnapshotMetricsWithProductImage(snapshot, image);

    await prisma.productRiskSnapshot.update({
      where: {
        shop_productGid: {
          shop,
          productGid: snapshot.productGid,
        },
      },
      data: { metrics: nextMetrics },
    }).catch(() => null);

    snapshot.metrics = nextMetrics;
    await upsertProductPulseProductRollup(snapshot).catch(() => null);
  }
}

function buildSnapshotMetricsWithProductImage(snapshot = {}, image = {}) {
  const imageUrl = normalizeJobPayloadString(image.imageUrl);
  const imageAlt = normalizeJobPayloadString(image.imageAlt) || snapshot.productTitle || "";
  return {
    ...(snapshot.metrics || {}),
    imageUrl,
    productImageUrl: imageUrl,
    featuredImageUrl: imageUrl,
    imageAlt,
    productImageAlt: imageAlt,
    featuredImageAlt: imageAlt,
  };
}

function mergeBackfilledImagesIntoRows(rows = [], imageByProductGid = new Map()) {
  if (!imageByProductGid?.size) return rows;
  return rows.map((row) => {
    if (row.imageUrl) return row;
    const image = imageByProductGid.get(row.productGid);
    if (!image?.imageUrl) return row;
    return {
      ...row,
      imageUrl: image.imageUrl,
      imageAlt: image.imageAlt || row.imageAlt || row.title || "",
    };
  });
}

function getSnapshotProductImage(snapshot = {}) {
  const metrics = snapshot.metrics || {};
  const product = metrics.product && typeof metrics.product === "object" ? metrics.product : {};
  const candidates = [
    snapshot.imageUrl,
    snapshot.productImageUrl,
    snapshot.featuredImageUrl,
    metrics.imageUrl,
    metrics.productImageUrl,
    metrics.featuredImageUrl,
    product.imageUrl,
    product.productImageUrl,
    product.featuredImageUrl,
    product.featuredMedia?.image?.url,
    product.featuredMedia?.preview?.image?.url,
    product.featuredImage?.url,
    typeof metrics.image === "string" ? metrics.image : metrics.image?.url,
    metrics.featuredImage?.url,
    getFirstProductMediaImageUrl(metrics.media),
    getFirstProductMediaImageUrl(product.media),
  ];
  const altCandidates = [
    snapshot.imageAlt,
    snapshot.productImageAlt,
    snapshot.featuredImageAlt,
    metrics.imageAlt,
    metrics.productImageAlt,
    metrics.featuredImageAlt,
    product.imageAlt,
    product.productImageAlt,
    product.featuredImageAlt,
    product.featuredMedia?.image?.altText,
    product.featuredMedia?.preview?.image?.altText,
    product.featuredImage?.altText,
    metrics.image?.altText,
    metrics.featuredImage?.altText,
    getFirstProductMediaImageAlt(metrics.media),
    getFirstProductMediaImageAlt(product.media),
    snapshot.productTitle,
  ];
  return {
    imageUrl: candidates.map(normalizeJobPayloadString).find(Boolean) || "",
    imageAlt: altCandidates.map(normalizeJobPayloadString).find(Boolean) || "",
  };
}

function getFirstProductMediaImageUrl(media) {
  const item = getFirstProductMediaItem(media);
  return item?.imageUrl || item?.url || item?.image?.url || item?.preview?.image?.url || "";
}

function getFirstProductMediaImageAlt(media) {
  const item = getFirstProductMediaItem(media);
  return item?.imageAlt || item?.alt || item?.altText || item?.image?.altText || item?.preview?.image?.altText || "";
}

function getFirstProductMediaItem(media) {
  if (Array.isArray(media)) return media[0] || null;
  if (Array.isArray(media?.nodes)) return media.nodes[0] || null;
  if (Array.isArray(media?.edges)) return media.edges[0]?.node || null;
  return null;
}

async function attachProductImages(rows, admin) {
  if (!admin?.graphql || rows.length === 0) return rows;
  const ids = rows.map((row) => row.productGid).filter(Boolean);
  if (!ids.length) return rows;

  return withTimeout(
    attachProductImagesFromShopify(rows, admin, ids),
    SHOPIFY_PRODUCT_IMAGE_TIMEOUT_MS,
    "Shopify product image lookup timed out.",
  ).catch(() => rows);
}

async function attachProductImagesFromShopify(rows, admin, ids) {
  try {
    const response = await admin.graphql(
      `#graphql
      query ProductPulseProductImages($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
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
        }
      }`,
      { variables: { ids } },
    );
    const json = await response.json();
    if (json.errors?.length) return rows;

    const imageByProduct = new Map((json.data?.nodes || []).filter(Boolean).map((product) => {
      const mediaNode = product.media?.nodes?.[0] || {};
      const image = product.featuredMedia?.preview?.image || mediaNode.image || mediaNode.preview?.image || {};
      return [product.id, {
        imageUrl: image.url || null,
        imageAlt: image.altText || null,
      }];
    }));

    return rows.map((row) => ({
      ...row,
      ...(imageByProduct.get(row.productGid) || {}),
    }));
  } catch {
    return rows;
  }
}

function withTimeout(promise, timeoutMs, message = "Operation timed out.") {
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout));
}

async function attachProductRelationshipImagesToDiagnosis(product, admin) {
  const summary = product?.metrics?.productRelationshipIntelligenceSummary;
  if (!summary || typeof summary !== "object" || !admin?.graphql) return product;
  const ids = collectProductRelationshipProductIds(summary);
  if (!ids.length) return product;

  const rows = await attachProductImages(ids.map((productGid) => ({ productGid })), admin);
  const imageByProductId = new Map(rows
    .filter((row) => row.productGid && row.imageUrl)
    .map((row) => [row.productGid, { imageUrl: row.imageUrl, imageAlt: row.imageAlt || "" }]));
  if (!imageByProductId.size) return product;

  return {
    ...product,
    metrics: {
      ...product.metrics,
      productRelationshipIntelligenceSummary: enrichProductRelationshipSummaryImages(summary, imageByProductId),
    },
  };
}

function collectProductRelationshipProductIds(summary) {
  const ids = new Set();
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const productGid = normalizeShopifyProductGid(
      value.related_product_id
        || value.relatedProductId,
    );
    if (productGid) ids.add(productGid);
    Object.values(value).forEach((child) => {
      if (child && typeof child === "object") visit(child);
    });
  };
  visit(summary);
  return Array.from(ids);
}

function enrichProductRelationshipSummaryImages(summary, imageByProductId) {
  const visit = (value) => {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(visit);
    const next = { ...value };
    const productGid = normalizeShopifyProductGid(
      next.related_product_id
        || next.relatedProductId,
    );
    const image = productGid ? imageByProductId.get(productGid) : null;
    if (image && !next.related_product_image_url && !next.relatedProductImageUrl && !next.imageUrl && !next.image_url) {
      next.related_product_image_url = image.imageUrl;
      next.relatedProductImageUrl = image.imageUrl;
      next.imageUrl = image.imageUrl;
      if (image.imageAlt) {
        next.related_product_image_alt = image.imageAlt;
        next.relatedProductImageAlt = image.imageAlt;
        next.imageAlt = image.imageAlt;
      }
    }
    Object.entries(next).forEach(([key, child]) => {
      if (child && typeof child === "object") next[key] = visit(child);
    });
    return next;
  };
  return visit(summary);
}

async function attachProductImageToDiagnosis(product, admin) {
  if (!product || !admin?.graphql) return product;
  try {
    const response = await admin.graphql(
      `#graphql
      query ProductPulseProductDetailPreview($id: ID!) {
        product(id: $id) {
          id
          description
          descriptionHtml
          tags
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
      }`,
      { variables: { id: product.id } },
    );
    const json = await response.json();
    const shopifyProduct = json.data?.product;
    if (json.errors?.length || !shopifyProduct) return product;
    const mediaNode = shopifyProduct.media?.nodes?.[0] || {};
    const image = shopifyProduct.featuredMedia?.preview?.image || mediaNode.image || mediaNode.preview?.image || {};

    return {
      ...product,
      imageUrl: image.url || null,
      imageAlt: image.altText || null,
      currentDescriptionHtml: shopifyProduct.descriptionHtml || "",
      currentDescriptionText: cleanProductDescription(shopifyProduct),
      currentTags: Array.isArray(shopifyProduct.tags) ? shopifyProduct.tags : [],
    };
  } catch {
    const [rowWithImage] = await attachProductImages([{ productGid: product.id }], admin);
    return {
      ...product,
      imageUrl: rowWithImage?.imageUrl || null,
      imageAlt: rowWithImage?.imageAlt || null,
    };
  }
}

async function getLiveShopifyProductDetail(productId, admin, shop) {
  if (!admin?.graphql || !productId) return null;

  try {
    const response = await admin.graphql(
      `#graphql
      query ProductPulseLiveProductDetail($query: String!) {
        products(first: 1, query: $query) {
          nodes {
            id
            title
            handle
            description
            descriptionHtml
            vendor
            productType
            status
            tags
            options {
              name
              values
            }
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
            variants(first: 50) {
              nodes {
                id
                sku
                title
              }
            }
            collections(first: 10) {
              nodes {
                title
              }
            }
          }
        }
      }`,
      { variables: { query: `handle:${escapeShopifyQueryValue(productId)}` } },
    );
    const json = await response.json();
    if (json.errors?.length) return null;
    const product = json.data?.products?.nodes?.[0];
    if (!product) return null;
    const watchedItem = await prisma.productWatchlistItem.findUnique({
      where: { shop_productGid: { shop, productGid: product.id } },
      select: { status: true },
    });
    return withShopifyAdminUrl(formatLiveShopifyProductForDiagnosis(product, watchedItem), shop);
  } catch {
    return null;
  }
}

async function createManualProductRiskSnapshot(shop, admin, productId) {
  const product = await fetchShopifyProductForManualSnapshot(admin, productId);
  if (!product?.id) return null;
  const snapshotPayload = buildManualProductRiskSnapshotPayload(shop, product);

  const snapshot = await prisma.productRiskSnapshot.upsert({
    where: {
      shop_productGid: {
        shop,
        productGid: snapshotPayload.productGid,
      },
    },
    create: snapshotPayload,
    update: {
      productTitle: snapshotPayload.productTitle,
      handle: snapshotPayload.handle,
      sourceCoverage: snapshotPayload.sourceCoverage,
      metrics: snapshotPayload.metrics,
      calculatedAt: new Date(),
    },
  });
  await upsertProductPulseProductRollup(snapshot).catch(() => null);
  return snapshot;
}

async function fetchShopifyProductForManualSnapshot(admin, productId) {
  if (!admin?.graphql || !productId) return null;
  const productGid = normalizeShopifyProductGid(productId);

  if (productGid) {
    const data = await shopifyGraphql(
      admin,
      `#graphql
      query ProductPulseManualProductSnapshot($id: ID!) {
        product(id: $id) {
          ...ProductPulseManualProductFields
        }
      }

      fragment ProductPulseManualProductFields on Product {
        id
        title
        handle
        description
        descriptionHtml
        vendor
        productType
        status
        tags
        options {
          name
          values
        }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            selectedOptions {
              name
              value
            }
          }
        }
        collections(first: 20) {
          nodes {
            title
            handle
          }
        }
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
      }`,
      { id: productGid },
    );
    if (data?.product?.id) return data.product;
  }

  const fallbackQuery = productId === String(productId).trim() && !String(productId).includes(" ")
    ? `handle:${escapeShopifyQueryValue(productId)}`
    : String(productId || "").trim();
  const data = await shopifyGraphql(
    admin,
    `#graphql
    query ProductPulseManualProductSearch($query: String!) {
      products(first: 1, query: $query) {
        nodes {
          id
          title
          handle
          description
          descriptionHtml
          vendor
          productType
          status
          tags
          options {
            name
            values
          }
          variants(first: 100) {
            nodes {
              id
              title
              sku
              selectedOptions {
                name
                value
              }
            }
          }
          collections(first: 20) {
            nodes {
              title
              handle
            }
          }
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
      }
    }`,
    { query: fallbackQuery },
  );

  return data?.products?.nodes?.[0] || null;
}

function buildManualProductRiskSnapshotPayload(shop, product) {
  const variants = getConnectionNodes(product.variants);
  const collections = getConnectionNodes(product.collections);
  const tags = Array.isArray(product.tags) ? product.tags : [];
  const options = Array.isArray(product.options) ? product.options : [];
  const descriptionText = cleanProductDescription(product);
  const descriptionWordCount = descriptionText ? descriptionText.split(/\s+/).filter(Boolean).length : 0;
  const optionNames = options.map((option) => option.name).filter(Boolean);
  const skuCount = variants.filter((variant) => variant.sku).length;
  const collectionTitles = collections.map((collection) => collection.title).filter(Boolean);
  const now = new Date();
  const mediaNode = product.media?.nodes?.[0] || {};
  const image = product.featuredMedia?.preview?.image || mediaNode.image || mediaNode.preview?.image || {};

  return {
    shop,
    productGid: product.id,
    productTitle: product.title || product.handle || "Shopify product",
    handle: product.handle || String(product.id || "").split("/").pop(),
    riskScore: 0,
    impactScore: 0,
    confidence: 0,
    primaryIssue: "Manual diagnosis requested",
    sourceCoverage: ["Shopify products"],
    metrics: {
      manualDiagnosisRequested: true,
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
      reviewCount: 0,
      negativeReviewCount: 0,
      negativeReviewRate: 0,
      windowDays: 0,
      vendor: product.vendor || "",
      productType: product.productType || "",
      productStatus: product.status || "",
      tags,
      collections: collectionTitles,
      collectionHandles: collections.map((collection) => collection.handle).filter(Boolean),
      variantCount: variants.length,
      skuCount,
      optionNames,
      hasDescription: descriptionWordCount > 0,
      descriptionWordCount,
      createdFromShopifySearchAt: now.toISOString(),
      imageUrl: image.url || "",
      productImageUrl: image.url || "",
      imageAlt: image.altText || product.title || "",
      productImageAlt: image.altText || product.title || "",
    },
    calculatedAt: now,
  };
}

function getSearchProductPulseStatusMap(snapshots = [], diagnoses = []) {
  const statusByProductGid = new Map();
  snapshots.forEach((snapshot) => {
    const metrics = snapshot.metrics || {};
    const hasFullDiagnosis = Boolean(metrics.latestDiagnosisId || metrics.lastDetailedDiagnosisAt);
    statusByProductGid.set(snapshot.productGid, hasFullDiagnosis ? "full" : "quickscan");
  });
  diagnoses.forEach((diagnosis) => {
    if (diagnosis.productGid) statusByProductGid.set(diagnosis.productGid, "full");
  });
  return statusByProductGid;
}

function formatShopifyProductSearchResult(product, statusByProductGid = new Map()) {
  const mediaNode = product.media?.nodes?.[0] || {};
  const image = product.featuredMedia?.preview?.image || mediaNode.image || mediaNode.preview?.image || {};
  const collections = getConnectionNodes(product.collections);
  const variants = getConnectionNodes(product.variants);
  const vendorAndType = [product.vendor, product.productType].filter(Boolean).join(" / ");
  const firstCollection = collections[0]?.title;
  const productPulseStatus = statusByProductGid.get(product.id) || "catalog";

  return {
    id: product.id,
    title: product.title || product.handle || "Shopify product",
    handle: product.handle || "",
    status: product.status || "Unknown",
    vendor: product.vendor || "",
    productType: product.productType || "",
    sku: variants[0]?.sku || "",
    collection: firstCollection || "",
    detail: [vendorAndType, firstCollection].filter(Boolean).join(" - "),
    imageUrl: image.url || null,
    imageAlt: image.altText || null,
    variant: getProductArtVariant(product.handle),
    existingSnapshot: productPulseStatus !== "catalog",
    productPulseStatus,
    productPulseStatusLabel: getProductPulseSearchStatusLabel(productPulseStatus),
    productPulseStatusDetail: getProductPulseSearchStatusDetail(productPulseStatus),
    href: product.handle ? `/app/products/${product.handle}` : `/app/products/${encodeURIComponent(product.id)}`,
  };
}

function getProductPulseSearchStatusLabel(status) {
  if (status === "full") return "Product Diagnosis completed";
  if (status === "quickscan") return "Catalog Scan stored";
  return "Not in ProductPulse";
}

function getProductPulseSearchStatusDetail(status) {
  if (status === "full") return "This product already has a completed Product Diagnosis in ProductPulse.";
  if (status === "quickscan") return "This product is stored in ProductPulse with lightweight Catalog Scan signals only.";
  return "This Shopify product is not stored in ProductPulse yet. Run a diagnosis or add it to a workflow to start tracking it.";
}

function buildShopifyProductSearchQuery(query) {
  const trimmed = String(query || "").trim();
  if (/^gid:\/\/shopify\/Product\/\d+$/i.test(trimmed)) return `id:${trimmed.split("/").pop()}`;
  if (/^\d{5,}$/.test(trimmed)) return `id:${trimmed}`;
  return trimmed;
}

function normalizeShopifyProductGid(value) {
  const input = String(value || "").trim();
  if (/^gid:\/\/shopify\/Product\/\d+$/i.test(input)) return input;
  if (/^\d{5,}$/.test(input)) return `gid://shopify/Product/${input}`;
  return null;
}

function getConnectionNodes(connection) {
  if (Array.isArray(connection)) return connection.filter(Boolean);
  if (Array.isArray(connection?.nodes)) return connection.nodes.filter(Boolean);
  if (Array.isArray(connection?.edges)) return connection.edges.map((edge) => edge?.node).filter(Boolean);
  return [];
}

function withShopifyAdminUrl(product, shop) {
  if (!product) return product;
  return {
    ...product,
    shopifyAdminUrl: getShopifyProductAdminUrl(shop, product.id),
    shopifyStorefrontUrl: getShopifyProductStorefrontUrl(shop, product.handle || product.slug),
  };
}

function getShopifyProductAdminUrl(shop, productGid) {
  const numericId = String(productGid || "").split("/").pop();
  if (!shop || !numericId) return null;
  const storeHandle = String(shop || "").replace(/\.myshopify\.com$/i, "");
  return `https://admin.shopify.com/store/${encodeURIComponent(storeHandle)}/products/${encodeURIComponent(numericId)}`;
}

function getShopifyProductStorefrontUrl(shop, handle) {
  const productHandle = String(handle || "").trim();
  if (!shop || !productHandle) return null;
  return `https://${shop}/products/${encodeURIComponent(productHandle)}`;
}

function formatLiveShopifyProductForDiagnosis(product, watchedItem = null) {
  const mediaNode = product.media?.nodes?.[0] || {};
  const image = product.featuredMedia?.preview?.image || mediaNode.image || mediaNode.preview?.image || {};
  const variants = product.variants?.nodes || [];
  const collections = (product.collections?.nodes || []).map((collection) => collection.title).filter(Boolean);
  const tags = Array.isArray(product.tags) ? product.tags : [];
  const optionNames = (product.options || []).map((option) => option.name).filter(Boolean);
  const skuCount = variants.filter((variant) => variant.sku).length;
  const descriptionText = cleanProductDescription(product);
  const descriptionWordCount = descriptionText ? descriptionText.split(/\s+/).filter(Boolean).length : 0;

  return {
    id: product.id,
    slug: product.handle,
    title: product.title,
    handle: product.handle,
    htmlStyle: normalizeProductPulseHtmlStyle(),
    currentDescriptionHtml: product.descriptionHtml || "",
    currentDescriptionText: descriptionText,
    collection: collections[0] || product.productType || product.vendor || "Shopify catalog",
    status: product.status || "Unknown",
    riskScore: 0,
    impactScore: 0,
    confidence: 0,
    riskTone: "success",
    riskLabel: "Not scanned",
    creditCost: 1,
    sourceCoverage: ["Shopify products"],
    lastAnalysis: null,
    analysisDepth: "catalog",
    analysisLabel: "Not scanned",
    analysisDetail: "No Catalog Scan or Product Diagnosis has been stored yet.",
    analysisTone: "neutral",
    analysisIcon: "product",
    analysisCompletedAt: null,
    isWatched: Boolean(watchedItem),
    watchlistStatus: watchedItem?.status || null,
    latestDiagnosisId: null,
    primaryIssue: null,
    hasRiskSnapshot: false,
    canDiagnose: true,
    canResolve: false,
    imageUrl: image.url || null,
    imageAlt: image.altText || null,
    metrics: {
      returnRate: 0,
      refundRate: 0,
      reviewRating: 0,
      issueCount: 0,
      revenueAtRisk: 0,
      marginAtRisk: 0,
      signalCount: 0,
      refundAmount: 0,
      returnUnits: 0,
      refundUnits: 0,
      soldUnits: 0,
      recentSignalUnits: 0,
      windowDays: 0,
      productType: product.productType || "",
      vendor: product.vendor || "",
      tags,
      collections,
      variantCount: variants.length,
      skuCount,
      optionNames,
      hasDescription: descriptionWordCount > 0,
      descriptionWordCount,
    },
    evidence: [{
      source: "Shopify product",
      quote: `${product.status || "Unknown status"} product in Shopify`,
      weight: `${variants.length} variants, ${skuCount} SKUs, ${tags.length} tags`,
    }],
    issues: [],
    recommendedActions: [],
    actionHistory: [],
    resolvedAt: null,
  };
}

function formatSnapshotForDashboard(snapshot, actions = [], latestDiagnosis = null, settings = undefined) {
  const metrics = snapshot.metrics || {};
  const storedActions = filterDisabledProductActions(actions.map(formatStoredProductAction));
  const resolvedAction = getActiveResolvedStoredAction(storedActions);
  const analysisState = getProductAnalysisState(snapshot, latestDiagnosis);
  const riskScore = latestDiagnosis?.riskScore ?? snapshot.riskScore;
  const confidence = latestDiagnosis?.confidence ?? snapshot.confidence;
  const primaryIssue = latestDiagnosis?.likelyCause || snapshot.primaryIssue;
  const image = getSnapshotProductImage(snapshot);
  const diagnosisRecommendations = Array.isArray(latestDiagnosis?.recommendations)
    ? filterDisabledProductActions(latestDiagnosis.recommendations)
    : [];

  return {
    id: snapshot.productGid,
    productGid: snapshot.productGid,
    slug: snapshot.handle,
    title: snapshot.productTitle,
    handle: snapshot.handle,
    status: "Active",
    riskScore,
    impactScore: snapshot.impactScore,
    confidence,
    riskTone: getRiskTone(riskScore, settings),
    riskLabel: getRiskLabel(riskScore, settings),
    sourceCoverage: Array.isArray(snapshot.sourceCoverage) ? snapshot.sourceCoverage : ["Shopify products"],
    lastAnalysis: toIso(snapshot.updatedAt),
    analysisDepth: analysisState.depth,
    analysisLabel: analysisState.label,
    analysisDetail: analysisState.detail,
    analysisTone: analysisState.tone,
    analysisIcon: analysisState.icon,
    analysisCompletedAt: analysisState.completedAt,
    latestDiagnosisId: latestDiagnosis?.id || metrics.latestDiagnosisId || null,
    primaryIssue,
    imageUrl: image.imageUrl || null,
    imageAlt: image.imageAlt || snapshot.productTitle || "",
    metrics: {
      returnRate: Number(metrics.returnRate || 0),
      refundRate: Number(metrics.refundRate || 0),
      reviewCount: Number(metrics.reviewCount || 0),
      negativeReviewCount: Number(metrics.negativeReviewCount || 0),
      issueCount: Number(metrics.signalCount || metrics.signalsCount || metrics.issueCount || 0),
      revenueAtRisk: Number(metrics.revenueAtRisk || metrics.estimatedImpact || metrics.refundAmount || 0),
      marginAtRisk: Number(metrics.marginAtRisk || (metrics.revenueAtRisk ? metrics.revenueAtRisk * 0.45 : 0) || 0),
      estimatedImpact: Number(metrics.estimatedImpact || metrics.revenueAtRisk || metrics.refundAmount || 0),
      signalCount: Number(metrics.signalCount || metrics.signalsCount || metrics.issueCount || 0),
      productMomentumScore: metrics.productMomentumScore || null,
      productMomentumTier: metrics.productMomentumTier || "",
      momentumDirection: metrics.momentumDirection || "",
      momentumConfidence: metrics.momentumConfidence || null,
      momentumConfidenceLabel: metrics.momentumConfidenceLabel || "",
      returnUnits: Number(metrics.returnUnits || 0),
      refundUnits: Number(metrics.refundUnits || 0),
      recentSignalUnits: Number(metrics.recentSignalUnits || 0),
      windowDays: Number(metrics.windowDays || 60),
      soldUnits: Math.max(Number(metrics.soldUnits || 0), Number(metrics.returnUnits || 0), Number(metrics.refundUnits || 0)),
      storeAvgReturnRate: Number(metrics.storeAvgReturnRate || 0),
      storeAvgRefundRate: Number(metrics.storeAvgRefundRate || 0),
      latestDiagnosisId: latestDiagnosis?.id || metrics.latestDiagnosisId || null,
      lastDetailedDiagnosisAt: latestDiagnosis?.completedAt || metrics.lastDetailedDiagnosisAt || null,
    },
    recommendedActions: analysisState.depth === "full" ? diagnosisRecommendations : [],
    actionHistory: storedActions,
    resolvedAt: resolvedAction?.appliedAt || null,
  };
}

function formatSnapshotForDiagnosis(snapshot, actions = [], latestDiagnosis = null, settings = undefined, watchedItem = null, scoreHistory = []) {
  const metrics = snapshot.metrics || {};
  const diagnosisReport = metrics.diagnosisReport || {};
  const diagnosisIssues = Array.isArray(latestDiagnosis?.issues) ? latestDiagnosis.issues : null;
  const diagnosisEvidence = Array.isArray(latestDiagnosis?.evidence) ? latestDiagnosis.evidence : null;
  const diagnosisRecommendations = Array.isArray(latestDiagnosis?.recommendations)
    ? filterDisabledProductActions(latestDiagnosis.recommendations)
    : null;
  const storedActions = filterDisabledProductActions(actions.map(formatStoredProductAction));
  const returnRatePrediction = adjustReturnRatePredictionForActions(metrics.returnRatePrediction, diagnosisRecommendations, storedActions);
  const resolvedAction = getActiveResolvedStoredAction(storedActions);
  const analysisState = getProductAnalysisState(snapshot, latestDiagnosis);
  const hasFullDiagnosis = analysisState.depth === "full";
  const riskScore = latestDiagnosis?.riskScore ?? snapshot.riskScore;
  const confidence = latestDiagnosis?.confidence ?? snapshot.confidence;
  const primaryIssue = latestDiagnosis?.likelyCause || snapshot.primaryIssue;
  const monthlySummary = metrics.monthlyOrderActivity?.summary || {};
  const hasMonthlyOrderUnits = Number(monthlySummary.totalOrderUnits || 0) > 0;
  const normalizedSoldUnits = Math.max(
    Number(metrics.soldUnits || 0),
    Number(monthlySummary.totalOrderUnits || 0),
    Number(metrics.returnUnits || 0),
    Number(metrics.refundUnits || 0),
  );
  const normalizedReturnRate = hasMonthlyOrderUnits ? Number(monthlySummary.returnRate || 0) : Number(metrics.returnRate || 0);
  const normalizedRefundRate = hasMonthlyOrderUnits ? Number(monthlySummary.refundRate || 0) : Number(metrics.refundRate || 0);
  const variantCount = Number(metrics.variantCount || 0)
    || (Array.isArray(metrics.variants) ? metrics.variants.length : 0)
    || (Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants.length : 0);
  const skuCount = Number(metrics.skuCount || 0)
    || (Array.isArray(metrics.variants) ? metrics.variants.filter((variant) => variant?.sku).length : 0);

  return {
    id: snapshot.productGid,
    productGid: snapshot.productGid,
    slug: snapshot.handle,
    title: snapshot.productTitle,
    handle: snapshot.handle,
    htmlStyle: normalizeProductPulseHtmlStyle(settings?.htmlStyle),
    collection: metrics.collections?.[0] || metrics.productType || "Shopify catalog",
    status: "Active",
    riskScore,
    impactScore: snapshot.impactScore,
    confidence,
    riskTone: getRiskTone(riskScore, settings),
    riskLabel: getRiskLabel(riskScore, settings),
    creditCost: 1,
    sourceCoverage: Array.isArray(snapshot.sourceCoverage) ? snapshot.sourceCoverage : ["Shopify products"],
    lastAnalysis: toIso(snapshot.updatedAt),
    analysisDepth: analysisState.depth,
    analysisLabel: analysisState.label,
    analysisDetail: analysisState.detail,
    analysisTone: analysisState.tone,
    analysisIcon: analysisState.icon,
    analysisCompletedAt: analysisState.completedAt,
    isWatched: Boolean(watchedItem),
    watchlistStatus: watchedItem?.status || null,
    latestDiagnosisId: latestDiagnosis?.id || metrics.latestDiagnosisId || null,
    primaryIssue,
    mainFinding: diagnosisReport.mainFinding || null,
    postActionStatus: diagnosisReport.postActionStatus || metrics.postActionStatus || metrics.productEvolution?.postActionStatus || null,
    hasRiskSnapshot: true,
    canDiagnose: true,
    canResolve: true,
    metrics: {
      returnRate: normalizedReturnRate,
      refundRate: normalizedRefundRate,
      reviewRating: metrics.reviewRating || metrics.avgRating || 0,
      avgRating: metrics.avgRating || metrics.reviewRating || 0,
      reviewCount: metrics.reviewCount || 0,
      negativeReviewCount: metrics.negativeReviewCount || 0,
      negativeReviewRate: metrics.negativeReviewRate || 0,
      recentNegativeReviewCount: metrics.recentNegativeReviewCount || 0,
      issueCount: metrics.signalCount || 0,
      revenueAtRisk: metrics.revenueAtRisk || metrics.estimatedImpact || metrics.refundAmount || 0,
      marginAtRisk: metrics.marginAtRisk || (metrics.revenueAtRisk ? metrics.revenueAtRisk * 0.45 : 0),
      estimatedImpact: metrics.estimatedImpact || metrics.revenueAtRisk || metrics.refundAmount || 0,
      signalCount: metrics.signalCount || 0,
      salesAmount: metrics.salesAmount || 0,
      avgUnitRevenue: metrics.avgUnitRevenue || 0,
      refundAmount: metrics.refundAmount || 0,
      monthlyOrderActivity: metrics.monthlyOrderActivity || null,
      returnRatePrediction,
      productMomentum: metrics.productMomentum || null,
      returnRefundRelationshipSummary: metrics.returnRefundRelationshipSummary || null,
      returnRefundRelationshipFactors: metrics.returnRefundRelationshipFactors || null,
      returnRefundScoringImpact: Array.isArray(metrics.returnRefundScoringImpact) ? metrics.returnRefundScoringImpact : [],
      financialExposureBreakdown: metrics.financialExposureBreakdown || null,
      returnPressure: metrics.returnPressure || null,
      refundLeakage: metrics.refundLeakage || null,
      customerSignalBreakdown: metrics.customerSignalBreakdown || null,
      productPurchaseContextSummary: metrics.productPurchaseContextSummary || null,
      productPurchaseContextFactors: metrics.productPurchaseContextFactors || null,
      productPurchaseContextScoringImpact: Array.isArray(metrics.productPurchaseContextScoringImpact)
        ? metrics.productPurchaseContextScoringImpact
        : [],
      purchaseContextSignalBreakdown: metrics.purchaseContextSignalBreakdown || null,
      productRelationshipIntelligenceSummary: metrics.productRelationshipIntelligenceSummary || null,
      productRelationshipFactors: metrics.productRelationshipFactors || null,
      productRelationshipScoringImpact: Array.isArray(metrics.productRelationshipScoringImpact)
        ? metrics.productRelationshipScoringImpact
        : [],
      productRelationshipAiInsights: metrics.productRelationshipAiInsights || null,
      productRetention: metrics.productRetention || null,
      productRetentionSummary: metrics.productRetentionSummary || metrics.productRetention?.summary || null,
      productMomentumScore: metrics.productMomentumScore || metrics.productMomentum?.score || null,
      productMomentumTier: metrics.productMomentumTier || metrics.productMomentum?.tier || "",
      momentumDirection: metrics.momentumDirection || metrics.productMomentum?.direction || "",
      momentumConfidence: metrics.momentumConfidence || metrics.productMomentum?.confidence || null,
      momentumConfidenceLabel: metrics.momentumConfidenceLabel || metrics.productMomentum?.confidenceLabel || "",
      returnUnits: metrics.returnUnits || 0,
      refundUnits: metrics.refundUnits || 0,
      recentSignalUnits: metrics.recentSignalUnits || 0,
      windowDays: metrics.windowDays || 60,
      soldUnits: normalizedSoldUnits,
      storeAvgReturnRate: metrics.storeAvgReturnRate || 0,
      storeAvgRefundRate: metrics.storeAvgRefundRate || 0,
      lastSignalAt: metrics.lastSignalAt || null,
      signalTrend: Array.isArray(metrics.signalTrend) ? metrics.signalTrend : [],
      riskTrend: Array.isArray(metrics.riskTrend) ? metrics.riskTrend : [],
      riskHistory: formatProductRiskHistory(scoreHistory),
      productType: metrics.productType || "",
      vendor: metrics.vendor || "",
      tags: Array.isArray(metrics.tags) ? metrics.tags : [],
      collections: Array.isArray(metrics.collections) ? metrics.collections : [],
      topReturnReasons: Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : [],
      topReturnReasonDetails: Array.isArray(metrics.topReturnReasonDetails) ? metrics.topReturnReasonDetails : [],
      topRefundReasons: Array.isArray(metrics.topRefundReasons) ? metrics.topRefundReasons : [],
      topRefundReasonDetails: Array.isArray(metrics.topRefundReasonDetails) ? metrics.topRefundReasonDetails : [],
      affectedVariants: Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants : [],
      affectedVariantDetails: Array.isArray(metrics.affectedVariantDetails) ? metrics.affectedVariantDetails : [],
      variantInsights: Array.isArray(metrics.variantInsights) ? metrics.variantInsights : [],
      variantCount,
      skuCount,
      optionNames: Array.isArray(metrics.optionNames) ? metrics.optionNames : [],
      variants: Array.isArray(metrics.variants) ? metrics.variants : [],
      media: Array.isArray(metrics.media) ? metrics.media : [],
      textInsights: metrics.textInsights || null,
      refundInsights: metrics.refundInsights || null,
      reviewSourceStats: metrics.reviewSourceStats || null,
      judgeMeReviewCount: metrics.judgeMeReviewCount || 0,
      judgeMeNegativeReviewCount: metrics.judgeMeNegativeReviewCount || 0,
      judgeMeAverageRating: metrics.judgeMeAverageRating || 0,
      csvReviewCount: metrics.csvReviewCount || 0,
      csvNegativeReviewCount: metrics.csvNegativeReviewCount || 0,
      csvAverageRating: metrics.csvAverageRating || 0,
      faqNeed: metrics.faqNeed || null,
      seoTitle: metrics.seoTitle || "",
      seoDescription: metrics.seoDescription || "",
      templateSuffix: metrics.templateSuffix || "",
      checkedSources: Array.isArray(diagnosisReport.checkedSources) ? diagnosisReport.checkedSources : [],
      aiModels: diagnosisReport.aiModels || null,
      chartInterpretations: metrics.chartInterpretations || diagnosisReport.chartInterpretations || null,
      orderAccessDenied: Boolean(metrics.orderAccessDenied),
      descriptionLength: metrics.descriptionLength || 0,
      descriptionWordCount: metrics.descriptionWordCount || 0,
      hasDescription: Boolean(metrics.hasDescription || Number(metrics.descriptionWordCount || 0) > 0),
      contentQualityScore: metrics.contentQualityScore || 0,
      contentQualityRisk: metrics.contentQualityRisk || 0,
      contentIssueCount: metrics.contentIssueCount || 0,
      contentIssues: Array.isArray(metrics.contentIssues) ? metrics.contentIssues : [],
      contentAdvisoryCount: metrics.contentAdvisoryCount || 0,
      contentAdvisories: Array.isArray(metrics.contentAdvisories) ? metrics.contentAdvisories : [],
      mediaCount: metrics.mediaCount || 0,
      mediaWithoutAltCount: metrics.mediaWithoutAltCount || 0,
      titleNeedsReview: Boolean(metrics.titleNeedsReview),
      variantNamingAdvisory: Boolean(metrics.variantNamingAdvisory),
    },
    evidence: diagnosisEvidence || getSnapshotEvidence(snapshot, metrics),
    issues: diagnosisIssues || getSnapshotIssues(snapshot, metrics, settings),
    recommendedActions: hasFullDiagnosis ? (diagnosisRecommendations || filterDisabledProductActions(getSnapshotRecommendedActions(snapshot, metrics))) : [],
    actionHistory: storedActions,
    resolvedAt: resolvedAction?.appliedAt || null,
  };
}

function formatSnapshotForAnalytics(snapshot, actions = [], latestDiagnosis = null, settings = undefined, scoreHistory = []) {
  const metrics = snapshot.metrics || {};
  const storedActions = filterDisabledProductActions(actions.map(formatStoredProductAction));
  const resolvedAction = getActiveResolvedStoredAction(storedActions);
  const analysisState = getProductAnalysisState(snapshot, latestDiagnosis);
  const hasFullDiagnosis = analysisState.depth === "full";
  const riskScore = latestDiagnosis?.riskScore ?? snapshot.riskScore;
  const confidence = latestDiagnosis?.confidence ?? snapshot.confidence;
  const primaryIssue = latestDiagnosis?.likelyCause || snapshot.primaryIssue;
  const monthlySummary = metrics.monthlyOrderActivity?.summary || {};
  const hasMonthlyOrderUnits = Number(monthlySummary.totalOrderUnits || 0) > 0;
  const normalizedSoldUnits = Math.max(
    Number(metrics.soldUnits || 0),
    Number(monthlySummary.totalOrderUnits || 0),
    Number(metrics.returnUnits || 0),
    Number(metrics.refundUnits || 0),
  );
  const normalizedReturnRate = hasMonthlyOrderUnits ? Number(monthlySummary.returnRate || 0) : Number(metrics.returnRate || 0);
  const normalizedRefundRate = hasMonthlyOrderUnits ? Number(monthlySummary.refundRate || 0) : Number(metrics.refundRate || 0);

  return {
    id: snapshot.productGid,
    productGid: snapshot.productGid,
    slug: snapshot.handle,
    title: snapshot.productTitle,
    handle: snapshot.handle,
    collection: metrics.collections?.[0] || metrics.productType || "Shopify catalog",
    vendor: metrics.vendor || "",
    productType: metrics.productType || "",
    tags: Array.isArray(metrics.tags) ? metrics.tags : [],
    status: "Active",
    riskScore,
    impactScore: snapshot.impactScore,
    confidence,
    riskTone: getRiskTone(riskScore, settings),
    riskLabel: getRiskLabel(riskScore, settings),
    sourceCoverage: Array.isArray(snapshot.sourceCoverage) ? snapshot.sourceCoverage : ["Shopify products"],
    lastAnalysis: toIso(snapshot.updatedAt),
    analysisDepth: analysisState.depth,
    analysisLabel: analysisState.label,
    analysisCompletedAt: analysisState.completedAt,
    latestDiagnosisId: latestDiagnosis?.id || metrics.latestDiagnosisId || null,
    primaryIssue,
    hasRiskSnapshot: true,
    metrics: {
      returnRate: normalizedReturnRate,
      refundRate: normalizedRefundRate,
      reviewRating: metrics.reviewRating || metrics.avgRating || 0,
      avgRating: metrics.avgRating || metrics.reviewRating || metrics.csvAverageRating || 0,
      reviewCount: metrics.reviewCount || 0,
      negativeReviewCount: metrics.negativeReviewCount || 0,
      negativeReviewRate: metrics.negativeReviewRate || 0,
      recentNegativeReviewCount: metrics.recentNegativeReviewCount || 0,
      issueCount: metrics.signalCount || metrics.signalsCount || metrics.issueCount || 0,
      revenueAtRisk: metrics.revenueAtRisk || metrics.estimatedImpact || metrics.refundAmount || 0,
      marginAtRisk: metrics.marginAtRisk || (metrics.revenueAtRisk ? metrics.revenueAtRisk * 0.45 : 0),
      estimatedImpact: metrics.estimatedImpact || metrics.revenueAtRisk || metrics.refundAmount || 0,
      signalCount: metrics.signalCount || metrics.signalsCount || metrics.issueCount || 0,
      salesAmount: metrics.salesAmount || 0,
      avgUnitRevenue: metrics.avgUnitRevenue || 0,
      refundAmount: metrics.refundAmount || 0,
      monthlyOrderActivity: metrics.monthlyOrderActivity || null,
      impactFactors: metrics.impactFactors || null,
      estimatedImpactFactors: metrics.estimatedImpactFactors || null,
      marginRate: metrics.marginRate || null,
      returnUnits: metrics.returnUnits || 0,
      refundUnits: metrics.refundUnits || 0,
      recentSignalUnits: metrics.recentSignalUnits || 0,
      windowDays: metrics.windowDays || 60,
      soldUnits: normalizedSoldUnits,
      soldOrders: metrics.soldOrders || 0,
      storeAvgReturnRate: metrics.storeAvgReturnRate || 0,
      storeAvgRefundRate: metrics.storeAvgRefundRate || 0,
      lastSignalAt: metrics.lastSignalAt || null,
      signalTrend: Array.isArray(metrics.signalTrend) ? metrics.signalTrend : [],
      riskTrend: Array.isArray(metrics.riskTrend) ? metrics.riskTrend : [],
      riskHistory: formatProductRiskHistory(scoreHistory),
      productType: metrics.productType || "",
      vendor: metrics.vendor || "",
      tags: Array.isArray(metrics.tags) ? metrics.tags : [],
      collections: Array.isArray(metrics.collections) ? metrics.collections : [],
      topReturnReasons: Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : [],
      affectedVariants: Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants : [],
      textInsights: metrics.textInsights || null,
      judgeMeReviewCount: metrics.judgeMeReviewCount || 0,
      judgeMeNegativeReviewCount: metrics.judgeMeNegativeReviewCount || 0,
      judgeMeAverageRating: metrics.judgeMeAverageRating || 0,
      csvReviewCount: metrics.csvReviewCount || 0,
      csvReviewRatingCount: metrics.csvReviewRatingCount || 0,
      csvNegativeReviewCount: metrics.csvNegativeReviewCount || 0,
      csvAverageRating: metrics.csvAverageRating || 0,
      yotpoReviewCount: metrics.yotpoReviewCount || 0,
      looxReviewCount: metrics.looxReviewCount || 0,
      customerTextSignals: metrics.customerTextSignals || 0,
      latestDiagnosisId: latestDiagnosis?.id || metrics.latestDiagnosisId || null,
      lastDetailedDiagnosisAt: latestDiagnosis?.completedAt || metrics.lastDetailedDiagnosisAt || null,
      orderAccessDenied: Boolean(metrics.orderAccessDenied),
      descriptionWords: metrics.descriptionWords || metrics.descriptionWordCount || 0,
      descriptionWordCount: metrics.descriptionWordCount || metrics.descriptionWords || 0,
      contentIssueCount: metrics.contentIssueCount || 0,
      confidence,
      mainIssue: primaryIssue,
    },
    recommendedActions: hasFullDiagnosis ? filterDisabledProductActions(getSnapshotRecommendedActions(snapshot, metrics)) : [],
    actionHistory: storedActions,
    resolvedAt: resolvedAction?.appliedAt || null,
  };
}

function formatProductRiskHistory(scoreHistory = []) {
  return (Array.isArray(scoreHistory) ? scoreHistory : [])
    .map((row) => {
      const riskScore = Number(row.riskScore);
      if (!Number.isFinite(riskScore)) return null;
      const metrics = row.metrics || {};
      return {
        id: row.id || null,
        riskScore: Math.round(riskScore),
        confidence: toNullableNumber(row.confidence),
        impactScore: toNullableNumber(row.impactScore),
        source: row.source || "unknown",
        recordedAt: toIso(row.recordedAt),
        primaryIssue: row.primaryIssue || "",
        returnRate: toNullableNumber(metrics.returnRate),
        refundRate: toNullableNumber(metrics.refundRate),
        negativeReviewRate: toNullableNumber(metrics.negativeReviewRate),
        marginAtRisk: toNullableNumber(metrics.marginAtRisk),
        revenueAtRisk: toNullableNumber(metrics.revenueAtRisk),
        financialExposure: toNullableNumber(metrics.financialExposure),
        salesAmount: toNullableNumber(metrics.salesAmount),
        refundAmount: toNullableNumber(metrics.refundAmount),
        soldUnits: toNullableNumber(metrics.soldUnits),
        returnUnits: toNullableNumber(metrics.returnUnits),
        refundUnits: toNullableNumber(metrics.refundUnits),
        reviewCount: toNullableNumber(metrics.reviewCount),
        negativeReviewCount: toNullableNumber(metrics.negativeReviewCount),
        avgRating: toNullableNumber(metrics.avgRating || metrics.reviewRating || metrics.csvAverageRating),
        customerSignalCount: toNullableNumber(metrics.customerSignalCount),
        evidenceStrengthScore: toNullableNumber(metrics.evidenceStrengthScore),
        retentionHealthScore: toNullableNumber(metrics.retentionHealthScore),
        productMomentumScore: toNullableNumber(metrics.productMomentumScore),
        returnPressureScore: toNullableNumber(metrics.returnPressureScore ?? metrics.returnRefundRelationship?.returnPressureScore),
        refundLeakageScore: toNullableNumber(metrics.refundLeakageScore ?? metrics.returnRefundRelationship?.refundLeakageScore),
        mainIssueIntensity: toNullableNumber(metrics.mainIssueIntensity ?? metrics.priorityScore),
        signalCount: toNullableNumber(metrics.signalsCount || metrics.signalCount || metrics.issueCount),
        sourceCount: getHistorySourceCount(metrics.sourceCoverage),
      };
    })
    .filter(Boolean);
}

function getHistorySourceCount(sourceCoverage) {
  if (Array.isArray(sourceCoverage)) return sourceCoverage.length;
  if (sourceCoverage && typeof sourceCoverage === "object") return Object.keys(sourceCoverage).length;
  return null;
}

function toNullableNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getActiveResolvedStoredAction(storedActions = []) {
  const resolutionActions = storedActions
    .filter((action) => ["mark-resolved", "mark-unresolved"].includes(action.actionId) && action.status === "applied")
    .sort((first, second) => {
      const firstTime = new Date(first.appliedAt || first.createdAt || 0).getTime();
      const secondTime = new Date(second.appliedAt || second.createdAt || 0).getTime();
      return secondTime - firstTime;
    });
  const latest = resolutionActions[0];
  return latest?.actionId === "mark-resolved" ? latest : null;
}

function formatStoredProductAction(action) {
  const payload = action.payload || {};
  return {
    id: action.id,
    diagnosisId: action.diagnosisId || payload.sourceDiagnosisId || payload.diagnosisId || null,
    actionId: action.actionType,
    label: action.label,
    status: action.status,
    payload,
    actionAliases: Array.isArray(payload.actionAliases) ? payload.actionAliases : [],
    createdAt: toIso(action.createdAt),
    appliedAt: toIso(action.appliedAt),
  };
}

function adjustReturnRatePredictionForActions(prediction = null, recommendations = [], storedActions = []) {
  if (!prediction || !Array.isArray(prediction.forecastPoints) || !prediction.forecastPoints.length) return prediction || null;
  const actionDescriptors = buildReturnPredictionActionDescriptors(recommendations);
  if (!actionDescriptors.length) return prediction;

  const latestActionStatus = new Map();
  (Array.isArray(storedActions) ? storedActions : []).forEach((action) => {
    const matchedKeys = getReturnPredictionMatchedActionKeys(action, actionDescriptors);
    if (!matchedKeys.length) return;
    const currentTime = new Date(action.appliedAt || action.createdAt || 0).getTime();
    matchedKeys.forEach((actionKey) => {
      const existing = latestActionStatus.get(actionKey);
      if (!existing || currentTime >= existing.time) {
        latestActionStatus.set(actionKey, { status: String(action.status || "").toLowerCase(), time: currentTime });
      }
    });
  });

  const counts = actionDescriptors.reduce((totals, descriptor) => {
    const status = latestActionStatus.get(descriptor.key)?.status || "pending";
    if (status.includes("applied")) totals.applied += 1;
    else if (status.includes("review")) totals.reviewed += 1;
    else if (status.includes("dismiss")) totals.dismissed += 1;
    else totals.pending += 1;
    return totals;
  }, { pending: 0, applied: 0, reviewed: 0, dismissed: 0 });
  const mitigationPoints = clampNumber(counts.applied * 3.25 + counts.reviewed * 2.15, 0, 15);
  const adjustmentPoints = -mitigationPoints;
  const uncertaintyMultiplier = roundTo(1 + clampNumber(mitigationPoints / 50, 0, 0.3), 2);
  const baseForecastNext90ReturnRate = roundTo(averageNumbers(prediction.forecastPoints.map((point) => Number(point.basePredictedReturnRate ?? point.predictedReturnRate ?? 0))), 2);
  const forecastPoints = prediction.forecastPoints.map((point, index) => {
    const horizonWeight = getReturnPredictionActionHorizonWeight(index, prediction.forecastPoints.length);
    const basePredictedReturnRate = Number(point.basePredictedReturnRate ?? point.predictedReturnRate ?? 0);
    return {
      ...point,
      basePredictedReturnRate,
      actionAdjustedReturnRateShift: roundTo(adjustmentPoints * horizonWeight, 2),
      predictedReturnRate: roundTo(clampNumber(basePredictedReturnRate + adjustmentPoints * horizonWeight, 0, 100), 2),
    };
  });
  const forecastNext90ReturnRate = roundTo(averageNumbers(forecastPoints.map((point) => point.predictedReturnRate)), 2);

  return {
    ...prediction,
    forecastPoints,
    summary: {
      ...(prediction.summary || {}),
      forecastNext90ReturnRate,
    },
    actionAdjustment: {
      ...counts,
      total: actionDescriptors.length,
      handled: counts.applied + counts.reviewed + counts.dismissed,
      beneficialHandled: counts.applied + counts.reviewed,
      adjustmentPoints: roundTo(adjustmentPoints, 2),
      uncertaintyMultiplier,
      baseForecastNext90ReturnRate,
      forecastNext90ReturnRate,
      direction: adjustmentPoints < 0 ? "improving" : adjustmentPoints > 0 ? "worsening" : "neutral",
    },
  };
}

function getReturnPredictionActionHorizonWeight(index = 0, total = 1) {
  const horizonRatio = clampNumber((Number(index || 0) + 1) / Math.max(Number(total || 1), 1), 0, 1);
  return clampNumber(0.34 + 0.66 * Math.pow(horizonRatio, 0.78), 0, 1);
}

function buildReturnPredictionActionDescriptors(recommendations = []) {
  return (Array.isArray(recommendations) ? recommendations : [])
    .map((action, index) => {
      const key = String(action?.id || action?.actionId || action?.label || `action-${index}`).trim();
      if (!key) return null;
      return {
        key,
        aliases: getReturnPredictionActionAliases(action, key),
      };
    })
    .filter(Boolean);
}

function getReturnPredictionActionAliases(action = {}, key = "") {
  const aliases = new Set([key, action.id, action.actionId, action.label, action.title]
    .map((value) => String(value || "").trim())
    .filter(Boolean));
  const normalized = `${action.id || ""} ${action.actionId || ""} ${action.label || ""} ${action.title || ""} ${action.type || ""} ${JSON.stringify(action.payload || {})}`.toLowerCase();
  if (/\b(description|pdp|copy|faq|fit note|expectation note|content)\b/.test(normalized)) aliases.add("product-description-changes");
  return aliases;
}

function getReturnPredictionMatchedActionKeys(action = {}, descriptors = []) {
  const rawActionId = String(action.actionId || "").trim();
  const rawLabel = String(action.label || "").trim();
  if (!rawActionId && !rawLabel) return [];
  const actionNeedles = new Set([rawActionId, rawLabel].filter(Boolean));
  return descriptors
    .filter((descriptor) => [...actionNeedles].some((needle) => descriptor.aliases.has(needle)))
    .map((descriptor) => descriptor.key);
}

function averageNumbers(values = []) {
  const numbers = values.map(Number).filter((value) => Number.isFinite(value));
  if (!numbers.length) return 0;
  return numbers.reduce((total, value) => total + value, 0) / numbers.length;
}

function roundTo(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round(Number(value || 0) * factor) / factor;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

function escapeShopifyQueryValue(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getSnapshotEvidence(snapshot, metrics) {
  const topReturnReasons = Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : [];
  const affectedVariants = Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants : [];
  const windowDays = metrics.windowDays || 60;
  const evidence = [{
    source: "Shopify product",
    quote: `${metrics.productType || "Product"}${metrics.vendor ? ` by ${metrics.vendor}` : ""}`,
    weight: `${metrics.descriptionWordCount || 0} description words, ${Array.isArray(metrics.collections) ? metrics.collections.length : 0} collections, ${Array.isArray(metrics.tags) ? metrics.tags.length : 0} tags`,
  }];

  if (Number(metrics.returnUnits || 0) > 0 || topReturnReasons.length) {
    evidence.push({
      source: "Returns",
      quote: topReturnReasons.length ? topReturnReasons.join(", ") : "0 repeated return reasons captured",
      weight: `${metrics.returnUnits || 0} return units in ${windowDays} days`,
    });
  }

  if (Number(metrics.refundUnits || 0) > 0 || Number(metrics.refundAmount || 0) > 0) {
    evidence.push({
      source: "Refunds",
      quote: `${formatMoney(metrics.refundAmount || 0)} refunded`,
      weight: `${metrics.refundUnits || 0} refunded units`,
    });
  }

  if (affectedVariants.length || Number(metrics.recentSignalUnits || 0) > 0) {
    evidence.push({
      source: "Variants",
      quote: affectedVariants.length ? affectedVariants.join(", ") : "No variant concentration detected",
      weight: `${metrics.recentSignalUnits || 0} recent signal units`,
    });
  }

  return evidence;
}

function getSnapshotIssues(snapshot, metrics, settings = undefined) {
  const rawSignalCount = Number(metrics.signalCount || 0);
  if (!snapshot.primaryIssue || rawSignalCount <= 0) return [];

  const signalCount = Math.max(rawSignalCount, 1);
  const topReturnReasons = Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : [];
  const affectedVariants = Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants : [];

  return [
    {
      issue: snapshot.primaryIssue,
      severity: getRiskLabel(snapshot.riskScore, settings),
      confidence: snapshot.confidence,
      signals: signalCount,
      evidence: topReturnReasons,
      trend: Array.isArray(metrics.signalTrend) ? metrics.signalTrend : [],
    },
    {
      issue: affectedVariants.length ? `Affected scope: ${affectedVariants.join(", ")}` : "Signal concentration needs review",
      severity: getRiskLabel(snapshot.riskScore, settings),
      confidence: Math.max(snapshot.confidence - 9, 35),
      signals: Math.max(Math.round(signalCount * 0.62), 1),
      evidence: affectedVariants,
      trend: Array.isArray(metrics.signalTrend) ? metrics.signalTrend : [],
    },
  ];
}

function getSnapshotRecommendedActions(snapshot, metrics) {
  const issueCategory = getSnapshotIssueCategory(snapshot.primaryIssue);
  const topReturnReasons = Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : [];
  const affectedVariants = Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants : [];
  const reasonText = topReturnReasons.length ? topReturnReasons.join(", ") : snapshot.primaryIssue;
  const variantText = affectedVariants.length ? affectedVariants.join(", ") : "affected variants";
  const actions = [];

  if (Number(metrics.signalCount || 0) > 0 && snapshot.primaryIssue) {
    actions.push({
      id: "draft-pdp-copy",
      label: getPdpCopyActionLabel(issueCategory),
      type: "PDP copy",
      effort: "Low",
      status: "Draft",
      payload: {
        draftText: `ProductPulse detected ${reasonText}. Add shopper-facing guidance that clarifies ${issueCategory.toLowerCase()} expectations for ${snapshot.productTitle}.`,
      },
    });
  }

  if (topReturnReasons.length || Number(metrics.returnUnits || 0) > 0) {
    actions.push({
      id: "review-return-reasons",
      label: "Review return reasons",
      type: "Workflow",
      effort: "Low",
      status: "Ready",
      payload: { topReturnReasons, returnUnits: metrics.returnUnits || 0 },
    });
  }

  if (affectedVariants.length) {
    actions.push({
      id: "review-affected-variants",
      label: "Review affected variants",
      type: "Workflow",
      effort: "Low",
      status: "Ready",
      payload: { affectedVariants },
    });
  }

  if (metrics.refundPressure?.highPressure || Number(metrics.refundUnits || 0) >= 3) {
    actions.push({
      id: "review-refund-impact",
      label: "Review refund impact",
      type: "Workflow",
      effort: "Low",
      status: "Ready",
      payload: {
        refundAmount: metrics.refundAmount,
        refundUnits: metrics.refundUnits || 0,
        refundRate: metrics.refundRate || 0,
        refundPressure: metrics.refundPressure || null,
      },
    });
  }

  if (Number(metrics.signalCount || 0) > 0 && snapshot.primaryIssue) {
    actions.push({
      id: "copy-support-note",
      label: "Share internal note with support team",
      type: "Internal note",
      effort: "Low",
      status: "Ready",
      payload: {
        note: `${snapshot.productTitle}: ${snapshot.primaryIssue}. Mention ${reasonText}; watch ${variantText}.`,
      },
    });
  }

  return actions;
}

function getResolvedAction(snapshot) {
  return {
    id: "mark-resolved",
    label: "Mark product as resolved",
    type: "Workflow",
    effort: "Low",
    status: "Ready",
    applyImmediately: true,
    payload: { productGid: snapshot.productGid, handle: snapshot.handle, resolvedAt: new Date().toISOString() },
  };
}

function getUnresolvedAction(snapshot) {
  return {
    id: "mark-unresolved",
    label: "Mark product as unresolved",
    type: "Workflow",
    effort: "Low",
    status: "Ready",
    applyImmediately: true,
    payload: { productGid: snapshot.productGid, handle: snapshot.handle, unresolvedAt: new Date().toISOString() },
  };
}

function getIgnoredIssueAction(snapshot, payloadOverride = {}) {
  const issue = String(payloadOverride.issue || "Product issue").trim() || "Product issue";
  const issueCode = String(payloadOverride.issueCode || "").trim();
  const issueKey = String(payloadOverride.issueKey || normalizeIgnoredIssueKey(issueCode || issue)).trim();
  return {
    id: "ignore-issue",
    label: `Ignore issue: ${issue}`,
    type: "Workflow",
    effort: "Low",
    status: "Ignored",
    applyImmediately: true,
    payload: {
      productGid: snapshot.productGid,
      issue,
      issueCode,
      issueKey,
      suggestedAction: String(payloadOverride.suggestedAction || "").trim(),
      ignoredAt: new Date().toISOString(),
    },
  };
}

function getUnignoredIssueAction(snapshot, payloadOverride = {}) {
  const issue = String(payloadOverride.issue || "Product issue").trim() || "Product issue";
  const issueCode = String(payloadOverride.issueCode || "").trim();
  const issueKey = String(payloadOverride.issueKey || normalizeIgnoredIssueKey(issueCode || issue)).trim();
  return {
    id: "unignore-issue",
    label: `Restore issue: ${issue}`,
    type: "Workflow",
    effort: "Low",
    status: "Ready",
    applyImmediately: true,
    payload: {
      productGid: snapshot.productGid,
      issue,
      issueCode,
      issueKey,
      suggestedAction: String(payloadOverride.suggestedAction || "").trim(),
      restoredAt: new Date().toISOString(),
    },
  };
}

function normalizeIgnoredIssueKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function getSnapshotIssueCategory(issue) {
  const normalized = String(issue || "").toLowerCase();
  if (normalized.includes("fit") || normalized.includes("sizing") || normalized.includes("waist") || normalized.includes("small")) return "Fit & sizing";
  if (normalized.includes("zipper") || normalized.includes("defect") || normalized.includes("break")) return "Durability";
  if (normalized.includes("fear") || normalized.includes("scare") || normalized.includes("unsafe") || normalized.includes("danger") || normalized.includes("miedo") || normalized.includes("asusta")) return "Fear or safety concern";
  if (normalized.includes("compat")) return "Compatibility";
  return "Product quality";
}

function getPdpCopyActionLabel(issueCategory) {
  if (issueCategory === "Fit & sizing") return "Draft fit note for product description";
  if (issueCategory === "Durability") return "Draft durability expectation note";
  if (issueCategory === "Compatibility") return "Draft compatibility FAQ";
  return "Draft product quality note";
}

function formatJob(job) {
  const productTitle = getJobProductTitle(job);
  const productHandle = getJobProductHandle(job);
  const productImageUrl = getJobProductImageUrl(job);
  const productImageAlt = getJobProductImageAlt(job, productTitle);
  const displayTitle = getJobDisplayTitle(job, productTitle);
  const displaySubtitle = getJobDisplaySubtitle(job, productTitle);
  const executionStartedAt = job.status === "Queued" ? null : job.startedAt;
  const pointsConsumed = getJobPointCost(job);

  return {
    id: job.id,
    kind: job.kind,
    name: getJobDisplayName(job.kind),
    productTitle,
    productHandle,
    productHref: productHandle ? `/app/products/${productHandle}` : null,
    imageUrl: productImageUrl,
    imageAlt: productImageAlt,
    displayTitle,
    displaySubtitle,
    source: job.errorMessage || job.source,
    errorMessage: job.errorMessage || null,
    status: job.status,
    progress: job.progress,
    updatedAt: formatJobDate(job.updatedAt),
    updatedAtIso: toIso(job.updatedAt),
    startedAt: job.startedAt,
    startedAtIso: toIso(job.startedAt),
    executionStartedAt,
    executionStartedAtIso: toIso(executionStartedAt),
    finishedAt: job.finishedAt,
    finishedAtIso: toIso(job.finishedAt),
    leaseExpiresAt: job.leaseExpiresAt || null,
    leaseExpiresAtIso: toIso(job.leaseExpiresAt),
    lastHeartbeatAt: job.lastHeartbeatAt || null,
    lastHeartbeatAtIso: toIso(job.lastHeartbeatAt),
    attempts: job.attempts || 0,
    priority: job.priority || 100,
    elapsedMs: job.status === "Queued" ? 0 : getElapsedMs(job.startedAt, job.finishedAt),
    pointsConsumed,
    creditsConsumed: pointsConsumed,
    creditCost: pointsConsumed,
    batchMode: job.payload?.batchMode || null,
    openAiBatch: job.payload?.openAiBatch || null,
  };
}

function getJobPointCost(job) {
  const payload = job.payload || {};
  const explicit = payload.pointsConsumed ?? payload.creditsConsumed ?? payload.pointCost ?? payload.creditCost;
  const explicitNumber = Number(explicit);
  if (Number.isFinite(explicitNumber) && explicitNumber >= 0) return explicitNumber;
  if (job.kind === FAST_PRODUCT_SCAN_KIND) return 0;
  if (job.kind === PRODUCT_DIAGNOSIS_KIND) return 1;
  return 0;
}

function getJobDisplayName(kind) {
  if (kind === FAST_PRODUCT_SCAN_KIND) return "Catalog Scan";
  if (kind === PRODUCT_DIAGNOSIS_KIND) return "Product Diagnosis";
  if (kind === SHOPIFY_MOCK_DATASET_KIND) return "Shopify mock dataset";
  return kind;
}

function getJobProductTitle(job) {
  return typeof job.payload?.productTitle === "string" && job.payload.productTitle.trim()
    ? job.payload.productTitle.trim()
    : null;
}

function getJobProductHandle(job) {
  return typeof job.payload?.handle === "string" && job.payload.handle.trim()
    ? job.payload.handle.trim()
    : null;
}

function getJobProductImageUrl(job) {
  const payload = job.payload || {};
  const candidates = [
    payload.imageUrl,
    payload.productImageUrl,
    payload.featuredImageUrl,
    typeof payload.image === "string" ? payload.image : payload.image?.url,
    payload.featuredImage?.url,
  ];
  return candidates.map(normalizeJobPayloadString).find(Boolean) || null;
}

function getJobProductImageAlt(job, productTitle) {
  const payload = job.payload || {};
  const candidates = [
    payload.imageAlt,
    payload.productImageAlt,
    payload.featuredImageAlt,
    payload.image?.altText,
    payload.featuredImage?.altText,
    productTitle,
  ];
  return candidates.map(normalizeJobPayloadString).find(Boolean) || null;
}

function normalizeJobPayloadString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getJobDisplayTitle(job, productTitle) {
  if (job.kind === PRODUCT_DIAGNOSIS_KIND && productTitle) return productTitle;
  if (job.kind === SHOPIFY_MOCK_DATASET_KIND) return "Shopify mock dataset";
  return getJobDisplayName(job.kind);
}

function getJobDisplaySubtitle(job, productTitle) {
  if (job.kind === SHOPIFY_MOCK_DATASET_KIND) {
    if (job.status === "Queued") return "Queued controlled Shopify test data";
    if (job.status === "Running") return "Creating GEN products, orders, returns, refunds and CSV reviews";
    if (job.status === "Completed") return "Controlled Shopify mock dataset created";
    if (job.status === "Failed") return "Shopify mock dataset generation failed";
    return "Controlled Shopify test data";
  }
  if (job.kind !== PRODUCT_DIAGNOSIS_KIND || !productTitle) return job.errorMessage || job.source;
  if (job.payload?.batchMode?.freeCreditMode && job.status === "Queued") return "Queued in Batch mode";
  if (job.status === "Queued") return "Queued Product Diagnosis";
  if (job.status === "Running" && job.payload?.openAiBatch?.status === "waiting") return "Waiting on OpenAI Batch API";
  if (job.status === "Running" && job.payload?.batchMode?.freeCreditMode) return "Running in Batch mode";
  if (job.status === "Running") return "Running Product Diagnosis";
  if (job.status === "Completed") return "Product Diagnosis completed";
  if (job.status === "Failed") return "Product Diagnosis failed";
  return "Product Diagnosis";
}

function formatJobLog(log) {
  return {
    id: log.id,
    jobId: log.jobId,
    level: log.level,
    event: log.event,
    message: log.message,
    data: log.data,
    createdAt: formatJobDate(log.createdAt),
    createdAtIso: toIso(log.createdAt),
  };
}

function formatBackgroundProcess(job, logs = []) {
  const formatted = formatJob(job);
  return {
    ...formatted,
    rawSource: job.source || "",
    payloadItems: formatBackgroundProcessPayloadItems(job.payload),
    logCount: logs.length,
    logs,
    latestLog: logs[0] || null,
    statusKey: normalizeBackgroundProcessKey(job.status),
    kindKey: normalizeBackgroundProcessKey(job.kind),
  };
}

function ensureWorkersForJobs(shop, jobs = []) {
  jobs.filter((job) => isActiveStatus(job.status)).forEach((job) => {
    if (job.kind === FAST_PRODUCT_SCAN_KIND) ensureFastProductScanWorker(job);
    if (job.kind === SHOPIFY_MOCK_DATASET_KIND) ensureShopifyMockDatasetWorker(job);
  });
  if (jobs.some((job) => job.kind === PRODUCT_DIAGNOSIS_KIND && isActiveStatus(job.status))) {
    ensureProductDiagnosisQueueWorker(shop);
  }
}

function groupJobLogsByJobId(logs = []) {
  return logs.reduce((byJob, log) => {
    if (!byJob.has(log.jobId)) byJob.set(log.jobId, []);
    byJob.get(log.jobId).push(log);
    return byJob;
  }, new Map());
}

function buildBackgroundProcessStats(jobs = [], logs = [], overrides = {}) {
  const statusCounts = overrides.statusCounts || jobs.reduce((counts, job) => {
    const status = job.status || "Unknown";
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const kindCounts = overrides.kindCounts || jobs.reduce((counts, job) => {
    const kind = getJobDisplayName(job.kind);
    counts[kind] = (counts[kind] || 0) + 1;
    return counts;
  }, {});
  const total = Number(overrides.total ?? jobs.length) || 0;

  return {
    total,
    active: (statusCounts.Running || 0) + (statusCounts.Queued || 0),
    running: statusCounts.Running || 0,
    queued: statusCounts.Queued || 0,
    completed: statusCounts.Completed || 0,
    failed: statusCounts.Failed || 0,
    logs: logs.length,
    statusCounts,
    kindCounts,
    latestUpdatedAtIso: toIso(jobs[0]?.updatedAt),
  };
}

function normalizeBackgroundProcessPage(value) {
  const parsed = Number.parseInt(String(value || "1"), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function clampBackgroundProcessPage(page, total) {
  const totalPages = Math.max(1, Math.ceil((Number(total) || 0) / BACKGROUND_PROCESS_PAGE_SIZE));
  return Math.min(Math.max(1, page), totalPages);
}

function buildBackgroundProcessPagination(page, total) {
  const normalizedTotal = Math.max(0, Number(total) || 0);
  const totalPages = Math.max(1, Math.ceil(normalizedTotal / BACKGROUND_PROCESS_PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const from = normalizedTotal ? (safePage - 1) * BACKGROUND_PROCESS_PAGE_SIZE + 1 : 0;
  const to = normalizedTotal ? Math.min(normalizedTotal, safePage * BACKGROUND_PROCESS_PAGE_SIZE) : 0;

  return {
    page: safePage,
    pageSize: BACKGROUND_PROCESS_PAGE_SIZE,
    total: normalizedTotal,
    totalPages,
    from,
    to,
    hasPrevious: safePage > 1,
    hasNext: safePage < totalPages,
  };
}

function mapBackgroundProcessStatusCounts(groups = []) {
  return groups.reduce((counts, group) => {
    const status = group.status || "Unknown";
    counts[status] = getBackgroundProcessGroupCount(group);
    return counts;
  }, {});
}

function mapBackgroundProcessKindCounts(groups = []) {
  return groups.reduce((counts, group) => {
    const kind = getJobDisplayName(group.kind);
    counts[kind] = (counts[kind] || 0) + getBackgroundProcessGroupCount(group);
    return counts;
  }, {});
}

function getBackgroundProcessGroupCount(group) {
  return Number(group?._count?._all ?? group?._count ?? 0) || 0;
}

function formatBackgroundProcessPayloadItems(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const items = [];
  const seen = new Set();
  const hiddenKeys = new Set([
    "creditCost",
    "creditsConsumed",
    "pointCost",
    "pointDebitStatus",
    "pointLedgerEntryId",
    "pointRefundLedgerEntryId",
    "pointsConsumed",
  ]);
  [
    ["productTitle", "Product"],
    ["handle", "Handle"],
    ["productId", "Requested product"],
    ["productGid", "Product GID"],
    ["riskScore", "Queued risk score"],
    ["stageLabel", "Dataset stage"],
    ["stage", "Stage key"],
    ["expectedProducts", "Expected products"],
    ["expectedCustomers", "Expected customers"],
    ["expectedOrders", "Expected orders"],
    ["summary.productCount", "Products"],
    ["summary.customerCount", "Customers"],
    ["summary.orderCount", "Orders"],
    ["summary.returnCount", "Returns"],
    ["summary.refundCount", "Refunds"],
    ["summary.reviewCount", "Reviews"],
    ["summary.csvReviewFilePath", "CSV review file"],
    ["summary.manifestPath", "Manifest"],
    ["manifestPath", "Manifest"],
    ["queuedAt", "Queued at"],
    ["generatedAt", "Generated at"],
    ["summary.generatedAt", "Generated at"],
  ].forEach(([path, label]) => {
    addBackgroundPayloadItem(items, seen, payload, path, label);
  });

  Object.entries(payload).forEach(([key, value]) => {
    if (items.length >= 16 || seen.has(key) || hiddenKeys.has(key) || ["summary", "products", "customers"].includes(key)) return;
    if (!isBackgroundPayloadPrimitive(value)) return;
    addBackgroundPayloadValue(items, seen, key, formatPayloadLabel(key), value);
  });

  return items;
}

function addBackgroundPayloadItem(items, seen, payload, path, label) {
  const value = getPayloadPathValue(payload, path);
  if (value === undefined || value === null || value === "") return;
  addBackgroundPayloadValue(items, seen, path, label, value);
}

function addBackgroundPayloadValue(items, seen, key, label, value) {
  const displayValue = formatBackgroundPayloadValue(value);
  if (!displayValue || seen.has(key) || seen.has(`${label}:${displayValue}`)) return;
  seen.add(key);
  seen.add(`${label}:${displayValue}`);
  items.push({ label, value: displayValue });
}

function getPayloadPathValue(payload, path) {
  return String(path).split(".").reduce((current, key) => current?.[key], payload);
}

function isBackgroundPayloadPrimitive(value) {
  return value === null || ["string", "number", "boolean"].includes(typeof value)
    || (Array.isArray(value) && value.every((item) => ["string", "number", "boolean"].includes(typeof item)));
}

function formatBackgroundPayloadValue(value) {
  if (Array.isArray(value)) {
    const visible = value.slice(0, 4).map((item) => String(item));
    const suffix = value.length > visible.length ? ` +${value.length - visible.length} more` : "";
    return `${visible.join(", ")}${suffix}`;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function formatPayloadLabel(key) {
  return String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function normalizeBackgroundProcessKey(value) {
  return String(value || "unknown").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "unknown";
}

function formatJobDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return seconds <= 5 ? "Just now" : `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date);
}

function toIso(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function getElapsedMs(startedAt, finishedAt) {
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return 0;
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  return Math.max(0, end - start);
}

function getRiskLabel(score, settings = undefined) {
  return getRiskLabelForScore(score, settings);
}

function getRiskTone(score, settings = undefined) {
  return getRiskToneForScore(score, settings);
}

function getProductArtVariant(handle) {
  if (handle?.includes("vest") || handle?.includes("hoodie")) return "hoodie";
  if (handle?.includes("pour") || handle?.includes("bottle")) return "bottle";
  if (handle?.includes("tote")) return "tote";
  return "shirt";
}

function getSourceToken(source) {
  const normalized = String(source || "").toLowerCase();
  if (normalized.includes("product") || normalized.includes("catalog")) {
    return {
      key: "products",
      label: "Products",
      shortLabel: "PDP",
      detail: "Shopify product, variant, tag and collection data.",
    };
  }
  if (normalized.includes("order") || normalized.includes("sale")) {
    return {
      key: "orders",
      label: "Orders",
      shortLabel: "ORD",
      detail: "Shopify order line items and sold units.",
    };
  }
  if (normalized.includes("refund")) {
    return {
      key: "refunds",
      label: "Refunds",
      shortLabel: "REF",
      detail: "Shopify refunded units and refund amount.",
    };
  }
  if (normalized.includes("return")) {
    return {
      key: "returns",
      label: "Returns",
      shortLabel: "RET",
      detail: "Shopify return units, return notes and return reasons.",
    };
  }
  if (normalized.includes("review") || normalized.includes("judge") || normalized.includes("csv")) {
    return {
      key: "reviews",
      label: "Reviews",
      shortLabel: "REV",
      detail: "Customer review ratings, text and complaint themes.",
    };
  }
  if (normalized.includes("support") || normalized.includes("chat")) {
    return {
      key: "support",
      label: "Support",
      shortLabel: "SUP",
      detail: "Support conversations, buyer questions and agent notes.",
    };
  }
  return {
    key: "source",
    label: source || "Source",
    shortLabel: "SRC",
    detail: source || "Additional connected signal source.",
  };
}

function getEvidenceFamilyBars(metrics = {}) {
  const normalizedMetrics = metrics || {};
  return [
    {
      key: "product_content",
      label: "Product / PDP content",
      value: getProductContentEvidenceValue(normalizedMetrics),
      signalUnits: getProductContentEvidenceUnits(normalizedMetrics),
      detail: getProductContentEvidenceDetail(normalizedMetrics),
      icon: "product",
    },
    {
      key: "reviews",
      label: "Reviews",
      value: getReviewSignalValue(normalizedMetrics),
      signalUnits: getReviewEvidenceUnits(normalizedMetrics),
      detail: getReviewSignalDetail(normalizedMetrics),
      icon: "star",
    },
    {
      key: "customer_language",
      label: "Customer language",
      value: getCustomerLanguageSignalValue(normalizedMetrics),
      signalUnits: getCustomerLanguageEvidenceUnits(normalizedMetrics),
      detail: getCustomerLanguageSignalDetail(normalizedMetrics),
      icon: "note",
    },
    {
      key: "returns",
      label: "Returns",
      value: getReturnSignalValue(normalizedMetrics),
      signalUnits: getReturnEvidenceUnits(normalizedMetrics),
      detail: getReturnSignalDetail(normalizedMetrics),
      icon: "return",
    },
    {
      key: "refunds_financial",
      label: "Refunds / financial",
      value: getRefundSignalValue(normalizedMetrics),
      signalUnits: getRefundEvidenceUnits(normalizedMetrics),
      detail: getRefundSignalDetail(normalizedMetrics),
      icon: "cash-dollar",
    },
  ].map((bar) => ({
    ...bar,
    value: clampSignalBar(bar.value),
  }));
}

const getSignalLifecycleBars = getEvidenceFamilyBars;

function getEvidenceStrengthLabel({ signalCount, sourceCount, conflicting = false }) {
  if (conflicting) return "Conflicting";
  if (signalCount >= 10 && sourceCount >= 3) return "Strong";
  if (signalCount >= 5 || sourceCount >= 2) return "Moderate";
  if (signalCount >= 1) return sourceCount <= 1 ? "Sparse" : "Weak";
  return "Sparse";
}

function getEvidenceToneForProduct(riskScore, metrics = {}, settings = undefined) {
  if (Number(metrics.signalCount || 0) <= 0) return "gray";
  const label = getRiskLabel(riskScore, settings);
  if (label === "High") return "red";
  if (label === "Medium") return "orange";
  return "green";
}

function getProductContentEvidenceValue(metrics) {
  return Math.max(getProductSetupSignalValue(metrics), getPdpContentSignalValue(metrics));
}

function getProductContentEvidenceUnits(metrics) {
  const contentIssues = Number(metrics.contentIssueCount || 0);
  const contentIssueLabels = getContentIssueLabels(metrics).length;
  const descriptionMissing = Object.prototype.hasOwnProperty.call(metrics, "hasDescription") && !metrics.hasDescription ? 1 : 0;
  const shortDescription = Number(metrics.descriptionWordCount || 0) > 0 && Number(metrics.descriptionWordCount || 0) < 25 ? 1 : 0;
  return contentIssues || contentIssueLabels || descriptionMissing + shortDescription;
}

function getProductContentEvidenceDetail(metrics) {
  const setupDetail = getProductSetupSignalDetail(metrics);
  const pdpDetail = getPdpContentSignalDetail(metrics);
  const units = getProductContentEvidenceUnits(metrics);
  if (units > 0) return pdpDetail;
  return setupDetail === "No catalog setup gaps detected." ? "No relevant product-content gaps detected." : setupDetail;
}

function getReviewEvidenceUnits(metrics) {
  return Number(metrics.negativeReviewCount || metrics.csvLowRatingCount || metrics.csvNegativeReviewCount || 0);
}

function getCustomerLanguageEvidenceUnits(metrics) {
  const sentiment = metrics.textInsights?.sentiment || {};
  return Number(metrics.customerTextSignals || 0)
    || Number(sentiment.negative || 0)
    + getRepeatedLanguageUnits(metrics)
    + Number(metrics.textInsights?.subjectiveNegativity?.count || 0)
    + getList(metrics.textInsights?.aiEmergentSentiments).reduce((sum, item) => sum + Math.max(1, Number(item.signals || item.count || 1)), 0);
}

function getCustomerLanguageSignalValue(metrics) {
  const sentiment = metrics.textInsights?.sentiment || {};
  const total = Number(sentiment.total || metrics.customerTextSignals || 0);
  const negative = Number(sentiment.negative || 0);
  const repeatedLanguageUnits = getRepeatedLanguageUnits(metrics);
  const subjective = Number(metrics.textInsights?.subjectiveNegativity?.count || 0);
  const emergent = getList(metrics.textInsights?.aiEmergentSentiments).reduce((sum, item) => sum + Math.max(1, Number(item.signals || item.count || 1)), 0);
  if (!total && !repeatedLanguageUnits && !subjective && !emergent) return 4;
  const negativeRate = total ? (negative / total) * 100 : 0;
  return negativeRate * 0.45 + repeatedLanguageUnits * 8 + subjective * 7 + emergent * 7;
}

function getCustomerLanguageSignalDetail(metrics) {
  const sentiment = metrics.textInsights?.sentiment || {};
  const repeatedLanguage = getRepeatedLanguageLabels(metrics);
  const subjective = metrics.textInsights?.subjectiveNegativity || {};
  const emergent = getList(metrics.textInsights?.aiEmergentSentiments).map((item) => item.label || item.normalizedLabel || item.value).filter(Boolean);
  const pieces = [];
  if (Number(sentiment.total || 0) > 0) pieces.push(`${sentiment.total} customer text signal${Number(sentiment.total) === 1 ? "" : "s"}, ${Number(sentiment.negative || 0)} negative`);
  if (repeatedLanguage.length) pieces.push(`Repeated language: ${repeatedLanguage.slice(0, 3).join(", ")}`);
  if (Number(subjective.count || 0) > 0) pieces.push(`${subjective.count} subjective negative reaction${Number(subjective.count) === 1 ? "" : "s"}`);
  if (emergent.length) pieces.push(`Detected emotions: ${emergent.slice(0, 3).join(", ")}`);
  return pieces.length
    ? `${pieces.join(". ")}.`
    : "No repeated customer language or sentiment evidence has been captured yet.";
}

function getReturnEvidenceUnits(metrics) {
  return Number(metrics.returnUnits || 0) + getReasonSignalUnits(metrics.topReturnReasonDetails || metrics.topReturnReasons);
}

function getRefundEvidenceUnits(metrics) {
  return Number(metrics.refundUnits || 0) + getReasonSignalUnits(metrics.topRefundReasonDetails || metrics.topRefundReasons);
}

function getProductSetupSignalValue(metrics) {
  const checks = getProductSetupChecks(metrics);
  const knownChecks = checks.filter((check) => check.known);
  const missingChecks = knownChecks.filter((check) => !check.present);
  const completenessRisk = knownChecks.length
    ? (missingChecks.length / knownChecks.length) * 46
    : 0;
  const inactiveStatusRisk = hasText(metrics.productStatus) && String(metrics.productStatus).toLowerCase() !== "active" ? 18 : 0;
  return 4 + completenessRisk + inactiveStatusRisk;
}

function getProductSetupSignalDetail(metrics) {
  const checks = getProductSetupChecks(metrics).filter((check) => check.known);
  if (!checks.length) return "Catalog setup has not been captured for this product yet.";

  const present = checks.filter((check) => check.present);
  const missing = checks.filter((check) => !check.present);
  const missingText = missing.length
    ? ` Missing: ${missing.map((check) => check.label).join(", ")}.`
    : " No catalog setup gaps detected.";
  return `${present.length}/${checks.length} catalog checks present: ${present.map((check) => check.label).join(", ") || "none"}.${missingText}`;
}

function getProductSetupChecks(metrics) {
  const variantCount = Number(metrics.variantCount);
  const skuCount = Number(metrics.skuCount);
  return [
    {
      label: "type",
      known: Object.prototype.hasOwnProperty.call(metrics, "productType"),
      present: hasText(metrics.productType),
    },
    {
      label: "vendor",
      known: Object.prototype.hasOwnProperty.call(metrics, "vendor"),
      present: hasText(metrics.vendor),
    },
    {
      label: "tags",
      known: Object.prototype.hasOwnProperty.call(metrics, "tags"),
      present: getList(metrics.tags).length > 0,
    },
    {
      label: "collections",
      known: Object.prototype.hasOwnProperty.call(metrics, "collections"),
      present: getList(metrics.collections).length > 0,
    },
    {
      label: "variants",
      known: Number.isFinite(variantCount),
      present: variantCount > 0,
    },
    {
      label: "SKUs",
      known: Number.isFinite(skuCount),
      present: skuCount > 0,
    },
    {
      label: "options",
      known: Object.prototype.hasOwnProperty.call(metrics, "optionNames"),
      present: getList(metrics.optionNames).length > 0,
    },
  ];
}

function getPdpContentSignalValue(metrics) {
  const contentIssueCount = Number(metrics.contentIssueCount || 0);
  const contentQualityRisk = Number(metrics.contentQualityRisk || 0);
  const contentQualityScore = Number(metrics.contentQualityScore);
  const descriptionWordCount = Number(metrics.descriptionWordCount);
  const hasDescriptionKnown = Object.prototype.hasOwnProperty.call(metrics, "hasDescription");
  let value = contentQualityRisk * 3.1 + contentIssueCount * 12;

  if (Number.isFinite(contentQualityScore)) value += Math.max(0, 84 - contentQualityScore) * 0.65;
  if (hasDescriptionKnown && !metrics.hasDescription) value += 58;
  if (Number.isFinite(descriptionWordCount) && descriptionWordCount > 0 && descriptionWordCount < 25) value += 22;

  return value || 4;
}

function getPdpContentSignalDetail(metrics) {
  const contentIssueCount = Number(metrics.contentIssueCount || 0);
  const contentQualityRisk = Number(metrics.contentQualityRisk || 0);
  const contentQualityScore = Number(metrics.contentQualityScore);
  const descriptionWordCount = Number(metrics.descriptionWordCount);
  const contentIssues = getContentIssueLabels(metrics);
  const pieces = [];

  if (Number.isFinite(descriptionWordCount)) pieces.push(`${descriptionWordCount} description words`);
  if (Number.isFinite(contentQualityScore)) pieces.push(`content quality ${contentQualityScore}/100`);
  if (contentIssueCount) pieces.push(`${contentIssueCount} content issue${contentIssueCount === 1 ? "" : "s"}`);
  if (contentQualityRisk) pieces.push(`PDP content risk ${Math.round(contentQualityRisk)}/100`);
  if (contentIssues.length) pieces.push(`Issues: ${contentIssues.slice(0, 3).join(", ")}`);

  return pieces.length
    ? `${pieces.join(". ")}.`
    : "PDP copy and description quality require a Product Diagnosis before this bar has detail.";
}

function getReviewSignalValue(metrics) {
  const reviewCount = getReviewCount(metrics);
  if (!reviewCount) return 4;

  const negativeReviewCount = Number(metrics.negativeReviewCount || metrics.csvLowRatingCount || 0);
  const negativeReviewRate = Number(metrics.negativeReviewRate || metrics.csvNegativeRatingRate || 0);
  const averageRating = Number(metrics.avgRating || metrics.reviewRating || metrics.csvAverageRating || 0);
  const ratingPressure = averageRating > 0 ? Math.max(0, 4 - averageRating) * 14 : 0;
  const samplePressure = Math.min(18, Math.log2(reviewCount + 1) * 4);
  const criticalPressure = Number(metrics.csvCriticalRatingCount || 0) * 5;
  const csvRatingRisk = Number(metrics.csvRatingRisk || metrics.riskComponents?.csvRatingRisk || 0);

  return negativeReviewRate * 0.7
    + ratingPressure
    + samplePressure
    + criticalPressure
    + csvRatingRisk * 0.55
    + negativeReviewCount * 2;
}

function getReviewSignalDetail(metrics) {
  const reviewCount = getReviewCount(metrics);
  if (!reviewCount) return "No connected review rating signal has been matched to this product yet.";

  const negativeReviewCount = Number(metrics.negativeReviewCount || metrics.csvLowRatingCount || 0);
  const negativeReviewRate = Number(metrics.negativeReviewRate || metrics.csvNegativeRatingRate || 0);
  const averageRating = Number(metrics.avgRating || metrics.reviewRating || metrics.csvAverageRating || 0);
  const sourceBreakdown = getReviewSourceBreakdown(metrics);
  const sourceText = sourceBreakdown.length ? ` Sources: ${sourceBreakdown.join(", ")}.` : "";

  return `${reviewCount} review rating${reviewCount === 1 ? "" : "s"}, ${negativeReviewCount} negative or low-rated (${formatPercent(negativeReviewRate)}), average rating ${averageRating ? averageRating.toFixed(1) : "n/a"}.${sourceText}`;
}

function getRefundSignalValue(metrics) {
  const refundRate = Number(metrics.refundRate || 0);
  const refundUnits = Number(metrics.refundUnits || 0);
  const refundAmount = Number(metrics.refundAmount || 0);
  const refundRisk = Number(metrics.riskComponents?.refundRisk || 0);
  const refundPressureRisk = Number(metrics.riskComponents?.refundPressureRisk || 0);
  const impactRisk = Number(metrics.riskComponents?.impactRisk || 0);
  const refundOperationalRisk = Number(metrics.refundInsights?.riskLift || 0);
  const refundReasonUnits = getReasonSignalUnits(metrics.topRefundReasonDetails || metrics.topRefundReasons);

  return Math.max(refundRisk, refundPressureRisk)
    + impactRisk * 0.75
    + refundOperationalRisk * 5
    + refundRate * 1.9
    + refundUnits * 4.5
    + Math.log10(refundAmount + 1) * 9
    + refundReasonUnits * 4;
}

function getRefundSignalDetail(metrics) {
  const refundRate = Number(metrics.refundRate || 0);
  const refundUnits = Number(metrics.refundUnits || 0);
  const refundAmount = Number(metrics.refundAmount || 0);
  const refundReasons = getReasonLabels(metrics.topRefundReasonDetails || metrics.topRefundReasons, "refund");
  const notes = getList(metrics.refundNotes);
  const pieces = [
    `${refundUnits} refunded unit${refundUnits === 1 ? "" : "s"}`,
    `${formatPercent(refundRate)} refund rate`,
    `${formatMoney(refundAmount)} refunded`,
  ];

  if (refundReasons.length) pieces.push(`Reasons: ${refundReasons.slice(0, 3).join(", ")}`);
  if (notes.length) pieces.push(`Notes captured: ${notes.length}`);

  return `${pieces.join(". ")}.`;
}

function getReturnSignalValue(metrics) {
  const returnRate = Number(metrics.returnRate || 0);
  const returnUnits = Number(metrics.returnUnits || 0);
  const returnRisk = Number(metrics.riskComponents?.returnRisk || 0);
  const repeatedReasonRisk = Number(metrics.riskComponents?.repeatedReasonRisk || 0);
  const returnReasonUnits = getReasonSignalUnits(metrics.topReturnReasonDetails || metrics.topReturnReasons);

  return returnRisk
    + repeatedReasonRisk * 0.45
    + returnRate * 2.15
    + returnUnits * 5
    + returnReasonUnits * 4;
}

function getReturnSignalDetail(metrics) {
  const returnRate = Number(metrics.returnRate || 0);
  const returnUnits = Number(metrics.returnUnits || 0);
  const reasons = getReasonLabels(metrics.topReturnReasonDetails || metrics.topReturnReasons, "return");
  const pieces = [
    `${returnUnits} return unit${returnUnits === 1 ? "" : "s"}`,
    `${formatPercent(returnRate)} return rate`,
  ];

  if (reasons.length) pieces.push(`Reasons: ${reasons.slice(0, 4).join(", ")}`);
  return `${pieces.join(". ")}.`;
}

function getReviewCount(metrics) {
  return Number(metrics.reviewCount || 0)
    || Number(metrics.csvReviewRatingCount || 0)
    || Number(metrics.csvReviewCount || 0)
    || Number(metrics.judgeMeReviewCount || 0);
}

function getReviewSourceBreakdown(metrics) {
  const sources = [];
  const judgeMeCount = Number(metrics.judgeMeReviewCount || metrics.reviewSourceStats?.judgeMe?.reviewCount || 0);
  const csvCount = Number(metrics.csvReviewRatingCount || metrics.csvReviewCount || metrics.reviewSourceStats?.csv?.reviewCount || 0);
  if (judgeMeCount) sources.push(`Judge.me ${judgeMeCount}`);
  if (csvCount) sources.push(`CSV ${csvCount}`);
  return sources;
}

function getContentIssueLabels(metrics) {
  return getList(metrics.contentIssues).map((issue) => {
    if (typeof issue === "string") return issue;
    return issue.label || issue.title || issue.code || issue.issueCode || "";
  }).filter(Boolean);
}

function getReasonSignalUnits(value) {
  const list = getList(value);
  if (!list.length) return 0;
  return list.reduce((sum, item) => {
    if (typeof item === "string") return sum + 1;
    return sum + Math.max(1, Number(item.count || item.quantity || item.units || 1));
  }, 0);
}

function getReasonLabels(value, fallbackType) {
  return getList(value).map((item) => {
    if (typeof item === "string") return item;
    const label = item.label || item.reason || item.name || item.value || fallbackType;
    const count = Number(item.count || item.quantity || item.units || 0);
    return count > 1 ? `${label} (${count})` : label;
  }).filter(Boolean);
}

function getRepeatedLanguageUnits(metrics) {
  return getList(metrics.textInsights?.repeatedLanguage).reduce((sum, item) => {
    if (typeof item === "string") return sum + 1;
    return sum + Math.max(1, Number(item.count || 1));
  }, 0);
}

function getRepeatedLanguageLabels(metrics) {
  return getList(metrics.textInsights?.repeatedLanguage).map((item) => {
    if (typeof item === "string") return item;
    const label = item.term || item.label || item.phrase || item.value || "";
    const count = Number(item.count || 0);
    return label ? `${label}${count > 1 ? ` (${count})` : ""}` : "";
  }).filter(Boolean);
}

function getList(value) {
  return Array.isArray(value) ? value : [];
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function formatPercent(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return "0%";
  return `${Math.round(number * 10) / 10}%`;
}

function clampSignalBar(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 4;
  return Math.round(Math.min(100, Math.max(4, number)));
}

export const __productPulseJobsTestHooks = {
  adjustReturnRatePredictionForActions,
  buildManualProductRiskSnapshotPayload,
  buildProductPulseFaqHtml,
  buildUpdatedProductDescriptionHtml,
  buildUpdatedProductDescriptionHtmlFromChanges,
  formatSnapshotForDiagnosis,
  formatProductRow,
  formatBackgroundProcess,
  buildBackgroundProcessStats,
  filterProductSnapshots,
  getAppliedProductReviewToastMetadata,
  getProductTableFilterOptions,
  getShopifyProductAdminUrl,
  getShopifyProductStorefrontUrl,
  getSignalLifecycleBars,
  getProductMetafieldsForApply,
  mergeFaqItemsIntoExistingDescriptionHtml,
  normalizeFaqItemsForApply,
  setProductFaqMetafield,
  setProductMetafields,
  getFaqApplyVariant,
};

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0));
}
