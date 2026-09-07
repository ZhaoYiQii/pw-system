-- Stage R6（A 方案）：结算批次同时支持老板钱包档位收入（slot_earnings）。
ALTER TABLE "settlement_items" ALTER COLUMN "earning_id" DROP NOT NULL;

ALTER TABLE "settlement_items" ADD COLUMN "slot_earning_id" UUID;
ALTER TABLE "settlement_items" ADD COLUMN "source_type" TEXT NOT NULL DEFAULT 'LEGACY';

ALTER TABLE "settlement_items"
  ADD CONSTRAINT "si_slot_earning_fkey"
  FOREIGN KEY ("slot_earning_id") REFERENCES "slot_earnings"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "settlement_items"
  ADD CONSTRAINT "si_source_check"
  CHECK (
    ("source_type" = 'LEGACY' AND "earning_id" IS NOT NULL AND "slot_earning_id" IS NULL)
    OR ("source_type" = 'SLOT' AND "earning_id" IS NULL AND "slot_earning_id" IS NOT NULL)
  );

CREATE UNIQUE INDEX "settlement_items_tenant_id_batch_id_slot_earning_id_key"
  ON "settlement_items"("tenant_id","batch_id","slot_earning_id");
CREATE UNIQUE INDEX "settlement_items_tenant_id_slot_earning_id_key"
  ON "settlement_items"("tenant_id","slot_earning_id");
