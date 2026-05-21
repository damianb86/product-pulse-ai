import { z } from "zod";
import type { AiToolContext, AiToolExecutionResult, AiToolSafeError } from "../domain/types";
import { toSafeAiToolError } from "../domain/errors";
import { canUseAiAppMutation } from "../security/permissions.server";
import {
  createProductPulseAiAppMutationDefinitions,
  PRODUCT_PULSE_AI_APP_MUTATION_NAMES,
  type ProductPulseAiAppMutationDependencies,
} from "./productPulseAppMutations.server";
import {
  PrismaAiAppMutationProposalStore,
  mapSaveResultToFinalValue,
  type AiAppMutationProposalStore,
} from "./store.server";
import type {
  AiAppMutationProposal,
  AiAppMutationProposalStatus,
  AiAppMutationSafeResult,
  AiAppMutationSaveResult,
  AnyAiAppMutationDefinition,
} from "./types";
import {
  aiAppMutationProposalToPresentationBlock,
  aiAppMutationProposalToSafeSummary,
  aiAppMutationResultToPresentationBlock,
} from "./presentation";

export const AI_APP_MUTATION_PROPOSAL_TOOL_NAME = "product_pulse_propose_app_only_mutation";

export interface AiAppMutationRegistryOptions {
  definitions?: AnyAiAppMutationDefinition[];
  productPulse?: ProductPulseAiAppMutationDependencies;
  proposalStore?: AiAppMutationProposalStore;
  now?: () => Date;
  env?: NodeJS.ProcessEnv;
}

export class AiAppMutationRegistry {
  private mutations: Map<string, AnyAiAppMutationDefinition>;
  private proposalStore: AiAppMutationProposalStore;
  private now: () => Date;
  private env: NodeJS.ProcessEnv;

  constructor(
    definitions: AnyAiAppMutationDefinition[],
    proposalStore: AiAppMutationProposalStore = new PrismaAiAppMutationProposalStore(),
    now: () => Date = () => new Date(),
    env: NodeJS.ProcessEnv = process.env,
  ) {
    this.mutations = new Map();
    definitions.forEach((definition) => {
      if (this.mutations.has(definition.mutationName)) {
        throw new Error(`Duplicate AI app mutation registered: ${definition.mutationName}`);
      }
      this.mutations.set(definition.mutationName, definition);
    });
    this.proposalStore = proposalStore;
    this.now = now;
    this.env = env;
  }

  listAiAppMutations(): AnyAiAppMutationDefinition[] {
    return Array.from(this.mutations.values());
  }

  getAiAppMutationDefinition(mutationName: string): AnyAiAppMutationDefinition | null {
    return this.mutations.get(mutationName) || null;
  }

  async createAiAppMutationProposal(
    context: AiToolContext,
    mutationName: string,
    rawInput: unknown = {},
  ): Promise<AiAppMutationSafeResult<{ proposal: AiAppMutationProposal }>> {
    const normalizedMutationName = resolveAppMutationName(mutationName, rawInput);
    const definition = this.getAiAppMutationDefinition(normalizedMutationName);
    if (!definition) return { ok: false, error: unknownMutationError(mutationName) };
    if (!this.canUse(context)) return { ok: false, error: unauthorizedMutationError() };

    const parsed = definition.inputSchema.safeParse(rawInput ?? {});
    if (!parsed.success) return { ok: false, error: validationError(parsed.error, "App mutation input failed validation.") };

    try {
      const draft = await definition.buildProposal(context, parsed.data);
      const proposal = await this.proposalStore.createProposal(context, draft);
      await this.safeAudit({
        context,
        proposalId: proposal.id,
        mutationName: normalizedMutationName,
        category: proposal.category,
        targetType: proposal.targetType,
        targetId: proposal.targetId,
        eventType: "proposed",
        validatedInput: parsed.data,
        status: proposal.status,
        safeSummary: proposal.summary,
      });
      return { ok: true, data: { proposal } };
    } catch (error) {
      const safeError = toSafeAiToolError(error);
      await this.safeAudit({
        context,
        mutationName: normalizedMutationName,
        category: definition.category,
        eventType: "failed",
        validatedInput: parsed.data,
        status: "failed",
        safeError,
      });
      return { ok: false, error: safeError };
    }
  }

