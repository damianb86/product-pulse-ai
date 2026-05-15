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
  const appliedActionIds = new Set(actionRows.filter((action) => action.status === "applied").map((action) => `${action.product?.id || action.productTitle}:${action.id}`));
  const appliedActionCount = appliedActionIds.size;
  const resolvedProducts = productList.filter((product) => product.resolvedAt).length;
  const startProduct = getDashboardStartProduct(productList, { pendingActions });
  const priorityProducts = buildDashboardPriorityProducts(productList);
  const actionQueue = buildDashboardActionQueue(pendingActions);
  const topActiveIssues = buildDashboardTopActiveIssues(productList);
  const coverageSummary = buildDashboardCoverageSummary(productList, { fullDiagnoses, quickScanOnly, totalProducts, catalogProductCount });
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
    .sort((first, second) => second.priorityScore - first.priorityScore)[0] || null;
  const diagnosisCandidates = productList.filter((product) => !hasDashboardFullDiagnosis(product));
  const recheckCandidates = productList.filter((product) => product.resolvedAt || (Array.isArray(product.actionHistory) && product.actionHistory.some((action) => action.status === "applied")));
  const fallbackPool = diagnosisCandidates.length ? diagnosisCandidates : recheckCandidates.length ? recheckCandidates : productList;
  const product = pendingAction?.product || [...fallbackPool].sort((first, second) => (
    getDashboardPriorityScore(second, { maxMarginRisk })
      - getDashboardPriorityScore(first, { maxMarginRisk })
  ))[0];

  if (!product) return null;
  const metrics = product.metrics || {};
  const hasFullDiagnosis = hasDashboardFullDiagnosis(product);
  const activeDiagnosis = getDashboardActiveDiagnosis(product);
  const returnRate = Number(metrics.returnRate || 0);
  const refundRate = Number(metrics.refundRate || 0);
  const negativeReviews = Number(metrics.negativeReviewCount || 0);
  const mainIssue = getDashboardIssueLabel(product.primaryIssue || metrics.mainIssue || "Product quality");
  const priorityScore = getDashboardPriorityScore(product, { maxMarginRisk });
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
    const actions = Array.isArray(product.recommendedActions) ? product.recommendedActions : [];
    const history = Array.isArray(product.actionHistory) ? product.actionHistory : [];
    const rows = actions.map((action) => {
      const actionId = action.id || action.label || "";
      const record = history.find((item) => item.actionId === actionId || item.id === actionId);
      const status = normalizeDashboardActionStatus(record?.status || action.status);
      const priorityScore = getDashboardPriorityScore(product, { maxMarginRisk });
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
        priorityScore,
        marginAtRisk: getDashboardMetric(product, "marginAtRisk"),
      };
    });

    const rowIds = new Set(rows.map((row) => row.id));
    const historicalRows = history
      .filter((record) => !isSystemProductActionRecord(record))
      .filter((record) => !rowIds.has(record.actionId || record.id))
      .map((record) => {
        const status = normalizeDashboardActionStatus(record.status);
        if (!["pending", "applied", "dismissed"].includes(status)) return null;
        const action = {
          id: record.actionId || record.id || record.label,
          label: record.label || "Stored product action",
          type: record.payload?.actionType || record.payload?.type || "Stored action",
          status,
          payload: record.payload || {},
        };
        const priorityScore = getDashboardPriorityScore(product, { maxMarginRisk });
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
          priorityScore,
          marginAtRisk: getDashboardMetric(product, "marginAtRisk"),
        };
      })
      .filter(Boolean);

    return [...rows, ...historicalRows];
  }).sort((first, second) => (
    second.priorityScore - first.priorityScore
      || second.marginAtRisk - first.marginAtRisk
  ));
}

function isSystemProductActionRecord(record = {}) {
  const actionId = String(record.actionId || record.actionType || record.id || "").toLowerCase();
  return actionId === "mark-resolved" || actionId === "ignore-issue";
}

