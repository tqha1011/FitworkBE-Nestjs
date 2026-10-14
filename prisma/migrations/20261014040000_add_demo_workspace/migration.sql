CREATE TABLE "demo_session" (
  "id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "company_user_id" INTEGER,
  "applicant_user_id" INTEGER,
  "active_user_type" "user_type" NOT NULL DEFAULT 'COMPANY',
  "generation" INTEGER NOT NULL DEFAULT 0,
  "ip_hash" VARCHAR(64) NOT NULL,
  "ai_runs" INTEGER NOT NULL DEFAULT 0,
  "upload_urls" INTEGER NOT NULL DEFAULT 0,
  "cleanup_status" TEXT NOT NULL DEFAULT 'PENDING',
  "cleanup_attempts" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "demo_session_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "demo_session_counters_check" CHECK ("ai_runs" >= 0 AND "upload_urls" >= 0)
);
CREATE UNIQUE INDEX "demo_session_company_user_id_key" ON "demo_session"("company_user_id");
CREATE UNIQUE INDEX "demo_session_applicant_user_id_key" ON "demo_session"("applicant_user_id");
CREATE INDEX "demo_session_expires_at_cleanup_status_idx" ON "demo_session"("expires_at", "cleanup_status");
CREATE INDEX "demo_session_ip_hash_created_at_idx" ON "demo_session"("ip_hash", "created_at");
ALTER TABLE "user" ADD COLUMN "demo_session_id" UUID;
CREATE INDEX "user_demo_session_id_idx" ON "user"("demo_session_id");
ALTER TABLE "user" ADD CONSTRAINT "user_demo_session_id_fkey" FOREIGN KEY ("demo_session_id") REFERENCES "demo_session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "demo_usage" (
  "key" VARCHAR(160) NOT NULL PRIMARY KEY,
  "count" INTEGER NOT NULL DEFAULT 0 CHECK ("count" >= 0),
  "expires_at" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "demo_usage_expires_at_idx" ON "demo_usage"("expires_at");
CREATE TABLE "demo_upload" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "session_id" UUID NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "demo_upload_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "demo_session"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "demo_upload_session_id_idx" ON "demo_upload"("session_id");
ALTER TABLE "applicant_evaluation" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'LIVE';
ALTER TABLE "applicant_evaluation" ADD CONSTRAINT "applicant_evaluation_source_check" CHECK ("source" IN ('LIVE', 'SAMPLE'));
