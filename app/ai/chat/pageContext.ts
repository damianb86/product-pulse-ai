import { z } from "zod";

export const aiPageContextSchema = z.object({
  type: z.enum(["dashboard", "products", "product", "analytics", "watchlist", "connect", "settings", "unknown"]).default("unknown"),
  entityId: z.string().trim().max(320).optional(),
  entityHandle: z.string().trim().max(180).optional(),
  filters: z.record(z.string().max(80), z.union([
    z.string().max(180),
    z.number(),
    z.boolean(),
    z.null(),
  ])).optional(),
  dateRange: z.object({
    from: z.string().max(40).optional(),
    to: z.string().max(40).optional(),
  }).strict().optional(),
  visibleEntityIds: z.array(z.string().trim().max(320)).max(25).optional(),
}).strict();

export type AiPageContext = z.infer<typeof aiPageContextSchema>;

export function normalizeAiPageContext(value: unknown): AiPageContext {
  const parsed = aiPageContextSchema.safeParse(value || {});
  return parsed.success ? parsed.data : { type: "unknown" };
}

export function getPageContextReference(pageContext: AiPageContext): string {
  if (pageContext.type === "product") {
    return pageContext.entityId || pageContext.entityHandle || "";
  }
  return "";
}
