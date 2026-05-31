import { useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { SettingsScreen } from "../components/ProductPulseScreens";
import { getAppViewData } from "../lib/product-pulse-data";
import {
  getProductPulseSettings,
  updateProductPulseSettings,
} from "../lib/product-pulse-settings.server";
import {
  getShopifyMockDatasetState,
  normalizeShopifyMockDatasetStage,
} from "../lib/product-pulse-shopify-mock-dataset.server";
import { startShopifyMockDataset } from "../lib/product-pulse-jobs.server";
import { isProductPulseDevelopment } from "../lib/product-pulse-dev.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const developmentMode = isProductPulseDevelopment();
  return {
    ...getAppViewData(),
    settings: await getProductPulseSettings(session.shop),
    developmentMode,
    mockDataset: developmentMode ? await getShopifyMockDatasetState(session.shop) : null,
  };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();

  if (String(formData.get("_action") || "") === "save-settings") {
    return updateProductPulseSettings(session.shop, formData);
  }

  if (String(formData.get("_action") || "") === "start-shopify-mock-dataset") {
    if (!isProductPulseDevelopment()) {
      return {
        status: "validation_error",
        message: "Mock dataset generation is available only in development mode.",
      };
    }
    return startShopifyMockDataset({
      shop: session.shop,
      admin,
      scopes: session.scope,
      stage: normalizeShopifyMockDatasetStage(formData.get("stage")),
    });
  }

  return { status: "validation_error", message: "Unsupported settings action." };
};

export default function Settings() {
  const data = useLoaderData();
  const actionData = useActionData();
  return <SettingsScreen data={data} actionData={actionData} />;
}
