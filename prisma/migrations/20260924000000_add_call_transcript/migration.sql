-- prisma/migrations/20260924000000_add_call_transcript/migration.sql
-- Etapa 2 de docs/TRANSCRIPTION_IMPLEMENTATION_PLAN.md — modelo de datos de
-- transcripcion de llamadas (V1: transcripcion de audio mezclado de la
-- grabacion existente). Aditiva: tablas nuevas, sin tocar tablas existentes.

CREATE TYPE "CallTranscriptSourceKind" AS ENUM ('MIXED', 'PER_TRACK');

CREATE TABLE "call_transcript" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "call_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "recording_id" UUID,
    "source_kind" "CallTranscriptSourceKind" NOT NULL DEFAULT 'MIXED',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_by_user_id" UUID NOT NULL,
    "model" TEXT,
    "language" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "failure_reason" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "expires_at" TIMESTAMP(3),
    "lease_expires_at" TIMESTAMP(3),
    "worker_instance_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_transcript_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "call_transcript_segment" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "transcript_id" UUID NOT NULL,
    "start_ms" INTEGER NOT NULL,
    "end_ms" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "speaker_label" TEXT,
    "speaker_user_id" UUID,
    "speaker_guest_id" UUID,
    "confidence" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_transcript_segment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "call_transcript_call_id_idx" ON "call_transcript"("call_id");
CREATE INDEX "call_transcript_conversation_id_idx" ON "call_transcript"("conversation_id");
CREATE INDEX "call_transcript_company_id_created_at_idx" ON "call_transcript"("company_id", "created_at");
CREATE INDEX "call_transcript_status_idx" ON "call_transcript"("status");
CREATE INDEX "call_transcript_expires_at_idx" ON "call_transcript"("expires_at");

CREATE INDEX "call_transcript_segment_transcript_id_start_ms_idx" ON "call_transcript_segment"("transcript_id", "start_ms");

ALTER TABLE "call_transcript" ADD CONSTRAINT "call_transcript_call_id_fkey"
    FOREIGN KEY ("call_id") REFERENCES "call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "call_transcript" ADD CONSTRAINT "call_transcript_recording_id_fkey"
    FOREIGN KEY ("recording_id") REFERENCES "call_recording"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "call_transcript" ADD CONSTRAINT "call_transcript_requested_by_user_id_fkey"
    FOREIGN KEY ("requested_by_user_id") REFERENCES "user_profile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "call_transcript_segment" ADD CONSTRAINT "call_transcript_segment_transcript_id_fkey"
    FOREIGN KEY ("transcript_id") REFERENCES "call_transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "call_transcript_segment" ADD CONSTRAINT "call_transcript_segment_speaker_user_id_fkey"
    FOREIGN KEY ("speaker_user_id") REFERENCES "user_profile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "call_transcript_segment" ADD CONSTRAINT "call_transcript_segment_speaker_guest_id_fkey"
    FOREIGN KEY ("speaker_guest_id") REFERENCES "call_guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
