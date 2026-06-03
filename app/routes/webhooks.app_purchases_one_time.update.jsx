import { authenticate } from "../shopify.server";
import { handleProductPulseAppPurchaseOneTimeUpdate } from "../lib/product-pulse-billing.server";

export const action = async ({ request }) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  await handleProductPulseAppPurchaseOneTimeUpdate(shop, payload);

  return new Response();
};
