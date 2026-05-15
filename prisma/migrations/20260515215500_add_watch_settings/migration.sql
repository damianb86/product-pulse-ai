CREATE TABLE "ProductWatchSettings" (
  "id" TEXT NOT NULL,
  "shop" TEXT NOT NULL,
  "scanCadenceDays" INTEGER NOT NULL DEFAULT 3,
  "alertRecipients" JSONB,
  "triggerRule" TEXT NOT NULL DEFAULT 'new_or_rising_risk',
  "summarySchedule" TEXT NOT NULL DEFAULT 'daily_digest_8am',
  "alertsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ProductWatchSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductWatchSettings_shop_key" ON "ProductWatchSettings"("shop");
CREATE INDEX "ProductWatchSettings_shop_idx" ON "ProductWatchSettings"("shop");
