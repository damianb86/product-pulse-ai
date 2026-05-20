import type { z } from "zod";
import type { AiToolContext, AiToolSafeError } from "../domain/types";
import { toSafeAiToolError } from "../domain/errors";
import {
  createProductPulseAiActionDefinitions,
  type ProductPulseAiActionDependencies,
} from "./productPulseActions.server";
import {
  PrismaAiActionProposalStore,
  type AiActionProposalStore,
} from "./store.server";
import type {
  AnyAiActionDefinition,
  AiActionExecutionResult,
  AiActionProposal,
  AiActionSafeResult,
} from "./types";

export const AI_ACTION_PROPOSAL_TOOL_NAME = "product_pulse_propose_internal_action";

export interface AiActionRegistryOptions {
  definitions?: AnyAiActionDefinition[];
  productPulse?: ProductPulseAiActionDependencies;
  proposalStore?: AiActionProposalStore;
  now?: () => Date;
}

export class AiActionRegistry {
  private actions: Map<string, AnyAiActionDefinition>;
  private proposalStore: AiActionProposalStore;
  private now: () => Date;

  constructor(
    definitions: AnyAiActionDefinition[],
    proposalStore: AiActionProposalStore = new PrismaAiActionProposalStore(),
    now: () => Date = () => new Date(),
  ) {
    this.actions = new Map();
    definitions.forEach((definition) => {
      if (this.actions.has(definition.actionName)) {
        throw new Error(`Duplicate AI action registered: ${definition.actionName}`);
      }
      this.actions.set(definition.actionName, definition);
    });
    this.proposalStore = proposalStore;
    this.now = now;
  }

  listAiActions(): AnyAiActionDefinition[] {
    return Array.from(this.actions.values());
  }

  getAiActionDefinition(actionName: string): AnyAiActionDefinition | null {
    return this.actions.get(actionName) || null;
  }

  async createAiActionProposal(
    context: AiToolContext,
    actionName: string,
    rawInput: unknown = {},
  ): Promise<AiActionSafeResult<{ proposal: AiActionProposal }>> {
    const definition = this.getAiActionDefinition(actionName);
    if (!definition) {
      return { ok: false, error: unknownActionError(actionName) };
    }
    if (!canUseAiAction(context, definition)) {
      return { ok: false, error: unauthorizedActionError() };
    }

    const parsed = definition.inputSchema.safeParse(rawInput ?? {});
    if (!parsed.success) {
      return { ok: false, error: validationError(parsed.error) };
    }

    try {
      const draft = await definition.buildProposal(context, parsed.data);
      const proposal = await this.proposalStore.createProposal(context, draft);
      await this.safeAudit({
        context,
        proposalId: proposal.id,
        actionName,
        targetType: proposal.targetType,
        targetId: proposal.targetId,
        eventType: "proposed",
        validatedInput: parsed.data,
        status: "pending",
        safeSummary: proposal.summary,
      });
      return { ok: true, data: { proposal } };
    } catch (error) {
      const safeError = toSafeAiToolError(error);
      await this.safeAudit({
        context,
        actionName,
        eventType: "failed",
        validatedInput: parsed.data,
        status: "failed",
        safeError,
      });
      return { ok: false, error: safeError };
    }
  }

  async cancelAiActionProposal(
    context: AiToolContext,
    proposalId: string,
  ): Promise<AiActionSafeResult<{ proposal: AiActionProposal }>> {
    const proposal = await this.proposalStore.getProposal(context, proposalId);
    if (!proposal) return { ok: false, error: proposalNotFoundError() };
    if (proposal.status !== "pending") {
      return { ok: false, error: proposalStatusError(proposal.status) };
    }

    const updated = await this.proposalStore.updateProposalStatus({
      context,
      proposalId,
      status: "cancelled",
      allowedCurrentStatuses: ["pending"],
      cancelledAt: this.now(),
    });
    if (!updated) return { ok: false, error: proposalStatusError(proposal.status) };
    await this.safeAudit({
      context,
      proposalId,
      actionName: proposal.actionName,
      targetType: proposal.targetType,
      targetId: proposal.targetId,
      eventType: "cancelled",
      validatedInput: proposal.proposedInput,
      status: "cancelled",
      safeSummary: `${proposal.title} was cancelled.`,
    });
    return { ok: true, data: { proposal: updated } };
  }

