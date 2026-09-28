-- runly.contacts Contact 360: avatar, website, industry, tags, SAT fiscal
-- fields, and child collections for channels, addresses and key people.
-- See docs/superpowers/specs/2026-09-27-contacts-360-redesign-design.md.
ALTER TABLE "contact"
  ADD COLUMN "avatar_file_id" UUID,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "industry" TEXT,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "tax_regime" TEXT,
  ADD COLUMN "fiscal_postal_code" VARCHAR(5),
  ADD COLUMN "cfdi_use" TEXT;

CREATE INDEX "contact_tags_idx" ON "contact" USING GIN ("tags");

CREATE TABLE "contact_channel" (
    "id"           UUID NOT NULL DEFAULT uuidv7(),
    "company_id"   UUID NOT NULL,
    "contact_id"   UUID NOT NULL,
    "kind"         TEXT NOT NULL,
    "label"        TEXT NOT NULL DEFAULT 'other',
    "value"        TEXT NOT NULL,
    "country_code" TEXT,
    "is_primary"   BOOLEAN NOT NULL DEFAULT false,
    "sort_order"   INTEGER NOT NULL DEFAULT 0,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contact_channel_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contact_channel_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "contact_channel_contact_id_idx" ON "contact_channel"("contact_id");
CREATE INDEX "contact_channel_company_id_kind_value_idx" ON "contact_channel"("company_id", "kind", "value");

CREATE TABLE "contact_address" (
    "id"           UUID NOT NULL DEFAULT uuidv7(),
    "company_id"   UUID NOT NULL,
    "contact_id"   UUID NOT NULL,
    "kind"         TEXT NOT NULL DEFAULT 'other',
    "label"        TEXT,
    "street"       TEXT NOT NULL,
    "ext_number"   TEXT,
    "int_number"   TEXT,
    "neighborhood" TEXT,
    "postal_code"  TEXT,
    "city"         TEXT,
    "state"        TEXT,
    "country"      TEXT NOT NULL DEFAULT 'MX',
    "is_default"   BOOLEAN NOT NULL DEFAULT false,
    "sort_order"   INTEGER NOT NULL DEFAULT 0,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contact_address_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contact_address_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "contact_address_contact_id_idx" ON "contact_address"("contact_id");

CREATE TABLE "contact_person" (
    "id"         UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "name"       TEXT NOT NULL,
    "role"       TEXT,
    "phone"      TEXT,
    "email"      TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "notes"      TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contact_person_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contact_person_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "contact_person_contact_id_idx" ON "contact_person"("contact_id");

-- Backfill: existing email/phone become the primary channel of each kind.
-- Contacts without a company cannot own child rows and are skipped.
INSERT INTO "contact_channel" ("company_id", "contact_id", "kind", "label", "value", "is_primary", "sort_order", "updated_at")
SELECT "company_id", "id", 'email', 'other', "email", true, 0, NOW()
FROM "contact"
WHERE "company_id" IS NOT NULL AND NULLIF(TRIM("email"), '') IS NOT NULL;

INSERT INTO "contact_channel" ("company_id", "contact_id", "kind", "label", "value", "is_primary", "sort_order", "updated_at")
SELECT "company_id", "id", 'phone', 'other', "phone", true, 0, NOW()
FROM "contact"
WHERE "company_id" IS NOT NULL AND NULLIF(TRIM("phone"), '') IS NOT NULL;
