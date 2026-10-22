-- Phase 4: client request IDs make create operations idempotent when a
-- successful response is lost and the client retries the same request.
ALTER TABLE "expeditions" ADD COLUMN "client_request_id" TEXT;
ALTER TABLE "content_items" ADD COLUMN "client_request_id" TEXT;

CREATE UNIQUE INDEX "expeditions_client_request_id_key"
  ON "expeditions"("client_request_id");

CREATE UNIQUE INDEX "content_items_client_request_id_key"
  ON "content_items"("client_request_id");
