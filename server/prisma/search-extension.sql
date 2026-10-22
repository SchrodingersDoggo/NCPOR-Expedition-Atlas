-- Run this AFTER `npx prisma migrate dev` has created the tables.
-- Prisma doesn't support tsvector/triggers natively, so we add search as a manual extension.
-- Usage: npm run db:search-setup

ALTER TABLE content_items ADD COLUMN IF NOT EXISTS search_vector tsvector;

CREATE OR REPLACE FUNCTION content_search_trigger() RETURNS trigger AS $$
begin
  new.search_vector :=
     setweight(to_tsvector('english', coalesce(new.title,'')), 'A') ||
     setweight(to_tsvector('english', coalesce(new.description,'')), 'B');
  return new;
end
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_content_search ON content_items;
CREATE TRIGGER trg_content_search
BEFORE INSERT OR UPDATE ON content_items
FOR EACH ROW EXECUTE FUNCTION content_search_trigger();

CREATE INDEX IF NOT EXISTS idx_content_search ON content_items USING GIN(search_vector);

-- Backfill existing rows
UPDATE content_items SET title = title;
