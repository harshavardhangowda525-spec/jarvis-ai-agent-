-- CreateTable
CREATE TABLE "DarwinIgRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "primaryRunId" TEXT,
    "target" INTEGER NOT NULL DEFAULT 20,
    "status" TEXT NOT NULL DEFAULT 'running',
    "comboIndex" INTEGER NOT NULL DEFAULT 0,
    "exhausted" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "found" INTEGER NOT NULL DEFAULT 0,
    "igVerified" INTEGER NOT NULL DEFAULT 0,
    "noWebsite" INTEGER NOT NULL DEFAULT 0,
    "saved" INTEGER NOT NULL DEFAULT 0,
    "contactable" INTEGER NOT NULL DEFAULT 0,
    "highPotential" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "unverified" INTEGER NOT NULL DEFAULT 0,
    "noInstagram" INTEGER NOT NULL DEFAULT 0,
    "websiteFound" INTEGER NOT NULL DEFAULT 0,
    "apiRequests" JSONB,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "log" JSONB,
    "lastError" TEXT,
    "lockedUntil" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DarwinIgRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DarwinIgLead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "runId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "placeId" TEXT,
    "businessName" TEXT NOT NULL,
    "category" TEXT,
    "location" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "phone" TEXT,
    "instagramUsername" TEXT NOT NULL,
    "instagramUrl" TEXT NOT NULL,
    "instagramStatus" TEXT NOT NULL DEFAULT 'verified',
    "instagramEvidence" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "followers" INTEGER,
    "posts" INTEGER,
    "instagramActivity" TEXT,
    "websiteStatus" TEXT NOT NULL DEFAULT 'no_official_website',
    "websiteReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "qualityScore" INTEGER NOT NULL DEFAULT 0,
    "highPotential" BOOLEAN NOT NULL DEFAULT false,
    "scoreParts" JSONB,
    "source" TEXT NOT NULL,
    "foundDate" TEXT NOT NULL,
    "contactStatus" TEXT NOT NULL DEFAULT 'not_contacted',
    "followUpStatus" TEXT NOT NULL DEFAULT 'none',
    "followUpAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DarwinIgLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DarwinIgCheck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "placeId" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DarwinIgCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DarwinIgRun_userId_date_key" ON "DarwinIgRun"("userId", "date");

-- CreateIndex
CREATE INDEX "DarwinIgLead_userId_createdAt_idx" ON "DarwinIgLead"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DarwinIgLead_userId_fingerprint_key" ON "DarwinIgLead"("userId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "DarwinIgLead_userId_instagramUsername_key" ON "DarwinIgLead"("userId", "instagramUsername");

-- CreateIndex
CREATE INDEX "DarwinIgCheck_userId_placeId_idx" ON "DarwinIgCheck"("userId", "placeId");

-- CreateIndex
CREATE UNIQUE INDEX "DarwinIgCheck_userId_fingerprint_key" ON "DarwinIgCheck"("userId", "fingerprint");

-- AddForeignKey
ALTER TABLE "DarwinIgRun" ADD CONSTRAINT "DarwinIgRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DarwinIgLead" ADD CONSTRAINT "DarwinIgLead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DarwinIgCheck" ADD CONSTRAINT "DarwinIgCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

