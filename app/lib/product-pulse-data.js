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
  const startProduct = getDashboardStartProduct(productList);
  const issueBars = buildDashboardIssueBars(productList);
  const suggestedFixes = buildDashboardSuggestedFixes(productList);
  const sourceMix = buildDashboardSourceMix(productList);
  const impactByCollection = buildDashboardImpactByCollection(productList);
  const analysisCoverage = buildDashboardAnalysisCoverage({ fullDiagnoses, quickScanOnly, totalProducts });
  const riskDistribution = buildDashboardRiskDistribution({ highRiskProducts, mediumRiskProducts, totalProducts });

  return {
    generatedAt: new Date().toISOString(),
    hasProducts: totalProducts > 0,
    kpis: [
      {
        label: "Products needing attention",
        value: formatDashboardNumber(needingAttention.length),
        detail: `${formatDashboardNumber(totalProducts)} scanned product${totalProducts === 1 ? "" : "s"}`,
        icon: "product",
        tone: "blue",
      },
      {
        label: "High-risk products",
        value: formatDashboardNumber(highRiskProducts.length),
        detail: "Risk score 75+",
        icon: "shield-check-mark",
        tone: highRiskProducts.length ? "red" : "green",
      },
      {
        label: "Estimated margin at risk",
        value: formatDashboardMoney(totalMarginAtRisk),
        detail: `${formatDashboardMoney(totalRevenueAtRisk)} revenue at risk`,
        icon: "cash-dollar",
        tone: totalMarginAtRisk > 0 ? "green" : "blue",
      },
      {
        label: "Full diagnoses completed",
        value: formatDashboardNumber(fullDiagnoses.length),
        detail: `${formatDashboardNumber(quickScanOnly.length)} QuickScan only`,
        icon: "wand",
        tone: "purple",
      },
    ],
    totals: {
      totalProducts,
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
      creditsAvailable: options.billing?.creditsAvailable ?? billing.creditsAvailable,
    },
    startProduct,
    evidenceMetrics: buildDashboardEvidenceMetrics(startProduct),
    issueBars,
    suggestedFixes,
    insightPanels: [
      {
        title: "Risk distribution",
        detail: `${formatDashboardNumber(needingAttention.length)} product${needingAttention.length === 1 ? "" : "s"} above monitor threshold`,
        rows: riskDistribution,
      },
      {
        title: "Analysis coverage",
        detail: `${formatDashboardNumber(fullDiagnoses.length)} deep ${fullDiagnoses.length === 1 ? "diagnosis" : "diagnoses"} completed`,
        rows: analysisCoverage,
      },
      {
        title: "Signal source mix",
        detail: `${formatDashboardNumber(totalProducts)} scanned product${totalProducts === 1 ? "" : "s"} with stored source coverage`,
        rows: sourceMix,
      },
      {
        title: "Impact by collection",
        detail: totalMarginAtRisk ? `${formatDashboardMoney(totalMarginAtRisk)} total margin at risk` : "No stored impact yet",
        rows: impactByCollection,
      },
    ],
    nextStep: buildDashboardNextStep(startProduct, totalProducts, suggestedFixes),
  };
}

