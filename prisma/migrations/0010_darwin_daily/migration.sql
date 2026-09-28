-- DARWIN autonomous daily lead search
CREATE TABLE "DarwinDailyRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "target" INTEGER NOT NULL DEFAULT 50,
    "status" TEXT NOT NULL DEFAULT 'running',
    "config" JSONB NOT NULL,
    "comboIndex" INTEGER NOT NULL DEFAULT 0,
    "exhaustedCombos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "verified" INTEGER NOT NULL DEFAULT 0,
    "candidates" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "alreadyChecked" INTEGER NOT NULL DEFAULT 0,
    "websiteRejected" INTEGER NOT NULL DEFAULT 0,
    "unclear" INTEGER NOT NULL DEFAULT 0,
    "tempUnavailable" INTEGER NOT NULL DEFAULT 0,
    "closed" INTEGER NOT NULL DEFAULT 0,
    "missingPhone" INTEGER NOT NULL DEFAULT 0,
    "outOfArea" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "apiRequests" JSONB,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "log" JSONB,
    "report" JSONB,
    "lastError" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "reportedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DarwinDailyRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DarwinDailyRun_userId_date_key" ON "DarwinDailyRun"("userId", "date");
CREATE INDEX "DarwinDailyRun_userId_startedAt_idx" ON "DarwinDailyRun"("userId", "startedAt");
ALTER TABLE "DarwinDailyRun" ADD CONSTRAINT "DarwinDailyRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DarwinCandidate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "placeId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "address" TEXT,
    "status" TEXT NOT NULL,
    "website" TEXT,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "runDate" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DarwinCandidate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DarwinCandidate_userId_fingerprint_key" ON "DarwinCandidate"("userId", "fingerprint");
CREATE INDEX "DarwinCandidate_userId_placeId_idx" ON "DarwinCandidate"("userId", "placeId");
ALTER TABLE "DarwinCandidate" ADD CONSTRAINT "DarwinCandidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
