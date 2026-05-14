import { useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ProductDiagnosisScreen } from "../components/ProductPulseScreens";
import { getAppViewData } from "../lib/product-pulse-data";
import {
  getProductDetailForShop,
  recordProductDetailActionForShop,
  rerunProductDiagnosisForShop,
} from "../lib/product-pulse-jobs.server";

export const loader = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  return {
    data: getAppViewData(),
    product: await getProductDetailForShop(session.shop, params.productId, admin),
  };
};

export const action = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = formData.get("_action");
  const productId = String(formData.get("productId") || params.productId || "");

  if (actionType === "diagnose") {
    const snapshotDiagnosis = await rerunProductDiagnosisForShop(session.shop, productId);
    if (snapshotDiagnosis) return snapshotDiagnosis;
    return { status: "validation_error", message: "Run QuickScan before starting a product diagnosis." };
  }

  if (actionType === "apply-action") {
    const snapshotAction = await recordProductDetailActionForShop(
      session.shop,
      productId,
      String(formData.get("actionId") || ""),
      {
        label: String(formData.get("label") || ""),
        draftText: String(formData.get("draftText") || ""),
        applyMode: String(formData.get("applyMode") || ""),
        actionVariant: String(formData.get("actionVariant") || ""),
      },
      admin,
    );
    if (snapshotAction) return snapshotAction;
    return { status: "validation_error", message: "Run QuickScan before saving product actions." };
  }

  if (actionType === "mark-resolved") {
    const snapshotAction = await recordProductDetailActionForShop(session.shop, productId, "mark-resolved");
    if (snapshotAction) return snapshotAction;
    return { status: "validation_error", message: "Run QuickScan before resolving a product." };
  }

  return { status: "validation_error", message: "Unsupported product action." };
};

export default function ProductDiagnosis() {
  const { data, product } = useLoaderData();
  const actionData = useActionData();
  return <ProductDiagnosisScreen data={data} product={product} actionData={actionData} />;
}
