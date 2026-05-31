import { handleChatKitMessage } from "../ai/chatkit/message.server";
import { createAiToolContextFromAuthenticatedRequest } from "../ai/context.server";
import { canUseAiAssistant } from "../ai/security/permissions.server";
import { AI_MAX_CHATKIT_BODY_CHARACTERS } from "../ai/security/jsonLimits";
import { checkAiRateLimit, rateLimitResponse } from "../ai/security/rateLimit.server";

export const loader = async () => Response.json(
  { status: "error", message: "Method not allowed." },
  { status: 405, headers: { "Cache-Control": "no-store" } },
);

export const action = async ({ request }) => {
  const rawBody = await request.text();
  if (rawBody.length > AI_MAX_CHATKIT_BODY_CHARACTERS) {
    return Response.json(
      { status: "validation_error", message: "ChatKit request is too large." },
      { status: 413, headers: { "Cache-Control": "no-store" } },
    );
  }

  const context = await createAiToolContextFromAuthenticatedRequest(request);
  const permission = canUseAiAssistant(context);
  if (!permission.allowed) {
    return Response.json(
      { status: "disabled", message: permission.message },
      { status: permission.code === "AI_AUTH_REQUIRED" ? 401 : 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const rateLimit = checkAiRateLimit({ context, bucket: "chatkit_message" });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  return handleChatKitMessage(context, rawBody);
};
