import { authenticate } from "../shopify.server";
import { isProductPulseDevelopment } from "../lib/product-pulse-dev.server";
import { getJobMonitorForShop } from "../lib/product-pulse-jobs.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  return Response.json({
    developmentMode: isProductPulseDevelopment(),
    jobMonitor: await getJobMonitorForShop(session.shop),
  });
};
