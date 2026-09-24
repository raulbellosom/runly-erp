-- Optional custom display name for a CallRecording, so it can be renamed to
-- something more identifiable than the auto-generated date/time label
-- (ChatRecordingsGallery.jsx). Nullable, no default: null means "use the
-- date label", same convention as CallTranscript.failureReason etc.
ALTER TABLE "call_recording" ADD COLUMN "title" TEXT;
