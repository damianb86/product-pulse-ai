import { useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { RunningJobsScreen } from "../components/ProductPulseScreens";
import { getAppViewData } from "../lib/product-pulse-data";
import { getRecentJobsForShop, startFastProductScan } from "../lib/product-pulse-jobs.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return {
    ...getAppViewData(),
    jobs: await getRecentJobsForShop(session.shop),
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("_action") === "run-scan") {
    return startFastProductScan({ shop: session.shop, admin, scopes: session.scope });
  }

  return { status: "validation_error", message: "Unsupported job action." };
};

export default function RunningJobs() {
  const data = useLoaderData();
  const actionData = useActionData();
  return <RunningJobsScreen data={data} actionData={actionData} />;
}
