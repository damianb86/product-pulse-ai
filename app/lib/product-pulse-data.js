import {
  calculateCoverageScore,
  calculateImpactScore,
  calculateRiskScore,
  getCoverageState,
  getRiskLabel,
  getRiskTone,
  validateCreditBalance,
} from "./product-pulse-scoring";
import { REQUIRED_SHOPIFY_SCOPES } from "./product-pulse-scopes";
import { validateProductAction } from "./product-pulse-validation";
import { filterDisabledProductActions } from "./product-pulse-disabled-actions";

const ANALYTICS_DAY_MS = 86_400_000;

export const sourceGroups = [
  {
    category: "Product data",
    description: "Catalog context, variants, tags, collections and PDP copy.",
    sources: [
      {
        key: "shopifyProducts",
        name: "Shopify products and variants",
        connected: true,
        required: true,
        weight: 18,
        contribution: "Product titles, handles, variants, tags and collection context.",
        missing: "Required for every diagnosis.",
      },
    ],
  },
  {
    category: "Returns & Refunds",
    description: "Deterministic post-purchase quality signals.",
    sources: [
      {
        key: "shopifyOrders",
        name: "Shopify orders and refunds",
        connected: true,
        required: true,
        weight: 18,
        contribution: "Refund rate, refund value and order volume by product.",
        missing: "Grant read_orders to calculate product-level refund impact.",
      },
      {
        key: "shopifyReturns",
        name: "Shopify returns and return reasons",
        connected: true,
        required: true,
        weight: 18,
        contribution: "Return rate, reason clusters and fit/quality signal weight.",
        missing: "Grant read_returns to read return reasons.",
      },
    ],
  },
  {
    category: "Reviews",
    description: "Customer language and repeated quality complaints.",
    sources: [
      {
        key: "judgemeReviews",
        name: "Judge.me reviews",
        connected: true,
        required: false,
        weight: 14,
        contribution: "Review rating, review text and recurring complaint phrases.",
        missing: "Connect Judge.me to improve evidence quality.",
      },
      {
        key: "chatmeReviews",
        name: "ChatMe reviews",
        connected: false,
        required: false,
        weight: 10,
        contribution: "Short-form review snippets and buyer sentiment.",
        missing: "Connect ChatMe when available.",
      },
      {
        key: "csvReviews",
        name: "CSV reviews",
        connected: true,
        required: false,
        weight: 8,
        contribution: "Imported review exports from any provider.",
        missing: "Upload a CSV with product handle, rating and review body.",
      },
    ],
  },
  {
    category: "Chat & Support",
    description: "Tickets and support notes for product-specific confusion.",
    sources: [
      {
        key: "supportTickets",
        name: "Gorgias or Zendesk",
        connected: false,
        required: false,
        weight: 8,
        contribution: "Pre-sale and post-sale ticket themes by product.",
        missing: "Future connector.",
      },
    ],
  },
  {
    category: "PDP Q&A",
    description: "Questions shoppers ask before buying.",
    sources: [
      {
        key: "pdpQuestions",
        name: "ProductPulse Q&A Block",
        connected: false,
        required: false,
        weight: 6,
        contribution: "Purchase blockers and FAQ opportunities.",
        missing: "Future theme app extension.",
      },
    ],
  },
];

const rawProducts = [
  {
    id: "gid://shopify/Product/1001",
    slug: "core-linen-trouser",
    title: "Core Linen Trouser",
    handle: "core-linen-trouser",
    collection: "Summer capsule",
    status: "Active",
    metrics: {
      returnRate: 22,
      refundRate: 9,
      reviewRating: 3.2,
      issueCount: 5,
      soldUnits: 180,
      returnUnits: 40,
      refundUnits: 16,
      refundAmount: 4800,
      reviewCount: 120,
      negativeReviewCount: 18,
      revenueAtRisk: 24700,
      marginAtRisk: 9200,
      signalCount: 42,
      signalTrend: [28, 34, 39, 44, 57, 72, 86],
      riskTrend: [36, 41, 48, 55, 67, 79, 88],
      latestDiagnosisId: "analysis-1001",
      lastDetailedDiagnosisAt: "2026-05-10T18:10:00.000Z",
    },
    analysisDepth: "full",
    analysisLabel: "Full diagnosis",
    analysisDetail: "Deep AI product diagnosis completed from Shopify signals and connected review data.",
    sourceCoverage: ["Returns", "Refunds", "Judge.me", "CSV"],
    lastAnalysis: "2026-05-10",
    primaryIssue: "Fit runs small around waist and inseam",
    evidence: [
      { source: "Returns", quote: "Too tight in waist", weight: "18 returns in 30 days" },
      { source: "Reviews", quote: "Sizing is smaller than the size chart", weight: "11 review mentions" },
      { source: "Refunds", quote: "Refund amount spiked after variant restock", weight: "$4.8k refunded" },
    ],
    recommendedActions: [
      {
        id: "fit-note",
        label: "Add fit note",
        type: "PDP copy",
        effort: "Low",
        status: "Draft",
        payload: {
          draftText: "Fit note: customers report this trouser runs small around the waist and inseam. If you are between sizes or prefer a relaxed fit, consider sizing up.",
          issue: "fit_sizing",
        },
      },
      {
        id: "faq-sizing",
        label: "Add sizing FAQ",
        type: "FAQ",
        effort: "Low",
        status: "Ready",
        payload: {
          draftText: "How does this trouser fit?\nThis trouser has a closer fit around the waist and inseam. Customers between sizes should consider sizing up for a more comfortable fit.",
          issue: "fit_sizing",
        },
      },
      {
        id: "tag-fit-risk",
        label: "Tag product as fit-risk",
        type: "Shopify tag",
        effort: "Low",
        status: "Ready",
        payload: { tag: "fit_issue" },
      },
    ],
  },
  {
    id: "gid://shopify/Product/1002",
    slug: "trail-run-vest",
    title: "Trail Run Vest",
    handle: "trail-run-vest",
    collection: "Performance",
    status: "Active",
    metrics: {
      returnRate: 15,
      refundRate: 13,
      reviewRating: 3.6,
      issueCount: 4,
      soldUnits: 142,
      returnUnits: 21,
      refundUnits: 18,
      refundAmount: 3900,
      reviewCount: 86,
      negativeReviewCount: 13,
      revenueAtRisk: 18200,
      marginAtRisk: 6800,
      signalCount: 31,
      signalTrend: [44, 50, 47, 61, 70, 63, 78],
      riskTrend: [48, 53, 51, 61, 70, 68, 78],
      latestDiagnosisId: "analysis-1002",
      lastDetailedDiagnosisAt: "2026-05-09T17:20:00.000Z",
    },
    analysisDepth: "full",
    analysisLabel: "Full diagnosis",
    analysisDetail: "Deep AI product diagnosis completed from Shopify signals and connected review data.",
    sourceCoverage: ["Returns", "Refunds", "Judge.me"],
    lastAnalysis: "2026-05-09",
    primaryIssue: "Zipper failures after first use",
    evidence: [
      { source: "Reviews", quote: "Zipper split during the first run", weight: "8 review mentions" },
      { source: "Refunds", quote: "Defective item refund reason", weight: "12 refunds" },
      { source: "Support", quote: "Replacement requests cluster on size M", weight: "Future connector" },
    ],
    recommendedActions: [
      {
        id: "support-note",
        label: "Create support note",
        type: "Internal note",
        effort: "Low",
        status: "Ready",
        payload: {
          note: "Trail Run Vest: customers are reporting zipper failures after first use, especially around size M. Offer replacement guidance and flag repeated cases for product QA.",
        },
      },
      {
        id: "qa-tag",
        label: "Tag for QA follow-up",
        type: "Shopify tag",
        effort: "Low",
        status: "Draft",
        payload: { tag: "qa_follow_up" },
      },
    ],
  },
  {
    id: "gid://shopify/Product/1003",
    slug: "ceramic-pour-over",
    title: "Ceramic Pour Over",
    handle: "ceramic-pour-over",
    collection: "Home",
    status: "Active",
    metrics: {
      returnRate: 8,
      refundRate: 4,
      reviewRating: 4.0,
      issueCount: 3,
      soldUnits: 96,
      returnUnits: 8,
      refundUnits: 4,
      refundAmount: 950,
      reviewCount: 52,
      negativeReviewCount: 7,
      revenueAtRisk: 9300,
      marginAtRisk: 4100,
      signalCount: 18,
      signalTrend: [18, 26, 31, 43, 38, 46, 52],
      riskTrend: [20, 28, 34, 45, 41, 48, 52],
      lastDetailedDiagnosisAt: null,
    },
    analysisDepth: "quickscan",
    analysisLabel: "QuickScan only",
    analysisDetail: "Only the fast Shopify scan has run for this product.",
    sourceCoverage: ["Reviews", "CSV", "Products"],
    lastAnalysis: "2026-05-07",
    primaryIssue: "Buyers confuse filter compatibility",
    evidence: [
      { source: "Reviews", quote: "I did not know which filters fit", weight: "9 review mentions" },
      { source: "PDP Q&A", quote: "Does this fit V60 filters?", weight: "Future source" },
    ],
    recommendedActions: [
      {
        id: "compatibility-faq",
        label: "Add compatibility FAQ",
        type: "FAQ",
        effort: "Low",
        status: "Ready",
        payload: {
          draftText: "Which filters are compatible with this pour over?\nThis pour over is designed for cone-style filters. Check the filter size before purchase to confirm it matches your brewing setup.",
        },
      },
      {
        id: "description-copy",
        label: "Clarify PDP description",
        type: "PDP copy",
        effort: "Medium",
        status: "Draft",
        payload: {
          draftText: "Clarify filter compatibility near the top of the product description so shoppers can quickly confirm whether this pour over works with their existing filters.",
        },
      },
    ],
  },
  {
    id: "gid://shopify/Product/1004",
    slug: "minimal-canvas-tote",
    title: "Minimal Canvas Tote",
    handle: "minimal-canvas-tote",
    collection: "Accessories",
    status: "Active",
    metrics: {
      returnRate: 3,
      refundRate: 1,
      reviewRating: 4.7,
      issueCount: 1,
      soldUnits: 130,
      returnUnits: 4,
      refundUnits: 1,
      refundAmount: 180,
      reviewCount: 68,
      negativeReviewCount: 1,
      revenueAtRisk: 2100,
      marginAtRisk: 900,
      signalCount: 8,
      signalTrend: [14, 12, 10, 9, 8, 7, 6],
      riskTrend: [18, 16, 14, 13, 12, 10, 9],
      lastDetailedDiagnosisAt: null,
    },
    analysisDepth: "quickscan",
    analysisLabel: "QuickScan only",
    analysisDetail: "Only the fast Shopify scan has run for this product.",
    sourceCoverage: ["Products", "Reviews"],
    lastAnalysis: "Not analyzed",
    primaryIssue: "Low-risk monitoring only",
    evidence: [
      { source: "Reviews", quote: "Accurate color and sturdy fabric", weight: "Positive trend" },
    ],
    recommendedActions: [
      { id: "monitor", label: "Keep monitoring", type: "Workflow", effort: "None", status: "Ready" },
    ],
  },
];

export const products = rawProducts
  .map((product) => {
    const riskScore = calculateRiskScore(product.metrics);
    const impactScore = calculateImpactScore(product.metrics);
    return {
      ...product,
      riskScore,
      impactScore,
      riskTone: getRiskTone(riskScore),
      riskLabel: getRiskLabel(riskScore),
      confidence: Math.min(94, 58 + product.sourceCoverage.length * 8 + product.metrics.issueCount * 2),
      creditCost: 1,
    };
  })
  .sort((a, b) => b.riskScore - a.riskScore);

export function buildDashboardViewData(productItems = products, options = {}) {
  const productList = (Array.isArray(productItems) ? productItems : []).filter(Boolean);
  const totalProducts = productList.length;
  const catalogProductCount = Math.max(Number(options.catalogProductCount || 0), totalProducts);
  const highRiskProducts = productList.filter((product) => Number(product.riskScore || 0) >= 75);
  const mediumRiskProducts = productList.filter((product) => Number(product.riskScore || 0) >= 55 && Number(product.riskScore || 0) < 75);
  const needingAttention = productList.filter((product) => Number(product.riskScore || 0) >= 55);
  const fullDiagnoses = productList.filter((product) => product.analysisDepth === "full" || product.metrics?.latestDiagnosisId);
  const quickScanOnly = productList.filter((product) => product.analysisDepth === "quickscan" && !product.metrics?.latestDiagnosisId);
  const totalMarginAtRisk = sumDashboardMetric(productList, "marginAtRisk");
  const totalRevenueAtRisk = sumDashboardMetric(productList, "revenueAtRisk");
  const totalSignals = sumDashboardMetric(productList, "signalCount");
  const totalReturns = sumDashboardMetric(productList, "returnUnits");
  const totalRefunds = sumDashboardMetric(productList, "refundUnits");
  const totalNegativeReviews = sumDashboardMetric(productList, "negativeReviewCount");
  const actionRows = buildDashboardActionRows(productList);
  const pendingActions = actionRows.filter((action) => action.status === "pending");
  const primaryOrSecondaryPendingActions = pendingActions.filter(isDashboardImportantAction);
  const importantPendingActions = primaryOrSecondaryPendingActions.length
    ? primaryOrSecondaryPendingActions
    : pendingActions.filter((action) => action.actionTier === 3);
  const appliedActionIds = new Set(actionRows.filter((action) => action.status === "applied").map((action) => `${action.product?.id || action.productTitle}:${action.id}`));
  const reviewedActionIds = new Set(actionRows.filter((action) => action.status === "reviewed").map((action) => `${action.product?.id || action.productTitle}:${action.id}`));
  const appliedActionCount = appliedActionIds.size;
  const reviewedActionCount = reviewedActionIds.size;
  const resolvedProducts = productList.filter((product) => product.resolvedAt).length;
  const startProduct = getDashboardStartProduct(productList, { pendingActions: importantPendingActions });
  const priorityProducts = buildDashboardPriorityProducts(productList, importantPendingActions);
  const actionQueue = buildDashboardActionQueue(pendingActions);
  const topActiveIssues = buildDashboardTopActiveIssues(productList);
  const coverageSummary = buildDashboardCoverageSummary(productList, {
    fullDiagnoses,
    quickScanOnly,
    totalProducts,
    catalogProductCount,
    settings: options.settings,
  });
  const suggestedFixes = buildDashboardSuggestedFixes(productList);
  const watchlistProducts = highRiskProducts.length ? highRiskProducts : mediumRiskProducts;

  return {
    generatedAt: new Date().toISOString(),
    hasProducts: totalProducts > 0,
    kpis: [
      {
        label: "Products needing attention",
        value: formatDashboardNumber(needingAttention.length),
        detail: `${formatDashboardNumber(watchlistProducts.length)} watchlist / ${formatDashboardNumber(totalProducts)} scanned`,
        icon: "product",
        tone: "blue",
      },
      {
        label: "Pending recommended actions",
        value: formatDashboardNumber(pendingActions.length),
        detail: actionQueue.detail,
        icon: "wand",
        tone: pendingActions.length ? "purple" : "green",
      },
      {
        label: "Margin at risk",
        value: formatDashboardMoney(totalMarginAtRisk),
        detail: `${formatDashboardMoney(totalRevenueAtRisk)} revenue at risk`,
        icon: "cash-dollar",
        tone: totalMarginAtRisk > 0 ? "green" : "blue",
      },
      {
        label: "Issues resolved / Risk reduced",
        value: formatDashboardNumber(resolvedProducts + appliedActionCount),
        detail: `${formatDashboardNumber(resolvedProducts)} products resolved, ${formatDashboardNumber(appliedActionCount)} actions applied`,
        icon: "check",
        tone: resolvedProducts + appliedActionCount ? "green" : "blue",
      },
    ],
    totals: {
      totalProducts,
      catalogProductCount,
      needingAttention: needingAttention.length,
      highRiskProducts: highRiskProducts.length,
      mediumRiskProducts: mediumRiskProducts.length,
      fullDiagnoses: fullDiagnoses.length,
      quickScanOnly: quickScanOnly.length,
      totalMarginAtRisk,
      totalRevenueAtRisk,
      totalSignals,
      totalReturns,
      totalRefunds,
      totalNegativeReviews,
      pendingActions: pendingActions.length,
      appliedActions: appliedActionCount,
      reviewedActions: reviewedActionCount,
      importantPendingActions: importantPendingActions.length,
      resolvedProducts,
      creditsAvailable: options.billing?.creditsAvailable ?? billing.creditsAvailable,
    },
    startProduct,
    suggestedFixes,
    priorityProducts,
    actionQueue,
    topActiveIssues,
    coverageSummary,
  };
}

function getDashboardStartProduct(productList, { pendingActions = [] } = {}) {
  const maxMarginRisk = Math.max(...productList.map((product) => getDashboardMetric(product, "marginAtRisk")), 0);
  const pendingAction = [...pendingActions]
    .filter((action) => hasDashboardFullDiagnosis(action.product))
    .sort(compareDashboardActionPriority)[0] || null;
  const diagnosisCandidates = productList.filter((product) => !hasDashboardFullDiagnosis(product));
  const recheckCandidates = productList.filter((product) => product.resolvedAt || (Array.isArray(product.actionHistory) && product.actionHistory.some((action) => action.status === "applied")));
  const fallbackPool = diagnosisCandidates.length ? diagnosisCandidates : recheckCandidates.length ? recheckCandidates : productList;
  const product = pendingAction?.product || [...fallbackPool].sort((first, second) => (
    getDashboardProductImportanceScore(second, { maxMarginRisk })
      - getDashboardProductImportanceScore(first, { maxMarginRisk })
  ))[0];

  if (!product) return null;
  const metrics = product.metrics || {};
  const hasFullDiagnosis = hasDashboardFullDiagnosis(product);
  const activeDiagnosis = getDashboardActiveDiagnosis(product);
  const returnRate = clampDashboardRate(metrics.returnRate);
  const refundRate = clampDashboardRate(metrics.refundRate);
  const negativeReviews = Number(metrics.negativeReviewCount || 0);
  const mainIssue = getDashboardIssueLabel(product.primaryIssue || metrics.mainIssue || "Product quality");
  const priorityScore = pendingAction?.priorityScore || getDashboardProductImportanceScore(product, { maxMarginRisk });
  const actionMode = pendingAction
    ? "pending-action"
    : !hasFullDiagnosis
      ? "next-diagnosis"
      : recheckCandidates.includes(product)
        ? "recheck"
        : "analyze-more";
  const actionTitle = getDashboardStartActionTitle({ product, action: pendingAction, actionMode });
  const ctaKind = actionMode === "pending-action" || actionMode === "analyze-more" ? "link" : actionMode === "recheck" ? "recheck" : "diagnose";

  return {
    title: product.title || product.productTitle || "Product",
    handle: product.handle || product.slug || "",
    productId: product.productGid || product.id || product.handle || product.slug || "",
    href: `/app/products/${product.handle || product.slug || product.id}`,
    variant: getDashboardProductVariant(product),
    imageUrl: product.imageUrl || null,
    imageAlt: product.imageAlt || null,
    riskLabel: getRiskLabel(Number(product.riskScore || 0)),
    riskTone: getRiskTone(Number(product.riskScore || 0)),
    riskScore: Number(product.riskScore || 0),
    issueLabel: mainIssue,
    priorityScore,
    selectionMode: actionMode,
    actionTitle,
    priorityReason: buildDashboardPriorityReason(product, { hasFullDiagnosis, priorityScore, actionMode }),
    eyebrow: getDashboardStartEyebrow(actionMode),
    summary: buildDashboardStartSummary({ product, mainIssue, returnRate, refundRate, negativeReviews, hasFullDiagnosis, actionMode, action: pendingAction }),
    whySummary: buildDashboardWhySummary({ product, mainIssue, pendingAction }),
    whyMetrics: buildDashboardWhyMetrics({ product, returnRate, refundRate, negativeReviews }),
    actionLabel: getDashboardStartCtaLabel(actionMode),
    actionHint: getDashboardStartCtaHint(actionMode),
    ctaKind,
    ctaIcon: actionMode === "pending-action" ? getDashboardActionIcon(pendingAction) : actionMode === "analyze-more" ? "product" : "wand",
    ctaHref: actionMode === "analyze-more" ? "/app/products" : `/app/products/${product.handle || product.slug || product.id}`,
    diagnosisJob: activeDiagnosis,
    diagnosisInProgress: Boolean(activeDiagnosis),
    badges: [
      {
        tone: Number(product.riskScore || 0) >= 75 ? "critical" : Number(product.riskScore || 0) >= 55 ? "warning" : "success",
        icon: Number(product.riskScore || 0) >= 75 ? "alert-circle" : "shield-check-mark",
        label: getRiskLabel(Number(product.riskScore || 0)),
      },
      {
        tone: hasFullDiagnosis ? "success" : "info",
        icon: hasFullDiagnosis ? "wand" : "search",
        label: hasFullDiagnosis ? "Full diagnosis" : "QuickScan only",
      },
      {
        tone: "warning",
        icon: "target",
        label: mainIssue,
      },
    ],
    metrics: {
      returnRate,
      soldUnits: Number(metrics.soldUnits || 0),
      refundRate,
      returnUnits: Number(metrics.returnUnits || 0),
      refundUnits: Number(metrics.refundUnits || 0),
      negativeReviewCount: negativeReviews,
      reviewCount: Number(metrics.reviewCount || 0),
      signalCount: Number(metrics.signalCount || metrics.issueCount || 0),
      marginAtRisk: getDashboardMetric(product, "marginAtRisk"),
      revenueAtRisk: getDashboardMetric(product, "revenueAtRisk"),
      recentSignalUnits: Number(metrics.recentSignalUnits || 0),
      windowDays: Number(metrics.windowDays || 60),
    },
  };
}

