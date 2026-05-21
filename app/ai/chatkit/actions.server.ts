import { z } from "zod";
import { createAiToolContextFromAuthenticatedRequest } from "../context.server";
import type { AiToolContext } from "../domain/types";
import type { AiPresentationBlock } from "../presentation/blocks";
import { createAiToolRegistry, type AiToolRegistry } from "../tools/registry.server";
import { PRODUCT_PULSE_AI_TOOL_NAMES } from "../tools/productPulseTools.server";
import { createAiActionRegistry, type AiActionRegistry } from "../actions/registry.server";
import {
  aiActionCancellationToPresentationBlock,
  aiActionExecutionToPresentationBlock,
} from "../actions/presentation";
import { createAiAppMutationRegistry, type AiAppMutationRegistry } from "../appMutations/registry.server";
import {
  aiAppMutationCancellationToPresentationBlock,
  aiAppMutationResultToPresentationBlock,
} from "../appMutations/presentation";
import { canUseAiAppMutation, canUseInternalAiAction } from "../security/permissions.server";

const safeActionPayloadSchema = z.object({
  proposalId: z.string().trim().min(1).max(320).optional(),
  productRef: z.string().trim().min(1).max(320).optional(),
  product_id: z.string().trim().min(1).max(320).optional(),
  productGid: z.string().trim().min(1).max(320).optional(),
  handle: z.string().trim().min(1).max(180).optional(),
  recommendationId: z.string().trim().min(1).max(160).optional(),
  actionId: z.string().trim().min(1).max(160).optional(),
  action_id: z.string().trim().min(1).max(160).optional(),
  preview_id: z.string().trim().min(1).max(160).optional(),
  source: z.string().trim().max(120).optional(),
  message: z.string().trim().min(1).max(500).optional(),
  text: z.string().trim().max(8000).optional(),
  seoTitle: z.string().trim().max(90).optional(),
  seoDescription: z.string().trim().max(220).optional(),
  value: z.string().trim().max(8000).optional(),
  title: z.string().trim().max(180).optional(),
  description: z.string().trim().max(800).optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  status: z.enum(["draft", "active", "reviewed", "dismissed", "completed"]).optional(),
  reason: z.string().trim().max(700).optional(),
  editedFields: z.record(z.string(), z.unknown()).optional(),
  formData: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const chatKitActionRequestSchema = z.object({
  action: z.object({
    type: z.string().trim().min(1).max(80),
    payload: safeActionPayloadSchema.optional(),
  }).strict(),
  itemId: z.string().trim().max(320).optional(),
  conversationId: z.string().trim().max(320).optional(),
}).strict();

export type ChatKitActionRequest = z.infer<typeof chatKitActionRequestSchema>;

export type ChatKitActionResult =
  | {
      status: "success";
      action:
        | { type: "navigate"; url: string }
        | { type: "send_message"; message: string }
        | { type: "assistant_response"; message: string; blocks: AiPresentationBlock[] }
        | { type: "noop"; message: string };
    }
  | {
      status: "error";
      message: string;
      code: string;
    };

export interface ChatKitActionLogger {
  logActionAttempt(input: {
    context: AiToolContext;
    actionType: string;
    itemId?: string;
    status: "started" | "success" | "error";
    safeMessage?: string;
  }): Promise<void> | void;
}

export const noopChatKitActionLogger: ChatKitActionLogger = {
  logActionAttempt() {},
};

export interface HandleChatKitActionDependencies {
  toolRegistry?: AiToolRegistry;
  actionRegistry?: AiActionRegistry;
  appMutationRegistry?: AiAppMutationRegistry;
  logger?: ChatKitActionLogger;
}

export async function handleChatKitActionFromRequest(input: {
  request: Request;
  actionInput: ChatKitActionRequest;
  dependencies?: HandleChatKitActionDependencies;
}): Promise<ChatKitActionResult> {
  const context = await createAiToolContextFromAuthenticatedRequest(input.request, {
    conversationId: input.actionInput.conversationId,
  });
  return handleChatKitAction(context, input.actionInput, input.dependencies);
}

export async function handleChatKitAction(
  context: AiToolContext,
  input: ChatKitActionRequest,
  dependencies: HandleChatKitActionDependencies = {},
): Promise<ChatKitActionResult> {
  const logger = dependencies.logger || noopChatKitActionLogger;
  const actionType = input.action.type;
  await safeLog(() => logger.logActionAttempt({
    context,
    actionType,
    itemId: input.itemId,
    status: "started",
  }));

  const result = await dispatchSafeAction(
    context,
    input,
    dependencies.toolRegistry || createAiToolRegistry(),
    dependencies.actionRegistry || createAiActionRegistry(),
    dependencies.appMutationRegistry || createAiAppMutationRegistry(),
  );
  await safeLog(() => logger.logActionAttempt({
    context,
    actionType,
    itemId: input.itemId,
    status: result.status,
    safeMessage: result.status === "error" ? result.message : undefined,
  }));
  return result;
}

async function dispatchSafeAction(
  context: AiToolContext,
  input: ChatKitActionRequest,
  toolRegistry: AiToolRegistry,
  actionRegistry: AiActionRegistry,
  appMutationRegistry: AiAppMutationRegistry,
): Promise<ChatKitActionResult> {
  switch (input.action.type) {
    case "confirm_ai_action":
      return confirmAiAction(context, input.action.payload || {}, actionRegistry);
    case "cancel_ai_action":
      return cancelAiAction(context, input.action.payload || {}, actionRegistry);
    case "save_ai_app_draft":
      return saveAiAppDraft(context, input.action.payload || {}, appMutationRegistry);
    case "update_ai_app_draft":
      return updateAiAppDraft(context, input.action.payload || {}, appMutationRegistry);
    case "cancel_ai_app_draft":
      return cancelAiAppDraft(context, input.action.payload || {}, appMutationRegistry);
    case "open_product":
      return productNavigationAction(context, input.action.payload || {}, toolRegistry, "product");
    case "open_evidence":
      return productNavigationAction(context, input.action.payload || {}, toolRegistry, "evidence");
    case "open_evidence_source":
      return productNavigationAction(context, input.action.payload || {}, toolRegistry, "evidence");
    case "open_recommendation":
      return productNavigationAction(context, input.action.payload || {}, toolRegistry, "recommendation");
    case "review_action":
      return productNavigationAction(context, input.action.payload || {}, toolRegistry, "recommendation");
    case "prepare_apply_action":
      return productNavigationAction(context, input.action.payload || {}, toolRegistry, "recommendation");
    case "open_action_editor":
      return productNavigationAction(context, input.action.payload || {}, toolRegistry, "recommendation");
    case "open_issues":
      return productNavigationAction(context, input.action.payload || {}, toolRegistry, "product");
    case "open_momentum":
      return productNavigationAction(context, input.action.payload || {}, toolRegistry, "product");
    case "open_analytics":
      return { status: "success", action: { type: "navigate", url: "/app/analytics" } };
    case "open_watchlist":
      return { status: "success", action: { type: "navigate", url: "/app/watchlist" } };
    case "show_more_evidence":
      return showMoreEvidenceAction(input.action.payload || {});
    case "refine_query":
      return refineQueryAction(input.action.payload || {});
    default:
      return {
        status: "error",
        code: "UNSUPPORTED_CHATKIT_ACTION",
        message: "That assistant action is not available yet.",
      };
  }
}

async function saveAiAppDraft(
  context: AiToolContext,
  payload: z.infer<typeof safeActionPayloadSchema>,
  registry: AiAppMutationRegistry,
): Promise<ChatKitActionResult> {
  const permission = canUseAiAppMutation(context);
  if (!permission.allowed) {
    return {
      status: "error",
      code: permission.code || "AI_APP_MUTATIONS_DISABLED",
      message: permission.message || "AI app-only drafts are disabled.",
    };
  }
  if (!payload.proposalId) {
    return {
      status: "error",
      code: "VALIDATION_ERROR",
      message: "The draft action is missing a proposal ID.",
    };
  }

  const result = await registry.saveAiAppMutationDraft(context, payload.proposalId, editablePayload(payload));
  if (!result.ok) {
    return {
      status: "error",
      code: result.error.code,
      message: result.error.message,
    };
  }

  return {
    status: "success",
    action: {
      type: "assistant_response",
      message: result.data.result.safeMessage,
      blocks: [aiAppMutationResultToPresentationBlock(result.data.result, {
        targetLabel: result.data.proposal.targetLabel,
        sideEffectLevel: result.data.proposal.sideEffectLevel,
      })],
    },
  };
}

async function updateAiAppDraft(
  context: AiToolContext,
  payload: z.infer<typeof safeActionPayloadSchema>,
  registry: AiAppMutationRegistry,
): Promise<ChatKitActionResult> {
  const permission = canUseAiAppMutation(context);
  if (!permission.allowed) {
    return {
      status: "error",
      code: permission.code || "AI_APP_MUTATIONS_DISABLED",
      message: permission.message || "AI app-only drafts are disabled.",
    };
  }
  if (!payload.proposalId) {
    return {
      status: "error",
      code: "VALIDATION_ERROR",
      message: "The draft action is missing a proposal ID.",
    };
  }
  const result = await registry.updateAiAppMutationDraft(context, payload.proposalId, editablePayload(payload));
  if (!result.ok) {
    return {
      status: "error",
      code: result.error.code,
      message: result.error.message,
    };
  }
  return {
    status: "success",
    action: {
      type: "assistant_response",
      message: `${result.data.proposal.title} was updated. It has not been saved to Shopify.`,
      blocks: [],
    },
  };
}

async function cancelAiAppDraft(
  context: AiToolContext,
  payload: z.infer<typeof safeActionPayloadSchema>,
  registry: AiAppMutationRegistry,
): Promise<ChatKitActionResult> {
  const permission = canUseAiAppMutation(context);
  if (!permission.allowed) {
    return {
      status: "error",
      code: permission.code || "AI_APP_MUTATIONS_DISABLED",
      message: permission.message || "AI app-only drafts are disabled.",
    };
  }
  if (!payload.proposalId) {
    return {
      status: "error",
      code: "VALIDATION_ERROR",
      message: "The draft action is missing a proposal ID.",
    };
  }
  const result = await registry.cancelAiAppMutationDraft(context, payload.proposalId);
  if (!result.ok) {
    return {
      status: "error",
      code: result.error.code,
      message: result.error.message,
    };
  }
  return {
    status: "success",
    action: {
      type: "assistant_response",
      message: `${result.data.proposal.title} was cancelled. No app data or Shopify data was changed.`,
      blocks: [aiAppMutationCancellationToPresentationBlock(result.data.proposal)],
    },
  };
}

async function confirmAiAction(
  context: AiToolContext,
  payload: z.infer<typeof safeActionPayloadSchema>,
  actionRegistry: AiActionRegistry,
): Promise<ChatKitActionResult> {
  const permission = canUseInternalAiAction(context);
  if (!permission.allowed) {
    return {
      status: "error",
      code: permission.code || "AI_INTERNAL_ACTIONS_DISABLED",
      message: permission.message || "AI internal actions are disabled.",
    };
  }
  if (!payload.proposalId) {
    return {
      status: "error",
      code: "VALIDATION_ERROR",
      message: "The assistant action is missing a proposal ID.",
    };
  }

  const result = await actionRegistry.confirmAiActionProposal(context, payload.proposalId);
  if (!result.ok) {
    return {
      status: "error",
      code: result.error.code,
      message: result.error.message,
    };
  }

  return {
    status: "success",
    action: {
      type: "assistant_response",
      message: result.data.execution.safeMessage,
      blocks: [aiActionExecutionToPresentationBlock(result.data.proposal, result.data.execution)],
    },
  };
}

async function cancelAiAction(
  context: AiToolContext,
  payload: z.infer<typeof safeActionPayloadSchema>,
  actionRegistry: AiActionRegistry,
): Promise<ChatKitActionResult> {
  const permission = canUseInternalAiAction(context);
  if (!permission.allowed) {
    return {
      status: "error",
      code: permission.code || "AI_INTERNAL_ACTIONS_DISABLED",
      message: permission.message || "AI internal actions are disabled.",
    };
  }
  if (!payload.proposalId) {
    return {
      status: "error",
      code: "VALIDATION_ERROR",
      message: "The assistant action is missing a proposal ID.",
    };
  }

  const result = await actionRegistry.cancelAiActionProposal(context, payload.proposalId);
  if (!result.ok) {
    return {
      status: "error",
      code: result.error.code,
      message: result.error.message,
    };
  }

  return {
    status: "success",
    action: {
      type: "assistant_response",
      message: `${result.data.proposal.title} was cancelled. No internal app data was changed.`,
      blocks: [aiActionCancellationToPresentationBlock(result.data.proposal)],
    },
  };
}

async function productNavigationAction(
  context: AiToolContext,
  payload: z.infer<typeof safeActionPayloadSchema>,
  toolRegistry: AiToolRegistry,
  destination: "product" | "evidence" | "recommendation",
): Promise<ChatKitActionResult> {
  const productRef = payload.productRef || payload.productGid || payload.handle || payload.product_id || "";
  if (!productRef) {
    return {
      status: "error",
      code: "VALIDATION_ERROR",
      message: "The assistant action is missing a product reference.",
    };
  }

  const result = await toolRegistry.executeAiTool(
    PRODUCT_PULSE_AI_TOOL_NAMES.getProductRiskDetail,
    context,
    { productRef },
  );
  if (!result.ok) {
    return {
      status: "error",
      code: "NOT_FOUND",
      message: "That product is not available for this shop.",
    };
  }

  const product = (result.data as { product?: { productGid?: string; handle?: string | null } }).product;
  const pathId = product?.handle || payload.handle || product?.productGid || payload.productGid || productRef;
  const baseUrl = `/app/products/${encodeURIComponent(pathId)}`;
  if (destination === "product") {
    return { status: "success", action: { type: "navigate", url: baseUrl } };
  }

  if (destination === "recommendation") {
    const recommendationId = payload.recommendationId || payload.actionId || payload.action_id || "";
    if (!recommendationId) {
      return {
        status: "error",
        code: "VALIDATION_ERROR",
        message: "The assistant action is missing a recommended action ID.",
      };
    }

    const search = new URLSearchParams({
      assistantAction: "open_recommendation",
      recommendationId,
    });
    return { status: "success", action: { type: "navigate", url: `${baseUrl}?${search.toString()}` } };
  }

  const search = payload.source ? `?source=${encodeURIComponent(payload.source)}` : "";
  return { status: "success", action: { type: "navigate", url: `${baseUrl}/evidence${search}` } };
}

function showMoreEvidenceAction(payload: z.infer<typeof safeActionPayloadSchema>): ChatKitActionResult {
  const productRef = payload.productRef || payload.productGid || payload.handle || "this product";
  return {
    status: "success",
    action: {
      type: "send_message",
      message: `Show me more evidence for ${productRef}.`,
    },
  };
}

function refineQueryAction(payload: z.infer<typeof safeActionPayloadSchema>): ChatKitActionResult {
  if (!payload.message) {
    return {
      status: "error",
      code: "VALIDATION_ERROR",
      message: "The assistant action is missing a refinement message.",
    };
  }
  return {
    status: "success",
    action: {
      type: "send_message",
      message: payload.message,
    },
  };
}

function editablePayload(payload: z.infer<typeof safeActionPayloadSchema>): Record<string, unknown> {
  const nested = payload.editedFields && typeof payload.editedFields === "object" ? payload.editedFields : {};
  const formData = payload.formData && typeof payload.formData === "object" ? payload.formData : {};
  return {
    ...nested,
    ...formData,
    ...(payload.text !== undefined ? { text: payload.text } : {}),
    ...(payload.seoTitle !== undefined ? { seoTitle: payload.seoTitle } : {}),
    ...(payload.seoDescription !== undefined ? { seoDescription: payload.seoDescription } : {}),
    ...(payload.value !== undefined ? { value: payload.value } : {}),
    ...(payload.title !== undefined ? { title: payload.title } : {}),
    ...(payload.description !== undefined ? { description: payload.description } : {}),
    ...(payload.priority !== undefined ? { priority: payload.priority } : {}),
    ...(payload.status !== undefined ? { status: payload.status } : {}),
    ...(payload.reason !== undefined ? { reason: payload.reason } : {}),
  };
}

async function safeLog(log: () => Promise<void> | void): Promise<void> {
  try {
    await log();
  } catch {
    // Action logging must not break navigation or safe responses.
  }
}
