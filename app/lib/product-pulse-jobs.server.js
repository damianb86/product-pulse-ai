import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import {
  getQuickScanWindowDays,
  runShopifyQuickScan,
} from "./product-pulse-quick-scan.server";

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
    return {
      status: "success",
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

  return {
    status: "success",
    message: "QuickScan started. ProductPulse is checking native Shopify product, order, refund and return signals.",
    job: formatJob(job),
  };
}

export async function getProductsQueueForShop(shop) {
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

  return {
    rows: snapshots.map(formatProductRow),
    total: snapshots.length,
    activeScanJob: activeJob ? formatJob(activeJob) : null,
    scanWindowLabel: "QuickScan uses the available Shopify order window: 60 days by default, 90 days when read_all_orders is granted.",
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

export async function getProductSnapshotForShop(shop, productId) {
  const snapshot = await prisma.productRiskSnapshot.findFirst({
    where: {
      shop,
      OR: [
        { handle: productId },
        { productGid: productId },
      ],
    },
  });

  return snapshot ? formatSnapshotForDiagnosis(snapshot) : null;
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
      const admin = options.admin || await getOfflineAdmin(job.shop);
      const scopes = options.scopes || options.session?.scope || admin.productPulseScopes || "";
      await runShopifyQuickScan({
        shop: job.shop,
        admin,
        jobId: job.id,
        scopes,
      });
    } catch (error) {
      await markJobFailed(job.id, error);
    } finally {
      activeWorkers.delete(job.id);
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
    issue: snapshot.primaryIssue,
    sources: sources.slice(0, 3).map(getSourceIcon),
    sourceOverflow: Math.max(0, sources.length - 3),
    lastAnalysis: formatJobDate(snapshot.updatedAt),
    credits: 1,
    href: `/app/products/${snapshot.handle}`,
  };
}

function formatSnapshotForDiagnosis(snapshot) {
  const metrics = snapshot.metrics || {};
  const topReturnReasons = Array.isArray(metrics.topReturnReasons) ? metrics.topReturnReasons : [];
  const affectedVariants = Array.isArray(metrics.affectedVariants) ? metrics.affectedVariants : [];

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
    lastAnalysis: snapshot.updatedAt,
    primaryIssue: snapshot.primaryIssue,
    metrics: {
      returnRate: metrics.returnRate || 0,
      refundRate: metrics.refundRate || 0,
      reviewRating: 0,
      issueCount: metrics.signalCount || 0,
      revenueAtRisk: metrics.revenueAtRisk || metrics.refundAmount || 0,
      marginAtRisk: metrics.marginAtRisk || 0,
      signalCount: metrics.signalCount || 0,
    },
    evidence: [
      {
        source: "Returns",
        quote: topReturnReasons.length ? topReturnReasons.join(", ") : "No repeated return reason captured",
        weight: `${metrics.returnUnits || 0} return units in ${metrics.windowDays || 60} days`,
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
    ],
    recommendedActions: [
      { id: "review-return-reasons", label: "Review return reasons", type: "Workflow", effort: "Low", status: "Ready" },
      { id: "run-ai-diagnosis", label: "Run AI Product Diagnosis", type: "Diagnosis", effort: "Low", status: "Ready" },
    ],
  };
}

function formatJob(job) {
  return {
    id: job.id,
    name: job.kind === FAST_PRODUCT_SCAN_KIND ? "Fast product scan" : job.kind,
    source: job.errorMessage || job.source,
    status: job.status,
    progress: job.progress,
    updatedAt: formatJobDate(job.updatedAt),
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
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

function getSourceIcon(source) {
  const normalized = String(source || "").toLowerCase();
  if (normalized.includes("review") || normalized.includes("judge") || normalized.includes("csv")) return "star";
  if (normalized.includes("return") || normalized.includes("refund")) return "return";
  if (normalized.includes("support") || normalized.includes("chat")) return "chat";
  return "globe";
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

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0));
}
