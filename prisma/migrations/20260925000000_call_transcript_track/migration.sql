-- prisma/migrations/20260925000000_call_transcript_track/migration.sql
-- Etapa 3 de docs/TRANSCRIPTION_IMPLEMENTATION_PLAN.md — modelo de datos para
-- V2 (identificacion de hablantes, Alternativa B): una fila por cada pista de
-- audio capturada via EgressClient.startTrackEgress. Aditiva: tabla nueva,
-- sin tocar tablas existentes. Ver docs/TRANSCRIPTION_SPEC.md §3.1.

CREATE TABLE "call_transcript_track" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "transcript_id" UUID NOT NULL,
    "egress_id" TEXT NOT NULL,
    "livekit_identity" TEXT NOT NULL,
    "speaker_user_id" UUID,
    "speaker_guest_id" UUID,
    "object_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'STARTING',
    "failure_reason" TEXT,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "call_transcript_track_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "call_transcript_track_transcript_id_livekit_identity_key" ON "call_transcript_track"("transcript_id", "livekit_identity");
CREATE INDEX "call_transcript_track_status_idx" ON "call_transcript_track"("status");

ALTER TABLE "call_transcript_track" ADD CONSTRAINT "call_transcript_track_transcript_id_fkey"
    FOREIGN KEY ("transcript_id") REFERENCES "call_transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "call_transcript_track" ADD CONSTRAINT "call_transcript_track_speaker_user_id_fkey"
    FOREIGN KEY ("speaker_user_id") REFERENCES "user_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "call_transcript_track" ADD CONSTRAINT "call_transcript_track_speaker_guest_id_fkey"
    FOREIGN KEY ("speaker_guest_id") REFERENCES "call_guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
