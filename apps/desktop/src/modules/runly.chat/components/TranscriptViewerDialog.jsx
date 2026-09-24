import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  Button, Skeleton, ErrorState,
} from "@runly/ui";
import { useTranscript, useRetryTranscript } from "../hooks/useConversationTranscripts";

function formatTimestamp(ms) {
  const totalSeconds = Math.floor((ms ?? 0) / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Segments only ever carry speakerLabel/speakerUserId/speakerGuestId once V2
// (captura por pista, docs/TRANSCRIPTION_SPEC.md §0.2) ships — V1 (audio
// mezclado) never sets them, so every segment renders without a speaker
// prefix today. This component already supports both without changes.
function SegmentRow({ segment }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <span className="shrink-0 font-mono text-xs text-[hsl(var(--muted-foreground))]">
        {formatTimestamp(segment.startMs)}
      </span>
      <p className="min-w-0">
        {segment.speakerLabel && (
          <span className="font-medium">{segment.speakerLabel}: </span>
        )}
        {segment.text}
      </p>
    </div>
  );
}

export function TranscriptViewerDialog({ transcriptId, open, onOpenChange, conversationId }) {
  const { data, isLoading, isError, refetch } = useTranscript(transcriptId, open);
  const retryTranscript = useRetryTranscript(conversationId);
  const transcript = data?.data ?? data;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>Transcripción</DialogTitle>
          <DialogDescription>
            {transcript?.status === "READY"
              ? "Generada automáticamente — puede contener errores de reconocimiento."
              : "El contenido puede tardar unos minutos en procesarse."}
          </DialogDescription>
        </DialogHeader>

        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        )}

        {isError && <ErrorState title="No se pudo cargar la transcripción" onRetry={refetch} />}

        {transcript && ["PENDING", "PROCESSING"].includes(transcript.status) && (
          <p className="py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
            Transcribiendo la llamada…
          </p>
        )}

        {transcript?.status === "FAILED" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              {transcript.failureReason || "No se pudo generar la transcripción."}
            </p>
            <Button
              size="sm"
              disabled={retryTranscript.isPending}
              onClick={() => retryTranscript.mutate(transcriptId)}
            >
              Reintentar
            </Button>
          </div>
        )}

        {transcript?.status === "READY" && (
          <div className="max-h-[55vh] overflow-y-auto divide-y divide-[hsl(var(--border))]">
            {transcript.segments?.length
              ? transcript.segments.map((segment) => <SegmentRow key={segment.id} segment={segment} />)
              : <p className="py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">Sin contenido reconocible.</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