function getDashboardStartActionTitle({ product, action, actionMode }) {
  if (actionMode === "pending-action") return action?.label || "Review recommended fix";
  if (actionMode === "next-diagnosis") return "Run full product diagnosis";
  if (actionMode === "recheck") return "Re-check product";
  return product ? "Analyze more products" : "Run QuickScan";
}

function getDashboardStartEyebrow(actionMode) {
  if (actionMode === "pending-action") return "Recommended fix waiting for review";
  if (actionMode === "next-diagnosis") return "Highest-priority QuickScan candidate";
  if (actionMode === "recheck") return "Previously changed product";
  return "No urgent product action";
}

function getDashboardStartCtaLabel(actionMode) {
  if (actionMode === "pending-action") return "Review recommended fix";
  if (actionMode === "next-diagnosis") return "Run full diagnosis";
  if (actionMode === "recheck") return "Re-check product";
  return "Analyze more products";
}

function getDashboardStartCtaHint(actionMode) {
  if (actionMode === "pending-action") return "Open the product diagnosis and review the recommended action.";
  if (actionMode === "next-diagnosis") return "Queue a full AI diagnosis for the highest-priority QuickScan product.";
  if (actionMode === "recheck") return "Run diagnostics again after applied changes or resolution.";
  return "Open Products to find or scan the next product.";
}

function buildDashboardWhyMetrics({ product, returnRate, refundRate, negativeReviews }) {
  const metrics = product.metrics || {};
  const rows = [];
  if (returnRate > 0) {
    rows.push({
      label: getDashboardReturnRateLabel(returnRate, metrics),
      value: formatDashboardReturnRate(returnRate, metrics),
      tone: returnRate >= 15 ? "critical" : "warning",
    });
  }
  if (negativeReviews > 0) rows.push({ label: "negative reviews", value: formatDashboardNumber(negativeReviews), tone: "critical" });
  if (refundRate > 0) rows.push({ label: "refund rate", value: formatDashboardRate(refundRate), tone: refundRate >= 10 ? "critical" : "warning" });
  rows.push({ label: "margin at risk", value: formatDashboardMoney(getDashboardMetric(product, "marginAtRisk")), tone: getDashboardMetric(product, "marginAtRisk") > 0 ? "info" : "neutral" });
  if (Number(metrics.signalCount || metrics.issueCount || 0) > 0) rows.push({ label: "stored signals", value: formatDashboardNumber(metrics.signalCount || metrics.issueCount), tone: "neutral" });
  return rows.slice(0, 4);
}

function buildDashboardWhySummary({ product, mainIssue, pendingAction }) {
  if (pendingAction) {
    return `${pendingAction.label} is the highest-priority open action because ${product.title} still carries ${formatDashboardMoney(getDashboardMetric(product, "marginAtRisk"))} margin exposure tied to ${mainIssue.toLowerCase()}.`;
  }
  return `${product.title} is ranked by action priority: product risk, confidence, current margin exposure and evidence freshness.`;
}

function getDashboardActiveDiagnosis(product) {
  const job = product?.diagnosisJob;
  const status = String(job?.status || "").toLowerCase();
  return status === "queued" || status === "running" ? job : null;
}

function hasDashboardFullDiagnosis(product) {
  return product?.analysisDepth === "full" || Boolean(product?.metrics?.latestDiagnosisId);
}

function getDashboardPriorityScore(product, { maxMarginRisk = 0 } = {}) {
  const storedPriority = Number(product?.metrics?.priorityScore || product?.priorityScore || 0);
  if (storedPriority > 0) return Math.round(Math.min(Math.max(storedPriority, 0), 100));

  const riskScore = Number(product?.riskScore || 0);
  const confidenceScore = Number(product?.confidence || product?.metrics?.confidence || 0);
  const marginRisk = getDashboardMetric(product, "marginAtRisk");
  const maxReferenceImpact = Math.max(maxMarginRisk, 25000);
  const normalizedLogImpactScore = Math.min(100, Math.max(0, 100 * Math.log1p(Math.max(0, marginRisk)) / Math.log1p(maxReferenceImpact)));

  return Math.round(
    riskScore * 0.5
      + confidenceScore * 0.25
      + normalizedLogImpactScore * 0.25,
  );
}

function buildDashboardPriorityReason(product, { hasFullDiagnosis, priorityScore, actionMode }) {
  const metrics = product.metrics || {};
  const reasons = [
    `${getRiskLabel(Number(product.riskScore || 0)).toLowerCase()} risk`,
    `${formatDashboardMoney(getDashboardMetric(product, "marginAtRisk"))} margin at risk`,
    `${formatDashboardNumber(metrics.signalCount || metrics.issueCount || 0)} signal${Number(metrics.signalCount || metrics.issueCount || 0) === 1 ? "" : "s"}`,
  ];
  if (Number(metrics.recentSignalUnits || 0) > 0) {
    reasons.push(`${formatDashboardNumber(metrics.recentSignalUnits)} recent signal${Number(metrics.recentSignalUnits) === 1 ? "" : "s"}`);
  }

  const prefix = actionMode === "pending-action"
    ? "Next recommended action"
    : actionMode === "recheck"
      ? "Re-check candidate"
      : hasFullDiagnosis
        ? "Diagnosed product"
        : "Next full-diagnosis candidate";
  return `${prefix}: ${reasons.join(", ")}. Action priority ${priorityScore}/100.`;
}

function buildDashboardStartSummary({ product, mainIssue, returnRate, refundRate, negativeReviews, hasFullDiagnosis, actionMode, action }) {
  const metrics = product.metrics || {};
  const pieces = [];
  if (returnRate > 0) pieces.push(formatDashboardReturnRateSummary(returnRate, metrics));
  if (refundRate > 0) pieces.push(`${formatDashboardRate(refundRate)} refund rate`);
  if (negativeReviews > 0) pieces.push(`${formatDashboardNumber(negativeReviews)} negative review${negativeReviews === 1 ? "" : "s"}`);
  if (actionMode === "pending-action") {
    return `${action?.label || "The recommended action"} is ready to review for ${product.title}. ${pieces.length ? `${pieces.join(", ")} point to ${mainIssue.toLowerCase()}.` : "ProductPulse found enough evidence to recommend a customer-facing fix."}`;
  }
  if (actionMode === "recheck") {
    return `${product.title} has applied or resolved work. Re-check it to confirm risk moved down and the fix did not create new issues.`;
  }
  if (actionMode === "analyze-more") {
    return "No urgent recommended action is waiting. Open Products to scan or choose another product for diagnosis.";
  }
  if (!pieces.length) {
    return hasFullDiagnosis
      ? `${product.title} already has a full diagnosis and remains the highest-priority product to review.`
      : `${product.title} is the highest-priority product without a full diagnosis. ProductPulse has scan data ready for review.`;
  }
  return hasFullDiagnosis
    ? `${product.title} already has a full diagnosis and still ranks highest because ${pieces.join(", ")} point to ${mainIssue.toLowerCase()}.`
    : `${product.title} is the highest-priority product without a full diagnosis because ${pieces.join(", ")} point to ${mainIssue.toLowerCase()}.`;
}

function buildDashboardActionRows(productList) {
  const maxMarginRisk = Math.max(...productList.map((product) => getDashboardMetric(product, "marginAtRisk")), 0);
  return productList.flatMap((product) => {
    const actions = filterDisabledProductActions(product.recommendedActions);
    const history = filterDisabledProductActions(product.actionHistory);
    const rows = actions.map((action) => {
      const actionId = action.id || action.label || "";
      const record = getDashboardActionHistoryRecord(action, history, product);
      const status = normalizeDashboardActionStatus(record?.status || action.status);
      const actionTier = getDashboardActionTier(action);
      const priorityScore = getDashboardActionPriorityScore(product, action, { maxMarginRisk });
      return {
        id: actionId,
        label: action.label || "Review recommended action",
        type: action.type || "",
        status,
        product,
        productTitle: product.title || product.productTitle || "Product",
        href: `/app/products/${product.handle || product.slug || product.id}`,
        icon: getDashboardActionIcon(action),
        tone: getDashboardActionTone(action),
        category: getDashboardActionCategory(action),
        family: getDashboardActionFamily(action),
        actionTier,
        actionTierLabel: getDashboardActionTierLabel(actionTier),
        important: actionTier <= 2,
        priorityScore,
        marginAtRisk: getDashboardMetric(product, "marginAtRisk"),
        createdAt: record?.createdAt || action.createdAt || null,
        appliedAt: record?.appliedAt || action.appliedAt || null,
      };
    });

    const rowIds = new Set(rows.map((row) => row.id));
    const rowFamilies = new Set(rows.map((row) => row.family).filter((family) => family && family !== "other"));
    const historicalRows = history
      .filter((record) => !isSystemProductActionRecord(record))
      .filter((record) => !rowIds.has(record.actionId || record.id) || !isDashboardActionRecordCurrentForProduct(record, product))
      .filter((record) => {
        const family = getDashboardActionFamily(record);
        return !family || family === "other" || !rowFamilies.has(family) || !isDashboardActionRecordCurrentForProduct(record, product);
      })
      .map((record) => {
        const status = normalizeDashboardActionStatus(record.status);
        if (!["pending", "applied", "reviewed", "dismissed"].includes(status)) return null;
        const action = {
          id: record.actionId || record.id || record.label,
          label: record.label || "Stored product action",
          type: record.payload?.actionType || record.payload?.type || "Stored action",
          status,
          payload: record.payload || {},
        };
        const actionTier = getDashboardActionTier(action);
        const priorityScore = getDashboardActionPriorityScore(product, action, { maxMarginRisk });
        return {
          id: action.id,
          label: action.label,
          type: action.type,
          status,
          product,
          productTitle: product.title || product.productTitle || "Product",
          href: `/app/products/${product.handle || product.slug || product.id}`,
          icon: getDashboardActionIcon(action),
          tone: getDashboardActionTone(action),
          category: getDashboardActionCategory(action),
          family: getDashboardActionFamily(action),
          actionTier,
          actionTierLabel: getDashboardActionTierLabel(actionTier),
          important: actionTier <= 2,
          priorityScore,
          marginAtRisk: getDashboardMetric(product, "marginAtRisk"),
          createdAt: record.createdAt || null,
          appliedAt: record.appliedAt || null,
        };
      })
      .filter(Boolean);

    return [...rows, ...historicalRows];
  }).sort(compareDashboardActionPriority);
}

function isSystemProductActionRecord(record = {}) {
  const actionId = String(record.actionId || record.actionType || record.id || "").toLowerCase();
  return ["mark-resolved", "mark-unresolved", "ignore-issue", "unignore-issue", "run-ai-diagnosis"].includes(actionId);
}

function getDashboardActionHistoryRecord(action = {}, history = [], product = {}) {
  const currentRecords = (Array.isArray(history) ? history : [])
    .filter((record) => !isSystemProductActionRecord(record))
    .filter((record) => isDashboardActionRecordCurrentForProduct(record, product))
    .sort((first, second) => new Date(second.appliedAt || second.createdAt || 0).getTime() - new Date(first.appliedAt || first.createdAt || 0).getTime());
  const actionIdentityTokens = getDashboardActionIdentityTokens(action);
  const exactRecord = currentRecords.find((record) => {
    const recordIdentityTokens = getDashboardActionRecordIdentityTokens(record);
    return intersectsDashboardActionTokens(actionIdentityTokens, recordIdentityTokens);
  });
  if (exactRecord) return exactRecord;
  const family = getDashboardActionFamily(action);

  if (!actionIdentityTokens.size) {
    const actionLabel = normalizeDashboardActionLabel(action.label || action.title);
    const labelRecord = currentRecords.find((record) => actionLabel && normalizeDashboardActionLabel(record.label) === actionLabel);
    if (labelRecord) return labelRecord;
  }

  if (actionIdentityTokens.size && !shouldUseDashboardActionFamilyFallback(family)) return null;
  if (!family || family === "other") return null;
  if (!shouldUseDashboardActionFamilyFallback(family)) return null;

  return currentRecords.find((record) => (
    getDashboardActionFamily(record) === family
      && normalizeDashboardActionStatus(record.status) !== "pending"
  )) || null;
}

function isDashboardActionRecordCurrentForProduct(record = {}, product = {}) {
  const currentDiagnosisId = getDashboardProductCurrentDiagnosisId(product);
  const recordDiagnosisId = getDashboardActionRecordDiagnosisId(record);
  if (!currentDiagnosisId || !recordDiagnosisId) return true;
  return currentDiagnosisId === recordDiagnosisId;
}

function getDashboardProductCurrentDiagnosisId(product = {}) {
  return String(product.latestDiagnosisId || product.metrics?.latestDiagnosisId || "").trim();
}

function getDashboardActionRecordDiagnosisId(record = {}) {
  const payload = record.payload || {};
  return String(record.diagnosisId || payload.sourceDiagnosisId || payload.diagnosisId || "").trim();
}

function getDashboardActionIdentityTokens(action = {}) {
  const payload = action.payload || {};
  return new Set([
    action.id,
    action.actionId,
    action.actionType,
    payload.sourceActionId,
    payload.canonicalActionId,
    ...getDashboardPreciseActionAliases(action.actionAliases),
    ...getDashboardPreciseActionAliases(payload.actionAliases),
  ].map(normalizeDashboardActionToken).filter(Boolean));
}

function getDashboardActionRecordIdentityTokens(record = {}) {
  const payload = record.payload || {};
  return new Set([
    record.actionId,
    record.actionType,
    payload.sourceActionId,
    payload.canonicalActionId,
    ...getDashboardPreciseActionAliases(record.actionAliases),
    ...getDashboardPreciseActionAliases(payload.actionAliases),
  ].map(normalizeDashboardActionToken).filter(Boolean));
}

function intersectsDashboardActionTokens(firstTokens, secondTokens) {
  if (!(firstTokens instanceof Set) || !(secondTokens instanceof Set) || !firstTokens.size || !secondTokens.size) return false;
  for (const token of firstTokens) {
    if (secondTokens.has(token)) return true;
  }
  return false;
}

function shouldUseDashboardActionFamilyFallback(family = "") {
  return ["product-copy", "evidence-review"].includes(family);
}

const BROAD_DASHBOARD_ACTION_ALIASES = new Set([
  "product-description-changes",
  "review-product-evidence",
  "product-evidence",
  "product-faq",
  "create-product-faq",
  "title-metadata",
  "product-metadata",
  "variant-options",
  "workflow-tag",
  "media-alt-text",
  "commercial-control",
]);

function getDashboardPreciseActionAliases(aliases = []) {
  return (Array.isArray(aliases) ? aliases : [])
    .filter((alias) => !BROAD_DASHBOARD_ACTION_ALIASES.has(normalizeDashboardActionToken(alias)));
}

