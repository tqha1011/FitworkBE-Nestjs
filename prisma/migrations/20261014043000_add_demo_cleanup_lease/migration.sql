ALTER TABLE "demo_session" ADD COLUMN "cleanup_lease_until" TIMESTAMP(3), ADD COLUMN "cleanup_owner" UUID;