  async updateAiAppMutationDraft(
    context: AiToolContext,
    proposalId: string,
    rawEditable: unknown = {},
  ): Promise<AiAppMutationSafeResult<{ proposal: AiAppMutationProposal }>> {
    const readiness = await this.validateProposalReady(context, proposalId, ["draft", "edited", "pending_confirmation"]);
    if (!readiness.ok) return readiness;
    const { proposal, definition } = readiness.data;
    const parsed = this.parseEditable(definition, proposal, rawEditable);
    if (!parsed.ok) return parsed;

    const warnings = await this.validateEditable(context, proposal, definition, parsed.data);
    if (!warnings.ok) return warnings;
    const updated = await this.proposalStore.updateProposal({
      context,
      proposalId,
      status: "edited",
      allowedCurrentStatuses: ["draft", "edited", "pending_confirmation"],
      userEditedValue: warnings.data.editable,
      validationWarnings: warnings.data.warnings,
    });
    if (!updated) return { ok: false, error: proposalStatusError(proposal.status) };
    await this.safeAudit({
      context,
      proposalId,
      mutationName: proposal.mutationName,
      category: proposal.category,
      targetType: proposal.targetType,
      targetId: proposal.targetId,
      eventType: "edited",
      validatedInput: warnings.data.editable,
      status: "edited",
      safeSummary: `${proposal.title} edited.`,
    });
    return { ok: true, data: { proposal: updated } };
  }

  async saveAiAppMutationDraft(
    context: AiToolContext,
    proposalId: string,
    rawEditable: unknown = {},
  ): Promise<AiAppMutationSafeResult<{ proposal: AiAppMutationProposal; result: AiAppMutationSaveResult }>> {
    const readiness = await this.validateProposalReady(context, proposalId, ["draft", "edited", "pending_confirmation"]);
    if (!readiness.ok) return readiness;
    const { proposal, definition } = readiness.data;
    const parsed = this.parseEditable(definition, proposal, rawEditable);
    if (!parsed.ok) return parsed;

    const warnings = await this.validateEditable(context, proposal, definition, parsed.data);
    if (!warnings.ok) return warnings;
    const startedAt = Date.now();
    await this.safeAudit({
      context,
      proposalId,
      mutationName: proposal.mutationName,
      category: proposal.category,
      targetType: proposal.targetType,
      targetId: proposal.targetId,
      eventType: "save_requested",
      validatedInput: warnings.data.editable,
      status: "started",
      safeSummary: `${proposal.title} save requested.`,
    });

    try {
      const result = await definition.save(context, proposal, warnings.data.editable);
      const finalStatus: AiAppMutationProposalStatus = result.status === "success" ? "saved" : "failed";
      const safeError = result.status === "success" ? null : {
        code: "APP_MUTATION_SAVE_ERROR",
        message: result.safeMessage,
        retryable: false,
      };
      const updated = await this.proposalStore.updateProposal({
        context,
        proposalId,
        status: finalStatus,
        allowedCurrentStatuses: ["draft", "edited", "pending_confirmation"],
        userEditedValue: warnings.data.editable,
        finalDraftValue: mapSaveResultToFinalValue(result),
        validationWarnings: warnings.data.warnings,
        safeError,
        savedAt: finalStatus === "saved" ? this.now() : null,
      });
      await this.safeAudit({
        context,
        proposalId,
        mutationName: proposal.mutationName,
        category: proposal.category,
        targetType: proposal.targetType,
        targetId: proposal.targetId,
        eventType: finalStatus === "saved" ? "saved" : "failed",
        validatedInput: warnings.data.editable,
        status: finalStatus,
        durationMs: Date.now() - startedAt,
        safeSummary: result.safeMessage,
        safeError,
      });
      if (result.status !== "success") return { ok: false, error: safeError as AiToolSafeError };
      return { ok: true, data: { proposal: updated || proposal, result } };
    } catch (error) {
      const safeError = toSafeAiToolError(error);
      await this.proposalStore.updateProposal({
        context,
        proposalId,
        status: "failed",
        allowedCurrentStatuses: ["draft", "edited", "pending_confirmation"],
        safeError,
      });
      await this.safeAudit({
        context,
        proposalId,
        mutationName: proposal.mutationName,
        category: proposal.category,
        targetType: proposal.targetType,
        targetId: proposal.targetId,
        eventType: "failed",
        validatedInput: warnings.data.editable,
        status: "failed",
        durationMs: Date.now() - startedAt,
        safeError,
      });
      return { ok: false, error: safeError };
    }
  }

