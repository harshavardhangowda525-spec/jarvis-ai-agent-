-- JARVIS activity history + daily summaries (previous-day briefing).

CREATE TABLE "ActivityEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "date" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "result" TEXT,
    "status" TEXT NOT NULL DEFAULT 'info',
    "importance" INTEGER NOT NULL DEFAULT 2,
    "project" TEXT,
    "source" TEXT NOT NULL,
    "metadata" JSONB,
    "fingerprint" TEXT,
    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ActivityEvent_userId_timestamp_idx" ON "ActivityEvent"("userId", "timestamp");
CREATE INDEX "ActivityEvent_userId_date_idx" ON "ActivityEvent"("userId", "date");
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DailySummary" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "narrative" TEXT NOT NULL,
    "stats" JSONB NOT NULL,
    "eventCount" INTEGER NOT NULL,
    "lastEventAt" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DailySummary_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DailySummary_userId_date_key" ON "DailySummary"("userId", "date");
ALTER TABLE "DailySummary" ADD CONSTRAINT "DailySummary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
