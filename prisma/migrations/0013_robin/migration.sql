-- CreateTable
CREATE TABLE "RobinLead" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "darwinLeadId" TEXT,
    "darwinAliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "businessName" TEXT NOT NULL,
    "category" TEXT,
    "phone" TEXT,
    "whatsapp" TEXT,
    "email" TEXT,
    "website" TEXT,
    "instagram" TEXT,
    "address" TEXT,
    "city" TEXT,
    "mapsUrl" TEXT,
    "websiteStatus" TEXT,
    "websiteQuality" TEXT,
    "opportunityType" TEXT,
    "darwinScore" INTEGER,
    "rating" DOUBLE PRECISION,
    "reviews" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'darwin',
    "discoveredAt" TIMESTAMP(3),
    "fingerprint" TEXT NOT NULL,
    "phoneKey" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'needs_review',
    "priorityOverride" TEXT,
    "score" INTEGER NOT NULL DEFAULT 0,
    "reasons" JSONB,
    "qualifiedAt" TIMESTAMP(3),
    "stage" TEXT NOT NULL DEFAULT 'new',
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "potentialValue" DOUBLE PRECISION,
    "serviceInterest" TEXT,
    "assignedTo" TEXT,
    "lastContactAt" TIMESTAMP(3),
    "nextFollowUpAt" TIMESTAMP(3),
    "notes" TEXT,
    "lostReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RobinLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobinLeadScore" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "priority" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RobinLeadScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobinStageChange" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "fromStage" TEXT,
    "toStage" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RobinStageChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobinActivity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT,
    "type" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RobinActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobinInteraction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'outbound',
    "outcome" TEXT,
    "status" TEXT NOT NULL DEFAULT 'logged',
    "subject" TEXT,
    "notes" TEXT,
    "externalId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RobinInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobinFollowUp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'call',
    "dueAt" TIMESTAMP(3) NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RobinFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobinDemo" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "demoType" TEXT NOT NULL DEFAULT 'online',
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "remindedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RobinDemo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobinQuotation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "clientName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "subtotal" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL,
    "validUntil" TIMESTAMP(3),
    "paymentTerms" TEXT,
    "notes" TEXT,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RobinQuotation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobinQuotationItem" (
    "id" TEXT NOT NULL,
    "quotationId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "description" TEXT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RobinQuotationItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobinClient" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "quotationId" TEXT,
    "businessName" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "project" TEXT,
    "service" TEXT,
    "amount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "paymentStatus" TEXT NOT NULL DEFAULT 'unpaid',
    "status" TEXT NOT NULL DEFAULT 'active',
    "startDate" TIMESTAMP(3),
    "deliveryDate" TIMESTAMP(3),
    "notes" TEXT,
    "convertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RobinClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobinPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RobinPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobinService" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DOUBLE PRECISION,
    "unit" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "RobinService_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobinSettings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RobinSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobinNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "leadId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RobinNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RobinAudit" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "source" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RobinAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RobinLead_userId_stage_idx" ON "RobinLead"("userId", "stage");

-- CreateIndex
CREATE INDEX "RobinLead_userId_fingerprint_idx" ON "RobinLead"("userId", "fingerprint");

-- CreateIndex
CREATE INDEX "RobinLead_userId_phoneKey_idx" ON "RobinLead"("userId", "phoneKey");

-- CreateIndex
CREATE INDEX "RobinLead_userId_email_idx" ON "RobinLead"("userId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "RobinLead_userId_darwinLeadId_key" ON "RobinLead"("userId", "darwinLeadId");

-- CreateIndex
CREATE INDEX "RobinLeadScore_leadId_createdAt_idx" ON "RobinLeadScore"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "RobinStageChange_userId_createdAt_idx" ON "RobinStageChange"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RobinStageChange_leadId_createdAt_idx" ON "RobinStageChange"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "RobinActivity_userId_createdAt_idx" ON "RobinActivity"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "RobinActivity_leadId_createdAt_idx" ON "RobinActivity"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "RobinInteraction_userId_occurredAt_idx" ON "RobinInteraction"("userId", "occurredAt");

-- CreateIndex
CREATE INDEX "RobinInteraction_leadId_occurredAt_idx" ON "RobinInteraction"("leadId", "occurredAt");

-- CreateIndex
CREATE INDEX "RobinFollowUp_userId_status_dueAt_idx" ON "RobinFollowUp"("userId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "RobinFollowUp_leadId_idx" ON "RobinFollowUp"("leadId");

-- CreateIndex
CREATE INDEX "RobinDemo_userId_status_scheduledAt_idx" ON "RobinDemo"("userId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "RobinQuotation_userId_status_idx" ON "RobinQuotation"("userId", "status");

-- CreateIndex
CREATE INDEX "RobinQuotation_leadId_idx" ON "RobinQuotation"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "RobinQuotation_userId_number_key" ON "RobinQuotation"("userId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "RobinClient_leadId_key" ON "RobinClient"("leadId");

-- CreateIndex
CREATE INDEX "RobinClient_userId_status_idx" ON "RobinClient"("userId", "status");

-- CreateIndex
CREATE INDEX "RobinPayment_userId_paidAt_idx" ON "RobinPayment"("userId", "paidAt");

-- CreateIndex
CREATE INDEX "RobinService_userId_idx" ON "RobinService"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RobinService_userId_name_key" ON "RobinService"("userId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "RobinSettings_userId_key" ON "RobinSettings"("userId");

-- CreateIndex
CREATE INDEX "RobinNotification_userId_readAt_createdAt_idx" ON "RobinNotification"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "RobinAudit_userId_createdAt_idx" ON "RobinAudit"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "RobinLead" ADD CONSTRAINT "RobinLead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobinLeadScore" ADD CONSTRAINT "RobinLeadScore_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "RobinLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobinStageChange" ADD CONSTRAINT "RobinStageChange_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "RobinLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobinActivity" ADD CONSTRAINT "RobinActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "RobinLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobinInteraction" ADD CONSTRAINT "RobinInteraction_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "RobinLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobinFollowUp" ADD CONSTRAINT "RobinFollowUp_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "RobinLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobinDemo" ADD CONSTRAINT "RobinDemo_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "RobinLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobinQuotation" ADD CONSTRAINT "RobinQuotation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "RobinLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobinQuotationItem" ADD CONSTRAINT "RobinQuotationItem_quotationId_fkey" FOREIGN KEY ("quotationId") REFERENCES "RobinQuotation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobinClient" ADD CONSTRAINT "RobinClient_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "RobinLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobinPayment" ADD CONSTRAINT "RobinPayment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "RobinClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RobinSettings" ADD CONSTRAINT "RobinSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