function normalizeDashboardActionStatus(status) {
  const normalized = String(status || "pending").toLowerCase();
  if (normalized.includes("applied")) return "applied";
  if (normalized.includes("dismiss") || normalized.includes("ignored")) return "dismissed";
  return "pending";
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

function buildDashboardPriorityProducts(productList) {
  const maxMarginRisk = Math.max(...productList.map((product) => getDashboardMetric(product, "marginAtRisk")), 0);
  return [...productList]
    .sort((first, second) => getDashboardPriorityScore(second, { maxMarginRisk }) - getDashboardPriorityScore(first, { maxMarginRisk }))
    .slice(0, 3)
    .map((product, index) => {
      const pendingAction = buildDashboardActionRows([product]).find((action) => action.status === "pending");
      const hasFullDiagnosis = hasDashboardFullDiagnosis(product);
      return {
        id: product.id || product.handle || product.slug || product.title,
        rank: index + 1,
        title: product.title || product.productTitle || "Product",
        href: `/app/products/${product.handle || product.slug || product.id}`,
        riskLabel: getRiskLabel(Number(product.riskScore || 0)),
        riskTone: getRiskTone(Number(product.riskScore || 0)),
        marginAtRiskLabel: formatDashboardMoney(getDashboardMetric(product, "marginAtRisk")),
        issueLabel: getDashboardIssueLabel(product.primaryIssue || product.metrics?.mainIssue || "Product quality"),
        actionLabel: pendingAction?.label || (hasFullDiagnosis ? "Review diagnosis" : "Run full diagnosis"),
      };
    });
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
    if (action.priorityScore > (current.priorityScore || 0)) {
      current.href = action.href;
      current.priorityScore = action.priorityScore;
    }
    grouped.set(action.category, current);
  });

  const rows = Array.from(grouped.values())
    .sort((first, second) => second.value - first.value || (second.priorityScore || 0) - (first.priorityScore || 0))
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

