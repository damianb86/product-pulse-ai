import { useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ProductDiagnosisScreen } from "../components/ProductPulseScreens";
import {
  applyDraftAction,
  getAppViewData,
  getProductBySlug,
  startProductDiagnosis,
} from "../lib/product-pulse-data";
import { getProductSnapshotForShop } from "../lib/product-pulse-jobs.server";

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const snapshotProduct = await getProductSnapshotForShop(session.shop, params.productId);
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
    const snapshotProduct = await getProductSnapshotForShop(session.shop, productId);
    if (snapshotProduct) {
      return {
        status: "success",
        message: `AI Product Diagnosis started for ${snapshotProduct.title}. One credit was consumed.`,
        product: snapshotProduct,
      };
    }
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
