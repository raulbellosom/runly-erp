-- Persisted register order for ledger transactions. The register's
-- consecutive ("#") is ROW_NUMBER() over this column, so rows keep their
-- place when edited and can be reordered by drag and drop. New rows take the
-- next sequence value (append to the end of their account).
ALTER TABLE "ledger_transaction" ADD COLUMN "position" SERIAL NOT NULL;

-- Backfill in the order the register used before (fecha, created_at, id), per
-- account. updated_at is bumped so incremental offline sync re-pulls every row
-- with its new position.
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY account_id, fecha, created_at, id)::int4 AS rn
  FROM "ledger_transaction"
)
UPDATE "ledger_transaction" t
SET "position" = ordered.rn, "updated_at" = NOW()
FROM ordered
WHERE ordered.id = t.id;

SELECT setval(
  pg_get_serial_sequence('"ledger_transaction"', 'position'),
  (SELECT COALESCE(MAX("position"), 0) + 1 FROM "ledger_transaction"),
  false
);

CREATE INDEX "ledger_transaction_account_id_position_idx" ON "ledger_transaction"("account_id", "position");
