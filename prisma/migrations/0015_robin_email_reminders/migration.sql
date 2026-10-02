-- ROBIN emails you before a follow-up or demo is due — once each.
ALTER TABLE "RobinFollowUp" ADD COLUMN "remindedAt" TIMESTAMP(3);
ALTER TABLE "RobinDemo" ADD COLUMN "emailRemindedAt" TIMESTAMP(3);
