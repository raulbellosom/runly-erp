import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
  Button, Skeleton, ErrorState, ConfirmDialog, AssistantWordmark,
} from "@runly/ui";
import { Copy, Download, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useTranscript, useRetryTranscript, useRegenerateTranscript } from "../hooks/useConversationTranscripts";
import { copyTranscriptToClipboard, downloadTranscriptPdf } from "../lib/transcriptExport";
import { TranscriptAnalysisDialog } from "./TranscriptAnalysisDialog";

function formatTimestamp(ms) {
  const totalSeconds = Math.floor((ms ?? 0) / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// Hues spread around the wheel so adjacent speakers stay distinguishable.
const SPEAKER_HUES = [217, 142, 32, 280, 350, 187, 48, 12];

// Mixing with the foreground keeps the tint readable in light and dark themes.
function speakerColor(index) {
  const hue = SPEAKER_HUES[index % SPEAKER_HUES.length];
  return `color-mix(in srgb, hsl(${hue} 75% 55%) 80%, hsl(var(--foreground)))`;
}

function initials(label) {
  const parts = label.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[1][0] : "")).toUpperCase() || "?";
}

// speakerLabel is only set for PER_TRACK transcripts (captura por pista,
// docs/TRANSCRIPTION_SPEC.md §0.2). Consecutive segments from the same speaker
// are grouped into one turn; MIXED segments form a single unlabeled turn each.
function groupTurns(segments) {
  const colorIndex = new Map();
  const turns = [];
  for (const segment of segments) {
    const label = segment.speakerLabel || null;
    if (label && !colorIndex.has(label)) colorIndex.set(label, colorIndex.size);
    const last = turns[turns.length - 1];
    if (label && last?.label === label) {
      last.segments.push(segment);
    } else {
      turns.push({ key: segment.id, label, segments: [segment] });
    }
  }
  return { turns, colorIndex };
}

