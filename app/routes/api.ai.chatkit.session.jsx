import {
  aiChatKitSessionRequestSchema,
  createAiChatKitSessionFromRequest,
} from "../ai/chatkit/session.server";

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

  const parsed = aiChatKitSessionRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        status: "validation_error",
        message: "ChatKit session request is invalid.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const result = await createAiChatKitSessionFromRequest({
    request,
    sessionInput: parsed.data,
  });

  if (!result.enabled) {
    return Response.json(
      { status: "disabled", ...result },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return Response.json(
    { status: "success", ...result },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
};
