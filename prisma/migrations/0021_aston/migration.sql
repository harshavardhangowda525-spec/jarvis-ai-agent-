-- CreateTable
CREATE TABLE "AstonIncident" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "openKey" TEXT,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'open',
    "project" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "evidence" JSONB,
    "recovery" JSONB,
    "recommendation" TEXT,
    "summary" TEXT,
    "aiNote" TEXT,
    "pendingAction" JSONB,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verifyNote" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AstonIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AstonAlert" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "round" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "providerRef" TEXT,
    "testMode" BOOLEAN NOT NULL DEFAULT false,
    "costUsd" DOUBLE PRECISION,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AstonAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AstonDecision" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AstonDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AstonProviderState" (
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "blockedUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "lastOkAt" TIMESTAMP(3),
    "day" TEXT,
    "requestsToday" INTEGER NOT NULL DEFAULT 0,
    "remainingRequests" INTEGER,
    "remainingTokens" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AstonProviderState_pkey" PRIMARY KEY ("provider")
);

-- CreateIndex
CREATE UNIQUE INDEX "AstonIncident_openKey_key" ON "AstonIncident"("openKey");

-- CreateIndex
CREATE INDEX "AstonIncident_userId_status_priority_idx" ON "AstonIncident"("userId", "status", "priority");

-- CreateIndex
CREATE INDEX "AstonIncident_userId_fingerprint_idx" ON "AstonIncident"("userId", "fingerprint");

-- CreateIndex
CREATE INDEX "AstonAlert_userId_channel_status_idx" ON "AstonAlert"("userId", "channel", "status");

-- CreateIndex
CREATE INDEX "AstonAlert_status_nextAttemptAt_idx" ON "AstonAlert"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "AstonAlert_incidentId_channel_round_key" ON "AstonAlert"("incidentId", "channel", "round");

-- CreateIndex
CREATE INDEX "AstonDecision_incidentId_idx" ON "AstonDecision"("incidentId");

-- AddForeignKey
ALTER TABLE "AstonIncident" ADD CONSTRAINT "AstonIncident_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AstonAlert" ADD CONSTRAINT "AstonAlert_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "AstonIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AstonDecision" ADD CONSTRAINT "AstonDecision_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "AstonIncident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

