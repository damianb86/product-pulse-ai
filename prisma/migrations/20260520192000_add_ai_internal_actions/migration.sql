-- CreateTable
CREATE TABLE "AiActionProposal" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "userId" TEXT,
    "conversationId" TEXT,
    "actionName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetLabel" TEXT,
    "proposedInput" JSONB NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "reason" TEXT,
    "expectedResult" TEXT,
    "risks" JSONB,
    "confirmationLevel" TEXT NOT NULL,
    "sideEffectLevel" TEXT NOT NULL,
    "reversible" BOOLEAN NOT NULL DEFAULT false,
    "requiresEntityOwnershipCheck" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "result" JSONB,
    "safeError" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),

    CONSTRAINT "AiActionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiActionAuditLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "userId" TEXT,
    "conversationId" TEXT,
    "proposalId" TEXT,
    "actionName" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "eventType" TEXT NOT NULL,
    "validatedInput" JSONB,
    "status" TEXT NOT NULL,
    "durationMs" INTEGER,
    "safeSummary" TEXT,
    "safeError" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiActionAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiActionProposal_shop_status_expiresAt_idx" ON "AiActionProposal"("shop", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "AiActionProposal_shop_conversationId_createdAt_idx" ON "AiActionProposal"("shop", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiActionProposal_shop_actionName_createdAt_idx" ON "AiActionProposal"("shop", "actionName", "createdAt");

-- CreateIndex
CREATE INDEX "AiActionProposal_shop_targetType_targetId_idx" ON "AiActionProposal"("shop", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "AiActionAuditLog_shop_createdAt_idx" ON "AiActionAuditLog"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "AiActionAuditLog_shop_proposalId_createdAt_idx" ON "AiActionAuditLog"("shop", "proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "AiActionAuditLog_shop_actionName_createdAt_idx" ON "AiActionAuditLog"("shop", "actionName", "createdAt");

-- CreateIndex
CREATE INDEX "AiActionAuditLog_proposalId_idx" ON "AiActionAuditLog"("proposalId");

-- AddForeignKey
ALTER TABLE "AiActionAuditLog" ADD CONSTRAINT "AiActionAuditLog_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "AiActionProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
