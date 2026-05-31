import {
  chatKitActionRequestSchema,
  handleChatKitAction,
} from "../ai/chatkit/actions.server";
import { createAiToolContextFromAuthenticatedRequest } from "../ai/context.server";
import { canUseAiAssistant } from "../ai/security/permissions.server";
import { checkAiRateLimit, rateLimitResponse } from "../ai/security/rateLimit.server";

export const loader = async () => Response.json(
  { status: "error", message: "Method not allowed." },
  { status: 405, headers: { "Cache-Control": "no-store" } },
);

export const action = async ({ request }) => {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { status: "validation_error", message: "Request body must be valid JSON." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const parsed = chatKitActionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        status: "validation_error",
        message: "ChatKit action request is invalid.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const context = await createAiToolContextFromAuthenticatedRequest(request, {
    conversationId: parsed.data.conversationId,
  });
  const permission = canUseAiAssistant(context);
  if (!permission.allowed) {
    return Response.json(
      { status: "disabled", message: permission.message },
      { status: permission.code === "AI_AUTH_REQUIRED" ? 401 : 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const rateLimit = checkAiRateLimit({ context, bucket: "chatkit_action" });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  const result = await handleChatKitAction(context, parsed.data);

  return Response.json(result, {
    status: result.status === "success" ? 200 : 400,
    headers: { "Cache-Control": "no-store" },
  });
};
