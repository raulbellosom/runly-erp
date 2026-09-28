import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "./Dialog.jsx";
import { Button } from "./Button.jsx";
import { TextareaField } from "./FormFields.jsx";
import { FileUploader } from "./FileUploader.jsx";
import { FileCard } from "./FileCard.jsx";

const MAX_ATTACHMENTS = 3;

// Mirrors packages/validators/src/support.js's ALLOWED_ATTACHMENT_MIME_TYPES
// — keep both lists in sync if this ever changes. Duplicated here rather
// than importing @runly/validators (packages/ui has no existing dependency
// on it, and this is a short, rarely-changing list) — see that file's own
// comment pointing back at this one.
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const ATTACHMENT_ACCEPT = [
  "image/*",
  "application/pdf",
  ".pdf",
  "text/*",
  ".txt",
  ".csv",
  ".xls",
  ".xlsx",
  ".doc",
  ".docx",
].join(",");

// Presentational only — no API/auth knowledge, matching the rest of
// packages/ui. The host (apps/desktop's BugReportHost) owns the screenshot
// capture, the attachment-to-dataURL conversion, and the actual send; this
// component just renders what's captured/picked and forwards the user's
// input back up.
export function BugReportDialog({
  open,
  onOpenChange,
  context,
  errorMessage,
  screenshotDataUrl,
  description,
  onDescriptionChange,
  attachments = [],
  onAttachmentsChange,
  onSubmit,
  submitting = false,
  error,
}) {
  function handlePickFiles(files) {
    const picked = Array.isArray(files) ? files : [files];
    const valid = [];
    for (const file of picked) {
      if (!ALLOWED_ATTACHMENT_MIME_TYPES.has(file.type)) {
        toast.error(`«${file.name}» no es un tipo de archivo permitido.`);
        continue;
      }
      valid.push(file);
    }
    const next = [...attachments, ...valid];
    if (next.length > MAX_ATTACHMENTS) {
      toast.error(`Solo puedes adjuntar hasta ${MAX_ATTACHMENTS} archivos.`);
    }
    onAttachmentsChange?.(next.slice(0, MAX_ATTACHMENTS));
  }

  function removeAttachment(index) {
    onAttachmentsChange?.(attachments.filter((_, i) => i !== index));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Reportar bug</DialogTitle>
          <DialogDescription>
            Se enviará al equipo de Runly junto con detalles técnicos para ayudar a diagnosticarlo.
          </DialogDescription>
        </DialogHeader>

        {context && (
          <p
            className="mb-3 truncate text-xs text-[hsl(var(--muted-foreground))]"
            title={context}
          >
            {context}
          </p>
        )}

        {errorMessage && (
          <p className="mb-3 max-h-24 overflow-auto rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-[hsl(var(--foreground))] break-words">
            {errorMessage}
          </p>
        )}

        <TextareaField
          label="¿Qué estabas haciendo? (opcional)"
          placeholder="Pasos para reproducir el problema..."
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={3}
          maxLength={2000}
        />

        {screenshotDataUrl && (
          <div className="mt-3">
            <p className="mb-1.5 text-xs text-[hsl(var(--muted-foreground))]">
              Se incluirá esta captura de pantalla:
            </p>
            <img
              src={screenshotDataUrl}
              alt="Captura de pantalla del error"
              className="max-h-36 w-full rounded-lg border border-[hsl(var(--border))] object-cover object-top"
            />
          </div>
        )}

        <div className="mt-3 space-y-2">
          <FileUploader
            multiple
            accept={ATTACHMENT_ACCEPT}
            maxSizeMB={5}
            disabled={submitting || attachments.length >= MAX_ATTACHMENTS}
            hint="Hasta 3 archivos — imágenes, PDF, texto, CSV, Word o Excel."
            emptyLabel="Adjuntar archivos"
            onChange={handlePickFiles}
          />
          {attachments.map((file, index) => (
            <FileCard
              key={`${file.name}-${index}`}
              name={file.name}
              mimeType={file.type}
              sizeBytes={file.size}
              onRemove={submitting ? null : () => removeAttachment(index)}
            />
          ))}
          {attachments.length >= MAX_ATTACHMENTS && (
            <p className="text-xs text-[hsl(var(--muted-foreground))]" aria-live="polite">
              {MAX_ATTACHMENTS}/{MAX_ATTACHMENTS} archivos adjuntos
            </p>
          )}
        </div>

        {error && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} disabled={submitting}>
            {submitting ? "Enviando..." : "Enviar reporte"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
