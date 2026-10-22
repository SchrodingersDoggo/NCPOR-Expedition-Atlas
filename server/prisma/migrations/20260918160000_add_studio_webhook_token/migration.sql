-- Security fix: Creatomate's webhook has no signing mechanism of its own,
-- so a per-project random token (embedded in the callback URL, never
-- returned to the client) is what actually proves a webhook call is
-- genuine, rather than relying solely on the render id matching.

ALTER TABLE "studio_projects" ADD COLUMN "webhook_token" TEXT;
