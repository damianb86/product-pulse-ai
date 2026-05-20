import { z } from "zod";
import { createAiToolContextFromAuthenticatedRequest } from "../context.server";
import type { AiToolContext } from "../domain/types";
import {
  PrismaAiConversationStore,
  type AiConversationStore,
  type StoredAiConversation,
  type StoredAiConversationMessage,
} from "../chat/conversationStore.server";
import { AiChatOrchestrator, type AiChatTurnResult } from "../chat/aiChatOrchestrator.server";
import type { AiPageContext } from "../chat/pageContext";
import type { AiPresentationBlock } from "../presentation/blocks";
import type { AiActionRegistry } from "../actions/registry.server";
import { aiActionErrorToPresentationBlock } from "../actions/presentation";
import { createAiToolRegistry, type AiToolRegistry } from "../tools/registry.server";
import { chatKitActionRequestSchema, handleChatKitAction } from "./actions.server";
import { validateChatKitPageContextForShop } from "./session.server";
import { mapAiPresentationBlocksToChatKitWidgets } from "./widgets";

const MAX_CHATKIT_MESSAGE_LENGTH = 3000;
const DEFAULT_PAGE_SIZE = 20;
const STREAM_TEXT_DELTA_DELAY_MS = process.env.NODE_ENV === "test" ? 0 : 12;
const STREAM_TEXT_CHUNK_SIZE = 36;

const chatKitMetadataSchema = z.object({
  conversationId: z.string().trim().max(320).optional(),
  pageContext: z.unknown().optional(),
  source: z.string().trim().max(80).optional(),
}).passthrough().optional();

const userMessageContentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("input_text"),
    text: z.string().max(MAX_CHATKIT_MESSAGE_LENGTH),
  }).passthrough(),
  z.object({
    type: z.literal("input_tag"),
    id: z.string().max(320),
    text: z.string().max(500),
    data: z.record(z.string(), z.unknown()).optional(),
  }).passthrough(),
]);

const userMessageInputSchema = z.object({
  content: z.array(userMessageContentSchema).min(1).max(20),
  attachments: z.array(z.string().max(320)).optional().default([]),
  quoted_text: z.string().max(1000).nullable().optional(),
  inference_options: z.object({
    model: z.string().max(120).nullable().optional(),
    tool_choice: z.object({ id: z.string().max(160) }).nullable().optional(),
  }).passthrough().optional().default({}),
}).passthrough();

const pageParamsSchema = z.object({
  limit: z.number().int().min(1).max(50).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  after: z.string().max(320).nullable().optional(),
}).passthrough();

const chatKitServerRequestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("threads.create"),
    metadata: chatKitMetadataSchema,
    params: z.object({ input: userMessageInputSchema }).passthrough(),
  }).passthrough(),
  z.object({
    type: z.literal("threads.add_user_message"),
    metadata: chatKitMetadataSchema,
    params: z.object({
      thread_id: z.string().trim().min(1).max(320),
      input: userMessageInputSchema,
    }).passthrough(),
  }).passthrough(),
  z.object({
    type: z.literal("threads.get_by_id"),
    metadata: chatKitMetadataSchema,
    params: z.object({ thread_id: z.string().trim().min(1).max(320) }).passthrough(),
  }).passthrough(),
  z.object({
    type: z.literal("threads.list"),
    metadata: chatKitMetadataSchema,
    params: pageParamsSchema.optional().default({}),
  }).passthrough(),
  z.object({
    type: z.literal("items.list"),
    metadata: chatKitMetadataSchema,
    params: pageParamsSchema.extend({
      thread_id: z.string().trim().min(1).max(320),
    }).passthrough(),
  }).passthrough(),
  z.object({
    type: z.literal("threads.update"),
    metadata: chatKitMetadataSchema,
    params: z.object({
      thread_id: z.string().trim().min(1).max(320),
      title: z.string().trim().min(1).max(120),
    }).passthrough(),
  }).passthrough(),
  z.object({
    type: z.literal("threads.custom_action"),
    metadata: chatKitMetadataSchema,
    params: z.object({
      thread_id: z.string().trim().min(1).max(320),
      item_id: z.string().trim().max(320).nullable().optional(),
      action: z.object({
        type: z.string().trim().min(1).max(80),
        payload: z.unknown().optional(),
      }).passthrough(),
    }).passthrough(),
  }).passthrough(),
  z.object({
    type: z.literal("threads.sync_custom_action"),
    metadata: chatKitMetadataSchema,
    params: z.object({
      thread_id: z.string().trim().min(1).max(320),
      item_id: z.string().trim().max(320).nullable().optional(),
      action: z.object({
        type: z.string().trim().min(1).max(80),
        payload: z.unknown().optional(),
      }).passthrough(),
    }).passthrough(),
  }).passthrough(),
  z.object({
    type: z.literal("items.feedback"),
    metadata: chatKitMetadataSchema,
    params: z.object({
      thread_id: z.string().trim().min(1).max(320),
      item_ids: z.array(z.string().max(320)).max(20),
      kind: z.enum(["positive", "negative"]),
    }).passthrough(),
  }).passthrough(),
]);

