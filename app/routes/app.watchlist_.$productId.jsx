import { useLoaderData } from "react-router";
import { WatchlistProductScreen } from "../components/ProductPulseScreens";
import { getWatchlistProductForShop } from "../lib/product-pulse-watchlist.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  return {
    product: await getWatchlistProductForShop(session.shop, params.productId),
  };
};

export default function WatchlistProduct() {
  const { product } = useLoaderData();
  return <WatchlistProductScreen product={product} />;
}
