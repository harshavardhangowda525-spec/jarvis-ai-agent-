-- CreateTable
CREATE TABLE "FridayProject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "dir" TEXT NOT NULL,
    "activeVersion" INTEGER NOT NULL DEFAULT 0,
    "specs" JSONB,
    "history" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FridayProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FridayVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'building',
    "plan" JSONB NOT NULL,
    "parentN" INTEGER,
    "change" TEXT,
    "result" JSONB,
    "error" TEXT,
    "jobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FridayVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FridayProject_userId_updatedAt_idx" ON "FridayProject"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FridayProject_userId_slug_key" ON "FridayProject"("userId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "FridayVersion_projectId_n_key" ON "FridayVersion"("projectId", "n");

-- AddForeignKey
ALTER TABLE "FridayProject" ADD CONSTRAINT "FridayProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FridayVersion" ADD CONSTRAINT "FridayVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "FridayProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

