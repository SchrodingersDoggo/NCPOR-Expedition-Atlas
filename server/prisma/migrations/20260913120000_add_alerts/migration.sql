-- Phase 1 (Emergency Alert): a field team member can report a danger
-- against an expedition/location. This table only records the report —
-- danger-level escalation (Phase 3) and resolution (Phase 5) build on it later.

CREATE TYPE "DangerType" AS ENUM ('medical', 'weather', 'terrain_ice', 'equipment_vehicle', 'other');

CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "expedition_id" TEXT NOT NULL,
    "type" "DangerType" NOT NULL,
    "message" TEXT,
    "reported_by" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "client_request_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "alerts_client_request_id_key" ON "alerts"("client_request_id");
CREATE INDEX "alerts_expedition_id_idx" ON "alerts"("expedition_id");
CREATE INDEX "alerts_resolved_idx" ON "alerts"("resolved");

ALTER TABLE "alerts" ADD CONSTRAINT "alerts_expedition_id_fkey"
  FOREIGN KEY ("expedition_id") REFERENCES "expeditions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "alerts" ADD CONSTRAINT "alerts_reported_by_fkey"
  FOREIGN KEY ("reported_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
