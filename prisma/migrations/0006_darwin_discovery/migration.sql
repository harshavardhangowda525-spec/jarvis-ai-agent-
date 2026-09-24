-- DARWIN real-time discovery: coordinates, CRM fields, and persistent search cursors.

ALTER TABLE "DarwinLead" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "DarwinLead" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "DarwinLead" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
ALTER TABLE "DarwinLead" ADD COLUMN "lastContactedAt" TIMESTAMP(3);
ALTER TABLE "DarwinLead" ADD COLUMN "salesValue" DOUBLE PRECISION;
ALTER TABLE "DarwinLead" ADD COLUMN "serviceInterest" TEXT;

CREATE INDEX "DarwinLead_userId_sourceRef_idx" ON "DarwinLead"("userId", "sourceRef");

CREATE TABLE "DarwinSearchCursor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "queryKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "filter" TEXT NOT NULL DEFAULT 'all',
    "centerLat" DOUBLE PRECISION,
    "centerLon" DOUBLE PRECISION,
    "placeLabel" TEXT,
    "baseRadiusM" INTEGER NOT NULL DEFAULT 5000,
    "radiusStep" INTEGER NOT NULL DEFAULT 0,
    "offset" INTEGER NOT NULL DEFAULT 0,
    "exhausted" BOOLEAN NOT NULL DEFAULT false,
    "backlog" JSONB,
    "totalNew" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DarwinSearchCursor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DarwinSearchCursor_userId_queryKey_key" ON "DarwinSearchCursor"("userId", "queryKey");

ALTER TABLE "DarwinSearchCursor" ADD CONSTRAINT "DarwinSearchCursor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
