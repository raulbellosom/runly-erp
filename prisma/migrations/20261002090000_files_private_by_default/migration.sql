-- runly.files access model (docs/superpowers/specs/2026-10-01-files-access-model-design.md):
-- files uploaded through runly.files become private to their uploader.
-- Module attachments keep COMPANY scope (their module authorizes them).
-- The affected ids are saved first so a later forward migration can restore them.
INSERT INTO "instance_config" ("id", "key", "value", "created_at", "updated_at")
SELECT uuidv7(), 'files.access_model.migrated_company_ids',
       COALESCE(json_agg("id")::text, '[]'), now(), now()
  FROM "file_asset"
 WHERE "access_scope" = 'COMPANY'
   AND "entity_type" = 'AtlasFile'
   AND ("module_key" IS NULL OR "module_key" IN ('runly.files', 'atlas.files'))
   AND "uploaded_by_id" IS NOT NULL
ON CONFLICT ("key") DO NOTHING;

UPDATE "file_asset"
   SET "access_scope" = 'RESTRICTED'
 WHERE "access_scope" = 'COMPANY'
   AND "entity_type" = 'AtlasFile'
   AND ("module_key" IS NULL OR "module_key" IN ('runly.files', 'atlas.files'))
   AND "uploaded_by_id" IS NOT NULL;
