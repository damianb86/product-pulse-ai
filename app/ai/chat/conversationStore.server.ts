import { Prisma, type PrismaClient } from "@prisma/client";
import prisma from "../../db.server";
import type { AiToolContext, AiToolSafeError } from "../domain/types";
import type { AiAssistantResponse } from "./responseSchema";

type AiConversationDbClient = Pick<
  PrismaClient,
  "aiConversation" | "aiConversationMessage" | "aiConversationToolCall"
>;

export type AiConversationRole = "user" | "assistant" | "system" | "tool";

export interface StoredAiConversation {
  id: string;
  shop: string;
  userId: string | null;
  title: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

export interface StoredAiConversationMessage {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  structuredContent?: unknown;
  openAiResponseId?: string | null;
  createdAt?: Date | string;
}

export interface AiToolCallRecordInput {
  context: AiToolContext;
  conversationId: string;
  messageId?: string | null;
  toolName: string;
  callId?: string | null;
  validatedInput?: unknown;
  status: "started" | "success" | "error" | "blocked";
  durationMs?: number;
  resultCount?: number;
  safeError?: AiToolSafeError;
}

export interface AiConversationStore {
  getOrCreateConversation(
    context: AiToolContext,
    input: { conversationId?: string | null; titleSeed?: string; metadata?: unknown },
  ): Promise<StoredAiConversation>;
  addMessage(input: {
    context: AiToolContext;
    conversationId: string;
    role: AiConversationRole;
    content: string;
    structuredContent?: unknown;
    openAiResponseId?: string | null;
  }): Promise<StoredAiConversationMessage>;
  listRecentMessages(context: AiToolContext, conversationId: string, limit: number): Promise<StoredAiConversationMessage[]>;
  recordToolCall(input: AiToolCallRecordInput): Promise<void>;
  touchConversation(context: AiToolContext, conversationId: string): Promise<void>;
}

export class PrismaAiConversationStore implements AiConversationStore {
  private db: AiConversationDbClient;

  constructor(db: AiConversationDbClient = prisma as unknown as AiConversationDbClient) {
    this.db = db;
  }

  async getOrCreateConversation(
    context: AiToolContext,
    input: { conversationId?: string | null; titleSeed?: string; metadata?: unknown },
  ): Promise<StoredAiConversation> {
    const conversationId = String(input.conversationId || "").trim();
    if (conversationId) {
      const existing = await this.db.aiConversation.findFirst({
        where: { id: conversationId, shop: context.shop },
      });
      if (existing) return mapConversation(existing);
    }

    const created = await this.db.aiConversation.create({
      data: {
        shop: context.shop,
        userId: optionalString(context.userId),
        title: buildConversationTitle(input.titleSeed),
        metadata: toPrismaJson(input.metadata),
      },
    });
    return mapConversation(created);
  }

  async addMessage(input: {
    context: AiToolContext;
    conversationId: string;
    role: AiConversationRole;
    content: string;
    structuredContent?: unknown;
    openAiResponseId?: string | null;
  }): Promise<StoredAiConversationMessage> {
    const created = await this.db.aiConversationMessage.create({
      data: {
        shop: input.context.shop,
        conversationId: input.conversationId,
        role: input.role,
        content: truncate(input.content, 12000),
        structuredContent: toPrismaJson(input.structuredContent),
        openAiResponseId: optionalString(input.openAiResponseId),
      },
    });
    await this.touchConversation(input.context, input.conversationId);
    return mapMessage(created);
  }

  async listRecentMessages(
    context: AiToolContext,
    conversationId: string,
    limit: number,
  ): Promise<StoredAiConversationMessage[]> {
    const rows = await this.db.aiConversationMessage.findMany({
      where: { shop: context.shop, conversationId },
      orderBy: { createdAt: "desc" },
      take: Math.max(0, Math.min(24, limit)),
    });
    return rows.map(mapMessage).reverse();
  }

  async recordToolCall(input: AiToolCallRecordInput): Promise<void> {
    await this.db.aiConversationToolCall.create({
      data: {
        shop: input.context.shop,
        conversationId: input.conversationId,
        messageId: optionalString(input.messageId),
        toolName: input.toolName,
        callId: optionalString(input.callId),
        validatedInput: toPrismaJson(input.validatedInput),
        status: input.status,
        durationMs: typeof input.durationMs === "number" ? Math.round(input.durationMs) : null,
        resultCount: typeof input.resultCount === "number" ? Math.round(input.resultCount) : null,
        safeError: toPrismaJson(input.safeError),
      },
    });
  }

  async touchConversation(context: AiToolContext, conversationId: string): Promise<void> {
    await this.db.aiConversation.updateMany({
      where: { id: conversationId, shop: context.shop },
      data: { updatedAt: new Date() },
    });
  }
}

export function buildStructuredMessageContent(response: AiAssistantResponse): string {
  return response.assistantText;
}

function mapConversation(row: Record<string, unknown>): StoredAiConversation {
  return {
    id: String(row.id || ""),
    shop: String(row.shop || ""),
    userId: optionalString(row.userId) || null,
    title: optionalString(row.title) || null,
    createdAt: row.createdAt as Date | string | undefined,
    updatedAt: row.updatedAt as Date | string | undefined,
  };
}

function mapMessage(row: Record<string, unknown>): StoredAiConversationMessage {
  return {
    id: String(row.id || ""),
    conversationId: String(row.conversationId || ""),
    role: String(row.role || ""),
    content: String(row.content || ""),
    structuredContent: row.structuredContent,
    openAiResponseId: optionalString(row.openAiResponseId),
    createdAt: row.createdAt as Date | string | undefined,
  };
}

function buildConversationTitle(seed: unknown): string {
  const normalized = String(seed || "ProductPulse AI chat").replace(/\s+/g, " ").trim();
  return truncate(normalized || "ProductPulse AI chat", 80);
}

function optionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function truncate(value: unknown, maxLength: number): string {
  const normalized = String(value || "").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
