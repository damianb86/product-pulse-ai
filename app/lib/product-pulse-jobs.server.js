import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  getQuickScanWindowDays,
  runShopifyQuickScan,
} from "./product-pulse-quick-scan.server";
import { runDetailedProductDiagnosis } from "./product-pulse-diagnosis.server";
import {
  getJobLogsForShop,
  recordJobLog,
  serializeError,
} from "./product-pulse-job-logs.server";

const FAST_PRODUCT_SCAN_KIND = "fast-product-scan";
const PRODUCT_DIAGNOSIS_KIND = "product-diagnosis";
const STALE_JOB_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const PRODUCT_DIAGNOSIS_MINIMUM_DURATION_MS = process.env.NODE_ENV === "test" ? 10 : 15_000;
const activeWorkers = global.productPulseJobWorkers || new Set();
const activeDiagnosisQueueWorkers = global.productPulseDiagnosisQueueWorkers || new Set();

if (!global.productPulseJobWorkers) {
  global.productPulseJobWorkers = activeWorkers;
}

if (!global.productPulseDiagnosisQueueWorkers) {
  global.productPulseDiagnosisQueueWorkers = activeDiagnosisQueueWorkers;
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

  const windowDays = getQuickScanWindowDays(scopes);
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
      scopeMode: "default_orders_window",
    },
  });

  return {
    status: "success",
    suppressBanner: true,
    message: "QuickScan started. ProductPulse is checking native Shopify product, order, refund and return signals.",
    job: formatJob(job),
  };
}

export async function getProductsQueueForShop(shop, admin, filters = {}) {
  await failStaleFastProductScans(shop);
  const [snapshots, activeJob] = await Promise.all([
    prisma.productRiskSnapshot.findMany({
      where: { shop },
      orderBy: [{ riskScore: "desc" }, { updatedAt: "desc" }],
    }),
    getActiveFastProductScan(shop),
  ]);

  if (activeJob) ensureFastProductScanWorker(activeJob);
  const filterOptions = getProductTableFilterOptions(snapshots);
  const filteredSnapshots = sortProductSnapshots(
    filterProductSnapshots(snapshots, filters),
    filters,
  );
  const rowsPerPage = normalizeRowsPerPage(filters.rows);
  const totalPages = Math.max(1, Math.ceil(filteredSnapshots.length / rowsPerPage));
  const page = Math.min(normalizePositiveInteger(filters.page, 1), totalPages);
  const pageSnapshots = filteredSnapshots.slice((page - 1) * rowsPerPage, page * rowsPerPage);
  const rows = pageSnapshots.map(formatProductRow);
  const rowsWithImages = await attachProductImages(rows, admin);

  return {
    rows: rowsWithImages,
    total: filteredSnapshots.length,
    totalAll: snapshots.length,
    page,
    rowsPerPage,
    totalPages,
    filterOptions,
    activeScanJob: activeJob ? formatJob(activeJob) : null,
  };
}

