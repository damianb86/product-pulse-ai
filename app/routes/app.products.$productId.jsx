import { useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ProductDiagnosisScreen } from "../components/ProductPulseScreens";
import {
  applyDraftAction,
  getAppViewData,
  getProductBySlug,
  startProductDiagnosis,
} from "../lib/product-pulse-data";

export const loader = async ({ request, params }) => {
  await authenticate.admin(request);
  return {
    data: getAppViewData(),
    product: getProductBySlug(params.productId),
  };
};

export const action = async ({ request, params }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("_action");
  const productId = String(formData.get("productId") || params.productId || "");

  if (actionType === "diagnose") {
    return startProductDiagnosis(productId);
  }

  if (actionType === "apply-action") {
    return applyDraftAction(productId, String(formData.get("actionId") || ""));
  }

  return { status: "validation_error", message: "Unsupported product action." };
};

export default function ProductDiagnosis() {
  const { data, product } = useLoaderData();
  const actionData = useActionData();
  return <ProductDiagnosisScreen data={data} product={product} actionData={actionData} />;
}
