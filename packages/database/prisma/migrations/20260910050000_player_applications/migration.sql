CREATE TABLE "player_applications" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "customer_profile_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "intro" TEXT,
    "review_note" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "player_applications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "player_applications_tenant_status_time_idx"
    ON "player_applications"("tenant_id", "status", "created_at");

ALTER TABLE "player_applications"
    ADD CONSTRAINT "player_applications_tenant_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