function getDashboardStartProduct(productList) {
  const maxMarginRisk = Math.max(...productList.map((product) => getDashboardMetric(product, "marginAtRisk")), 0);
  const maxSignals = Math.max(...productList.map((product) => getDashboardMetric(product, "signalCount")), 0);
  const maxRecentSignals = Math.max(...productList.map((product) => getDashboardMetric(product, "recentSignalUnits")), 0);
  const candidates = productList
    .filter((product) => !hasDashboardFullDiagnosis(product));
  const pool = candidates.length ? candidates : productList;
  const product = [...pool].sort((first, second) => (
    getDashboardPriorityScore(second, { maxMarginRisk, maxSignals, maxRecentSignals })
      - getDashboardPriorityScore(first, { maxMarginRisk, maxSignals, maxRecentSignals })
  ))[0];

  if (!product) return null;
  const metrics = product.metrics || {};
  const hasFullDiagnosis = hasDashboardFullDiagnosis(product);
  const returnRate = Number(metrics.returnRate || 0);
  const refundRate = Number(metrics.refundRate || 0);
  const negativeReviews = Number(metrics.negativeReviewCount || 0);
  const mainIssue = getDashboardIssueLabel(product.primaryIssue || metrics.mainIssue || "Product quality");
  const priorityScore = getDashboardPriorityScore(product, { maxMarginRisk, maxSignals, maxRecentSignals });

  return {
    title: product.title || product.productTitle || "Product",
    handle: product.handle || product.slug || "",
    href: `/app/products/${product.handle || product.slug || product.id}`,
    variant: getDashboardProductVariant(product),
    imageUrl: product.imageUrl || null,
    imageAlt: product.imageAlt || null,
    riskLabel: getRiskLabel(Number(product.riskScore || 0)),
    riskTone: getRiskTone(Number(product.riskScore || 0)),
    riskScore: Number(product.riskScore || 0),
    issueLabel: mainIssue,
    priorityScore,
    selectionMode: hasFullDiagnosis ? "full-diagnosis-fallback" : "next-diagnosis",
    priorityReason: buildDashboardPriorityReason(product, { hasFullDiagnosis, priorityScore }),
    eyebrow: hasFullDiagnosis ? "Recommended product to review" : "Recommended next product to analyze",
    summary: buildDashboardStartSummary({ product, mainIssue, returnRate, refundRate, negativeReviews, hasFullDiagnosis }),
    actionLabel: hasFullDiagnosis ? "Open product diagnosis" : "Run product diagnosis",
    actionHint: hasFullDiagnosis ? "Review recommended actions" : "Selected by risk, margin and signal volume",
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

function hasDashboardFullDiagnosis(product) {
  return product?.analysisDepth === "full" || Boolean(product?.metrics?.latestDiagnosisId);
}

function getDashboardPriorityScore(product, { maxMarginRisk = 0, maxSignals = 0, maxRecentSignals = 0 } = {}) {
  const riskScore = Number(product?.riskScore || 0);
  const marginRisk = getDashboardMetric(product, "marginAtRisk");
  const signalCount = getDashboardMetric(product, "signalCount");
  const recentSignalUnits = getDashboardMetric(product, "recentSignalUnits");
  const marginScore = maxMarginRisk > 0 ? (marginRisk / maxMarginRisk) * 100 : 0;
  const signalScore = maxSignals > 0 ? (signalCount / maxSignals) * 100 : 0;
  const recencyScore = maxRecentSignals > 0 ? (recentSignalUnits / maxRecentSignals) * 100 : 0;

  return Math.round(
    riskScore * 0.55
      + marginScore * 0.25
      + signalScore * 0.15
      + recencyScore * 0.05,
  );
}

function buildDashboardPriorityReason(product, { hasFullDiagnosis, priorityScore }) {
  const metrics = product.metrics || {};
  const reasons = [
    `${getRiskLabel(Number(product.riskScore || 0)).toLowerCase()} risk`,
    `${formatDashboardMoney(getDashboardMetric(product, "marginAtRisk"))} margin at risk`,
    `${formatDashboardNumber(metrics.signalCount || metrics.issueCount || 0)} signal${Number(metrics.signalCount || metrics.issueCount || 0) === 1 ? "" : "s"}`,
  ];
  if (Number(metrics.recentSignalUnits || 0) > 0) {
    reasons.push(`${formatDashboardNumber(metrics.recentSignalUnits)} recent signal${Number(metrics.recentSignalUnits) === 1 ? "" : "s"}`);
  }

  return `${hasFullDiagnosis ? "Fallback because all priority candidates already have full diagnostics" : "Next full-diagnosis candidate"}: ${reasons.join(", ")}. Priority score ${priorityScore}/100.`;
}

function buildDashboardStartSummary({ product, mainIssue, returnRate, refundRate, negativeReviews, hasFullDiagnosis }) {
  const pieces = [];
  if (returnRate > 0) pieces.push(`${formatDashboardRate(returnRate)} return rate`);
  if (refundRate > 0) pieces.push(`${formatDashboardRate(refundRate)} refund rate`);
  if (negativeReviews > 0) pieces.push(`${formatDashboardNumber(negativeReviews)} negative review${negativeReviews === 1 ? "" : "s"}`);
  if (!pieces.length) {
    return hasFullDiagnosis
      ? `${product.title} already has a full diagnosis and remains the highest-priority product to review.`
      : `${product.title} is the highest-priority product without a full diagnosis. ProductPulse has scan data ready for review.`;
  }
  return hasFullDiagnosis
    ? `${product.title} already has a full diagnosis and still ranks highest because ${pieces.join(", ")} point to ${mainIssue.toLowerCase()}.`
    : `${product.title} is the highest-priority product without a full diagnosis because ${pieces.join(", ")} point to ${mainIssue.toLowerCase()}.`;
}

function buildDashboardEvidenceMetrics(startProduct) {
  if (!startProduct) {
    return [
      { icon: "return", label: "Return rate", value: "0%", detail: "No scan yet", tone: "neutral" },
      { icon: "package", label: "Returns", value: "0", detail: "No scan yet", tone: "neutral" },
      { icon: "star", label: "Negative reviews", value: "0", detail: "No reviews", tone: "neutral" },
      { icon: "target", label: "Signals", value: "0", detail: "No signals", tone: "neutral" },
    ];
  }
  const metrics = startProduct.metrics || {};
  return [
    { icon: "return", label: "Return rate", value: formatDashboardRate(metrics.returnRate), detail: `${formatDashboardNumber(metrics.windowDays)}d window`, tone: metrics.returnRate >= 15 ? "critical" : metrics.returnRate > 0 ? "warning" : "neutral" },
    { icon: "package", label: "Returns", value: formatDashboardNumber(metrics.returnUnits), detail: `${formatDashboardNumber(metrics.refundUnits)} refunds`, tone: metrics.returnUnits > 0 ? "warning" : "neutral" },
    { icon: "star", label: "Negative reviews", value: formatDashboardNumber(metrics.negativeReviewCount), detail: `${formatDashboardNumber(metrics.reviewCount)} reviews`, tone: metrics.negativeReviewCount > 0 ? "critical" : "neutral" },
    { icon: "target", label: "Signals", value: formatDashboardNumber(metrics.signalCount), detail: `${formatDashboardMoney(metrics.marginAtRisk)} margin risk`, tone: metrics.signalCount > 0 ? "info" : "neutral" },
  ];
}

function buildDashboardIssueBars(productList) {
  const grouped = new Map();
  productList.forEach((product) => {
    const metrics = product.metrics || {};
    const issues = Array.isArray(product.issues) && product.issues.length
      ? product.issues
      : [{ issue: product.primaryIssue, signals: metrics.signalCount || metrics.issueCount || 1 }];
    issues.forEach((issue) => {
      const label = getDashboardIssueLabel(issue.issueCode || issue.issue || product.primaryIssue);
      const current = grouped.get(label) || { label, value: 0 };
      current.value += Math.max(1, Number(issue.signals || metrics.signalCount || metrics.issueCount || 1));
      grouped.set(label, current);
    });
  });

  return normalizeDashboardRows(Array.from(grouped.values()), 5, "No issues detected");
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

function buildDashboardSourceMix(productList) {
  const grouped = new Map();
  productList.forEach((product) => {
    const sources = Array.isArray(product.sourceCoverage) ? product.sourceCoverage : [];
    sources.forEach((source) => {
      const label = normalizeDashboardSourceLabel(source);
      grouped.set(label, (grouped.get(label) || 0) + 1);
    });
  });
  return normalizeDashboardRows(Array.from(grouped.entries()).map(([label, value]) => ({ label, value })), 5, "No source data");
}

function buildDashboardImpactByCollection(productList) {
  const grouped = new Map();
  productList.forEach((product) => {
    const collection = product.collection || product.metrics?.collections?.[0] || product.metrics?.productType || "Uncategorized";
    const value = getDashboardMetric(product, "marginAtRisk");
    if (value <= 0) return;
    grouped.set(collection, (grouped.get(collection) || 0) + value);
  });
  return normalizeDashboardRows(Array.from(grouped.entries()).map(([label, value]) => ({
    label,
    value,
    displayValue: formatDashboardMoney(value),
  })), 5, "No impact yet");
}

function buildDashboardAnalysisCoverage({ fullDiagnoses, quickScanOnly, totalProducts }) {
  const notScanned = Math.max(0, totalProducts - fullDiagnoses.length - quickScanOnly.length);
  return normalizeDashboardRows([
    { label: "Full diagnosis", value: fullDiagnoses.length },
    { label: "QuickScan only", value: quickScanOnly.length },
    { label: "Not scanned", value: notScanned },
  ], 3, "No products");
}

function buildDashboardRiskDistribution({ highRiskProducts, mediumRiskProducts, totalProducts }) {
  const low = Math.max(0, totalProducts - highRiskProducts.length - mediumRiskProducts.length);
  return normalizeDashboardRows([
    { label: "High risk", value: highRiskProducts.length },
    { label: "Medium risk", value: mediumRiskProducts.length },
    { label: "Low risk", value: low },
  ], 3, "No products");
}

function buildDashboardNextStep(startProduct, totalProducts, suggestedFixes = []) {
  if (!totalProducts) {
    return {
      title: "Run QuickScan",
      subtitle: "Start with native Shopify signals",
      detail: "QuickScan builds a lightweight product risk list from Shopify products, orders, refunds and returns.",
      href: "/app/products",
      buttonLabel: "Go to Products",
    };
  }
  if (!startProduct) {
    return {
      title: "Review products",
      subtitle: "Open the product list",
      detail: "ProductPulse has stored scan data. Review the Products page to choose where to run a deep diagnosis.",
      href: "/app/products",
      buttonLabel: "View products",
    };
  }
  if (startProduct.selectionMode === "next-diagnosis") {
    return {
      title: "Run product diagnosis",
      subtitle: "Run the next full diagnosis",
      detail: `${startProduct.title} was selected with a priority score of ${startProduct.priorityScore}/100 because it has no full diagnosis yet and ranks highest by risk, margin at risk and signal volume.`,
      href: startProduct.href,
      buttonLabel: "Open product",
    };
  }
  const topFix = suggestedFixes[0];
  if (topFix && topFix.impact !== "Needs diagnosis") {
    return {
      title: "Review recommended action",
      subtitle: topFix.label,
      detail: "All high-priority candidates already have a full diagnosis. The next best step is to review and apply the highest-impact recommended action.",
      href: topFix.href || startProduct.href,
      buttonLabel: "Review action",
    };
  }
  return {
    title: "Review product diagnosis",
    subtitle: startProduct.title,
    detail: "All current priority candidates already have a full diagnosis. Review the top product's evidence and recommended actions.",
    href: startProduct.href,
    buttonLabel: "Open diagnosis",
  };
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
  const totals = getAnalyticsTotals(productList, options);
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
        label: "Estimated margin at risk",
        value: formatDashboardMoney(totals.marginAtRisk),
        detail: `${formatDashboardMoney(totals.revenueAtRisk)} revenue at risk`,
        icon: "cash-dollar",
        tone: totals.marginAtRisk > 0 ? "green" : "blue",
      },
      {
        label: "High-risk products",
        value: formatDashboardNumber(highRiskProducts.length),
        detail: `${formatDashboardNumber(mediumRiskProducts.length)} medium risk / ${formatDashboardNumber(totalProducts)} scanned`,
        icon: "shield-check-mark",
        tone: highRiskProducts.length ? "red" : "green",
      },
      {
        label: "Signals analyzed",
        value: formatDashboardNumber(totals.signalCount),
        detail: `${formatDashboardNumber(totals.returnUnits)} returns, ${formatDashboardNumber(totals.negativeReviewCount)} negative reviews`,
        icon: "target",
        tone: totals.signalCount ? "purple" : "blue",
      },
      {
        label: "Full diagnoses completed",
        value: formatDashboardNumber(fullDiagnoses.length),
        detail: `${formatAnalyticsPercent(totalProducts ? (fullDiagnoses.length / totalProducts) * 100 : 0)} of stored products`,
        icon: "wand",
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

  const actions = Array.isArray(options.actions) ? options.actions : [];
  base.openActions = actions.filter((action) => action.status !== "applied").length
    || productList.reduce((total, product) => total + (Array.isArray(product.recommendedActions) ? product.recommendedActions.length : 0), 0);
  base.appliedActions = actions.filter((action) => action.status === "applied").length
    || productList.reduce((total, product) => total + (Array.isArray(product.actionHistory) ? product.actionHistory.filter((action) => action.status === "applied").length : 0), 0);

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
  return productList.slice(0, 24).map((product) => {
    const impact = getDashboardMetric(product, "marginAtRisk");
    const riskScore = Number(product.riskScore || 0);
    return {
      label: product.title || product.productTitle || "Product",
      riskScore,
      impact,
      x: clampAnalyticsValue(riskScore, 3, 97),
      y: maxImpact ? clampAnalyticsValue(8 + (impact / maxImpact) * 82, 8, 92) : 12,
      size: maxImpact ? Math.round(10 + (impact / maxImpact) * 24) : 10,
      tone: riskScore >= 75 ? "red" : riskScore >= 55 ? "orange" : "green",
    };
  });
}

function buildAnalyticsAnalysisCoverage({ totalProducts, fullDiagnoses, quickScanOnly }) {
  const notScanned = Math.max(0, totalProducts - fullDiagnoses.length - quickScanOnly.length);
  return withAnalyticsColors(normalizeDashboardRows([
    { label: "Full diagnosis", value: fullDiagnoses.length },
    { label: "QuickScan only", value: quickScanOnly.length },
    { label: "Not analyzed", value: notScanned },
  ], 3, "No products"));
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

export const analyses = [
  { id: "analysis-1001", productSlug: "core-linen-trouser", productTitle: "Core Linen Trouser", status: "Completed", riskScore: 88, mainIssue: "Fit runs small", confidence: 91, credits: 1, actionsApplied: 2 },
  { id: "analysis-1002", productSlug: "trail-run-vest", productTitle: "Trail Run Vest", status: "Running", riskScore: 78, mainIssue: "Zipper failures", confidence: 84, credits: 1, actionsApplied: 0 },
  { id: "analysis-1003", productSlug: "ceramic-pour-over", productTitle: "Ceramic Pour Over", status: "Completed", riskScore: 52, mainIssue: "Compatibility confusion", confidence: 76, credits: 1, actionsApplied: 1 },
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
    analyses,
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
