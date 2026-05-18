import { useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ProductDiagnosisScreen } from "../components/ProductPulseScreens";
import { getAppViewData } from "../lib/product-pulse-data";
import {
  getProductDetailForShop,
  recordProductDetailActionForShop,
  rerunProductDiagnosisForShop,
} from "../lib/product-pulse-jobs.server";
import { addWatchedProductForShop, removeWatchedProductForShop } from "../lib/product-pulse-watchlist.server";

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
        field: String(formData.get("field") || ""),
        tag: String(formData.get("tag") || ""),
        applyMode: String(formData.get("applyMode") || ""),
        actionVariant: String(formData.get("actionVariant") || ""),
        descriptionOperation: String(formData.get("descriptionOperation") || ""),
      },
      admin,
    );
    if (snapshotAction) return snapshotAction;
    return { status: "validation_error", message: "Run QuickScan before saving product actions." };
  }

  if (actionType === "dismiss-action") {
    const snapshotAction = await recordProductDetailActionForShop(
      session.shop,
      productId,
      String(formData.get("actionId") || ""),
      {
        label: String(formData.get("label") || ""),
        actionStatus: "dismissed",
      },
      admin,
    );
    if (snapshotAction) return snapshotAction;
    return { status: "validation_error", message: "Run QuickScan before dismissing product actions." };
  }

  if (actionType === "restore-action") {
    const snapshotAction = await recordProductDetailActionForShop(
      session.shop,
      productId,
      String(formData.get("actionId") || ""),
      {
        label: String(formData.get("label") || ""),
        actionStatus: "active",
      },
      admin,
    );
    if (snapshotAction) return snapshotAction;
    return { status: "validation_error", message: "Run QuickScan before restoring product actions." };
  }

  if (actionType === "review-action") {
    const snapshotAction = await recordProductDetailActionForShop(
      session.shop,
      productId,
      String(formData.get("actionId") || ""),
      {
        label: String(formData.get("label") || ""),
        actionStatus: "reviewed",
      },
      admin,
    );
    if (snapshotAction) return snapshotAction;
    return { status: "validation_error", message: "Run QuickScan before marking product actions reviewed." };
  }

  if (actionType === "ignore-issue") {
    const snapshotAction = await recordProductDetailActionForShop(
      session.shop,
      productId,
      "ignore-issue",
      {
        issue: String(formData.get("issue") || ""),
        issueCode: String(formData.get("issueCode") || ""),
        issueKey: String(formData.get("issueKey") || ""),
        suggestedAction: String(formData.get("suggestedAction") || ""),
      },
      admin,
    );
    if (snapshotAction) return snapshotAction;
    return { status: "validation_error", message: "Run QuickScan before ignoring product issues." };
  }

  if (actionType === "unignore-issue") {
    const snapshotAction = await recordProductDetailActionForShop(
      session.shop,
      productId,
      "unignore-issue",
      {
        issue: String(formData.get("issue") || ""),
        issueCode: String(formData.get("issueCode") || ""),
        issueKey: String(formData.get("issueKey") || ""),
        suggestedAction: String(formData.get("suggestedAction") || ""),
      },
      admin,
    );
    if (snapshotAction) return snapshotAction;
    return { status: "validation_error", message: "Run QuickScan before restoring product issues." };
  }

  if (actionType === "mark-resolved") {
    const snapshotAction = await recordProductDetailActionForShop(session.shop, productId, "mark-resolved");
    if (snapshotAction) return snapshotAction;
    return { status: "validation_error", message: "Run QuickScan before resolving a product." };
  }

  if (actionType === "mark-unresolved") {
    const snapshotAction = await recordProductDetailActionForShop(session.shop, productId, "mark-unresolved");
    if (snapshotAction) return snapshotAction;
    return { status: "validation_error", message: "Run QuickScan before restoring a product." };
  }

  if (actionType === "add-to-watchlist") {
    return addWatchedProductForShop(session.shop, {
      productGid: String(formData.get("productGid") || ""),
      title: String(formData.get("title") || ""),
      handle: String(formData.get("handle") || ""),
      sku: String(formData.get("sku") || ""),
      imageUrl: String(formData.get("imageUrl") || ""),
      imageAlt: String(formData.get("imageAlt") || ""),
    });
  }

  if (actionType === "remove-from-watchlist") {
    return removeWatchedProductForShop(session.shop, String(formData.get("productGid") || ""));
  }

  return { status: "validation_error", message: "Unsupported product action." };
};

export default function ProductDiagnosis() {
  const { data, product } = useLoaderData();
  const actionData = useActionData();
  return <ProductDiagnosisScreen data={data} product={product} actionData={actionData} />;
}
