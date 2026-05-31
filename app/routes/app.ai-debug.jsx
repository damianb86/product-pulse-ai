/* eslint-env node */
import { useLoaderData } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { isProductPulseDevelopment } from "../lib/product-pulse-dev.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const enabled = isProductPulseDevelopment() || String(process.env.AI_DEBUG_COSTS || "").toLowerCase() === "true";
  if (!enabled) {
    throw new Response("Not found", { status: 404 });
  }

  const messages = await prisma.aiConversationMessage.findMany({
    where: {
      shop: session.shop,
      role: "assistant",
    },
    orderBy: { createdAt: "desc" },
    take: 40,
  });

  return {
    shop: session.shop,
    traces: messages.flatMap((message) => {
      const trace = message.structuredContent && typeof message.structuredContent === "object"
        ? message.structuredContent.trace
        : null;
      if (!trace) return [];
      return [{
        id: message.id,
        conversationId: message.conversationId,
        createdAt: message.createdAt,
        trace,
      }];
    }).slice(0, 20),
  };
};

export default function AiDebug() {
  const { shop, traces } = useLoaderData();
  return (
    <main style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
      <h1>AI debug</h1>
      <p>Recent internal AI traces for {shop}. This route is development/debug only.</p>
      <pre style={{ whiteSpace: "pre-wrap", overflowX: "auto", background: "#f6f6f7", padding: 16 }}>
        {JSON.stringify(traces, null, 2)}
      </pre>
    </main>
  );
}
