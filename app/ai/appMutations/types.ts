import type { z } from "zod";
import type { AiToolContext, AiToolSafeError } from "../domain/types";

export type AiAppMutationCategory =
  | "draft"
  | "recommendation"
  | "action_status"
  | "watchlist"
  | "note"
  | "internal_metadata";

export type AiAppDraftType =
  | "product_description"
  | "seo"
  | "metafield_value"
  | "recommendation_text"
  | "internal_note"
  | "other";

export type AiAppMutationProposalStatus =
  | "draft"
  | "edited"
  | "pending_confirmation"
  | "saved"
  | "cancelled"
  | "expired"
  | "failed";

export type AiAppMutationConfirmationLevel = "low" | "medium" | "high";
export type AiAppMutationSideEffectLevel = "low" | "medium" | "high";

export interface AiAppMutationEditableField {
  name: string;
  label: string;
  value: string;
  fieldType: "text" | "textarea" | "select";
  required?: boolean;
  maxLength?: number;
  options?: Array<{ label: string; value: string }>;
}

export interface AiAppMutationProposalDraft<TInput = unknown> {
  mutationName: string;
  category: AiAppMutationCategory;
  targetType: string;
  targetId: string;
  targetLabel?: string | null;
  draftType: AiAppDraftType;
  sourceContext?: unknown;
  currentAppValueSnapshot?: unknown;
  proposedValue: unknown;
  generatedReason?: string | null;
  evidenceReferences?: unknown;
  validationWarnings?: string[];
  title: string;
  summary: string;
  editableFields: AiAppMutationEditableField[];
  proposedInput: TInput;
  confirmationLevel: AiAppMutationConfirmationLevel;
  sideEffectLevel: AiAppMutationSideEffectLevel;
  reversible: boolean;
  allowedFields: string[];
  blockedFields: string[];
  expiresAt: Date;
}

export interface AiAppMutationProposal {
  id: string;
  shop: string;
  userId: string | null;
  conversationId: string | null;
  mutationName: string;
  category: AiAppMutationCategory;
  targetType: string;
  targetId: string;
  targetLabel: string | null;
  draftType: AiAppDraftType;
  sourceContext: unknown;
  currentAppValueSnapshot: unknown;
  proposedValue: unknown;
  userEditedValue: unknown;
  finalValue: unknown;
  generatedReason: string | null;
  evidenceReferences: unknown;
  validationWarnings: string[];
  title: string;
  summary: string;
  editableFields: AiAppMutationEditableField[];
  proposedInput: unknown;
  confirmationLevel: AiAppMutationConfirmationLevel;
  sideEffectLevel: AiAppMutationSideEffectLevel;
  reversible: boolean;
  allowedFields: string[];
  blockedFields: string[];
  status: AiAppMutationProposalStatus;
  safeError?: AiToolSafeError | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  savedAt: string | null;
  cancelledAt: string | null;
}

export interface AiAppMutationSaveResult {
  mutationName: string;
  status: "success" | "error" | "cancelled";
  summary: string;
  safeMessage: string;
  affectedEntities: Array<{
    type: string;
    id: string;
    label?: string | null;
  }>;
  savedRecordId?: string | null;
  savedData?: unknown;
}

export interface AiAppMutationDefinition<TInput = unknown, TEditable = unknown> {
  mutationName: string;
  category: AiAppMutationCategory;
  targetType: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  editableSchema: z.ZodType<TEditable>;
  requiredPermission: "merchant";
  confirmationLevel: AiAppMutationConfirmationLevel;
  sideEffectLevel: AiAppMutationSideEffectLevel;
  reversible: boolean;
  allowedFields: string[];
  blockedFields: string[];
  buildProposal: (context: AiToolContext, input: TInput) => Promise<AiAppMutationProposalDraft<TInput>>;
  validateEditable?: (
    context: AiToolContext,
    proposal: AiAppMutationProposal,
    editable: TEditable,
  ) => Promise<{ editable: TEditable; warnings: string[] }>;
  save: (
    context: AiToolContext,
    proposal: AiAppMutationProposal,
    editable: TEditable,
  ) => Promise<AiAppMutationSaveResult>;
}

export type AnyAiAppMutationDefinition = AiAppMutationDefinition<unknown, unknown>;

export interface AiAppMutationAuditLogInput {
  context: AiToolContext;
  proposalId?: string | null;
  mutationName: string;
  category: AiAppMutationCategory;
  targetType?: string | null;
  targetId?: string | null;
  eventType: "proposed" | "edited" | "save_requested" | "saved" | "cancelled" | "expired" | "failed";
  validatedInput?: unknown;
  status: AiAppMutationProposalStatus | "started";
  durationMs?: number;
  safeSummary?: string | null;
  safeError?: AiToolSafeError | null;
}

export type AiAppMutationSafeResult<TData = unknown> =
  | { ok: true; data: TData }
  | { ok: false; error: AiToolSafeError };
