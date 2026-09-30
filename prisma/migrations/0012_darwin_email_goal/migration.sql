-- AlterTable
ALTER TABLE "DarwinDailyRun" ADD COLUMN     "emailTarget" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "missingEmail" INTEGER NOT NULL DEFAULT 0;

