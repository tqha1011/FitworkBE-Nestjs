-- Fails if a job already has more than one ACCEPTED/COMPLETED applicant; resolve those rows before deploying.
CREATE UNIQUE INDEX "job_applicant_one_accepted_per_job" ON "job_applicant"("job_id") WHERE (status IN ('ACCEPTED', 'COMPLETED'));
