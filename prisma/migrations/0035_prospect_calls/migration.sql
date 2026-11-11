-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN     "doNotContact" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ProspectCall" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "batchId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "outcome" TEXT,
    "callbackAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProspectCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dailyCap" INTEGER NOT NULL DEFAULT 25,
    "hoursFrom" TEXT NOT NULL DEFAULT '10:00',
    "hoursTo" TEXT NOT NULL DEFAULT '19:00',
    "days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "recordingNotice" BOOLEAN NOT NULL DEFAULT true,
    "callerName" TEXT NOT NULL DEFAULT 'Jarvis',
    "company" TEXT NOT NULL DEFAULT 'Infinity Web & Apps',
    "ownerName" TEXT NOT NULL DEFAULT 'Harshavardhan',
    "city" TEXT NOT NULL DEFAULT 'Bengaluru',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CallSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProspectCall_userId_status_createdAt_idx" ON "ProspectCall"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "ProspectCall_prospectId_createdAt_idx" ON "ProspectCall"("prospectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CallSettings_userId_key" ON "CallSettings"("userId");

-- AddForeignKey
ALTER TABLE "ProspectCall" ADD CONSTRAINT "ProspectCall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectCall" ADD CONSTRAINT "ProspectCall_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSettings" ADD CONSTRAINT "CallSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