  async cancelAiAppMutationDraft(
    context: AiToolContext,
    proposalId: string,
  ): Promise<AiAppMutationSafeResult<{ proposal: AiAppMutationProposal }>> {
    const proposal = await this.proposalStore.getProposal(context, proposalId);
    if (!proposal) return { ok: false, error: proposalNotFoundError() };
    if (!["draft", "edited", "pending_confirmation"].includes(proposal.status)) {
      return { ok: false, error: proposalStatusError(proposal.status) };
    }
    const updated = await this.proposalStore.updateProposal({
      context,
      proposalId,
      status: "cancelled",
      allowedCurrentStatuses: ["draft", "edited", "pending_confirmation"],
      cancelledAt: this.now(),
    });
    if (!updated) return { ok: false, error: proposalStatusError(proposal.status) };
    await this.safeAudit({
      context,
      proposalId,
      mutationName: proposal.mutationName,
      category: proposal.category,
      targetType: proposal.targetType,
      targetId: proposal.targetId,
      eventType: "cancelled",
      validatedInput: proposal.proposedInput,
      status: "cancelled",
      safeSummary: `${proposal.title} cancelled.`,
    });
    return { ok: true, data: { proposal: updated } };
  }

  async executeProposalTool(context: AiToolContext, rawArguments: unknown): Promise<AiToolExecutionResult> {
    const parsed = appMutationProposalToolInputSchema.safeParse(normalizeAppMutationToolArguments(rawArguments || {}));
    if (!this.canUse(context)) {
      return {
        ok: false,
        toolName: AI_APP_MUTATION_PROPOSAL_TOOL_NAME,
        error: unauthorizedMutationError(),
        metadata: { resultCount: 0 },
      };
    }
    if (!parsed.success) {
      return {
        ok: false,
        toolName: AI_APP_MUTATION_PROPOSAL_TOOL_NAME,
        error: validationError(parsed.error, "App mutation proposal input failed validation."),
        metadata: { resultCount: 0 },
      };
    }

    const result = await this.createAiAppMutationProposal(context, parsed.data.mutationName, parsed.data.input || {});
    if (!result.ok) {
      return {
        ok: false,
        toolName: AI_APP_MUTATION_PROPOSAL_TOOL_NAME,
        error: result.error,
        metadata: { resultCount: 0 },
      };
    }
    const block = aiAppMutationProposalToPresentationBlock(result.data.proposal);
    return {
      ok: true,
      toolName: AI_APP_MUTATION_PROPOSAL_TOOL_NAME,
      data: {
        proposal: aiAppMutationProposalToSafeSummary(result.data.proposal),
        block,
        instruction: "Include this app_draft_proposal block in the final response. Do not claim it was saved until the user confirms Save draft in app.",
      },
      metadata: { resultCount: 1 },
    };
  }

