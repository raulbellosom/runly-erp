-- The atlas -> runly rename (20260914000000_rename_atlas_core_tables_to_runly and the
-- application-code sweep in commits 10e8612e/336aa108) updated files/workspace.js to write
-- module_key = 'runly.files' and bucket = 'runly-files' for new workspace documents, but
-- missed this CHECK constraint from 20260908090000_files_workspace, which still hardcoded
-- the old atlas.* values. Every "create document" call has failed the constraint since,
-- with no existing RESTRICTED file_asset rows to preserve compatibility for.
ALTER TABLE file_asset DROP CONSTRAINT file_asset_restricted_storage_check;
ALTER TABLE file_asset ADD CONSTRAINT file_asset_restricted_storage_check CHECK (
  access_scope <> 'RESTRICTED' OR
  (uploaded_by_id IS NOT NULL AND entity_id IS NOT NULL AND entity_type = 'AtlasFile' AND module_key = 'runly.files' AND bucket = 'runly-files' AND visibility <> 'PUBLIC')
);