function normalizeDashboardActionToken(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function normalizeDashboardActionLabel(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ");
}

function normalizeDashboardActionStatus(status) {
  const normalized = String(status || "pending").toLowerCase();
  if (normalized.includes("applied")) return "applied";
  if (normalized.includes("review")) return "reviewed";
  if (normalized.includes("dismiss") || normalized.includes("ignored")) return "dismissed";
  return "pending";
}

function getDashboardActionFamily(action = {}) {
  const payload = action.payload || {};
  const value = `${action.id || ""} ${action.actionId || ""} ${action.actionType || ""} ${action.type || ""} ${action.label || ""} ${action.title || ""} ${payload.actionType || ""} ${payload.type || ""} ${payload.operation || ""} ${payload.shopifyField || ""} ${payload.proposedChange || ""}`.toLowerCase();
  if (value.includes("faq")) return "faq";
  if (value.includes("title") || value.includes("seo") || value.includes("metadata")) return "title-metadata";
  if (value.includes("variant") || value.includes("option") || value.includes("sku")) return "variant";
  if (value.includes("image") || value.includes("media") || value.includes("alt text")) return "media";
  if (value.includes("qa") || value.includes("supplier") || value.includes("quality review")) return "qa-review";
  if (value.includes("tag") || value.includes("collection")) return "workflow-tag";
  if (value.includes("evidence") || value.includes("inspect") || value.includes("verify") || value.includes("review return") || value.includes("review product")) return "evidence-review";
  if (value.includes("support") || value.includes("internal note")) return "support-note";
  if (value.includes("description") || value.includes("pdp") || value.includes("copy") || value.includes("expectation") || value.includes("quality note")) return "product-copy";
  if (value.includes("price") || value.includes("inventory") || value.includes("archive") || value.includes("product status") || value.includes("unlisted")) return "commercial-control";
  return "other";
}

function isDashboardImportantAction(action = {}) {
  return getDashboardActionTier(action) <= 2;
}

function getDashboardActionTier(action = {}) {
  const payload = action.payload || {};
  const explicitTier = Number(payload.actionTier || action.actionTier || 0);
  if ([1, 2, 3].includes(explicitTier)) return explicitTier;
  const family = getDashboardActionFamily(action);
  const value = `${action.id || ""} ${action.actionId || ""} ${action.actionType || ""} ${action.type || ""} ${action.label || ""} ${action.title || ""} ${payload.actionType || ""} ${payload.type || ""} ${payload.operation || ""} ${payload.shopifyField || ""} ${payload.proposedChange || ""}`.toLowerCase();
  const hasDirectShopifyChange = Boolean(
    payload.draftText
      || payload.draftTitle
      || payload.productStatus
      || payload.tag
      || payload.collectionName
      || Array.isArray(payload.tags)
      || Array.isArray(payload.faqItems)
      || Array.isArray(payload.mediaUpdates)
      || Array.isArray(payload.descriptionChanges),
  );
  const investigationIntent = /\b(review|inspect|verify|check|evidence|investigation|follow up|follow-up|supplier|qa)\b/.test(value);
  if (investigationIntent && !hasDirectShopifyChange) return 3;

  if (
    family === "product-copy"
      || family === "title-metadata"
      || family === "commercial-control"
      || value.includes("product status")
      || value.includes("draft")
      || value.includes("archive")
      || value.includes("stop selling")
      || value.includes("pause product")
      || value.includes("category")
      || value.includes("collection")
  ) {
    return 1;
  }

  if (
    family === "faq"
      || family === "variant"
      || family === "media"
      || family === "workflow-tag"
      || value.includes("tag")
      || value.includes("faq")
      || value.includes("alt text")
      || value.includes("variant")
      || value.includes("option")
  ) {
    return 2;
  }

  return 3;
}

function getDashboardActionTierLabel(tier) {
  if (tier === 1) return "Primary product change";
  if (tier === 2) return "Secondary product update";
  return "Manual review";
}

function compareDashboardActionPriority(first, second) {
  return (first.actionTier || 3) - (second.actionTier || 3)
    || second.priorityScore - first.priorityScore
    || second.marginAtRisk - first.marginAtRisk;
}

function getDashboardActionPriorityScore(product, action = {}, { maxMarginRisk = 0 } = {}) {
  const productImportance = getDashboardProductImportanceScore(product, { maxMarginRisk });
  const tierBonus = getDashboardActionTier(action) === 1 ? 12 : getDashboardActionTier(action) === 2 ? 6 : 0;
  const actionFit = getDashboardActionFitScore(action);
  return Math.round(Math.min(100, Math.max(0, productImportance + tierBonus + actionFit)));
}

function getDashboardProductImportanceScore(product, { maxMarginRisk = 0 } = {}) {
  const riskScore = Number(product?.riskScore || 0);
  const confidenceScore = Number(product?.confidence || product?.metrics?.confidence || 0);
  const momentumScore = getDashboardProductMomentumScore(product);
  const marginRisk = getDashboardMetric(product, "marginAtRisk");
  const maxReferenceImpact = Math.max(maxMarginRisk, 25000);
  const normalizedLogImpactScore = Math.min(100, Math.max(0, 100 * Math.log1p(Math.max(0, marginRisk)) / Math.log1p(maxReferenceImpact)));

  return Math.round(
    riskScore * 0.45
      + momentumScore * 0.25
      + normalizedLogImpactScore * 0.2
      + confidenceScore * 0.1,
  );
}

function getDashboardProductMomentumScore(product = {}) {
  const metrics = product.metrics || {};
  const direct = Number(metrics.productMomentumScore ?? product.productMomentumScore ?? 0);
  if (Number.isFinite(direct) && direct > 0) return Math.min(100, Math.max(0, direct));
  const nested = Number(metrics.productMomentum?.score ?? product.productMomentum?.score ?? 0);
  return Number.isFinite(nested) ? Math.min(100, Math.max(0, nested)) : 0;
}

function getDashboardActionFitScore(action = {}) {
  const payload = action.payload || {};
  const value = `${action.id || ""} ${action.actionId || ""} ${action.type || ""} ${action.actionType || ""} ${action.label || ""} ${action.title || ""} ${payload.shopifyField || ""} ${payload.reasonCategory || ""} ${payload.expectedBenefit || ""} ${payload.proposedChange || ""}`.toLowerCase();
  const impact = normalizeDashboardActionRankValue(payload.impact || payload.impactLevel);
  const confidence = normalizeDashboardActionRankValue(payload.confidence);
  const risk = normalizeDashboardActionRankValue(payload.applicationRisk);
  const effort = normalizeDashboardActionRankValue(action.effort || payload.effort);
  const evidence = normalizeDashboardActionRankValue(payload.evidenceStrength);
  const visibility = normalizeDashboardActionRankValue(payload.visibility);
  const isCustomerFacing = visibility.includes("customer") || /\b(description|pdp|faq|title|seo|meta|handle|media|image|alt text|spec|details)\b/.test(value);
  const isInternal = visibility.includes("internal") || /\b(tag|collection|workflow|support|internal|baseline|monitoring|connect missing source)\b/.test(value);
  const hasDirectShopifyChange = dashboardActionHasDirectShopifyChange(action);
  const investigationOnly = /\b(review|inspect|verify|check|evidence|investigation|follow up|follow-up|supplier|qa)\b/.test(value) && !hasDirectShopifyChange;
  const isSensitive = /\b(price|compare-at|inventory|status|archive|draft|unlisted|pause affected|reduce availability|stop selling)\b/.test(value);
  const highImpact = impact.includes("high") || /\b(expectation|description|pdp|faq|variant|qa|supplier|status|inventory|price|compare-at)\b/.test(value);
  const lowRisk = risk.includes("low") || (!risk && !isSensitive);
  const lowEffort = effort.includes("low") || (!effort && !isSensitive);
  const strongEvidence = evidence.includes("strong");

  let score = 0;
  if (highImpact) score += 8;
  if (isCustomerFacing) score += 14;
  if (lowRisk) score += 8;
  if (lowEffort) score += 5;
  if (confidence.includes("high")) score += 5;
  if (strongEvidence) score += 6;
  if (highImpact && isCustomerFacing && lowRisk && lowEffort && (strongEvidence || confidence.includes("high"))) score += 12;
  if (/\b(return|review|sentiment|quality|variant|content|expectation|fit|sizing)\b/.test(value) && highImpact) score += 5;
  if (isInternal) score -= 10;
  if (investigationOnly) score -= 22;
  if (isSensitive) score -= 20;
  if (normalizeDashboardActionRankValue(payload.approvalLevel || payload.approval).includes("strong")) score -= 8;

  return score;
}

function dashboardActionHasDirectShopifyChange(action = {}) {
  const payload = action.payload || {};
  return Boolean(
    payload.draftText
      || payload.draftTitle
      || payload.productStatus
      || payload.tag
      || payload.collectionName
      || payload.draftHandle
      || payload.templateSuffix
      || payload.field === "classification"
      || payload.field === "seo.title"
      || payload.field === "seo.description"
      || Array.isArray(payload.tags)
      || Array.isArray(payload.faqItems)
      || Array.isArray(payload.mediaUpdates)
      || Array.isArray(payload.descriptionChanges)
      || Array.isArray(payload.metafields)
  );
}

function normalizeDashboardActionRankValue(value = "") {
  return String(value || "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
}

function getDashboardActionCategory(action = {}) {
  const value = `${action.id || ""} ${action.type || ""} ${action.label || ""}`.toLowerCase();
  if (value.includes("faq")) return "Product FAQs";
  if (value.includes("quality") || value.includes("support") || value.includes("note")) return "Product quality notes";
  if (value.includes("description") || value.includes("copy") || value.includes("pdp")) return "Product descriptions";
  if (value.includes("tag") || value.includes("collection")) return "Tags and workflows";
  if (value.includes("variant") || value.includes("option")) return "Variant review";
  if (value.includes("price")) return "Pricing review";
  if (value.includes("evidence") || value.includes("review")) return "Evidence review";
  return "Recommended fixes";
}

function getDashboardActionTone(action = {}) {
  const category = getDashboardActionCategory(action);
  if (category.includes("FAQ")) return "teal";
  if (category.includes("description")) return "blue";
  if (category.includes("quality")) return "purple";
  if (category.includes("Tags")) return "orange";
  return "blue";
}

function buildDashboardPriorityProducts(productList, importantPendingActions = []) {
  const maxMarginRisk = Math.max(...productList.map((product) => getDashboardMetric(product, "marginAtRisk")), 0);
  const productRows = new Map();

  importantPendingActions.forEach((action) => {
    const product = action.product;
    if (!product) return;
    const key = product.id || product.productGid || product.handle || product.slug || product.title;
    const existing = productRows.get(key);
    if (!existing || action.priorityScore > existing.action.priorityScore) {
      productRows.set(key, { product, action });
    }
  });

  return Array.from(productRows.values())
    .sort((first, second) => (
      compareDashboardActionPriority(first.action, second.action)
        || getDashboardPriorityScore(second.product, { maxMarginRisk }) - getDashboardPriorityScore(first.product, { maxMarginRisk })
    ))
    .slice(0, 3)
    .map(({ product, action }, index) => ({
      id: product.id || product.handle || product.slug || product.title,
      rank: index + 1,
      title: product.title || product.productTitle || "Product",
      href: action.href || `/app/products/${product.handle || product.slug || product.id}`,
      riskLabel: getRiskLabel(Number(product.riskScore || 0)),
      riskTone: getRiskTone(Number(product.riskScore || 0)),
      marginAtRiskLabel: formatDashboardMoney(getDashboardMetric(product, "marginAtRisk")),
      issueLabel: getDashboardIssueLabel(product.primaryIssue || product.metrics?.mainIssue || "Product quality"),
      actionLabel: action.label || "Review recommended action",
    }));
}

function buildDashboardActionQueue(pendingActions) {
  const grouped = new Map();
  pendingActions.forEach((action) => {
    const current = grouped.get(action.category) || {
      label: action.category,
      value: 0,
      href: action.href,
      icon: action.icon,
      tone: action.tone,
      products: new Set(),
    };
    current.value += 1;
    current.products.add(action.productTitle);
    if (
      !current.actionTier
        || action.actionTier < current.actionTier
        || (action.actionTier === current.actionTier && action.priorityScore > (current.priorityScore || 0))
    ) {
      current.href = action.href;
      current.priorityScore = action.priorityScore;
      current.actionTier = action.actionTier;
    }
    grouped.set(action.category, current);
  });

  const rows = Array.from(grouped.values())
    .sort((first, second) => (first.actionTier || 3) - (second.actionTier || 3) || second.value - first.value || (second.priorityScore || 0) - (first.priorityScore || 0))
    .map((row) => ({
      label: row.label,
      value: row.value,
      valueLabel: formatDashboardNumber(row.value),
      detail: `${formatDashboardNumber(row.products.size)} product${row.products.size === 1 ? "" : "s"} affected`,
      href: row.href,
      icon: row.icon,
      tone: row.tone,
    }));

  const first = rows[0];
  return {
    total: pendingActions.length,
    totalLabel: formatDashboardNumber(pendingActions.length),
    detail: first ? `${first.valueLabel} ${first.label.toLowerCase()} pending` : "No pending fixes waiting for review.",
    rows: rows.length ? rows : [{
      label: "No pending actions",
      value: 0,
      valueLabel: "0",
      detail: "Run product diagnosis to generate actionable fixes.",
      href: "/app/products",
      icon: "check",
      tone: "green",
    }],
  };
}

function buildDashboardTopActiveIssues(productList) {
  const grouped = new Map();
  productList.forEach((product) => {
    const metrics = product.metrics || {};
    const issueLabel = getDashboardIssueLabel(product.primaryIssue || metrics.mainIssue || "Product quality");
    const current = grouped.get(issueLabel) || {
      label: issueLabel,
      products: new Set(),
      marginAtRisk: 0,
    };
    current.products.add(product.id || product.handle || product.slug || product.title);
    current.marginAtRisk += getDashboardMetric(product, "marginAtRisk");
    grouped.set(issueLabel, current);
  });

  return Array.from(grouped.values())
    .sort((first, second) => second.marginAtRisk - first.marginAtRisk || second.products.size - first.products.size)
    .slice(0, 4)
    .map((issue) => ({
      label: issue.label,
      productsAffected: issue.products.size,
      productsLabel: `${formatDashboardNumber(issue.products.size)} product${issue.products.size === 1 ? "" : "s"}`,
      marginAtRisk: issue.marginAtRisk,
      marginAtRiskLabel: formatDashboardMoney(issue.marginAtRisk),
    }));
}

function buildDashboardCoverageSummary(productList, { fullDiagnoses, quickScanOnly, totalProducts, catalogProductCount, settings = {} }) {
  const connectedLabels = new Set();
  productList.forEach((product) => {
    (Array.isArray(product.sourceCoverage) ? product.sourceCoverage : []).forEach((source) => {
      connectedLabels.add(normalizeDashboardSourceLabel(source));
    });
  });
  if (totalProducts > 0) connectedLabels.add("Product data");

  const sources = [
    { label: "Products", source: "Product data", icon: "product", connectedDetail: "Shopify product data is available by default and is used for title, description, tags, variants and catalog metadata.", missingDetail: "ProductPulse has not stored product data yet. Run QuickScan to begin catalog coverage." },
    { label: "Reviews", source: "Reviews", icon: "star", connectedDetail: "Review evidence was found through connected review sources or CSV imports and can improve issue confidence.", missingDetail: "No review evidence has been found yet. Connect Judge.me or upload a reviews CSV to improve coverage." },
    { label: "Returns", source: "Returns", icon: "return", connectedDetail: "Return evidence was found in stored diagnostics and can explain post-purchase friction.", missingDetail: "No return evidence has been found yet. Order access may be missing or no returns were found in the available window." },
    { label: "Refunds", source: "Refunds", icon: "cash-dollar", connectedDetail: "Refund evidence was found and can contribute to financial pressure and operational risk.", missingDetail: "No refund evidence has been found yet. Refund access may be missing or no refunds were found in the available window." },
  ].map((source) => ({
    ...source,
    tone: connectedLabels.has(source.source) ? "success" : "neutral",
    detail: connectedLabels.has(source.source) ? source.connectedDetail : source.missingDetail,
  }));

  const connectedCount = sources.filter((source) => source.tone === "success").length;
  const storedFullPercent = totalProducts ? Math.round((fullDiagnoses.length / totalProducts) * 100) : 0;
  const catalogTotal = Math.max(Number(catalogProductCount || 0), totalProducts);
  const catalogStoredPercent = catalogTotal ? Math.round((totalProducts / catalogTotal) * 100) : 0;
  const quickScanStoredPercent = totalProducts ? Math.round((quickScanOnly.length / totalProducts) * 100) : 0;
  const missingCatalogStored = Math.max(0, catalogTotal - totalProducts);
  const minimumRiskScore = Number(settings?.risk?.minimumScore ?? 18);
  const catalogTone = catalogStoredPercent >= 50 ? "green" : catalogStoredPercent >= 15 ? "orange" : "blue";
  const storedAnalysisTone = storedFullPercent >= 70 ? "green" : storedFullPercent >= 30 ? "orange" : "blue";
  const statusTone = connectedCount >= 3 && storedFullPercent >= 70
    ? "green"
    : connectedCount > 1 || storedFullPercent >= 35
      ? "orange"
      : "red";
  const statusLabel = statusTone === "green"
    ? "Coverage quality: Good"
    : statusTone === "orange"
      ? "Coverage quality: Medium"
      : "Coverage quality: Bad";
  return {
    statusLabel,
    tone: statusTone,
    icon: statusTone === "green" ? "check" : statusTone === "orange" ? "alert-triangle" : "x",
    detail: `${formatDashboardNumber(totalProducts)} / ${formatDashboardNumber(catalogTotal)} Shopify catalog products are currently inside ProductPulse.`,
    coverageLine: `${formatDashboardNumber(fullDiagnoses.length)} full diagnostics · ${formatDashboardNumber(quickScanOnly.length)} QuickScan only in ProductPulse`,
    catalogCoverage: {
      label: "Total catalog",
      percent: catalogStoredPercent,
      percentLabel: formatDashboardRate(catalogStoredPercent),
      tone: catalogTone,
      ariaLabel: `${formatDashboardRate(catalogStoredPercent)} of Shopify catalog products are currently analyzed in ProductPulse`,
      detail: `${formatDashboardNumber(totalProducts)} of ${formatDashboardNumber(catalogTotal)} Shopify catalog products are in ProductPulse because QuickScan found evidence above the minimum risk threshold (${formatDashboardNumber(minimumRiskScore)}+).`,
      subline: `${formatDashboardNumber(missingCatalogStored)} catalog products are below threshold or not stored here.`,
      infoTitle: "What total catalog means",
      infoDetail: `This compares the full Shopify catalog with the products stored in ProductPulse. A product enters ProductPulse when QuickScan detects evidence at or above the minimum risk threshold (${formatDashboardNumber(minimumRiskScore)}+). Products below that threshold do not appear in this dashboard and are not included in these analytics.`,
      infoFootnote: "To analyze a product that is not listed, open Products, use Find Shopify product, search the live Shopify catalog, and run a full diagnosis.",
    },
    productPulseCoverage: {
      label: "Products in ProductPulse",
      percent: storedFullPercent,
      percentLabel: `${formatDashboardRate(storedFullPercent)} full`,
      secondaryLabel: `${formatDashboardNumber(quickScanOnly.length)} QuickScan only · ${formatDashboardRate(quickScanStoredPercent)}`,
      tone: storedAnalysisTone,
      ariaLabel: `${formatDashboardRate(storedFullPercent)} of ProductPulse products have full diagnostics`,
      detail: `${formatDashboardNumber(fullDiagnoses.length)} of ${formatDashboardNumber(totalProducts)} ProductPulse products have full diagnostics. ${formatDashboardNumber(quickScanOnly.length)} remain QuickScan only.`,
      subline: "QuickScan-only products have lightweight deterministic evidence and still need full diagnostics for final recommendations.",
      infoTitle: "Full diagnostics vs QuickScan",
      infoDetail: "This only measures products that are already inside ProductPulse. Full diagnostics combine Shopify product data, orders, returns/refunds, connected reviews and AI-generated recommendations. QuickScan-only products are candidates found by the lightweight scan but have not received the deep diagnosis yet.",
      infoFootnote: "Run a full diagnosis from Products or from the product detail page to promote a QuickScan-only product.",
    },
    recommendation: {
      tone: catalogTone,
      icon: catalogTone === "green" ? "check" : "alert-circle",
      text: catalogTone === "green"
        ? "Full-diagnosis coverage is healthy. Keep running targeted diagnostics when new products or evidence appear."
        : "Products below the QuickScan threshold may not appear in the table, but they can still carry hidden risk. ProductPulse recommends running full diagnostics on important products even when QuickScan did not flag them.",
    },
    sources,
  };
}

function getDashboardReturnRateLabel(returnRate, metrics = {}) {
  const returnUnits = Number(metrics.returnUnits || 0);
  const soldUnits = Number(metrics.soldUnits || 0);
  if (Number(returnRate || 0) > 100 && returnUnits > 0 && soldUnits > 0) return "returns in order window";
  return "return rate";
}

function formatDashboardReturnRate(returnRate, metrics = {}) {
  const returnUnits = Number(metrics.returnUnits || 0);
  const soldUnits = Number(metrics.soldUnits || 0);
  if (Number(returnRate || 0) > 100 && returnUnits > 0 && soldUnits > 0) {
    return `${formatDashboardNumber(returnUnits)} / ${formatDashboardNumber(soldUnits)}`;
  }
  return formatDashboardRate(returnRate);
}

function formatDashboardReturnRateSummary(returnRate, metrics = {}) {
  const returnUnits = Number(metrics.returnUnits || 0);
  const soldUnits = Number(metrics.soldUnits || 0);
  if (Number(returnRate || 0) > 100 && returnUnits > 0 && soldUnits > 0) {
    return `${formatDashboardNumber(returnUnits)} return${returnUnits === 1 ? "" : "s"} against ${formatDashboardNumber(soldUnits)} sold unit${soldUnits === 1 ? "" : "s"} in the available order window`;
  }
  return `${formatDashboardRate(returnRate)} return rate`;
}

function buildDashboardSuggestedFixes(productList) {
  const fixes = [];
  productList.forEach((product) => {
    const actions = filterDisabledProductActions(product.recommendedActions);
    actions.forEach((action) => {
      fixes.push({
        icon: getDashboardActionIcon(action),
        label: action.label || "Review recommended action",
        impact: getDashboardActionImpact(product),
        tone: Number(product.riskScore || 0) >= 75 ? "critical" : Number(product.riskScore || 0) >= 55 ? "warning" : "success",
        href: `/app/products/${product.handle || product.slug || product.id}`,
      });
    });
  });

  if (fixes.length) return fixes.slice(0, 4);
  return [{
    icon: "wand",
    label: productList.length ? "Run product diagnosis to unlock recommended actions" : "Run QuickScan to find products needing attention",
    impact: productList.length ? "Needs diagnosis" : "No scan yet",
    tone: "info",
    href: productList.length ? "/app/products" : "/app/products",
  }];
}

function normalizeDashboardRows(rows, limit, emptyLabel) {
  const sorted = rows
    .filter((row) => row.label)
    .sort((first, second) => Number(second.value || 0) - Number(first.value || 0))
    .slice(0, limit);
  const max = Math.max(...sorted.map((row) => Number(row.value || 0)), 0);
  if (!sorted.length) return [{ label: emptyLabel, value: 0, displayValue: "0", pct: 0 }];
  return sorted.map((row) => ({
    ...row,
    displayValue: row.displayValue || formatDashboardNumber(row.value),
    pct: max ? Math.max(8, Math.round((Number(row.value || 0) / max) * 100)) : 0,
  }));
}

function sumDashboardMetric(productList, key) {
  return productList.reduce((total, product) => total + getDashboardMetric(product, key), 0);
}

function getDashboardMetric(product, key) {
  const metrics = product.metrics || {};
  if (key === "marginAtRisk") return Number(metrics.marginAtRisk || (metrics.revenueAtRisk ? metrics.revenueAtRisk * 0.45 : 0) || 0);
  if (key === "revenueAtRisk") return Number(metrics.revenueAtRisk || metrics.estimatedImpact || metrics.refundAmount || 0);
  return Number(metrics[key] || 0);
}

function getDashboardProductVariant(product) {
  const text = `${product.handle || product.slug || ""} ${product.title || ""}`.toLowerCase();
  if (text.includes("dress")) return "dress";
  if (text.includes("shoe") || text.includes("sneaker")) return "sneaker";
  if (text.includes("tote") || text.includes("bag")) return "tote";
  if (text.includes("tee") || text.includes("shirt")) return "tee";
  return "shirt";
}

function getDashboardIssueLabel(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("fit") || normalized.includes("size") || normalized.includes("sizing") || normalized.includes("waist")) return "Fit & sizing";
  if (normalized.includes("color") || normalized.includes("pictured")) return "Color expectations";
  if (normalized.includes("durability") || normalized.includes("zipper") || normalized.includes("break")) return "Durability";
  if (normalized.includes("quality") || normalized.includes("defect") || normalized.includes("material") || normalized.includes("soft")) return "Product quality";
  if (normalized.includes("compat")) return "Compatibility";
  if (normalized.includes("content") || normalized.includes("description") || normalized.includes("tag")) return "Product content";
  if (normalized.includes("subjective") || normalized.includes("sentiment") || normalized.includes("fear")) return "Customer sentiment";
  return value ? String(value).replace(/_/g, " ") : "Product quality";
}

function normalizeDashboardSourceLabel(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("return")) return "Returns";
  if (normalized.includes("refund")) return "Refunds";
  if (normalized.includes("review") || normalized.includes("judge") || normalized.includes("csv")) return "Reviews";
  if (normalized.includes("support") || normalized.includes("chat")) return "Support";
  if (normalized.includes("product") || normalized.includes("shopify")) return "Product data";
  return String(value || "Other");
}

