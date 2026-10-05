-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "user_type" AS ENUM ('COMPANY', 'APPLICANT');

-- CreateEnum
CREATE TYPE "file_type" AS ENUM ('PDF', 'DOCX');

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "job_applicant_status" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'COMPLETED');

-- CreateEnum
CREATE TYPE "evaluation_status" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "resume_ingestion_status" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "user_role" AS ENUM ('ROLE_COMPANY', 'ROLE_APPLICANT');

-- CreateEnum
CREATE TYPE "currency" AS ENUM ('VND', 'USD');

-- CreateTable
CREATE TABLE "job" (
    "id" SERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "requirements" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "status" "job_status" NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "budget" DECIMAL(65,30) NOT NULL,
    "currency" "currency" NOT NULL DEFAULT 'VND',
    "budget_in_base_currency" DECIMAL(65,30) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "posted_by" INTEGER NOT NULL,
    "arrangement_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,

    CONSTRAINT "job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_applicant" (
    "id" SERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "job_id" INTEGER NOT NULL,
    "applicant_id" INTEGER NOT NULL,
    "resume_id" INTEGER NOT NULL,
    "resume_content_id" INTEGER,
    "job_snapshot" JSONB,
    "job_content_hash" VARCHAR(64),
    "cover_letter" TEXT NOT NULL,
    "proposed_rate" DECIMAL(65,30) NOT NULL,
    "estimated_day" INTEGER NOT NULL,
    "status" "job_applicant_status" NOT NULL DEFAULT 'PENDING',
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_applicant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skill" (
    "id" SERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_skill" (
    "job_id" INTEGER NOT NULL,
    "skill_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_skill_pkey" PRIMARY KEY ("job_id","skill_id")
);

-- CreateTable
CREATE TABLE "arrangement" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "arrangement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" SERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applicant_evaluation" (
    "id" SERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "job_applicant_id" INTEGER NOT NULL,
    "resume_content_id" INTEGER,
    "status" "evaluation_status" NOT NULL DEFAULT 'PENDING',
    "overall_score" INTEGER,
    "score_breakdown" JSONB,
    "evidence" JSONB,
    "resume_content_hash" VARCHAR(64) NOT NULL,
    "job_content_hash" VARCHAR(64) NOT NULL,
    "job_snapshot" JSONB,
    "parser_version" TEXT NOT NULL,
    "redacted_resume_text" TEXT,
    "redacted_resume_hash" TEXT,
    "redaction_version" TEXT,
    "model" TEXT NOT NULL,
    "prompt_version" TEXT NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evaluated_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applicant_evaluation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_token" (
    "id" SERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refresh_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume" (
    "id" SERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "storage_path" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_type" "file_type" NOT NULL,
    "file_name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "resume_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_content" (
    "id" SERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "resume_id" INTEGER NOT NULL,
    "status" "resume_ingestion_status" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "storage_path" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_type" "file_type" NOT NULL,
    "file_name" TEXT NOT NULL,
    "extracted_text" TEXT,
    "structured_data" JSONB,
    "content_hash" VARCHAR(64),
    "parser_version" TEXT NOT NULL,
    "redaction_version" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "resume_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" SERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "password_hashed" TEXT NOT NULL,
    "phone_number" TEXT,
    "user_type" "user_type" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "role" "user_role" NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applicant_profile" (
    "id" SERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "description" TEXT,
    "avatar_url" TEXT,
    "portfolio_url" TEXT,
    "location" TEXT,
    "user_id" INTEGER NOT NULL,
    "skills" TEXT NOT NULL,
    "experience_years" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applicant_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_profile" (
    "id" SERIAL NOT NULL,
    "public_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "description" TEXT,
    "avatar_url" TEXT,
    "location" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" INTEGER NOT NULL,

    CONSTRAINT "company_profile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "job_public_id_key" ON "job"("public_id");

-- CreateIndex
CREATE INDEX "job_posted_by_idx" ON "job"("posted_by");

-- CreateIndex
CREATE INDEX "job_arrangement_id_idx" ON "job"("arrangement_id");

-- CreateIndex
CREATE INDEX "job_category_id_idx" ON "job"("category_id");

-- CreateIndex
CREATE INDEX "job_status_idx" ON "job"("status");

-- CreateIndex
CREATE UNIQUE INDEX "job_applicant_public_id_key" ON "job_applicant"("public_id");

-- CreateIndex
CREATE INDEX "job_applicant_job_id_idx" ON "job_applicant"("job_id");

-- CreateIndex
CREATE INDEX "job_applicant_applicant_id_idx" ON "job_applicant"("applicant_id");

-- CreateIndex
CREATE INDEX "job_applicant_resume_id_idx" ON "job_applicant"("resume_id");

-- CreateIndex
CREATE INDEX "job_applicant_resume_content_id_idx" ON "job_applicant"("resume_content_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_applicant_job_id_applicant_id_key" ON "job_applicant"("job_id", "applicant_id");

-- CreateIndex
CREATE UNIQUE INDEX "skill_public_id_key" ON "skill"("public_id");

-- CreateIndex
CREATE INDEX "job_skill_skill_id_idx" ON "job_skill"("skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_public_id_key" ON "category"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "applicant_evaluation_public_id_key" ON "applicant_evaluation"("public_id");

-- CreateIndex
CREATE INDEX "applicant_evaluation_job_applicant_id_status_idx" ON "applicant_evaluation"("job_applicant_id", "status");

-- CreateIndex
CREATE INDEX "applicant_evaluation_status_created_at_idx" ON "applicant_evaluation"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "applicant_evaluation_input_version_key" ON "applicant_evaluation"("job_applicant_id", "resume_content_hash", "job_content_hash", "parser_version", "model", "prompt_version");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_public_id_key" ON "refresh_token"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_token_token_hash_key" ON "refresh_token"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_token_user_id_idx" ON "refresh_token"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "resume_public_id_key" ON "resume"("public_id");

-- CreateIndex
CREATE INDEX "resume_user_id_idx" ON "resume"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "resume_content_public_id_key" ON "resume_content"("public_id");

-- CreateIndex
CREATE INDEX "resume_content_content_hash_idx" ON "resume_content"("content_hash");

-- CreateIndex
CREATE INDEX "resume_content_resume_id_status_idx" ON "resume_content"("resume_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "resume_content_version_key" ON "resume_content"("resume_id", "storage_path", "parser_version");

-- CreateIndex
CREATE UNIQUE INDEX "user_public_id_key" ON "user"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "applicant_profile_public_id_key" ON "applicant_profile"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "applicant_profile_user_id_key" ON "applicant_profile"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_profile_public_id_key" ON "company_profile"("public_id");

-- CreateIndex
CREATE UNIQUE INDEX "company_profile_user_id_key" ON "company_profile"("user_id");

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_posted_by_fkey" FOREIGN KEY ("posted_by") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_arrangement_id_fkey" FOREIGN KEY ("arrangement_id") REFERENCES "arrangement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job" ADD CONSTRAINT "job_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applicant" ADD CONSTRAINT "job_applicant_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applicant" ADD CONSTRAINT "job_applicant_applicant_id_fkey" FOREIGN KEY ("applicant_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applicant" ADD CONSTRAINT "job_applicant_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "resume"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_applicant" ADD CONSTRAINT "job_applicant_resume_content_id_fkey" FOREIGN KEY ("resume_content_id") REFERENCES "resume_content"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_skill" ADD CONSTRAINT "job_skill_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_skill" ADD CONSTRAINT "job_skill_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicant_evaluation" ADD CONSTRAINT "applicant_evaluation_job_applicant_id_fkey" FOREIGN KEY ("job_applicant_id") REFERENCES "job_applicant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicant_evaluation" ADD CONSTRAINT "applicant_evaluation_resume_content_id_fkey" FOREIGN KEY ("resume_content_id") REFERENCES "resume_content"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_token" ADD CONSTRAINT "refresh_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume" ADD CONSTRAINT "resume_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_content" ADD CONSTRAINT "resume_content_resume_id_fkey" FOREIGN KEY ("resume_id") REFERENCES "resume"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applicant_profile" ADD CONSTRAINT "applicant_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_profile" ADD CONSTRAINT "company_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
