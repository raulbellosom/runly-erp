-- Marketplace catalog source default (Production Catalog Activation Readiness).
-- New installations (no company yet when migrations run) get no row and default
-- to the official Runly catalog. Instances that already exist keep exactly their
-- previous behaviour: 'custom' when they configured feed URLs, otherwise
-- 'disabled'. Administrators can opt in later from Modules > Marketplace.
-- Data-only and additive: nothing is installed, removed or re-pointed.
INSERT INTO "instance_config" ("id", "key", "value", "created_at", "updated_at")
SELECT uuidv7(), 'catalog.source.mode',
       CASE WHEN EXISTS (SELECT 1 FROM "instance_config" WHERE "key" IN ('catalog.v2.url', 'catalog.official.url') AND "value" <> '')
            THEN 'custom' ELSE 'disabled' END,
       now(), now()
 WHERE EXISTS (SELECT 1 FROM "company")
ON CONFLICT ("key") DO NOTHING;
