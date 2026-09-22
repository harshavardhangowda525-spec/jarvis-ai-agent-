-- DARWIN lead-gen / CRM tables (real leads only)
CREATE TABLE "DarwinLead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "category" TEXT,
    "location" TEXT,
    "website" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "instagram" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceRef" TEXT,
    "sourceUrl" TEXT,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3),
    "stage" TEXT NOT NULL DEFAULT 'new',
    "assignedTo" TEXT,
    "opportunityType" TEXT,
    "notes" TEXT,
    "nextFollowUpAt" TIMESTAMP(3),
    "verifiedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aiAnalysis" TEXT,
    "leadScore" INTEGER,
    "fingerprint" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "DarwinLead_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DarwinLead_userId_stage_nextFollowUpAt_idx" ON "DarwinLead"("userId", "stage", "nextFollowUpAt");
CREATE INDEX "DarwinLead_userId_discoveredAt_idx" ON "DarwinLead"("userId", "discoveredAt");
CREATE INDEX "DarwinLead_userId_fingerprint_idx" ON "DarwinLead"("userId", "fingerprint");
ALTER TABLE "DarwinLead" ADD CONSTRAINT "DarwinLead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DarwinActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT,
    "type" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DarwinActivity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DarwinActivity_userId_createdAt_idx" ON "DarwinActivity"("userId", "createdAt");
CREATE INDEX "DarwinActivity_leadId_createdAt_idx" ON "DarwinActivity"("leadId", "createdAt");
ALTER TABLE "DarwinActivity" ADD CONSTRAINT "DarwinActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DarwinActivity" ADD CONSTRAINT "DarwinActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "DarwinLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DarwinFollowUp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "message" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "DarwinFollowUp_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DarwinFollowUp_userId_status_dueAt_idx" ON "DarwinFollowUp"("userId", "status", "dueAt");
ALTER TABLE "DarwinFollowUp" ADD CONSTRAINT "DarwinFollowUp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DarwinFollowUp" ADD CONSTRAINT "DarwinFollowUp_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "DarwinLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DarwinMessage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'email',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "externalId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    CONSTRAINT "DarwinMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DarwinMessage_userId_status_createdAt_idx" ON "DarwinMessage"("userId", "status", "createdAt");
CREATE INDEX "DarwinMessage_leadId_createdAt_idx" ON "DarwinMessage"("leadId", "createdAt");
ALTER TABLE "DarwinMessage" ADD CONSTRAINT "DarwinMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DarwinMessage" ADD CONSTRAINT "DarwinMessage_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "DarwinLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
