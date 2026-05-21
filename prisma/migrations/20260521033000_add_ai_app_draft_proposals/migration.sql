-- CreateTable
CREATE TABLE "AiAppDraftProposal" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "userId" TEXT,
    "conversationId" TEXT,
    "mutationName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetLabel" TEXT,
    "draftType" TEXT NOT NULL,
    "sourceContext" JSONB,
    "currentAppValueSnapshot" JSONB,
    "proposedValue" JSONB NOT NULL,
    "userEditedValue" JSONB,
    "finalDraftValue" JSONB,
    "generatedReason" TEXT,
    "evidenceReferences" JSONB,
    "validationWarnings" JSONB,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "editableFields" JSONB,
    "proposedInput" JSONB NOT NULL,
    "confirmationLevel" TEXT NOT NULL,
    "sideEffectLevel" TEXT NOT NULL,
    "reversible" BOOLEAN NOT NULL DEFAULT true,
    "allowedFields" JSONB,
    "blockedFields" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "safeError" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "savedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),

    CONSTRAINT "AiAppDraftProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAppDraftAuditLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "userId" TEXT,
    "conversationId" TEXT,
    "proposalId" TEXT,
    "mutationName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "eventType" TEXT NOT NULL,
    "validatedInput" JSONB,
    "status" TEXT NOT NULL,
    "durationMs" INTEGER,
    "safeSummary" TEXT,
    "safeError" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAppDraftAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiAppDraftProposal_shop_status_expiresAt_idx" ON "AiAppDraftProposal"("shop", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "AiAppDraftProposal_shop_conversationId_createdAt_idx" ON "AiAppDraftProposal"("shop", "conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiAppDraftProposal_shop_mutationName_createdAt_idx" ON "AiAppDraftProposal"("shop", "mutationName", "createdAt");

-- CreateIndex
CREATE INDEX "AiAppDraftProposal_shop_targetType_targetId_idx" ON "AiAppDraftProposal"("shop", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "AiAppDraftAuditLog_shop_createdAt_idx" ON "AiAppDraftAuditLog"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "AiAppDraftAuditLog_shop_proposalId_createdAt_idx" ON "AiAppDraftAuditLog"("shop", "proposalId", "createdAt");

-- CreateIndex
CREATE INDEX "AiAppDraftAuditLog_shop_mutationName_createdAt_idx" ON "AiAppDraftAuditLog"("shop", "mutationName", "createdAt");

-- CreateIndex
CREATE INDEX "AiAppDraftAuditLog_proposalId_idx" ON "AiAppDraftAuditLog"("proposalId");

-- AddForeignKey
ALTER TABLE "AiAppDraftAuditLog" ADD CONSTRAINT "AiAppDraftAuditLog_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "AiAppDraftProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
