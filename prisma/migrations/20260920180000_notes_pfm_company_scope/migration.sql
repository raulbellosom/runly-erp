-- Tags are independent in each company and in the personal (NULL) scope.
ALTER TABLE note_tags DROP CONSTRAINT note_tags_owner_user_id_name_key;
CREATE UNIQUE INDEX note_tags_scope_name_key
  ON note_tags (owner_user_id, company_id, name) NULLS NOT DISTINCT;

-- An annotation is private to its author and wallet, even when several users
-- can read the same bank transaction. Preserve existing annotations.
DROP INDEX pfm_ledger_enrichment_ledger_transaction_id_key;
CREATE UNIQUE INDEX pfm_enrichment_scope_key
  ON pfm_ledger_enrichment (company_id, owner_id, wallet_id, ledger_transaction_id);
