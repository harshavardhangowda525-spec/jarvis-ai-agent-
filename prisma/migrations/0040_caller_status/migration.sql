-- AlterTable
ALTER TABLE "PhoneLink" ADD COLUMN "callerStatus" JSONB,
ADD COLUMN "callerSeenAt" TIMESTAMP(3);
