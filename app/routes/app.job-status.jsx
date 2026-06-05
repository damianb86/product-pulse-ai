import { authenticate } from "../shopify.server";
import { isProductPulseDevelopment } from "../lib/product-pulse-dev.server";
import { cancelBackgroundJobForShop, getJobMonitorForShop } from "../lib/product-pulse-jobs.server";

export const shouldRevalidate = () => false;

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  return Response.json({
    developmentMode: isProductPulseDevelopment(),
    jobMonitor: await getJobMonitorForShop(session.shop),
  }, {
    headers: {
      "Cache-Control": "private, max-age=10",
    },
  });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("_action") === "cancel-background-job") {
    return Response.json(await cancelBackgroundJobForShop(session.shop, formData.get("jobId")));
  }

  return Response.json({ status: "validation_error", message: "Unsupported background job action." }, { status: 400 });
};
