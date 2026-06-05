import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { AnalyticsScreen } from "../components/ProductPulseScreens";
import { getAppViewData } from "../lib/product-pulse-data";
import { createProductPulsePerfLogger } from "../lib/product-pulse-perf.server";

export const loader = async ({ request }) => {
  const perf = createProductPulsePerfLogger("loader.analytics", { route: "/app/analytics" });
  const { session } = await authenticate.admin(request);
  perf.mark("authenticate", { shop: session.shop });

  try {
    const appViewData = getAppViewData({}, {
      includeAnalytics: false,
      includeDashboard: false,
      includeProducts: false,
      includeFilteredProducts: false,
    });
    perf.mark("getAppViewData.minimal");
    perf.done({ shop: session.shop });
    return {
      ...appViewData,
      shop: session.shop,
      analytics: null,
      analyticsDeferred: true,
    };
  } catch (error) {
    perf.fail(error, { shop: session.shop });
    throw error;
  }
};

export default function Analytics() {
  const data = useLoaderData();
  return <AnalyticsScreen data={data} />;
}