function buildDashboardCoverageSummary(productList, { fullDiagnoses, quickScanOnly, totalProducts, catalogProductCount }) {
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
  const catalogFullPercent = catalogTotal ? Math.round((fullDiagnoses.length / catalogTotal) * 100) : 0;
  const missingCatalogFull = Math.max(0, catalogTotal - fullDiagnoses.length);
  const catalogTone = catalogFullPercent >= 70 ? "green" : catalogFullPercent >= 30 ? "orange" : "red";
  const statusLabel = connectedCount >= 3 && storedFullPercent >= 70
    ? "Coverage quality: Good"
    : connectedCount > 1 || storedFullPercent >= 35
      ? "Coverage quality: Partial"
      : "Coverage quality: Needs attention";
  return {
    statusLabel,
    tone: connectedCount >= 3 && storedFullPercent >= 70 ? "green" : connectedCount > 1 || storedFullPercent >= 35 ? "orange" : "blue",
    icon: connectedCount >= 3 ? "check" : "info",
    detail: `${formatDashboardNumber(fullDiagnoses.length)} / ${formatDashboardNumber(totalProducts)} products in the risk table have full diagnostics.`,
    coverageLine: `Risk table: ${formatDashboardNumber(fullDiagnoses.length)} full diagnosis · ${formatDashboardNumber(quickScanOnly.length)} QuickScan only`,
    catalogCoverage: {
      percent: catalogFullPercent,
      percentLabel: formatDashboardRate(catalogFullPercent),
      tone: catalogTone,
      ariaLabel: `${formatDashboardRate(catalogFullPercent)} of total catalog products have full diagnostics`,
      detail: `${formatDashboardNumber(fullDiagnoses.length)} of ${formatDashboardNumber(catalogTotal)} total catalog products have full diagnostics. ${formatDashboardNumber(missingCatalogFull)} still have no full analysis.`,
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
    const actions = Array.isArray(product.recommendedActions) ? product.recommendedActions : [];
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
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(Number(value || 0))}%`;
}

export function buildAnalyticsViewData(productItems = products, options = {}) {
  const productList = (Array.isArray(productItems) ? productItems : []).filter(Boolean);
  const totalProducts = productList.length;
  const fullDiagnoses = productList.filter((product) => product.analysisDepth === "full" || product.metrics?.latestDiagnosisId);
  const quickScanOnly = productList.filter((product) => product.analysisDepth === "quickscan" && !product.metrics?.latestDiagnosisId);
  const highRiskProducts = productList.filter((product) => Number(product.riskScore || 0) >= 75);
  const mediumRiskProducts = productList.filter((product) => Number(product.riskScore || 0) >= 55 && Number(product.riskScore || 0) < 75);
  const windowDays = getAnalyticsWindowDays(productList);
  const actionRows = buildDashboardActionRows(productList);
  const totals = getAnalyticsTotals(productList, { ...options, actionRows });
  const pendingActions = actionRows.filter((action) => action.status === "pending");
  const appliedActions = actionRows.filter((action) => action.status === "applied");
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
        detail: `${formatDashboardNumber(appliedActions.length)} applied, ${formatDashboardNumber(dismissedActions.length)} dismissed`,
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
    riskBubbles,
    collectionMargin: {
      rows: collectionMargin,
      max: getAnalyticsMax(collectionMargin),
    },
    analysisCoverage: {
      rows: analysisCoverage,
      max: getAnalyticsMax(analysisCoverage),
    },
    impactTrend: buildAnalyticsImpactTrend(productList, { windowDays }),
    issueImpact: {
      rows: buildAnalyticsIssueImpact(productList),
    },
    impactBreakdown: buildAnalyticsImpactBreakdown(productList),
    actionPerformance: buildAnalyticsActionPerformance(actionRows),
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
    base.dismissedActions = actionRows.filter((action) => action.status === "dismissed").length;
  } else if (actions.length) {
    base.openActions = actions.filter((action) => normalizeDashboardActionStatus(action.status) === "pending").length;
    base.appliedActions = actions.filter((action) => normalizeDashboardActionStatus(action.status) === "applied").length;
    base.dismissedActions = actions.filter((action) => normalizeDashboardActionStatus(action.status) === "dismissed").length;
  } else {
    base.openActions = productList.reduce((total, product) => total + (Array.isArray(product.recommendedActions) ? product.recommendedActions.length : 0), 0);
    base.appliedActions = productList.reduce((total, product) => total + (Array.isArray(product.actionHistory) ? product.actionHistory.filter((action) => normalizeDashboardActionStatus(action.status) === "applied").length : 0), 0);
    base.dismissedActions = productList.reduce((total, product) => total + (Array.isArray(product.actionHistory) ? product.actionHistory.filter((action) => normalizeDashboardActionStatus(action.status) === "dismissed").length : 0), 0);
  }

  return base;
}

function getAnalyticsWindowDays(productList) {
  const windows = productList
    .map((product) => Number(product.metrics?.windowDays || 0))
    .filter((value) => value > 0);
  return windows.length ? Math.max(...windows) : 90;
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

function buildAnalyticsIssueDistribution(productList) {
  const grouped = new Map();
  productList.forEach((product) => {
    const metrics = product.metrics || {};
    const addIssue = (issue, signals = 1) => {
      const label = getDashboardIssueLabel(issue);
      const current = grouped.get(label) || { label, value: 0 };
      current.value += Math.max(1, Number(signals || 1));
      grouped.set(label, current);
    };

    if (Array.isArray(product.issues) && product.issues.length) {
      product.issues.forEach((issue) => addIssue(issue.issueCode || issue.issue, issue.signals));
    } else if (product.primaryIssue) {
      addIssue(product.primaryIssue, metrics.signalCount || metrics.issueCount || 1);
    }

    if (Array.isArray(metrics.contentIssues)) {
      metrics.contentIssues.forEach((issue) => addIssue(issue.issueCode || issue.label || "Product content", 1));
    }
  });

  return withAnalyticsColors(normalizeDashboardRows(Array.from(grouped.values()), 6, "No issues detected"));
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
      returnRate: Number(metrics.returnRate || 0),
      refundRate: Number(metrics.refundRate || 0),
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

function buildAnalyticsImpactTrend(productList, { windowDays = 90 } = {}) {
  const trends = productList.map((product) => ({
    product,
    values: getAnalyticsProductTrendValues(product),
    marginAtRisk: getDashboardMetric(product, "marginAtRisk"),
  }));
  const length = Math.max(...trends.map((row) => row.values.length), 7);
  const normalized = trends.map((row) => ({
    ...row,
    values: resizeAnalyticsTrend(row.values, length, Number(row.product.riskScore || 0)),
  }));
  const marginValues = Array.from({ length }, (_, index) => normalized.reduce((sum, row) => {
    const trendValue = Number(row.values[index] || 0);
    return sum + row.marginAtRisk * clampAnalyticsValue(trendValue / 100, 0.08, 1);
  }, 0));
  const attentionValues = Array.from({ length }, (_, index) => normalized.filter((row) => Number(row.values[index] || 0) >= 55).length);
  const highValues = Array.from({ length }, (_, index) => normalized.filter((row) => Number(row.values[index] || 0) >= 75).length);
  const mediumValues = Array.from({ length }, (_, index) => normalized.filter((row) => Number(row.values[index] || 0) >= 55 && Number(row.values[index] || 0) < 75).length);
  const lowValues = Array.from({ length }, (_, index) => normalized.filter((row) => Number(row.values[index] || 0) < 55).length);

  const series = [
    {
      label: "Margin at risk",
      color: "purple",
      values: marginValues,
      displayValue: formatDashboardMoney(marginValues[marginValues.length - 1] || 0),
      detail: `Estimated margin exposure across the ${windowDays}-day scan window.`,
    },
    {
      label: "Products needing attention",
      color: "blue",
      values: attentionValues,
      displayValue: formatDashboardNumber(attentionValues[attentionValues.length - 1] || 0),
      detail: "Products whose stored trend currently lands in medium or high risk.",
    },
    {
      label: "High risk",
      color: "red",
      values: highValues,
      displayValue: formatDashboardNumber(highValues[highValues.length - 1] || 0),
      detail: "Products at or above 75 product risk.",
    },
    {
      label: "Medium risk",
      color: "orange",
      values: mediumValues,
      displayValue: formatDashboardNumber(mediumValues[mediumValues.length - 1] || 0),
      detail: "Products from 55 to 74 product risk.",
    },
    {
      label: "Low risk",
      color: "green",
      values: lowValues,
      displayValue: formatDashboardNumber(lowValues[lowValues.length - 1] || 0),
      detail: "Products below 55 product risk.",
    },
  ];

  return {
    series,
    labels: getAnalyticsTrendLabels(series),
  };
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
    const productLabels = new Set();
    const addIssue = (issue, signals = 1) => {
      const label = getDashboardIssueLabel(issue);
      if (!label) return;
      productLabels.add(label);
      const current = grouped.get(label) || {
        label,
        products: new Set(),
        marginAtRisk: 0,
        signalCount: 0,
        confidenceTotal: 0,
        confidenceSamples: 0,
      };
      current.products.add(product.id || product.handle || product.title);
      current.signalCount += Math.max(1, Number(signals || 1));
      current.confidenceTotal += Number(product.confidence || metrics.confidence || 0);
      current.confidenceSamples += 1;
      grouped.set(label, current);
    };

    if (Array.isArray(product.issues) && product.issues.length) {
      product.issues.forEach((issue) => addIssue(issue.issueCode || issue.issue || issue.label, issue.signals));
    } else if (product.primaryIssue) {
      addIssue(product.primaryIssue, metrics.signalCount || metrics.issueCount || 1);
    }

    if (Array.isArray(metrics.contentIssues)) {
      metrics.contentIssues.forEach((issue) => addIssue(issue.issueCode || issue.label || "Product content", issue.signals || 1));
    }

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
    else if (action.status === "dismissed") summary.dismissed += 1;
    else summary.pending += 1;
    return summary;
  }, { suggested: 0, pending: 0, applied: 0, dismissed: 0 });

  const rows = [
    { label: "Suggested", value: counts.suggested, icon: "wand", tone: "purple", detail: "Actions generated from product diagnosis." },
    { label: "Pending", value: counts.pending, icon: "clock", tone: "orange", detail: "Waiting for merchant review or approval." },
    { label: "Applied", value: counts.applied, icon: "check", tone: "green", detail: "Actions already applied to products or workflows." },
    { label: "Dismissed", value: counts.dismissed, icon: "x", tone: "slate", detail: "Actions intentionally ignored or rejected." },
  ];

  return {
    ...counts,
    rows: rows.map((row) => ({ ...row, valueLabel: formatDashboardNumber(row.value) })),
    effectiveness: counts.applied > 0
      ? [
        { label: "Post-fix return rate", value: "Waiting", detail: "Needs enough orders after applied fixes." },
        { label: "Negative reviews", value: "Waiting", detail: "Needs new connected review data after fixes." },
        { label: "Margin at risk reduced", value: "Waiting", detail: "Will compare before/after diagnosis windows." },
      ]
      : [
        { label: "Fix effectiveness", value: "Waiting for applied actions", detail: "Apply at least one recommended action to start measuring before/after outcomes." },
      ],
  };
}

function buildAnalyticsCatalogCoverage(productList, { totalProducts, fullDiagnoses, quickScanOnly, catalogProductCount }) {
  const analyzed = totalProducts;
  const full = fullDiagnoses.length;
  const quick = quickScanOnly.length;
  const missingReviews = productList.filter((product) => !hasAnalyticsSource(product, "Reviews") || Number(product.metrics?.reviewCount || product.metrics?.csvReviewCount || 0) <= 0).length;
  const missingReturns = productList.filter((product) => !hasAnalyticsSource(product, "Returns") || Number(product.metrics?.returnUnits || 0) <= 0).length;
  const catalogTotal = Math.max(Number(catalogProductCount || analyzed || 0), analyzed);
  const notAnalyzed = Math.max(catalogTotal - analyzed, 0);
  return {
    analyzed,
    analyzedLabel: `${formatDashboardNumber(analyzed)} / ${formatDashboardNumber(catalogTotal)} products analyzed`,
    fullDiagnoses: full,
    quickScanOnly: quick,
    notAnalyzed,
    missingReviews,
    missingReturns,
    rows: [
      { label: "Full diagnoses", value: full, total: Math.max(analyzed, 1), valueLabel: formatDashboardNumber(full), tone: "purple" },
      { label: "QuickScan only", value: quick, total: Math.max(analyzed, 1), valueLabel: formatDashboardNumber(quick), tone: "blue" },
      { label: "Not analyzed", value: notAnalyzed, total: Math.max(analyzed + notAnalyzed, 1), valueLabel: formatDashboardNumber(notAnalyzed), tone: "slate" },
      { label: "Missing reviews data", value: missingReviews, total: Math.max(analyzed, 1), valueLabel: formatDashboardNumber(missingReviews), tone: missingReviews ? "orange" : "green" },
      { label: "Missing returns data", value: missingReturns, total: Math.max(analyzed, 1), valueLabel: formatDashboardNumber(missingReturns), tone: missingReturns ? "orange" : "green" },
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
  const actionCoverage = totals.openActions + totals.appliedActions;
  return [
    {
      label: "Revenue at risk",
      value: formatDashboardMoney(totals.revenueAtRisk),
      icon: "cash-dollar",
      tone: totals.revenueAtRisk > 0 ? "purple" : "blue",
      detail: "Refund value plus projected revenue pressure from stored signals.",
    },
    {
      label: "Margin at risk",
      value: formatDashboardMoney(totals.marginAtRisk),
      icon: "chart-line",
      tone: totals.marginAtRisk > 0 ? "green" : "blue",
      detail: "Estimated margin exposure from products currently needing attention.",
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
      detail: `${formatDashboardNumber(totals.openActions)} open, ${formatDashboardNumber(totals.appliedActions)} applied.`,
    },
  ];
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
    message: `AI Product Diagnosis started for ${product.title}. One credit was consumed.`,
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
