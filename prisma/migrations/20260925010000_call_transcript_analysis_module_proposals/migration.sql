-- prisma/migrations/20260925010000_call_transcript_analysis_module_proposals/migration.sql
-- docs/superpowers/specs/2026-09-25-transcript-module-proposals-design.md §11.
-- Aditiva: una sola columna nullable, sin tocar filas existentes.

ALTER TABLE "call_transcript_analysis" ADD COLUMN "module_proposals" JSONB;
