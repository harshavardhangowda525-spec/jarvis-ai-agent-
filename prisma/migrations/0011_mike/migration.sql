-- CreateTable
CREATE TABLE "MikeSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "assetGroup" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'mtf',
    "decision" TEXT NOT NULL,
    "direction" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "entryLow" DOUBLE PRECISION,
    "entryHigh" DOUBLE PRECISION,
    "stop" DOUBLE PRECISION,
    "targets" JSONB,
    "riskReward" DOUBLE PRECISION,
    "riskPct" DOUBLE PRECISION,
    "confidence" INTEGER NOT NULL,
    "regime" TEXT,
    "freshness" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "priceAtSignal" DOUBLE PRECISION,
    "reasoning" JSONB NOT NULL,
    "indicators" JSONB,
    "outcome" JSONB,
    "audit" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "triggeredAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "MikeSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MikeAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asset" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL DEFAULT '1h',
    "kind" TEXT NOT NULL,
    "level" DOUBLE PRECISION,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastCheckedAt" TIMESTAMP(3),
    "triggeredAt" TIMESTAMP(3),
    "triggerInfo" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MikeAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MikeSignal_userId_createdAt_idx" ON "MikeSignal"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "MikeSignal_userId_status_idx" ON "MikeSignal"("userId", "status");

-- CreateIndex
CREATE INDEX "MikeAlert_userId_status_idx" ON "MikeAlert"("userId", "status");

-- AddForeignKey
ALTER TABLE "MikeSignal" ADD CONSTRAINT "MikeSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MikeAlert" ADD CONSTRAINT "MikeAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

