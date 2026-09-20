-- 算价模型 Task 4（设计规格 §3.5 / §9 第 3 条）：「释放名额」需要两个新的状态取值。
--
-- expand-only：只放宽既有 CHECK 的取值集合，不删除列、不改写历史行
-- （放宽 CHECK 对既有数据恒为真；与 Task 3 放宽 slot_evidence_type_check 同一做法）。
--   order_slots.status:                        SELECTED | CANCELLED | + RELEASED
--   game_dispatch_applications.status:         APPLIED | WITHDRAWN | REJECTED | SELECTED | EXPIRED | + RELEASED

ALTER TABLE "order_slots" DROP CONSTRAINT "order_slots_status_check";
ALTER TABLE "order_slots" ADD CONSTRAINT "order_slots_status_check"
  CHECK ("status" IN ('SELECTED', 'CANCELLED', 'RELEASED'));

ALTER TABLE "game_dispatch_applications" DROP CONSTRAINT "gd_applications_status_check";
ALTER TABLE "game_dispatch_applications" ADD CONSTRAINT "gd_applications_status_check"
  CHECK ("status" IN ('APPLIED', 'WITHDRAWN', 'REJECTED', 'SELECTED', 'EXPIRED', 'RELEASED'));
