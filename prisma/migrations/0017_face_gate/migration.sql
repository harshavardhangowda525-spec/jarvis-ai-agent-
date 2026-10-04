-- CreateTable
CREATE TABLE "GateCredential" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "GateCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GateSecurity" (
    "userId" TEXT NOT NULL,
    "pinHash" TEXT,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lockouts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GateSecurity_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "GateChallenge" (
    "id" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "userId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GateChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GateCredential_credentialId_key" ON "GateCredential"("credentialId");

-- CreateIndex
CREATE INDEX "GateCredential_userId_idx" ON "GateCredential"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "GateChallenge_challenge_key" ON "GateChallenge"("challenge");

-- CreateIndex
CREATE INDEX "GateChallenge_expiresAt_idx" ON "GateChallenge"("expiresAt");

-- AddForeignKey
ALTER TABLE "GateCredential" ADD CONSTRAINT "GateCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GateSecurity" ADD CONSTRAINT "GateSecurity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

