import { useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ProductsScreen } from "../components/ProductPulseScreens";
import { getAppViewData } from "../lib/product-pulse-data";
import { getCsvReviewSourceStatusForShop } from "../lib/product-pulse-csv.server";
import {
  addShopifyProductCandidateForShop,
  getProductsPageTablesForShop,
  recordProductDetailActionForShop,
  deleteProductAnalysisForShop,
  runSelectedProductDiagnosesForShop,
  searchShopifyProductsForDiagnosis,
  startFastProductScan,
} from "../lib/product-pulse-jobs.server";
import { addWatchedProductForShop, addWatchedProductsForShop, getWatchlistCapacityForShop, removeWatchedProductForShop } from "../lib/product-pulse-watchlist.server";
import { createProductPulsePerfLogger, measureProductPulseStep } from "../lib/product-pulse-perf.server";

export const loader = async ({ request }) => {
  const perf = createProductPulsePerfLogger("loader.products", { route: "/app/products" });
  const { admin, session } = await authenticate.admin(request);
  perf.mark("authenticate", { shop: session.shop });
  const url = new URL(request.url);
  const mainFilters = parseProductTableFilters(url.searchParams);
  const candidateFilters = parseProductTableFilters(url.searchParams, "candidate");
  const resolvedFilters = parseProductTableFilters(url.searchParams, "resolved");
  const filters = {
    ...mainFilters,
    candidates: candidateFilters,
    resolved: resolvedFilters,
    activeTab: normalizeProductsTab(url.searchParams.get("tab")),
  };
  const activeTab = filters.activeTab || "full";

  try {
    if (url.searchParams.get("_productTables") === "1") {
      const productTables = await loadProductsPageTables({
        shop: session.shop,
        admin,
        perf,
        activeTab,
        mainFilters,
        candidateFilters,
        resolvedFilters,
      });
      perf.done({ shop: session.shop, mode: "tables", activeTab });
      return {
        requestKey: buildProductTablesRequestKey(url),
        productTables,
      };
    }

    const [quickScanCsvReviews, watchlistCapacity] = await Promise.all([
      measureProductPulseStep(
        perf,
        "getCsvReviewSourceStatusForShop",
        () => getCsvReviewSourceStatusForShop(session.shop),
      ),
      measureProductPulseStep(
        perf,
        "getWatchlistCapacityForShop",
        () => getWatchlistCapacityForShop(session.shop),
      ),
    ]);
    const appViewData = getAppViewData(filters, {
      includeAnalytics: false,
      includeDashboard: false,
      includeProducts: false,
      includeFilteredProducts: false,
    });
    perf.mark("getAppViewData.minimal");
    perf.done({ shop: session.shop });

    return {
      data: {
        ...appViewData,
        shop: session.shop,
        productTable: buildEmptyProductTable(mainFilters),
        candidateProductTable: buildEmptyProductTable(candidateFilters),
        resolvedProductTable: buildEmptyProductTable(resolvedFilters),
        quickScanCsvReviews,
        watchlist: watchlistCapacity,
        persistProductJobs: true,
        productTablesDeferred: true,
      },
      filters,
    };
  } catch (error) {
    perf.fail(error, { shop: session.shop });
    throw error;
  }
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
    return { status: "validation_error", message: "Run Catalog Scan before resolving a product." };
  }

  if (formData.get("_action") === "mark-unresolved") {
    const productId = String(formData.get("productId") || "");
    const snapshotAction = await recordProductDetailActionForShop(session.shop, productId, "mark-unresolved");
    if (snapshotAction) return snapshotAction;
    return { status: "validation_error", message: "Run Catalog Scan before restoring a product." };
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

async function loadProductsPageTables({ shop, admin, perf, activeTab, mainFilters, candidateFilters, resolvedFilters }) {
  return measureProductPulseStep(
    perf,
    `getProductsPageTablesForShop.${activeTab || "full"}`,
    () => getProductsPageTablesForShop(shop, admin, {
      perf,
      activeTab,
      mainFilters,
      candidateFilters,
      resolvedFilters,
    }),
  );
}

function buildEmptyProductTable(filters = {}) {
  return {
    rows: [],
    total: 0,
    totalAll: 0,
    page: normalizePositiveInteger(filters.page, 1),
    rowsPerPage: normalizeProductRowsPerPage(filters.rows),
    totalPages: 1,
    filterOptions: {},
    activeScanJob: null,
    activeDiagnosisJobs: [],
  };
}

function buildProductTablesRequestKey(url) {
  const params = new URLSearchParams();
  appendProductTableSearchParams(params, parseProductTableFilters(url.searchParams));
  appendProductTableSearchParams(params, parseProductTableFilters(url.searchParams, "candidate"), "candidate");
  appendProductTableSearchParams(params, parseProductTableFilters(url.searchParams, "resolved"), "resolved");
  params.set("tab", normalizeProductsTab(url.searchParams.get("tab")) || "full");
  return params.toString();
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
    rows: normalizeProductRowsPerPage(get("rows", "5")),
    sort: get("sort", ""),
    direction: get("direction", "desc"),
  };
}

function normalizeProductRowsPerPage(value) {
  return Number(value) === 10 ? "10" : "5";
}

function appendProductTableSearchParams(params, filters = {}, prefix = "") {
  const getParamName = (name) => {
    if (!prefix) return name === "query" ? "q" : name;
    if (name === "query") return `${prefix}Q`;
    return `${prefix}${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  };

  if (filters.query) params.set(getParamName("query"), filters.query);
  ["risk", "status", "issue", "vendor", "collection"].forEach((name) => {
    if (filters[name] && filters[name] !== "all") params.set(getParamName(name), filters[name]);
  });
  if (String(filters.page || "1") !== "1") params.set(getParamName("page"), String(filters.page));
  const normalizedRows = normalizeProductRowsPerPage(filters.rows);
  if (normalizedRows !== "5") params.set(getParamName("rows"), normalizedRows);
  if (filters.sort) {
    params.set(getParamName("sort"), filters.sort);
    params.set(getParamName("direction"), filters.direction === "asc" ? "asc" : "desc");
  }
}

function normalizePositiveInteger(value, fallback = 1) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeProductsTab(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["full", "candidates", "resolved"].includes(normalized) ? normalized : "";
}
