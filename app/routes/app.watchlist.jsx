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
  searchWatchlistEligibleProductsForShop,
  toggleWatchAlertsForShop,
  updateWatchSettingsForShop,
} from "../lib/product-pulse-watchlist.server";
import {
  runSelectedProductDiagnosesForShop,
  searchShopifyProductsForDiagnosis,
} from "../lib/product-pulse-jobs.server";
import { getStorePointBalanceForShop } from "../lib/product-pulse-points.server";
import {
  formatCreditSkippedItem,
  splitWatchlistItemsByAvailableCredits,
} from "../lib/product-pulse-watchlist-cron.server";
import {
  maybeSendWatchlistRunAlertForQueuedActivity,
  sendWatchlistCreditExhaustedEmailForShop,
} from "../lib/product-pulse-watchlist-alerts.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const selectedRunId = String(url.searchParams.get("runId") || "");
  return {
    data: {
      watchlist: await getWatchlistForShop(session.shop, { selectedRunId, defaultAlertRecipients: [session.email] }),
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

  if (actionType === "search-watchlist-eligible-products") {
    return searchWatchlistEligibleProductsForShop(session.shop, String(formData.get("query") || ""));
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
    return updateWatchSettingsForShop(session.shop, formData, { defaultAlertRecipients: [session.email] });
  }

  if (actionType === "toggle-watch-alerts") {
    return toggleWatchAlertsForShop(session.shop, { defaultAlertRecipients: [session.email] });
  }

  if (actionType === "pause-all-watches") {
    return pauseAllWatchesForShop(session.shop);
  }

  if (actionType === "resume-all-watches") {
    return resumeAllWatchesForShop(session.shop);
  }

  if (actionType === "run-watch-scan") {
    const now = new Date();
    const watchedProducts = await getActiveWatchedProductsForShop(session.shop);
    const productItems = watchedProducts.filter((product) => product.productGid);
    if (!productItems.length) {
      return {
        status: "validation_error",
        message: "There are no active watched products to diagnose.",
        action: { id: "run-watch-scan" },
      };
    }

    const pointBalance = await getStorePointBalanceForShop(session.shop);
    const creditPlan = splitWatchlistItemsByAvailableCredits(productItems, pointBalance?.available);
    if (!creditPlan.queueItems.length) {
      await recordWatchActivityForShop(session.shop, {
        eventType: "watch_manual_scan_credit_exhausted",
        title: "Manual Watchlist Product Diagnosis skipped",
        detail: "The manual Watchlist scan could not queue Product Diagnosis because the shop has no available diagnosis credits.",
        metadata: {
          triggeredBy: "watchlist-manual-run",
          forceEmail: true,
          ignoreCadence: true,
          ignoreTriggerRule: true,
          availableCredits: creditPlan.availableCredits,
          watchedCount: productItems.length,
          skippedForCredits: creditPlan.skippedForCredits.map(formatCreditSkippedItem),
          ranAt: now.toISOString(),
        },
      });
      await sendWatchlistCreditExhaustedEmailForShop({
        shop: session.shop,
        items: creditPlan.skippedForCredits,
        pointBalance,
        now,
        forceEmail: true,
        triggeredBy: "watchlist-manual-run",
      });
      return {
        status: "validation_error",
        message: "No watched Product Diagnosis jobs were queued because this shop has no available diagnosis credits.",
        action: { id: "run-watch-scan" },
      };
    }

    const productIds = creditPlan.queueItems.map((product) => product.productGid).filter(Boolean);
    const result = await runSelectedProductDiagnosesForShop(session.shop, productIds, { admin });
    if (result?.status === "success") {
      const queuedActivity = await recordWatchActivityForShop(session.shop, {
        eventType: "watch_manual_scan_queued",
        title: "Manual Watchlist Product Diagnosis queued",
        detail: `${result.queuedCount || productIds.length} deep product diagnostic${(result.queuedCount || productIds.length) === 1 ? "" : "s"} queued from Watchlist.`,
        metadata: {
          triggeredBy: "watchlist-manual-run",
          forceEmail: true,
          ignoreCadence: true,
          ignoreTriggerRule: true,
          queuedCount: result.queuedCount || productIds.length,
          productGids: productIds,
          productTitles: creditPlan.queueItems.map((product) => product.productTitle).filter(Boolean),
          jobIds: Array.isArray(result.jobs) ? result.jobs.map((job) => job.id).filter(Boolean) : [],
          availableCreditsAtQueue: creditPlan.availableCredits,
          availableCredits: Math.max(0, creditPlan.availableCredits - productIds.length),
          skippedForCredits: creditPlan.skippedForCredits.map(formatCreditSkippedItem),
          creditExhausted: creditPlan.skippedForCredits.length > 0,
        },
      });
      await maybeSendWatchlistRunAlertForQueuedActivity(session.shop, queuedActivity);
    }
    return {
      ...result,
      action: { id: "run-watch-scan" },
      message: result?.status === "success"
        ? `${result.queuedCount || productIds.length} watched product diagnostic${(result.queuedCount || productIds.length) === 1 ? "" : "s"} queued. A confirmation email will be sent when email alerts are enabled.`
        : result?.message || "Watchlist Product Diagnosis could not be queued.",
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
