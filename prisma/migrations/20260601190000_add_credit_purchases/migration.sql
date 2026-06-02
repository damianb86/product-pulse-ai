CREATE TABLE "CreditPurchase" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "packageId" TEXT NOT NULL,
  "credits" INTEGER NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'USD',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "shopifyPurchaseId" TEXT,
  "confirmationUrl" TEXT,
  "billingName" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CreditPurchase_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CreditPurchase_shopifyPurchaseId_key" ON "CreditPurchase"("shopifyPurchaseId");
CREATE INDEX "CreditPurchase_shop_status_idx" ON "CreditPurchase"("shop", "status");
CREATE INDEX "CreditPurchase_shop_createdAt_idx" ON "CreditPurchase"("shop", "createdAt");
