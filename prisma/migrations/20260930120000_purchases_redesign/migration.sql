-- runly.purchases redesign: requests, quotes, approvals, receipts, payment
-- data on invoices and richer purchase lines. Forward-only; the first
-- iteration (20260929130000_core_purchases) stays untouched.

CREATE TABLE "purchase_request" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "company_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "number" VARCHAR(40) NOT NULL,
  "title" VARCHAR(255) NOT NULL,
  "justification" VARCHAR(2000),
  "needed_by" DATE,
  "priority" VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
  "status" VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  "estimated_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
  "requester_id" UUID,
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_request_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_quote" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "company_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "request_id" UUID,
  "supplier_id" UUID,
  "reference" VARCHAR(100),
  "issue_date" DATE NOT NULL,
  "valid_until" DATE,
  "currency" VARCHAR(3) NOT NULL DEFAULT 'MXN',
  "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "tax" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "delivery_days" INTEGER,
  "status" VARCHAR(30) NOT NULL DEFAULT 'RECEIVED',
  "notes" VARCHAR(2000),
  "created_by_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_quote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_approval" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "company_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "owner_type" VARCHAR(30) NOT NULL,
  "owner_id" UUID NOT NULL,
  "reason" VARCHAR(500),
  "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "requested_by_id" UUID,
  "decided_by_id" UUID,
  "decided_at" TIMESTAMPTZ,
  "comment" VARCHAR(1000),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_approval_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_receipt" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "company_id" UUID NOT NULL,
  "case_id" UUID NOT NULL,
  "order_id" UUID NOT NULL,
  "number" VARCHAR(40) NOT NULL,
  "received_at" DATE NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
  "notes" VARCHAR(2000),
  "received_by_id" UUID,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_receipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "purchase_receipt_line" (
  "id" UUID NOT NULL DEFAULT uuidv7(),
  "company_id" UUID NOT NULL,
  "receipt_id" UUID NOT NULL,
  "order_line_id" UUID NOT NULL,
  "quantity" DECIMAL(14,4) NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "purchase_receipt_line_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "purchase_line"
  ADD COLUMN "item_kind" VARCHAR(20) NOT NULL DEFAULT 'GOODS',
  ADD COLUMN "unit" VARCHAR(20),
  ADD COLUMN "tax_rate" DECIMAL(6,4) NOT NULL DEFAULT 0,
  ADD COLUMN "received_quantity" DECIMAL(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN "inventory_category_id" UUID;

ALTER TABLE "purchase_order"
  ADD COLUMN "expected_date" DATE,
  ADD COLUMN "supplier_reference" VARCHAR(100),
  ADD COLUMN "payment_terms" VARCHAR(120),
  ADD COLUMN "issued_at" TIMESTAMPTZ,
  ADD COLUMN "closed_at" TIMESTAMPTZ,
  ADD COLUMN "cancelled_at" TIMESTAMPTZ;

ALTER TABLE "purchase_invoice"
  ADD COLUMN "due_date" DATE,
  ADD COLUMN "paid_at" DATE,
  ADD COLUMN "payment_reference" VARCHAR(120),
  ADD COLUMN "payment_method" VARCHAR(40),
  ADD COLUMN "paid_amount" DECIMAL(14,2) NOT NULL DEFAULT 0;

ALTER TABLE "purchase_case"
  ADD COLUMN "supplier_id" UUID,
  ADD COLUMN "request_id" UUID;

CREATE UNIQUE INDEX "purchase_request_company_id_number_key" ON "purchase_request"("company_id", "number");
CREATE UNIQUE INDEX "purchase_receipt_company_id_number_key" ON "purchase_receipt"("company_id", "number");
CREATE INDEX "purchase_request_company_status_created_idx" ON "purchase_request"("company_id", "status", "created_at" DESC);
CREATE INDEX "purchase_request_case_idx" ON "purchase_request"("case_id");
CREATE INDEX "purchase_quote_company_status_idx" ON "purchase_quote"("company_id", "status");
CREATE INDEX "purchase_quote_case_idx" ON "purchase_quote"("case_id");
CREATE INDEX "purchase_quote_supplier_idx" ON "purchase_quote"("supplier_id");
CREATE INDEX "purchase_approval_company_status_idx" ON "purchase_approval"("company_id", "status", "created_at" DESC);
CREATE INDEX "purchase_approval_owner_idx" ON "purchase_approval"("company_id", "owner_type", "owner_id");
CREATE INDEX "purchase_approval_case_idx" ON "purchase_approval"("case_id");
CREATE INDEX "purchase_receipt_company_date_idx" ON "purchase_receipt"("company_id", "received_at" DESC);
CREATE INDEX "purchase_receipt_order_idx" ON "purchase_receipt"("order_id");
CREATE INDEX "purchase_receipt_case_idx" ON "purchase_receipt"("case_id");
CREATE INDEX "purchase_receipt_line_receipt_idx" ON "purchase_receipt_line"("receipt_id");
CREATE INDEX "purchase_receipt_line_order_line_idx" ON "purchase_receipt_line"("order_line_id");
CREATE INDEX "purchase_invoice_company_due_idx" ON "purchase_invoice"("company_id", "due_date");
CREATE INDEX "purchase_case_supplier_idx" ON "purchase_case"("supplier_id");

ALTER TABLE "purchase_request" ADD CONSTRAINT "purchase_request_company_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE;
ALTER TABLE "purchase_request" ADD CONSTRAINT "purchase_request_case_fkey" FOREIGN KEY ("case_id") REFERENCES "purchase_case"("id") ON DELETE CASCADE;
ALTER TABLE "purchase_quote" ADD CONSTRAINT "purchase_quote_company_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE;
ALTER TABLE "purchase_quote" ADD CONSTRAINT "purchase_quote_case_fkey" FOREIGN KEY ("case_id") REFERENCES "purchase_case"("id") ON DELETE CASCADE;
ALTER TABLE "purchase_quote" ADD CONSTRAINT "purchase_quote_request_fkey" FOREIGN KEY ("request_id") REFERENCES "purchase_request"("id") ON DELETE SET NULL;
ALTER TABLE "purchase_approval" ADD CONSTRAINT "purchase_approval_company_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE;
ALTER TABLE "purchase_approval" ADD CONSTRAINT "purchase_approval_case_fkey" FOREIGN KEY ("case_id") REFERENCES "purchase_case"("id") ON DELETE CASCADE;
ALTER TABLE "purchase_receipt" ADD CONSTRAINT "purchase_receipt_company_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE;
ALTER TABLE "purchase_receipt" ADD CONSTRAINT "purchase_receipt_case_fkey" FOREIGN KEY ("case_id") REFERENCES "purchase_case"("id") ON DELETE CASCADE;
ALTER TABLE "purchase_receipt" ADD CONSTRAINT "purchase_receipt_order_fkey" FOREIGN KEY ("order_id") REFERENCES "purchase_order"("id") ON DELETE CASCADE;
ALTER TABLE "purchase_receipt_line" ADD CONSTRAINT "purchase_receipt_line_receipt_fkey" FOREIGN KEY ("receipt_id") REFERENCES "purchase_receipt"("id") ON DELETE CASCADE;
ALTER TABLE "purchase_receipt_line" ADD CONSTRAINT "purchase_receipt_line_order_line_fkey" FOREIGN KEY ("order_line_id") REFERENCES "purchase_line"("id") ON DELETE CASCADE;

-- Same posture as the first migration: API-only access.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'purchase_request', 'purchase_quote', 'purchase_approval',
    'purchase_receipt', 'purchase_receipt_line'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
      table_name || '_service_all', table_name
    );
  END LOOP;
END $$;
