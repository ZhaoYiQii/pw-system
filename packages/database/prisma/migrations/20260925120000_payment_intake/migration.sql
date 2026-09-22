-- S4-5：门店支付进件与开户意愿确认（平台侧状态机留痕）
--
-- 口径来源（2026-09-23 从 partner/llms.txt 索引取 .md 原文核对）：
--   * 提交申请单 POST /v3/applyment4sub/applyment/ → 返回 applyment_id（partner/4012719997）
--   * 查询申请单 GET /v3/applyment4sub/applyment/applyment_id/{id}
--     → sub_mchid（仅三种状态返回）/ sign_url（超级管理员签约链接）/ applyment_state（8 种）
--       / applyment_state_msg / audit_detail（仅驳回时返回）（partner/4012697052）
--   * 查询开户意愿确认 GET /v3/apply4subject/applyment/merchants/{sub_mchid}/state
--     → authorize_state（AUTHORIZE_STATE_UNAUTHORIZED / AUTHORIZED）（partner/4012467549）
--
-- 设计取舍：
--   * 不新增表：这些都是"门店支付账户"这一行上的状态，与其同生命周期；
--   * business_code 由服务商自定义、同服务商下唯一，且**被驳回后用同一编号重提即覆盖原申请单**
--     （官方原文），因此必须唯一索引，避免同一门店产生两张申请单；
--   * authorize_state 必须落库：开户意愿确认是"能不能收款"的判据之一，
--     只在查询那一刻存在会让我们无法解释"为什么这个店还收不了钱"。

ALTER TABLE "tenant_payment_accounts"
    ADD COLUMN "business_code" TEXT,
    ADD COLUMN "provider_state" TEXT,
    ADD COLUMN "provider_state_msg" TEXT,
    ADD COLUMN "authorize_state" TEXT,
    ADD COLUMN "reject_detail" JSONB,
    ADD COLUMN "sign_url" TEXT,
    ADD COLUMN "submitted_at" TIMESTAMPTZ(3);

CREATE UNIQUE INDEX "tenant_payment_accounts_business_code_key"
    ON "tenant_payment_accounts"("business_code");
