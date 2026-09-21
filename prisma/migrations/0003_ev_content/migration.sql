-- CreateTable: EV marketing agent persistent memory
CREATE TABLE "EvContent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "niche" TEXT,
    "theme" TEXT,
    "title" TEXT NOT NULL DEFAULT '',
    "caption" TEXT,
    "hook" TEXT,
    "cta" TEXT,
    "body" TEXT,
    "fingerprint" TEXT NOT NULL,
    "metadata" JSONB,
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EvContent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvContent_userId_kind_status_idx" ON "EvContent"("userId", "kind", "status");
CREATE INDEX "EvContent_userId_createdAt_idx" ON "EvContent"("userId", "createdAt");
CREATE INDEX "EvContent_userId_fingerprint_idx" ON "EvContent"("userId", "fingerprint");

-- AddForeignKey
ALTER TABLE "EvContent" ADD CONSTRAINT "EvContent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
