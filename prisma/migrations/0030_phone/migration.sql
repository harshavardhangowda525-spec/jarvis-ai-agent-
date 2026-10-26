-- CreateTable
CREATE TABLE "PhoneLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "toNumber" TEXT,
    "jarvisNumber" TEXT,
    "tokenHash" TEXT,
    "onCompleted" BOOLEAN NOT NULL DEFAULT true,
    "onFailed" BOOLEAN NOT NULL DEFAULT true,
    "onApproval" BOOLEAN NOT NULL DEFAULT true,
    "quietFrom" TEXT,
    "quietTo" TEXT,
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "device" TEXT,
    "lastCallAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PhoneLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhoneEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "batchId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "PhoneEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PhoneLink_userId_key" ON "PhoneLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PhoneLink_tokenHash_key" ON "PhoneLink"("tokenHash");

-- CreateIndex
CREATE INDEX "PhoneEvent_userId_status_createdAt_idx" ON "PhoneEvent"("userId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PhoneEvent_userId_key_key" ON "PhoneEvent"("userId", "key");

-- AddForeignKey
ALTER TABLE "PhoneLink" ADD CONSTRAINT "PhoneLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhoneEvent" ADD CONSTRAINT "PhoneEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

