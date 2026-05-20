import { handleChatKitMessageFromRequest } from "../ai/chatkit/message.server";

export const loader = async () => Response.json(
  { status: "error", message: "Method not allowed." },
  { status: 405, headers: { "Cache-Control": "no-store" } },
);

export const action = async ({ request }) => {
  const rawBody = await request.text();
  return handleChatKitMessageFromRequest({
    request,
    rawBody,
  });
};
