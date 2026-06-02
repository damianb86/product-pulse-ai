import { authenticate } from "../shopify.server";
import {
  getComplianceWebhookSummary,
  isComplianceTopic,
  normalizeComplianceTopic,
  redactCustomerData,
  redactShopData,
} from "../lib/shopify-compliance-webhooks.server";

export const action = async ({ request }) => {
  const { payload, shop, topic } = await authenticate.webhook(request);
  const normalizedTopic = normalizeComplianceTopic(topic);

  if (!isComplianceTopic(topic)) {
    return new Response("Unhandled compliance webhook topic", { status: 404 });
  }

  const summary = getComplianceWebhookSummary({ topic, shop, payload });
  console.log(`Received ${normalizedTopic} compliance webhook for ${shop}`, summary);

  if (normalizedTopic === "customers/redact") {
    await redactCustomerData({ shop, payload });
  }

  if (normalizedTopic === "shop/redact") {
    await redactShopData({ shop });
  }

  return new Response();
};
