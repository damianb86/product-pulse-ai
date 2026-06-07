/* eslint-env node */
import OpenAI from "openai";
import { handleOpenAiWebhookEventForProductPulse } from "../lib/product-pulse-jobs.server";

export const action = async ({ request }) => {
  const rawBody = await request.text();
  const webhookSecret = String(process.env.OPENAI_WEBHOOK_SECRET || "").trim();
  if (!webhookSecret) {
    return new Response("OPENAI_WEBHOOK_SECRET is not configured.", { status: 500 });
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || "webhook-signature-only",
    webhookSecret,
  });
  const headers = Object.fromEntries(request.headers.entries());

  let event;
  try {
    event = await client.webhooks.unwrap(rawBody, headers);
  } catch (error) {
    if (error instanceof OpenAI.InvalidWebhookSignatureError) {
      return new Response("Invalid OpenAI webhook signature.", { status: 400 });
    }
    throw error;
  }

  const result = await handleOpenAiWebhookEventForProductPulse(event, headers);
  return Response.json({ status: "ok", result });
};
