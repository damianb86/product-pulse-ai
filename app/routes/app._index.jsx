import { useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { DashboardScreen } from "../components/ProductPulseScreens";
import { getAppViewData, runCatalogSignalScan } from "../lib/product-pulse-data";
import { getDashboardDataForShop, queueProductDiagnosisForShop } from "../lib/product-pulse-jobs.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  return {
    ...getAppViewData(),
    dashboard: await getDashboardDataForShop(session.shop, admin),
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("_action") === "run-scan") {
    return runCatalogSignalScan();
  }

  if (formData.get("_action") === "diagnose") {
    const productId = String(formData.get("productId") || "");
    const diagnosis = await queueProductDiagnosisForShop(session.shop, productId, { admin });
    if (diagnosis) return diagnosis;
    return { status: "validation_error", message: "Run Catalog Scan before starting a product diagnosis." };
  }

  return { status: "validation_error", message: "Unsupported dashboard action." };
};

export default function Index() {
  const data = useLoaderData();
  const actionData = useActionData();

  return <DashboardScreen data={data} actionData={actionData} />;
}
