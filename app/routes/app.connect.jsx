import { useActionData, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { ConnectScreen } from "../components/ProductPulseScreens";
import { getAppViewData } from "../lib/product-pulse-data";
import {
  connectJudgeMeReviews,
  confirmCsvReviews,
  getConnectViewDataForShop,
  previewCsvReviews,
  setSourceActive,
} from "../lib/product-pulse-connections.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  return {
    ...getAppViewData(),
    connect: await getConnectViewDataForShop(session.shop),
    persistConnectState: true,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const actionType = String(formData.get("_action") || "");

  if (actionType === "connect-judgeme") {
    return connectJudgeMeReviews(session.shop, formData.get("privateApiToken"));
  }

  if (actionType === "preview-csv") {
    return previewCsvReviews(session.shop, formData.get("csvFile"), { admin });
  }

  if (actionType === "confirm-csv") {
    return confirmCsvReviews(session.shop, String(formData.get("csvPreview") || ""));
  }

  if (actionType === "set-source-active") {
    return setSourceActive(
      session.shop,
      String(formData.get("sourceKey") || ""),
      String(formData.get("active")) === "true",
    );
  }

  return { status: "validation_error", message: "Unsupported connection action." };
};

export default function Connect() {
  const data = useLoaderData();
  const actionData = useActionData();
  return <ConnectScreen data={data} actionData={actionData} />;
}