function SpeakerAvatar({ label, color }) {
  return (
    <span
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
      style={{
        color,
        backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 40%, transparent)`,
      }}
    >
      {initials(label)}
    </span>
  );
}

function TurnBlock({ turn, color }) {
  const multi = turn.segments.length > 1;
  if (!turn.label) {
    const segment = turn.segments[0];
    return (
      <div className="flex gap-3 px-2 py-1.5 text-sm">
        <span className="shrink-0 pt-0.5 font-mono text-xs text-[hsl(var(--muted-foreground))]">
          {formatTimestamp(segment.startMs)}
        </span>
        <p className="min-w-0 leading-relaxed">{segment.text}</p>
      </div>
    );
  }
  return (
    <div className="flex gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-[hsl(var(--muted)/0.35)]">
      <SpeakerAvatar label={turn.label} color={color} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold" style={{ color }}>{turn.label}</span>
          <span className="shrink-0 font-mono text-[11px] text-[hsl(var(--muted-foreground))]">
            {formatTimestamp(turn.segments[0].startMs)}
          </span>
        </div>
        <div className="mt-0.5 space-y-1">
          {turn.segments.map((segment, i) => (
            <div key={segment.id} className="group/line flex gap-2 text-sm leading-relaxed">
              <p className="min-w-0 flex-1">{segment.text}</p>
              {multi && i > 0 && (
                <span className="shrink-0 pt-0.5 font-mono text-[11px] text-[hsl(var(--muted-foreground))] opacity-0 transition-opacity group-hover/line:opacity-100">
                  {formatTimestamp(segment.startMs)}
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function TranscriptBody({ segments }) {
  const { turns, colorIndex } = groupTurns(segments);
  const speakers = [...colorIndex.entries()];
  return (
    <>
      {speakers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {speakers.map(([label, index]) => (
            <span
              key={label}
              className="inline-flex items-center gap-1.5 rounded-full border border-[hsl(var(--border))] px-2.5 py-0.5 text-xs"
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: speakerColor(index) }} />
              {label}
            </span>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {turns.map((turn) => (
          <TurnBlock
            key={turn.key}
            turn={turn}
            color={turn.label ? speakerColor(colorIndex.get(turn.label)) : undefined}
          />
        ))}
      </div>
    </>
  );
}

export function TranscriptViewerDialog({ transcriptId, open, onOpenChange, conversationId, callTitle }) {
  const { data, isLoading, isError, refetch } = useTranscript(transcriptId, open);
  const retryTranscript = useRetryTranscript(conversationId);
  const regenerateTranscript = useRegenerateTranscript(conversationId);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const transcript = data?.data ?? data;

  async function handleCopy() {
    try {
      await copyTranscriptToClipboard(transcript);
      toast.success("Transcripción copiada.");
    } catch (err) {
      toast.error(err?.message ?? "No se pudo copiar la transcripción.");
    }
  }

  async function handleDownloadPdf() {
    try {
      await downloadTranscriptPdf(transcript, { callTitle });
    } catch (err) {
      toast.error(err?.message ?? "No se pudo generar el PDF.");
    }
  }

  async function handleRegenerate() {
    try {
      await regenerateTranscript.mutateAsync(transcriptId);
    } catch (err) {
      toast.error(err?.message ?? "No se pudo regenerar la transcripción.");
    } finally {
      setConfirmRegenerate(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="2xl" className="flex max-h-[85vh] flex-col overflow-hidden">
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

        {transcript?.status === "CAPTURING" && (
          <p className="py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
            Capturando el audio de cada participante — la transcripción comenzará cuando la llamada termine.
          </p>
        )}

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
          <>
            {transcript.sourceKind === "MIXED" && (
              <p className="rounded-lg bg-[hsl(var(--muted)/0.5)] px-3 py-2 text-xs text-[hsl(var(--muted-foreground))]">
                Esta transcripción se generó del audio mezclado de la grabación y no identifica quién habló.
                Las grabaciones nuevas capturan el micrófono de cada participante por separado para lograrlo.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 border-b border-[hsl(var(--border))] pb-3">
              <Button variant="outline" size="sm" onClick={handleCopy}>
                <Copy className="h-3.5 w-3.5" />
                Copiar
              </Button>
              <Button variant="outline" size="sm" onClick={handleDownloadPdf}>
                <Download className="h-3.5 w-3.5" />
                Descargar PDF
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={regenerateTranscript.isPending}
                onClick={() => setConfirmRegenerate(true)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Generar de nuevo
              </Button>
            </div>
            <div
              className="mb-2 flex items-center gap-3 rounded-xl border p-3"
              style={{
                borderColor: "color-mix(in srgb, var(--brand-primary) 35%, transparent)",
                backgroundColor: "color-mix(in srgb, var(--brand-primary) 8%, transparent)",
              }}
            >
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{ backgroundColor: "var(--brand-primary)", color: "var(--brand-primary-foreground)" }}
              >
                <Sparkles className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">Analizar con <AssistantWordmark /></p>
                <p className="text-xs text-[hsl(var(--muted-foreground))]">
                  Resumen, acuerdos y acciones propuestas a partir de la llamada.
                </p>
              </div>
              <Button
                size="sm"
                className="shrink-0"
                style={{ backgroundColor: "var(--brand-primary)", color: "var(--brand-primary-foreground)" }}
                onClick={() => setAnalysisOpen(true)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                Analizar
              </Button>
            </div>
            {transcript.segments?.length
              ? <TranscriptBody segments={transcript.segments} />
              : <p className="py-6 text-center text-sm text-[hsl(var(--muted-foreground))]">Sin contenido reconocible.</p>}
          </>
        )}
      </DialogContent>

      <ConfirmDialog
        open={confirmRegenerate}
        onOpenChange={setConfirmRegenerate}
        title="Generar de nuevo"
        description="Se reemplazará el contenido actual de esta transcripción. Esta acción no se puede deshacer."
        confirmLabel="Generar de nuevo"
        variant="destructive"
        loading={regenerateTranscript.isPending}
        onConfirm={handleRegenerate}
      />

      <TranscriptAnalysisDialog transcriptId={transcriptId} open={analysisOpen} onOpenChange={setAnalysisOpen} />
    </Dialog>
  );
}
