-- runly.inventory: unify "Tipo" into inv_category, add inv_model and inv_item.model_id,
-- and migrate legacy item_type strings plus the JSON inventory_reusable_catalog rows.
-- See docs/superpowers/specs/2026-09-28-inventory-types-models-catalogs-design.md.

CREATE TABLE "inv_model" (
    "id"          UUID NOT NULL DEFAULT uuidv7(),
    "company_id"  UUID NOT NULL,
    "name"        VARCHAR(255) NOT NULL,
    "name_key"    VARCHAR(255) NOT NULL,
    "type_id"     UUID NOT NULL,
    "brand_id"    UUID NOT NULL,
    "year"        INTEGER,
    "description" VARCHAR(2000),
    "sort_order"  INTEGER NOT NULL DEFAULT 0,
    "enabled"     BOOLEAN NOT NULL DEFAULT true,
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"  TIMESTAMP(3) NOT NULL,
    CONSTRAINT "inv_model_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "inv_model_company_id_brand_id_name_key_year_key" ON "inv_model"("company_id", "brand_id", "name_key", "year");
CREATE INDEX "inv_model_company_id_idx" ON "inv_model"("company_id");
CREATE INDEX "inv_model_type_id_idx" ON "inv_model"("type_id");
CREATE INDEX "inv_model_brand_id_idx" ON "inv_model"("brand_id");
ALTER TABLE "inv_model" ADD CONSTRAINT "inv_model_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inv_model" ADD CONSTRAINT "inv_model_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "inv_category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inv_model" ADD CONSTRAINT "inv_model_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "inv_brand"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "inv_model" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "inv_model" FROM PUBLIC, anon, authenticated;

ALTER TABLE "inv_item" ADD COLUMN "model_id" UUID;
CREATE INDEX "inv_item_model_id_idx" ON "inv_item"("model_id");
ALTER TABLE "inv_item" ADD CONSTRAINT "inv_item_model_id_fkey" FOREIGN KEY ("model_id") REFERENCES "inv_model"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Base item_type values -> Spanish type names.
CREATE TEMP TABLE "_inv_type_labels" ("value" TEXT PRIMARY KEY, "label" TEXT NOT NULL);
INSERT INTO "_inv_type_labels" VALUES
  ('hardware', 'Hardware'), ('software', 'Software'), ('license', 'Licencia'), ('equipment', 'Equipo'),
  ('furniture', 'Mobiliario'), ('vehicle', 'Vehículo'), ('consumable', 'Consumible'), ('other', 'Otro');

-- 1. Default concrete types for every company (never overwrites an existing name).
INSERT INTO "inv_category" ("company_id", "name", "icon", "sort_order", "enabled", "created_at", "updated_at")
SELECT c."id", t."name", t."icon", t."ord" * 10, true, now(), now()
FROM "company" c
CROSS JOIN (VALUES
  ('Laptop', 'Laptop', 0), ('Computadora de escritorio', 'Cpu', 1), ('Monitor', 'Monitor', 2),
  ('Celular', 'Smartphone', 3), ('Tablet', 'Tablet', 4), ('Impresora', 'Printer', 5),
  ('Equipo de red', 'Router', 6), ('Periférico', 'Keyboard', 7), ('Licencia de software', 'KeyRound', 8),
  ('Mobiliario', 'Armchair', 9), ('Herramienta', 'Wrench', 10), ('Vehículo', 'Car', 11)
) AS t("name", "icon", "ord")
ON CONFLICT ("company_id", "name") DO NOTHING;

-- 2. Items without a category get a type named after their legacy item_type (category wins).
INSERT INTO "inv_category" ("company_id", "name", "sort_order", "enabled", "created_at", "updated_at")
SELECT DISTINCT i."company_id", left(COALESCE(l."label", btrim(i."item_type")), 100), 1000, true, now(), now()
FROM "inv_item" i
LEFT JOIN "_inv_type_labels" l ON l."value" = i."item_type"
WHERE i."category_id" IS NULL AND i."item_type" IS NOT NULL AND btrim(i."item_type") <> ''
ON CONFLICT ("company_id", "name") DO NOTHING;

UPDATE "inv_item" i SET "category_id" = c."id"
FROM "inv_category" c
WHERE i."category_id" IS NULL AND i."item_type" IS NOT NULL AND btrim(i."item_type") <> ''
  AND c."company_id" = i."company_id"
  AND c."name" = left(COALESCE((SELECT l."label" FROM "_inv_type_labels" l WHERE l."value" = i."item_type"), btrim(i."item_type")), 100);

-- 3. Legacy JSON catalog (Runly ORM table; may not exist on every instance).
DO $$
BEGIN
  IF to_regclass('public.inventory_reusable_catalog') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO "inv_category" ("company_id", "name", "sort_order", "enabled", "created_at", "updated_at")
  SELECT r.company_id, left(r.name, 100), 1000, true, now(), now()
  FROM inventory_reusable_catalog r
  WHERE r.kind = 'type'
  ON CONFLICT ("company_id", "name") DO NOTHING;

  INSERT INTO "inv_category" ("company_id", "name", "sort_order", "enabled", "created_at", "updated_at")
  SELECT DISTINCT r.company_id, 'Sin tipo', 9999, true, now(), now()
  FROM inventory_reusable_catalog r
  WHERE r.kind = 'model'
  ON CONFLICT ("company_id", "name") DO NOTHING;

  -- Rows whose brand no longer exists are skipped (inner join on inv_brand).
  INSERT INTO "inv_model" ("company_id", "name", "name_key", "type_id", "brand_id", "year", "description", "created_at", "updated_at")
  SELECT r.company_id, left(r.name, 255), lower(left(r.name, 255)),
         COALESCE(t_detail.id, t_items.category_id, t_none.id), b.id,
         CASE WHEN (r.details->>'year') ~ '^[0-9]{4}$' THEN (r.details->>'year')::int END,
         left(r.details->>'description', 2000), now(), now()
  FROM inventory_reusable_catalog r
  JOIN "inv_brand" b ON b.company_id = r.company_id AND lower(b.name) = lower(r.details->>'brandName')
  LEFT JOIN "inv_category" t_detail ON t_detail.company_id = r.company_id
    AND t_detail.name = COALESCE((SELECT l."label" FROM "_inv_type_labels" l WHERE l."value" = r.details->>'itemType'), r.details->>'itemType')
  LEFT JOIN LATERAL (
    SELECT i.category_id FROM "inv_item" i
    WHERE i.company_id = r.company_id AND i.brand_id = b.id AND lower(i.model) = lower(r.name) AND i.category_id IS NOT NULL
    GROUP BY i.category_id ORDER BY count(*) DESC LIMIT 1
  ) t_items ON true
  JOIN "inv_category" t_none ON t_none.company_id = r.company_id AND t_none.name = 'Sin tipo'
  WHERE r.kind = 'model'
  ON CONFLICT ("company_id", "brand_id", "name_key", "year") DO NOTHING;

  -- Drop the helper "Sin tipo" type where nothing ended up using it.
  UPDATE "inv_category" c SET "enabled" = false, "updated_at" = now()
  WHERE c.name = 'Sin tipo'
    AND NOT EXISTS (SELECT 1 FROM "inv_model" m WHERE m.type_id = c.id)
    AND NOT EXISTS (SELECT 1 FROM "inv_item" i WHERE i.category_id = c.id);
END $$;

-- 4. Link items to the model with the same name + brand when exactly one matches.
UPDATE "inv_item" i SET "model_id" = m."id"
FROM "inv_model" m
WHERE i."model_id" IS NULL AND i."model" IS NOT NULL
  AND m."company_id" = i."company_id" AND m."brand_id" = i."brand_id" AND m."name_key" = lower(i."model")
  AND (SELECT count(*) FROM "inv_model" m2
       WHERE m2."company_id" = i."company_id" AND m2."brand_id" = i."brand_id" AND m2."name_key" = lower(i."model")) = 1;

DROP TABLE "_inv_type_labels";
