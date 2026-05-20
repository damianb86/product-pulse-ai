import { z } from "zod";
import { AiChatOrchestrator } from "../ai/chat/aiChatOrchestrator.server";

const aiChatRequestSchema = z.object({
  conversationId: z.string().trim().max(320).optional(),
  message: z.string().trim().min(1).max(3000),
  pageContext: z.unknown().optional(),
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

  const orchestrator = new AiChatOrchestrator();
  const result = await orchestrator.runAiChatTurn({
    request,
    ...parsed.data,
  });

  return Response.json(result, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
};
