-- CreateTable: images EV generates (served at a public URL for Instagram publishing)
CREATE TABLE "EvMedia" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL DEFAULT 'image/png',
    "data" BYTEA NOT NULL,
    "prompt" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvMedia_userId_createdAt_idx" ON "EvMedia"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "EvMedia" ADD CONSTRAINT "EvMedia_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
