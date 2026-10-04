-- RME3 Module Platform v2, Phase 6: service grants, catalog cache, domain event outbox.
CREATE TABLE "module_service_grant" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID,
    "module_key" TEXT NOT NULL,
    "service_key" TEXT NOT NULL,
    "granted_by" UUID,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "module_service_grant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "module_service_grant_module_key_service_key_company_id_key" ON "module_service_grant"("module_key", "service_key", "company_id");
CREATE INDEX "module_service_grant_module_key_idx" ON "module_service_grant"("module_key");

CREATE TABLE "module_catalog_cache" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "url" TEXT NOT NULL,
    "etag" TEXT,
    "payload" JSONB NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "module_catalog_cache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "module_catalog_cache_url_key" ON "module_catalog_cache"("url");

CREATE TABLE "domain_event_outbox" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "company_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "domain_event_outbox_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "domain_event_outbox_processed_at_next_attempt_at_idx" ON "domain_event_outbox"("processed_at", "next_attempt_at");
