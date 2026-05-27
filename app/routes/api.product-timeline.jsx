import { authenticate } from "../shopify.server";
import { getProductTimelineForShop } from "../lib/product-pulse-timeline.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const productId = String(url.searchParams.get("productId") || url.searchParams.get("productGid") || url.searchParams.get("handle") || "").trim();

  if (!productId) {
    return Response.json({
      status: "validation_error",
      message: "productId is required.",
      events: [],
      groupedEvents: [],
      filters: { categories: [] },
      pagination: { limit: 80, offset: 0, hasMore: false },
    }, { status: 400 });
  }

  const timeline = await getProductTimelineForShop(session.shop, productId, {
    category: url.searchParams.get("category") || url.searchParams.get("categories") || "",
    minImportance: url.searchParams.get("minImportance") || "",
    from: url.searchParams.get("from") || url.searchParams.get("dateFrom") || "",
    to: url.searchParams.get("to") || url.searchParams.get("dateTo") || "",
    limit: url.searchParams.get("limit") || "",
    offset: url.searchParams.get("offset") || "",
    backfill: url.searchParams.get("backfill") !== "false",
  });

  return Response.json({ status: "success", ...timeline });
};