function getDashboardActionIcon(action) {
  const value = `${action.id || ""} ${action.type || ""} ${action.label || ""}`.toLowerCase();
  if (value.includes("faq")) return "question-circle";
  if (value.includes("tag")) return "tag";
  if (value.includes("support") || value.includes("note")) return "note";
  if (value.includes("image")) return "image";
  if (value.includes("description") || value.includes("copy") || value.includes("pdp")) return "note";
  return "wand";
}

function getDashboardActionImpact(product) {
  if (Number(product.riskScore || 0) >= 75) return "High impact";
  if (Number(product.riskScore || 0) >= 55) return "Medium impact";
  return "Low effort";
}

function formatDashboardNumber(value) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatDashboardMoney(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatDashboardRate(value) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(clampDashboardRate(value))}%`;
}

function clampDashboardRate(value) {
  return Math.min(100, Math.max(0, Number(value || 0)));
}

export function buildAnalyticsViewData(productItems = products, options = {}) {
  const productList = (Array.isArray(productItems) ? productItems : []).filter(Boolean);
  const totalProducts = productList.length;
  const fullDiagnoses = productList.filter((product) => product.analysisDepth === "full" || product.metrics?.latestDiagnosisId);
  const quickScanOnly = productList.filter((product) => product.analysisDepth === "quickscan" && !product.metrics?.latestDiagnosisId);
  const highRiskProducts = productList.filter((product) => Number(product.riskScore || 0) >= 75);
  const mediumRiskProducts = productList.filter((product) => Number(product.riskScore || 0) >= 55 && Number(product.riskScore || 0) < 75);
  const windowDays = getAnalyticsConfiguredWindowDays(productList, options);
  const actionRows = buildDashboardActionRows(productList);
  const totals = getAnalyticsTotals(productList, { ...options, actionRows });
  const pendingActions = actionRows.filter((action) => action.status === "pending");
  const appliedActions = actionRows.filter((action) => action.status === "applied");
  const reviewedActions = actionRows.filter((action) => action.status === "reviewed");
  const dismissedActions = actionRows.filter((action) => action.status === "dismissed");
  const productsNeedingAttention = productList.filter((product) => (
    Number(product.riskScore || 0) >= 55
      || pendingActions.some((action) => action.product === product)
  ));
  const signalSeries = buildAnalyticsRiskSignalSeries(productList);
  const sourceContribution = buildAnalyticsSourceContribution(productList);
  const issueDistribution = buildAnalyticsIssueDistribution(productList);
  const collectionMargin = buildAnalyticsCollectionMargin(productList);
  const riskBubbles = buildAnalyticsRiskBubbles(productList);
  const analysisCoverage = buildAnalyticsAnalysisCoverage({ totalProducts, fullDiagnoses, quickScanOnly });
  const deepDiagnosisCharts = buildAnalyticsDeepDiagnosisCharts(fullDiagnoses, { windowDays });

  return {
    generatedAt: options.generatedAt || new Date().toISOString(),
    windowDays,
    windowLabel: `Last ${windowDays} days`,
    productCountLabel: `${formatDashboardNumber(totalProducts)} stored product${totalProducts === 1 ? "" : "s"}`,
    lastUpdatedLabel: getAnalyticsLastUpdatedLabel(productList),
    kpis: [
      {
        label: "Margin at risk",
        value: formatDashboardMoney(totals.marginAtRisk),
        detail: `${formatDashboardMoney(totals.revenueAtRisk)} revenue at risk`,
        icon: "cash-dollar",
        tone: totals.marginAtRisk > 0 ? "green" : "blue",
      },
      {
        label: "Products needing attention",
        value: formatDashboardNumber(productsNeedingAttention.length),
        detail: `${formatDashboardNumber(highRiskProducts.length)} high risk, ${formatDashboardNumber(mediumRiskProducts.length)} medium risk`,
        icon: "shield-check-mark",
        tone: highRiskProducts.length ? "red" : mediumRiskProducts.length ? "orange" : "green",
      },
      {
        label: "Pending actions",
        value: formatDashboardNumber(pendingActions.length),
        detail: `${formatDashboardNumber(appliedActions.length)} applied, ${formatDashboardNumber(reviewedActions.length)} reviewed, ${formatDashboardNumber(dismissedActions.length)} dismissed`,
        icon: "wand",
        tone: pendingActions.length ? "purple" : "green",
      },
      {
        label: "Catalog coverage",
        value: formatDashboardNumber(fullDiagnoses.length),
        detail: `${formatAnalyticsPercent(totalProducts ? (fullDiagnoses.length / totalProducts) * 100 : 0)} full diagnoses / ${formatDashboardNumber(totalProducts)} stored products`,
        icon: "product",
        tone: "purple",
      },
    ],
    totals: {
      ...totals,
      totalProducts,
      fullDiagnoses: fullDiagnoses.length,
      quickScanOnly: quickScanOnly.length,
      highRiskProducts: highRiskProducts.length,
      mediumRiskProducts: mediumRiskProducts.length,
    },
    riskSignals: {
      series: signalSeries,
      labels: getAnalyticsTrendLabels(signalSeries),
    },
    issueDistribution: {
      rows: issueDistribution,
      max: getAnalyticsMax(issueDistribution),
    },
    sourceContribution: {
      rows: sourceContribution.rows,
      total: sourceContribution.total,
      totalLabel: formatDashboardNumber(sourceContribution.total),
    },
    deepDiagnosisCharts,
    riskBubbles,
    collectionMargin: {
      rows: collectionMargin,
      max: getAnalyticsMax(collectionMargin),
    },
    analysisCoverage: {
      rows: analysisCoverage,
      max: getAnalyticsMax(analysisCoverage),
    },
    impactTrend: buildAnalyticsImpactTrend(productList, { windowDays, totalMarginAtRisk: totals.marginAtRisk }),
    actionImpactTrend: buildAnalyticsActionImpactTrend(actionRows, productList, { windowDays }),
    issueImpact: {
      rows: buildAnalyticsIssueImpact(productList),
    },
    impactBreakdown: buildAnalyticsImpactBreakdown(productList),
    actionPerformance: buildAnalyticsActionPerformance(actionRows, productList),
    catalogCoverage: buildAnalyticsCatalogCoverage(productList, {
      totalProducts,
      fullDiagnoses,
      quickScanOnly,
      sources: options.sources,
      catalogProductCount: options.catalogProductCount || options.totalCatalogProducts,
    }),
    evidenceSourceCoverage: buildAnalyticsEvidenceSourceCoverage(productList, options.sources),
    topProductsAtRisk: buildAnalyticsTopProductsAtRisk(productList, actionRows),
    topInsights: buildAnalyticsTopInsights({
      productList,
      issueDistribution,
      highRiskProducts,
      sourceContribution,
      totals,
      fullDiagnoses,
      totalProducts,
    }),
    businessImpact: {
      title: `Estimated business impact (next ${windowDays} days)`,
      subtitle: "Projected from the stored QuickScan and full diagnosis metrics.",
      metrics: buildAnalyticsBusinessImpactMetrics({ totals, windowDays, productList, options }),
      calculation: buildAnalyticsBusinessImpactCalculation({ totals, windowDays, productList, actionRows }),
    },
  };
}

function getAnalyticsTotals(productList, options = {}) {
  const base = productList.reduce((totals, product) => {
    const metrics = product.metrics || {};
    totals.revenueAtRisk += getDashboardMetric(product, "revenueAtRisk");
    totals.marginAtRisk += getDashboardMetric(product, "marginAtRisk");
    totals.refundAmount += Number(metrics.refundAmount || 0);
    totals.salesAmount += Number(metrics.salesAmount || 0);
    totals.returnUnits += Number(metrics.returnUnits || 0);
    totals.refundUnits += Number(metrics.refundUnits || 0);
    totals.soldUnits += Number(metrics.soldUnits || 0);
    totals.reviewCount += Number(metrics.reviewCount || 0);
    totals.negativeReviewCount += Number(metrics.negativeReviewCount || 0);
    totals.customerTextSignals += Number(metrics.textInsights?.sentiment?.total || 0);
    totals.contentIssueCount += Number(metrics.contentIssueCount || 0);
    totals.signalCount += Number(metrics.signalCount || metrics.issueCount || 0);
    return totals;
  }, {
    revenueAtRisk: 0,
    marginAtRisk: 0,
    refundAmount: 0,
    salesAmount: 0,
    returnUnits: 0,
    refundUnits: 0,
    soldUnits: 0,
    reviewCount: 0,
    negativeReviewCount: 0,
    customerTextSignals: 0,
    contentIssueCount: 0,
    signalCount: 0,
  });

  const actionRows = Array.isArray(options.actionRows) ? options.actionRows : [];
  const actions = Array.isArray(options.actions) ? options.actions : [];
  if (actionRows.length) {
    base.openActions = actionRows.filter((action) => action.status === "pending").length;
    base.appliedActions = actionRows.filter((action) => action.status === "applied").length;
    base.reviewedActions = actionRows.filter((action) => action.status === "reviewed").length;
    base.dismissedActions = actionRows.filter((action) => action.status === "dismissed").length;
  } else if (actions.length) {
    base.openActions = actions.filter((action) => normalizeDashboardActionStatus(action.status) === "pending").length;
    base.appliedActions = actions.filter((action) => normalizeDashboardActionStatus(action.status) === "applied").length;
    base.reviewedActions = actions.filter((action) => normalizeDashboardActionStatus(action.status) === "reviewed").length;
    base.dismissedActions = actions.filter((action) => normalizeDashboardActionStatus(action.status) === "dismissed").length;
  } else {
    base.openActions = productList.reduce((total, product) => total + filterDisabledProductActions(product.recommendedActions).length, 0);
    base.appliedActions = productList.reduce((total, product) => total + filterDisabledProductActions(product.actionHistory).filter((action) => normalizeDashboardActionStatus(action.status) === "applied").length, 0);
    base.reviewedActions = productList.reduce((total, product) => total + filterDisabledProductActions(product.actionHistory).filter((action) => normalizeDashboardActionStatus(action.status) === "reviewed").length, 0);
    base.dismissedActions = productList.reduce((total, product) => total + filterDisabledProductActions(product.actionHistory).filter((action) => normalizeDashboardActionStatus(action.status) === "dismissed").length, 0);
  }

  return base;
}

function getAnalyticsWindowDays(productList) {
  const windows = productList
    .map((product) => Number(product.metrics?.windowDays || 0))
    .filter((value) => value > 0);
  return windows.length ? Math.max(...windows) : 90;
}

function getAnalyticsConfiguredWindowDays(productList, options = {}) {
  const configuredWindow = Number(options.windowDays ?? options.settings?.analysis?.lookbackDays);
  if (Number.isFinite(configuredWindow) && configuredWindow > 0) {
    return Math.min(365, Math.max(1, Math.round(configuredWindow)));
  }
  return getAnalyticsWindowDays(productList);
}

function getAnalyticsLastUpdatedLabel(productList) {
  const timestamps = productList
    .map((product) => new Date(product.lastAnalysis || product.metrics?.lastSignalAt || product.analysisCompletedAt || 0).getTime())
    .filter(Number.isFinite)
    .filter((time) => time > 0);
  if (!timestamps.length) return "No scan data yet";
  return `Updated ${formatAnalyticsRelativeTime(new Date(Math.max(...timestamps)))}`;
}

function buildAnalyticsRiskSignalSeries(productList) {
  const buckets = [
    { label: "High", color: "red", predicate: (product) => Number(product.riskScore || 0) >= 75 },
    { label: "Medium", color: "orange", predicate: (product) => Number(product.riskScore || 0) >= 55 && Number(product.riskScore || 0) < 75 },
    { label: "Low", color: "green", predicate: (product) => Number(product.riskScore || 0) < 55 },
  ];
  return buckets.map((bucket) => ({
    label: bucket.label,
    color: bucket.color,
    values: sumAnalyticsTrends(productList.filter(bucket.predicate).map((product) => product.metrics?.signalTrend || product.metrics?.riskTrend || [])),
  }));
}

function buildAnalyticsIssueDistribution(productList, { limit = 6 } = {}) {
  const grouped = new Map();
  productList.forEach((product) => {
    getAnalyticsIssueContributions(product).forEach((contribution) => {
      const label = getDashboardIssueLabel(contribution.issue);
      const current = grouped.get(label) || { label, value: 0 };
      current.value += Math.max(1, Number(contribution.signals || 1));
      grouped.set(label, current);
    });
  });

  return withAnalyticsColors(normalizeDashboardRows(Array.from(grouped.values()), limit, "No issues detected"));
}

function getAnalyticsIssueContributions(product = {}) {
  const metrics = product.metrics || {};
  const historyIssues = (Array.isArray(metrics.riskHistory) ? metrics.riskHistory : [])
    .map((point) => {
      const issue = point?.primaryIssue;
      if (!issue || isAnalyticsNoIssueLabel(issue)) return null;
      return {
        issue,
        signals: firstAnalyticsNumber(point.signalCount, point.mainIssueIntensity, point.returnUnits, point.refundUnits, 1),
        confidence: firstAnalyticsNumber(point.confidence, product.confidence, metrics.confidence, 0),
        marginAtRisk: firstAnalyticsNumber(point.marginAtRisk, null),
        source: "history",
      };
    })
    .filter(Boolean);

  const currentIssues = [];
  if (Array.isArray(product.issues) && product.issues.length) {
    product.issues.forEach((issue) => {
      currentIssues.push({
        issue: issue.issueCode || issue.issue || issue.label,
        signals: issue.signals,
        confidence: firstAnalyticsNumber(product.confidence, metrics.confidence, 0),
        marginAtRisk: getDashboardMetric(product, "marginAtRisk"),
        source: "current",
      });
    });
  } else if (product.primaryIssue && !isAnalyticsNoIssueLabel(product.primaryIssue)) {
    currentIssues.push({
      issue: product.primaryIssue,
      signals: metrics.signalCount || metrics.issueCount || 1,
      confidence: firstAnalyticsNumber(product.confidence, metrics.confidence, 0),
      marginAtRisk: getDashboardMetric(product, "marginAtRisk"),
      source: "current",
    });
  }

  if (Array.isArray(metrics.contentIssues)) {
    metrics.contentIssues.forEach((issue) => {
      currentIssues.push({
        issue: issue.issueCode || issue.label || "Product content",
        signals: issue.signals || 1,
        confidence: firstAnalyticsNumber(product.confidence, metrics.confidence, 0),
        marginAtRisk: getDashboardMetric(product, "marginAtRisk"),
        source: "content",
      });
    });
  }

  return historyIssues.length ? [...historyIssues, ...currentIssues.filter((issue) => issue.source === "content")] : currentIssues;
}

function isAnalyticsNoIssueLabel(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return !normalized
    || normalized === "no primary issue"
    || normalized === "no issue"
    || normalized === "none"
    || normalized === "unknown";
}

function firstAnalyticsNumber(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function buildAnalyticsSourceContribution(productList) {
  const counts = new Map();
  const increment = (label, value) => {
    const amount = Math.max(0, Number(value || 0));
    if (amount <= 0) return;
    counts.set(label, (counts.get(label) || 0) + amount);
  };

  productList.forEach((product) => {
    const metrics = product.metrics || {};
    increment("Returns", metrics.returnUnits);
    increment("Refunds", metrics.refundUnits);
    increment("Reviews", metrics.negativeReviewCount);
    increment("Customer language", metrics.textInsights?.sentiment?.total);
    increment("Product content", metrics.contentIssueCount);
  });

  if (!counts.size) {
    productList.forEach((product) => {
      (Array.isArray(product.sourceCoverage) ? product.sourceCoverage : []).forEach((source) => {
        increment(normalizeDashboardSourceLabel(source), 1);
      });
    });
  }

  const rows = withAnalyticsColors(Array.from(counts.entries())
    .map(([label, count]) => ({ label, count, value: count }))
    .sort((first, second) => second.count - first.count)
    .slice(0, 6));
  const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  return {
    total,
    rows: rows.map((row) => ({
      ...row,
      percent: total ? Math.round((Number(row.count || 0) / total) * 100) : 0,
      displayValue: `${formatDashboardNumber(row.count)} signal${Number(row.count) === 1 ? "" : "s"}`,
    })),
  };
}

function buildAnalyticsDeepDiagnosisCharts(productList = [], { windowDays = 90 } = {}) {
  const deepProducts = (Array.isArray(productList) ? productList : [])
    .filter(hasDashboardFullDiagnosis);
  return {
    productCount: deepProducts.length,
    productCountLabel: `${formatDashboardNumber(deepProducts.length)} deep diagnosis product${deepProducts.length === 1 ? "" : "s"}`,
    riskMarginTrend: buildAnalyticsRiskMarginTrend(deepProducts, { windowDays }),
    issueDistribution: buildAnalyticsIssueDistributionByType(deepProducts),
    sourceCoverageMix: buildAnalyticsSourceCoverageMix(deepProducts),
  };
}

function buildAnalyticsRiskMarginTrend(productList = [], { windowDays = 90 } = {}) {
  const products = (Array.isArray(productList) ? productList : []).filter(Boolean);
  const histories = products
    .map((product) => ({
      product,
      history: getAnalyticsProductExposureHistory(product),
    }))
    .filter((row) => row.history.length);
  const timestamps = [...new Set(histories.flatMap((row) => row.history.map((point) => point.time)))]
    .filter(Number.isFinite)
    .sort((left, right) => left - right);

  if (products.length && timestamps.length >= 2) {
    const labels = timestamps.map(formatAnalyticsDateLabel);
    const marginValues = timestamps.map((time) => histories.reduce((sum, row) => (
      sum + getAnalyticsExposureValueAtTime(row.history, time, "marginAtRisk")
    ), 0));
    const revenueValues = timestamps.map((time) => histories.reduce((sum, row) => (
      sum + getAnalyticsExposureValueAtTime(row.history, time, "revenueAtRisk")
    ), 0));
    return buildAnalyticsRiskMarginTrendPayload({
      labels,
      marginValues,
      revenueValues,
      pointDetails: timestamps.map((time) => {
        const directSnapshots = histories.filter((row) => row.history.some((point) => point.time === time)).length;
        return {
          label: formatAnalyticsDateLabel(time),
          time,
          sourceLabel: "Saved score-history exposure",
          basisLabel: directSnapshots
            ? `${formatDashboardNumber(directSnapshots)} product snapshot${directSnapshots === 1 ? "" : "s"} recorded on this date.`
            : "Carried forward the latest saved exposure values available by this date.",
          productCountLabel: `${formatDashboardNumber(products.length)} deep diagnosis product${products.length === 1 ? "" : "s"}`,
        };
      }),
      detail: "Built from saved score-history exposure values across deep diagnosis products.",
    });
  }

  const length = Math.max(...products.map((product) => getAnalyticsProductTrendValues(product).length), 7);
  const normalized = products.map((product) => ({
    product,
    values: resizeAnalyticsTrend(getAnalyticsProductTrendValues(product), length, Number(product.riskScore || 0)),
    marginAtRisk: getDashboardMetric(product, "marginAtRisk"),
    revenueAtRisk: getDashboardMetric(product, "revenueAtRisk"),
  }));
  const marginValues = Array.from({ length }, (_, index) => normalized.reduce((sum, row) => {
    const trendValue = Number(row.values[index] || 0);
    return sum + row.marginAtRisk * clampAnalyticsValue(trendValue / 100, 0.08, 1);
  }, 0));
  const revenueValues = Array.from({ length }, (_, index) => normalized.reduce((sum, row) => {
    const trendValue = Number(row.values[index] || 0);
    return sum + row.revenueAtRisk * clampAnalyticsValue(trendValue / 100, 0.08, 1);
  }, 0));

  const fallbackLabels = getAnalyticsTrendWindowLabels(length, windowDays);
  const fallbackTimes = getAnalyticsTrendWindowTimes(length, windowDays, getAnalyticsRiskMarginReferenceTime(products));
  return buildAnalyticsRiskMarginTrendPayload({
    labels: fallbackLabels,
    marginValues,
    revenueValues,
    pointDetails: fallbackLabels.map((label, index) => ({
      label,
      time: fallbackTimes[index],
      sourceLabel: "Reconstructed saved risk trend",
      basisLabel: "Estimated from stored risk trend values when full exposure history is not available.",
      productCountLabel: `${formatDashboardNumber(products.length)} deep diagnosis product${products.length === 1 ? "" : "s"}`,
    })),
    detail: "Reconstructed from saved risk trends when full exposure history is not available.",
  });
}

function buildAnalyticsRiskMarginTrendPayload({ labels = [], marginValues = [], revenueValues = [], pointDetails = [], detail = "" }) {
  const marginCurrent = marginValues[marginValues.length - 1] || 0;
  const revenueCurrent = revenueValues[revenueValues.length - 1] || 0;
  return {
    labels,
    detail,
    pointDetails: labels.map((label, index) => ({
      label,
      sourceLabel: detail || "Analytics exposure series",
      basisLabel: "Aggregated from stored ProductPulse analytics data.",
      ...(pointDetails[index] || {}),
    })),
    hasData: marginValues.some((value) => Number(value || 0) > 0) || revenueValues.some((value) => Number(value || 0) > 0),
    series: [
      {
        key: "marginAtRisk",
        label: "Margin at risk (USD)",
        color: "green",
        axis: "left",
        values: marginValues,
        displayValue: formatDashboardMoney(marginCurrent),
      },
      {
        key: "revenueAtRisk",
        label: "Revenue at risk (USD)",
        color: "purple",
        axis: "right",
        values: revenueValues,
        displayValue: formatDashboardMoney(revenueCurrent),
      },
    ],
  };
}

function getAnalyticsProductExposureHistory(product = {}) {
  const metrics = product.metrics || {};
  const currentTime = new Date(product.analysisCompletedAt || product.lastAnalysis || metrics.lastSignalAt || Date.now()).getTime();
  const currentRisk = Number(product.riskScore || 0);
  const currentMargin = getDashboardMetric(product, "marginAtRisk");
  const currentRevenue = getDashboardMetric(product, "revenueAtRisk");
  const rows = (Array.isArray(metrics.riskHistory) ? metrics.riskHistory : [])
    .map((point) => {
      const time = new Date(point.recordedAt || 0).getTime();
      if (!Number.isFinite(time) || time <= 0) return null;
      const risk = Number(point.riskScore ?? currentRisk);
      const riskWeight = clampAnalyticsValue(risk / 100, 0.08, 1);
      return {
        time,
        marginAtRisk: point.marginAtRisk != null && Number.isFinite(Number(point.marginAtRisk)) ? Number(point.marginAtRisk) : currentMargin * riskWeight,
        revenueAtRisk: point.revenueAtRisk != null && Number.isFinite(Number(point.revenueAtRisk)) ? Number(point.revenueAtRisk) : currentRevenue * riskWeight,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.time - right.time);

  if (Number.isFinite(currentTime) && currentTime > 0) {
    const hasCurrentTime = rows.some((point) => Math.abs(point.time - currentTime) < 60 * 1000);
    if (!hasCurrentTime) {
      rows.push({ time: currentTime, marginAtRisk: currentMargin, revenueAtRisk: currentRevenue });
      rows.sort((left, right) => left.time - right.time);
    }
  }

  return rows;
}

function getAnalyticsRiskMarginReferenceTime(products = []) {
  const timestamps = (Array.isArray(products) ? products : [])
    .map((product) => new Date(product?.analysisCompletedAt || product?.lastAnalysis || product?.metrics?.lastSignalAt || 0).getTime())
    .filter(Number.isFinite)
    .filter((time) => time > 0);
  return timestamps.length ? Math.max(...timestamps) : Date.now();
}

function getAnalyticsTrendWindowTimes(length, windowDays = 90, endTime = Date.now()) {
  const count = Math.max(Number(length || 0), 1);
  const safeEnd = Number.isFinite(Number(endTime)) ? Number(endTime) : Date.now();
  if (count === 1) return [safeEnd];
  const safeWindow = Math.max(1, Number(windowDays || 90)) * ANALYTICS_DAY_MS;
  const start = safeEnd - safeWindow;
  const step = safeWindow / Math.max(count - 1, 1);
  return Array.from({ length: count }, (_, index) => Math.round(start + step * index));
}

function getAnalyticsExposureValueAtTime(history = [], time = 0, key = "") {
  const eligible = history.filter((point) => Number(point.time || 0) <= time && Number.isFinite(Number(point[key])));
  if (eligible.length) return Number(eligible[eligible.length - 1][key] || 0);
  const first = history.find((point) => Number.isFinite(Number(point[key])));
  return Number(first?.[key] || 0);
}

function buildAnalyticsIssueDistributionByType(productList = []) {
  const rows = buildAnalyticsIssueDistribution(productList, { limit: 8 });
  const filteredRows = rows.filter((row) => row.label !== "No issues detected");
  const total = filteredRows.reduce((sum, row) => sum + Number(row.value || 0), 0);
  return {
    total,
    totalLabel: formatDashboardNumber(total),
    rows: filteredRows.map((row) => ({
      ...row,
      count: Number(row.value || 0),
      countLabel: formatDashboardNumber(row.value || 0),
      percent: total ? Math.round((Number(row.value || 0) / total) * 100) : 0,
      percentLabel: total ? `${Math.round((Number(row.value || 0) / total) * 100)}%` : "0%",
    })),
  };
}

function buildAnalyticsSourceCoverageMix(productList = []) {
  const counts = new Map();
  const increment = (label, value) => {
    const amount = Math.max(0, Number(value || 0));
    if (!amount) return;
    counts.set(label, (counts.get(label) || 0) + amount);
  };

  productList.forEach((product) => {
    const metrics = product.metrics || {};
    const reviewCount = Number(metrics.reviewCount || 0);
    const csvReviewCount = Number(metrics.csvReviewCount || 0);
    const judgeMeReviewCount = Number(metrics.judgeMeReviewCount || Math.max(reviewCount - csvReviewCount, 0));
    increment("Returns", metrics.returnUnits);
    increment("Reviews", judgeMeReviewCount || metrics.negativeReviewCount);
    increment("Refunds", metrics.refundUnits);
    increment("CSV Reviews", csvReviewCount);
    increment("Orders", metrics.monthlyOrderActivity?.summary?.totalOrders || metrics.soldOrders || metrics.soldUnits);
    increment("Product content", metrics.contentIssueCount || (Array.isArray(metrics.contentIssues) ? metrics.contentIssues.length : 0));
  });

  if (!counts.size) {
    productList.forEach((product) => {
      (Array.isArray(product.sourceCoverage) ? product.sourceCoverage : []).forEach((source) => {
        increment(normalizeAnalyticsSourceMixLabel(source), 1);
      });
    });
  }

  const rows = Array.from(counts.entries())
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 6);
  const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);

  return {
    total,
    totalLabel: formatDashboardNumber(total),
    rows: rows.map((row) => ({
      ...row,
      value: row.count,
      countLabel: formatDashboardNumber(row.count),
      percent: total ? Math.round((Number(row.count || 0) / total) * 100) : 0,
      percentLabel: total ? `${Math.round((Number(row.count || 0) / total) * 100)}%` : "0%",
    })),
  };
}

function normalizeAnalyticsSourceMixLabel(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("csv")) return "CSV Reviews";
  if (normalized.includes("return")) return "Returns";
  if (normalized.includes("refund")) return "Refunds";
  if (normalized.includes("order")) return "Orders";
  if (normalized.includes("review") || normalized.includes("judge")) return "Reviews";
  if (normalized.includes("content") || normalized.includes("product") || normalized.includes("shopify")) return "Product content";
  return "Other";
}

function buildAnalyticsCollectionMargin(productList) {
  const grouped = new Map();
  productList.forEach((product) => {
    const metrics = product.metrics || {};
    const labels = Array.isArray(metrics.collections) && metrics.collections.length
      ? metrics.collections
      : [product.collection || metrics.productType || "Uncategorized"];
    const value = getDashboardMetric(product, "marginAtRisk");
    if (value <= 0) return;
    labels.slice(0, 2).forEach((label) => {
      grouped.set(label, (grouped.get(label) || 0) + value / Math.min(labels.length, 2));
    });
  });

  return withAnalyticsColors(normalizeDashboardRows(Array.from(grouped.entries()).map(([label, value]) => ({
    label,
    value,
    displayValue: formatDashboardMoney(value),
  })), 6, "No impact yet"));
}

function buildAnalyticsRiskBubbles(productList) {
  const maxImpact = Math.max(...productList.map((product) => getDashboardMetric(product, "marginAtRisk")), 0);
  const maxRevenueAtRisk = Math.max(...productList.map((product) => getDashboardMetric(product, "revenueAtRisk")), 0);
  return productList.slice(0, 24).map((product) => {
    const metrics = product.metrics || {};
    const impact = getDashboardMetric(product, "marginAtRisk");
    const revenueAtRisk = getDashboardMetric(product, "revenueAtRisk");
    const riskScore = Number(product.riskScore || 0);
    const href = `/app/products/${product.handle || product.slug || product.id}`;
    return {
      label: product.title || product.productTitle || "Product",
      href,
      riskScore,
      riskLabel: getRiskLabel(riskScore),
      impact,
      revenueAtRisk,
      issueLabel: getDashboardIssueLabel(product.primaryIssue || metrics.mainIssue || "Product quality"),
      signalCount: Number(metrics.signalCount || metrics.issueCount || 0),
      returnRate: clampDashboardRate(metrics.returnRate),
      refundRate: clampDashboardRate(metrics.refundRate),
      analysisLabel: hasDashboardFullDiagnosis(product) ? "Full diagnosis" : "QuickScan only",
      quadrant: getAnalyticsRiskQuadrant(riskScore, impact, maxImpact),
      x: clampAnalyticsValue(riskScore, 3, 97),
      y: maxImpact ? clampAnalyticsValue(8 + (impact / maxImpact) * 82, 8, 92) : 12,
      size: maxRevenueAtRisk ? Math.round(10 + (revenueAtRisk / maxRevenueAtRisk) * 26) : 10,
      tone: riskScore >= 75 ? "red" : riskScore >= 55 ? "orange" : "green",
    };
  });
}

function getAnalyticsRiskQuadrant(riskScore, marginAtRisk, maxMarginAtRisk) {
  const highRisk = Number(riskScore || 0) >= 75;
  const highImpact = maxMarginAtRisk > 0 && Number(marginAtRisk || 0) >= maxMarginAtRisk * 0.5;
  if (highRisk && highImpact) return "Fix now";
  if (!highRisk && highImpact) return "Monitor";
  if (highRisk) return "Review later";
  return "Low priority";
}

function buildAnalyticsAnalysisCoverage({ totalProducts, fullDiagnoses, quickScanOnly }) {
  return withAnalyticsColors(buildAnalysisDepthRows({ fullDiagnoses, quickScanOnly, totalProducts }));
}

function buildAnalyticsImpactTrend(productList, { windowDays = 90, totalMarginAtRisk = 0 } = {}) {
  const products = (Array.isArray(productList) ? productList : []).filter(Boolean);
  const rows = products.map((product) => ({
    product,
    history: getAnalyticsProductRiskScoreHistory(product),
  }));
  const timeline = getAnalyticsImpactTrendTimeline(rows, { windowDays });
  const marginValues = timeline.map((time) => rows.reduce((sum, row) => {
    const state = getAnalyticsProductRiskStateAtTime(row.history, time);
    if (!state) return sum;
    return sum + Number(state.marginAtRisk || 0);
  }, 0));
  const attentionValues = timeline.map((time) => rows.filter((row) => {
    const state = getAnalyticsProductRiskStateAtTime(row.history, time);
    return state && Number(state.riskScore || 0) >= 55;
  }).length);
  const highValues = timeline.map((time) => rows.filter((row) => {
    const state = getAnalyticsProductRiskStateAtTime(row.history, time);
    return state && Number(state.riskScore || 0) >= 75;
  }).length);
  const mediumValues = timeline.map((time) => rows.filter((row) => {
    const state = getAnalyticsProductRiskStateAtTime(row.history, time);
    const riskScore = Number(state?.riskScore || 0);
    return state && riskScore >= 55 && riskScore < 75;
  }).length);
  const lowValues = timeline.map((time) => rows.filter((row) => {
    const state = getAnalyticsProductRiskStateAtTime(row.history, time);
    return state && Number(state.riskScore || 0) < 55;
  }).length);
  const labels = timeline.map(formatAnalyticsDateLabel);
  const scoreHistoryProducts = rows.filter((row) => row.history.some((point) => point.source === "scoreHistory")).length;
  const usesSavedScoreHistory = scoreHistoryProducts > 0;

  const series = [
    {
      label: "Trend-weighted margin",
      color: "purple",
      axis: "money",
      values: marginValues,
      displayValue: formatDashboardMoney(marginValues[marginValues.length - 1] || 0),
      detail: usesSavedScoreHistory
        ? `Uses saved score-history dates for ${formatDashboardNumber(scoreHistoryProducts)} product${scoreHistoryProducts === 1 ? "" : "s"}; products without a dated score are not counted before their first stored point.`
        : "Reconstructed timeline: current product margin exposure is weighted by each product's stored risk trend. The top KPI remains the current total margin at risk.",
    },
    {
      label: "Products needing attention",
      color: "blue",
      axis: "count",
      values: attentionValues,
      displayValue: formatDashboardNumber(attentionValues[attentionValues.length - 1] || 0),
      detail: "Products whose saved or reconstructed risk score lands in medium or high risk at that date.",
    },
    {
      label: "High risk",
      color: "red",
      axis: "count",
      values: highValues,
      displayValue: formatDashboardNumber(highValues[highValues.length - 1] || 0),
      detail: "Products at or above 75 product risk.",
    },
    {
      label: "Medium risk",
      color: "orange",
      axis: "count",
      values: mediumValues,
      displayValue: formatDashboardNumber(mediumValues[mediumValues.length - 1] || 0),
      detail: "Products from 55 to 74 product risk.",
    },
    {
      label: "Low risk",
      color: "green",
      axis: "count",
      values: lowValues,
      displayValue: formatDashboardNumber(lowValues[lowValues.length - 1] || 0),
      detail: "Products below 55 product risk among products with a score available by that date.",
    },
  ];

  return {
    series,
    labels,
    summary: {
      currentTotalLabel: formatDashboardMoney(totalMarginAtRisk),
      trendWeightedLabel: formatDashboardMoney(marginValues[marginValues.length - 1] || 0),
      countAxisMax: Math.max(products.length, ...attentionValues, ...highValues, ...mediumValues, ...lowValues, 1),
      detail: usesSavedScoreHistory
        ? "Top KPI = current total exposure. Timeline uses saved score-history dates when available; count lines use the products axis."
        : "Top KPI = current total exposure. Trend line = reconstructed exposure shape over time.",
    },
  };
}

function getAnalyticsProductRiskScoreHistory(product = {}) {
  const metrics = product.metrics || {};
  const currentTime = new Date(product.analysisCompletedAt || product.lastAnalysis || metrics.lastSignalAt || Date.now()).getTime();
  const currentRisk = Number(product.riskScore || 0);
  const currentMargin = getDashboardMetric(product, "marginAtRisk");
  const rows = (Array.isArray(metrics.riskHistory) ? metrics.riskHistory : [])
    .map((point) => {
      const time = new Date(point.recordedAt || 0).getTime();
      if (!Number.isFinite(time) || time <= 0) return null;
      const riskScore = Number(point.riskScore ?? currentRisk);
      if (!Number.isFinite(riskScore)) return null;
      const riskWeight = clampAnalyticsValue(riskScore / 100, 0.08, 1);
      const marginAtRisk = point.marginAtRisk != null && Number.isFinite(Number(point.marginAtRisk))
        ? Number(point.marginAtRisk)
        : currentMargin * riskWeight;
      return {
        time,
        riskScore,
        marginAtRisk,
        source: "scoreHistory",
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.time - right.time);

  if (rows.length) {
    if (Number.isFinite(currentTime) && currentTime > 0) {
      const hasCurrentTime = rows.some((point) => Math.abs(point.time - currentTime) < 60 * 1000);
      if (!hasCurrentTime) {
        rows.push({
          time: currentTime,
          riskScore: currentRisk,
          marginAtRisk: currentMargin,
          source: "currentSnapshot",
        });
        rows.sort((left, right) => left.time - right.time);
      }
    }
    return rows;
  }

  const trend = getAnalyticsProductTrendValues(product);
  if (trend.length) {
    const times = getAnalyticsTrendWindowTimes(trend.length, metrics.windowDays || 90, Number.isFinite(currentTime) ? currentTime : Date.now());
    return trend.map((riskScore, index) => ({
      time: times[index],
      riskScore: Number(riskScore || 0),
      marginAtRisk: currentMargin * clampAnalyticsValue(Number(riskScore || 0) / 100, 0.08, 1),
      source: "riskTrend",
    }));
  }

  if (Number.isFinite(currentTime) && currentTime > 0) {
    return [{
      time: currentTime,
      riskScore: currentRisk,
      marginAtRisk: currentMargin,
      source: "currentSnapshot",
    }];
  }

  return [];
}

function getAnalyticsImpactTrendTimeline(rows = [], { windowDays = 90 } = {}) {
  const timestamps = (Array.isArray(rows) ? rows : [])
    .flatMap((row) => (Array.isArray(row.history) ? row.history.map((point) => point.time) : []))
    .filter(Number.isFinite)
    .filter((time) => time > 0);
  const referenceTime = timestamps.length
    ? Math.max(...timestamps)
    : getAnalyticsRiskMarginReferenceTime((Array.isArray(rows) ? rows : []).map((row) => row.product));
  const safeWindowDays = Math.max(1, Math.round(Number(windowDays || 90)));
  const startTime = referenceTime - safeWindowDays * ANALYTICS_DAY_MS;
  const pointCount = getAnalyticsImpactTrendPointCount(safeWindowDays);
  return buildAnalyticsTimeSeriesPoints(startTime, referenceTime, pointCount);
}

function getAnalyticsImpactTrendPointCount(windowDays = 90) {
  const safeWindowDays = Math.max(1, Math.round(Number(windowDays || 90)));
  if (safeWindowDays >= 330) return 13;
  if (safeWindowDays >= 180) return 10;
  if (safeWindowDays >= 90) return 10;
  if (safeWindowDays >= 45) return 9;
  if (safeWindowDays >= 14) return 8;
  return Math.max(2, Math.min(8, safeWindowDays + 1));
}

function getAnalyticsProductRiskStateAtTime(history = [], time = 0) {
  if (!Array.isArray(history) || !history.length || !Number.isFinite(Number(time))) return null;
  let state = null;
  for (const point of history) {
    if (Number(point.time || 0) > time) break;
    state = point;
  }
  return state;
}

function getAnalyticsProductTrendValues(product) {
  const metrics = product.metrics || {};
  const trend = Array.isArray(metrics.riskTrend) && metrics.riskTrend.length
    ? metrics.riskTrend
    : Array.isArray(metrics.signalTrend) && metrics.signalTrend.length
      ? metrics.signalTrend
      : [];
  return trend.map((value) => Number(value || 0)).filter(Number.isFinite);
}

function resizeAnalyticsTrend(values, length, fallbackValue = 0) {
  const cleanValues = Array.isArray(values) && values.length
    ? values.map((value) => Number(value || 0)).filter(Number.isFinite)
    : [Number(fallbackValue || 0)];
  if (cleanValues.length === length) return cleanValues;
  if (cleanValues.length > length) return cleanValues.slice(cleanValues.length - length);
  const first = cleanValues[0] ?? Number(fallbackValue || 0);
  return [
    ...Array.from({ length: Math.max(0, length - cleanValues.length) }, () => first),
    ...cleanValues,
  ];
}

function buildAnalyticsIssueImpact(productList) {
  const grouped = new Map();
  productList.forEach((product) => {
    const metrics = product.metrics || {};
    const contributions = getAnalyticsIssueContributions(product);
    const productLabels = new Set(contributions.map((contribution) => getDashboardIssueLabel(contribution.issue)).filter(Boolean));
    contributions.forEach((contribution) => {
      const label = getDashboardIssueLabel(contribution.issue);
      if (!label) return;
      const current = grouped.get(label) || {
        label,
        products: new Set(),
        marginAtRisk: 0,
        signalCount: 0,
        confidenceTotal: 0,
        confidenceSamples: 0,
      };
      current.products.add(product.id || product.handle || product.title);
      current.signalCount += Math.max(1, Number(contribution.signals || 1));
      current.confidenceTotal += Number(contribution.confidence ?? product.confidence ?? metrics.confidence ?? 0);
      current.confidenceSamples += 1;
      grouped.set(label, current);
    });

    const labels = productLabels.size ? [...productLabels] : ["Product quality"];
    const weightedMargin = getDashboardMetric(product, "marginAtRisk") / Math.max(labels.length, 1);
    labels.forEach((label) => {
      const current = grouped.get(label);
      if (current) current.marginAtRisk += weightedMargin;
    });
  });

  const rows = Array.from(grouped.values())
    .sort((first, second) => second.marginAtRisk - first.marginAtRisk || second.signalCount - first.signalCount)
    .map((row) => {
      const avgConfidence = row.confidenceSamples ? row.confidenceTotal / row.confidenceSamples : 0;
      return {
        label: row.label,
        productsAffected: row.products.size,
        productsAffectedLabel: formatDashboardNumber(row.products.size),
        marginAtRisk: row.marginAtRisk,
        marginAtRiskLabel: formatDashboardMoney(row.marginAtRisk),
        signalCount: row.signalCount,
        signalCountLabel: formatDashboardNumber(row.signalCount),
        avgConfidence,
        avgConfidenceLabel: formatAnalyticsPercent(avgConfidence),
      };
    });

  return rows.length ? rows : [{
    label: "No issue impact yet",
    productsAffected: 0,
    productsAffectedLabel: "0",
    marginAtRisk: 0,
    marginAtRiskLabel: "$0",
    signalCount: 0,
    signalCountLabel: "0",
    avgConfidence: 0,
    avgConfidenceLabel: "0%",
  }];
}

function buildAnalyticsImpactBreakdown(productList) {
  const filters = [
    { key: "collection", label: "By collection" },
    { key: "vendor", label: "By vendor" },
    { key: "productType", label: "By product type" },
    { key: "tag", label: "By tag" },
    { key: "source", label: "By source" },
  ];

  return {
    defaultKey: "collection",
    filters: filters.map((filter) => ({
      ...filter,
      rows: buildAnalyticsImpactBreakdownRows(productList, filter.key),
    })),
  };
}

function buildAnalyticsImpactBreakdownRows(productList, key) {
  const grouped = new Map();
  productList.forEach((product) => {
    const labels = getAnalyticsBreakdownLabels(product, key);
    const marginAtRisk = getDashboardMetric(product, "marginAtRisk");
    const revenueAtRisk = getDashboardMetric(product, "revenueAtRisk");
    const shareCount = Math.max(labels.length, 1);
    labels.forEach((label) => {
      const current = grouped.get(label) || {
        label,
        products: new Set(),
        marginAtRisk: 0,
        revenueAtRisk: 0,
        riskTotal: 0,
        riskSamples: 0,
      };
      current.products.add(product.id || product.handle || product.title);
      current.marginAtRisk += marginAtRisk / shareCount;
      current.revenueAtRisk += revenueAtRisk / shareCount;
      current.riskTotal += Number(product.riskScore || 0);
      current.riskSamples += 1;
      grouped.set(label, current);
    });
  });

  const rows = Array.from(grouped.values())
    .sort((first, second) => second.marginAtRisk - first.marginAtRisk || second.products.size - first.products.size)
    .map((row) => ({
      label: row.label,
      productsAffected: row.products.size,
      productsLabel: `${formatDashboardNumber(row.products.size)} product${row.products.size === 1 ? "" : "s"}`,
      marginAtRisk: row.marginAtRisk,
      marginAtRiskLabel: formatDashboardMoney(row.marginAtRisk),
      revenueAtRisk: row.revenueAtRisk,
      revenueAtRiskLabel: formatDashboardMoney(row.revenueAtRisk),
      avgRisk: row.riskSamples ? Math.round(row.riskTotal / row.riskSamples) : 0,
      value: row.marginAtRisk,
    }));

  return rows.length ? rows : [{
    label: "No impact yet",
    productsAffected: 0,
    productsLabel: "0 products",
    marginAtRisk: 0,
    marginAtRiskLabel: "$0",
    revenueAtRisk: 0,
    revenueAtRiskLabel: "$0",
    avgRisk: 0,
    value: 0,
  }];
}

function getAnalyticsBreakdownLabels(product, key) {
  const metrics = product.metrics || {};
  if (key === "collection") {
    const labels = Array.isArray(metrics.collections) && metrics.collections.length ? metrics.collections : [product.collection || "Uncategorized"];
    return normalizeAnalyticsLabelList(labels, "Uncategorized");
  }
  if (key === "vendor") return normalizeAnalyticsLabelList([metrics.vendor || product.vendor], "Unknown vendor");
  if (key === "productType") return normalizeAnalyticsLabelList([metrics.productType || product.productType || product.collection], "Unknown product type");
  if (key === "tag") return normalizeAnalyticsLabelList(metrics.tags || product.tags, "No tags stored").slice(0, 6);
  if (key === "source") {
    const labels = (Array.isArray(product.sourceCoverage) ? product.sourceCoverage : [])
      .map(normalizeDashboardSourceLabel);
    return normalizeAnalyticsLabelList(labels, "No source coverage");
  }
  return ["Uncategorized"];
}

function normalizeAnalyticsLabelList(values, fallback) {
  const list = (Array.isArray(values) ? values : [values])
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return [...new Set(list.length ? list : [fallback])];
}

function buildAnalyticsActionPerformance(actionRows = []) {
  const counts = actionRows.reduce((summary, action) => {
    summary.suggested += 1;
    if (action.status === "applied") summary.applied += 1;
    else if (action.status === "reviewed") summary.reviewed += 1;
    else if (action.status === "dismissed") summary.dismissed += 1;
    else summary.pending += 1;
    return summary;
  }, { suggested: 0, pending: 0, applied: 0, reviewed: 0, dismissed: 0 });

  const rows = [
    { label: "Suggested", value: counts.suggested, icon: "wand", tone: "purple", detail: "Actions generated from product diagnosis." },
    { label: "Pending", value: counts.pending, icon: "clock", tone: "orange", detail: "Waiting for merchant review or approval." },
    { label: "Applied", value: counts.applied, icon: "check", tone: "green", detail: "Actions already applied to products or workflows." },
    { label: "Reviewed", value: counts.reviewed, icon: "view", tone: "blue", detail: "Manual follow-ups verified without applying a Shopify change." },
    { label: "Dismissed", value: counts.dismissed, icon: "x", tone: "slate", detail: "Actions intentionally ignored or rejected." },
  ];

  return {
    ...counts,
    rows: rows.map((row) => ({ ...row, valueLabel: formatDashboardNumber(row.value) })),
    effectiveness: buildAnalyticsFixEffectiveness(actionRows),
  };
}

function buildAnalyticsActionImpactTrend(actionRows = [], productList = [], { windowDays = 90 } = {}) {
  const appliedRows = (Array.isArray(actionRows) ? actionRows : [])
    .filter((action) => action.status === "applied")
    .map((action) => ({
      ...action,
      time: new Date(action.appliedAt || action.createdAt || 0).getTime(),
    }))
    .filter((action) => Number.isFinite(action.time) && action.time > 0);
  const rowsByProduct = new Map();
  appliedRows.forEach((row) => {
    const product = row.product;
    if (!product) return;
    const key = product.id || product.productGid || product.handle || product.title;
    const current = rowsByProduct.get(key) || { product, rows: [] };
    current.rows.push(row);
    rowsByProduct.set(key, current);
  });
  const effects = Array.from(rowsByProduct.values())
    .map(({ product, rows }) => getAnalyticsProductFixEffect(product, rows))
    .filter(Boolean);
  const productTimestamps = (Array.isArray(productList) ? productList : [])
    .flatMap((product) => [
      product.analysisCompletedAt,
      product.lastAnalysis,
      product.metrics?.lastSignalAt,
      ...(Array.isArray(product.metrics?.riskHistory) ? product.metrics.riskHistory.map((point) => point.recordedAt) : []),
    ])
    .map((value) => new Date(value || 0).getTime())
    .filter((time) => Number.isFinite(time) && time > 0);
  const timestamps = [
    ...appliedRows.map((row) => row.time),
    ...effects.map((effect) => effect.actionTime),
    ...productTimestamps,
  ].filter((time) => Number.isFinite(time) && time > 0);
  const pointCount = Math.min(30, Math.max(7, Math.round(Number(windowDays || 90))));
  const latestTime = timestamps.length ? Math.max(...timestamps) : Date.now();
  const earliestAllowed = latestTime - (Math.max(1, Number(windowDays || 90)) - 1) * 24 * 60 * 60 * 1000;
  const earliestTime = timestamps.length ? Math.max(Math.min(...timestamps), earliestAllowed) : earliestAllowed;
  const timeline = buildAnalyticsTimeSeriesPoints(earliestTime, latestTime, pointCount);
  const actionsAppliedValues = timeline.map((time) => appliedRows.filter((row) => row.time <= time).length);
  const reducedRiskValues = timeline.map((time) => effects.reduce((sum, effect) => {
    if (Number(effect.actionTime || 0) > time) return sum;
    const before = toFiniteAnalyticsNumber(effect.before?.marginAtRisk);
    const after = toFiniteAnalyticsNumber(effect.after?.marginAtRisk);
    if (before === null || after === null) return sum;
    return sum + Math.max(0, before - after);
  }, 0));
  const reducedReturnsValues = timeline.map((time) => {
    const rows = effects
      .filter((effect) => Number(effect.actionTime || 0) <= time)
      .map((effect) => {
        const before = toFiniteAnalyticsNumber(effect.before?.returnRate);
        const after = toFiniteAnalyticsNumber(effect.after?.returnRate);
        if (before === null || after === null) return null;
        return Math.max(0, before - after);
      })
      .filter((value) => value !== null);
    return rows.length ? rows.reduce((sum, value) => sum + value, 0) / rows.length : 0;
  });
  const latestActions = actionsAppliedValues[actionsAppliedValues.length - 1] || 0;
  const latestReducedRisk = reducedRiskValues[reducedRiskValues.length - 1] || 0;
  const latestReducedReturns = reducedReturnsValues[reducedReturnsValues.length - 1] || 0;

  return {
    hasData: appliedRows.length > 0 || effects.length > 0,
    labels: timeline.map(formatAnalyticsDateLabel),
    pointDetails: timeline.map((time) => {
      const appliedByPoint = appliedRows.filter((row) => Number(row.time || 0) <= time).length;
      const measuredByPoint = effects.filter((effect) => Number(effect.actionTime || 0) <= time).length;
      return {
        label: formatAnalyticsDateLabel(time),
        sourceLabel: "Applied recommendation history",
        basisLabel: measuredByPoint
          ? `${formatDashboardNumber(measuredByPoint)} product${measuredByPoint === 1 ? "" : "s"} compared against saved pre-action baselines.`
          : `${formatDashboardNumber(appliedByPoint)} applied action${appliedByPoint === 1 ? "" : "s"} recorded by this date; before/after impact is still pending.`,
      };
    }),
    summary: {
      actionsApplied: latestActions,
      actionsAppliedLabel: formatDashboardNumber(latestActions),
      reducedRisk: latestReducedRisk,
      reducedRiskLabel: formatDashboardMoney(latestReducedRisk),
      reducedReturns: latestReducedReturns,
      reducedReturnsLabel: formatDashboardRate(latestReducedReturns),
      detail: effects.length
        ? `${formatDashboardNumber(effects.length)} product${effects.length === 1 ? "" : "s"} compared against a saved pre-action baseline.`
        : "Action timing is available, but before/after risk history is still needed to measure impact.",
    },
    series: [
      {
        key: "actionsApplied",
        label: "Actions applied",
        color: "purple",
        axis: "count",
        values: actionsAppliedValues,
        displayValue: formatDashboardNumber(latestActions),
      },
      {
        key: "reducedRiskUsd",
        label: "Reduced risk (USD)",
        color: "green",
        axis: "money",
        values: reducedRiskValues,
        displayValue: formatDashboardMoney(latestReducedRisk),
      },
      {
        key: "reducedReturns",
        label: "Reduced returns",
        color: "blue",
        axis: "percent",
        values: reducedReturnsValues,
        displayValue: formatDashboardRate(latestReducedReturns),
      },
    ],
  };
}

function buildAnalyticsTimeSeriesPoints(startTime, endTime, pointCount) {
  const count = Math.max(1, Math.round(Number(pointCount || 1)));
  const safeEnd = Number.isFinite(endTime) ? endTime : Date.now();
  const safeStart = Number.isFinite(startTime) && startTime < safeEnd
    ? startTime
    : safeEnd - (count - 1) * 24 * 60 * 60 * 1000;
  if (count === 1) return [safeEnd];
  const step = (safeEnd - safeStart) / Math.max(count - 1, 1);
  return Array.from({ length: count }, (_, index) => Math.round(safeStart + index * step));
}

function buildAnalyticsFixEffectiveness(actionRows = []) {
  const appliedRows = actionRows.filter((action) => action.status === "applied");
  if (!appliedRows.length) {
    return [
      { label: "Fix effectiveness", value: "Waiting for applied actions", detail: "Apply at least one recommended action to start measuring before/after outcomes." },
    ];
  }

  const rowsByProduct = new Map();
  appliedRows.forEach((row) => {
    const product = row.product;
    if (!product) return;
    const key = product.id || product.productGid || product.handle || product.title;
    const current = rowsByProduct.get(key) || { product, rows: [] };
    current.rows.push(row);
    rowsByProduct.set(key, current);
  });

  const effects = Array.from(rowsByProduct.values())
    .map(({ product, rows }) => getAnalyticsProductFixEffect(product, rows))
    .filter(Boolean);

  if (!effects.length) {
    return [
      {
        label: "Fix effectiveness",
        value: "Waiting for historical baseline",
        detail: `${formatDashboardNumber(appliedRows.length)} applied action${appliedRows.length === 1 ? "" : "s"} found, but no before/after risk history is available yet.`,
      },
    ];
  }

  return [
    summarizeAnalyticsFixEffect(effects, {
      label: "Product risk change",
      key: "riskScore",
      formatter: formatDashboardPointChange,
      detail: (summary) => `${formatDashboardNumber(summary.count)} product${summary.count === 1 ? "" : "s"} compared against pre-action risk.`,
      mode: "average",
    }),
    summarizeAnalyticsFixEffect(effects, {
      label: "Post-fix return rate",
      key: "returnRate",
      formatter: formatDashboardPercentPointChange,
      detail: (summary) => `${formatDashboardRate(summary.before)} before vs. ${formatDashboardRate(summary.after)} current across products with return-rate history.`,
      mode: "average",
      fallback: {
        value: "No return baseline",
        detail: "Applied actions exist, but historical return-rate values are not available for those products yet.",
      },
    }),
    summarizeAnalyticsFixEffect(effects, {
      label: "Margin at risk reduced",
      key: "marginAtRisk",
      formatter: formatDashboardMoneyChange,
      detail: (summary) => `${formatDashboardMoney(summary.before)} before vs. ${formatDashboardMoney(summary.after)} current margin exposure.`,
      mode: "sum",
    }),
  ];
}

function getAnalyticsProductFixEffect(product = {}, appliedRows = []) {
  const metrics = product.metrics || {};
  const history = (Array.isArray(metrics.riskHistory) ? metrics.riskHistory : [])
    .map((point) => ({
      ...point,
      time: new Date(point.recordedAt || 0).getTime(),
    }))
    .filter((point) => Number.isFinite(point.time) && point.time > 0)
    .sort((first, second) => first.time - second.time);

  if (!history.length) return null;

  const actionTimes = appliedRows
    .map((row) => new Date(row.appliedAt || row.createdAt || 0).getTime())
    .filter((time) => Number.isFinite(time) && time > 0);
  const firstActionTime = actionTimes.length ? Math.min(...actionTimes) : history[history.length - 1].time;
  const baseline = findAnalyticsEffectBaselinePoint(history, firstActionTime);
  if (!baseline) return null;

  const current = {
    riskScore: toFiniteAnalyticsNumber(product.riskScore),
    returnRate: toFiniteAnalyticsNumber(metrics.returnRate),
    marginAtRisk: getDashboardMetric(product, "marginAtRisk"),
  };

  const before = {
    riskScore: toFiniteAnalyticsNumber(baseline.riskScore),
    returnRate: toFiniteAnalyticsNumber(baseline.returnRate),
    marginAtRisk: toFiniteAnalyticsNumber(baseline.marginAtRisk),
  };

  return {
    product,
    actionCount: appliedRows.length,
    actionTime: firstActionTime,
    before,
    after: current,
  };
}

function findAnalyticsEffectBaselinePoint(history = [], actionTime = 0) {
  const beforeAction = history.filter((point) => point.time <= actionTime);
  if (beforeAction.length) return beforeAction[beforeAction.length - 1];
  if (history.length > 1) return history[Math.max(0, history.length - 2)];
  return history[0] || null;
}

function summarizeAnalyticsFixEffect(effects = [], options = {}) {
  const rows = effects
    .map((effect) => ({
      before: toFiniteAnalyticsNumber(effect.before?.[options.key]),
      after: toFiniteAnalyticsNumber(effect.after?.[options.key]),
    }))
    .filter((row) => row.before !== null && row.after !== null);

  if (!rows.length) {
    return {
      label: options.label,
      value: options.fallback?.value || "Waiting",
      detail: options.fallback?.detail || "Not enough before/after data is available yet.",
    };
  }

  const before = options.mode === "sum"
    ? rows.reduce((total, row) => total + row.before, 0)
    : rows.reduce((total, row) => total + row.before, 0) / rows.length;
  const after = options.mode === "sum"
    ? rows.reduce((total, row) => total + row.after, 0)
    : rows.reduce((total, row) => total + row.after, 0) / rows.length;
  const delta = before - after;

  return {
    label: options.label,
    value: options.formatter ? options.formatter(delta) : formatDashboardNumber(delta),
    detail: typeof options.detail === "function"
      ? options.detail({ before, after, delta, count: rows.length })
      : options.detail,
  };
}

function toFiniteAnalyticsNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatDashboardPointChange(value) {
  const rounded = Math.round(Number(value || 0));
  if (rounded > 0) return `Down ${formatDashboardNumber(rounded)} pts`;
  if (rounded < 0) return `Up ${formatDashboardNumber(Math.abs(rounded))} pts`;
  return "No change";
}

function formatDashboardPercentPointChange(value) {
  const rounded = Math.round(Number(value || 0) * 10) / 10;
  if (rounded > 0) return `Down ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(rounded)} pts`;
  if (rounded < 0) return `Up ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(Math.abs(rounded))} pts`;
  return "No change";
}

function formatDashboardMoneyChange(value) {
  const amount = Number(value || 0);
  if (amount > 0) return `${formatDashboardMoney(amount)} lower`;
  if (amount < 0) return `${formatDashboardMoney(Math.abs(amount))} higher`;
  return "No change";
}

function buildAnalyticsCatalogCoverage(productList, { totalProducts, fullDiagnoses, quickScanOnly, catalogProductCount }) {
  const analyzed = totalProducts;
  const full = fullDiagnoses.length;
  const quick = quickScanOnly.length;
  const productsWithoutReviews = productList.filter((product) => Number(product.metrics?.reviewCount || product.metrics?.csvReviewCount || product.metrics?.csvReviewRatingCount || 0) <= 0).length;
  const productsWithReturns = productList.filter((product) => Number(product.metrics?.returnUnits || 0) > 0).length;
  const catalogTotal = Math.max(Number(catalogProductCount || analyzed || 0), analyzed);
  const notAnalyzed = Math.max(catalogTotal - analyzed, 0);
  return {
    analyzed,
    analyzedLabel: `${formatDashboardNumber(analyzed)} / ${formatDashboardNumber(catalogTotal)} products analyzed`,
    fullDiagnoses: full,
    quickScanOnly: quick,
    notAnalyzed,
    productsWithoutReviews,
    productsWithReturns,
    rows: [
      { label: "Full diagnoses", value: full, total: Math.max(analyzed, 1), valueLabel: formatDashboardNumber(full), tone: "purple" },
      { label: "QuickScan only", value: quick, total: Math.max(analyzed, 1), valueLabel: formatDashboardNumber(quick), tone: "blue" },
      { label: "Not analyzed", value: notAnalyzed, total: Math.max(analyzed + notAnalyzed, 1), valueLabel: formatDashboardNumber(notAnalyzed), tone: "slate" },
      { label: "No review signals yet", value: productsWithoutReviews, total: Math.max(analyzed, 1), valueLabel: formatDashboardNumber(productsWithoutReviews), tone: productsWithoutReviews ? "slate" : "green" },
      { label: "Products with return signals", value: productsWithReturns, total: Math.max(analyzed, 1), valueLabel: formatDashboardNumber(productsWithReturns), tone: productsWithReturns ? "orange" : "slate" },
    ],
  };
}

function hasAnalyticsSource(product, sourceLabel) {
  const normalizedNeedle = normalizeDashboardSourceLabel(sourceLabel);
  return (Array.isArray(product.sourceCoverage) ? product.sourceCoverage : [])
    .some((source) => normalizeDashboardSourceLabel(source) === normalizedNeedle);
}

function buildAnalyticsEvidenceSourceCoverage(productList, sources = []) {
  const sourceRows = [
    {
      label: "Customer language",
      icon: "note",
      count: productList.reduce((sum, product) => sum + Number(product.metrics?.textInsights?.sentiment?.total || product.metrics?.customerTextSignals || 0), 0),
      products: productList.filter((product) => Number(product.metrics?.textInsights?.sentiment?.total || product.metrics?.customerTextSignals || 0) > 0).length,
      detail: "Return notes, review text and imported customer language used for sentiment and issue clustering.",
    },
    {
      label: "Reviews",
      icon: "star",
      count: productList.reduce((sum, product) => sum + Number(product.metrics?.reviewCount || product.metrics?.csvReviewCount || product.metrics?.csvReviewRatingCount || 0), 0),
      products: productList.filter((product) => hasAnalyticsSource(product, "Reviews")).length,
      detail: "Judge.me and uploaded CSV reviews matched to stored products.",
    },
    {
      label: "Returns",
      icon: "return",
      count: productList.reduce((sum, product) => sum + Number(product.metrics?.returnUnits || 0), 0),
      products: productList.filter((product) => hasAnalyticsSource(product, "Returns")).length,
      detail: "Shopify return line items and return reasons available in the diagnosis window.",
    },
    {
      label: "Refunds",
      icon: "cash-dollar",
      count: productList.reduce((sum, product) => sum + Number(product.metrics?.refundUnits || 0), 0),
      products: productList.filter((product) => hasAnalyticsSource(product, "Refunds")).length,
      detail: "Shopify refunds contributing financial and operational evidence.",
    },
    {
      label: "Product data",
      icon: "product",
      count: productList.length,
      products: productList.length,
      detail: "Shopify title, product type, variants, tags, collections and product copy.",
    },
    {
      label: "SEO / product content",
      icon: "search",
      count: productList.reduce((sum, product) => sum + Number(product.metrics?.contentIssueCount || product.metrics?.descriptionWords || 0), 0),
      products: productList.filter((product) => Number(product.metrics?.contentIssueCount || product.metrics?.descriptionWords || 0) > 0).length,
      detail: "Product description and catalog-content checks used to identify buyer expectation gaps.",
    },
  ];

  const totalEvidence = sourceRows.reduce((sum, row) => sum + Math.max(0, Number(row.count || 0)), 0);
  return sourceRows.map((row) => {
    const percent = totalEvidence ? Math.round((Math.max(0, Number(row.count || 0)) / totalEvidence) * 100) : 0;
    const state = getAnalyticsSourceState(row, productList, sources);
    return {
      ...row,
      percent,
      percentLabel: `${percent}%`,
      countLabel: formatDashboardNumber(row.count),
      productsLabel: `${formatDashboardNumber(row.products)} product${row.products === 1 ? "" : "s"}`,
      state,
      stateTone: state === "Connected" ? "green" : state === "Partial" ? "orange" : state === "Stale" ? "orange" : "slate",
    };
  });
}

function getAnalyticsSourceState(row, productList, sources = []) {
  const sourceRecords = Array.isArray(sources) ? sources : [];
  const sourceLabel = normalizeDashboardSourceLabel(row.label);
  const matchingSource = sourceRecords.find((source) => normalizeDashboardSourceLabel(source.label || source.name || source.sourceKey) === sourceLabel);
  if (matchingSource?.active === false || matchingSource?.ignored === true) return "Missing";
  if (!productList.length) return "Missing";
  if (row.products >= productList.length) return "Connected";
  if (row.products > 0) return "Partial";
  return "Missing";
}

function buildAnalyticsTopProductsAtRisk(productList, actionRows = []) {
  const maxMarginRisk = Math.max(...productList.map((product) => getDashboardMetric(product, "marginAtRisk")), 0);
  return [...productList]
    .sort((first, second) => getDashboardPriorityScore(second, { maxMarginRisk }) - getDashboardPriorityScore(first, { maxMarginRisk }))
    .slice(0, 5)
    .map((product) => {
      const productActions = actionRows.filter((action) => action.product === product);
      const pendingAction = productActions.find((action) => action.status === "pending");
      const appliedAction = productActions.find((action) => action.status === "applied");
      const status = product.resolvedAt
        ? "Resolved"
        : pendingAction
          ? "Pending action"
          : hasDashboardFullDiagnosis(product)
            ? "Full diagnosis"
            : "QuickScan only";
      return {
        id: product.id || product.handle || product.slug || product.title,
        title: product.title || product.productTitle || "Product",
        href: `/app/products/${product.handle || product.slug || product.id}`,
        riskScore: Number(product.riskScore || 0),
        riskLabel: getRiskLabel(Number(product.riskScore || 0)),
        riskTone: getRiskTone(Number(product.riskScore || 0)),
        marginAtRisk: getDashboardMetric(product, "marginAtRisk"),
        marginAtRiskLabel: formatDashboardMoney(getDashboardMetric(product, "marginAtRisk")),
        revenueAtRisk: getDashboardMetric(product, "revenueAtRisk"),
        revenueAtRiskLabel: formatDashboardMoney(getDashboardMetric(product, "revenueAtRisk")),
        mainIssue: getDashboardIssueLabel(product.primaryIssue || product.metrics?.mainIssue || "Product quality"),
        confidence: Number(product.confidence || product.metrics?.confidence || 0),
        confidenceLabel: formatAnalyticsPercent(product.confidence || product.metrics?.confidence || 0),
        recommendedAction: pendingAction?.label || appliedAction?.label || (hasDashboardFullDiagnosis(product) ? "Review diagnosis" : "Run full diagnosis"),
        status,
        statusTone: status === "Resolved" ? "green" : status === "Pending action" ? "orange" : hasDashboardFullDiagnosis(product) ? "purple" : "blue",
        priorityScore: getDashboardPriorityScore(product, { maxMarginRisk }),
      };
    });
}

function buildAnalysisDepthRows({ fullDiagnoses, quickScanOnly, totalProducts }) {
  const full = Array.isArray(fullDiagnoses) ? fullDiagnoses.length : Number(fullDiagnoses || 0);
  const explicitQuick = Array.isArray(quickScanOnly) ? quickScanOnly.length : Number(quickScanOnly || 0);
  const total = Number(totalProducts || 0);
  const quick = total > 0 ? Math.max(explicitQuick, total - full) : explicitQuick;
  const scannedTotal = Math.max(full + quick, 0);
  if (!scannedTotal) {
    return [
      { label: "Full diagnosis", value: 0, percent: 0, pct: 0, displayValue: "0%" },
      { label: "QuickScan only", value: 0, percent: 0, pct: 0, displayValue: "0%" },
    ];
  }
  return [
    {
      label: "Full diagnosis",
      value: full,
      percent: Math.round((full / scannedTotal) * 100),
      pct: Math.round((full / scannedTotal) * 100),
      displayValue: `${formatDashboardNumber(full)} (${formatAnalyticsPercent((full / scannedTotal) * 100)})`,
      color: "purple",
    },
    {
      label: "QuickScan only",
      value: quick,
      percent: Math.round((quick / scannedTotal) * 100),
      pct: Math.round((quick / scannedTotal) * 100),
      displayValue: `${formatDashboardNumber(quick)} (${formatAnalyticsPercent((quick / scannedTotal) * 100)})`,
      color: "blue",
    },
  ];
}

function buildAnalyticsTopInsights({ productList, issueDistribution, highRiskProducts, sourceContribution, fullDiagnoses, totalProducts }) {
  const insights = [];
  const topIssue = issueDistribution[0];
  if (topIssue && Number(topIssue.value || 0) > 0) {
    insights.push({
      icon: "lightbulb",
      text: `${topIssue.label} is the largest detected issue cluster with ${formatDashboardNumber(topIssue.value)} stored signal${Number(topIssue.value) === 1 ? "" : "s"}.`,
    });
  }
  if (highRiskProducts.length) {
    const highRiskImpact = highRiskProducts.reduce((sum, product) => sum + getDashboardMetric(product, "marginAtRisk"), 0);
    insights.push({
      icon: "alert-circle",
      text: `${formatDashboardNumber(highRiskProducts.length)} high-risk product${highRiskProducts.length === 1 ? "" : "s"} represent ${formatDashboardMoney(highRiskImpact)} of estimated margin at risk.`,
    });
  }
  const topSource = sourceContribution.rows[0];
  if (topSource) {
    insights.push({
      icon: "target",
      text: `${topSource.label} is currently the strongest evidence source, contributing ${topSource.percent}% of extracted signals.`,
    });
  }
  const fullCoverage = totalProducts ? Math.round((fullDiagnoses.length / totalProducts) * 100) : 0;
  insights.push({
    icon: fullCoverage >= 50 ? "shield-check-mark" : "wand",
    text: `${formatAnalyticsPercent(fullCoverage)} of stored products have a full diagnosis; remaining QuickScan products still need deep analysis before final recommendations.`,
  });

  if (!productList.length) {
    return [{ icon: "info", text: "Run QuickScan to populate Analytics with product risk, impact and source contribution data." }];
  }
  return insights.slice(0, 4);
}

function buildAnalyticsBusinessImpactMetrics({ totals, windowDays, productList }) {
  const projectedReturnUnits = productList.reduce((sum, product) => {
    const metrics = product.metrics || {};
    const productWindow = Number(metrics.windowDays || windowDays || 90);
    return sum + Number(metrics.returnUnits || 0) * (windowDays / Math.max(productWindow, 1));
  }, 0);
  const actionCoverage = totals.openActions + totals.appliedActions + totals.reviewedActions + totals.dismissedActions;
  return [
    {
      label: "Revenue at risk",
      value: formatDashboardMoney(totals.revenueAtRisk),
      icon: "cash-dollar",
      tone: totals.revenueAtRisk > 0 ? "purple" : "blue",
      detail: "Projected revenue exposure from returns, refunds, reviews and basket context.",
    },
    {
      label: "Margin at risk",
      value: formatDashboardMoney(totals.marginAtRisk),
      icon: "chart-line",
      tone: totals.marginAtRisk > 0 ? "green" : "blue",
      detail: "Estimated margin and operating-cost exposure from products needing attention.",
    },
    {
      label: "Potential returns",
      value: `~${formatDashboardNumber(projectedReturnUnits)}`,
      icon: "package",
      tone: projectedReturnUnits > 0 ? "orange" : "green",
      detail: `Projected over ${windowDays} days from stored return units.`,
    },
    {
      label: "Recommended actions",
      value: formatDashboardNumber(actionCoverage),
      icon: "wand",
      tone: totals.openActions ? "purple" : "green",
      detail: `${formatDashboardNumber(totals.openActions)} open, ${formatDashboardNumber(totals.appliedActions)} applied, ${formatDashboardNumber(totals.reviewedActions)} reviewed, ${formatDashboardNumber(totals.dismissedActions)} dismissed.`,
    },
  ];
}

function buildAnalyticsBusinessImpactCalculation({ totals, windowDays, productList, actionRows = [] }) {
  const impactTotals = productList.reduce((summary, product) => {
    const metrics = product.metrics || {};
    const impact = metrics.impactFactors || metrics.estimatedImpactFactors || {};
    const productWindow = Number(metrics.windowDays || windowDays || 90);
    const projectedReturnUnits = Number(metrics.returnUnits || 0) * (windowDays / Math.max(productWindow, 1));
    const revenueAtRisk = getDashboardMetric(product, "revenueAtRisk");
    const marginAtRisk = getDashboardMetric(product, "marginAtRisk");
    const avgUnitRevenue = firstFiniteBusinessImpactNumber(
      impact.avgUnitRevenue,
      metrics.avgUnitRevenue,
      Number(metrics.soldUnits || 0) > 0 ? Number(metrics.salesAmount || 0) / Number(metrics.soldUnits || 1) : 0,
    );
    const confirmedRefundAmount = firstFiniteBusinessImpactNumber(impact.refunds, impact.relationshipExposure?.confirmedRefundAmount, metrics.refundAmount);
    const relationshipAdjustedRefundAmount = firstFiniteBusinessImpactNumber(impact.refundValueAtRisk, impact.relationshipExposure?.relationshipAdjustedRefundAmount, confirmedRefundAmount);
    const projectedLostRevenue = firstFiniteBusinessImpactNumber(impact.projectedLostRevenue);
    const returnRevenueExposure = firstFiniteBusinessImpactNumber(impact.returnRevenueExposure, Number(metrics.returnUnits || 0) * avgUnitRevenue);
    const reviewConversionRevenueDrag = firstFiniteBusinessImpactNumber(impact.reviewConversionRevenueDrag);
    const purchaseContextRevenueExposure = firstFiniteBusinessImpactNumber(impact.purchaseContextExposure?.bulkRevenueExposure);
    const projectedLostMargin = firstFiniteBusinessImpactNumber(impact.projectedLostMargin, impact.projectedReturnLoss);
    const refundMarginLoss = firstFiniteBusinessImpactNumber(impact.refundMarginLoss, confirmedRefundAmount * firstFiniteBusinessImpactNumber(impact.marginRate, metrics.marginRate, 0.45));
    const returnProcessingCost = firstFiniteBusinessImpactNumber(impact.returnProcessingCost);
    const reviewConversionMarginDrag = firstFiniteBusinessImpactNumber(impact.reviewConversionMarginDrag, impact.reviewConversionDrag);
    const purchaseContextMarginExposure = firstFiniteBusinessImpactNumber(impact.purchaseContextExposure?.bulkQuantityExposure);
    const revenueComponentTotal = projectedLostRevenue
      + returnRevenueExposure
      + reviewConversionRevenueDrag
      + relationshipAdjustedRefundAmount
      + purchaseContextRevenueExposure;
    const marginComponentTotal = projectedLostMargin
      + refundMarginLoss
      + returnProcessingCost
      + reviewConversionMarginDrag
      + purchaseContextMarginExposure;

    summary.projectedReturnUnits += projectedReturnUnits;
    summary.confirmedRefundAmount += confirmedRefundAmount;
    summary.relationshipAdjustedRefundAmount += relationshipAdjustedRefundAmount;
    summary.projectedReturnExposure += projectedLostRevenue;
    summary.returnRevenueExposure += returnRevenueExposure;
    summary.reviewConversionDrag += reviewConversionRevenueDrag;
    summary.purchaseContextRevenueExposure += purchaseContextRevenueExposure;
    summary.projectedReturnMarginLoss += projectedLostMargin;
    summary.refundMarginLoss += refundMarginLoss;
    summary.returnProcessingCost += returnProcessingCost;
    summary.reviewConversionMarginDrag += reviewConversionMarginDrag;
    summary.purchaseContextMarginExposure += purchaseContextMarginExposure;
    summary.storedRevenueExposure += Math.max(0, revenueAtRisk - revenueComponentTotal);
    summary.storedMarginExposure += Math.max(0, marginAtRisk - marginComponentTotal);
    const trendValues = Array.isArray(metrics.riskTrend) && metrics.riskTrend.length
      ? metrics.riskTrend
      : Array.isArray(metrics.signalTrend) && metrics.signalTrend.length
        ? metrics.signalTrend
        : [];
    summary.productsWithTrend += trendValues.length ? 1 : 0;
    summary.productsWithMargin += Number(metrics.marginAtRisk || impact.marginAtRisk || 0) > 0 ? 1 : 0;
    summary.confidenceSum += Number(product.confidence || metrics.confidence || 0);
    summary.productRows.push({
      id: product.id,
      title: product.title,
      riskScore: Number(product.riskScore || 0),
      confidence: Number(product.confidence || metrics.confidence || 0),
      revenueAtRisk,
      marginAtRisk,
      refundAmount: confirmedRefundAmount,
      returnUnits: Number(metrics.returnUnits || 0),
      sourceCoverage: Array.isArray(product.sourceCoverage) ? product.sourceCoverage.length : 0,
      calculatedAt: product.lastAnalysis || metrics.lastSignalAt || product.analysisCompletedAt || "",
    });
    return summary;
  }, {
    confirmedRefundAmount: 0,
    relationshipAdjustedRefundAmount: 0,
    projectedReturnExposure: 0,
    returnRevenueExposure: 0,
    reviewConversionDrag: 0,
    purchaseContextRevenueExposure: 0,
    projectedReturnMarginLoss: 0,
    refundMarginLoss: 0,
    returnProcessingCost: 0,
    reviewConversionMarginDrag: 0,
    purchaseContextMarginExposure: 0,
    storedRevenueExposure: 0,
    storedMarginExposure: 0,
    projectedReturnUnits: 0,
    productsWithTrend: 0,
    productsWithMargin: 0,
    confidenceSum: 0,
    productRows: [],
  });

  const openActions = totals.openActions || 0;
  const appliedActions = totals.appliedActions || 0;
  const reviewedActions = totals.reviewedActions || 0;
  const dismissedActions = totals.dismissedActions || 0;
  const totalActions = actionRows.length || openActions + appliedActions + reviewedActions + dismissedActions;
  const averageConfidence = productList.length ? impactTotals.confidenceSum / productList.length : 0;
  const availableInputCount = [
    productList.length,
    totals.returnUnits,
    totals.refundAmount,
    totals.reviewCount,
    totals.negativeReviewCount,
    totals.contentIssueCount,
    totals.customerTextSignals,
    impactTotals.productsWithTrend,
    totalActions,
  ].filter((value) => Number(value || 0) > 0).length;
  const confidenceScore = Math.min(100, Math.round(
    18
      + availableInputCount * 6
      + Math.min(22, averageConfidence * 0.22)
      + Math.min(16, Math.log1p(Math.max(totals.soldUnits + totals.returnUnits + totals.reviewCount, 0)) * 4),
  ));

  return {
    windowLabel: `Next ${windowDays} days`,
    formulas: [
      { label: "Revenue at risk", expression: "max(projected lost revenue + return revenue exposure + review conversion revenue drag + relationship-adjusted refund exposure + basket/bulk revenue exposure, stored revenueAtRisk)" },
      { label: "Margin at risk", expression: "max(projected lost margin + refund margin loss + return processing cost + review conversion margin drag + basket/bulk margin exposure, stored marginAtRisk)" },
      { label: "Potential returns", expression: "return units x analytics projection window / product source window" },
      { label: "Recommended actions", expression: "open actions + applied actions + reviewed actions + dismissed actions" },
    ],
    currentBreakdown: [
      {
        label: "Revenue at risk",
        value: totals.revenueAtRisk,
        valueLabel: formatDashboardMoney(totals.revenueAtRisk),
        components: [
          { label: "Projected lost revenue", value: impactTotals.projectedReturnExposure, valueLabel: formatDashboardMoney(impactTotals.projectedReturnExposure) },
          { label: "Return revenue exposure", value: impactTotals.returnRevenueExposure, valueLabel: formatDashboardMoney(impactTotals.returnRevenueExposure) },
          { label: "Review conversion revenue drag", value: impactTotals.reviewConversionDrag, valueLabel: formatDashboardMoney(impactTotals.reviewConversionDrag) },
          { label: "Relationship-adjusted refund exposure", value: impactTotals.relationshipAdjustedRefundAmount, valueLabel: formatDashboardMoney(impactTotals.relationshipAdjustedRefundAmount) },
          { label: "Basket/bulk revenue exposure", value: impactTotals.purchaseContextRevenueExposure, valueLabel: formatDashboardMoney(impactTotals.purchaseContextRevenueExposure) },
          { label: "Stored/fallback revenue exposure", value: impactTotals.storedRevenueExposure, valueLabel: formatDashboardMoney(impactTotals.storedRevenueExposure) },
        ],
      },
      {
        label: "Margin at risk",
        value: totals.marginAtRisk,
        valueLabel: formatDashboardMoney(totals.marginAtRisk),
        components: [
          { label: "Projected return margin loss", value: impactTotals.projectedReturnMarginLoss, valueLabel: formatDashboardMoney(impactTotals.projectedReturnMarginLoss) },
          { label: "Refund margin loss", value: impactTotals.refundMarginLoss, valueLabel: formatDashboardMoney(impactTotals.refundMarginLoss) },
          { label: "Return processing cost", value: impactTotals.returnProcessingCost, valueLabel: formatDashboardMoney(impactTotals.returnProcessingCost) },
          { label: "Review conversion margin drag", value: impactTotals.reviewConversionMarginDrag, valueLabel: formatDashboardMoney(impactTotals.reviewConversionMarginDrag) },
          { label: "Basket/bulk margin exposure", value: impactTotals.purchaseContextMarginExposure, valueLabel: formatDashboardMoney(impactTotals.purchaseContextMarginExposure) },
          { label: "Stored/fallback margin exposure", value: impactTotals.storedMarginExposure, valueLabel: formatDashboardMoney(impactTotals.storedMarginExposure) },
        ],
      },
      {
        label: "Potential returns",
        value: impactTotals.projectedReturnUnits,
        valueLabel: `~${formatDashboardNumber(impactTotals.projectedReturnUnits)}`,
        components: [
          { label: "Products analyzed", value: productList.length, valueLabel: formatDashboardNumber(productList.length) },
          { label: "Return signals", value: totals.returnUnits, valueLabel: formatDashboardNumber(totals.returnUnits) },
          { label: "Active return window", value: windowDays, valueLabel: `${windowDays} days` },
          { label: "Projected affected units", value: impactTotals.projectedReturnUnits, valueLabel: formatDashboardNumber(impactTotals.projectedReturnUnits) },
        ],
      },
      {
        label: "Recommended actions",
        value: totalActions,
        valueLabel: formatDashboardNumber(totalActions),
        components: [
          { label: "Open actions", value: openActions, valueLabel: formatDashboardNumber(openActions) },
          { label: "Applied actions", value: appliedActions, valueLabel: formatDashboardNumber(appliedActions) },
          { label: "Reviewed actions", value: reviewedActions, valueLabel: formatDashboardNumber(reviewedActions) },
          { label: "Dismissed actions", value: dismissedActions, valueLabel: formatDashboardNumber(dismissedActions) },
          { label: "Pending review actions", value: openActions, valueLabel: formatDashboardNumber(openActions) },
        ],
      },
    ],
    inputs: [
      buildAnalyticsImpactInput("Product risk score", productList.length ? "Available" : "Missing", `${formatDashboardNumber(productList.length)} stored product scores`),
      buildAnalyticsImpactInput("Return rate", totals.soldUnits > 0 ? "Available" : totals.returnUnits > 0 ? "Estimated" : "Missing", `${formatDashboardNumber(totals.returnUnits)} return units / ${formatDashboardNumber(totals.soldUnits)} sold units`),
      buildAnalyticsImpactInput("Refund value", totals.refundAmount > 0 ? "Available" : "Missing", formatDashboardMoney(totals.refundAmount)),
      buildAnalyticsImpactInput("Review sentiment", totals.reviewCount > 0 ? "Available" : "Missing", `${formatDashboardNumber(totals.negativeReviewCount)} negative / ${formatDashboardNumber(totals.reviewCount)} reviews`),
      buildAnalyticsImpactInput("Negative review volume", totals.negativeReviewCount > 0 ? "Available" : "Not used", `${formatDashboardNumber(totals.negativeReviewCount)} negative reviews`),
      buildAnalyticsImpactInput("Product content issues", totals.contentIssueCount > 0 ? "Available" : "Not used", `${formatDashboardNumber(totals.contentIssueCount)} content issues`),
      buildAnalyticsImpactInput("Customer language signals", totals.customerTextSignals > 0 ? "Available" : "Not used", `${formatDashboardNumber(totals.customerTextSignals)} text signals`),
      buildAnalyticsImpactInput("Recent trend", impactTotals.productsWithTrend > 0 ? "Available" : "Estimated", `${formatDashboardNumber(impactTotals.productsWithTrend)} products with stored trend data`),
      buildAnalyticsImpactInput("Margin estimate", productList.length && impactTotals.productsWithMargin === productList.length ? "Available" : impactTotals.productsWithMargin > 0 ? "Estimated" : "Missing", `${formatDashboardNumber(impactTotals.productsWithMargin)} products with explicit margin exposure`),
      buildAnalyticsImpactInput("Recommended action status", totalActions > 0 ? "Available" : "Not used", `${formatDashboardNumber(totalActions)} stored actions`),
    ],
    confidence: {
      label: confidenceScore >= 75 ? "High" : confidenceScore >= 50 ? "Medium" : "Low",
      score: confidenceScore,
      drivers: [
        `${formatDashboardNumber(productList.length)} products in the analytics set`,
        `${formatDashboardNumber(availableInputCount)} input groups available`,
        `${formatDashboardNumber(totals.returnUnits + totals.refundUnits + totals.reviewCount)} observed evidence events`,
        impactTotals.productsWithMargin ? "Margin exposure is available for at least part of the set" : "Margin exposure uses conservative estimates",
      ],
    },
    assumptions: [
      `Projection window: ${windowDays} days`,
      "Uses stored QuickScan and full diagnosis signals.",
      "Uses observed returns and refunds where Shopify order data is available.",
      "Uses review drag only when negative review or rating signals exist.",
      "Uses conservative margin estimates when exact margin data is unavailable.",
      "Does not include external ad spend, taxes, chargebacks or fulfillment exceptions unless connected.",
    ],
    productRows: impactTotals.productRows
      .sort((first, second) => second.marginAtRisk - first.marginAtRisk || second.riskScore - first.riskScore)
      .slice(0, 12)
      .map((row) => ({
        ...row,
        riskLabel: formatDashboardNumber(row.riskScore),
        confidenceLabel: formatAnalyticsPercent(row.confidence),
        revenueAtRiskLabel: formatDashboardMoney(row.revenueAtRisk),
        marginAtRiskLabel: formatDashboardMoney(row.marginAtRisk),
        refundAmountLabel: formatDashboardMoney(row.refundAmount),
        returnUnitsLabel: formatDashboardNumber(row.returnUnits),
        calculatedAtLabel: row.calculatedAt ? formatAnalyticsRelativeTime(new Date(row.calculatedAt)) : "No timestamp",
      })),
  };
}

function buildAnalyticsImpactInput(label, status, detail) {
  return {
    label,
    status,
    detail,
    tone: status === "Available" ? "green" : status === "Estimated" ? "orange" : status === "Not used" ? "slate" : "red",
  };
}

function firstFiniteBusinessImpactNumber(...values) {
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function sumAnalyticsTrends(trends) {
  const maxLength = Math.max(...trends.map((trend) => (Array.isArray(trend) ? trend.length : 0)), 0);
  if (!maxLength) return Array.from({ length: 7 }, () => 0);
  return Array.from({ length: maxLength }, (_, index) => trends.reduce((sum, trend) => {
    const values = Array.isArray(trend) ? trend : [];
    return sum + Number(values[index] || 0);
  }, 0));
}

function getAnalyticsTrendLabels(series) {
  const length = Math.max(...(series || []).map((row) => row.values?.length || 0), 7);
  if (length <= 3) return ["Oldest", "Mid", "Latest"].slice(0, length);
  return Array.from({ length }, (_, index) => {
    if (index === 0) return "Oldest";
    if (index === length - 1) return "Latest";
    return "";
  });
}

function getAnalyticsTrendWindowLabels(length, windowDays = 90) {
  const count = Math.max(Number(length || 0), 1);
  if (count === 1) return ["Today"];
  const maxDays = Math.max(1, Number(windowDays || 90));
  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return `${maxDays}d ago`;
    if (index === count - 1) return "Today";
    if (count >= 7 && index === Math.floor((count - 1) / 2)) {
      return `${Math.round(maxDays / 2)}d ago`;
    }
    return "";
  });
}

function withAnalyticsColors(rows) {
  const colors = ["blue", "purple", "green", "yellow", "pink", "orange"];
  return rows.map((row, index) => ({
    ...row,
    color: row.color || colors[index % colors.length],
  }));
}

function getAnalyticsMax(rows) {
  return Math.max(...(rows || []).map((row) => Number(row.value || row.count || 0)), 1);
}

function formatAnalyticsPercent(value) {
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value || 0))}%`;
}

