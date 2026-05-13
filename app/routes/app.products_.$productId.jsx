import { useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ProductDiagnosisScreen } from "../components/ProductPulseScreens";
import {
  applyDraftAction,
  getAppViewData,
  getProductBySlug,
  startProductDiagnosis,
} from "../lib/product-pulse-data";
import {
  getProductSnapshotForShop,
  recordProductDetailActionForShop,
  rerunProductDiagnosisForShop,
} from "../lib/product-pulse-jobs.server";

export const loader = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const snapshotProduct = await getProductSnapshotForShop(session.shop, params.productId, admin);
  return {
    data: getAppViewData(),
    product: snapshotProduct || getProductBySlug(params.productId),
  };
};

export const action = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("_action");
  const productId = String(formData.get("productId") || params.productId || "");

  if (actionType === "diagnose") {
    const snapshotDiagnosis = await rerunProductDiagnosisForShop(session.shop, productId);
    if (snapshotDiagnosis) return snapshotDiagnosis;
    return startProductDiagnosis(productId);
  }

  if (actionType === "apply-action") {
    const snapshotAction = await recordProductDetailActionForShop(session.shop, productId, String(formData.get("actionId") || ""));
    if (snapshotAction) return snapshotAction;
    return applyDraftAction(productId, String(formData.get("actionId") || ""));
  }

  if (actionType === "mark-resolved") {
    const snapshotAction = await recordProductDetailActionForShop(session.shop, productId, "mark-resolved");
    if (snapshotAction) return snapshotAction;
    return { status: "success", message: "Product was marked as resolved." };
  }

  return { status: "validation_error", message: "Unsupported product action." };
};

export default function ProductDiagnosis() {
  const { data, product } = useLoaderData();
  const actionData = useActionData();
  return <ProductDiagnosisScreen data={data} product={product} actionData={actionData} />;
}
