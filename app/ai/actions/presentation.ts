import type { AiPresentationBlock } from "../presentation/blocks";
import type { AiActionProposal } from "./types";

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
