-- Communities (Reddit-style) update.
-- Purely additive: extends the existing community_* tables (so every
-- existing circle, membership, post, comment and like is preserved), adds
-- vote tables, notifications, and optional public contact fields on users.

-- Users: public contact links + privacy toggles
ALTER TABLE "users"
  ADD COLUMN "linkedin_url" TEXT,
  ADD COLUMN "twitter_url" TEXT,
  ADD COLUMN "researchgate_url" TEXT,
  ADD COLUMN "orcid_id" TEXT,
  ADD COLUMN "github_url" TEXT,
  ADD COLUMN "bio" TEXT,
  ADD COLUMN "show_email" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "show_mobile" BOOLEAN NOT NULL DEFAULT false;

-- Communities: type, rules, colours, creator
ALTER TABLE "community_circles"
  ADD COLUMN "type" TEXT NOT NULL DEFAULT 'public',
  ADD COLUMN "rules" JSONB,
  ADD COLUMN "icon_color" TEXT,
  ADD COLUMN "banner_color" TEXT,
  ADD COLUMN "created_by" TEXT;

-- Memberships: moderator role, join-request status, favourites
ALTER TABLE "community_memberships"
  ADD COLUMN "role" TEXT NOT NULL DEFAULT 'member',
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN "favorite" BOOLEAN NOT NULL DEFAULT false;

-- Posts: post type, link, media, score
ALTER TABLE "community_posts"
  ADD COLUMN "post_type" TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN "link_url" TEXT,
  ADD COLUMN "media" JSONB,
  ADD COLUMN "score" INTEGER NOT NULL DEFAULT 0;

-- Comments: threading, score, soft delete
ALTER TABLE "community_comments"
  ADD COLUMN "parent_id" TEXT,
  ADD COLUMN "score" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deleted" BOOLEAN NOT NULL DEFAULT false;

-- Votes
CREATE TABLE "community_post_votes" (
  "post_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "value" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "community_post_votes_pkey" PRIMARY KEY ("post_id","user_id")
);

CREATE TABLE "community_comment_votes" (
  "comment_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "value" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "community_comment_votes_pkey" PRIMARY KEY ("comment_id","user_id")
);

-- Notifications
CREATE TABLE "notifications" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "actor_id" TEXT,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "link" TEXT,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE INDEX "community_memberships_user_id_status_idx" ON "community_memberships"("user_id", "status");
CREATE INDEX "community_posts_post_type_created_at_idx" ON "community_posts"("post_type", "created_at");
CREATE INDEX "community_posts_score_idx" ON "community_posts"("score");
CREATE INDEX "community_comments_parent_id_idx" ON "community_comments"("parent_id");
CREATE INDEX "community_post_votes_user_id_idx" ON "community_post_votes"("user_id");
CREATE INDEX "community_comment_votes_user_id_idx" ON "community_comment_votes"("user_id");
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications"("user_id", "created_at");

-- Foreign keys
ALTER TABLE "community_circles" ADD CONSTRAINT "community_circles_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "community_comments" ADD CONSTRAINT "community_comments_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "community_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_post_votes" ADD CONSTRAINT "community_post_votes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "community_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_post_votes" ADD CONSTRAINT "community_post_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_comment_votes" ADD CONSTRAINT "community_comment_votes_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "community_comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "community_comment_votes" ADD CONSTRAINT "community_comment_votes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Data carry-over: every existing like becomes an upvote, and each post's
-- score starts at its like count, so existing posts keep their standing.
INSERT INTO "community_post_votes" ("post_id", "user_id", "value", "created_at")
SELECT "post_id", "user_id", 1, "created_at" FROM "community_post_likes"
ON CONFLICT DO NOTHING;

UPDATE "community_posts" p
SET "score" = sub.cnt
FROM (SELECT "post_id", COUNT(*)::int AS cnt FROM "community_post_likes" GROUP BY "post_id") sub
WHERE sub."post_id" = p."id";
