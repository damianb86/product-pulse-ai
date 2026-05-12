ALTER TABLE "ProductPulseSource" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "ProductPulseSource" ADD COLUMN "ignored" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProductPulseSource" ADD COLUMN "available" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProductPulseSource" ADD COLUMN "config" JSONB;
ALTER TABLE "ProductPulseSource" ADD COLUMN "credentials" JSONB;
ALTER TABLE "ProductPulseSource" ADD COLUMN "connectedAt" TIMESTAMP(3);
ALTER TABLE "ProductPulseSource" ADD COLUMN "disabledAt" TIMESTAMP(3);
