-- CreateTable
CREATE TABLE "OwnerCall" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "toNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'dialing',
    "transcript" JSONB NOT NULL DEFAULT '[]',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "OwnerCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OwnerCall_userId_status_createdAt_idx" ON "OwnerCall"("userId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "OwnerCall" ADD CONSTRAINT "OwnerCall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

