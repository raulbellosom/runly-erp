-- prisma/migrations/20260924000001_call_transcript_finalized_at/migration.sql
-- Separada de 20260924000000_add_call_transcript (ya aplicada) por la regla del
-- proyecto de nunca editar una migracion ya aplicada. Columna usada por el sweep
-- de la API (no el contenedor Python) para marcar que ya fijo expires_at segun
-- la retencion configurada y publico el mensaje de sistema de "transcripcion lista".

ALTER TABLE "call_transcript" ADD COLUMN "finalized_at" TIMESTAMP(3);
