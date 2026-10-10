-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateIndex
CREATE INDEX "job_status_createdAt_dueAt_index" ON "job"("status", "created_at" DESC, "due_at" DESC);

-- CreateIndex
CREATE INDEX "job_title_trgm_idx" ON "job" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "job_applicant_status_idx" ON "job_applicant"("status");
