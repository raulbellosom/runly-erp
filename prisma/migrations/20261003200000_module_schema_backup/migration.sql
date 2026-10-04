-- Pre-update backups of RME3 module tables (spec 2026-10-03-rme3-module-platform-v2 §10.6).
CREATE SCHEMA IF NOT EXISTS "runly_backup";

CREATE TABLE "module_schema_backup" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "module_key" TEXT NOT NULL,
    "version_from" TEXT,
    "version_to" TEXT,
    "tables" JSONB NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "restored_at" TIMESTAMP(3),

    CONSTRAINT "module_schema_backup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "module_schema_backup_module_key_created_at_idx" ON "module_schema_backup"("module_key", "created_at");
CREATE INDEX "module_schema_backup_expires_at_idx" ON "module_schema_backup"("expires_at");
