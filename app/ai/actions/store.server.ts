import { Prisma, type PrismaClient } from "@prisma/client";
import prisma from "../../db.server";
import type { AiToolContext, AiToolSafeError } from "../domain/types";
import type {
  AiActionAuditLogInput,
  AiActionProposal,
  AiActionProposalDraft,
  AiActionProposalStatus,
  AiActionExecutionResult,
} from "./types";

type AiActionDbClient = Pick<PrismaClient, "aiActionProposal" | "aiActionAuditLog">;

export interface AiActionProposalStore {
  createProposal<TInput>(
    context: AiToolContext,
    draft: AiActionProposalDraft<TInput>,
  ): Promise<AiActionProposal>;
  getProposal(context: AiToolContext, proposalId: string): Promise<AiActionProposal | null>;
  updateProposalStatus(input: {
    context: AiToolContext;
    proposalId: string;
    status: AiActionProposalStatus;
    allowedCurrentStatuses?: AiActionProposalStatus[];
    result?: AiActionExecutionResult | null;
    safeError?: AiToolSafeError | null;
    confirmedAt?: Date | null;
    cancelledAt?: Date | null;
    executedAt?: Date | null;
  }): Promise<AiActionProposal | null>;
  logAudit(input: AiActionAuditLogInput): Promise<void>;
}

export class PrismaAiActionProposalStore implements AiActionProposalStore {
  private db: AiActionDbClient;

  constructor(db: AiActionDbClient = prisma as unknown as AiActionDbClient) {
    this.db = db;
  }

  async createProposal<TInput>(
    context: AiToolContext,
    draft: AiActionProposalDraft<TInput>,
  ): Promise<AiActionProposal> {
    const row = await this.db.aiActionProposal.create({
      data: {
        shop: context.shop,
        userId: optionalString(context.userId),
        conversationId: optionalString(context.conversationId),
        actionName: draft.actionName,
        category: draft.category,
        targetType: draft.targetType,
        targetId: draft.targetId,
        targetLabel: optionalString(draft.targetLabel),
        proposedInput: toPrismaJson(draft.proposedInput) || Prisma.JsonNull,
        title: draft.title,
        summary: draft.summary,
        reason: optionalString(draft.reason),
        expectedResult: optionalString(draft.expectedResult),
        risks: toPrismaJson(draft.risks || []),
        confirmationLevel: draft.confirmationLevel,
        sideEffectLevel: draft.sideEffectLevel,
        reversible: draft.reversible,
        requiresEntityOwnershipCheck: draft.requiresEntityOwnershipCheck,
        expiresAt: draft.expiresAt,
      },
    });
    return mapProposal(row);
  }

  async getProposal(context: AiToolContext, proposalId: string): Promise<AiActionProposal | null> {
    const row = await this.db.aiActionProposal.findFirst({
      where: {
        id: proposalId,
        shop: context.shop,
      },
    });
    return row ? mapProposal(row) : null;
  }

  async updateProposalStatus(input: {
    context: AiToolContext;
    proposalId: string;
    status: AiActionProposalStatus;
    allowedCurrentStatuses?: AiActionProposalStatus[];
    result?: AiActionExecutionResult | null;
    safeError?: AiToolSafeError | null;
    confirmedAt?: Date | null;
    cancelledAt?: Date | null;
    executedAt?: Date | null;
  }): Promise<AiActionProposal | null> {
    const rows = await this.db.aiActionProposal.updateManyAndReturn({
      where: {
        id: input.proposalId,
        shop: input.context.shop,
        ...(input.allowedCurrentStatuses?.length
          ? { status: { in: input.allowedCurrentStatuses } }
          : {}),
      },
      data: {
        status: input.status,
        result: input.result === undefined ? undefined : toPrismaJson(input.result),
        safeError: input.safeError === undefined ? undefined : toPrismaJson(input.safeError),
        confirmedAt: input.confirmedAt === undefined ? undefined : input.confirmedAt,
        cancelledAt: input.cancelledAt === undefined ? undefined : input.cancelledAt,
        executedAt: input.executedAt === undefined ? undefined : input.executedAt,
      },
    });
    return rows[0] ? mapProposal(rows[0]) : null;
  }

  async logAudit(input: AiActionAuditLogInput): Promise<void> {
    await this.db.aiActionAuditLog.create({
      data: {
        shop: input.context.shop,
        userId: optionalString(input.context.userId),
        conversationId: optionalString(input.context.conversationId),
        proposalId: optionalString(input.proposalId),
        actionName: input.actionName,
        targetType: optionalString(input.targetType),
        targetId: optionalString(input.targetId),
        eventType: input.eventType,
        validatedInput: toPrismaJson(input.validatedInput),
        status: input.status,
        durationMs: typeof input.durationMs === "number" ? Math.round(input.durationMs) : null,
        safeSummary: optionalString(input.safeSummary),
        safeError: toPrismaJson(input.safeError),
      },
    });
  }
}

function mapProposal(row: Record<string, unknown>): AiActionProposal {
  return {
    id: String(row.id || ""),
    shop: String(row.shop || ""),
    userId: optionalString(row.userId),
    conversationId: optionalString(row.conversationId),
    actionName: String(row.actionName || ""),
    category: String(row.category || "diagnosis") as AiActionProposal["category"],
    targetType: String(row.targetType || ""),
    targetId: String(row.targetId || ""),
    targetLabel: optionalString(row.targetLabel),
    proposedInput: row.proposedInput,
    title: String(row.title || ""),
    summary: String(row.summary || ""),
    reason: optionalString(row.reason),
    expectedResult: optionalString(row.expectedResult),
    risks: Array.isArray(row.risks) ? row.risks.map(String) : [],
    confirmationLevel: String(row.confirmationLevel || "low") as AiActionProposal["confirmationLevel"],
    sideEffectLevel: String(row.sideEffectLevel || "low") as AiActionProposal["sideEffectLevel"],
    reversible: Boolean(row.reversible),
    requiresEntityOwnershipCheck: Boolean(row.requiresEntityOwnershipCheck),
    status: String(row.status || "pending") as AiActionProposal["status"],
    result: row.result,
    safeError: row.safeError as AiToolSafeError | null | undefined,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    expiresAt: toIso(row.expiresAt),
    confirmedAt: row.confirmedAt ? toIso(row.confirmedAt) : null,
    cancelledAt: row.cancelledAt ? toIso(row.cancelledAt) : null,
    executedAt: row.executedAt ? toIso(row.executedAt) : null,
  };
}

function optionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return String(value || "");
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
