-- NIOS board notices watched by JARVIS.

CREATE TABLE "NiosNotice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "dateText" TEXT,
    "publishedAt" TIMESTAMP(3),
    "category" TEXT NOT NULL DEFAULT 'general',
    "fingerprint" TEXT NOT NULL,
    "baseline" BOOLEAN NOT NULL DEFAULT false,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    CONSTRAINT "NiosNotice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NiosNotice_userId_fingerprint_key" ON "NiosNotice"("userId", "fingerprint");
CREATE INDEX "NiosNotice_userId_firstSeenAt_idx" ON "NiosNotice"("userId", "firstSeenAt");

ALTER TABLE "NiosNotice" ADD CONSTRAINT "NiosNotice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
