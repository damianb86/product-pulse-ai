ALTER TABLE "CreditLedgerEntry" ADD COLUMN "idempotencyKey" TEXT;

WITH ranked_idempotency_keys AS (
  SELECT
    "id",
    NULLIF("metadata"->>'idempotencyKey', '') AS "idempotencyKey",
    ROW_NUMBER() OVER (
      PARTITION BY "shop", NULLIF("metadata"->>'idempotencyKey', '')
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS "rank"
  FROM "CreditLedgerEntry"
  WHERE "metadata" ? 'idempotencyKey'
    AND NULLIF("metadata"->>'idempotencyKey', '') IS NOT NULL
)
UPDATE "CreditLedgerEntry"
SET "idempotencyKey" = ranked_idempotency_keys."idempotencyKey"
FROM ranked_idempotency_keys
WHERE "CreditLedgerEntry"."id" = ranked_idempotency_keys."id"
  AND ranked_idempotency_keys."rank" = 1;

CREATE UNIQUE INDEX "CreditLedgerEntry_shop_idempotencyKey_key"
  ON "CreditLedgerEntry"("shop", "idempotencyKey");
