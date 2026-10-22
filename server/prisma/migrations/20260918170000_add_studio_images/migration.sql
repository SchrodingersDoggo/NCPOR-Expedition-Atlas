-- No-video AI image posts: photos researchers upload directly (source_images),
-- and the resulting post image (uploaded photo restyled, or generated from
-- scratch when nothing but reports/datasets were attached).

ALTER TABLE "studio_projects" ADD COLUMN "source_images" JSONB;
ALTER TABLE "studio_projects" ADD COLUMN "post_image_url" TEXT;
