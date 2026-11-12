-- CreateTable
CREATE TABLE "DesktopTask" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "DesktopTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DesktopTask_userId_status_createdAt_idx" ON "DesktopTask"("userId", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "DesktopTask" ADD CONSTRAINT "DesktopTask_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

