import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "../components/Button.jsx";
import { TextField, SelectField } from "../components/FormFields.jsx";
import { buildApiHeaders } from "../lib/apiHeaders.js";
import { fieldKeyFromLabel } from "./custom-field-key.js";

// Inline "new custom field" editor for DynamicFieldsSection (spec
// 2026-10-03-inventory-custom-fields-modes). Creates the definition
// (POST createPath) without leaving the record form. Scopes:
// - "item": on-demand field, added to this record only;
// - "type": always asked for records of the current type;
// - "all": always asked for every type.
// Plain inputs, not a nested <form>: Enter is intercepted so it never
// submits the surrounding record form.

export const CUSTOM_FIELD_TYPES = [
  { value: "text", label: "Texto" },
  { value: "textarea", label: "Texto largo" },
  { value: "number", label: "Número" },
  { value: "date", label: "Fecha" },
  { value: "boolean", label: "Sí/No" },
  { value: "select", label: "Lista de opciones" },
  { value: "url", label: "URL" },
  { value: "email", label: "Email" },
];

const SCOPE_OPTIONS = [
  { value: "item", label: "Solo este registro" },
  { value: "type", label: "Siempre en este tipo" },
  { value: "all", label: "Siempre en todos los tipos" },
];

function joinUrl(baseUrl, apiPath) {
  return `${String(baseUrl ?? "").trim().replace(/\/+$/, "")}${apiPath}`;
}

export function CustomFieldCreator({ open, onClose, initialLabel = "", createPath, categoryValue, existingKeys, apiBaseUrl, token, companyId, onCreated }) {
  const [label, setLabel] = useState(initialLabel);
  const [fieldType, setFieldType] = useState("text");
  const [optionsText, setOptionsText] = useState("");
  const [scope, setScope] = useState("item");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLabel(initialLabel);
    setFieldType("text");
    setOptionsText("");
    setScope("item");
    setError("");
  }, [open, initialLabel]);

  if (!open) return null;

  const options = optionsText.split(/[,\n]/).map((o) => o.trim()).filter(Boolean);
  const canSave = label.trim() && (fieldType !== "select" || options.length > 0) && !busy;
  const scopeOptions = categoryValue ? SCOPE_OPTIONS : SCOPE_OPTIONS.filter((o) => o.value !== "type");

  async function save() {
    if (!canSave) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(joinUrl(apiBaseUrl, createPath), {
        method: "POST",
        headers: { ...buildApiHeaders(token, companyId), "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          fieldKey: fieldKeyFromLabel(label, existingKeys),
          fieldType,
          onDemand: scope === "item",
          categoryId: scope === "type" && categoryValue ? String(categoryValue) : null,
          ...(fieldType === "select" ? { options } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 403) throw new Error("No tienes permiso para crear campos personalizados.");
      if (!res.ok) throw new Error(json?.error ?? "No se pudo crear el campo.");
      onCreated?.(json?.data ?? json, scope);
      onClose?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el campo.");
    } finally {
      setBusy(false);
    }
  }

  const onKeyDown = (event) => {
    if (event.key === "Enter" && event.target.tagName !== "TEXTAREA") {
      event.preventDefault();
      save();
    }
    if (event.key === "Escape") onClose?.();
  };

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-(--brand-primary)/50 bg-(--brand-soft)/40 p-4" onKeyDown={onKeyDown}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-[hsl(var(--foreground))]">Nuevo campo personalizado</p>
        <button type="button" onClick={() => onClose?.()} aria-label="Cerrar" className="rounded-md p-1 text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="Nombre del campo" required autoFocus value={label} placeholder="Memoria RAM" onChange={(e) => setLabel(e.target.value)} />
        <SelectField label="Tipo de dato" value={fieldType} onValueChange={setFieldType} options={CUSTOM_FIELD_TYPES} />
        {fieldType === "select" ? (
          <div className="md:col-span-2">
            <TextField label="Opciones" required value={optionsText} placeholder="8 GB, 16 GB, 32 GB" hint="Sepáralas con comas." onChange={(e) => setOptionsText(e.target.value)} />
          </div>
        ) : null}
        <SelectField
          label="Dónde se usa"
          value={scope}
          onValueChange={setScope}
          options={scopeOptions}
          hint={scope === "item" ? "Queda en la biblioteca para agregarlo a otros registros cuando haga falta." : undefined}
        />
      </div>
      {error ? <p className="text-sm text-[hsl(var(--destructive))]">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onClose?.()} disabled={busy}>
          Cancelar
        </Button>
        <Button type="button" size="sm" onClick={save} disabled={!canSave} loading={busy}>
          Crear campo
        </Button>
      </div>
    </div>
  );
}
