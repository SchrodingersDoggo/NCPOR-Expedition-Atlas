-- Direct messages: private 1:1, text only, REST + polling.
-- readAt NULL = unread.

CREATE TABLE "direct_messages" (
  "id" TEXT NOT NULL,
  "sender_id" TEXT NOT NULL,
  "receiver_id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "read_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "direct_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "direct_messages_sender_id_receiver_id_created_at_idx" ON "direct_messages"("sender_id", "receiver_id", "created_at");
CREATE INDEX "direct_messages_receiver_id_read_at_idx" ON "direct_messages"("receiver_id", "read_at");

ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "direct_messages" ADD CONSTRAINT "direct_messages_receiver_id_fkey" FOREIGN KEY ("receiver_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
