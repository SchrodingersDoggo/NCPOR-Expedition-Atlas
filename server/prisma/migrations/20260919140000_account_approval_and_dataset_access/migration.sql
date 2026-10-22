-- Account approval workflow (separate from scientific-content approval)
-- and dataset access control. Existing users default to account_status
-- 'active' so nothing already working gets locked out; only new
-- self-registrations are set to 'pending' by the register endpoint.

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('pending', 'active', 'suspended', 'rejected');

ALTER TABLE "users" ADD COLUMN "account_status" "AccountStatus" NOT NULL DEFAULT 'active';
ALTER TABLE "users" ADD COLUMN "approved_by" TEXT;
ALTER TABLE "users" ADD COLUMN "approved_at" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN "title" TEXT;
ALTER TABLE "users" ADD COLUMN "first_name" TEXT;
ALTER TABLE "users" ADD COLUMN "last_name" TEXT;
ALTER TABLE "users" ADD COLUMN "preferred_name" TEXT;
ALTER TABLE "users" ADD COLUMN "designation" TEXT;
ALTER TABLE "users" ADD COLUMN "organisation_website" TEXT;
ALTER TABLE "users" ADD COLUMN "personal_profile_url" TEXT;
ALTER TABLE "users" ADD COLUMN "communication_address" TEXT;
ALTER TABLE "users" ADD COLUMN "alternate_email" TEXT;
ALTER TABLE "users" ADD COLUMN "mobile_number" TEXT;

CREATE INDEX "users_account_status_idx" ON "users"("account_status");
ALTER TABLE "users" ADD CONSTRAINT "users_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "DatasetAccessLevel" AS ENUM ('open', 'registered', 'request_required', 'restricted');

ALTER TABLE "content_items" ADD COLUMN "access_level" "DatasetAccessLevel" NOT NULL DEFAULT 'open';

-- CreateEnum
CREATE TYPE "AccessRequestStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "dataset_access_requests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content_item_id" TEXT NOT NULL,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'pending',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dataset_access_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dataset_access_requests_user_id_content_item_id_key" ON "dataset_access_requests"("user_id", "content_item_id");
CREATE INDEX "dataset_access_requests_status_idx" ON "dataset_access_requests"("status");
CREATE INDEX "dataset_access_requests_content_item_id_idx" ON "dataset_access_requests"("content_item_id");

ALTER TABLE "dataset_access_requests" ADD CONSTRAINT "dataset_access_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dataset_access_requests" ADD CONSTRAINT "dataset_access_requests_content_item_id_fkey" FOREIGN KEY ("content_item_id") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dataset_access_requests" ADD CONSTRAINT "dataset_access_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
