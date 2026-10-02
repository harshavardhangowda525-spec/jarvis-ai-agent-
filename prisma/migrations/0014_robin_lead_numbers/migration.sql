-- Every ROBIN lead gets a short number per user (1, 2, 3 …) so it can be named by number.
ALTER TABLE "RobinLead" ADD COLUMN "number" INTEGER;

-- existing leads are numbered in the order they arrived
UPDATE "RobinLead" AS r
SET "number" = s.n
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt", "id") AS n FROM "RobinLead") AS s
WHERE r."id" = s."id";

CREATE UNIQUE INDEX "RobinLead_userId_number_key" ON "RobinLead"("userId", "number");
