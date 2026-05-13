ALTER TABLE "CatalogSignalJob" ADD COLUMN "payload" JSONB;

CREATE INDEX "CatalogSignalJob_shop_kind_status_idx" ON "CatalogSignalJob"("shop", "kind", "status");

CREATE TABLE "ProductPulseAiProviderState" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "currentModel" TEXT NOT NULL,
    "lastPrimaryRetryAt" TIMESTAMP(3),
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPulseAiProviderState_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductPulseAiProviderState_provider_key" ON "ProductPulseAiProviderState"("provider");
