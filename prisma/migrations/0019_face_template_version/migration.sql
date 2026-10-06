-- Face ID templates record the capture standard they were made with; older ones
-- (captured from smaller, softer faces) no longer unlock and must be re-enrolled.
ALTER TABLE "FaceTemplate" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