  private async validateProposalReady(
    context: AiToolContext,
    proposalId: string,
    allowedStatuses: AiAppMutationProposalStatus[],
  ): Promise<AiAppMutationSafeResult<{ proposal: AiAppMutationProposal; definition: AnyAiAppMutationDefinition }>> {
    const proposal = await this.proposalStore.getProposal(context, proposalId);
    if (!proposal) return { ok: false, error: proposalNotFoundError() };
    if (!allowedStatuses.includes(proposal.status)) {
      return { ok: false, error: proposalStatusError(proposal.status) };
    }
    if (new Date(proposal.expiresAt).getTime() <= this.now().getTime()) {
      await this.proposalStore.updateProposal({
        context,
        proposalId,
        status: "expired",
        allowedCurrentStatuses: allowedStatuses,
      });
      await this.safeAudit({
        context,
        proposalId,
        mutationName: proposal.mutationName,
        category: proposal.category,
        targetType: proposal.targetType,
        targetId: proposal.targetId,
        eventType: "expired",
        validatedInput: proposal.proposedInput,
        status: "expired",
        safeSummary: `${proposal.title} expired before save.`,
      });
      return {
        ok: false,
        error: {
          code: "APP_MUTATION_PROPOSAL_EXPIRED",
          message: "That app draft proposal has expired.",
          retryable: false,
        },
      };
    }
    const definition = this.getAiAppMutationDefinition(proposal.mutationName);
    if (!definition) return { ok: false, error: unknownMutationError(proposal.mutationName) };
    if (!this.canUse(context)) return { ok: false, error: unauthorizedMutationError() };
    const parsedInput = definition.inputSchema.safeParse(proposal.proposedInput ?? {});
    if (!parsedInput.success) return { ok: false, error: validationError(parsedInput.error, "Stored proposal input failed validation.") };
    try {
      await definition.buildProposal(context, parsedInput.data);
    } catch (error) {
      return { ok: false, error: toSafeAiToolError(error) };
    }
    return { ok: true, data: { proposal, definition } };
  }

  private parseEditable(
    definition: AnyAiAppMutationDefinition,
    proposal: AiAppMutationProposal,
    rawEditable: unknown,
  ): AiAppMutationSafeResult<unknown> {
    const normalized = normalizeEditableInput(proposal, rawEditable);
    const parsed = definition.editableDraftSchema.safeParse(normalized);
    if (!parsed.success) return { ok: false, error: validationError(parsed.error, "Draft edits failed validation.") };
    return { ok: true, data: parsed.data };
  }

  private async validateEditable(
    context: AiToolContext,
    proposal: AiAppMutationProposal,
    definition: AnyAiAppMutationDefinition,
    editable: unknown,
  ): Promise<AiAppMutationSafeResult<{ editable: unknown; warnings: string[] }>> {
    if (!definition.validateEditableDraft) {
      return { ok: true, data: { editable, warnings: proposal.validationWarnings } };
    }
    const validated = await definition.validateEditableDraft(context, proposal, editable);
    return { ok: true, data: validated };
  }

  private canUse(context: AiToolContext): boolean {
    return canUseAiAppMutation(context, this.env).allowed;
  }

  private async safeAudit(input: Parameters<AiAppMutationProposalStore["logAudit"]>[0]): Promise<void> {
    try {
      await this.proposalStore.logAudit(input);
    } catch {
      // Audit logging must not break the mutation path.
    }
  }
}

export function createAiAppMutationRegistry(options: AiAppMutationRegistryOptions = {}): AiAppMutationRegistry {
  const definitions = options.definitions || createProductPulseAiAppMutationDefinitions(options.productPulse);
  return new AiAppMutationRegistry(
    definitions,
    options.proposalStore || new PrismaAiAppMutationProposalStore(),
    options.now || (() => new Date()),
    options.env || process.env,
  );
}

