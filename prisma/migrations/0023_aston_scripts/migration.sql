-- CreateTable
CREATE TABLE "AstonScript" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'cold_call',
    "businessType" TEXT,
    "details" JSONB,
    "content" JSONB NOT NULL,
    "request" TEXT NOT NULL,
    "saved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AstonScript_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AstonScript_userId_saved_updatedAt_idx" ON "AstonScript"("userId", "saved", "updatedAt");

-- AddForeignKey
ALTER TABLE "AstonScript" ADD CONSTRAINT "AstonScript_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

