import { authenticate } from "../shopify.server";
import type { AiToolContext } from "./domain/types";

export function createAiToolContext(input: {
  shop: string;
  userId?: string | number | null;
  sessionId?: string | null;
  scopes?: string[] | string | null;
  requestId?: string;
  conversationId?: string;
  createdAt?: string | Date;
}): AiToolContext {
  const shop = String(input.shop || "").trim();
  if (!shop) {
    throw new Error("AI tool context requires an authenticated shop.");
  }

  return {
    shop,
    userId: input.userId ?? null,
    sessionId: input.sessionId ?? null,
    scopes: normalizeScopes(input.scopes),
    requestId: optionalString(input.requestId),
    conversationId: optionalString(input.conversationId),
    createdAt: toIso(input.createdAt) || new Date().toISOString(),
  };
}

export async function createAiToolContextFromAuthenticatedRequest(
  request: Request,
  options: { conversationId?: string; requestId?: string } = {},
): Promise<AiToolContext> {
  const { session } = await authenticate.admin(request);
  const authenticatedSession = session as unknown as {
    id?: string | null;
    shop: string;
    scope?: string | null;
    userId?: string | number | bigint | null;
  };
  return createAiToolContext({
    shop: authenticatedSession.shop,
    userId: authenticatedSession.userId ? String(authenticatedSession.userId) : null,
    sessionId: authenticatedSession.id || null,
    scopes: authenticatedSession.scope || null,
    conversationId: options.conversationId,
    requestId: options.requestId || request.headers.get("x-request-id") || undefined,
  });
}

function normalizeScopes(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function optionalString(value: unknown): string | undefined {
  const normalized = String(value || "").trim();
  return normalized || undefined;
}

function toIso(value: string | Date | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
