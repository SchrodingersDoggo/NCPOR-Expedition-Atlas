-- Voyage/cruise-specific metadata on Expedition (NPDC's Scientific Voyage
-- Details + Sagar Kanya Cruise Report sections). All optional — left blank
-- for Antarctic land expeditions and anything else that isn't a sea
-- voyage. Departure/return dates deliberately reuse the existing
-- start_date/end_date columns rather than adding a duplicate date pair.

-- Rename: voyage_code -> voyage_name (matches NPDC's own column name;
-- guarded so this is a no-op if the previous migration was never applied
-- to this database, e.g. a fresh setup).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expeditions' AND column_name = 'voyage_code'
  ) THEN
    ALTER TABLE "expeditions" RENAME COLUMN "voyage_code" TO "voyage_name";
  ELSIF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'expeditions' AND column_name = 'voyage_name'
  ) THEN
    ALTER TABLE "expeditions" ADD COLUMN "voyage_name" TEXT;
  END IF;
END $$;

ALTER TABLE "expeditions" ADD COLUMN IF NOT EXISTS "cruise_name" TEXT;
ALTER TABLE "expeditions" ADD COLUMN IF NOT EXISTS "cruise_number" TEXT;
ALTER TABLE "expeditions" ADD COLUMN IF NOT EXISTS "route_area" TEXT;
ALTER TABLE "expeditions" ADD COLUMN IF NOT EXISTS "stations_visited" TEXT[] DEFAULT ARRAY[]::TEXT[];