function formatAnalyticsDateLabel(value) {
  const timestamp = Number(value);
  const date = Number.isFinite(timestamp) ? new Date(timestamp) : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(date);
}

function formatAnalyticsRelativeTime(date) {
  const timestamp = date instanceof Date ? date.getTime() : new Date(date).getTime();
  if (!Number.isFinite(timestamp)) return "recently";
  const diffMs = Date.now() - timestamp;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < hour) return `${Math.max(1, Math.round(diffMs / minute))}m ago`;
  if (diffMs < day) return `${Math.round(diffMs / hour)}h ago`;
  return `${Math.round(diffMs / day)}d ago`;
}

function clampAnalyticsValue(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}

export const jobs = [
  { id: "job-import-products", name: "Import products", source: "Shopify products", status: "Completed", progress: 100, updatedAt: "2 min ago" },
  { id: "job-read-returns", name: "Read refunds and returns", source: "Shopify orders/returns", status: "Running", progress: 72, updatedAt: "Now" },
  { id: "job-review-analysis", name: "Analyze reviews", source: "Judge.me + CSV", status: "Queued", progress: 24, updatedAt: "1 min ago" },
  { id: "job-risk-score", name: "Calculate risk", source: "ProductPulse", status: "Waiting", progress: 12, updatedAt: "1 min ago" },
];

