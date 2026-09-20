-- ADR-0004（2026-09-21 批准）：平台费置 0（公式不变），门店抽成保持原值。
--
-- 1) 新行的默认平台费改为 0；
-- 2) 既有租户补齐/归零：本版口径要求平台费为 0，而 code 兜底只在"没有费率行"时生效，
--    UI/审计需要看到真实费率，因此显式写行（幂等：ON CONFLICT DO UPDATE 只动 platform_fee_bp）。
--    门店抽成取值：已有行保留原 store_cut_bp，缺失行按 2000bp 兜底，与代码一致。

ALTER TABLE "finance_rate_rules" ALTER COLUMN "platform_fee_bp" SET DEFAULT 0;

INSERT INTO "finance_rate_rules" (
  "id", "tenant_id", "platform_fee_bp", "store_cut_bp", "created_at", "updated_at", "version"
)
SELECT gen_random_uuid(), t."id", 0, 2000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1
FROM "tenants" t
ON CONFLICT ("tenant_id") DO UPDATE
  SET "platform_fee_bp" = 0,
      "updated_at" = CURRENT_TIMESTAMP;
