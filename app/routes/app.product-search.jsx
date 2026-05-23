import { authenticate } from "../shopify.server";
import { searchShopifyProductsForDiagnosis } from "../lib/product-pulse-jobs.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const query = String(url.searchParams.get("q") || "").trim();

  if (query.length < 2) {
    return Response.json({ status: "success", query, products: [] });
  }

  return Response.json(await searchShopifyProductsForDiagnosis(session.shop, admin, query));
};
