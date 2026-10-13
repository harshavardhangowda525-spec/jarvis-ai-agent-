-- CreateTable
CREATE TABLE "AstonSite" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'building',
    "plan" JSONB,
    "css" TEXT,
    "guide" TEXT,
    "sections" JSONB,
    "error" TEXT,
    "revisions" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AstonSite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AstonSite_userId_createdAt_idx" ON "AstonSite"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AstonSite" ADD CONSTRAINT "AstonSite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

