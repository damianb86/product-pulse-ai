CREATE TABLE "AiUsageEvent" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "userId" TEXT,
  "source" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "task" TEXT,
  "requestContext" TEXT,
  "conversationId" TEXT,
  "messageId" TEXT,
  "jobId" TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'success',
  "usage" JSONB,
  "inputTokens" INTEGER,
  "outputTokens" INTEGER,
  "cachedInputTokens" INTEGER,
  "reasoningTokens" INTEGER,
  "totalTokens" INTEGER,
  "estimatedCost" JSONB,
  "estimatedTotalUsd" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AiUsageEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiUsageEvent_shop_createdAt_idx" ON "AiUsageEvent"("shop", "createdAt");
CREATE INDEX "AiUsageEvent_shop_source_createdAt_idx" ON "AiUsageEvent"("shop", "source", "createdAt");
CREATE INDEX "AiUsageEvent_shop_provider_model_idx" ON "AiUsageEvent"("shop", "provider", "model");
CREATE INDEX "AiUsageEvent_shop_conversationId_createdAt_idx" ON "AiUsageEvent"("shop", "conversationId", "createdAt");
CREATE INDEX "AiUsageEvent_shop_jobId_createdAt_idx" ON "AiUsageEvent"("shop", "jobId", "createdAt");
