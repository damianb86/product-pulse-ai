import { useEffect } from "react";
import { useActionData, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { DashboardScreen } from "../components/ProductPulseScreens";
import { getAppViewData, runCatalogSignalScan } from "../lib/product-pulse-data";
import { getDashboardDataForShop } from "../lib/product-pulse-jobs.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return {
    ...getAppViewData(),
    dashboard: await getDashboardDataForShop(session.shop),
  };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("_action") === "run-scan") {
    return runCatalogSignalScan();
  }

  return { status: "validation_error", message: "Unsupported dashboard action." };
};

export default function Index() {
  const data = useLoaderData();
  const actionData = useActionData();
  const shopify = useAppBridge();

  useEffect(() => {
    if (actionData?.status === "success") {
      shopify.toast.show(actionData.message);
    }
  }, [actionData, shopify]);

  return <DashboardScreen data={data} actionData={actionData} />;
}
