-- CreateTable
CREATE TABLE "growth_property" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'external_sdk',
    "website_site_id" UUID,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "analytics_mode" TEXT NOT NULL DEFAULT 'standard',
    "turnstile_site_key" TEXT,
    "turnstile_secret_key" TEXT,
    "capabilities" JSONB,
    "verified_at" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "growth_property_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "growth_property_company_id_website_site_id_key" ON "growth_property" ("company_id", "website_site_id");

-- CreateIndex
CREATE INDEX "growth_property_company_id_enabled_idx" ON "growth_property" ("company_id", "enabled");

-- CreateIndex
CREATE INDEX "growth_property_company_id_domain_idx" ON "growth_property" ("company_id", "domain");
