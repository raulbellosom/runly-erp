-- Core purchasing foundation. Legacy inventory purchase fields are intentionally
-- retained while their values are copied into the new ownership model.
ALTER TABLE "inv_item"
  ADD COLUMN "acquisition_origin" VARCHAR(30) NOT NULL DEFAULT 'OTHER';

UPDATE "inv_item"
SET "acquisition_origin" = 'PURCHASE'
WHERE "purchase_date" IS NOT NULL
   OR "purchase_price" IS NOT NULL
   OR "vendor_name" IS NOT NULL
   OR "invoice_number" IS NOT NULL;

CREATE TABLE "purchase_workflow" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "company_id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "preset" VARCHAR(30) NOT NULL DEFAULT 'BASIC',
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "capabilities" JSONB NOT NULL,
  "stages" JSONB NOT NULL,
  "policies" JSONB NOT NULL DEFAULT '[]',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_workflow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_case" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "company_id" UUID NOT NULL,
  "workflow_id" UUID,
  "number" VARCHAR(40) NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "description" VARCHAR(2000),
  "status" VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  "currency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
  "estimated_total" DECIMAL(14,2),
  "created_by_id" UUID,
  "closed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_case_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_supplier_profile" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "company_id" UUID NOT NULL,
  "contact_id" UUID NOT NULL,
  "payment_terms" VARCHAR(120),
  "supplier_code" VARCHAR(60),
  "notes" VARCHAR(1000),
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_supplier_profile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_order" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "company_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "supplier_id" UUID,
  "number" VARCHAR(40) NOT NULL,
  "issue_date" DATE NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  "currency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
  "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "notes" VARCHAR(2000),
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_invoice" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "company_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "supplier_id" UUID,
  "number" VARCHAR(100) NOT NULL,
  "fiscal_uuid" VARCHAR(36),
  "issue_date" DATE NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  "currency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
  "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "notes" VARCHAR(2000),
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_invoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_line" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "company_id" UUID NOT NULL,
  "owner_type" VARCHAR(30) NOT NULL,
  "owner_id" UUID NOT NULL,
  "description" VARCHAR(500) NOT NULL,
  "quantity" DECIMAL(14,4) NOT NULL DEFAULT 1,
  "unit_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "tax_amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_line_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_stage_record" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "company_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "stage_type" VARCHAR(30) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  "data" JSONB,
  "completed_by" UUID,
  "completed_at" TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_stage_record_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "entity_relation" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "company_id" UUID NOT NULL,
  "source_module" VARCHAR(80) NOT NULL,
  "source_type" VARCHAR(80) NOT NULL,
  "source_id" UUID NOT NULL,
  "target_module" VARCHAR(80) NOT NULL,
  "target_type" VARCHAR(80) NOT NULL,
  "target_id" UUID NOT NULL,
  "relation_type" VARCHAR(80) NOT NULL,
  "origin" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
  "metadata" JSONB,
  "source_relation_id" UUID,
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entity_relation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_allocation" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "company_id" UUID NOT NULL,
  "purchase_line_id" UUID NOT NULL,
  "target_module" VARCHAR(80) NOT NULL,
  "target_type" VARCHAR(80) NOT NULL,
  "target_id" UUID NOT NULL,
  "quantity" DECIMAL(14,4),
  "unit_amount" DECIMAL(14,2),
  "allocated_amount" DECIMAL(14,2) NOT NULL,
  "allocation_percentage" DECIMAL(7,4),
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_allocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_file" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "company_id" UUID NOT NULL,
  "owner_type" VARCHAR(30) NOT NULL,
  "owner_id" UUID NOT NULL,
  "file_asset_id" UUID NOT NULL,
  "label" VARCHAR(100),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_file_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_case_company_id_number_key" ON "purchase_case"("company_id", "number");
CREATE UNIQUE INDEX "purchase_supplier_profile_company_id_contact_id_key" ON "purchase_supplier_profile"("company_id", "contact_id");
CREATE UNIQUE INDEX "purchase_order_company_id_number_key" ON "purchase_order"("company_id", "number");
CREATE UNIQUE INDEX "purchase_invoice_company_supplier_number_key" ON "purchase_invoice"("company_id", "supplier_id", "number");
CREATE UNIQUE INDEX "purchase_stage_record_case_stage_key" ON "purchase_stage_record"("case_id", "stage_type");
CREATE UNIQUE INDEX "entity_relation_unique_key" ON "entity_relation"("company_id", "source_module", "source_type", "source_id", "target_module", "target_type", "target_id", "relation_type");
CREATE UNIQUE INDEX "purchase_allocation_target_key" ON "purchase_allocation"("purchase_line_id", "target_module", "target_type", "target_id");
CREATE UNIQUE INDEX "purchase_file_owner_asset_key" ON "purchase_file"("owner_type", "owner_id", "file_asset_id");

