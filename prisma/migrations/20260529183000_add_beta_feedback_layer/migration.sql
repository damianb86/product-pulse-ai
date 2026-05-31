-- CreateTable
CREATE TABLE "BetaFeedbackReport" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "userKey" TEXT NOT NULL DEFAULT 'shop',
    "userId" TEXT,
    "userEmail" TEXT,
    "userName" TEXT,
    "category" TEXT NOT NULL,
    "severity" TEXT,
    "message" TEXT NOT NULL,
    "pagePath" TEXT,
    "pageRoute" TEXT,
    "panelId" TEXT,
    "panelLabel" TEXT,
    "source" TEXT NOT NULL DEFAULT 'global',
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "context" JSONB,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BetaFeedbackReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BetaFeedbackPanelPreference" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "userKey" TEXT NOT NULL DEFAULT 'shop',
    "userId" TEXT,
    "pageKey" TEXT NOT NULL,
    "panelId" TEXT NOT NULL,
    "panelLabel" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "hideReason" TEXT,
    "hideReasonMessage" TEXT,
    "context" JSONB,
    "firstHiddenAt" TIMESTAMP(3),
    "lastHiddenAt" TIMESTAMP(3),
    "restoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BetaFeedbackPanelPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BetaFeedbackReport_shop_createdAt_idx" ON "BetaFeedbackReport"("shop", "createdAt");

-- CreateIndex
CREATE INDEX "BetaFeedbackReport_shop_status_createdAt_idx" ON "BetaFeedbackReport"("shop", "status", "createdAt");

-- CreateIndex
CREATE INDEX "BetaFeedbackReport_shop_panelId_createdAt_idx" ON "BetaFeedbackReport"("shop", "panelId", "createdAt");

-- CreateIndex
CREATE INDEX "BetaFeedbackReport_shop_userKey_createdAt_idx" ON "BetaFeedbackReport"("shop", "userKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BetaFeedbackPanelPreference_shop_userKey_pageKey_panelId_key" ON "BetaFeedbackPanelPreference"("shop", "userKey", "pageKey", "panelId");

-- CreateIndex
CREATE INDEX "BetaFeedbackPanelPreference_shop_userKey_pageKey_idx" ON "BetaFeedbackPanelPreference"("shop", "userKey", "pageKey");

-- CreateIndex
CREATE INDEX "BetaFeedbackPanelPreference_shop_panelId_idx" ON "BetaFeedbackPanelPreference"("shop", "panelId");
