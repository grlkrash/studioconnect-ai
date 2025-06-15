-- AlterTable
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "notificationEmails" TEXT[] NOT NULL DEFAULT '{}'::text[];

-- Optional data migration: populate the new array column from legacy notificationEmail single-value field
UPDATE "businesses"
SET "notificationEmails" = ARRAY["notificationEmail"]
WHERE "notificationEmail" IS NOT NULL
  AND ("notificationEmails" IS NULL OR array_length("notificationEmails", 1) = 0); 