  async confirmAiActionProposal(
    context: AiToolContext,
    proposalId: string,
  ): Promise<AiActionSafeResult<{ proposal: AiActionProposal; execution: AiActionExecutionResult }>> {
    const proposal = await this.proposalStore.getProposal(context, proposalId);
    const readiness = await this.validateProposalReady(context, proposal);
    if (!readiness.ok) return readiness;

    const readyProposal = readiness.data.proposal;
    const confirmed = await this.proposalStore.updateProposalStatus({
      context,
      proposalId,
      status: "confirmed",
      allowedCurrentStatuses: ["pending"],
      confirmedAt: this.now(),
    });
    if (!confirmed) return { ok: false, error: proposalStatusError(readyProposal.status) };
    await this.safeAudit({
      context,
      proposalId,
      actionName: readyProposal.actionName,
      targetType: readyProposal.targetType,
      targetId: readyProposal.targetId,
      eventType: "confirmed",
      validatedInput: readyProposal.proposedInput,
      status: "confirmed",
      safeSummary: `${readyProposal.title} confirmed.`,
    });

    return this.executeAiAction(context, proposalId);
  }

  async executeAiAction(
    context: AiToolContext,
    proposalId: string,
  ): Promise<AiActionSafeResult<{ proposal: AiActionProposal; execution: AiActionExecutionResult }>> {
    const proposal = await this.proposalStore.getProposal(context, proposalId);
    const readiness = await this.validateProposalReady(context, proposal, { allowConfirmed: true });
    if (!readiness.ok) return readiness;

    const readyProposal = readiness.data.proposal;
    const definition = readiness.data.definition;
    const startedAt = Date.now();
    try {
      const execution = await definition.execute(context, readyProposal);
      const finalStatus = execution.status === "success" ? "executed" : "failed";
      const safeError = execution.status === "success" ? null : {
        code: "ACTION_EXECUTION_ERROR",
        message: execution.safeMessage,
        retryable: false,
      };
      const updated = await this.proposalStore.updateProposalStatus({
        context,
        proposalId,
        status: finalStatus,
        result: execution,
        safeError,
        executedAt: this.now(),
      });
      await this.safeAudit({
        context,
        proposalId,
        actionName: readyProposal.actionName,
        targetType: readyProposal.targetType,
        targetId: readyProposal.targetId,
        eventType: execution.status === "success" ? "executed" : "failed",
        validatedInput: readyProposal.proposedInput,
        status: finalStatus,
        durationMs: Date.now() - startedAt,
        safeSummary: execution.safeMessage,
        safeError,
      });
      if (execution.status !== "success") {
        return { ok: false, error: safeError as AiToolSafeError };
      }
      return { ok: true, data: { proposal: updated || readyProposal, execution } };
    } catch (error) {
      const safeError = toSafeAiToolError(error);
      const execution: AiActionExecutionResult = {
        actionName: readyProposal.actionName,
        status: "error",
        summary: safeError.message,
        affectedEntities: [],
        safeMessage: safeError.message,
      };
      await this.proposalStore.updateProposalStatus({
        context,
        proposalId,
        status: "failed",
        result: execution,
        safeError,
        executedAt: this.now(),
      });
      await this.safeAudit({
        context,
        proposalId,
        actionName: readyProposal.actionName,
        targetType: readyProposal.targetType,
        targetId: readyProposal.targetId,
        eventType: "failed",
        validatedInput: readyProposal.proposedInput,
        status: "failed",
        durationMs: Date.now() - startedAt,
        safeError,
      });
      return { ok: false, error: safeError };
    }
  }

