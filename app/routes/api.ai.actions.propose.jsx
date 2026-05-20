import { z } from "zod";
import { createAiToolContextFromAuthenticatedRequest } from "../ai/context.server";
import { createAiActionRegistry } from "../ai/actions/registry.server";
import {
  aiActionProposalToPresentationBlock,
  aiActionProposalToSafeSummary,
} from "../ai/actions/presentation";
import { mapAiPresentationBlockToChatKitWidget } from "../ai/chatkit/widgets";

const aiActionProposeRequestSchema = z.object({
  actionName: z.string().trim().min(1).max(160),
  input: z.unknown().optional(),
  conversationId: z.string().trim().max(320).optional(),
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

  const parsed = aiActionProposeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return validationResponse("AI action proposal request is invalid.", parsed.error.issues);
  }

  const context = await createAiToolContextFromAuthenticatedRequest(request, {
    conversationId: parsed.data.conversationId,
  });
  const registry = createAiActionRegistry();
  const result = await registry.createAiActionProposal(
    context,
    parsed.data.actionName,
    parsed.data.input || {},
  );

  if (!result.ok) {
    return Response.json(
      { status: "error", message: result.error.message, error: result.error },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const block = aiActionProposalToPresentationBlock(result.data.proposal);
  return Response.json(
    {
      status: "success",
      proposal: aiActionProposalToSafeSummary(result.data.proposal),
      block,
      widget: mapAiPresentationBlockToChatKitWidget(block),
    },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
};

function validationResponse(message, issues) {
  return Response.json(
    {
      status: "validation_error",
      message,
      issues: issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