export const appMutationProposalToolInputSchema = z.object({
  mutationName: z.string().trim().min(1).max(180),
  input: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export function buildAppMutationProposalOpenAiToolDefinition(sanitizeSchema: (schema: unknown) => unknown): Record<string, unknown> {
  return {
    type: "function",
    name: AI_APP_MUTATION_PROPOSAL_TOOL_NAME,
    description: "Create an editable ProductPulse app-only draft or app-owned mutation proposal. This never updates Shopify and does not save until the user confirms.",
    parameters: sanitizeSchema(z.toJSONSchema(appMutationProposalToolInputSchema)),
    strict: false,
  };
}

export function aiAppMutationErrorToPresentationBlock(input: {
  mutationName?: string | null;
  title?: string | null;
  message: string;
}) {
  return aiAppMutationResultToPresentationBlock({
    mutationName: input.mutationName || "unknown_app_mutation",
    status: "error",
    summary: input.message,
    safeMessage: input.message,
    affectedEntities: [],
  }, {
    title: input.title || "Draft unavailable",
    targetLabel: null,
    sideEffectLevel: null,
  });
}

function normalizeEditableInput(proposal: AiAppMutationProposal, rawEditable: unknown): Record<string, unknown> {
  const raw = rawEditable && typeof rawEditable === "object" && !Array.isArray(rawEditable)
    ? rawEditable as Record<string, unknown>
    : {};
  const nested = raw.editedFields && typeof raw.editedFields === "object" && !Array.isArray(raw.editedFields)
    ? raw.editedFields as Record<string, unknown>
    : {};
  const merged = { ...raw, ...nested };
  const defaults = Object.fromEntries(proposal.editableFields.map((field) => [field.name, field.value]));
  return Object.fromEntries(proposal.allowedFields.map((fieldName) => {
    const value = Object.prototype.hasOwnProperty.call(merged, fieldName) ? merged[fieldName] : defaults[fieldName];
    return [fieldName, value];
  }));
}

function normalizeAppMutationToolArguments(rawArguments: unknown): Record<string, unknown> {
  const raw = rawArguments && typeof rawArguments === "object" && !Array.isArray(rawArguments)
    ? rawArguments as Record<string, unknown>
    : {};
  const input = raw.input && typeof raw.input === "object" && !Array.isArray(raw.input)
    ? raw.input as Record<string, unknown>
    : {};
  const rootInput = Object.fromEntries(Object.entries(raw).filter(([key]) => !["mutationName", "input"].includes(key)));
  return {
    mutationName: raw.mutationName,
    input: {
      ...rootInput,
      ...input,
    },
  };
}

function resolveAppMutationName(mutationName: string, rawInput: unknown): string {
  if (Object.values(PRODUCT_PULSE_AI_APP_MUTATION_NAMES).includes(mutationName as never)) return mutationName;
  const normalized = String(mutationName || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const input = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
    ? rawInput as Record<string, unknown>
    : {};
  const inputText = `${normalized} ${String(input.draftType || "")} ${String(input.field || input.targetField || "")}`.toLowerCase();
  if (inputText.includes("metafield")) return PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createMetafieldValueDraft;
  if (inputText.includes("seo") || inputText.includes("meta")) return PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createSeoDraft;
  if (inputText.includes("rewrite") || inputText.includes("update") || inputText.includes("edit")) {
    return PRODUCT_PULSE_AI_APP_MUTATION_NAMES.updateRecommendedActionDraft;
  }
  if (inputText.includes("action") || inputText.includes("recommend")) return PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductAction;
  if (inputText.includes("description") || inputText.includes("copy") || inputText.includes("draft")) {
    return PRODUCT_PULSE_AI_APP_MUTATION_NAMES.createProductDescriptionDraft;
  }
  return mutationName;
}

function unknownMutationError(mutationName: string): AiToolSafeError {
  return {
    code: "UNKNOWN_AI_APP_MUTATION",
    message: `Unknown AI app-only mutation: ${mutationName}.`,
    retryable: false,
  };
}

function validationError(error: z.ZodError, message: string): AiToolSafeError {
  return {
    code: "VALIDATION_ERROR",
    message,
    retryable: false,
    validationIssues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

function proposalNotFoundError(): AiToolSafeError {
  return {
    code: "APP_MUTATION_PROPOSAL_NOT_FOUND",
    message: "That app draft proposal was not found.",
    retryable: false,
  };
}

function proposalStatusError(status: string): AiToolSafeError {
  return {
    code: "APP_MUTATION_PROPOSAL_NOT_PENDING",
    message: `That app draft proposal is already ${status}.`,
    retryable: false,
  };
}

function unauthorizedMutationError(): AiToolSafeError {
  return {
    code: "APP_MUTATION_NOT_AUTHORIZED",
    message: "You are not allowed to save ProductPulse app-only drafts.",
    retryable: false,
  };
}