export const billing = {
  plan: "Pulse Starter",
  includedScan: "Catalog Signal Scan",
  creditsAvailable: 14,
  creditsUsed: 6,
  monthlyCredits: 20,
  nextReset: "2026-06-01",
};

export const analytics = buildAnalyticsViewData(products, { sources: getFlattenedSources() });

export function getFlattenedSources() {
  return sourceGroups.flatMap((group) =>
    group.sources.map((source) => ({
      ...source,
      category: group.category,
      categoryDescription: group.description,
    })),
  );
}

export function getAppViewData({ query = "", risk = "all" } = {}) {
  const sources = getFlattenedSources();
  const coverageScore = calculateCoverageScore(sources);
  const coverageState = getCoverageState(coverageScore);
  const filteredProducts = filterProducts(products, { query, risk });
  const startHere = products[0];
  const dashboard = buildDashboardViewData(products, { billing });

  return {
    sourceGroups,
    sources,
    coverageScore,
    coverageState,
    products,
    filteredProducts,
    jobs,
    analytics: buildAnalyticsViewData(products, { sources }),
    billing,
    dashboard,
    startHere,
    topIssues: products.slice(0, 3).map((product) => ({
      product: product.title,
      issue: product.primaryIssue,
      riskScore: product.riskScore,
    })),
    permissionState: {
      hasRequiredScopes: true,
      requiredScopes: REQUIRED_SHOPIFY_SCOPES,
      missingScopes: [],
    },
  };
}

