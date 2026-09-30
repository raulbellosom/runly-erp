-- runly.purchases numbering: the document folio ("number") becomes user data
-- (company formats, historical folios) and the automatic per-company
-- consecutive moves to its own column, "sequence", so both never collide.

ALTER TABLE "purchase_workflow" ADD COLUMN "numbering" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "purchase_case"    ADD COLUMN "sequence" INTEGER;
ALTER TABLE "purchase_request" ADD COLUMN "sequence" INTEGER;
ALTER TABLE "purchase_order"   ADD COLUMN "sequence" INTEGER;
ALTER TABLE "purchase_receipt" ADD COLUMN "sequence" INTEGER;
ALTER TABLE "purchase_invoice" ADD COLUMN "sequence" INTEGER;

-- Backfill in creation order per company; existing folios are kept as-is.
UPDATE "purchase_case" t SET "sequence" = s.n FROM (
  SELECT "id", row_number() OVER (PARTITION BY "company_id" ORDER BY "created_at", "id") AS n FROM "purchase_case"
) s WHERE t."id" = s."id";
UPDATE "purchase_request" t SET "sequence" = s.n FROM (
  SELECT "id", row_number() OVER (PARTITION BY "company_id" ORDER BY "created_at", "id") AS n FROM "purchase_request"
) s WHERE t."id" = s."id";
UPDATE "purchase_order" t SET "sequence" = s.n FROM (
  SELECT "id", row_number() OVER (PARTITION BY "company_id" ORDER BY "created_at", "id") AS n FROM "purchase_order"
) s WHERE t."id" = s."id";
UPDATE "purchase_receipt" t SET "sequence" = s.n FROM (
  SELECT "id", row_number() OVER (PARTITION BY "company_id" ORDER BY "created_at", "id") AS n FROM "purchase_receipt"
) s WHERE t."id" = s."id";
UPDATE "purchase_invoice" t SET "sequence" = s.n FROM (
  SELECT "id", row_number() OVER (PARTITION BY "company_id" ORDER BY "created_at", "id") AS n FROM "purchase_invoice"
) s WHERE t."id" = s."id";

ALTER TABLE "purchase_case"    ALTER COLUMN "sequence" SET NOT NULL;
ALTER TABLE "purchase_request" ALTER COLUMN "sequence" SET NOT NULL;
ALTER TABLE "purchase_order"   ALTER COLUMN "sequence" SET NOT NULL;
ALTER TABLE "purchase_receipt" ALTER COLUMN "sequence" SET NOT NULL;
ALTER TABLE "purchase_invoice" ALTER COLUMN "sequence" SET NOT NULL;

CREATE UNIQUE INDEX "purchase_case_company_sequence_key"    ON "purchase_case"("company_id", "sequence");
CREATE UNIQUE INDEX "purchase_request_company_sequence_key" ON "purchase_request"("company_id", "sequence");
CREATE UNIQUE INDEX "purchase_order_company_sequence_key"   ON "purchase_order"("company_id", "sequence");
CREATE UNIQUE INDEX "purchase_receipt_company_sequence_key" ON "purchase_receipt"("company_id", "sequence");
CREATE UNIQUE INDEX "purchase_invoice_company_sequence_key" ON "purchase_invoice"("company_id", "sequence");