export async function runSelectedProductDiagnosesForShop(shop, productIds = []) {
  const uniqueProductIds = [...new Set(productIds.filter(Boolean))];
  if (!uniqueProductIds.length) {
    return { status: "validation_error", message: "Select at least one product to analyze." };
  }

  const jobs = [];
  for (const productId of uniqueProductIds) {
    const job = await createProductDiagnosisJob(shop, productId);
    if (job) jobs.push(job);
  }

  if (!jobs.length) {
    return { status: "validation_error", message: "Selected products were not found in ProductPulse snapshots." };
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
    take: 12,
  });
  jobs.filter((job) => isActiveStatus(job.status)).forEach((job) => {
    if (job.kind === FAST_PRODUCT_SCAN_KIND) ensureFastProductScanWorker(job);
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
      take: 12,
    }),
    getJobLogsForShop(shop, 100),
  ]);

  jobs.filter((job) => isActiveStatus(job.status)).forEach((job) => {
    if (job.kind === FAST_PRODUCT_SCAN_KIND) ensureFastProductScanWorker(job);
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

export async function getProductSnapshotForShop(shop, productId, admin) {
  const snapshot = await findProductRiskSnapshot(shop, productId);
  if (!snapshot) return null;

  const [actions, latestDiagnosis] = await Promise.all([
    prisma.productAction.findMany({
      where: { shop, productGid: snapshot.productGid },
      orderBy: [{ createdAt: "desc" }],
      take: 20,
    }),
    prisma.productDiagnosis.findFirst({
      where: { shop, productGid: snapshot.productGid, status: "Completed" },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  const product = formatSnapshotForDiagnosis(snapshot, actions, latestDiagnosis);
  return attachProductImageToDiagnosis(withShopifyAdminUrl(product, shop), admin);
}

export async function getProductDetailForShop(shop, productId, admin) {
  const snapshotProduct = await getProductSnapshotForShop(shop, productId, admin);
  if (snapshotProduct) return snapshotProduct;
  return getLiveShopifyProductDetail(productId, admin, shop);
}

export async function rerunProductDiagnosisForShop(shop, productId) {
  return queueProductDiagnosisForShop(shop, productId);
}

export async function queueProductDiagnosisForShop(shop, productId) {
  const job = await createProductDiagnosisJob(shop, productId);
  if (!job) return null;
  ensureProductDiagnosisQueueWorker(shop);

  return {
    status: "success",
    suppressBanner: true,
    message: `AI Product Diagnosis queued for ${job.payload?.productTitle || "selected product"}.`,
    job: formatJob(job),
  };
}

export async function recordProductDetailActionForShop(shop, productId, actionId, payloadOverride = {}) {
  const snapshot = await findProductRiskSnapshot(shop, productId);
  if (!snapshot) return null;

  const metrics = snapshot.metrics || {};
  const latestDiagnosis = await prisma.productDiagnosis.findFirst({
    where: { shop, productGid: snapshot.productGid, status: "Completed" },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
  });
  const diagnosisRecommendations = Array.isArray(latestDiagnosis?.recommendations) ? latestDiagnosis.recommendations : [];
  let action = actionId === "mark-resolved"
    ? getResolvedAction(snapshot)
    : diagnosisRecommendations.find((item) => item.id === actionId)
      || getSnapshotRecommendedActions(snapshot, metrics).find((item) => item.id === actionId);

  if (!action && payloadOverride.draftText) {
    action = {
      id: actionId || "custom-draft",
      label: payloadOverride.label || "Custom product action draft",
      type: "ProductPulse draft",
      effort: "Low",
      status: "Draft",
      payload: { draftText: payloadOverride.draftText },
    };
  }

  if (!action) {
    return { status: "validation_error", message: "Recommended action was not found." };
  }

  const status = action.id === "mark-resolved" || action.applyImmediately ? "applied" : "draft";
  const payload = {
    ...(action.payload || {}),
    ...(payloadOverride.draftText ? { draftText: payloadOverride.draftText } : {}),
  };
  await prisma.productAction.create({
    data: {
      shop,
      diagnosisId: latestDiagnosis?.id || null,
      productGid: snapshot.productGid,
      actionType: action.id,
      label: action.label,
      status,
      payload,
      appliedAt: status === "applied" ? new Date() : null,
    },
  });

  return {
    status: "success",
    message: status === "applied"
      ? `${action.label} was applied for ${snapshot.productTitle}.`
      : `${action.label} was saved as a draft for ${snapshot.productTitle}.`,
    action,
  };
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

async function createProductDiagnosisJob(shop, productId) {
  const snapshot = await findProductRiskSnapshot(shop, productId);
  if (!snapshot) return null;

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

function ensureProductDiagnosisQueueWorker(shop) {
  if (!shop || activeDiagnosisQueueWorkers.has(shop)) return;

  activeDiagnosisQueueWorkers.add(shop);
  setTimeout(async () => {
    try {
      await requeueRecoveredProductDiagnosisJobs(shop);

      for (;;) {
        const job = await claimNextProductDiagnosisJob(shop);
        if (!job) break;

        try {
          await runProductDiagnosisJob(job);
        } catch (error) {
          await recordJobLog({
            shop,
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
      activeDiagnosisQueueWorkers.delete(shop);
    }
  }, 0);
}

async function requeueRecoveredProductDiagnosisJobs(shop) {
  const recovered = await prisma.catalogSignalJob.updateMany({
    where: {
      shop,
      kind: PRODUCT_DIAGNOSIS_KIND,
      status: "Running",
    },
    data: {
      status: "Queued",
      progress: 0,
      source: "Requeued AI Product Diagnosis after worker recovery",
    },
  });

  if (recovered.count > 0) {
    const jobs = await prisma.catalogSignalJob.findMany({
      where: { shop, kind: PRODUCT_DIAGNOSIS_KIND, status: "Queued" },
      orderBy: [{ updatedAt: "desc" }],
      take: recovered.count,
    });

    await Promise.all(jobs.map((job) => recordJobLog({
      shop,
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
      shop,
      kind: PRODUCT_DIAGNOSIS_KIND,
      status: "Queued",
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
  await sleep(PRODUCT_DIAGNOSIS_MINIMUM_DURATION_MS);

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
    source: `Finalizing AI Product Diagnosis - ${snapshot.productTitle}`,
  });

  await updateProductDiagnosisJob(job.id, {
    status: "Completed",
    progress: 100,
    source: `AI Product Diagnosis completed - ${snapshot.productTitle}`,
    finishedAt: new Date(),
  });

  await recordJobLog({
    shop: job.shop,
    jobId: job.id,
    event: "product_diagnosis.completed",
    message: "Product diagnosis completed.",
    data: {
      durationMs: Date.now() - startedAt,
      diagnosisId: diagnosis?.diagnosisId,
      riskScore: diagnosis?.riskScore,
      confidence: diagnosis?.confidence,
      estimatedImpact: diagnosis?.estimatedImpact,
      provider: diagnosis?.provider,
      model: diagnosis?.model,
      modelsUsed: diagnosis?.modelsUsed,
    },
  });
}

async function getOfflineAdmin(shop) {
  const { admin, session } = await unauthenticated.admin(shop);
  return Object.assign(admin, { productPulseScopes: session.scope });
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function formatProductRow(snapshot) {
  const metrics = snapshot.metrics || {};
  const sources = Array.isArray(snapshot.sourceCoverage) ? snapshot.sourceCoverage : [];
  return {
    productGid: snapshot.productGid,
    handle: snapshot.handle,
    title: snapshot.productTitle,
    variant: getProductArtVariant(snapshot.handle),
    selected: false,
    risk: getRiskLabel(snapshot.riskScore),
    riskTone: getRiskTone(snapshot.riskScore),
    riskScore: snapshot.riskScore,
    status: snapshot.riskScore >= 75 ? "Needs attention" : snapshot.riskScore >= 55 ? "Monitor" : "Good",
    statusTone: getRiskTone(snapshot.riskScore),
    signals: metrics.signalCount || 0,
    signalTone: snapshot.riskScore >= 75 ? "red" : snapshot.riskScore >= 55 ? "orange" : "green",
    signalBars: getSignalBars(metrics),
    signalDetails: getSignalDetails(snapshot, metrics),
    issue: snapshot.primaryIssue,
    sources: sources.map(getSourceToken),
    sourceOverflow: Math.max(0, sources.length - 3),
    lastAnalysis: formatJobDate(snapshot.updatedAt),
    lastAnalysisAt: toIso(snapshot.updatedAt),
    credits: 1,
    href: `/app/products/${snapshot.handle}`,
  };
}

function filterProductSnapshots(snapshots, filters = {}) {
  const query = String(filters.query || "").trim().toLowerCase();

  return snapshots.filter((snapshot) => {
    const metrics = snapshot.metrics || {};
    const sources = Array.isArray(snapshot.sourceCoverage) ? snapshot.sourceCoverage : [];
    const collections = Array.isArray(metrics.collections) ? metrics.collections : [];
    const tags = Array.isArray(metrics.tags) ? metrics.tags : [];
    const searchable = [
      snapshot.productTitle,
      snapshot.handle,
      snapshot.primaryIssue,
      metrics.vendor,
      metrics.productType,
      ...collections,
      ...tags,
      ...sources,
    ].filter(Boolean).join(" ").toLowerCase();

    if (query && !searchable.includes(query)) return false;
    if (filters.risk && filters.risk !== "all" && getRiskFilterValue(snapshot.riskScore) !== filters.risk) return false;
    if (filters.status && filters.status !== "all" && getStatusFilterValue(snapshot.riskScore) !== filters.status) return false;
    if (filters.issue && filters.issue !== "all" && slugifyFilterValue(snapshot.primaryIssue) !== filters.issue) return false;
    if (filters.source && filters.source !== "all" && !sources.some((source) => slugifyFilterValue(source) === filters.source)) return false;

    if (filters.vendor && filters.vendor !== "all") {
      const values = [metrics.vendor, metrics.productType, ...collections].filter(Boolean).map(slugifyFilterValue);
      if (!values.includes(filters.vendor)) return false;
    }

    return true;
  });
}

function sortProductSnapshots(snapshots, filters = {}) {
  const sort = filters.sort === "lastAnalysis" ? "lastAnalysis" : "riskScore";
  const direction = filters.direction === "asc" ? 1 : -1;

  return [...snapshots].sort((first, second) => {
    const firstValue = sort === "lastAnalysis" ? new Date(first.updatedAt).getTime() : Number(first.riskScore || 0);
    const secondValue = sort === "lastAnalysis" ? new Date(second.updatedAt).getTime() : Number(second.riskScore || 0);

    if (firstValue === secondValue) return String(first.productTitle).localeCompare(String(second.productTitle));
    return (firstValue - secondValue) * direction;
  });
}

function getProductTableFilterOptions(snapshots) {
  const issues = new Map();
  const sources = new Map();
  const vendors = new Map();
  const statuses = new Map();

  snapshots.forEach((snapshot) => {
    const metrics = snapshot.metrics || {};
    addFilterOption(issues, snapshot.primaryIssue);
    addFilterOption(statuses, getStatusLabel(snapshot.riskScore), getStatusFilterValue(snapshot.riskScore));
    (Array.isArray(snapshot.sourceCoverage) ? snapshot.sourceCoverage : []).forEach((source) => addFilterOption(sources, source));
    addFilterOption(vendors, metrics.vendor);
    addFilterOption(vendors, metrics.productType);
    (Array.isArray(metrics.collections) ? metrics.collections : []).forEach((collection) => addFilterOption(vendors, collection));
  });

  return {
    risks: [
      { value: "all", label: "Risk" },
      { value: "high", label: "High" },
      { value: "medium", label: "Medium" },
      { value: "low", label: "Low" },
    ],
    statuses: [{ value: "all", label: "Status" }, ...Array.from(statuses.values()).sort(compareFilterOptions)],
    issues: [{ value: "all", label: "Issue type" }, ...Array.from(issues.values()).sort(compareFilterOptions)],
    sources: [{ value: "all", label: "Source" }, ...Array.from(sources.values()).sort(compareFilterOptions)],
    vendors: [{ value: "all", label: "Vendor or Collection" }, ...Array.from(vendors.values()).sort(compareFilterOptions)],
  };
}

function addFilterOption(map, label, value) {
  if (!label) return;
  const key = value || slugifyFilterValue(label);
  if (!key || map.has(key)) return;
  map.set(key, { value: key, label: String(label) });
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

function getRiskFilterValue(score) {
  if (score >= 75) return "high";
  if (score >= 55) return "medium";
  return "low";
}

function getStatusFilterValue(score) {
  if (score >= 75) return "needs-attention";
  if (score >= 55) return "monitor";
  return "good";
}

function getStatusLabel(score) {
  if (score >= 75) return "Needs attention";
  if (score >= 55) return "Monitor";
  return "Good";
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

async function attachProductImageToDiagnosis(product, admin) {
  if (!product || !admin?.graphql) return product;
  const [rowWithImage] = await attachProductImages([{ productGid: product.id }], admin);
  return {
    ...product,
    imageUrl: rowWithImage?.imageUrl || null,
    imageAlt: rowWithImage?.imageAlt || null,
  };
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
    return product ? withShopifyAdminUrl(formatLiveShopifyProductForDiagnosis(product), shop) : null;
  } catch {
    return null;
  }
}

function withShopifyAdminUrl(product, shop) {
  if (!product) return product;
  return {
    ...product,
    shopifyAdminUrl: getShopifyProductAdminUrl(shop, product.id),
  };
}

function getShopifyProductAdminUrl(shop, productGid) {
  const numericId = String(productGid || "").split("/").pop();
  if (!shop || !numericId) return null;
  return `https://${shop}/admin/products/${numericId}`;
}

function formatLiveShopifyProductForDiagnosis(product) {
  const mediaNode = product.media?.nodes?.[0] || {};
  const image = product.featuredMedia?.preview?.image || mediaNode.image || mediaNode.preview?.image || {};
  const variants = product.variants?.nodes || [];
  const collections = (product.collections?.nodes || []).map((collection) => collection.title).filter(Boolean);
  const tags = Array.isArray(product.tags) ? product.tags : [];
  const optionNames = (product.options || []).map((option) => option.name).filter(Boolean);
  const skuCount = variants.filter((variant) => variant.sku).length;

  return {
    id: product.id,
    slug: product.handle,
    title: product.title,
    handle: product.handle,
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
    primaryIssue: null,
    hasRiskSnapshot: false,
    canDiagnose: false,
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

function formatSnapshotForDiagnosis(snapshot, actions = [], latestDiagnosis = null) {
  const metrics = snapshot.metrics || {};
  const diagnosisReport = metrics.diagnosisReport || {};
  const diagnosisIssues = Array.isArray(latestDiagnosis?.issues) ? latestDiagnosis.issues : null;
  const diagnosisEvidence = Array.isArray(latestDiagnosis?.evidence) ? latestDiagnosis.evidence : null;
  const diagnosisRecommendations = Array.isArray(latestDiagnosis?.recommendations) ? latestDiagnosis.recommendations : null;
  const storedActions = actions.map(formatStoredProductAction);
  const resolvedAction = storedActions.find((action) => action.actionId === "mark-resolved" && action.status === "applied");
  const riskScore = latestDiagnosis?.riskScore ?? snapshot.riskScore;
  const confidence = latestDiagnosis?.confidence ?? snapshot.confidence;
  const primaryIssue = latestDiagnosis?.likelyCause || snapshot.primaryIssue;

  return {
    id: snapshot.productGid,
    slug: snapshot.handle,
    title: snapshot.productTitle,
    handle: snapshot.handle,
    collection: metrics.collections?.[0] || metrics.productType || "Shopify catalog",
    status: "Active",
    riskScore,
    impactScore: snapshot.impactScore,
    confidence,
    riskTone: getRiskTone(riskScore),
    riskLabel: getRiskLabel(riskScore),
    creditCost: 1,
    sourceCoverage: Array.isArray(snapshot.sourceCoverage) ? snapshot.sourceCoverage : ["Shopify products"],
    lastAnalysis: toIso(snapshot.updatedAt),
    primaryIssue,
    mainFinding: diagnosisReport.mainFinding || null,
    hasRiskSnapshot: true,
    canDiagnose: true,
    canResolve: true,
    metrics: {
      returnRate: metrics.returnRate || 0,
      refundRate: metrics.refundRate || 0,
      reviewRating: metrics.reviewRating || metrics.avgRating || 0,
      avgRating: metrics.avgRating || metrics.reviewRating || 0,
      reviewCount: metrics.reviewCount || 0,
      negativeReviewCount: metrics.negativeReviewCount || 0,
      negativeReviewRate: metrics.negativeReviewRate || 0,
      recentNegativeReviewCount: metrics.recentNegativeReviewCount || 0,
      issueCount: metrics.signalCount || 0,
      revenueAtRisk: metrics.revenueAtRisk || metrics.refundAmount || 0,
      marginAtRisk: metrics.marginAtRisk || 0,
      estimatedImpact: metrics.estimatedImpact || metrics.refundAmount || 0,
      signalCount: metrics.signalCount || 0,
      refundAmount: metrics.refundAmount || 0,
      returnUnits: metrics.returnUnits || 0,
      refundUnits: metrics.refundUnits || 0,
      recentSignalUnits: metrics.recentSignalUnits || 0,
      windowDays: metrics.windowDays || 60,
      soldUnits: metrics.soldUnits || 0,
      storeAvgReturnRate: metrics.storeAvgReturnRate || 0,
      storeAvgRefundRate: metrics.storeAvgRefundRate || 0,
      lastSignalAt: metrics.lastSignalAt || null,
      signalTrend: Array.isArray(metrics.signalTrend) ? metrics.signalTrend : [],
      riskTrend: Array.isArray(metrics.riskTrend) ? metrics.riskTrend : [],
      productType: metrics.productType || "",
      vendor: metrics.vendor || "",
      tags: Array.isArray(metrics.tags) ? metrics.tags : [],
      collections: Array.isArray(metrics.collections) ? metrics.collections : [],
      topReturnReasons: Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : [],
      affectedVariants: Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants : [],
      checkedSources: Array.isArray(diagnosisReport.checkedSources) ? diagnosisReport.checkedSources : [],
      aiModels: diagnosisReport.aiModels || null,
      orderAccessDenied: Boolean(metrics.orderAccessDenied),
    },
    evidence: diagnosisEvidence || getSnapshotEvidence(snapshot, metrics),
    issues: diagnosisIssues || getSnapshotIssues(snapshot, metrics),
    recommendedActions: diagnosisRecommendations || getSnapshotRecommendedActions(snapshot, metrics),
    actionHistory: storedActions,
    resolvedAt: resolvedAction?.appliedAt || null,
  };
}

function formatStoredProductAction(action) {
  return {
    id: action.id,
    actionId: action.actionType,
    label: action.label,
    status: action.status,
    payload: action.payload || {},
    createdAt: toIso(action.createdAt),
    appliedAt: toIso(action.appliedAt),
  };
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
    weight: `${Array.isArray(metrics.collections) ? metrics.collections.length : 0} collections, ${Array.isArray(metrics.tags) ? metrics.tags.length : 0} tags`,
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

function getSnapshotIssues(snapshot, metrics) {
  const rawSignalCount = Number(metrics.signalCount || 0);
  if (!snapshot.primaryIssue || rawSignalCount <= 0) return [];

  const signalCount = Math.max(rawSignalCount, 1);
  const topReturnReasons = Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : [];
  const affectedVariants = Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants : [];

  return [
    {
      issue: snapshot.primaryIssue,
      severity: getRiskLabel(snapshot.riskScore),
      confidence: snapshot.confidence,
      signals: signalCount,
      evidence: topReturnReasons,
      trend: Array.isArray(metrics.signalTrend) ? metrics.signalTrend : [],
    },
    {
      issue: affectedVariants.length ? `Variant concentration: ${affectedVariants.join(", ")}` : "Signal concentration needs review",
      severity: snapshot.riskScore >= 75 ? "High" : snapshot.riskScore >= 55 ? "Medium" : "Low",
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

  if (Number(metrics.refundAmount || 0) > 0) {
    actions.push({
      id: "review-refund-impact",
      label: "Review refund impact",
      type: "Workflow",
      effort: "Low",
      status: "Ready",
      payload: { refundAmount: metrics.refundAmount, refundUnits: metrics.refundUnits || 0 },
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
    payload: { productGid: snapshot.productGid, resolvedAt: new Date().toISOString() },
  };
}

function getSnapshotIssueCategory(issue) {
  const normalized = String(issue || "").toLowerCase();
  if (normalized.includes("fit") || normalized.includes("sizing") || normalized.includes("waist") || normalized.includes("small")) return "Fit & sizing";
  if (normalized.includes("zipper") || normalized.includes("defect") || normalized.includes("break")) return "Durability";
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
  return {
    id: job.id,
    name: getJobDisplayName(job.kind),
    source: job.errorMessage || job.source,
    status: job.status,
    progress: job.progress,
    updatedAt: formatJobDate(job.updatedAt),
    updatedAtIso: toIso(job.updatedAt),
    startedAt: job.startedAt,
    startedAtIso: toIso(job.startedAt),
    finishedAt: job.finishedAt,
    finishedAtIso: toIso(job.finishedAt),
    elapsedMs: getElapsedMs(job.startedAt, job.finishedAt),
  };
}

function getJobDisplayName(kind) {
  if (kind === FAST_PRODUCT_SCAN_KIND) return "Fast product scan";
  if (kind === PRODUCT_DIAGNOSIS_KIND) return "AI Product Diagnosis";
  return kind;
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

function getRiskLabel(score) {
  if (score >= 75) return "High";
  if (score >= 55) return "Medium";
  return "Low";
}

function getRiskTone(score) {
  if (score >= 75) return "critical";
  if (score >= 55) return "warning";
  return "success";
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
  const returnRate = Number(metrics.returnRate || 0);
  const refundRate = Number(metrics.refundRate || 0);
  return [
    12,
    Math.min(88, 18 + returnRate * 2),
    Math.min(96, 24 + refundRate * 2.4),
    Math.min(92, 20 + Number(metrics.recentSignalUnits || 0) * 8),
    Math.min(84, 18 + Number(metrics.signalCount || 0) * 2),
    30,
    18,
  ];
}

function getSignalDetails(snapshot, metrics) {
  const signalCount = Number(metrics.signalCount || 0);
  const returnRate = Number(metrics.returnRate || 0);
  const refundRate = Number(metrics.refundRate || 0);
  const refundAmount = Number(metrics.refundAmount || 0);
  const recentSignalUnits = Number(metrics.recentSignalUnits || 0);
  const topReturnReasons = Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : [];
  const affectedVariants = Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants : [];
  const bars = getSignalBars(metrics);

  return {
    summary: `${snapshot.primaryIssue || "Product quality"} risk score ${snapshot.riskScore}/100 from ${signalCount} signal${signalCount === 1 ? "" : "s"}.`,
    bars: [
      {
        label: "Baseline",
        value: bars[0],
        detail: "Minimum Shopify catalog context for this product.",
      },
      {
        label: "Return rate",
        value: bars[1],
        detail: `${returnRate}% return rate in the current scan window.`,
      },
      {
        label: "Refund rate",
        value: bars[2],
        detail: `${refundRate}% refund rate and ${formatMoney(refundAmount)} refunded.`,
      },
      {
        label: "Recent spike",
        value: bars[3],
        detail: `${recentSignalUnits} recent signal units detected.`,
      },
      {
        label: "Signal volume",
        value: bars[4],
        detail: `${signalCount} total signals counted for this product.`,
      },
      {
        label: "Repeated reasons",
        value: bars[5],
        detail: topReturnReasons.length ? topReturnReasons.join(", ") : "No repeated return reason captured yet.",
      },
      {
        label: "Variant concentration",
        value: bars[6],
        detail: affectedVariants.length ? affectedVariants.join(", ") : "No affected variant concentration detected.",
      },
    ],
  };
}

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0));
}
