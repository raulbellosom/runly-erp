import { useEffect, useState } from "react";
import { Copy, Hash, Link2, Tag } from "lucide-react";
import { Button } from "./Button.jsx";
import { TextField } from "./FormFieldsInput.jsx";
import { DatePickerField } from "./DatePickerField.jsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "./Dialog.jsx";

// Creates one public link (label, optional expiry and max uses) and then shows
// the URL to copy. `onCreate(payload)` must return the created link.

export function ShareLinkDialog({ open, onOpenChange, onCreate, onCreated, title = "Compartir por enlace" }) {
  const [label, setLabel] = useState("");
  const [expiresOn, setExpiresOn] = useState(undefined);
  const [maxUses, setMaxUses] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLabel(""); setExpiresOn(undefined); setMaxUses(""); setError(""); setCreated(null); setCopied(false);
  }, [open]);

  const url = created?.path ? `${window.location.origin}${created.path}` : "";

  async function submit() {
    const uses = maxUses.trim() ? Number(maxUses) : null;
    if (uses !== null && (!Number.isInteger(uses) || uses < 1)) {
      setError("El máximo de usos debe ser un número entero mayor a cero.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const link = await onCreate({
        label: label.trim() || undefined,
        // End of the chosen local day, sent as an instant.
        expiresAt: expiresOn ? new Date(`${expiresOn}T23:59:59`).getTime() : undefined,
        maxUses: uses ?? undefined,
      });
      setCreated(link);
      onCreated?.(link);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("No se pudo copiar el enlace.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Cualquier persona con el enlace podrá abrirlo sin cuenta. Puedes revocarlo cuando quieras.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 p-4">
          {created ? (
            <div className="space-y-2">
              <TextField label="Enlace" icon={Link2} value={url} readOnly onFocus={(e) => e.target.select()} />
              <Button size="sm" variant="outline" onClick={copy}>
                <Copy className="mr-1 h-4 w-4" /> {copied ? "Copiado" : "Copiar enlace"}
              </Button>
            </div>
          ) : (
            <>
              <TextField label="Nombre (opcional)" icon={Tag} value={label} onChange={(e) => setLabel(e.target.value)} maxLength={120} placeholder="Ej. Clientes de octubre" />
              <DatePickerField label="Vence (opcional)" value={expiresOn} onChange={setExpiresOn} />
              <TextField
                label="Máximo de usos (opcional)"
                icon={Hash}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={7}
                value={maxUses}
                // Digits only: letters and symbols never reach the field.
                onChange={(e) => setMaxUses(e.target.value.replace(/\D+/g, "").replace(/^0+/, ""))}
                placeholder="Sin límite"
                hint="Solo números. Déjalo vacío para no limitarlo."
              />
            </>
          )}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        <DialogFooter>
          {created ? (
            <Button onClick={() => onOpenChange(false)}>Listo</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={submit} disabled={saving}>{saving ? "Creando..." : "Crear enlace"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
