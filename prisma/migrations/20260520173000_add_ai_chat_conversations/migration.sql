CREATE TABLE "AiConversation" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "userId" TEXT,
  "title" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiConversationMessage" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "structuredContent" JSONB,
  "openAiResponseId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AiConversationMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiConversationToolCall" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "messageId" TEXT,
  "toolName" TEXT NOT NULL,
  "callId" TEXT,
  "validatedInput" JSONB,
  "status" TEXT NOT NULL,
  "durationMs" INTEGER,
  "resultCount" INTEGER,
  "safeError" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AiConversationToolCall_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiConversation_shop_updatedAt_idx" ON "AiConversation"("shop", "updatedAt");
CREATE INDEX "AiConversation_shop_userId_idx" ON "AiConversation"("shop", "userId");
CREATE INDEX "AiConversationMessage_shop_conversationId_createdAt_idx" ON "AiConversationMessage"("shop", "conversationId", "createdAt");
CREATE INDEX "AiConversationMessage_conversationId_createdAt_idx" ON "AiConversationMessage"("conversationId", "createdAt");
CREATE INDEX "AiConversationToolCall_shop_conversationId_createdAt_idx" ON "AiConversationToolCall"("shop", "conversationId", "createdAt");
CREATE INDEX "AiConversationToolCall_conversationId_toolName_idx" ON "AiConversationToolCall"("conversationId", "toolName");
CREATE INDEX "AiConversationToolCall_messageId_idx" ON "AiConversationToolCall"("messageId");

ALTER TABLE "AiConversationMessage"
  ADD CONSTRAINT "AiConversationMessage_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiConversationToolCall"
  ADD CONSTRAINT "AiConversationToolCall_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AiConversationToolCall"
  ADD CONSTRAINT "AiConversationToolCall_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "AiConversationMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
