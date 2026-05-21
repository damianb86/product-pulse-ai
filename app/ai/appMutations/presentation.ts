import type { AiPresentationBlock } from "../presentation/blocks";
import type {
  AiAppMutationEditableField,
  AiAppMutationProposal,
  AiAppMutationSaveResult,
} from "./types";

export interface AiAppMutationProposalSafeSummary {
  id: string;
  mutationName: string;
  category: AiAppMutationProposal["category"];
  targetType: string;
  targetId: string;
  targetLabel: string | null;
  draftType: AiAppMutationProposal["draftType"];
  title: string;
  summary: string;
  editableFields: AiAppMutationEditableField[];
  validationWarnings: string[];
  status: AiAppMutationProposal["status"];
  confirmationLevel: AiAppMutationProposal["confirmationLevel"];
  sideEffectLevel: AiAppMutationProposal["sideEffectLevel"];
  reversible: boolean;
  createdAt: string;
  expiresAt: string;
}

export function aiAppMutationProposalToPresentationBlock(proposal: AiAppMutationProposal): AiPresentationBlock {
  return {
    type: "app_draft_proposal",
    proposalId: proposal.id,
    mutationName: proposal.mutationName,
    draftType: proposal.draftType,
    title: proposal.title,
    summary: proposal.summary,
    targetType: proposal.targetType,
    targetId: proposal.targetId,
    targetLabel: proposal.targetLabel,
    proposedValue: safePresentationValue(proposal.proposedValue),
    currentAppValueSnapshot: safePresentationValue(proposal.currentAppValueSnapshot),
    generatedReason: proposal.generatedReason,
    validationWarnings: proposal.validationWarnings,
    editableFields: proposal.editableFields,
    confirmationLevel: proposal.confirmationLevel,
    sideEffectLevel: proposal.sideEffectLevel,
    reversible: proposal.reversible,
    expiresAt: proposal.expiresAt,
  };
}

export function aiAppMutationProposalToSafeSummary(proposal: AiAppMutationProposal): AiAppMutationProposalSafeSummary {
  return {
    id: proposal.id,
    mutationName: proposal.mutationName,
    category: proposal.category,
    targetType: proposal.targetType,
    targetId: proposal.targetId,
    targetLabel: proposal.targetLabel,
    draftType: proposal.draftType,
    title: proposal.title,
    summary: proposal.summary,
    editableFields: proposal.editableFields,
    validationWarnings: proposal.validationWarnings,
    status: proposal.status,
    confirmationLevel: proposal.confirmationLevel,
    sideEffectLevel: proposal.sideEffectLevel,
    reversible: proposal.reversible,
    createdAt: proposal.createdAt,
    expiresAt: proposal.expiresAt,
  };
}

export function aiAppMutationResultToPresentationBlock(
  result: AiAppMutationSaveResult,
  options: {
    title?: string | null;
    targetLabel?: string | null;
    sideEffectLevel?: "low" | "medium" | "high" | null;
  } = {},
): AiPresentationBlock {
  return {
    type: "app_draft_result",
    mutationName: result.mutationName,
    status: result.status,
    title: options.title || (result.status === "success" ? "Draft saved in ProductPulse" : "Draft not saved"),
    summary: result.safeMessage || result.summary,
    targetLabel: options.targetLabel || null,
    sideEffectLevel: options.sideEffectLevel || null,
    affectedEntities: result.affectedEntities.slice(0, 6).map((entity) => ({
      type: entity.type,
      id: entity.id,
      label: entity.label || null,
    })),
    savedRecordId: result.savedRecordId || null,
  };
}

export function aiAppMutationCancellationToPresentationBlock(proposal: AiAppMutationProposal): AiPresentationBlock {
  return {
    type: "app_draft_result",
    mutationName: proposal.mutationName,
    status: "cancelled",
    title: "Draft cancelled",
    summary: `${proposal.title} was cancelled. No app data or Shopify data was changed.`,
    targetLabel: proposal.targetLabel,
    sideEffectLevel: proposal.sideEffectLevel,
    affectedEntities: [],
    savedRecordId: null,
  };
}

function safePresentationValue(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !["shop", "shopId", "storeId", "merchantId", "userId"].includes(key))
    .map(([key, item]) => [key, stringifyValue(item).slice(0, 1200)]));
}

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