export type ChatKitServerRequest = z.infer<typeof chatKitServerRequestSchema>;

export interface HandleChatKitMessageDependencies {
  orchestrator?: Pick<AiChatOrchestrator, "runAiChatTurnWithContext">;
  conversationStore?: AiConversationStore;
  toolRegistry?: AiToolRegistry;
  actionRegistry?: AiActionRegistry;
  now?: () => Date;
}

export async function handleChatKitMessageFromRequest(input: {
  request: Request;
  rawBody: string;
  dependencies?: HandleChatKitMessageDependencies;
}): Promise<Response> {
  const context = await createAiToolContextFromAuthenticatedRequest(input.request);
  return handleChatKitMessage(context, input.rawBody, input.dependencies);
}

export async function handleChatKitMessage(
  context: AiToolContext,
  rawBody: string,
  dependencies: HandleChatKitMessageDependencies = {},
): Promise<Response> {
  const parsedJson = parseJson(rawBody);
  if (!parsedJson.ok) {
    return jsonResponse({ error: { code: "VALIDATION_ERROR", message: "ChatKit request body must be valid JSON." } }, 400);
  }

  const parsed = chatKitServerRequestSchema.safeParse(parsedJson.value);
  if (!parsed.success) {
    return jsonResponse({
      error: {
        code: "VALIDATION_ERROR",
        message: "ChatKit request is invalid.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    }, 400);
  }

  const store = dependencies.conversationStore || new PrismaAiConversationStore();
  const now = dependencies.now || (() => new Date());
  const request = parsed.data;

  switch (request.type) {
    case "threads.create":
      return streamResponse(await runChatTurn({
        context,
        request,
        message: extractUserMessageText(request.params.input),
        conversationId: request.metadata?.conversationId,
        store,
        dependencies,
        now,
        emitThreadCreated: true,
      }));
    case "threads.add_user_message":
      return streamResponse(await runChatTurn({
        context,
        request,
        message: extractUserMessageText(request.params.input),
        conversationId: request.params.thread_id,
        store,
        dependencies,
        now,
        emitThreadCreated: false,
      }));
    case "threads.get_by_id":
      return getThreadResponse(context, store, request.params.thread_id);
    case "threads.list":
      return listThreadsResponse(context, store, request.params);
    case "items.list":
      return listItemsResponse(context, store, request.params.thread_id, request.params);
    case "threads.update":
      return updateThreadResponse(context, store, request.params.thread_id, request.params.title);
    case "items.feedback":
      return jsonResponse({});
    case "threads.custom_action":
      return streamResponse(await runChatKitAction({
        context,
        request,
        conversationId: request.params.thread_id,
        store,
        dependencies,
        now,
      }));
    case "threads.sync_custom_action":
      return syncActionResponse(context, request);
    default:
      return jsonResponse({ error: { code: "UNSUPPORTED_CHATKIT_REQUEST", message: "That ChatKit request is not supported." } }, 400);
  }
}

async function runChatTurn(input: {
  context: AiToolContext;
  request: Extract<ChatKitServerRequest, { type: "threads.create" | "threads.add_user_message" }>;
  message: string;
  conversationId?: string | null;
  store: AiConversationStore;
  dependencies: HandleChatKitMessageDependencies;
  now: () => Date;
  emitThreadCreated: boolean;
}): Promise<Record<string, unknown>[]> {
  const pageContext = await validatedPageContext(input.context, input.request.metadata?.pageContext, input.dependencies.toolRegistry);
  const orchestrator = input.dependencies.orchestrator || new AiChatOrchestrator();
  const result = await orchestrator.runAiChatTurnWithContext(input.context, {
    conversationId: input.conversationId,
    message: input.message,
    pageContext,
    userIntentMetadata: {
      source: "chatkit_custom_backend",
      chatKitRequestType: input.request.type,
    },
  });
  const conversation = await input.store.getConversation(input.context, result.conversationId);
  return buildTurnEvents({
    conversation: conversation || fallbackConversation(input.context, result.conversationId, input.now),
    result,
    userText: input.message,
    emitThreadCreated: input.emitThreadCreated,
    now: input.now,
  });
}

async function runChatKitAction(input: {
  context: AiToolContext;
  request: Extract<ChatKitServerRequest, { type: "threads.custom_action" }>;
  conversationId: string;
  store: AiConversationStore;
  dependencies: HandleChatKitMessageDependencies;
  now: () => Date;
}): Promise<Record<string, unknown>[]> {
  const parsed = chatKitActionRequestSchema.safeParse({
    action: input.request.params.action,
    itemId: input.request.params.item_id || undefined,
    conversationId: input.conversationId,
  });
  if (!parsed.success) {
    return [errorEvent("ChatKit action request is invalid.")];
  }

  const result = await handleChatKitAction(input.context, parsed.data, {
    toolRegistry: input.dependencies.toolRegistry,
    actionRegistry: input.dependencies.actionRegistry,
  });
  if (result.status === "error") {
    return assistantBlockResponseEvents({
      context: input.context,
      conversationId: input.conversationId,
      store: input.store,
      message: result.message,
      blocks: [aiActionErrorToPresentationBlock({
        actionName: input.request.params.action.type,
        message: result.message,
      })],
      now: input.now,
    });
  }

  if (result.action.type === "assistant_response") {
    return assistantBlockResponseEvents({
      context: input.context,
      conversationId: input.conversationId,
      store: input.store,
      message: result.action.message,
      blocks: result.action.blocks,
      now: input.now,
    });
  }

  if (result.action.type === "send_message") {
    const pageContext = await validatedPageContext(input.context, input.request.metadata?.pageContext, input.dependencies.toolRegistry);
    const orchestrator = input.dependencies.orchestrator || new AiChatOrchestrator();
    const turn = await orchestrator.runAiChatTurnWithContext(input.context, {
      conversationId: input.conversationId,
      message: result.action.message,
      pageContext,
      userIntentMetadata: {
        source: "chatkit_custom_backend_action",
        chatKitActionType: input.request.params.action.type,
      },
    });
    const conversation = await input.store.getConversation(input.context, turn.conversationId);
    return buildTurnEvents({
      conversation: conversation || fallbackConversation(input.context, turn.conversationId, input.now),
      result: turn,
      userText: result.action.message,
      emitThreadCreated: false,
      now: input.now,
    });
  }

  if (result.action.type === "navigate") {
    return [
      streamOptionsEvent(),
      clientEffectEvent("product_pulse.navigate", { url: result.action.url }),
    ];
  }

  const message = result.action.message;
  return [assistantDoneEvent(input.conversationId, `msg_${stableId(`${input.conversationId}:${input.now().toISOString()}`)}`, message, input.now)];
}

async function assistantBlockResponseEvents(input: {
  context: AiToolContext;
  conversationId: string;
  store: AiConversationStore;
  message: string;
  blocks: AiPresentationBlock[];
  now: () => Date;
}): Promise<Record<string, unknown>[]> {
  await input.store.getOrCreateConversation(input.context, {
    conversationId: input.conversationId,
    titleSeed: "ProductPulse AI assistant",
  });
  const assistantMessage = await input.store.addMessage({
    context: input.context,
    conversationId: input.conversationId,
    role: "assistant",
    content: input.message,
    structuredContent: { blocks: input.blocks },
  });
  return [
    streamOptionsEvent(),
    ...assistantStreamingEvents(input.conversationId, assistantMessage.id, input.message, input.now),
    ...widgetsToDoneEvents(input.conversationId, assistantMessage.id, input.blocks, input.message, input.now),
    endOfTurnDoneEvent(input.conversationId, assistantMessage.id, input.now),
  ];
}

async function syncActionResponse(
  context: AiToolContext,
  request: Extract<ChatKitServerRequest, { type: "threads.sync_custom_action" }>,
): Promise<Response> {
  const parsed = chatKitActionRequestSchema.safeParse({
    action: request.params.action,
    itemId: request.params.item_id || undefined,
    conversationId: request.params.thread_id,
  });
  if (!parsed.success) {
    return jsonResponse({ updated_item: null });
  }
  await handleChatKitAction(context, parsed.data);
  return jsonResponse({ updated_item: null });
}

async function getThreadResponse(
  context: AiToolContext,
  store: AiConversationStore,
  conversationId: string,
): Promise<Response> {
  const conversation = await store.getConversation(context, conversationId);
  if (!conversation) {
    return jsonResponse({ error: { code: "NOT_FOUND", message: "ChatKit thread was not found." } }, 404);
  }
  return jsonResponse(await buildThread(context, store, conversation));
}

async function listThreadsResponse(
  context: AiToolContext,
  store: AiConversationStore,
  params: { limit?: number | null; after?: string | null; order?: "asc" | "desc" },
): Promise<Response> {
  const page = await store.listConversations(context, {
    limit: normalizeLimit(params.limit),
    after: params.after,
    order: params.order,
  });
  const threads = await Promise.all(page.conversations.map((conversation) => buildThread(context, store, conversation, 0)));
  return jsonResponse({ data: threads, has_more: page.hasMore, after: page.after });
}

async function listItemsResponse(
  context: AiToolContext,
  store: AiConversationStore,
  conversationId: string,
  params: { limit?: number | null; after?: string | null; order?: "asc" | "desc" },
): Promise<Response> {
  const conversation = await store.getConversation(context, conversationId);
  if (!conversation) {
    return jsonResponse({ error: { code: "NOT_FOUND", message: "ChatKit thread was not found." } }, 404);
  }
  const page = await store.listMessages(context, conversation.id, {
    limit: normalizeLimit(params.limit),
    after: params.after,
    order: params.order,
  });
  return jsonResponse({
    data: page.messages.flatMap((message) => messageToThreadItems(message)),
    has_more: page.hasMore,
    after: page.after,
  });
}

async function updateThreadResponse(
  context: AiToolContext,
  store: AiConversationStore,
  conversationId: string,
  title: string,
): Promise<Response> {
  const conversation = await store.updateConversationTitle(context, conversationId, title);
  if (!conversation) {
    return jsonResponse({ error: { code: "NOT_FOUND", message: "ChatKit thread was not found." } }, 404);
  }
  return jsonResponse(await buildThread(context, store, conversation, 0));
}

async function buildThread(
  context: AiToolContext,
  store: AiConversationStore,
  conversation: StoredAiConversation,
  itemLimit = DEFAULT_PAGE_SIZE,
): Promise<Record<string, unknown>> {
  const page = itemLimit > 0
    ? await store.listMessages(context, conversation.id, { limit: itemLimit, order: "asc" })
    : { messages: [], hasMore: false, after: null };
  return {
    id: conversation.id,
    title: conversation.title || "ProductPulse AI assistant",
    created_at: toIso(conversation.createdAt),
    status: { type: "active" },
    items: {
      data: page.messages.flatMap((message) => messageToThreadItems(message)),
      has_more: page.hasMore,
      after: page.after,
    },
  };
}

function buildTurnEvents(input: {
  conversation: StoredAiConversation;
  result: AiChatTurnResult;
  userText: string;
  emitThreadCreated: boolean;
  now: () => Date;
}): Record<string, unknown>[] {
  const events: Record<string, unknown>[] = [];
  if (input.emitThreadCreated) {
    events.push({
      type: "thread.created",
      thread: {
        id: input.result.conversationId,
        title: input.conversation.title || "ProductPulse AI assistant",
        created_at: toIso(input.conversation.createdAt) || input.now().toISOString(),
        status: { type: "active" },
        items: { data: [], has_more: false, after: null },
      },
    });
  }
  events.push(userDoneEvent(input.result.conversationId, input.result.userMessageId, input.userText, input.now));
  events.push(streamOptionsEvent());
  events.push(...assistantStreamingEvents(input.result.conversationId, input.result.messageId, input.result.assistantText, input.now));
  events.push(...widgetsToDoneEvents(input.result.conversationId, input.result.messageId, input.result.blocks, input.result.assistantText, input.now));
  events.push(endOfTurnDoneEvent(input.result.conversationId, input.result.messageId, input.now));
  return events;
}

function messageToThreadItems(message: StoredAiConversationMessage): Record<string, unknown>[] {
  if (message.role === "user") {
    return [userMessageItem(message.conversationId, message.id, message.content, message.createdAt)];
  }
  if (message.role !== "assistant") return [];
  const items = [assistantMessageItem(message.conversationId, message.id, message.content, message.createdAt)];
  const blocks = extractBlocks(message.structuredContent);
  items.push(...widgetsToItems(message.conversationId, message.id, blocks, message.content, message.createdAt));
  return items;
}

function userDoneEvent(threadId: string, itemId: string, text: string, now: () => Date): Record<string, unknown> {
  return { type: "thread.item.done", item: userMessageItem(threadId, itemId, text, now().toISOString()) };
}

function assistantDoneEvent(threadId: string, itemId: string, text: string, now: () => Date): Record<string, unknown> {
  return { type: "thread.item.done", item: assistantMessageItem(threadId, itemId, text, now().toISOString()) };
}

function assistantStreamingEvents(threadId: string, itemId: string, text: string, now: () => Date): Record<string, unknown>[] {
  const createdAt = now().toISOString();
  return [
    {
      type: "thread.item.added",
      item: {
        ...assistantMessageItem(threadId, itemId, "", createdAt),
        content: [],
      },
    },
    {
      type: "thread.item.updated",
      item_id: itemId,
      update: {
        type: "assistant_message.content_part.added",
        content_index: 0,
        content: { type: "output_text", text: "", annotations: [] },
      },
    },
    ...chunkTextForStreaming(text).map((delta) => ({
      type: "thread.item.updated",
      item_id: itemId,
      update: {
        type: "assistant_message.content_part.text_delta",
        content_index: 0,
        delta,
      },
    })),
    {
      type: "thread.item.updated",
      item_id: itemId,
      update: {
        type: "assistant_message.content_part.done",
        content_index: 0,
        content: { type: "output_text", text, annotations: [] },
      },
    },
    assistantDoneEvent(threadId, itemId, text, () => new Date(createdAt)),
  ];
}

function endOfTurnDoneEvent(threadId: string, assistantMessageId: string, now: () => Date): Record<string, unknown> {
  return {
    type: "thread.item.done",
    item: {
      type: "end_of_turn",
      id: `${assistantMessageId}-end`,
      thread_id: threadId,
      created_at: now().toISOString(),
    },
  };
}

function streamOptionsEvent(): Record<string, unknown> {
  return { type: "stream_options", stream_options: { allow_cancel: false } };
}

function clientEffectEvent(name: string, data: Record<string, unknown>): Record<string, unknown> {
  return { type: "client_effect", name, data };
}

function widgetsToDoneEvents(
  threadId: string,
  assistantMessageId: string,
  blocks: AiPresentationBlock[],
  copyText: string,
  now: () => Date,
): Record<string, unknown>[] {
  return widgetsToItems(threadId, assistantMessageId, blocks, copyText, now().toISOString())
    .map((item) => ({ type: "thread.item.done", item }));
}

function widgetsToItems(
  threadId: string,
  assistantMessageId: string,
  blocks: AiPresentationBlock[],
  copyText: string,
  createdAt?: Date | string,
): Record<string, unknown>[] {
  return mapAiPresentationBlocksToChatKitWidgets(blocks).map((widget, index) => ({
    type: "widget",
    id: `${assistantMessageId}-widget-${index + 1}`,
    thread_id: threadId,
    created_at: toIso(createdAt),
    widget,
    copy_text: copyText,
  }));
}

function userMessageItem(
  threadId: string,
  itemId: string,
  text: string,
  createdAt?: Date | string,
): Record<string, unknown> {
  return {
    type: "user_message",
    id: itemId,
    thread_id: threadId,
    created_at: toIso(createdAt),
    content: [{ type: "input_text", text }],
    attachments: [],
    inference_options: {},
  };
}

function assistantMessageItem(
  threadId: string,
  itemId: string,
  text: string,
  createdAt?: Date | string,
): Record<string, unknown> {
  return {
    type: "assistant_message",
    id: itemId,
    thread_id: threadId,
    created_at: toIso(createdAt),
    content: [{ type: "output_text", text, annotations: [] }],
  };
}

async function validatedPageContext(
  context: AiToolContext,
  rawPageContext: unknown,
  toolRegistry?: AiToolRegistry,
): Promise<AiPageContext> {
  const validation = await validateChatKitPageContextForShop(
    context,
    rawPageContext,
    toolRegistry || createAiToolRegistry(),
  );
  return validation.pageContext;
}

function extractUserMessageText(input: z.infer<typeof userMessageInputSchema>): string {
  const message = input.content
    .map((content) => content.type === "input_text" ? content.text : "")
    .filter(Boolean)
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
  if (!message) throw new Error("ChatKit message is required.");
  return truncate(message, MAX_CHATKIT_MESSAGE_LENGTH);
}

function extractBlocks(value: unknown): AiPresentationBlock[] {
  const record = value && typeof value === "object" ? value as { blocks?: unknown } : {};
  return Array.isArray(record.blocks) ? record.blocks as AiPresentationBlock[] : [];
}

function normalizeLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(50, Math.trunc(parsed)));
}

function streamResponse(events: Record<string, unknown>[]): Response {
  if (STREAM_TEXT_DELTA_DELAY_MS > 0 && events.some(isTextDeltaEvent)) {
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({
      async start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          if (isTextDeltaEvent(event)) {
            await delay(STREAM_TEXT_DELTA_DELAY_MS);
          }
        }
        controller.close();
      },
    }), {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/event-stream",
      },
    });
  }

  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/event-stream",
    },
  });
}

