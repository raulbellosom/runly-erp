-- Public links to RME3 module resources (enlaces publicos). Additive.
CREATE TABLE "module_public_link" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "company_id" UUID NOT NULL,
  "module_key" TEXT NOT NULL,
  "resource_key" TEXT NOT NULL,
  "record_id" UUID,
  "token" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "label" TEXT,
  "expires_at" TIMESTAMP(3),
  "max_uses" INTEGER,
  "use_count" INTEGER NOT NULL DEFAULT 0,
  "last_used_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "module_public_link_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "module_public_link_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "company"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "module_public_link_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "user_profile"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "module_public_link_token_key" ON "module_public_link"("token");
CREATE INDEX "module_public_link_company_id_module_key_resource_key_idx" ON "module_public_link"("company_id", "module_key", "resource_key");
CREATE INDEX "module_public_link_company_id_module_key_record_id_idx" ON "module_public_link"("company_id", "module_key", "record_id");
