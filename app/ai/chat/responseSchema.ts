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
  if (parsed.success) return parsed.data;
  return recoverAiAssistantResponse(value);
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

function recoverAiAssistantResponse(value: unknown): AiAssistantResponse | null {
  const record = asRecord(value);
  if (!record || typeof record.assistantText !== "string") return null;
  const assistantText = record.assistantText.trim();
  if (!assistantText) return null;

  return {
    assistantText: truncate(assistantText, 4000),
    blocks: recoverPresentationBlocks(record.blocks),
    suggestedReplies: stringList(record.suggestedReplies, 4, 140),
    referencedEntities: recoverReferencedEntities(record.referencedEntities),
    followUpQuestions: stringList(record.followUpQuestions, 4, 180),
    warnings: stringList(record.warnings, 6, 240),
  };
}

function recoverPresentationBlocks(value: unknown): AiAssistantResponse["blocks"] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 8)
    .map(recoverPresentationBlock)
    .filter(Boolean) as AiAssistantResponse["blocks"];
}

function recoverPresentationBlock(value: unknown): AiAssistantResponse["blocks"][number] | null {
  const record = asRecord(value);
  const type = typeof record?.type === "string" ? record.type : "";
  const keys = PRESENTATION_BLOCK_KEYS[type];
  if (!record || !keys) return null;

  const block = pickKnownKeys(record, keys);
  trimArrayField(block, "metrics", 4);
  trimArrayField(block, "issues", 8);
  trimArrayField(block, "items", type === "recommendation_list" ? 10 : type === "entity_list" ? 8 : 8);
  trimArrayField(block, "rows", 12);
  trimArrayField(block, "risks", 6);
  trimArrayField(block, "affectedEntities", 6);
  trimArrayField(block, "editableFields", 8);
  trimArrayField(block, "validationWarnings", 8);
  trimArrayField(block, "inputs", 8);
  trimArrayField(block, "outputs", 8);
  trimArrayField(block, "thresholds", 8);
  trimArrayField(block, "interpretation", 6);
  trimArrayField(block, "caveats", 6);
  trimArrayField(block, "steps", 8);
  trimArrayField(block, "dataShown", 8);
  trimArrayField(block, "howToRead", 8);
  trimArrayField(block, "commonActions", 8);
  trimArrayField(block, "options", 6);

  const parsed = aiPresentationBlockSchema.safeParse(block);
  return parsed.success ? parsed.data : null;
}

function recoverReferencedEntities(value: unknown): AiAssistantResponse["referencedEntities"] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).map((item) => {
    const record = asRecord(item);
    if (!record || typeof record.id !== "string") return null;
    const parsed = aiReferencedEntitySchema.safeParse(pickKnownKeys(record, ["type", "id", "label"]));
    return parsed.success ? parsed.data : null;
  }).filter(Boolean) as AiAssistantResponse["referencedEntities"];
}

function stringList(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === "string")
    .map((item) => truncate(item.trim(), maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function pickKnownKeys(record: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys
    .filter((key) => Object.prototype.hasOwnProperty.call(record, key))
    .map((key) => [key, record[key]]));
}

function trimArrayField(record: Record<string, unknown>, key: string, limit: number): void {
  if (Array.isArray(record[key])) {
    record[key] = record[key].slice(0, limit);
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength).trim();
}

const PRESENTATION_BLOCK_KEYS: Record<string, string[]> = {
  summary: ["type", "title", "text"],
  product_reference: [
    "type",
    "productGid",
    "title",
    "handle",
    "subtitle",
    "imageUrl",
    "imageAlt",
    "vendor",
    "productType",
    "price",
    "status",
    "riskScore",
    "riskLabel",
    "updatedAt",
    "metrics",
  ],
  diagnosis_summary: [
    "type",
    "productGid",
    "title",
    "summary",
    "likelyCause",
    "riskScore",
    "confidence",
    "issues",
    "updatedAt",
  ],
  evidence_list: ["type", "productGid", "title", "summary", "items"],
  metric_table: ["type", "title", "rows"],
  entity_list: ["type", "title", "emptyMessage", "items"],
  recommendation_list: ["type", "productGid", "title", "emptyMessage", "items"],
  unavailable_state: ["type", "title", "message", "reason", "nextStep"],
  action_proposal: [
    "type",
    "proposalId",
    "actionName",
    "title",
    "summary",
    "targetType",
    "targetId",
    "targetLabel",
    "reason",
    "expectedResult",
    "risks",
    "confirmationLevel",
    "sideEffectLevel",
    "reversible",
    "expiresAt",
  ],
  action_result: [
    "type",
    "actionName",
    "status",
    "title",
    "summary",
    "targetLabel",
    "sideEffectLevel",
    "affectedEntities",
    "createdJobId",
  ],
  app_draft_proposal: [
    "type",
    "proposalId",
    "mutationName",
    "draftType",
    "title",
    "summary",
    "targetType",
    "targetId",
    "targetLabel",
    "proposedValue",
    "currentAppValueSnapshot",
    "generatedReason",
    "validationWarnings",
    "editableFields",
    "confirmationLevel",
    "sideEffectLevel",
    "reversible",
    "expiresAt",
  ],
  app_draft_result: [
    "type",
    "mutationName",
    "status",
    "title",
    "summary",
    "targetLabel",
    "sideEffectLevel",
    "affectedEntities",
    "savedRecordId",
  ],
  score_explanation: [
    "type",
    "scoreName",
    "meaning",
    "logic",
    "formula",
    "range",
    "inputs",
    "thresholds",
    "interpretation",
    "caveats",
  ],
  process_guide: [
    "type",
    "title",
    "summary",
    "steps",
    "inputs",
    "outputs",
    "limitations",
  ],
  screen_guide: [
    "type",
    "screenName",
    "purpose",
    "dataShown",
    "howToRead",
    "commonActions",
    "caveats",
  ],
  setting_explanation: [
    "type",
    "settingName",
    "meaning",
    "defaultValue",
    "allowedValues",
    "effect",
    "caveats",
  ],
  interaction_guidance: [
    "type",
    "title",
    "summary",
    "clarificationQuestion",
    "options",
    "caveats",
  ],
};
