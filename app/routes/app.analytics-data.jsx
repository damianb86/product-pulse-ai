import { authenticate } from "../shopify.server";
import { getAnalyticsDataForShop } from "../lib/product-pulse-jobs.server";
import { createProductPulsePerfLogger, measureProductPulseStep } from "../lib/product-pulse-perf.server";

export const loader = async ({ request }) => {
  const perf = createProductPulsePerfLogger("loader.analytics-data", { route: "/app/analytics-data" });
  const { session } = await authenticate.admin(request);
  perf.mark("authenticate", { shop: session.shop });

  try {
    const analytics = await measureProductPulseStep(
      perf,
      "getAnalyticsDataForShop",
      () => getAnalyticsDataForShop(session.shop, { perf }),
    );
    perf.done({ shop: session.shop });
    return {
      shop: session.shop,
      analytics,
    };
  } catch (error) {
    perf.fail(error, { shop: session.shop });
    throw error;
  }
};

export default function AnalyticsDataRoute() {
  return null;
}