function isTextDeltaEvent(event: Record<string, unknown>): boolean {
  const update = event.update && typeof event.update === "object" ? event.update as { type?: unknown } : null;
  return event.type === "thread.item.updated" && update?.type === "assistant_message.content_part.text_delta";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jsonResponse(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function errorEvent(message: string): Record<string, unknown> {
  return {
    type: "error",
    code: "custom",
    message,
    allow_retry: false,
  };
}

function fallbackConversation(context: AiToolContext, conversationId: string, now: () => Date): StoredAiConversation {
  return {
    id: conversationId,
    shop: context.shop,
    userId: context.userId == null ? null : String(context.userId),
    title: "ProductPulse AI assistant",
    createdAt: now().toISOString(),
    updatedAt: now().toISOString(),
  };
}

function parseJson(rawBody: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(rawBody) };
  } catch {
    return { ok: false };
  }
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const text = String(value || "").trim();
  if (!text) return new Date().toISOString();
  return text;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function chunkTextForStreaming(value: string): string[] {
  if (!value) return [];
  const characters = Array.from(value);
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += STREAM_TEXT_CHUNK_SIZE) {
    chunks.push(characters.slice(index, index + STREAM_TEXT_CHUNK_SIZE).join(""));
  }
  return chunks;
}

function stableId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
}
