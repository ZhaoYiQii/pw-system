-- DS-011：对账处理单（ReconciliationCase）的租户隔离持久化底座
--
-- 口径（沿用 S3.5 之后的 RLS 语义，与 20260924100000_wechatpay_partner 同构）：
--   * 租户级表：ENABLE ROW LEVEL SECURITY + 两条策略，但**不 FORCE**（表 owner 全量、非 owner 受策略约束）；
--   * 状态字符串与领域状态机 DS-010 逐字符一致（OPEN/CLAIMED/PROCESSING/PENDING_REVIEW/CLOSED/IGNORED）；
--   * 本迁移只建结构：不写数据、不做 UPDATE/DELETE、不建触发器或函数、不新增审计行，
--     也不触碰 reconciliation_differences.resolved_at（由后续切片在事务内同步）。

-- 1) 前向修复已应用的基础迁移
--    20260924040000_business_funds_foundation 给 fund_accounts 补 RLS 时一并加了 FORCE ROW LEVEL SECURITY，
--    与 S3.5（20260923150000_rls_owner_semantics）确立的「表 owner 全量权限、非 owner 受策略约束」语义冲突：
--    FORCE 会让表 owner 也受策略约束，而策略只授予 pw / pw_runtime，导致 owner 连接读自己的表静默返回 0 行。
--    基础迁移已应用且有校验和保护，因此绝不回改原迁移，只在这里前向修复。
ALTER TABLE "fund_accounts" NO FORCE ROW LEVEL SECURITY;

-- 2) 状态枚举：六个值及顺序与 DS-010 完全一致（数据库只约束取值集合，合法转移由领域函数与服务层事务校验）
CREATE TYPE "ReconciliationCaseStatus" AS ENUM ('OPEN', 'CLAIMED', 'PROCESSING', 'PENDING_REVIEW', 'CLOSED', 'IGNORED');

-- 3) 处理单：一条对账差异最多一张处理单（difference_id 单列唯一，同时满足 Prisma 1:1 关系对定义侧外键的要求）
--    owner_id / reviewed_by 只存 UUID 操作者标识，故意不加 TenantAccount 外键：与既有 actor/audit 字段同口径，
--    避免账号变动时牵动资金侧历史；resolution_type 本切片保持可空 TEXT，不预设枚举或取值约束。
CREATE TABLE "reconciliation_cases" (
  "id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "difference_id" UUID NOT NULL,
  "status" "ReconciliationCaseStatus" NOT NULL DEFAULT 'OPEN',
  "owner_id" UUID,
  "resolution_type" TEXT,
  "resolution_note" TEXT,
  "linked_transaction_id" UUID,
  "reviewed_by" UUID,
  "reviewed_at" TIMESTAMPTZ,
  "closed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "reconciliation_cases_pkey" PRIMARY KEY ("id")
);

-- 4) 唯一约束与索引（命名与 Prisma 模型逐条对应；difference_id 已由唯一索引覆盖，不再另建普通索引）
CREATE UNIQUE INDEX "reconciliation_cases_difference_id_key"
  ON "reconciliation_cases"("difference_id");
CREATE INDEX "reconciliation_cases_linked_transaction_id_idx"
  ON "reconciliation_cases"("linked_transaction_id");
CREATE INDEX "reconciliation_cases_tenant_id_status_created_at_idx"
  ON "reconciliation_cases"("tenant_id", "status", "created_at");
CREATE INDEX "reconciliation_cases_tenant_id_owner_id_status_idx"
  ON "reconciliation_cases"("tenant_id", "owner_id", "status");

-- 5) 外键：父资源与关联交易一律 RESTRICT，禁止删除差异或账本交易时连带抹掉处理单
ALTER TABLE "reconciliation_cases"
  ADD CONSTRAINT "reconciliation_cases_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reconciliation_cases"
  ADD CONSTRAINT "reconciliation_cases_difference_id_fkey"
  FOREIGN KEY ("difference_id") REFERENCES "reconciliation_differences"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reconciliation_cases"
  ADD CONSTRAINT "reconciliation_cases_linked_transaction_id_fkey"
  FOREIGN KEY ("linked_transaction_id") REFERENCES "ledger_transactions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 6) 租户隔离：只 ENABLE，不 FORCE（表 owner 保留仓库既定全量语义）
ALTER TABLE "reconciliation_cases" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_platform ON "reconciliation_cases"
    FOR ALL TO pw USING (true) WITH CHECK (true);
CREATE POLICY tenant_isolation_runtime ON "reconciliation_cases"
    FOR ALL TO pw_runtime
    USING (tenant_id::text = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "reconciliation_cases" TO pw_runtime;
