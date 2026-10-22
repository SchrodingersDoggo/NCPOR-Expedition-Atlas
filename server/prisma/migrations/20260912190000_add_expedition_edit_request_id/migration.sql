ALTER TABLE "expeditions" ADD COLUMN "last_edit_request_id" TEXT;
CREATE UNIQUE INDEX "expeditions_last_edit_request_id_key" ON "expeditions"("last_edit_request_id");
