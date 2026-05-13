import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  getQuickScanWindowDays,
  runShopifyQuickScan,
} from "./product-pulse-quick-scan.server";
import {
  getJobLogsForShop,
  recordJobLog,
  serializeError,
} from "./product-pulse-job-logs.server";

const FAST_PRODUCT_SCAN_KIND = "fast-product-scan";
const STALE_JOB_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const activeWorkers = global.productPulseJobWorkers || new Set();

if (!global.productPulseJobWorkers) {
  global.productPulseJobWorkers = activeWorkers;
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

export async function getProductsQueueForShop(shop, admin) {
  await failStaleFastProductScans(shop);
  const [snapshots, activeJob] = await Promise.all([
    prisma.productRiskSnapshot.findMany({
      where: { shop },
      orderBy: [{ riskScore: "desc" }, { updatedAt: "desc" }],
      take: 50,
    }),
    getActiveFastProductScan(shop),
  ]);

  if (activeJob) ensureFastProductScanWorker(activeJob);
  const rows = snapshots.map(formatProductRow);
  const rowsWithImages = await attachProductImages(rows, admin);

  return {
    rows: rowsWithImages,
    total: snapshots.length,
    activeScanJob: activeJob ? formatJob(activeJob) : null,
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

  const actions = await prisma.productAction.findMany({
    where: { shop, productGid: snapshot.productGid },
    orderBy: [{ createdAt: "desc" }],
    take: 20,
  });
  const product = formatSnapshotForDiagnosis(snapshot, actions);
  return attachProductImageToDiagnosis(product, admin);
}

export async function rerunProductDiagnosisForShop(shop, productId) {
  const snapshot = await findProductRiskSnapshot(shop, productId);
  if (!snapshot) return null;

  const metrics = snapshot.metrics || {};
  const recommendations = getSnapshotRecommendedActions(snapshot, metrics);
  const evidence = getSnapshotEvidence(snapshot, metrics);
  const diagnosis = await prisma.productDiagnosis.create({
    data: {
      shop,
      productGid: snapshot.productGid,
      productTitle: snapshot.productTitle,
      status: "Completed",
      riskScore: snapshot.riskScore,
      confidence: snapshot.confidence,
      likelyCause: snapshot.primaryIssue,
      issues: getSnapshotIssues(snapshot, metrics),
      evidence,
      recommendations,
      creditsConsumed: 1,
      completedAt: new Date(),
    },
  });

  await prisma.productAction.create({
    data: {
      shop,
      diagnosisId: diagnosis.id,
      productGid: snapshot.productGid,
      actionType: "run-ai-diagnosis",
      label: "Run AI Product Diagnosis",
      status: "applied",
      payload: { diagnosisId: diagnosis.id, riskScore: snapshot.riskScore, confidence: snapshot.confidence },
      appliedAt: new Date(),
    },
  });

  return {
    status: "success",
    message: `AI Product Diagnosis completed for ${snapshot.productTitle}. One credit was consumed.`,
    diagnosisId: diagnosis.id,
  };
}

export async function recordProductDetailActionForShop(shop, productId, actionId) {
  const snapshot = await findProductRiskSnapshot(shop, productId);
  if (!snapshot) return null;

  const metrics = snapshot.metrics || {};
  const action = actionId === "mark-resolved"
    ? getResolvedAction(snapshot)
    : getSnapshotRecommendedActions(snapshot, metrics).find((item) => item.id === actionId);

  if (!action) {
    return { status: "validation_error", message: "Recommended action was not found." };
  }

  const status = action.id === "mark-resolved" || action.applyImmediately ? "applied" : "draft";
  await prisma.productAction.create({
    data: {
      shop,
      productGid: snapshot.productGid,
      actionType: action.id,
      label: action.label,
      status,
      payload: action.payload || {},
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

async function getOfflineAdmin(shop) {
  const { admin, session } = await unauthenticated.admin(shop);
  return Object.assign(admin, { productPulseScopes: session.scope });
}

async function markJobFailed(jobId, error) {
  await prisma.catalogSignalJob.updateMany({
    where: {
      id: jobId,
      status: { in: ["Queued", "Running"] },
    },
    data: {
      status: "Failed",
      progress: 100,
      source: "QuickScan failed",
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

function formatSnapshotForDiagnosis(snapshot, actions = []) {
  const metrics = snapshot.metrics || {};
  const storedActions = actions.map(formatStoredProductAction);
  const resolvedAction = storedActions.find((action) => action.actionId === "mark-resolved" && action.status === "applied");

  return {
    id: snapshot.productGid,
    slug: snapshot.handle,
    title: snapshot.productTitle,
    handle: snapshot.handle,
    collection: metrics.collections?.[0] || metrics.productType || "Shopify catalog",
    status: "Active",
    riskScore: snapshot.riskScore,
    impactScore: snapshot.impactScore,
    confidence: snapshot.confidence,
    riskTone: getRiskTone(snapshot.riskScore),
    riskLabel: getRiskLabel(snapshot.riskScore),
    creditCost: 1,
    sourceCoverage: Array.isArray(snapshot.sourceCoverage) ? snapshot.sourceCoverage : ["Shopify products"],
    lastAnalysis: toIso(snapshot.updatedAt),
    primaryIssue: snapshot.primaryIssue,
    metrics: {
      returnRate: metrics.returnRate || 0,
      refundRate: metrics.refundRate || 0,
      reviewRating: 0,
      issueCount: metrics.signalCount || 0,
      revenueAtRisk: metrics.revenueAtRisk || metrics.refundAmount || 0,
      marginAtRisk: metrics.marginAtRisk || 0,
      signalCount: metrics.signalCount || 0,
      refundAmount: metrics.refundAmount || 0,
      returnUnits: metrics.returnUnits || 0,
      refundUnits: metrics.refundUnits || 0,
      recentSignalUnits: metrics.recentSignalUnits || 0,
      windowDays: metrics.windowDays || 60,
      topReturnReasons: Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : [],
      affectedVariants: Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants : [],
    },
    evidence: getSnapshotEvidence(snapshot, metrics),
    recommendedActions: getSnapshotRecommendedActions(snapshot, metrics),
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

function getSnapshotEvidence(snapshot, metrics) {
  const topReturnReasons = Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : [];
  const affectedVariants = Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants : [];
  const windowDays = metrics.windowDays || 60;

  return [
    {
      source: "Returns",
      quote: topReturnReasons.length ? topReturnReasons.join(", ") : "No repeated return reason captured",
      weight: `${metrics.returnUnits || 0} return units in ${windowDays} days`,
    },
    {
      source: "Refunds",
      quote: `${formatMoney(metrics.refundAmount || 0)} refunded`,
      weight: `${metrics.refundUnits || 0} refunded units`,
    },
    {
      source: "Variants",
      quote: affectedVariants.length ? affectedVariants.join(", ") : "No variant concentration detected",
      weight: `${metrics.recentSignalUnits || 0} recent signal units`,
    },
  ];
}

function getSnapshotIssues(snapshot, metrics) {
  const signalCount = Math.max(Number(metrics.signalCount || 0), 1);
  const topReturnReasons = Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : [];
  const affectedVariants = Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants : [];

  return [
    {
      issue: snapshot.primaryIssue,
      severity: getRiskLabel(snapshot.riskScore),
      confidence: snapshot.confidence,
      signals: signalCount,
      evidence: topReturnReasons,
    },
    {
      issue: affectedVariants.length ? `Variant concentration: ${affectedVariants.join(", ")}` : "Signal concentration needs review",
      severity: snapshot.riskScore >= 75 ? "High" : snapshot.riskScore >= 55 ? "Medium" : "Low",
      confidence: Math.max(snapshot.confidence - 9, 35),
      signals: Math.max(Math.round(signalCount * 0.62), 1),
      evidence: affectedVariants,
    },
  ];
}

function getSnapshotRecommendedActions(snapshot, metrics) {
  const issueCategory = getSnapshotIssueCategory(snapshot.primaryIssue);
  const topReturnReasons = Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : [];
  const affectedVariants = Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants : [];
  const issueTag = getIssueTag(issueCategory);
  const reasonText = topReturnReasons.length ? topReturnReasons.join(", ") : snapshot.primaryIssue;
  const variantText = affectedVariants.length ? affectedVariants.join(", ") : "affected variants";

  return [
    {
      id: "draft-pdp-copy",
      label: getPdpCopyActionLabel(issueCategory),
      type: "PDP copy",
      effort: "Low",
      status: "Draft",
      payload: {
        draftText: `ProductPulse detected ${reasonText}. Add shopper-facing guidance that clarifies ${issueCategory.toLowerCase()} expectations for ${snapshot.productTitle}.`,
      },
    },
    {
      id: "add-product-tag",
      label: `Apply "${issueTag}" product tag`,
      type: "Shopify tag",
      effort: "Low",
      status: "Ready",
      applyImmediately: true,
      payload: { tag: issueTag },
    },
    {
      id: "copy-support-note",
      label: "Share internal note with support team",
      type: "Internal note",
      effort: "Low",
      status: "Ready",
      payload: {
        note: `${snapshot.productTitle}: ${snapshot.primaryIssue}. Mention ${reasonText}; watch ${variantText}.`,
      },
    },
    {
      id: "review-return-reasons",
      label: "Review return reasons",
      type: "Workflow",
      effort: "Low",
      status: "Ready",
      payload: { topReturnReasons, affectedVariants },
    },
    {
      id: "run-ai-diagnosis",
      label: "Run AI Product Diagnosis",
      type: "Diagnosis",
      effort: "Low",
      status: "Ready",
      applyImmediately: true,
      payload: { creditCost: 1 },
    },
  ];
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

function getIssueTag(issueCategory) {
  if (issueCategory === "Fit & sizing") return "ProductPulse: fit risk";
  if (issueCategory === "Durability") return "ProductPulse: durability risk";
  if (issueCategory === "Compatibility") return "ProductPulse: compatibility risk";
  return "ProductPulse: quality risk";
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
    name: job.kind === FAST_PRODUCT_SCAN_KIND ? "Fast product scan" : job.kind,
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
