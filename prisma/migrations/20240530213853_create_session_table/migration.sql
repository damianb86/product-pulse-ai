-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductPulseSource" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "health" TEXT NOT NULL DEFAULT 'not_connected',
    "coverageWeight" INTEGER NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductPulseSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CatalogSignalJob" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogSignalJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductRiskSnapshot" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "impactScore" INTEGER NOT NULL,
    "confidence" INTEGER NOT NULL,
    "primaryIssue" TEXT NOT NULL,
    "sourceCoverage" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductRiskSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductDiagnosis" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "productGid" TEXT NOT NULL,
    "productTitle" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "confidence" INTEGER NOT NULL,
    "likelyCause" TEXT NOT NULL,
    "issues" JSONB NOT NULL,
    "evidence" JSONB NOT NULL,
    "recommendations" JSONB NOT NULL,
    "creditsConsumed" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ProductDiagnosis_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductAction" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "diagnosisId" TEXT,
    "productGid" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "ProductAction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditLedgerEntry" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductPulseSource_shop_sourceKey_key" ON "ProductPulseSource"("shop", "sourceKey");
CREATE INDEX "ProductPulseSource_shop_idx" ON "ProductPulseSource"("shop");
CREATE INDEX "CatalogSignalJob_shop_status_idx" ON "CatalogSignalJob"("shop", "status");
CREATE UNIQUE INDEX "ProductRiskSnapshot_shop_productGid_key" ON "ProductRiskSnapshot"("shop", "productGid");
CREATE INDEX "ProductRiskSnapshot_shop_riskScore_idx" ON "ProductRiskSnapshot"("shop", "riskScore");
CREATE INDEX "ProductDiagnosis_shop_status_idx" ON "ProductDiagnosis"("shop", "status");
CREATE INDEX "ProductDiagnosis_shop_productGid_idx" ON "ProductDiagnosis"("shop", "productGid");
CREATE INDEX "ProductAction_shop_status_idx" ON "ProductAction"("shop", "status");
CREATE INDEX "ProductAction_shop_productGid_idx" ON "ProductAction"("shop", "productGid");
CREATE INDEX "CreditLedgerEntry_shop_createdAt_idx" ON "CreditLedgerEntry"("shop", "createdAt");

ALTER TABLE "ProductAction" ADD CONSTRAINT "ProductAction_diagnosisId_fkey" FOREIGN KEY ("diagnosisId") REFERENCES "ProductDiagnosis"("id") ON DELETE SET NULL ON UPDATE CASCADE;
