import type { AiPresentationBlock } from "../presentation/blocks";
import type { AiActionExecutionResult, AiActionProposal } from "./types";

export interface AiActionProposalSafeSummary {
  id: string;
  actionName: string;
  category: AiActionProposal["category"];
  targetType: string;
  targetId: string;
  targetLabel: string | null;
  title: string;
  summary: string;
  reason: string | null;
  expectedResult: string | null;
  risks: string[];
  confirmationLevel: AiActionProposal["confirmationLevel"];
  sideEffectLevel: AiActionProposal["sideEffectLevel"];
  reversible: boolean;
  status: AiActionProposal["status"];
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  cancelledAt: string | null;
  executedAt: string | null;
}

export function aiActionProposalToPresentationBlock(proposal: AiActionProposal): AiPresentationBlock {
  return {
    type: "action_proposal",
    proposalId: proposal.id,
    actionName: proposal.actionName,
    title: proposal.title,
    summary: proposal.summary,
    targetType: proposal.targetType,
    targetId: proposal.targetId,
    targetLabel: proposal.targetLabel,
    reason: proposal.reason,
    expectedResult: proposal.expectedResult,
    risks: proposal.risks,
    confirmationLevel: proposal.confirmationLevel,
    sideEffectLevel: proposal.sideEffectLevel,
    reversible: proposal.reversible,
    expiresAt: proposal.expiresAt,
  };
}

export function aiActionProposalToSafeSummary(proposal: AiActionProposal): AiActionProposalSafeSummary {
  return {
    id: proposal.id,
    actionName: proposal.actionName,
    category: proposal.category,
    targetType: proposal.targetType,
    targetId: proposal.targetId,
    targetLabel: proposal.targetLabel,
    title: proposal.title,
    summary: proposal.summary,
    reason: proposal.reason,
    expectedResult: proposal.expectedResult,
    risks: proposal.risks,
    confirmationLevel: proposal.confirmationLevel,
    sideEffectLevel: proposal.sideEffectLevel,
    reversible: proposal.reversible,
    status: proposal.status,
    createdAt: proposal.createdAt,
    expiresAt: proposal.expiresAt,
    confirmedAt: proposal.confirmedAt,
    cancelledAt: proposal.cancelledAt,
    executedAt: proposal.executedAt,
  };
}

export function aiActionExecutionToPresentationBlock(
  proposal: AiActionProposal,
  execution: AiActionExecutionResult,
): AiPresentationBlock {
  return {
    type: "action_result",
    actionName: execution.actionName,
    status: execution.status === "success" ? "success" : "error",
    title: execution.status === "success" ? "Action completed" : "Action failed",
    summary: execution.safeMessage || execution.summary,
    targetLabel: proposal.targetLabel,
    sideEffectLevel: proposal.sideEffectLevel,
    affectedEntities: execution.affectedEntities.slice(0, 6).map((entity) => ({
      type: entity.type,
      id: entity.id,
      label: entity.label || null,
    })),
    createdJobId: execution.createdJobId || null,
  };
}

export function aiActionCancellationToPresentationBlock(proposal: AiActionProposal): AiPresentationBlock {
  return {
    type: "action_result",
    actionName: proposal.actionName,
    status: "cancelled",
    title: "Action cancelled",
    summary: `${proposal.title} was cancelled. No internal app data was changed.`,
    targetLabel: proposal.targetLabel,
    sideEffectLevel: proposal.sideEffectLevel,
    affectedEntities: [],
    createdJobId: null,
  };
}

export function aiActionErrorToPresentationBlock(input: {
  actionName?: string | null;
  title?: string | null;
  message: string;
}): AiPresentationBlock {
  return {
    type: "action_result",
    actionName: input.actionName || "unknown_internal_action",
    status: "error",
    title: input.title || "Action unavailable",
    summary: input.message,
    targetLabel: null,
    sideEffectLevel: null,
    affectedEntities: [],
    createdJobId: null,
  };
}
