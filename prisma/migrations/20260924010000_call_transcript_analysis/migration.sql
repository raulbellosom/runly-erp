-- CreateTable
CREATE TABLE "call_transcript_analysis" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "transcript_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "summary" TEXT NOT NULL,
    "decisions" JSONB NOT NULL,
    "action_items" JSONB NOT NULL,
    "proposed_events" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "generated_by_user_id" UUID NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_task_ids" JSONB,
    "committed_event_ids" JSONB,
    "committed_at" TIMESTAMP(3),

    CONSTRAINT "call_transcript_analysis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "call_transcript_analysis_transcript_id_key" ON "call_transcript_analysis"("transcript_id");

-- CreateIndex
CREATE INDEX "call_transcript_analysis_company_id_idx" ON "call_transcript_analysis"("company_id");

-- AddForeignKey
ALTER TABLE "call_transcript_analysis" ADD CONSTRAINT "call_transcript_analysis_transcript_id_fkey" FOREIGN KEY ("transcript_id") REFERENCES "call_transcript"("id") ON DELETE CASCADE ON UPDATE CASCADE;
