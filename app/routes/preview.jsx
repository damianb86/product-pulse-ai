import { useActionData, useLoaderData } from "react-router";
import {
  applyDraftAction,
  getAppViewData,
  runCatalogSignalScan,
  startProductDiagnosis,
} from "../lib/product-pulse-data";
import { PreviewScreen } from "../components/ProductPulseScreens";

export const loader = async () => getAppViewData();

export const action = async ({ request }) => {
  const formData = await request.formData();
  const actionType = formData.get("_action");
  const productId = String(formData.get("productId") || "core-linen-trouser");

  if (actionType === "run-scan") {
    return runCatalogSignalScan();
  }

  if (actionType === "diagnose") {
    return startProductDiagnosis(productId);
  }

  if (actionType === "apply-action") {
    return applyDraftAction(productId, String(formData.get("actionId") || ""));
  }

  if (actionType === "mark-resolved") {
    return {
      status: "success",
      message: "Product was marked as resolved.",
      action: { id: "mark-resolved" },
    };
  }

  return { status: "validation_error", message: "Unsupported preview action." };
};

export default function Preview() {
  const data = useLoaderData();
  const actionData = useActionData();
  return <PreviewScreen data={data} actionData={actionData} />;
}
