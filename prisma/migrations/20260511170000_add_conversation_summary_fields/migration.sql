-- Add summary fields so older chat context can be compressed instead of replayed.
ALTER TABLE "Conversation"
ADD COLUMN "summary" TEXT,
ADD COLUMN "summaryMessageCount" INTEGER NOT NULL DEFAULT 0;