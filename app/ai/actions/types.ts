import type { z } from "zod";
import type { AiToolContext, AiToolSafeError } from "../domain/types";

export type AiActionCategory = "diagnosis" | "watchlist" | "recommendation" | "tracking";
export type AiActionConfirmationLevel = "low" | "medium" | "high";
export type AiActionSideEffectLevel = "low" | "medium" | "high";
export type AiActionProposalStatus =
  | "pending"
  | "confirmed"
  | "executed"
  | "cancelled"
  | "expired"
  | "failed";

export interface AiActionProposal {
  id: string;
  shop: string;
  userId: string | null;
  conversationId: string | null;
  actionName: string;
  category: AiActionCategory;
  targetType: string;
  targetId: string;
  targetLabel: string | null;
  proposedInput: unknown;
  title: string;
  summary: string;
  reason: string | null;
  expectedResult: string | null;
  risks: string[];
  confirmationLevel: AiActionConfirmationLevel;
  sideEffectLevel: AiActionSideEffectLevel;
  reversible: boolean;
  requiresEntityOwnershipCheck: boolean;
  status: AiActionProposalStatus;
  result?: unknown;
  safeError?: AiToolSafeError | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  executedAt: string | null;
}

export interface AiActionProposalDraft<TInput = unknown> {
  actionName: string;
  category: AiActionCategory;
  targetType: string;
  targetId: string;
  targetLabel?: string | null;
  proposedInput: TInput;
  title: string;
  summary: string;
  reason?: string | null;
  expectedResult?: string | null;
  risks?: string[];
  confirmationLevel: AiActionConfirmationLevel;
  sideEffectLevel: AiActionSideEffectLevel;
  reversible: boolean;
  requiresEntityOwnershipCheck: boolean;
  expiresAt: Date;
}

export interface AiActionExecutionResult {
  actionName: string;
  status: "success" | "error";
  summary: string;
  affectedEntities: Array<{
    type: string;
    id: string;
    label?: string | null;
  }>;
  createdJobId?: string | null;
  updatedData?: unknown;
  safeMessage: string;
}

export interface AiActionDefinition<TInput = unknown> {
  actionName: string;
  category: AiActionCategory;
  description: string;
  inputSchema: z.ZodType<TInput>;
  confirmationLevel: AiActionConfirmationLevel;
  sideEffectLevel: AiActionSideEffectLevel;
  reversible: boolean;
  requiresEntityOwnershipCheck: boolean;
  buildProposal: (
    context: AiToolContext,
    input: TInput,
  ) => Promise<AiActionProposalDraft<TInput>>;
  execute: (
    context: AiToolContext,
    proposal: AiActionProposal,
  ) => Promise<AiActionExecutionResult>;
}

export type AnyAiActionDefinition = AiActionDefinition<unknown>;

export interface AiActionAuditLogInput {
  context: AiToolContext;
  proposalId?: string | null;
  actionName: string;
  targetType?: string | null;
  targetId?: string | null;
  eventType: "proposed" | "confirmed" | "cancelled" | "executed" | "failed" | "expired";
  validatedInput?: unknown;
  status: string;
  durationMs?: number | null;
  safeSummary?: string | null;
  safeError?: AiToolSafeError | null;
}

export type AiActionSafeResult<TData = unknown> =
  | {
      ok: true;
      data: TData;
    }
  | {
      ok: false;
      error: AiToolSafeError;
    };
