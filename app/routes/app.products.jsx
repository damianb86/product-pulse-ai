import { useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ProductsScreen } from "../components/ProductPulseScreens";
import { getAppViewData } from "../lib/product-pulse-data";
import {
  getProductsQueueForShop,
  recordProductDetailActionForShop,
  runSelectedProductDiagnosesForShop,
  searchShopifyProductsForDiagnosis,
  startFastProductScan,
} from "../lib/product-pulse-jobs.server";
import { getProductPulseSettings } from "../lib/product-pulse-settings.server";
import { addWatchedProductForShop, removeWatchedProductForShop } from "../lib/product-pulse-watchlist.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const settings = await getProductPulseSettings(session.shop);
  const filters = {
    query: url.searchParams.get("q") || "",
    analysis: url.searchParams.get("analysis") || "all",
    risk: url.searchParams.get("risk") || "all",
    status: url.searchParams.get("status") || "all",
    issue: url.searchParams.get("issue") || "all",
    source: url.searchParams.get("source") || "all",
    vendor: url.searchParams.get("vendor") || "all",
    collection: url.searchParams.get("collection") || "all",
    page: url.searchParams.get("page") || "1",
    rows: url.searchParams.get("rows") || "25",
    sort: url.searchParams.get("sort") || "",
    direction: url.searchParams.get("direction") || "desc",
  };

  return {
    data: {
      ...getAppViewData(filters),
      productTable: await getProductsQueueForShop(session.shop, admin, filters, { settings }),
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

  if (formData.get("_action") === "remove-from-watchlist") {
    return removeWatchedProductForShop(session.shop, String(formData.get("productGid") || ""));
  }

  return { status: "validation_error", message: "Unsupported product action." };
};

export default function Products() {
  const { data, filters } = useLoaderData();
  const actionData = useActionData();
  return <ProductsScreen data={data} filters={filters} actionData={actionData} />;
}
