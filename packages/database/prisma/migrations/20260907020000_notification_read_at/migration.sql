-- C4：站内通知已读状态（用户维度读取语义）。
ALTER TABLE "notification_deliveries"
  ADD COLUMN "read_at" TIMESTAMP(3) WITH TIME ZONE;
