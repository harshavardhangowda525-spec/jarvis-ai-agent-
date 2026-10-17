-- AlterTable
ALTER TABLE "RobinLead" ADD COLUMN     "evidence" JSONB,
ADD COLUMN     "externalRef" TEXT;

-- CreateTable
CREATE TABLE "CrmBackup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "counts" JSONB NOT NULL,
    "bytes" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmBackup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DarwinSeen" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "sourceRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DarwinSeen_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrmBackup_userId_createdAt_idx" ON "CrmBackup"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "DarwinSeen_userId_sourceRef_idx" ON "DarwinSeen"("userId", "sourceRef");

-- CreateIndex
CREATE UNIQUE INDEX "DarwinSeen_userId_fingerprint_key" ON "DarwinSeen"("userId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "RobinLead_userId_source_externalRef_key" ON "RobinLead"("userId", "source", "externalRef");

-- AddForeignKey
ALTER TABLE "CrmBackup" ADD CONSTRAINT "CrmBackup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DarwinSeen" ADD CONSTRAINT "DarwinSeen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

