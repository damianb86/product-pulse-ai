import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { AnalyticsScreen } from "../components/ProductPulseScreens";
import { getAppViewData } from "../lib/product-pulse-data";
import { getAnalyticsDataForShop } from "../lib/product-pulse-jobs.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return {
    ...getAppViewData(),
    analytics: await getAnalyticsDataForShop(session.shop),
  };
};

export default function Analytics() {
  const data = useLoaderData();
  return <AnalyticsScreen data={data} />;
}
