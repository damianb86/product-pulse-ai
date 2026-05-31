import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { PlansCreditsScreen } from "../components/ProductPulseScreens";
import { getAppViewData } from "../lib/product-pulse-data";
import { getStorePointSummaryForShop } from "../lib/product-pulse-points.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const [data, pointSummary] = await Promise.all([
    getAppViewData(),
    getStorePointSummaryForShop(session.shop, { limit: 10 }),
  ]);
  return {
    ...data,
    pointSummary,
    billing: {
      ...(data.billing || {}),
      creditsAvailable: pointSummary.balance.available,
      creditsUsed: pointSummary.usage.used,
      pointBalance: pointSummary.balance,
      pointSummary,
    },
  };
};

export default function PlansAndCredits() {
  const data = useLoaderData();
  return <PlansCreditsScreen data={data} />;
}
