import { authenticate } from "../shopify.server";
import db from "../db.server";
import { sendAppUninstalledNotification } from "../lib/app-lifecycle-notifications.server";

export const action = async ({ request }) => {
  const { payload, shop, session, topic, webhookId } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  await sendAppUninstalledNotification({ shop, payload, session, topic, webhookId });

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
