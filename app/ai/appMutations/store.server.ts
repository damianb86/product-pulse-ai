import { Prisma, type PrismaClient } from "@prisma/client";
import prisma from "../../db.server";
import type { AiToolContext, AiToolSafeError } from "../domain/types";
import type {
  AiAppMutationAuditLogInput,
  AiAppMutationEditableField,
  AiAppMutationProposal,
  AiAppMutationProposalDraft,
  AiAppMutationProposalStatus,
  AiAppMutationSaveResult,
} from "./types";

type AiAppMutationDbClient = Pick<PrismaClient, "aiAppDraftProposal" | "aiAppDraftAuditLog">;

export interface AiAppMutationProposalStore {
  createProposal<TInput>(
    context: AiToolContext,
    draft: AiAppMutationProposalDraft<TInput>,
  ): Promise<AiAppMutationProposal>;
  getProposal(context: AiToolContext, proposalId: string): Promise<AiAppMutationProposal | null>;
  updateProposal(input: {
    context: AiToolContext;
    proposalId: string;
    status?: AiAppMutationProposalStatus;
    allowedCurrentStatuses?: AiAppMutationProposalStatus[];
    userEditedValue?: unknown;
    finalValue?: unknown;
    validationWarnings?: string[];
    safeError?: AiToolSafeError | null;
    savedAt?: Date | null;
    cancelledAt?: Date | null;
  }): Promise<AiAppMutationProposal | null>;
  logAudit(input: AiAppMutationAuditLogInput): Promise<void>;
}

export class PrismaAiAppMutationProposalStore implements AiAppMutationProposalStore {
  private db: AiAppMutationDbClient;

  constructor(db: AiAppMutationDbClient = prisma as unknown as AiAppMutationDbClient) {
    this.db = db;
  }

  async createProposal<TInput>(
    context: AiToolContext,
    draft: AiAppMutationProposalDraft<TInput>,
  ): Promise<AiAppMutationProposal> {
    const row = await this.db.aiAppDraftProposal.create({
      data: {
        shop: context.shop,
        userId: optionalString(context.userId),
        conversationId: optionalString(context.conversationId),
        mutationName: draft.mutationName,
        category: draft.category,
        targetType: draft.targetType,
        targetId: draft.targetId,
        targetLabel: optionalString(draft.targetLabel),
        draftType: draft.draftType,
        sourceContext: toPrismaJson(draft.sourceContext),
        currentAppValueSnapshot: toPrismaJson(draft.currentAppValueSnapshot),
        proposedValue: toPrismaJson(draft.proposedValue) || Prisma.JsonNull,
        generatedReason: optionalString(draft.generatedReason),
        evidenceReferences: toPrismaJson(draft.evidenceReferences),
        validationWarnings: toPrismaJson(draft.validationWarnings || []),
        title: draft.title,
        summary: draft.summary,
        editableFields: toPrismaJson(draft.editableFields || []),
        proposedInput: toPrismaJson(draft.proposedInput) || Prisma.JsonNull,
        confirmationLevel: draft.confirmationLevel,
        sideEffectLevel: draft.sideEffectLevel,
        reversible: draft.reversible,
        allowedFields: toPrismaJson(draft.allowedFields || []),
        blockedFields: toPrismaJson(draft.blockedFields || []),
        expiresAt: draft.expiresAt,
      },
    });
    return mapProposal(row);
  }

  async getProposal(context: AiToolContext, proposalId: string): Promise<AiAppMutationProposal | null> {
    const row = await this.db.aiAppDraftProposal.findFirst({
      where: {
        id: proposalId,
        shop: context.shop,
      },
    });
    return row ? mapProposal(row) : null;
  }

  async updateProposal(input: {
    context: AiToolContext;
    proposalId: string;
    status?: AiAppMutationProposalStatus;
    allowedCurrentStatuses?: AiAppMutationProposalStatus[];
    userEditedValue?: unknown;
    finalValue?: unknown;
    validationWarnings?: string[];
    safeError?: AiToolSafeError | null;
    savedAt?: Date | null;
    cancelledAt?: Date | null;
  }): Promise<AiAppMutationProposal | null> {
    const rows = await this.db.aiAppDraftProposal.updateManyAndReturn({
      where: {
        id: input.proposalId,
        shop: input.context.shop,
        ...(input.allowedCurrentStatuses?.length
          ? { status: { in: input.allowedCurrentStatuses } }
          : {}),
      },
      data: {
        status: input.status,
        userEditedValue: input.userEditedValue === undefined ? undefined : toPrismaJson(input.userEditedValue),
        finalDraftValue: input.finalValue === undefined ? undefined : toPrismaJson(input.finalValue),
        validationWarnings: input.validationWarnings === undefined ? undefined : toPrismaJson(input.validationWarnings),
        safeError: input.safeError === undefined ? undefined : toPrismaJson(input.safeError),
        savedAt: input.savedAt === undefined ? undefined : input.savedAt,
        cancelledAt: input.cancelledAt === undefined ? undefined : input.cancelledAt,
      },
    });
    return rows[0] ? mapProposal(rows[0]) : null;
  }

