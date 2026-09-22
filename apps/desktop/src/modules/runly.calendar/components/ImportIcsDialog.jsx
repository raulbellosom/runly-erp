import { useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  Button, FileUploader, SelectField, ErrorState,
} from "@runly/ui";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { useCalendars } from "../hooks/useCalendarData";

const NEW_CALENDAR = "__new__";

export default function ImportIcsDialog({ open, onOpenChange }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const { data: calData } = useCalendars();
  const ownedCalendars = calData?.owned ?? [];

  const [file, setFile] = useState(null);
  const [calendarId, setCalendarId] = useState(NEW_CALENDAR);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function reset() {
    setFile(null);
    setCalendarId(NEW_CALENDAR);
    setBusy(false);
    setError(null);
  }

  async function handleImport() {
    if (!file) {
      toast.error("Selecciona un archivo .ics");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      if (calendarId !== NEW_CALENDAR) formData.append("calendarId", calendarId);
      const result = await runly.calendar.importIcs(formData, token);
      const parts = [`${result.imported} eventos importados`];
      if (result.duplicates) parts.push(`${result.duplicates} duplicados omitidos`);
      if (result.errors) parts.push(`${result.errors} con error`);
      toast.success(`${parts.join(" · ")}.`);
      if (result.truncated) {
        toast.message("El archivo traia mas eventos de los que se pudieron importar de una vez.");
      }
      await queryClient.invalidateQueries({ queryKey: ["calendar", "calendars"] });
      await queryClient.invalidateQueries({ queryKey: ["calendar", "events"] });
      reset();
      onOpenChange(false);
    } catch (e) {
      setError(e?.message || "No se pudo importar el archivo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) { reset(); onOpenChange(next); } }}>
      <DialogContent size="sm">
        <DialogHeader><DialogTitle>Importar calendario (.ics)</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Exporta tu calendario desde aCalendar+ (u otra app) como archivo .ics y subelo aqui.
          </p>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[hsl(var(--foreground))]">Archivo .ics</label>
            <FileUploader
              accept=".ics,text/calendar"
              maxSizeMB={5}
              value={file}
              onChange={setFile}
              disabled={busy}
              emptyLabel="Subir archivo .ics"
              hint="Arrastra el archivo exportado o selecciónalo manualmente."
            />
          </div>
          <SelectField
            label="Importar en"
            value={calendarId}
            disabled={busy}
            onValueChange={setCalendarId}
            options={[
              { value: NEW_CALENDAR, label: "➕ Crear calendario nuevo" },
              ...ownedCalendars.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
          {error && <ErrorState className="py-3" title="No se pudo importar" description={error} />}
        </div>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => { reset(); onOpenChange(false); }}>Cancelar</Button>
          <Button onClick={handleImport} disabled={busy || !file}>{busy ? "Importando..." : "Importar"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
