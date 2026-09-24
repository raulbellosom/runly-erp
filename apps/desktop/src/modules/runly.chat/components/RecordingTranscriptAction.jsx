import { useState } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@runly/ui";
import { AlertCircle, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRequestTranscript } from "../hooks/useConversationTranscripts";
import { TranscriptViewerDialog } from "./TranscriptViewerDialog";

// Per-recording action shown in ChatRecordingsGallery.jsx — one CallRecording
// maps to at most one active/most-recent CallTranscript (server-enforced,
// 409 on a duplicate request for the same call). V1 only ever transcribes
// audio already captured by an existing READY recording — see
// docs/TRANSCRIPTION_SPEC.md §0.1 for why this dependency exists.
function formatCallTitle(recording) {
  if (recording?.title) return `Transcripción — ${recording.title}`;
  if (!recording?.startedAt) return "Transcripción de llamada";
  const formatted = new Date(recording.startedAt).toLocaleString("es-MX", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  return `Transcripción — ${formatted}`;
}

export function RecordingTranscriptAction({ recording, transcript, conversationId }) {
  const [viewerOpen, setViewerOpen] = useState(false);
  const requestTranscript = useRequestTranscript(conversationId);
  const callTitle = formatCallTitle(recording);

  if (recording.status !== "READY") return null;

  async function handleRequest() {
    try {
      await requestTranscript.mutateAsync(recording.callId);
    } catch (err) {
      toast.error(err?.message ?? "No se pudo solicitar la transcripción.");
    }
  }

  if (!transcript) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleRequest}
              disabled={requestTranscript.isPending}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--primary)/0.1)] hover:text-[hsl(var(--primary))] disabled:opacity-50"
              aria-label="Transcribir"
            >
              {requestTranscript.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <FileText className="h-4 w-4" />}
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Transcribir</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (["PENDING", "PROCESSING"].includes(transcript.status)) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[hsl(var(--muted-foreground))]" aria-label="Transcribiendo" />
          </TooltipTrigger>
          <TooltipContent side="top">Transcribiendo…</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  if (transcript.status === "FAILED") {
    return (
      <>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setViewerOpen(true)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-red-500 hover:bg-red-500/10"
                aria-label="Transcripción fallida"
              >
                <AlertCircle className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Transcripción fallida — reintentar</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TranscriptViewerDialog
          transcriptId={transcript.id}
          open={viewerOpen}
          onOpenChange={setViewerOpen}
          conversationId={conversationId}
          callTitle={callTitle}
        />
      </>
    );
  }

  // READY
  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setViewerOpen(true)}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]"
              aria-label="Ver transcripción"
            >
              <FileText className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">Ver transcripción</TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <TranscriptViewerDialog
        transcriptId={transcript.id}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
        conversationId={conversationId}
        callTitle={callTitle}
      />
    </>
  );
}
