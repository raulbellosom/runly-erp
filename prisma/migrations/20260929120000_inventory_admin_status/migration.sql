-- runly.inventory: administrative status (alta/baja), physical condition
-- catalog and the administrative event ledger. See
-- docs/superpowers/specs/2026-09-28-inventory-admin-status-design.md.

-- AlterTable
ALTER TABLE "inv_item" ADD COLUMN     "admin_status" VARCHAR(40) NOT NULL DEFAULT 'registered',
ADD COLUMN     "condition_id" UUID,
ADD COLUMN     "deregistered_at" DATE,
ADD COLUMN     "deregistration_reason" VARCHAR(40),
ADD COLUMN     "registered_at" DATE;

-- CreateTable
CREATE TABLE "inv_condition" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "color" VARCHAR(20),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inv_condition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inv_item_admin_event" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "from_status" VARCHAR(40),
    "to_status" VARCHAR(40) NOT NULL,
    "reason" VARCHAR(40),
    "comment" VARCHAR(2000),
    "effective_date" DATE,
    "file_id" UUID,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inv_item_admin_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "inv_condition_company_id_idx" ON "inv_condition"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "inv_condition_company_id_name_key" ON "inv_condition"("company_id", "name");

-- CreateIndex
CREATE INDEX "inv_item_admin_event_item_id_created_at_idx" ON "inv_item_admin_event"("item_id", "created_at");

-- CreateIndex
CREATE INDEX "inv_item_admin_event_company_id_to_status_idx" ON "inv_item_admin_event"("company_id", "to_status");

-- CreateIndex
CREATE INDEX "inv_item_company_id_admin_status_idx" ON "inv_item"("company_id", "admin_status");

-- CreateIndex
CREATE INDEX "inv_item_condition_id_idx" ON "inv_item"("condition_id");

-- AddForeignKey
ALTER TABLE "inv_condition" ADD CONSTRAINT "inv_condition_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_item_admin_event" ADD CONSTRAINT "inv_item_admin_event_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_item_admin_event" ADD CONSTRAINT "inv_item_admin_event_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inv_item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_item_admin_event" ADD CONSTRAINT "inv_item_admin_event_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inv_item" ADD CONSTRAINT "inv_item_condition_id_fkey" FOREIGN KEY ("condition_id") REFERENCES "inv_condition"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Data migration: legacy "baja" statuses become administrative bajas with a
-- mapped reason; the operational status goes back to available.
INSERT INTO "inv_item_admin_event" ("company_id", "item_id", "action", "from_status", "to_status", "reason", "comment", "effective_date", "actor_id", "created_at")
SELECT "company_id", "id", 'migrated', 'registered', 'deregistered',
       CASE "status" WHEN 'retired' THEN 'obsolescence' WHEN 'lost' THEN 'loss' WHEN 'stolen' THEN 'theft' ELSE 'destruction' END,
       'Migrado desde el estado anterior "' || "status" || '".', "updated_at"::date, "created_by_id", CURRENT_TIMESTAMP
FROM "inv_item"
WHERE "status" IN ('retired', 'lost', 'stolen', 'disposed');

UPDATE "inv_item"
SET "admin_status" = 'deregistered',
    "deregistration_reason" = CASE "status" WHEN 'retired' THEN 'obsolescence' WHEN 'lost' THEN 'loss' WHEN 'stolen' THEN 'theft' ELSE 'destruction' END,
    "deregistered_at" = "updated_at"::date,
    "registered_at" = "created_at"::date,
    "status" = 'available',
    "assigned_to_id" = NULL,
    "assigned_at" = NULL
WHERE "status" IN ('retired', 'lost', 'stolen', 'disposed');

-- Close any assignment still open on an item that is now deregistered.
UPDATE "inv_assignment" a SET "returned_at" = CURRENT_TIMESTAMP
FROM "inv_item" i
WHERE a."item_id" = i."id" AND a."returned_at" IS NULL AND i."admin_status" = 'deregistered';

UPDATE "inv_item" SET "registered_at" = "created_at"::date WHERE "registered_at" IS NULL;
