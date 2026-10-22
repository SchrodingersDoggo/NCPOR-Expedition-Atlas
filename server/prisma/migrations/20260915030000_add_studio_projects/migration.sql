CREATE TABLE "studio_projects" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "notes" TEXT,
  "source_videos" JSONB NOT NULL,
  "source_data" JSONB,
  "edit_plan" JSONB,
  "caption" TEXT,
  "ai_summary" TEXT,
  "voiceover_script" TEXT,
  "voiceover_url" TEXT,
  "render_id" TEXT,
  "render_status" TEXT,
  "reel_url" TEXT,
  "thumbnail_url" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "error_message" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "studio_projects_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "studio_projects_created_by_updated_at_idx" ON "studio_projects"("created_by", "updated_at");
ALTER TABLE "studio_projects" ADD CONSTRAINT "studio_projects_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
