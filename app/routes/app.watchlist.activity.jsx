import { useLoaderData } from "react-router";
import { WatchlistActivityScreen } from "../components/ProductPulseScreens";
import { getWatchlistActivityForShop } from "../lib/product-pulse-watchlist.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return {
    data: {
      watchlist: await getWatchlistActivityForShop(session.shop),
    },
  };
};

export default function WatchlistActivity() {
  const { data } = useLoaderData();
  return <WatchlistActivityScreen data={data} />;
}
