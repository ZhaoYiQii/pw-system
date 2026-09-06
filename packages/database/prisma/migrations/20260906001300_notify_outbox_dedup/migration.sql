ALTER TABLE "notification_deliveries" ADD COLUMN "outbox_event_id" UUID;
CREATE UNIQUE INDEX "notification_deliveries_outbox_event_id_key" ON "notification_deliveries"("outbox_event_id");