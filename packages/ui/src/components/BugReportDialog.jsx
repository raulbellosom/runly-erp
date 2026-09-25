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

// Presentational only — no API/auth knowledge, matching the rest of
// packages/ui. The host (apps/desktop's BugReportHost) owns the screenshot
// capture and the actual send; this component just renders what's captured
// and forwards the user's description back up.
export function BugReportDialog({
  open,
  onOpenChange,
  errorMessage,
  screenshotDataUrl,
  description,
  onDescriptionChange,
  onSubmit,
  submitting = false,
  error,
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Reportar bug</DialogTitle>
          <DialogDescription>
            Se enviará al equipo de Runly junto con detalles técnicos para ayudar a diagnosticarlo.
          </DialogDescription>
        </DialogHeader>

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
