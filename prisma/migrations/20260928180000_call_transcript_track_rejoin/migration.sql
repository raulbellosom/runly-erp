-- Captura por pista (V2): permitir varias pistas por participante en una misma
-- transcripcion (reconexiones: cada reconexion publica una pista nueva con otro
-- track sid), guardar el desfase de cada pista respecto al inicio de la
-- captura (para alinear a quien entra tarde o se reconecta), y marcar cuando
-- la captura se detuvo (explicitamente o por fin de llamada), para no
-- entregar al worker una captura que sigue abierta. Aditiva.

ALTER TABLE "call_transcript" ADD COLUMN "capture_stopped_at" TIMESTAMP(3);

ALTER TABLE "call_transcript_track" ADD COLUMN "track_sid" TEXT;
ALTER TABLE "call_transcript_track" ADD COLUMN "offset_ms" INTEGER NOT NULL DEFAULT 0;

DROP INDEX "call_transcript_track_transcript_id_livekit_identity_key";
CREATE INDEX "call_transcript_track_transcript_id_livekit_identity_idx" ON "call_transcript_track"("transcript_id", "livekit_identity");
CREATE UNIQUE INDEX "call_transcript_track_transcript_id_track_sid_key" ON "call_transcript_track"("transcript_id", "track_sid");
