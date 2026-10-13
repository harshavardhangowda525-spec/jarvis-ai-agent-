-- ASTON website builder: which engine writes the site ("groq" or "claude-code:<model>").
ALTER TABLE "AstonSite" ADD COLUMN "engine" TEXT NOT NULL DEFAULT 'groq';