export function getProductBySlug(productId) {
  return products.find((product) => product.slug === productId || product.id === productId) || null;
}

export function runCatalogSignalScan() {
  return {
    status: "success",
    message: "Catalog Signal Scan queued. ProductPulse is refreshing product, return and review signals.",
    job: {
      id: "job-catalog-scan-now",
      name: "Catalog Signal Scan",
      source: "ProductPulse",
      status: "Running",
      progress: 8,
      updatedAt: "Just now",
    },
  };
}

export function startProductDiagnosis(productId, availableCredits = billing.creditsAvailable) {
  const product = getProductBySlug(productId);
  if (!product) {
    return { status: "error", message: "Product was not found." };
  }

  const creditCheck = validateCreditBalance(availableCredits, product.creditCost);
  if (!creditCheck.valid) {
    return { status: "validation_error", message: creditCheck.message };
  }

  return {
    status: "success",
    message: `AI Product Diagnosis started for ${product.title}. 1.0 point was consumed.`,
    product,
    creditsRemaining: availableCredits - product.creditCost,
  };
}

export function applyDraftAction(productId, actionId) {
  const validation = validateProductAction(productId, actionId, products);
  if (!validation.valid) {
    return { status: "validation_error", message: validation.message };
  }

  return {
    status: "success",
    message: `${validation.action.label} was saved as a draft action for ${validation.product.title}.`,
    product: validation.product,
    action: validation.action,
  };
}

function filterProducts(items, { query, risk }) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  return items.filter((product) => {
    const matchesQuery =
      !normalizedQuery ||
      product.title.toLowerCase().includes(normalizedQuery) ||
      product.handle.toLowerCase().includes(normalizedQuery) ||
      product.primaryIssue.toLowerCase().includes(normalizedQuery);

    const matchesRisk =
      risk === "all" ||
      (risk === "high" && product.riskScore >= 75) ||
      (risk === "watch" && product.riskScore >= 55 && product.riskScore < 75) ||
      (risk === "healthy" && product.riskScore < 55);

    return matchesQuery && matchesRisk;
  });
}
