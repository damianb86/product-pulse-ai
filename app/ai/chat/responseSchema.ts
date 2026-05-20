import { z } from "zod";
import { aiPresentationBlockSchema } from "../presentation/blocks";

export const aiReferencedEntitySchema = z.object({
  type: z.enum(["product", "diagnosis", "watchlist", "analytics", "source"]).default("product"),
  id: z.string().max(320),
  label: z.string().max(220).optional(),
}).strict();

export const aiAssistantResponseSchema = z.object({
  assistantText: z.string().min(1).max(4000),
  blocks: z.array(aiPresentationBlockSchema).max(8).default([]),
  suggestedReplies: z.array(z.string().min(1).max(140)).max(4).default([]),
  referencedEntities: z.array(aiReferencedEntitySchema).max(12).default([]),
  followUpQuestions: z.array(z.string().min(1).max(180)).max(4).default([]),
  warnings: z.array(z.string().min(1).max(240)).max(6).default([]),
}).strict();

export type AiAssistantResponse = z.infer<typeof aiAssistantResponseSchema>;

export function parseAiAssistantResponse(value: unknown): AiAssistantResponse | null {
  const parsed = aiAssistantResponseSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function createFallbackAssistantResponse(message: string, warnings: string[] = []): AiAssistantResponse {
  return {
    assistantText: message,
    blocks: [],
    suggestedReplies: [],
    referencedEntities: [],
    followUpQuestions: [],
    warnings,
  };
}
