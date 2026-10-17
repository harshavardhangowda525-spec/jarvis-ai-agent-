-- Each conversation belongs to one agent (JARVIS, EV, DARWIN, MIKE, RUBIN). Existing chats are JARVIS's.
-- Safe to run again.
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "agent" TEXT NOT NULL DEFAULT 'jarvis';
CREATE INDEX IF NOT EXISTS "Conversation_userId_agent_archived_updatedAt_idx" ON "Conversation"("userId", "agent", "archived", "updatedAt");
