/* eslint-env node */
import { z } from "zod";
import { AiChatOrchestrator } from "../ai/chat/aiChatOrchestrator.server";
import { createAiToolContextFromAuthenticatedRequest } from "../ai/context.server";
import { canUseAiAssistant } from "../ai/security/permissions.server";
import { checkAiRateLimit, rateLimitResponse } from "../ai/security/rateLimit.server";
import { AI_MAX_PAGE_CONTEXT_CHARACTERS, isJsonWithinCharacterLimit } from "../ai/security/jsonLimits";

const aiChatRequestSchema = z.object({
  conversationId: z.string().trim().max(320).optional(),
  message: z.string().trim().min(1).max(3000),
  pageContext: z.unknown().optional().refine(
    (value) => isJsonWithinCharacterLimit(value, AI_MAX_PAGE_CONTEXT_CHARACTERS),
    "pageContext is too large.",
  ),
  userIntentMetadata: z.unknown().optional(),
}).strict();

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

  const parsed = aiChatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        status: "validation_error",
        message: "AI chat request is invalid.",
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
  const rateLimit = checkAiRateLimit({ context, bucket: "chat" });
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit);

  const orchestrator = new AiChatOrchestrator();
  const result = await orchestrator.runAiChatTurnWithContext(context, {
    ...parsed.data,
  });

  return Response.json(toPublicAiChatResult(result), {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
};

function toPublicAiChatResult(result) {
  const debugEnabled = process.env.NODE_ENV === "development" && String(process.env.AI_DEBUG_COSTS || "").toLowerCase() === "true";
  const { metadata, ...publicResult } = result;
  return {
    ...publicResult,
    metadata: debugEnabled
      ? metadata
      : {
          toolCallCount: metadata.toolCallCount,
          blockedToolCallCount: metadata.blockedToolCallCount,
          pageContext: metadata.pageContext,
        },
  };
}
