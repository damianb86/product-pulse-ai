import { authenticate } from "../shopify.server";
import { handleProductPulseAppSubscriptionUpdate } from "../lib/product-pulse-billing.server";

export const action = async ({ request }) => {
  const { payload, shop, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  await handleProductPulseAppSubscriptionUpdate(shop, payload);

  return new Response();
};
