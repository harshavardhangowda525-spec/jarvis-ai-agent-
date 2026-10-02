-- ROBIN is now called RUBIN: its past entries in your activity history carry the new name.
UPDATE "ActivityEvent" SET "agent" = 'RUBIN' WHERE "agent" = 'ROBIN';
