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
    },
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
    },
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
    },
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
    },
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
