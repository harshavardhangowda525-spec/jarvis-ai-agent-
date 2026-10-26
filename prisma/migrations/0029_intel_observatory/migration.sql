-- AlterTable
ALTER TABLE "IntelItem" ADD COLUMN     "saved" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "IntelSettings" ADD COLUMN     "weights" JSONB;

