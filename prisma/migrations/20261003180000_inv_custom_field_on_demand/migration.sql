-- Inventory custom fields "a demanda": never shown automatically, added to
-- one item at a time from the item form (spec 2026-10-03-inventory-custom-fields-modes).
ALTER TABLE "inv_custom_field" ADD COLUMN IF NOT EXISTS "on_demand" BOOLEAN NOT NULL DEFAULT false;