CREATE INDEX "purchase_workflow_company_enabled_idx" ON "purchase_workflow"("company_id", "enabled");
CREATE UNIQUE INDEX "purchase_workflow_one_default_idx" ON "purchase_workflow"("company_id") WHERE "is_default" AND "enabled";
CREATE INDEX "purchase_case_company_status_created_idx" ON "purchase_case"("company_id", "status", "created_at" DESC);
CREATE INDEX "purchase_order_company_status_date_idx" ON "purchase_order"("company_id", "status", "issue_date" DESC);
CREATE INDEX "purchase_invoice_company_status_date_idx" ON "purchase_invoice"("company_id", "status", "issue_date" DESC);
CREATE INDEX "purchase_line_owner_idx" ON "purchase_line"("company_id", "owner_type", "owner_id");
CREATE INDEX "entity_relation_source_idx" ON "entity_relation"("company_id", "source_module", "source_type", "source_id");
CREATE INDEX "entity_relation_target_idx" ON "entity_relation"("company_id", "target_module", "target_type", "target_id");
CREATE INDEX "purchase_allocation_target_idx" ON "purchase_allocation"("company_id", "target_module", "target_type", "target_id");
CREATE INDEX "purchase_file_owner_idx" ON "purchase_file"("company_id", "owner_type", "owner_id");

ALTER TABLE "purchase_workflow" ADD CONSTRAINT "purchase_workflow_company_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE;
ALTER TABLE "purchase_case" ADD CONSTRAINT "purchase_case_company_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE;
ALTER TABLE "purchase_supplier_profile" ADD CONSTRAINT "purchase_supplier_contact_fkey" FOREIGN KEY ("contact_id") REFERENCES "contact"("id") ON DELETE CASCADE;
ALTER TABLE "purchase_order" ADD CONSTRAINT "purchase_order_case_fkey" FOREIGN KEY ("case_id") REFERENCES "purchase_case"("id") ON DELETE CASCADE;
ALTER TABLE "purchase_invoice" ADD CONSTRAINT "purchase_invoice_case_fkey" FOREIGN KEY ("case_id") REFERENCES "purchase_case"("id") ON DELETE CASCADE;
ALTER TABLE "purchase_stage_record" ADD CONSTRAINT "purchase_stage_case_fkey" FOREIGN KEY ("case_id") REFERENCES "purchase_case"("id") ON DELETE CASCADE;
ALTER TABLE "entity_relation" ADD CONSTRAINT "entity_relation_source_relation_fkey" FOREIGN KEY ("source_relation_id") REFERENCES "entity_relation"("id") ON DELETE SET NULL;
ALTER TABLE "purchase_allocation" ADD CONSTRAINT "purchase_allocation_line_fkey" FOREIGN KEY ("purchase_line_id") REFERENCES "purchase_line"("id") ON DELETE CASCADE;
ALTER TABLE "purchase_file" ADD CONSTRAINT "purchase_file_asset_fkey" FOREIGN KEY ("file_asset_id") REFERENCES "file_asset"("id") ON DELETE CASCADE;

-- No browser client reads these tables directly. Keep them behind the Hono API.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'purchase_workflow', 'purchase_case', 'purchase_supplier_profile',
    'purchase_order', 'purchase_invoice', 'purchase_line',
    'purchase_stage_record', 'entity_relation', 'purchase_allocation', 'purchase_file'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      table_name || '_service_all', table_name
    );
  END LOOP;
END $$;

-- Preserve historical purchasing information as explicit migrated relations.
INSERT INTO "purchase_workflow" ("company_id", "name", "preset", "is_default", "capabilities", "stages", "policies")
SELECT DISTINCT i."company_id", 'Flujo simple', 'SIMPLE', true,
  '{"requests":false,"quotes":false,"approvals":false,"purchaseOrders":false,"receipts":false,"invoices":true,"payments":false,"inventoryRelations":true}'::jsonb,
  '[{"type":"INVOICE","mode":"REQUIRED"},{"type":"RELATE","mode":"REQUIRED"},{"type":"CLOSE","mode":"REQUIRED"}]'::jsonb,
  '[]'::jsonb
FROM "inv_item" i
WHERE i."acquisition_origin" = 'PURCHASE';

WITH migrated_cases AS (
  INSERT INTO "purchase_case" ("company_id", "workflow_id", "number", "title", "description", "currency", "estimated_total")
  SELECT i."company_id", w."id", 'LEG-' || left(replace(i."id"::text, '-', ''), 12),
    'Compra heredada · ' || i."asset_tag",
    concat_ws(' · ', nullif(i."vendor_name", ''), CASE WHEN i."invoice_number" IS NOT NULL THEN 'Factura ' || i."invoice_number" END),
    'MXN', i."purchase_price"
  FROM "inv_item" i
  JOIN "purchase_workflow" w ON w."company_id" = i."company_id" AND w."preset" = 'SIMPLE' AND w."is_default"
  WHERE i."acquisition_origin" = 'PURCHASE'
  RETURNING "id", "company_id", "number"
)
INSERT INTO "entity_relation" (
  "company_id", "source_module", "source_type", "source_id",
  "target_module", "target_type", "target_id", "relation_type", "origin", "metadata"
)
SELECT c."company_id", 'runly.purchases', 'purchase_case', c."id",
  'runly.inventory', 'inventory_item', i."id", 'ACQUIRED_IN', 'MIGRATED',
  jsonb_strip_nulls(jsonb_build_object(
    'purchaseDate', i."purchase_date",
    'purchasePrice', i."purchase_price",
    'vendorName', i."vendor_name",
    'invoiceNumber', i."invoice_number"
  ))
FROM migrated_cases c
JOIN "inv_item" i
  ON i."company_id" = c."company_id"
 AND c."number" = 'LEG-' || left(replace(i."id"::text, '-', ''), 12);
