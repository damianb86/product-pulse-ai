import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  getQuickScanWindowDays,
  runShopifyQuickScan,
} from "./product-pulse-quick-scan.server";
import { buildAnalyticsViewData, buildDashboardViewData } from "./product-pulse-data";
import { runDetailedProductDiagnosis } from "./product-pulse-diagnosis.server";
import {
  getJobLogsForShop,
  recordJobLog,
  serializeError,
} from "./product-pulse-job-logs.server";
import { getProductRetentionPayloadForDiagnosis } from "./product-pulse-retention.server";
import {
  PRODUCT_PULSE_SETTINGS_SOURCE_KEY,
  getProductPulseSettings,
  getRiskFilterValueForScore,
  getRiskLabelForScore,
  getRiskToneForScore,
  getStatusFilterValueForScore,
  getStatusLabelForScore,
} from "./product-pulse-settings.server";
import {
  PRODUCT_PULSE_HTML_TEMPLATE_PLACEHOLDERS,
  getProductPulseHtmlStylePreset,
  getProductPulseHtmlStyleTemplate,
  normalizeProductPulseHtmlStyle,
} from "./product-pulse-html-style-presets";
import {
  getProductScoreHistoryForProductsForShop,
  getProductScoreHistoryForShop,
} from "./product-pulse-history.server";
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

const FAST_PRODUCT_SCAN_KIND = "fast-product-scan";
const PRODUCT_DIAGNOSIS_KIND = "product-diagnosis";
const PRODUCT_DIAGNOSIS_QUEUE_WORKER_KEY = "global-product-diagnosis-queue";
const STALE_JOB_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const JOB_MONITOR_RECENT_JOB_LIMIT = 50;
const BACKGROUND_PROCESS_LOG_LIMIT = 1000;
const BACKGROUND_PROCESS_PAGE_SIZE = 10;
const BACKGROUND_PROCESS_ACTIVE_LIMIT = 10;
const activeWorkers = global.productPulseJobWorkers || new Set();
const activeDiagnosisQueueWorkers = global.productPulseDiagnosisQueueWorkers || new Set();
const activeMockDatasetWorkers = global.productPulseMockDatasetWorkers || new Set();

if (!global.productPulseJobWorkers) {
  global.productPulseJobWorkers = activeWorkers;
}

if (!global.productPulseDiagnosisQueueWorkers) {
  global.productPulseDiagnosisQueueWorkers = activeDiagnosisQueueWorkers;
}

if (!global.productPulseMockDatasetWorkers) {
  global.productPulseMockDatasetWorkers = activeMockDatasetWorkers;
}

