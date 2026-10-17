-- AlterTable
ALTER TABLE "AgentJob" ADD COLUMN     "payload" JSONB;

-- CreateTable
CREATE TABLE "AstonSite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'website',
    "niche" TEXT,
    "leadId" TEXT,
    "previewToken" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "approvedVersion" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AstonSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AstonVersion" (
    "id" TEXT NOT NULL,
    "siteId" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "html" TEXT NOT NULL,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "checks" JSONB NOT NULL,
    "feedback" TEXT,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AstonVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'generating',
    "niche" TEXT,
    "plan" JSONB,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseUntil" TIMESTAMP(3),
    "shareToken" TEXT NOT NULL,
    "shareRevokedAt" TIMESTAMP(3),
    "notifiedAt" TIMESTAMP(3),
    "notifyLog" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketingPlanSettings" (
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "deliveryTime" TEXT NOT NULL DEFAULT '07:00',
    "notifyEmail" BOOLEAN NOT NULL DEFAULT false,
    "notifyWhatsapp" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MarketingPlanSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AstonSite_previewToken_key" ON "AstonSite"("previewToken");

-- CreateIndex
CREATE INDEX "AstonSite_userId_updatedAt_idx" ON "AstonSite"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AstonVersion_siteId_n_key" ON "AstonVersion"("siteId", "n");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPlan_shareToken_key" ON "MarketingPlan"("shareToken");

-- CreateIndex
CREATE UNIQUE INDEX "MarketingPlan_userId_date_key" ON "MarketingPlan"("userId", "date");

-- AddForeignKey
ALTER TABLE "AstonSite" ADD CONSTRAINT "AstonSite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AstonVersion" ADD CONSTRAINT "AstonVersion_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "AstonSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPlan" ADD CONSTRAINT "MarketingPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketingPlanSettings" ADD CONSTRAINT "MarketingPlanSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

