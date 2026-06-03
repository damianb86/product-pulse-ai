CREATE TABLE "BillingSubscriptionState" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "subscriptionId" TEXT,
  "planKey" TEXT NOT NULL DEFAULT 'free',
  "planName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'free',
  "currentPeriodStart" TIMESTAMP(3),
  "currentPeriodEnd" TIMESTAMP(3),
  "accessEndsAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3),
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BillingSubscriptionState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BillingSubscriptionState_shop_key" ON "BillingSubscriptionState"("shop");
CREATE INDEX "BillingSubscriptionState_subscriptionId_idx" ON "BillingSubscriptionState"("subscriptionId");
CREATE INDEX "BillingSubscriptionState_shop_status_idx" ON "BillingSubscriptionState"("shop", "status");
