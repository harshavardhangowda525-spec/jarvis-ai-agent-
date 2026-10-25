-- CreateTable
CREATE TABLE "AstonProject" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "client" TEXT,
    "slug" TEXT NOT NULL,
    "dir" TEXT NOT NULL,
    "stack" TEXT NOT NULL DEFAULT 'static',
    "style" TEXT,
    "state" TEXT NOT NULL DEFAULT 'understanding',
    "stateNote" TEXT,
    "previewToken" TEXT NOT NULL,
    "testKey" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "spec" JSONB,
    "envVars" JSONB NOT NULL DEFAULT '[]',
    "tasks" JSONB NOT NULL DEFAULT '[]',
    "tests" JSONB,
    "deploy" JSONB,
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "lastBuildAt" TIMESTAMP(3),
    "jobId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AstonProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AstonProjectVersion" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'building',
    "change" TEXT,
    "files" JSONB NOT NULL DEFAULT '[]',
    "tests" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AstonProjectVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AstonSubmission" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "form" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "slot" TEXT,
    "test" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AstonSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AstonProject_previewToken_key" ON "AstonProject"("previewToken");

-- CreateIndex
CREATE INDEX "AstonProject_userId_updatedAt_idx" ON "AstonProject"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AstonProject_userId_slug_key" ON "AstonProject"("userId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "AstonProjectVersion_projectId_n_key" ON "AstonProjectVersion"("projectId", "n");

-- CreateIndex
CREATE INDEX "AstonSubmission_projectId_createdAt_idx" ON "AstonSubmission"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AstonSubmission_projectId_form_slot_key" ON "AstonSubmission"("projectId", "form", "slot");

-- AddForeignKey
ALTER TABLE "AstonProject" ADD CONSTRAINT "AstonProject_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AstonProjectVersion" ADD CONSTRAINT "AstonProjectVersion_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "AstonProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AstonSubmission" ADD CONSTRAINT "AstonSubmission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "AstonProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
