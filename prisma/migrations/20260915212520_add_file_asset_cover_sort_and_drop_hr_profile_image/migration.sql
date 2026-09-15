-- Add cover/sort columns to the shared file_asset table, generalizing the
-- isCover/sortOrder pattern that inv_item_file already has (see
-- 20260914020000_add_inv_item_file_sort_cover) so any module using the
-- generic moduleKey/entityType/entityId file-tagging convention (not just
-- Inventory's own inv_item_file join table) can offer the same cover-photo
-- picker.
-- IF NOT EXISTS: this migration failed on first attempt (see below) after
-- these two ADD COLUMN statements had already committed; kept idempotent so
-- re-running it from a clean `prisma migrate resolve --rolled-back` + deploy
-- doesn't error on columns that already exist.
ALTER TABLE "file_asset" ADD COLUMN IF NOT EXISTS "is_cover" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "file_asset" ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0;

-- Preserve every employee's current profile photo: mark their FileAsset as
-- the cover before dropping the dedicated FK column below. hr_employee's
-- profile_image_file_id pointed directly at file_asset.id (no join table),
-- so this is a plain id match. Safe to re-run (idempotent: setting is_cover
-- = true on an already-true row is a no-op).
UPDATE "file_asset"
SET "is_cover" = true
WHERE "id" IN (
  SELECT "profile_image_file_id"
  FROM "hr_employee"
  WHERE "profile_image_file_id" IS NOT NULL
);

-- First attempt at this migration failed here: a BEFORE INSERT OR UPDATE OF
-- profile_image_file_id trigger (hr_employee_restricted_guard, guarding
-- restricted-visibility file attachments — shared with inv_item_file/
-- calendar_event_file/generated_document via the same
-- atlas_guard_restricted_attachment() function, confirmed via pg_trigger
-- before writing this) depends on the column and blocks a plain DROP
-- COLUMN. The trigger is meaningless once this column is gone, so it's
-- dropped explicitly (not the shared function, which the other three
-- tables' own trigger instances still use).
DROP TRIGGER IF EXISTS "hr_employee_restricted_guard" ON "hr_employee";

-- Drop the now-redundant dedicated FK. Constraint name confirmed live
-- against the database before writing this migration (pg_constraint query,
-- see the HR blueprint migration Plan A, Task 1 Step 4).
ALTER TABLE "hr_employee" DROP CONSTRAINT IF EXISTS "hr_employee_profile_image_file_id_fkey";
ALTER TABLE "hr_employee" DROP COLUMN IF EXISTS "profile_image_file_id";
