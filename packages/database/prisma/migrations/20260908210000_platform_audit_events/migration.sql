-- P-B2a：平台级审计事件（全局平台操作不绑定租户，无法写入 tenant_id 非空的 audit_logs）
CREATE TABLE "platform_audit_events" (
    "id" UUID NOT NULL,
    "actor_platform_account_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "platform_audit_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_audit_events_actor_created_idx"
    ON "platform_audit_events"("actor_platform_account_id", "created_at");

ALTER TABLE "platform_audit_events"
    ADD CONSTRAINT "platform_audit_events_actor_fkey"
    FOREIGN KEY ("actor_platform_account_id") REFERENCES "platform_accounts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 平台级表：运行时租户角色无权访问
REVOKE ALL ON TABLE "platform_audit_events" FROM pw_runtime;
