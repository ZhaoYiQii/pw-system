-- 算价模型 Task 3（设计规格 §3.3 / §9 第 4-6 条）：报单申报时长 + 截图证据用途。
--
-- expand-only：
-- 1) slot_sessions 增加「申报时长（分钟）」可空列，旧数据与旧计时口径全部保留；
-- 2) slot_evidence.evidence_type 的 CHECK 从 ('START','END') 放宽到含报单用途
--    —— 报单的开始/结束截图复用同一条证据通道，需要新的用途标识；
-- 3) duration_seconds 仅作对照，本版不做「申报 vs 证据」自动比对（智能核验为后续项）。

ALTER TABLE "slot_sessions"
  ADD COLUMN "declared_duration_minutes" INTEGER;

-- 申报时长边界与业务校验一致：15–1440 分钟（允许为空＝尚未报单）。
ALTER TABLE "slot_sessions" ADD CONSTRAINT "slot_sessions_declared_duration_range"
  CHECK (
    "declared_duration_minutes" IS NULL
    OR ("declared_duration_minutes" >= 15 AND "declared_duration_minutes" <= 1440)
  );

-- 证据用途：保留 START/END（系统计时证据），新增报单截图用途。
ALTER TABLE "slot_evidence" DROP CONSTRAINT "slot_evidence_type_check";
ALTER TABLE "slot_evidence" ADD CONSTRAINT "slot_evidence_type_check"
  CHECK ("evidence_type" IN ('START', 'END', 'REPORT_START', 'REPORT_END'));

-- 报单审批与审计：审批人 / 审批时间 / 修正理由（修正后仍保留原始申报值，见 slot_report_audit 事件表约定）。
ALTER TABLE "slot_sessions"
  ADD COLUMN "report_submitted_at" TIMESTAMP(3) WITH TIME ZONE,
  ADD COLUMN "report_reviewed_at" TIMESTAMP(3) WITH TIME ZONE,
  ADD COLUMN "report_reviewed_by" UUID,
  ADD COLUMN "report_review_note" TEXT;
