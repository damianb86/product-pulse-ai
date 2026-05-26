import { useActionData, useLoaderData } from "react-router";
import { WatchlistScreen } from "../components/ProductPulseScreens";
import {
  addWatchedProductForShop,
  getActiveWatchedProductsForShop,
  getWatchlistForShop,
  pauseAllWatchesForShop,
  pauseWatchedProductForShop,
  recordWatchActivityForShop,
  removeWatchedProductForShop,
  resumeAllWatchesForShop,
  resumeWatchedProductForShop,
  toggleWatchAlertsForShop,
  updateWatchSettingsForShop,
} from "../lib/product-pulse-watchlist.server";
import {
  runSelectedProductDiagnosesForShop,
  searchShopifyProductsForDiagnosis,
} from "../lib/product-pulse-jobs.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return {
    data: {
      watchlist: await getWatchlistForShop(session.shop),
    },
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = String(formData.get("_action") || "");

  if (actionType === "search-shopify-products") {
    return searchShopifyProductsForDiagnosis(session.shop, admin, String(formData.get("query") || ""));
  }

  if (actionType === "add-watched-product") {
    return addWatchedProductForShop(session.shop, {
      productGid: String(formData.get("productGid") || ""),
      title: String(formData.get("title") || ""),
      handle: String(formData.get("handle") || ""),
      sku: String(formData.get("sku") || ""),
      imageUrl: String(formData.get("imageUrl") || ""),
      imageAlt: String(formData.get("imageAlt") || ""),
    });
  }

  if (actionType === "pause-watched-product") {
    return pauseWatchedProductForShop(session.shop, String(formData.get("productGid") || ""));
  }

  if (actionType === "resume-watched-product") {
    return resumeWatchedProductForShop(session.shop, String(formData.get("productGid") || ""));
  }

  if (actionType === "remove-watched-product") {
    return removeWatchedProductForShop(session.shop, String(formData.get("productGid") || ""));
  }

  if (actionType === "update-watch-settings") {
    return updateWatchSettingsForShop(session.shop, formData);
  }

  if (actionType === "toggle-watch-alerts") {
    return toggleWatchAlertsForShop(session.shop);
  }

  if (actionType === "pause-all-watches") {
    return pauseAllWatchesForShop(session.shop);
  }

  if (actionType === "resume-all-watches") {
    return resumeAllWatchesForShop(session.shop);
  }

  if (actionType === "run-watch-scan") {
    const watchedProducts = await getActiveWatchedProductsForShop(session.shop);
    const productIds = watchedProducts.map((product) => product.productGid).filter(Boolean);
    if (!productIds.length) {
      return {
        status: "validation_error",
        message: "There are no active watched products to diagnose.",
        action: { id: "run-watch-scan" },
      };
    }

    const result = await runSelectedProductDiagnosesForShop(session.shop, productIds, { admin });
    if (result?.status === "success") {
      await recordWatchActivityForShop(session.shop, {
        eventType: "watch_scan_queued",
        title: "Watch diagnostics queued",
        detail: `${result.queuedCount || productIds.length} deep product diagnostic${(result.queuedCount || productIds.length) === 1 ? "" : "s"} queued from Watchlist.`,
        metadata: {
          queuedCount: result.queuedCount || productIds.length,
          productGids: productIds,
          productTitles: watchedProducts.map((product) => product.productTitle).filter(Boolean),
        },
      });
    }
    return {
      ...result,
      action: { id: "run-watch-scan" },
      message: result?.status === "success"
        ? `${result.queuedCount || productIds.length} watched product diagnostic${(result.queuedCount || productIds.length) === 1 ? "" : "s"} queued.`
        : result?.message || "Watch diagnostics could not be queued.",
      suppressBanner: result?.status === "success",
    };
  }

  return { status: "validation_error", message: "Unsupported watchlist action." };
};

export default function Watchlist() {
  const { data } = useLoaderData();
  const actionData = useActionData();
  return <WatchlistScreen data={data} actionData={actionData} />;
}