export async function startFastProductScan(input, adminArg, scopesArg) {
  const { shop, admin, scopes } = normalizeStartArgs(input, adminArg, scopesArg);
  await failStaleFastProductScans(shop);

  const activeJob = await getActiveFastProductScan(shop);
  if (activeJob) {
    ensureFastProductScanWorker(activeJob, { admin, scopes });
    await recordJobLog({
      shop,
      jobId: activeJob.id,
      event: "quick_scan.already_running",
      message: "Fast product scan request reused the active background job.",
      data: { status: activeJob.status, source: activeJob.source },
    });
    return {
      status: "success",
      suppressBanner: true,
      message: "Fast product scan is already running.",
      job: formatJob(activeJob),
    };
  }

  const settings = await getProductPulseSettings(shop);
  const windowDays = getQuickScanWindowDays(settings, scopes);
  const job = await prisma.catalogSignalJob.create({
    data: {
      shop,
      kind: FAST_PRODUCT_SCAN_KIND,
      source: `Queued Shopify QuickScan - ${windowDays}-day order window`,
      status: "Queued",
      progress: 0,
    },
  });

  ensureFastProductScanWorker(job, { admin, scopes });
  await recordJobLog({
    shop,
    jobId: job.id,
    event: "quick_scan.queued",
    message: "QuickScan queued as a persistent background job.",
    data: {
      windowDays,
      scopeMode: "configured_analysis_lookback",
    },
  });

  return {
    status: "success",
    suppressBanner: true,
    message: "QuickScan started. ProductPulse is checking native Shopify product, order, refund and return signals.",
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

  const job = await prisma.catalogSignalJob.create({
    data: {
      shop,
      kind: SHOPIFY_MOCK_DATASET_KIND,
      source: "Queued Shopify mock dataset generation",
      status: "Queued",
      progress: 0,
      payload: {
        queuedAt: new Date().toISOString(),
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

export async function getProductsQueueForShop(shop, admin, filters = {}, options = {}) {
  await failStaleFastProductScans(shop);
  const [snapshots, activeJob, activeDiagnosisJobs, settings, watchedItems] = await Promise.all([
    prisma.productRiskSnapshot.findMany({
      where: { shop },
      orderBy: [{ riskScore: "desc" }, { updatedAt: "desc" }],
    }),
    getActiveFastProductScan(shop),
    getActiveProductDiagnosisJobs(shop),
    options.settings ? Promise.resolve(options.settings) : getProductPulseSettings(shop),
    prisma.productWatchlistItem.findMany({
      where: { shop },
      select: { productGid: true, status: true },
    }),
  ]);

  if (activeJob) ensureFastProductScanWorker(activeJob);
  if (activeDiagnosisJobs.length) ensureProductDiagnosisQueueWorker(shop);
  const activeDiagnosisProductKeys = getActiveDiagnosisProductKeySet(activeDiagnosisJobs);
  const [latestDiagnosisByProductGid, resolvedActionsByProductGid] = await Promise.all([
    getLatestCompletedDiagnosisMap(shop, snapshots),
    getResolvedProductActionsMap(shop, snapshots),
  ]);
  const filterOptions = getProductTableFilterOptions(snapshots, resolvedActionsByProductGid, settings, latestDiagnosisByProductGid, activeDiagnosisProductKeys);
  const filteredSnapshots = sortProductSnapshots(
    filterProductSnapshots(snapshots, filters, resolvedActionsByProductGid, settings, latestDiagnosisByProductGid, activeDiagnosisProductKeys),
    filters,
    resolvedActionsByProductGid,
  );
  const rowsPerPage = normalizeRowsPerPage(filters.rows);
  const totalPages = Math.max(1, Math.ceil(filteredSnapshots.length / rowsPerPage));
  const page = Math.min(normalizePositiveInteger(filters.page, 1), totalPages);
  const pageSnapshots = filteredSnapshots.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  const watchedByProductGid = new Map(watchedItems.map((item) => [item.productGid, item]));
  const scoreHistoryByProductGid = await getProductScoreHistoryForProductsForShop(
    shop,
    pageSnapshots.map((snapshot) => snapshot.productGid),
    { take: 80 },
  );
  const rows = pageSnapshots.map((snapshot) => formatProductRow(
    snapshot,
    latestDiagnosisByProductGid.get(snapshot.productGid),
    resolvedActionsByProductGid.get(snapshot.productGid),
    settings,
    watchedByProductGid.get(snapshot.productGid),
    scoreHistoryByProductGid.get(snapshot.productGid) || [],
  ));
  const rowsWithImages = await attachProductImages(rows, admin);
  const rowsWithJobs = attachActiveProductDiagnosisJobs(rowsWithImages, activeDiagnosisJobs);

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

  return {
    status: "success",
    message: `${snapshot.productTitle || "Product"} was added to Candidates without running a diagnosis.`,
    action: {
      id: "add-shopify-product-candidate",
      productGid: snapshot.productGid,
      handle: snapshot.handle,
    },
  };
}

export async function getDashboardDataForShop(shop, admin) {
  await failStaleFastProductScans(shop);
  const [snapshots, latestLedgerEntry, activeJob, activeDiagnosisJobs, settings, catalogProductCount, actions] = await Promise.all([
    prisma.productRiskSnapshot.findMany({
      where: { shop },
      orderBy: [{ riskScore: "desc" }, { updatedAt: "desc" }],
    }),
    prisma.creditLedgerEntry.findFirst({
      where: { shop },
      orderBy: { createdAt: "desc" },
    }),
    getActiveFastProductScan(shop),
    getActiveProductDiagnosisJobs(shop),
    getProductPulseSettings(shop),
    getShopifyCatalogProductCount(admin),
    prisma.productAction.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 250,
    }),
  ]);

  if (activeJob) ensureFastProductScanWorker(activeJob);
  if (activeDiagnosisJobs.length) ensureProductDiagnosisQueueWorker(shop);

  const latestDiagnosisByProductGid = await getLatestCompletedDiagnosisMap(shop, snapshots);
  const dashboardProductsWithoutImages = snapshots.map((snapshot) => formatSnapshotForDiagnosis(
    snapshot,
    actions.filter((action) => action.productGid === snapshot.productGid).map(formatStoredProductAction),
    latestDiagnosisByProductGid.get(snapshot.productGid),
    settings,
  ));
  const dashboardProducts = await attachProductImages(dashboardProductsWithoutImages, admin);
  const dashboardProductsWithJobs = attachActiveProductDiagnosisJobs(dashboardProducts, activeDiagnosisJobs);

  return buildDashboardViewData(dashboardProductsWithJobs, {
    billing: latestLedgerEntry ? { creditsAvailable: latestLedgerEntry.balanceAfter } : null,
    catalogProductCount,
    settings,
  });
}

async function getShopifyCatalogProductCount(admin) {
  if (!admin?.graphql) return null;
  try {
    const data = await shopifyGraphql(admin, `#graphql
      query ProductPulseCatalogProductCount {
        productsCount {
          count
        }
      }
    `);
    const count = Number(data?.productsCount?.count || 0);
    return Number.isFinite(count) && count > 0 ? count : null;
  } catch {
    return null;
  }
}

export async function getAnalyticsDataForShop(shop) {
  await failStaleFastProductScans(shop);
  const [snapshots, activeJob, activeDiagnosisJobs, sources, actions, settings] = await Promise.all([
    prisma.productRiskSnapshot.findMany({
      where: { shop },
      orderBy: [{ riskScore: "desc" }, { updatedAt: "desc" }],
    }),
    getActiveFastProductScan(shop),
    getActiveProductDiagnosisJobs(shop),
    prisma.productPulseSource.findMany({
      where: { shop, sourceKey: { not: PRODUCT_PULSE_SETTINGS_SOURCE_KEY } },
      orderBy: [{ category: "asc" }, { sourceKey: "asc" }],
    }),
    prisma.productAction.findMany({
      where: { shop },
      orderBy: { createdAt: "desc" },
      take: 250,
    }),
    getProductPulseSettings(shop),
  ]);

  if (activeJob) ensureFastProductScanWorker(activeJob);
  if (activeDiagnosisJobs.length) ensureProductDiagnosisQueueWorker(shop);

  const latestDiagnosisByProductGid = await getLatestCompletedDiagnosisMap(shop, snapshots);
  const scoreHistoryByProductGid = await getProductScoreHistoryForProductsForShop(
    shop,
    snapshots.map((snapshot) => snapshot.productGid),
    { take: 80 },
  );
  const analyticsProducts = snapshots.map((snapshot) => formatSnapshotForDiagnosis(
    snapshot,
    actions.filter((action) => action.productGid === snapshot.productGid).map(formatStoredProductAction),
    latestDiagnosisByProductGid.get(snapshot.productGid),
    settings,
    null,
    scoreHistoryByProductGid.get(snapshot.productGid) || [],
  ));

  return buildAnalyticsViewData(analyticsProducts, {
    sources,
    actions,
    settings,
    windowDays: settings.analysis?.lookbackDays,
  });
}

async function getLatestCompletedDiagnosisMap(shop, snapshots = []) {
  const productGids = [...new Set(snapshots.map((snapshot) => snapshot.productGid).filter(Boolean))];
  if (!productGids.length) return new Map();

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

  const jobs = [];
  for (const productId of uniqueProductIds) {
    const job = await createProductDiagnosisJob(shop, productId, options);
    if (job) jobs.push(job);
  }

  if (!jobs.length) {
    return { status: "validation_error", message: "Selected products were not found in ProductPulse or Shopify." };
  }

  ensureProductDiagnosisQueueWorker(shop);

  return {
    status: "success",
    suppressBanner: true,
    message: `${jobs.length} product diagnosis job${jobs.length === 1 ? "" : "s"} queued. They will run one at a time.`,
    queuedCount: jobs.length,
    jobs: jobs.map(formatJob),
  };
}

export async function getRecentJobsForShop(shop) {
  await failStaleFastProductScans(shop);
  const jobs = await prisma.catalogSignalJob.findMany({
    where: { shop },
    orderBy: [{ updatedAt: "desc" }],
    take: JOB_MONITOR_RECENT_JOB_LIMIT,
  });
  jobs.filter((job) => isActiveStatus(job.status)).forEach((job) => {
    if (job.kind === FAST_PRODUCT_SCAN_KIND) ensureFastProductScanWorker(job);
    if (job.kind === SHOPIFY_MOCK_DATASET_KIND) ensureShopifyMockDatasetWorker(job);
  });
  if (jobs.some((job) => job.kind === PRODUCT_DIAGNOSIS_KIND && isActiveStatus(job.status))) {
    ensureProductDiagnosisQueueWorker(shop);
  }
  return jobs.map(formatJob);
}

export async function getJobMonitorForShop(shop) {
  await failStaleFastProductScans(shop);
  const [jobs, logs] = await Promise.all([
    prisma.catalogSignalJob.findMany({
      where: { shop },
      orderBy: [{ updatedAt: "desc" }],
      take: JOB_MONITOR_RECENT_JOB_LIMIT,
    }),
    getJobLogsForShop(shop, 100),
  ]);

  jobs.filter((job) => isActiveStatus(job.status)).forEach((job) => {
    if (job.kind === FAST_PRODUCT_SCAN_KIND) ensureFastProductScanWorker(job);
    if (job.kind === SHOPIFY_MOCK_DATASET_KIND) ensureShopifyMockDatasetWorker(job);
  });
  if (jobs.some((job) => job.kind === PRODUCT_DIAGNOSIS_KIND && isActiveStatus(job.status))) {
    ensureProductDiagnosisQueueWorker(shop);
  }

  return {
    activeJobs: jobs.filter((job) => isActiveStatus(job.status)).map(formatJob),
    recentJobs: jobs.map(formatJob),
    logs: logs.map(formatJobLog),
    updatedAt: new Date().toISOString(),
  };
}

export async function getBackgroundProcessesForShop(shop, options = {}) {
  await failStaleFastProductScans(shop);
  const requestedPage = normalizeBackgroundProcessPage(options.page);
  const [total, statusGroups, kindGroups, logs] = await Promise.all([
    prisma.catalogSignalJob.count({ where: { shop } }),
    prisma.catalogSignalJob.groupBy({
      by: ["status"],
      where: { shop },
      _count: { _all: true },
    }),
    prisma.catalogSignalJob.groupBy({
      by: ["kind"],
      where: { shop },
      _count: { _all: true },
    }),
    getJobLogsForShop(shop, BACKGROUND_PROCESS_LOG_LIMIT),
  ]);
  const page = clampBackgroundProcessPage(requestedPage, total);
  const [jobs, activeJobs] = await Promise.all([
    prisma.catalogSignalJob.findMany({
      where: { shop },
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * BACKGROUND_PROCESS_PAGE_SIZE,
      take: BACKGROUND_PROCESS_PAGE_SIZE,
    }),
    prisma.catalogSignalJob.findMany({
      where: { shop, status: { in: ["Queued", "Running"] } },
      orderBy: [{ updatedAt: "desc" }],
      take: BACKGROUND_PROCESS_ACTIVE_LIMIT,
    }),
  ]);

  ensureWorkersForJobs(shop, activeJobs);

  const formattedLogs = logs.map(formatJobLog);
  const logsByJob = groupJobLogsByJobId(formattedLogs);
  const processes = jobs.map((job) => formatBackgroundProcess(job, logsByJob.get(job.id) || []));
  const activeProcesses = activeJobs.map((job) => formatBackgroundProcess(job, logsByJob.get(job.id) || []));
  const statusCounts = mapBackgroundProcessStatusCounts(statusGroups);
  const kindCounts = mapBackgroundProcessKindCounts(kindGroups);

  return {
    processes,
    activeProcesses,
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
}

export async function getProductSnapshotForShop(shop, productId, admin) {
  const snapshot = await findProductRiskSnapshot(shop, productId);
  if (!snapshot) return null;

  const [actions, latestDiagnosis, activeDiagnosisJobs, settings, watchedItem, scoreHistory] = await Promise.all([
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
    getProductScoreHistoryForShop(shop, snapshot.productGid, { take: 80 }),
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
  ensureProductDiagnosisQueueWorker(shop);

  return {
    status: "success",
    suppressBanner: true,
    message: `AI Product Diagnosis queued for ${job.payload?.productTitle || "selected product"}.`,
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
  const descriptionChangesOverride = normalizeDescriptionChangesOverride(payloadOverride.descriptionChangesJson || payloadOverride.descriptionChanges);

  const metrics = snapshot.metrics || {};
  const latestDiagnosis = await prisma.productDiagnosis.findFirst({
    where: { shop, productGid: snapshot.productGid, status: "Completed" },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
  });
  const diagnosisRecommendations = Array.isArray(latestDiagnosis?.recommendations) ? latestDiagnosis.recommendations : [];
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
    return {
      status: "success",
      message: `${recordLabel} was restored for ${snapshot.productTitle}.`,
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

  await prisma.productAction.create({
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
    action,
    actionRecordStatus: status,
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
      watchActivities: watchActivities.count,
      watchlistItems: watchlistItems.count,
      snapshots: snapshots.count,
      jobLogs: jobLogs.count,
      jobs: jobs.count,
    };
  });

  const deletedRecords = Object.values(deleted).reduce((sum, count) => sum + Number(count || 0), 0);

  return {
    status: "success",
    message: `${productTitle} analysis was deleted from ProductPulse. To analyze it again, use Find Shopify product and run a new diagnosis.`,
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

  if (id === "review-product-evidence" || /\b(evidence|inspect|verify|investigation|review)\b/.test(normalized)) {
    return {
      id: id || "review-product-evidence",
      label: label || "Review product evidence",
      type: "Workflow",
      effort: "Low",
      status: "Ready",
      payload: {
        reviewSections: [],
        shopifyField: "Product evidence",
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
      };
    })
    .filter(Boolean);
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
  if (action.id === "review-product-evidence" || Array.isArray(payload.reviewSections) || /\b(evidence|inspect|verify|investigation|review)\b/.test(matchText)) {
    aliases.add("review-product-evidence");
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
    const title = String(payload.draftText || payload.draftTitle || "").replace(/\s+/g, " ").trim();
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
    const description = String(payload.draftText || "").replace(/\s+/g, " ").trim();
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
    const productFields = {};
    if (vendor) productFields.vendor = vendor;
    if (productType) productFields.productType = productType;
    if (!Object.keys(productFields).length) return { status: "validation_error", message: "This classification action does not include a vendor or product type to apply." };
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

  if (Array.isArray(payload.metafields) && payload.metafields.length) {
    const result = await setProductMetafields(admin, snapshot.productGid, payload.metafields);
    if (result.status === "validation_error") return result;
    return {
      message: `${payload.metafields.length === 1 ? "Product metafield was saved" : "Product metafields were saved"} for ${snapshot.productTitle}.`,
      change: {
        target: "Product metafields",
        operation: "set",
        value: payload.metafields,
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
  return structured.slice(0, 6);
}

function parseFaqText(draftText = "") {
  const lines = String(draftText || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const parsed = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/[?？]$/.test(line)) continue;
    const answer = lines[index + 1] || "";
    if (answer && !/[?？]$/.test(answer)) parsed.push({ question: normalizeFaqQuestion(line), answer: normalizeFaqAnswer(answer) });
  }
  return parsed;
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
  const normalized = String(value || "").trim();
  if (normalized === "$app") return normalized;
  return normalized.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "productpulse";
}

function normalizeShopifyMetafieldKey(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "faq_html";
}

async function setProductFaqMetafield(admin, productGid, { namespace, key, type, faqItems, sourceActionId, htmlStyle }) {
  try {
    const value = buildProductPulseFaqHtml({
      faqItems,
      variant: "description-section",
      action: { id: sourceActionId || "product-faq-metafield" },
      htmlStyle,
    });
    const response = await admin.graphql(
      `#graphql
      mutation ProductPulseSetProductFaqMetafield($metafields: [MetafieldsSetInput!]!) {
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
      {
        variables: {
          metafields: [{
            ownerId: productGid,
            namespace: normalizeShopifyMetafieldNamespace(namespace),
            key: normalizeShopifyMetafieldKey(key),
            type: type || "multi_line_text_field",
            value,
          }],
        },
      },
    );
    const json = await response.json();
    const errors = json.errors || json.data?.metafieldsSet?.userErrors || [];
    if (errors.length) return { status: "validation_error", message: errors.map((error) => error.message).join(" ") };
    return { status: "success" };
  } catch (error) {
    return { status: "validation_error", message: `Unable to set product FAQ metafield: ${error.message}` };
  }
}

async function setProductMetafields(admin, productGid, metafields = []) {
  const normalizedMetafields = (Array.isArray(metafields) ? metafields : [])
    .map((metafield) => ({
      ownerId: productGid,
      namespace: String(metafield.namespace || "productpulse").trim(),
      key: String(metafield.key || "").trim(),
      type: String(metafield.type || "single_line_text_field").trim(),
      value: typeof metafield.value === "string" ? metafield.value : JSON.stringify(metafield.value ?? ""),
    }))
    .filter((metafield) => metafield.namespace && metafield.key && metafield.type);
  if (!normalizedMetafields.length) {
    return { status: "validation_error", message: "This metafield action does not include valid metafields to save." };
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
      { variables: { metafields: normalizedMetafields } },
    );
    const json = await response.json();
    const errors = json.errors || json.data?.metafieldsSet?.userErrors || [];
    if (errors.length) return { status: "validation_error", message: errors.map((error) => error.message).join(" ") };
    return { status: "success" };
  } catch (error) {
    return { status: "validation_error", message: `Unable to set product metafields: ${error.message}` };
  }
}

function getDescriptionOperationForAction(action) {
  const payload = action.payload || {};
  if (["replace", "prepend", "append"].includes(payload.operation)) return payload.operation;
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
  if (operation === "replace" && action?.payload?.preserveHtml && action?.payload?.descriptionReplacements?.length && currentHtml) {
    const patchedHtml = applyDescriptionHtmlReplacements(currentHtml, action.payload.descriptionReplacements);
    if (patchedHtml.changed) return patchedHtml.html;
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
    blocks.push(buildProductPulseDescriptionReplacement(replacementChange.text, buildDescriptionChangeAction(action, replacementChange), htmlStyle));
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
    },
  };
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

function buildProductPulseDescriptionReplacement(text, action, htmlStyle) {
  const actionId = escapeHtml(action.id || "product-action");
  return buildProductPulseStyledHtmlBlock({
    actionId,
    className: "productpulse-description-update",
    title: "Updated product description",
    contentHtml: buildHtmlParagraphs(text, htmlStyle),
    htmlStyle,
  });
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

async function createProductDiagnosisJob(shop, productId, options = {}) {
  let snapshot = await findProductRiskSnapshot(shop, productId);
  if (!snapshot && options.admin) {
    snapshot = await createManualProductRiskSnapshot(shop, options.admin, productId);
  }
  if (!snapshot) return null;
  const activeJob = await getActiveProductDiagnosisJobForSnapshot(shop, snapshot);
  if (activeJob) return activeJob;

  const job = await prisma.catalogSignalJob.create({
    data: {
      shop,
      kind: PRODUCT_DIAGNOSIS_KIND,
      source: `Queued AI Product Diagnosis - ${snapshot.productTitle}`,
      status: "Queued",
      progress: 0,
      payload: {
        productId,
        productGid: snapshot.productGid,
        handle: snapshot.handle,
        productTitle: snapshot.productTitle,
        riskScore: snapshot.riskScore,
        queuedAt: new Date().toISOString(),
      },
    },
  });

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

async function getActiveProductDiagnosisJobForSnapshot(shop, snapshot) {
  const jobs = await getActiveProductDiagnosisJobs(shop);
  return findActiveProductDiagnosisJobForSnapshot(snapshot, jobs);
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
  const cutoff = new Date(Date.now() - STALE_JOB_TIMEOUT_MS);
  await prisma.catalogSignalJob.updateMany({
    where: {
      shop,
      kind: FAST_PRODUCT_SCAN_KIND,
      status: { in: ["Queued", "Running"] },
      startedAt: { lte: cutoff },
    },
    data: {
      status: "Failed",
      errorMessage: "QuickScan worker timed out before completing.",
      source: "QuickScan failed",
      finishedAt: new Date(),
    },
  });
}

function ensureFastProductScanWorker(job, options = {}) {
  if (!job?.id || activeWorkers.has(job.id) || !isActiveStatus(job.status)) return;

  activeWorkers.add(job.id);
  setTimeout(async () => {
    try {
      await recordJobLog({
        shop: job.shop,
        jobId: job.id,
        event: "quick_scan.worker_started",
        message: "QuickScan worker started or rehydrated from an active persisted job.",
        data: { status: job.status, source: job.source },
      });
      const admin = options.admin || await getOfflineAdmin(job.shop);
      const scopes = options.scopes || options.session?.scope || admin.productPulseScopes || "";
      await runShopifyQuickScan({
        shop: job.shop,
        admin,
        jobId: job.id,
        scopes,
      });
    } catch (error) {
      await recordJobLog({
        shop: job.shop,
        jobId: job.id,
        level: "error",
        event: "quick_scan.worker_failed",
        message: "QuickScan worker failed.",
        data: { error: serializeError(error) },
      });
      await markJobFailed(job.id, error);
    } finally {
      activeWorkers.delete(job.id);
      await recordJobLog({
        shop: job.shop,
        jobId: job.id,
        event: "quick_scan.worker_stopped",
        message: "QuickScan worker stopped.",
      });
    }
  }, 0);
}

function ensureShopifyMockDatasetWorker(job, options = {}) {
  if (!job?.id || activeMockDatasetWorkers.has(job.id) || !isActiveStatus(job.status)) return;

  activeMockDatasetWorkers.add(job.id);
  setTimeout(async () => {
    const stage = normalizeShopifyMockDatasetStage(options.stage || job.payload?.stage);
    try {
      const claimed = await prisma.catalogSignalJob.updateMany({
        where: {
          id: job.id,
          kind: SHOPIFY_MOCK_DATASET_KIND,
          status: { in: ["Queued", "Running"] },
        },
        data: {
          status: "Running",
          progress: Math.max(Number(job.progress || 0), 2),
          startedAt: job.startedAt || new Date(),
          source: `Running Shopify mock dataset stage: ${SHOPIFY_MOCK_DATASET_STAGE_LABELS[stage]}`,
        },
      });
      if (claimed.count !== 1) return;

      await recordJobLog({
        shop: job.shop,
        jobId: job.id,
        event: "mock_dataset.worker_started",
        message: "Shopify mock dataset worker started or rehydrated from an active persisted job.",
        data: { status: job.status, source: job.source, stage },
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
        },
        data: {
          status: "Completed",
          progress: 100,
          source: `Mock dataset stage completed: ${SHOPIFY_MOCK_DATASET_STAGE_LABELS[stage]}.`,
          payload: summary,
          finishedAt: new Date(),
        },
      });
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

function ensureProductDiagnosisQueueWorker(shop) {
  if (!shop || activeDiagnosisQueueWorkers.has(PRODUCT_DIAGNOSIS_QUEUE_WORKER_KEY)) return;

  activeDiagnosisQueueWorkers.add(PRODUCT_DIAGNOSIS_QUEUE_WORKER_KEY);
  setTimeout(async () => {
    try {
      await requeueRecoveredProductDiagnosisJobs();

      for (;;) {
        const job = await claimNextProductDiagnosisJob();
        if (!job) break;

        try {
          await runProductDiagnosisJob(job);
        } catch (error) {
          await recordJobLog({
            shop: job.shop,
            jobId: job.id,
            level: "error",
            event: "product_diagnosis.worker_failed",
            message: "Product diagnosis worker failed.",
            data: { error: serializeError(error), payload: job.payload },
          });
          await markJobFailed(job.id, error, "AI Product Diagnosis failed");
        }
      }
    } finally {
      activeDiagnosisQueueWorkers.delete(PRODUCT_DIAGNOSIS_QUEUE_WORKER_KEY);
      const queuedCount = await prisma.catalogSignalJob.count({
        where: { kind: PRODUCT_DIAGNOSIS_KIND, status: "Queued" },
      });
      if (queuedCount > 0) ensureProductDiagnosisQueueWorker(shop);
    }
  }, 0);
}

async function requeueRecoveredProductDiagnosisJobs(shop) {
  const where = {
    kind: PRODUCT_DIAGNOSIS_KIND,
    status: "Running",
    ...(shop ? { shop } : {}),
  };
  const recovered = await prisma.catalogSignalJob.updateMany({
    where,
    data: {
      status: "Queued",
      progress: 0,
      source: "Requeued AI Product Diagnosis after worker recovery",
    },
  });

  if (recovered.count > 0) {
    const jobs = await prisma.catalogSignalJob.findMany({
      where: {
        kind: PRODUCT_DIAGNOSIS_KIND,
        status: "Queued",
        ...(shop ? { shop } : {}),
      },
      orderBy: [{ updatedAt: "desc" }],
      take: recovered.count,
    });

    await Promise.all(jobs.map((job) => recordJobLog({
      shop: job.shop,
      jobId: job.id,
      event: "product_diagnosis.requeued",
      message: "Recovered running product diagnosis job and returned it to the queue.",
      data: { payload: job.payload },
    })));
  }
}

async function claimNextProductDiagnosisJob(shop) {
  const nextJob = await prisma.catalogSignalJob.findFirst({
    where: {
      kind: PRODUCT_DIAGNOSIS_KIND,
      status: "Queued",
      ...(shop ? { shop } : {}),
    },
    orderBy: [{ startedAt: "asc" }],
  });

  if (!nextJob) return null;

  const claimed = await prisma.catalogSignalJob.updateMany({
    where: {
      id: nextJob.id,
      status: "Queued",
    },
    data: {
      status: "Running",
      progress: 5,
      source: `Running AI Product Diagnosis - ${nextJob.payload?.productTitle || "selected product"}`,
      startedAt: new Date(),
    },
  });

  if (claimed.count !== 1) return null;
  return prisma.catalogSignalJob.findUnique({ where: { id: nextJob.id } });
}

async function runProductDiagnosisJob(job) {
  const startedAt = Date.now();
  const productId = job.payload?.productGid || job.payload?.handle || job.payload?.productId;
  const snapshot = await findProductRiskSnapshot(job.shop, productId);
  if (!snapshot) throw new Error("Product snapshot was not found for queued diagnosis job.");

  const metrics = snapshot.metrics || {};

  await recordJobLog({
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
  });

  await updateProductDiagnosisJob(job.id, {
    progress: 18,
    source: `Preparing AI Product Diagnosis - ${snapshot.productTitle}`,
  });

  await updateProductDiagnosisJob(job.id, {
    progress: 42,
    source: `Analyzing Shopify and Judge.me evidence - ${snapshot.productTitle}`,
  });

  const admin = await getOfflineAdmin(job.shop);
  const diagnosis = await runDetailedProductDiagnosis({
    shop: job.shop,
    jobId: job.id,
    admin,
    snapshot,
  });

  await updateProductDiagnosisJob(job.id, {
    progress: 92,
    source: diagnosis?.skipped
      ? `No product changes detected - reused diagnosis - ${snapshot.productTitle}`
      : `Finalizing AI Product Diagnosis - ${snapshot.productTitle}`,
  });

  await updateProductDiagnosisJob(job.id, {
    status: "Completed",
    progress: 100,
    source: diagnosis?.skipped
      ? `No changes detected; previous diagnosis reused - ${snapshot.productTitle}`
      : `AI Product Diagnosis completed - ${snapshot.productTitle}`,
    finishedAt: new Date(),
  });

  await recordJobLog({
    shop: job.shop,
    jobId: job.id,
    event: "product_diagnosis.completed",
    message: diagnosis?.skipped
      ? "Product diagnosis finished from cache because no source changes were detected. No credit was consumed."
      : "Product diagnosis completed.",
    data: {
      durationMs: Date.now() - startedAt,
      diagnosisId: diagnosis?.diagnosisId,
      skipped: Boolean(diagnosis?.skipped),
      skipReason: diagnosis?.skipReason,
      creditsConsumed: diagnosis?.creditsConsumed ?? 1,
      riskScore: diagnosis?.riskScore,
      confidence: diagnosis?.confidence,
      estimatedImpact: diagnosis?.estimatedImpact,
      provider: diagnosis?.provider,
      model: diagnosis?.model,
      modelsUsed: diagnosis?.modelsUsed,
      aiUsage: diagnosis?.aiUsage,
    },
  });
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
    data,
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

async function markJobFailed(jobId, error, source = "QuickScan failed") {
  await prisma.catalogSignalJob.updateMany({
    where: {
      id: jobId,
      status: { in: ["Queued", "Running"] },
    },
    data: {
      status: "Failed",
      progress: 100,
      source,
      errorMessage: error instanceof Error ? error.message : String(error),
      finishedAt: new Date(),
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

function formatProductRow(snapshot, latestDiagnosis = null, resolvedAction = null, settings = undefined, watchedItem = null, scoreHistory = []) {
  const metrics = snapshot.metrics || {};
  const sources = Array.isArray(snapshot.sourceCoverage) ? snapshot.sourceCoverage : [];
  const analysisState = getProductAnalysisState(snapshot, latestDiagnosis);
  const resolvedAt = resolvedAction?.appliedAt || resolvedAction?.createdAt || null;
  const riskLabel = getRiskLabel(snapshot.riskScore, settings);
  const riskTone = getRiskTone(snapshot.riskScore, settings);
  const isWatched = Boolean(watchedItem);
  return {
    productGid: snapshot.productGid,
    handle: snapshot.handle,
    title: snapshot.productTitle,
    variant: getProductArtVariant(snapshot.handle),
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
    signals: metrics.signalCount || 0,
    signalTone: getEvidenceToneForProduct(snapshot.riskScore, metrics, settings),
    signalBars: getSignalBars(metrics),
    signalDetails: getSignalDetails(snapshot, metrics, settings),
    riskTrend: getProductRiskTrendForRow(metrics, scoreHistory),
    productMomentum: metrics.productMomentum || null,
    issue: snapshot.primaryIssue,
    sources: sources.map(getSourceToken),
    sourceOverflow: Math.max(0, sources.length - 3),
    lastAnalysis: formatJobDate(snapshot.updatedAt),
    lastAnalysisAt: toIso(snapshot.updatedAt),
    credits: 1,
    href: `/app/products/${snapshot.handle}`,
  };
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
      label: "Full diagnosis",
      tone: "success",
      icon: "wand",
      completedAt: toIso(completedAt),
      detail: completedAt
        ? `Deep AI diagnosis completed ${formatJobDate(completedAt)}.`
        : "Deep AI diagnosis completed.",
    };
  }

  return {
    depth: "quickscan",
    label: "QuickScan only",
    tone: "info",
    icon: "search",
    completedAt: null,
    detail: "Preliminary Shopify scan only. Run product diagnosis for recommended actions.",
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
  resolvedActionsByProductGid = new Map(),
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
    const isResolved = resolvedActionsByProductGid.has(snapshot.productGid);
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
      { value: "quickscan", label: "QuickScan", count: analysisCounts.quickscan },
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
  return Number(value) === 50 ? 50 : 25;
}

function normalizePositiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

async function attachProductImages(rows, admin) {
  if (!admin?.graphql || rows.length === 0) return rows;
  const ids = rows.map((row) => row.productGid).filter(Boolean);
  if (!ids.length) return rows;

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

  return prisma.productRiskSnapshot.upsert({
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
  if (status === "full") return "Deep analysis completed";
  if (status === "quickscan") return "QuickScan stored";
  return "Not in ProductPulse";
}

function getProductPulseSearchStatusDetail(status) {
  if (status === "full") return "This product already has a completed deep product diagnosis in ProductPulse.";
  if (status === "quickscan") return "This product is stored in ProductPulse with lightweight QuickScan signals only.";
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
  return `https://${shop}/admin/products/${numericId}`;
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
    analysisDetail: "No QuickScan or product diagnosis has been stored yet.",
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

function formatSnapshotForDiagnosis(snapshot, actions = [], latestDiagnosis = null, settings = undefined, watchedItem = null, scoreHistory = []) {
  const metrics = snapshot.metrics || {};
  const diagnosisReport = metrics.diagnosisReport || {};
  const diagnosisIssues = Array.isArray(latestDiagnosis?.issues) ? latestDiagnosis.issues : null;
  const diagnosisEvidence = Array.isArray(latestDiagnosis?.evidence) ? latestDiagnosis.evidence : null;
  const diagnosisRecommendations = Array.isArray(latestDiagnosis?.recommendations) ? latestDiagnosis.recommendations : null;
  const storedActions = actions.map(formatStoredProductAction);
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
    recommendedActions: hasFullDiagnosis ? (diagnosisRecommendations || getSnapshotRecommendedActions(snapshot, metrics)) : [],
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
        returnPressureScore: toNullableNumber(metrics.returnPressureScore || metrics.returnRefundRelationship?.returnPressureScore),
        refundLeakageScore: toNullableNumber(metrics.refundLeakageScore || metrics.returnRefundRelationship?.refundLeakageScore),
        mainIssueIntensity: toNullableNumber(metrics.mainIssueIntensity || metrics.priorityScore),
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
  if (/\b(review|evidence|investigation|workflow|return pattern)\b/.test(normalized)) aliases.add("review-product-evidence");
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
  const displayTitle = getJobDisplayTitle(job, productTitle);
  const displaySubtitle = getJobDisplaySubtitle(job, productTitle);
  const executionStartedAt = job.status === "Queued" ? null : job.startedAt;

  return {
    id: job.id,
    kind: job.kind,
    name: getJobDisplayName(job.kind),
    productTitle,
    productHandle,
    productHref: productHandle ? `/app/products/${productHandle}` : null,
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
    elapsedMs: job.status === "Queued" ? 0 : getElapsedMs(job.startedAt, job.finishedAt),
  };
}

function getJobDisplayName(kind) {
  if (kind === FAST_PRODUCT_SCAN_KIND) return "Fast product scan";
  if (kind === PRODUCT_DIAGNOSIS_KIND) return "AI Product Diagnosis";
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
  if (job.status === "Queued") return "Queued AI product diagnostics";
  if (job.status === "Running") return "Running AI product diagnostics";
  if (job.status === "Completed") return "AI product diagnostics completed";
  if (job.status === "Failed") return "AI product diagnostics failed";
  return "AI product diagnostics";
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
    if (items.length >= 16 || seen.has(key) || ["summary", "products", "customers"].includes(key)) return;
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

function getSignalBars(metrics) {
  return getEvidenceFamilyBars(metrics).map((bar) => bar.value);
}

function getSignalDetails(snapshot, metrics, settings = undefined) {
  const signalCount = Number(metrics.signalCount || 0);
  const bars = getEvidenceFamilyBars(metrics);
  const sourceCount = bars.filter((bar) => Number(bar.signalUnits || 0) > 0).length;
  const conflicting = hasConflictingEvidence(metrics);
  const strengthLabel = getEvidenceStrengthLabel({ signalCount, sourceCount, conflicting });
  const topEvidence = bars
    .filter((bar) => Number(bar.signalUnits || 0) > 0)
    .sort((first, second) => Number(second.signalUnits || second.value || 0) - Number(first.signalUnits || first.value || 0))
    .slice(0, 4)
    .map((bar) => ({
      label: bar.label,
      detail: bar.detail,
      icon: bar.icon,
    }));
  const recommendedAction = getPrimaryRecommendedActionLabel(snapshot, metrics);

  return {
    signalCount,
    sourceCount,
    strengthLabel,
    conflicting,
    tone: getEvidenceToneForProduct(snapshot.riskScore, metrics, settings),
    mainIssue: snapshot.primaryIssue || "Product quality",
    recommendedAction,
    topEvidence,
    summary: `${strengthLabel} evidence · ${signalCount} signal${signalCount === 1 ? "" : "s"} · ${sourceCount} source${sourceCount === 1 ? "" : "s"}`,
    bars,
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

function hasConflictingEvidence(metrics = {}) {
  if (metrics.evidenceConflict || metrics.conflictingEvidence) return true;
  const positive = Number(metrics.textInsights?.sentiment?.positive || metrics.positiveReviewCount || 0);
  const negative = Number(metrics.textInsights?.sentiment?.negative || metrics.negativeReviewCount || 0);
  return positive >= 3 && negative >= 3 && Math.abs(positive - negative) <= Math.max(2, Math.round(Math.max(positive, negative) * 0.35));
}

function getPrimaryRecommendedActionLabel(snapshot, metrics) {
  const recommendations = Array.isArray(metrics.recommendations) ? metrics.recommendations : [];
  const firstRecommendation = recommendations.find((item) => item?.label || item?.title);
  if (firstRecommendation) return firstRecommendation.label || firstRecommendation.title;
  return getSnapshotRecommendedActions(snapshot, metrics)[0]?.label || "Review product diagnosis";
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
    : "PDP copy and description quality require a full product diagnosis before this bar has detail.";
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
  formatBackgroundProcess,
  buildBackgroundProcessStats,
  filterProductSnapshots,
  getProductTableFilterOptions,
  getSignalLifecycleBars,
  mergeFaqItemsIntoExistingDescriptionHtml,
  normalizeFaqItemsForApply,
  getFaqApplyVariant,
};

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0));
}
