-- CreateTable
CREATE TABLE "Prospect" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "category" TEXT,
    "contactPerson" TEXT,
    "phone" TEXT,
    "phoneKey" TEXT,
    "whatsapp" TEXT,
    "address" TEXT,
    "area" TEXT,
    "city" TEXT,
    "mapsUrl" TEXT,
    "placeId" TEXT,
    "rating" DOUBLE PRECISION,
    "reviews" INTEGER,
    "websiteStatus" TEXT NOT NULL DEFAULT 'none',
    "website" TEXT,
    "instagram" TEXT,
    "facebook" TEXT,
    "hours" TEXT,
    "signals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "leadScore" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'new',
    "lostReason" TEXT,
    "lastContactedAt" TIMESTAMP(3),
    "nextAction" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "interestedServices" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "budgetRange" TEXT,
    "decisionMaker" TEXT,
    "unreachableCount" INTEGER NOT NULL DEFAULT 0,
    "value" DOUBLE PRECISION,
    "wonAt" TIMESTAMP(3),
    "searchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prospectId" TEXT,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "by" TEXT NOT NULL DEFAULT 'jarvis',
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapsFinder" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT,
    "device" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "scheduleOn" BOOLEAN NOT NULL DEFAULT false,
    "scheduleDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "scheduleTime" TEXT NOT NULL DEFAULT '10:30',
    "dailyLimit" INTEGER NOT NULL DEFAULT 30,
    "categories" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "areas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "city" TEXT NOT NULL DEFAULT 'Bengaluru',
    "rotateIndex" INTEGER NOT NULL DEFAULT 0,
    "lastScheduled" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MapsFinder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MapsSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "limit" INTEGER NOT NULL DEFAULT 20,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "trigger" TEXT NOT NULL DEFAULT 'you',
    "visited" INTEGER NOT NULL DEFAULT 0,
    "withWebsite" INTEGER NOT NULL DEFAULT 0,
    "kept" INTEGER NOT NULL DEFAULT 0,
    "added" INTEGER NOT NULL DEFAULT 0,
    "duplicates" INTEGER NOT NULL DEFAULT 0,
    "currentText" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "MapsSearch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Prospect_userId_status_nextActionAt_idx" ON "Prospect"("userId", "status", "nextActionAt");

-- CreateIndex
CREATE INDEX "Prospect_userId_createdAt_idx" ON "Prospect"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_userId_phoneKey_key" ON "Prospect"("userId", "phoneKey");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_userId_placeId_key" ON "Prospect"("userId", "placeId");

-- CreateIndex
CREATE INDEX "ProspectEvent_userId_createdAt_idx" ON "ProspectEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ProspectEvent_prospectId_createdAt_idx" ON "ProspectEvent"("prospectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MapsFinder_userId_key" ON "MapsFinder"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MapsFinder_tokenHash_key" ON "MapsFinder"("tokenHash");

-- CreateIndex
CREATE INDEX "MapsSearch_userId_status_createdAt_idx" ON "MapsSearch"("userId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectEvent" ADD CONSTRAINT "ProspectEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectEvent" ADD CONSTRAINT "ProspectEvent_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapsFinder" ADD CONSTRAINT "MapsFinder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MapsSearch" ADD CONSTRAINT "MapsSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

