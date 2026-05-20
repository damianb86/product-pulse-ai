import { z } from "zod";
import { createAiToolContextFromAuthenticatedRequest } from "../context.server";
import type { AiToolContext } from "../domain/types";
import {
  buildStructuredMessageContent,
  PrismaAiConversationStore,
  type AiConversationStore,
} from "../chat/conversationStore.server";
import { normalizeAiPageContext, type AiPageContext } from "../chat/pageContext";
import { createFallbackAssistantResponse } from "../chat/responseSchema";
import type { AiToolRegistry } from "../tools/registry.server";
import { createAiToolRegistry } from "../tools/registry.server";
import { PRODUCT_PULSE_AI_TOOL_NAMES } from "../tools/productPulseTools.server";
import { getAiChatKitConfig, type AiChatKitConfig } from "./config.server";

export const aiChatKitSessionRequestSchema = z.object({
  conversationId: z.string().trim().max(320).optional(),
  pageContext: z.unknown().optional(),
  uiMetadata: z.record(z.string().max(80), z.union([
    z.string().max(240),
    z.number(),
    z.boolean(),
    z.null(),
  ])).optional(),
}).strict();

export type AiChatKitSessionRequest = z.infer<typeof aiChatKitSessionRequestSchema>;

export interface AiChatKitSessionResponse {
  enabled: boolean;
  conversationId: string;
  apiUrl?: string;
  domainKey?: string;
  pageContext: AiPageContext;
  warnings: string[];
  message?: string;
}

export interface CreateAiChatKitSessionDependencies {
  config?: AiChatKitConfig;
  env?: NodeJS.ProcessEnv;
  conversationStore?: AiConversationStore;
  toolRegistry?: AiToolRegistry;
  now?: () => Date;
}

export async function createAiChatKitSessionFromRequest(input: {
  request: Request;
  sessionInput: AiChatKitSessionRequest;
  dependencies?: CreateAiChatKitSessionDependencies;
}): Promise<AiChatKitSessionResponse> {
  const context = await createAiToolContextFromAuthenticatedRequest(input.request, {
    conversationId: input.sessionInput.conversationId,
  });
  return createAiChatKitSession(context, input.sessionInput, input.dependencies);
}

export async function createAiChatKitSession(
  context: AiToolContext,
  input: AiChatKitSessionRequest,
  dependencies: CreateAiChatKitSessionDependencies = {},
): Promise<AiChatKitSessionResponse> {
  const env = dependencies.env || process.env;
  const config = dependencies.config || getAiChatKitConfig(env);
  const conversationStore = dependencies.conversationStore || new PrismaAiConversationStore();
  const toolRegistry = dependencies.toolRegistry || createAiToolRegistry();
  const now = dependencies.now || (() => new Date());
  const pageContextValidation = await validateChatKitPageContextForShop(
    context,
    input.pageContext,
    toolRegistry,
  );
  const conversation = await conversationStore.getOrCreateConversation(context, {
    conversationId: input.conversationId,
    titleSeed: "ProductPulse AI assistant",
    metadata: {
      source: "chatkit",
      pageContext: pageContextValidation.pageContext,
      uiMetadata: input.uiMetadata,
    },
  });
  const chatContext = {
    ...context,
    conversationId: conversation.id,
    createdAt: context.createdAt || now().toISOString(),
  };

  if (!config.enabled) {
    await conversationStore.addMessage({
      context: chatContext,
      conversationId: conversation.id,
      role: "system",
      content: buildStructuredMessageContent(createFallbackAssistantResponse(
        "ChatKit is not configured for this store session.",
        [config.disabledReason || "ChatKit is disabled."],
      )),
      structuredContent: {
        source: "chatkit_session",
        status: "disabled",
        reason: config.disabledReason,
      },
    });
    return {
      enabled: false,
      conversationId: conversation.id,
      pageContext: pageContextValidation.pageContext,
      warnings: pageContextValidation.warnings,
      message: config.disabledReason || "ChatKit is disabled.",
    };
  }

  return {
    enabled: true,
    conversationId: conversation.id,
    apiUrl: config.apiUrl,
    domainKey: config.domainKey,
    pageContext: pageContextValidation.pageContext,
    warnings: pageContextValidation.warnings,
  };
}

export async function validateChatKitPageContextForShop(
  context: AiToolContext,
  rawPageContext: unknown,
  toolRegistry: AiToolRegistry = createAiToolRegistry(),
): Promise<{ pageContext: AiPageContext; warnings: string[] }> {
  const pageContext = normalizeAiPageContext(rawPageContext);
  const productRef = pageContext.type === "product"
    ? pageContext.entityId || pageContext.entityHandle || ""
    : "";
  if (!productRef) return { pageContext, warnings: [] };

  const result = await toolRegistry.executeAiTool(
    PRODUCT_PULSE_AI_TOOL_NAMES.getProductRiskDetail,
    context,
    { productRef },
  );
  if (!result.ok) {
    return {
      pageContext: {
        ...pageContext,
        entityId: undefined,
        entityHandle: undefined,
      },
      warnings: ["The product page context could not be verified for this shop and was removed."],
    };
  }

  const product = (result.data as { product?: { productGid?: string; handle?: string | null } }).product;
  return {
    pageContext: {
      ...pageContext,
      entityId: product?.productGid || pageContext.entityId,
      entityHandle: product?.handle || pageContext.entityHandle,
    },
    warnings: [],
  };
}