  private async validateProposalReady(
    context: AiToolContext,
    proposal: AiActionProposal | null,
    options: { allowConfirmed?: boolean } = {},
  ): Promise<AiActionSafeResult<{ proposal: AiActionProposal; definition: AnyAiActionDefinition }>> {
    if (!proposal) return { ok: false, error: proposalNotFoundError() };
    const allowedStatuses = options.allowConfirmed ? ["pending", "confirmed"] : ["pending"];
    if (!allowedStatuses.includes(proposal.status)) {
      return { ok: false, error: proposalStatusError(proposal.status) };
    }
    if (new Date(proposal.expiresAt).getTime() <= this.now().getTime()) {
      await this.proposalStore.updateProposalStatus({
        context,
        proposalId: proposal.id,
        status: "expired",
        allowedCurrentStatuses: ["pending"],
      });
      await this.safeAudit({
        context,
        proposalId: proposal.id,
        actionName: proposal.actionName,
        targetType: proposal.targetType,
        targetId: proposal.targetId,
        eventType: "expired",
        validatedInput: proposal.proposedInput,
        status: "expired",
        safeSummary: `${proposal.title} expired before confirmation.`,
      });
      return {
        ok: false,
        error: {
          code: "ACTION_PROPOSAL_EXPIRED",
          message: "That action proposal has expired.",
          retryable: false,
        },
      };
    }

    const definition = this.getAiActionDefinition(proposal.actionName);
    if (!definition) return { ok: false, error: unknownActionError(proposal.actionName) };
    if (!canUseAiAction(context, definition)) return { ok: false, error: unauthorizedActionError() };
    const parsed = definition.inputSchema.safeParse(proposal.proposedInput ?? {});
    if (!parsed.success) return { ok: false, error: validationError(parsed.error) };

    try {
      await definition.buildProposal(context, parsed.data);
    } catch (error) {
      return { ok: false, error: toSafeAiToolError(error) };
    }

    return { ok: true, data: { proposal, definition } };
  }

  private async safeAudit(input: Parameters<AiActionProposalStore["logAudit"]>[0]): Promise<void> {
    try {
      await this.proposalStore.logAudit(input);
    } catch {
      // Audit logging should never make the action path less safe for the user.
    }
  }
}

export function createAiActionRegistry(options: AiActionRegistryOptions = {}): AiActionRegistry {
  const definitions = options.definitions || createProductPulseAiActionDefinitions(options.productPulse);
  return new AiActionRegistry(
    definitions,
    options.proposalStore || new PrismaAiActionProposalStore(),
    options.now || (() => new Date()),
  );
}

const defaultAiActionRegistry = createAiActionRegistry();

export function listAiActions(): AnyAiActionDefinition[] {
  return defaultAiActionRegistry.listAiActions();
}

export function getAiActionDefinition(actionName: string): AnyAiActionDefinition | null {
  return defaultAiActionRegistry.getAiActionDefinition(actionName);
}

export function createAiActionProposal(
  context: AiToolContext,
  actionName: string,
  rawInput: unknown = {},
): Promise<AiActionSafeResult<{ proposal: AiActionProposal }>> {
  return defaultAiActionRegistry.createAiActionProposal(context, actionName, rawInput);
}

function unknownActionError(actionName: string): AiToolSafeError {
  return {
    code: "UNKNOWN_AI_ACTION",
    message: `Unknown AI internal action: ${actionName}.`,
    retryable: false,
  };
}

function validationError(error: z.ZodError): AiToolSafeError {
  return {
    code: "VALIDATION_ERROR",
    message: "Action input failed validation.",
    retryable: false,
    validationIssues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

function proposalNotFoundError(): AiToolSafeError {
  return {
    code: "ACTION_PROPOSAL_NOT_FOUND",
    message: "That action proposal was not found.",
    retryable: false,
  };
}

function proposalStatusError(status: string): AiToolSafeError {
  return {
    code: "ACTION_PROPOSAL_NOT_PENDING",
    message: `That action proposal is already ${status}.`,
    retryable: false,
  };
}

function canUseAiAction(_context: AiToolContext, _definition: AnyAiActionDefinition): boolean {
  // ProductPulse does not have app-level roles yet. Authenticated embedded app users are allowed for now.
  void _context;
  void _definition;
  return true;
}

function unauthorizedActionError(): AiToolSafeError {
  return {
    code: "ACTION_NOT_AUTHORIZED",
    message: "You are not allowed to run that ProductPulse action.",
    retryable: false,
  };
}
