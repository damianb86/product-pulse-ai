import crypto from "node:crypto";
import { z } from "zod";
import OpenAI from "openai";
import type { ChatSession } from "openai/resources/beta/chatkit/threads";
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
  client_secret?: string;
  chatKitSessionId?: string;
  expiresAt?: number;
  pageContext: AiPageContext;
  warnings: string[];
  message?: string;
}

export interface OpenAiChatKitSessionsClient {
  beta: {
    chatkit: {
      sessions: {
        create: (body: Record<string, unknown>) => Promise<ChatSession>;
      };
    };
  };
}

export interface CreateAiChatKitSessionDependencies {
  config?: AiChatKitConfig;
  env?: NodeJS.ProcessEnv;
  chatKitClient?: OpenAiChatKitSessionsClient;
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

  if (!config.enabled || !config.workflowId) {
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

  const client = dependencies.chatKitClient || createOpenAiChatKitClient(env);
  const session = await client.beta.chatkit.sessions.create({
    user: createChatKitUserId(context),
    workflow: {
      id: config.workflowId,
      ...(config.workflowVersion ? { version: config.workflowVersion } : {}),
      tracing: { enabled: config.debug },
      state_variables: buildStateVariables(context, conversation.id, pageContextValidation.pageContext),
    },
    chatkit_configuration: {
      automatic_thread_titling: { enabled: true },
      file_upload: { enabled: false },
      history: {
        enabled: true,
        recent_threads: config.recentThreadCount,
      },
    },
    expires_after: {
      anchor: "created_at",
      seconds: config.sessionTtlSeconds,
    },
    rate_limits: {
      max_requests_per_1_minute: config.rateLimitPerMinute,
    },
  });

  return {
    enabled: true,
    conversationId: conversation.id,
    client_secret: session.client_secret,
    chatKitSessionId: session.id,
    expiresAt: session.expires_at,
    pageContext: pageContextValidation.pageContext,
    warnings: pageContextValidation.warnings,
  };
}

export function createOpenAiChatKitClient(env: NodeJS.ProcessEnv = process.env): OpenAiChatKitSessionsClient {
  const apiKey = String(env.OPENAI_API_KEY || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is required to create a ChatKit session.");
  return new OpenAI({ apiKey }) as unknown as OpenAiChatKitSessionsClient;
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

function createChatKitUserId(context: AiToolContext): string {
  const stableUser = context.userId || context.sessionId || "anonymous";
  return `pp_${sha256(`${context.shop}:${stableUser}`).slice(0, 32)}`;
}

function buildStateVariables(
  context: AiToolContext,
  conversationId: string,
  pageContext: AiPageContext,
): Record<string, string | boolean | number> {
  return {
    product_pulse_scope: sha256(context.shop).slice(0, 32),
    product_pulse_conversation_id: conversationId,
    product_pulse_page_type: pageContext.type,
    product_pulse_page_ref: pageContext.entityId || pageContext.entityHandle || "",
    product_pulse_backend: "phase2_orchestrator",
  };
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
