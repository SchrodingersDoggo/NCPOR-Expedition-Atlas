-- Activities + Community module (merged from a parallel branch of this
-- project). Purely additive: five new tables plus five new optional/
-- defaulted columns on the existing "activities" table — nothing here
-- touches any table introduced by the dataset-metadata/account-approval
-- work already migrated ahead of this one.

-- Institutional-activity fields
ALTER TABLE "activities"
  ADD COLUMN "location" TEXT,
  ADD COLUMN "start_time" TIMESTAMP(3),
  ADD COLUMN "end_time" TIMESTAMP(3),
  ADD COLUMN "organizer" TEXT,
  ADD COLUMN "activity_type" TEXT NOT NULL DEFAULT 'institutional_event';

CREATE INDEX "activities_activity_date_idx" ON "activities"("activity_date");
CREATE INDEX "activities_status_idx" ON "activities"("status");

-- Field observations
CREATE TABLE "polar_observations" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "observation_type" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "region" "Region",
  "latitude" DECIMAL(9,6),
  "longitude" DECIMAL(9,6),
  "observed_at" TIMESTAMP(3) NOT NULL,
  "confidence" TEXT NOT NULL DEFAULT 'unverified',
  "status" TEXT NOT NULL DEFAULT 'submitted',
  "evidence_url" TEXT,
  "expedition_id" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "polar_observations_pkey" PRIMARY KEY ("id")
);

-- Community circles, membership, posts, comments, likes
CREATE TABLE "community_circles" (
  "id" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "community_circles_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "community_memberships" (
  "user_id" TEXT NOT NULL,
  "circle_id" TEXT NOT NULL,
  "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "community_memberships_pkey" PRIMARY KEY ("user_id","circle_id")
);

CREATE TABLE "community_posts" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "tags" JSONB,
  "status" TEXT NOT NULL DEFAULT 'published',
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "created_by" TEXT NOT NULL,
  "circle_id" TEXT,
  "expedition_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "community_posts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "community_comments" (
  "id" TEXT NOT NULL,
  "post_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "community_comments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "community_post_likes" (
  "post_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "community_post_likes_pkey" PRIMARY KEY ("post_id","user_id")
);

CREATE UNIQUE INDEX "community_circles_slug_key" ON "community_circles"("slug");
CREATE INDEX "polar_observations_created_at_idx" ON "polar_observations"("created_at");
CREATE INDEX "polar_observations_status_idx" ON "polar_observations"("status");
CREATE INDEX "polar_observations_region_idx" ON "polar_observations"("region");
CREATE INDEX "polar_observations_expedition_id_idx" ON "polar_observations"("expedition_id");
CREATE INDEX "community_memberships_circle_id_idx" ON "community_memberships"("circle_id");
CREATE INDEX "community_posts_created_at_idx" ON "community_posts"("created_at");
CREATE INDEX "community_posts_circle_id_idx" ON "community_posts"("circle_id");
CREATE INDEX "community_posts_expedition_id_idx" ON "community_posts"("expedition_id");
CREATE INDEX "community_comments_post_id_created_at_idx" ON "community_comments"("post_id","created_at");
CREATE INDEX "community_post_likes_user_id_idx" ON "community_post_likes"("user_id");

ALTER TABLE "polar_observations" ADD CONSTRAINT "polar_observations_expedition_id_fkey" FOREIGN KEY ("expedition_id") REFERENCES "expeditions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "polar_observations" ADD CONSTRAINT "polar_observations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_memberships" ADD CONSTRAINT "community_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_memberships" ADD CONSTRAINT "community_memberships_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "community_circles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_circle_id_fkey" FOREIGN KEY ("circle_id") REFERENCES "community_circles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_expedition_id_fkey" FOREIGN KEY ("expedition_id") REFERENCES "expeditions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_post_likes" ADD CONSTRAINT "community_post_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_post_likes" ADD CONSTRAINT "community_post_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
