import { useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ProductsScreen } from "../components/ProductPulseScreens";
import { getAppViewData } from "../lib/product-pulse-data";
import { getCsvReviewSourceStatusForShop } from "../lib/product-pulse-csv.server";
import {
  addShopifyProductCandidateForShop,
  getProductsQueueForShop,
  recordProductDetailActionForShop,
  deleteProductAnalysisForShop,
  runSelectedProductDiagnosesForShop,
  searchShopifyProductsForDiagnosis,
  startFastProductScan,
} from "../lib/product-pulse-jobs.server";
import { getProductPulseSettings } from "../lib/product-pulse-settings.server";
import { addWatchedProductForShop, addWatchedProductsForShop, removeWatchedProductForShop } from "../lib/product-pulse-watchlist.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const settings = await getProductPulseSettings(session.shop);
  const mainFilters = parseProductTableFilters(url.searchParams);
  const candidateFilters = parseProductTableFilters(url.searchParams, "candidate");
  const resolvedFilters = parseProductTableFilters(url.searchParams, "resolved");
  const filters = {
    ...mainFilters,
    candidates: candidateFilters,
    resolved: resolvedFilters,
    activeTab: normalizeProductsTab(url.searchParams.get("tab")),
  };

  const [productTable, candidateProductTable, resolvedProductTable, quickScanCsvReviews] = await Promise.all([
    getProductsQueueForShop(session.shop, admin, { ...mainFilters, analysis: "full", resolution: "unresolved" }, { settings }),
    getProductsQueueForShop(session.shop, admin, { ...candidateFilters, analysis: "quickscan", resolution: "unresolved" }, { settings }),
    getProductsQueueForShop(session.shop, admin, { ...resolvedFilters, analysis: "all", resolution: "resolved" }, { settings }),
    getCsvReviewSourceStatusForShop(session.shop),
  ]);

  return {
    data: {
      ...getAppViewData(filters),
      productTable,
      candidateProductTable,
      resolvedProductTable,
      quickScanCsvReviews,
      persistProductJobs: true,
    },
    filters,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("_action") === "fast-product-scan") {
    return startFastProductScan({ shop: session.shop, admin, scopes: session.scope });
  }

  if (formData.get("_action") === "bulk-diagnose") {
    return runSelectedProductDiagnosesForShop(session.shop, formData.getAll("productId").map(String), { admin });
  }

  if (formData.get("_action") === "search-shopify-products") {
    return searchShopifyProductsForDiagnosis(session.shop, admin, String(formData.get("query") || ""));
  }

  if (formData.get("_action") === "add-shopify-product-candidate") {
    return addShopifyProductCandidateForShop(session.shop, admin, String(formData.get("productId") || ""));
  }

  if (formData.get("_action") === "mark-resolved") {
    const productId = String(formData.get("productId") || "");
    const snapshotAction = await recordProductDetailActionForShop(session.shop, productId, "mark-resolved");
    if (snapshotAction) return snapshotAction;
    return { status: "validation_error", message: "Run QuickScan before resolving a product." };
  }

  if (formData.get("_action") === "mark-unresolved") {
    const productId = String(formData.get("productId") || "");
    const snapshotAction = await recordProductDetailActionForShop(session.shop, productId, "mark-unresolved");
    if (snapshotAction) return snapshotAction;
    return { status: "validation_error", message: "Run QuickScan before restoring a product." };
  }

  if (formData.get("_action") === "add-to-watchlist") {
    return addWatchedProductForShop(session.shop, {
      productGid: String(formData.get("productGid") || ""),
      title: String(formData.get("title") || ""),
      handle: String(formData.get("handle") || ""),
      sku: String(formData.get("sku") || ""),
      imageUrl: String(formData.get("imageUrl") || ""),
      imageAlt: String(formData.get("imageAlt") || ""),
    });
  }

  if (formData.get("_action") === "add-selected-to-watchlist") {
    return addWatchedProductsForShop(session.shop, parseSelectedWatchlistProducts(formData.get("products")));
  }

  if (formData.get("_action") === "remove-from-watchlist") {
    return removeWatchedProductForShop(session.shop, String(formData.get("productGid") || ""));
  }

  if (formData.get("_action") === "delete-product-analysis") {
    return deleteProductAnalysisForShop(session.shop, String(formData.get("productId") || ""));
  }

  return { status: "validation_error", message: "Unsupported product action." };
};

export default function Products() {
  const { data, filters } = useLoaderData();
  const actionData = useActionData();
  return <ProductsScreen data={data} filters={filters} actionData={actionData} />;
}

function parseSelectedWatchlistProducts(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseProductTableFilters(searchParams, prefix = "") {
  const get = (name, fallback = "") => {
    if (!prefix) return searchParams.get(name) || fallback;
    const key = `${prefix}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    return searchParams.get(key) || fallback;
  };

  return {
    query: get("q", ""),
    risk: get("risk", "all"),
    status: get("status", "all"),
    issue: get("issue", "all"),
    vendor: get("vendor", "all"),
    collection: get("collection", "all"),
    page: get("page", "1"),
    rows: get("rows", "25"),
    sort: get("sort", ""),
    direction: get("direction", "desc"),
  };
}

function normalizeProductsTab(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["full", "candidates", "resolved"].includes(normalized) ? normalized : "";
}
