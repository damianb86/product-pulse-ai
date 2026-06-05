import { authenticate } from "../shopify.server";
import { getDashboardDataForShop } from "../lib/product-pulse-jobs.server";
import { createProductPulsePerfLogger, measureProductPulseStep } from "../lib/product-pulse-perf.server";

export const loader = async ({ request }) => {
  const perf = createProductPulsePerfLogger("loader.dashboard-data", { route: "/app/dashboard-data" });
  const { admin, session } = await authenticate.admin(request);
  perf.mark("authenticate", { shop: session.shop });

  try {
    const dashboard = await measureProductPulseStep(
      perf,
      "getDashboardDataForShop",
      () => getDashboardDataForShop(session.shop, admin, { perf }),
    );
    perf.done({ shop: session.shop });
    return {
      shop: session.shop,
      dashboard,
    };
  } catch (error) {
    perf.fail(error, { shop: session.shop });
    throw error;
  }
};

export default function DashboardDataRoute() {
  return null;
}
