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
      revenueAtRisk: 24700,
      marginAtRisk: 9200,
      signalCount: 42,
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
      revenueAtRisk: 18200,
      marginAtRisk: 6800,
      signalCount: 31,
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
      revenueAtRisk: 9300,
      marginAtRisk: 4100,
      signalCount: 18,
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
      revenueAtRisk: 2100,
      marginAtRisk: 900,
      signalCount: 8,
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
    nextStep: buildDashboardNextStep(startProduct, totalProducts),
  };
}

function getDashboardStartProduct(productList) {
  const product = [...productList].sort((first, second) => {
    const riskDelta = Number(second.riskScore || 0) - Number(first.riskScore || 0);
    if (riskDelta) return riskDelta;
    const impactDelta = getDashboardMetric(second, "marginAtRisk") - getDashboardMetric(first, "marginAtRisk");
    if (impactDelta) return impactDelta;
    return getDashboardMetric(second, "signalCount") - getDashboardMetric(first, "signalCount");
  })[0];

  if (!product) return null;
  const metrics = product.metrics || {};
  const hasFullDiagnosis = product.analysisDepth === "full" || Boolean(metrics.latestDiagnosisId);
  const returnRate = Number(metrics.returnRate || 0);
  const refundRate = Number(metrics.refundRate || 0);
  const negativeReviews = Number(metrics.negativeReviewCount || 0);
  const mainIssue = getDashboardIssueLabel(product.primaryIssue || metrics.mainIssue || "Product quality");

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
    summary: buildDashboardStartSummary({ product, mainIssue, returnRate, refundRate, negativeReviews }),
    actionLabel: hasFullDiagnosis ? "Open product diagnosis" : "Run product diagnosis",
    actionHint: hasFullDiagnosis ? "Review recommended actions" : "Uses 1 AI credit",
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
      windowDays: Number(metrics.windowDays || 60),
    },
  };
}

function buildDashboardStartSummary({ product, mainIssue, returnRate, refundRate, negativeReviews }) {
  const pieces = [];
  if (returnRate > 0) pieces.push(`${formatDashboardRate(returnRate)} return rate`);
  if (refundRate > 0) pieces.push(`${formatDashboardRate(refundRate)} refund rate`);
  if (negativeReviews > 0) pieces.push(`${formatDashboardNumber(negativeReviews)} negative review${negativeReviews === 1 ? "" : "s"}`);
  if (!pieces.length) {
    return `${product.title} is the highest-priority stored product. ProductPulse has catalog and scan data ready for review.`;
  }
  return `${product.title} is the highest-priority product because ${pieces.join(", ")} point to ${mainIssue.toLowerCase()}.`;
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

function buildDashboardNextStep(startProduct, totalProducts) {
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
  return {
    title: startProduct.actionLabel,
    subtitle: startProduct.title,
    detail: startProduct.summary,
    href: startProduct.href,
    buttonLabel: startProduct.actionLabel,
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

export const analytics = {
  signalsOverTime: [
    { label: "Week 1", returns: 18, reviews: 32, refunds: 9 },
    { label: "Week 2", returns: 22, reviews: 38, refunds: 13 },
    { label: "Week 3", returns: 19, reviews: 34, refunds: 11 },
    { label: "Week 4", returns: 28, reviews: 45, refunds: 17 },
  ],
  issueDistribution: [
    { label: "Fit", value: 39 },
    { label: "Defect", value: 27 },
    { label: "Compatibility", value: 18 },
    { label: "Shipping damage", value: 9 },
    { label: "Other", value: 7 },
  ],
  sourceContribution: [
    { label: "Returns", value: 34 },
    { label: "Reviews", value: 29 },
    { label: "Refunds", value: 22 },
    { label: "CSV", value: 10 },
    { label: "Support", value: 5 },
  ],
  marginByCollection: [
    { label: "Summer capsule", value: 9200 },
    { label: "Performance", value: 6800 },
    { label: "Home", value: 4100 },
    { label: "Accessories", value: 900 },
  ],
};

export const billing = {
  plan: "Pulse Starter",
  includedScan: "Catalog Signal Scan",
  creditsAvailable: 14,
  creditsUsed: 6,
  monthlyCredits: 20,
  nextReset: "2026-06-01",
};

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
    analytics,
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
