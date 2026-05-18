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
} from "../lib/product-pulse-shopify-mock-dataset.server";
import { startShopifyMockDataset } from "../lib/product-pulse-jobs.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return {
    ...getAppViewData(),
    settings: await getProductPulseSettings(session.shop),
    mockDataset: await getShopifyMockDatasetState(session.shop),
  };
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();

  if (String(formData.get("_action") || "") === "save-settings") {
    return updateProductPulseSettings(session.shop, formData);
  }

  if (String(formData.get("_action") || "") === "start-shopify-mock-dataset") {
    return startShopifyMockDataset({
      shop: session.shop,
      admin,
      scopes: session.scope,
    });
  }

  return { status: "validation_error", message: "Unsupported settings action." };
};

export default function Settings() {
  const data = useLoaderData();
  const actionData = useActionData();
  return <SettingsScreen data={data} actionData={actionData} />;
}
