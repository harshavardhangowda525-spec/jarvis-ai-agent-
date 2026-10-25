-- CreateTable
CREATE TABLE "TradingReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "weekEnd" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'generating',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "trigger" TEXT NOT NULL DEFAULT 'scheduled',
    "metrics" JSONB,
    "narrative" JSONB,
    "source" JSONB,
    "error" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "notifyLog" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingReportRevision" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "narrative" JSONB,
    "source" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradingReportRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TradingSettings" (
    "userId" TEXT NOT NULL,
    "weeklyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT false,
    "notifyWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "backup" JSONB,
    "backupAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "IntelItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "urlHash" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "publisher" TEXT,
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "via" TEXT NOT NULL,
    "feed" TEXT,
    "topic" TEXT,
    "category" TEXT,
    "media" JSONB,
    "analysis" JSONB,
    "importance" INTEGER,
    "relevance" INTEGER,
    "analyzedAt" TIMESTAMP(3),

    CONSTRAINT "IntelItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelOpportunity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "score" INTEGER NOT NULL,
    "evidence" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntelOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelBriefing" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'generating',
    "revision" INTEGER NOT NULL DEFAULT 0,
    "trigger" TEXT NOT NULL DEFAULT 'scheduled',
    "content" JSONB,
    "sources" JSONB,
    "error" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "generatedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "notifyLog" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntelBriefing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntelSettings" (
    "userId" TEXT NOT NULL,
    "topics" JSONB,
    "dailyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "weeklyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "notifyEmail" BOOLEAN NOT NULL DEFAULT false,
    "notifyWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "lastRefreshAt" TIMESTAMP(3),
    "lastRefresh" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntelSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "TradingReport_userId_weekStart_idx" ON "TradingReport"("userId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "TradingReport_userId_weekStart_key" ON "TradingReport"("userId", "weekStart");

-- CreateIndex
CREATE UNIQUE INDEX "TradingReportRevision_reportId_revision_key" ON "TradingReportRevision"("reportId", "revision");

-- CreateIndex
CREATE INDEX "IntelItem_userId_publishedAt_idx" ON "IntelItem"("userId", "publishedAt");

-- CreateIndex
CREATE INDEX "IntelItem_userId_fetchedAt_idx" ON "IntelItem"("userId", "fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "IntelItem_userId_urlHash_key" ON "IntelItem"("userId", "urlHash");

-- CreateIndex
CREATE INDEX "IntelOpportunity_userId_score_idx" ON "IntelOpportunity"("userId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "IntelOpportunity_userId_key_key" ON "IntelOpportunity"("userId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "IntelBriefing_userId_kind_period_key" ON "IntelBriefing"("userId", "kind", "period");

-- AddForeignKey
ALTER TABLE "TradingReport" ADD CONSTRAINT "TradingReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TradingReportRevision" ADD CONSTRAINT "TradingReportRevision_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "TradingReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelItem" ADD CONSTRAINT "IntelItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelOpportunity" ADD CONSTRAINT "IntelOpportunity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntelBriefing" ADD CONSTRAINT "IntelBriefing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

