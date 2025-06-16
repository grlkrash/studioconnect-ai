-- AlterTable
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "pm_tool_id" TEXT,
  ADD COLUMN IF NOT EXISTS "pm_tool" TEXT,
  ADD COLUMN IF NOT EXISTS "assignee" TEXT,
  ADD COLUMN IF NOT EXISTS "due_date" TIMESTAMP;

-- Add composite unique indexes for project identifiers
CREATE UNIQUE INDEX IF NOT EXISTS "pmToolId_businessId" ON "projects" ("pm_tool_id", "businessId");
CREATE UNIQUE INDEX IF NOT EXISTS "businessId_pmToolId" ON "projects" ("businessId", "pm_tool_id");

-- AlterTable
ALTER TABLE "integrations"
  ADD COLUMN IF NOT EXISTS "webhookId" TEXT,
  ADD COLUMN IF NOT EXISTS "credentials" JSONB,
  ADD COLUMN IF NOT EXISTS "syncStatus" TEXT;

-- Add composite unique index for integrations
CREATE UNIQUE INDEX IF NOT EXISTS "businessId_provider" ON "integrations" ("businessId", "type"); 