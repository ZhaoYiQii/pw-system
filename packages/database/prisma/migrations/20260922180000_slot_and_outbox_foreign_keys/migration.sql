-- 补齐 slot_evidence / slot_sessions 的父子外键，以及 outbox_events.tenant_id 的外键。
--
-- 为什么用「单列外键」而不是 (tenant_id, id) 复合外键：
-- 2026-09-22 实测本项目所有父表都没有 (tenant_id, id) 唯一索引（pg_indexes 一张都没有），
-- 复合外键无法创建。单列外键指向主键 uuid，已足以阻止「父行删除后子行继续悬空」这类孤儿；
-- 同租户一致性仍由 RLS 与应用层保证。将来若要升级为复合外键，需先给父表补唯一约束。
--
-- 这些约束没有同步声明进 schema.prisma（本仓库迁移一直是手写 SQL）：
-- migrate deploy / migrate status 都正常，但从 schema.prisma 反推的 prisma migrate dev
-- 会把它们视作漂移。升级或调整时请一并处理。
--
-- 执行前置（2026-09-22 已在三个库核对）：孤儿行已清零，因此约束可以立即通过验证。

ALTER TABLE "slot_evidence"
  ADD CONSTRAINT "slot_evidence_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "slot_sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "slot_evidence"
  ADD CONSTRAINT "slot_evidence_order_slot_id_fkey"
  FOREIGN KEY ("order_slot_id") REFERENCES "order_slots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "slot_sessions"
  ADD CONSTRAINT "slot_sessions_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "slot_sessions"
  ADD CONSTRAINT "slot_sessions_order_slot_id_fkey"
  FOREIGN KEY ("order_slot_id") REFERENCES "order_slots"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "slot_sessions"
  ADD CONSTRAINT "slot_sessions_player_id_fkey"
  FOREIGN KEY ("player_id") REFERENCES "player_profiles"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