  async logAudit(input: AiAppMutationAuditLogInput): Promise<void> {
    await this.db.aiAppDraftAuditLog.create({
      data: {
        shop: input.context.shop,
        userId: optionalString(input.context.userId),
        conversationId: optionalString(input.context.conversationId),
        proposalId: optionalString(input.proposalId),
        mutationName: input.mutationName,
        category: input.category,
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

export function mapSaveResultToFinalValue(result: AiAppMutationSaveResult): unknown {
  return {
    status: result.status,
    summary: result.summary,
    affectedEntities: result.affectedEntities,
    savedRecordId: result.savedRecordId || null,
    savedData: result.savedData ?? null,
  };
}

function mapProposal(row: Record<string, unknown>): AiAppMutationProposal {
  return {
    id: String(row.id || ""),
    shop: String(row.shop || ""),
    userId: optionalString(row.userId),
    conversationId: optionalString(row.conversationId),
    mutationName: String(row.mutationName || ""),
    category: String(row.category || "recommendation") as AiAppMutationProposal["category"],
    targetType: String(row.targetType || ""),
    targetId: String(row.targetId || ""),
    targetLabel: optionalString(row.targetLabel),
    draftType: String(row.draftType || "other") as AiAppMutationProposal["draftType"],
    sourceContext: nullIfJsonNull(row.sourceContext),
    currentAppValueSnapshot: nullIfJsonNull(row.currentAppValueSnapshot),
    proposedValue: nullIfJsonNull(row.proposedValue),
    userEditedValue: nullIfJsonNull(row.userEditedValue),
    finalValue: nullIfJsonNull(row.finalDraftValue),
    generatedReason: optionalString(row.generatedReason),
    evidenceReferences: nullIfJsonNull(row.evidenceReferences),
    validationWarnings: arrayOfStrings(row.validationWarnings),
    title: String(row.title || ""),
    summary: String(row.summary || ""),
    editableFields: arrayOfEditableFields(row.editableFields),
    proposedInput: nullIfJsonNull(row.proposedInput),
    confirmationLevel: String(row.confirmationLevel || "low") as AiAppMutationProposal["confirmationLevel"],
    sideEffectLevel: String(row.sideEffectLevel || "low") as AiAppMutationProposal["sideEffectLevel"],
    reversible: Boolean(row.reversible),
    allowedFields: arrayOfStrings(row.allowedFields),
    blockedFields: arrayOfStrings(row.blockedFields),
    status: String(row.status || "draft") as AiAppMutationProposal["status"],
    safeError: row.safeError as AiToolSafeError | null | undefined,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    expiresAt: toIso(row.expiresAt),
    savedAt: row.savedAt ? toIso(row.savedAt) : null,
    cancelledAt: row.cancelledAt ? toIso(row.cancelledAt) : null,
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

function nullIfJsonNull(value: unknown): unknown {
  return value === Prisma.JsonNull ? null : value;
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : [];
}

function arrayOfEditableFields(value: unknown): AiAppMutationEditableField[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item && typeof item === "object" ? item as Partial<AiAppMutationEditableField> : null)
    .filter(Boolean)
    .map((item) => ({
      name: String(item?.name || ""),
      label: String(item?.label || ""),
      value: String(item?.value || ""),
      fieldType: ["text", "textarea", "select"].includes(String(item?.fieldType)) ? item?.fieldType as AiAppMutationEditableField["fieldType"] : "textarea",
      required: Boolean(item?.required),
      maxLength: typeof item?.maxLength === "number" ? item.maxLength : undefined,
      options: Array.isArray(item?.options)
        ? item.options.map((option) => ({
            label: String(option?.label || ""),
            value: String(option?.value || ""),
          })).filter((option) => option.label && option.value)
        : undefined,
    }))
    .filter((item) => item.name && item.label);
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
