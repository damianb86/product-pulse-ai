import { useActionData, useLoaderData } from "react-router";
import { WatchlistScreen } from "../components/ProductPulseScreens";
import { addWatchedProductForShop, getWatchlistForShop } from "../lib/product-pulse-watchlist.server";
import { searchShopifyProductsForDiagnosis } from "../lib/product-pulse-jobs.server";
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

  return { status: "validation_error", message: "Unsupported watchlist action." };
};

export default function Watchlist() {
  const { data } = useLoaderData();
  const actionData = useActionData();
  return <WatchlistScreen data={data} actionData={actionData} />;
}
