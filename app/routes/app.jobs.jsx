import { useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { RunningJobsScreen } from "../components/ProductPulseScreens";
import { getAppViewData, runCatalogSignalScan } from "../lib/product-pulse-data";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return getAppViewData();
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("_action") === "run-scan") {
    return runCatalogSignalScan();
  }

  return { status: "validation_error", message: "Unsupported job action." };
};

export default function RunningJobs() {
  const data = useLoaderData();
  const actionData = useActionData();
  return <RunningJobsScreen data={data} actionData={actionData} />;
}
