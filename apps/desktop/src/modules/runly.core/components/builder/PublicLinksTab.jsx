// Module Builder — Enlaces tab: public pages shared by link (spec section 7 of
// docs/superpowers/specs/2026-09-28-module-public-links-design.md). Each entry
// becomes a "Ficha pública" (read-only card) or a "Formulario público" that
// creates a record, compiled by @runly/module-compiler (public-links.js).
// Only the fields checked here are ever exposed.
import { useState } from "react";
import {
  Badge, Button, Card, CardContent, CheckboxField, ConfirmDialog, EmptyState, SelectField, TextField, TextareaField,
} from "@runly/ui";
import { Globe, Plus, Trash2 } from "lucide-react";

const MAX_LINKS = 10;
const FORM_TYPES = new Set(["text", "textarea", "markdown", "number", "decimal", "boolean", "select", "multiselect", "date", "datetime", "email", "phone"]);
const MODE_OPTIONS = [
  { value: "view", label: "Ficha pública (solo lectura)" },
  { value: "submit", label: "Formulario público (crea un registro)" },
];

const keyOf = (item) => item.key ?? item.name;
const isDisplayable = (field) => !["file", "json"].includes(field.type) && (field.type !== "relation" || Boolean(field.targetEntity));
const isFormField = (field) => FORM_TYPES.has(field.type);

function slugKey(title, taken) {
  const base = String(title || "enlace").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^[^a-z]+/, "").slice(0, 30) || "enlace";
  let key = base.length < 2 ? `${base}_p` : base;
  for (let i = 2; taken.has(key); i += 1) key = `${base}_${i}`;
  return key;
}

function FieldChecklist({ label, fields, selected, onToggle, disabled, empty }) {
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium">{label}</p>
      {fields.length === 0 ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">{empty}</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {fields.map((field) => (
            <CheckboxField
              key={keyOf(field)}
              label={`${field.label ?? keyOf(field)}${field.required ? " *" : ""}`}
              checked={selected.includes(keyOf(field))}
              disabled={disabled}
              onChange={() => onToggle(keyOf(field))}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PublicLinkCard({ link, index, definition, readOnly, onPatch, onRemove }) {
  const entities = definition.entities ?? [];
  const entityOptions = entities.map((entity) => ({ value: keyOf(entity), label: entity.label ?? keyOf(entity) }));
  const entity = entities.find((item) => keyOf(item) === link.entity);
  const target = entities.find((item) => keyOf(item) === link.targetEntity);
  const linkFieldOptions = (target?.fields ?? [])
    .filter((field) => field.type === "relation" && field.targetEntity === link.entity)
    .map((field) => ({ value: keyOf(field), label: field.label ?? keyOf(field) }));
  const toggle = (prop, key) => {
    const current = link[prop] ?? [];
    onPatch({ [prop]: current.includes(key) ? current.filter((item) => item !== key) : [...current, key] });
  };
  const missingRequired = (target?.fields ?? []).filter((field) => field.required && keyOf(field) !== link.linkField && !(link.formFields ?? []).includes(keyOf(field)));

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Globe className="h-4 w-4 text-[--color-primary]" />
            <span className="font-medium">{link.title || "Página pública"}</span>
            <Badge variant="outline">{link.mode === "submit" ? "Formulario" : "Ficha"}</Badge>
          </div>
          {!readOnly && (
            <Button variant="ghost" size="sm" onClick={() => onRemove(index)} aria-label="Quitar página pública">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label="Título" required value={link.title ?? ""} disabled={readOnly} onChange={(e) => onPatch({ title: e.target.value })} />
          <SelectField label="Tipo" options={MODE_OPTIONS} value={link.mode} disabled={readOnly}
            onValueChange={(mode) => onPatch(mode === "view" ? { mode, targetEntity: undefined, formFields: undefined, linkField: undefined } : { mode })} />
          <SelectField label="Se comparte cada" options={entityOptions} value={link.entity ?? ""} disabled={readOnly}
            onValueChange={(value) => onPatch({ entity: value, fields: [], linkField: undefined })} />
        </div>
        <TextareaField label="Descripción (opcional)" value={link.description ?? ""} disabled={readOnly} onChange={(e) => onPatch({ description: e.target.value })} />
        {entity && (
          <FieldChecklist
            label={link.mode === "submit" ? "Datos del registro que se muestran arriba del formulario (opcional)" : "Campos que se muestran"}
            fields={entity.fields.filter(isDisplayable)}
            selected={link.fields ?? []}
            disabled={readOnly}
            onToggle={(key) => toggle("fields", key)}
            empty="Esta entidad no tiene campos que se puedan mostrar."
          />
        )}
        {link.mode === "submit" && (
          <div className="space-y-4 rounded-lg border border-[hsl(var(--border))] p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField label="Cada envío crea un(a)" options={entityOptions} value={link.targetEntity ?? ""} disabled={readOnly}
                onValueChange={(value) => onPatch({ targetEntity: value, formFields: [], linkField: undefined })} />
              <SelectField
                label="Ligar al registro compartido con"
                options={[{ value: "__none", label: "No ligar" }, ...linkFieldOptions]}
                value={link.linkField ?? "__none"}
                disabled={readOnly || !target}
                onValueChange={(value) => onPatch({ linkField: value === "__none" ? undefined : value })}
              />
            </div>
            {target && (
              <FieldChecklist
                label="Campos del formulario"
                fields={target.fields.filter((field) => isFormField(field) && keyOf(field) !== link.linkField)}
                selected={link.formFields ?? []}
                disabled={readOnly}
                onToggle={(key) => toggle("formFields", key)}
                empty="Esta entidad no tiene campos que se puedan llenar públicamente."
              />
            )}
            {missingRequired.length > 0 && (
              <p className="text-xs text-[hsl(var(--destructive))]">
                Faltan campos obligatorios: {missingRequired.map((field) => field.label ?? keyOf(field)).join(", ")}.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label="Texto del botón" placeholder="Enviar" value={link.submitLabel ?? ""} disabled={readOnly} onChange={(e) => onPatch({ submitLabel: e.target.value })} />
              <TextField label="Mensaje al enviar" placeholder="Gracias. Recibimos tu información." value={link.successMessage ?? ""} disabled={readOnly} onChange={(e) => onPatch({ successMessage: e.target.value })} />
            </div>
          </div>
        )}
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          Después de publicar, el botón Compartir aparece en el detalle de cada {entity?.label?.toLowerCase() ?? "registro"} para crear enlaces con vigencia, límite de usos y código QR.
        </p>
      </CardContent>
    </Card>
  );
}

export function PublicLinksTab({ definition, onChange, readOnly }) {
  const links = definition.publicLinks ?? [];
  const [removeIndex, setRemoveIndex] = useState(null);
  const firstEntity = keyOf(definition.entities?.[0] ?? {});

  const setLinks = (next) => onChange((current) => {
    const copy = { ...current };
    if (next.length) copy.publicLinks = next; else delete copy.publicLinks;
    return copy;
  });
  const patchLink = (index, patch) => setLinks(links.map((link, i) => {
    if (i !== index) return link;
    const merged = { ...link, ...patch };
    for (const [prop, value] of Object.entries(merged)) if (value === undefined) delete merged[prop];
    return merged;
  }));
  const addLink = () => {
    const taken = new Set(links.map((link) => link.key));
    setLinks([...links, { key: slugKey("pagina publica", taken), entity: firstEntity, mode: "view", title: "Página pública", fields: [] }]);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
          Páginas que otras personas pueden abrir sin cuenta desde un enlace: una ficha de solo lectura o un formulario que crea un registro. Solo se exponen los campos que marques.
        </p>
        {!readOnly && (
          <Button onClick={addLink} disabled={links.length >= MAX_LINKS || !firstEntity}>
            <Plus className="mr-1 h-4 w-4" /> Nueva página pública
          </Button>
        )}
      </div>
      {links.length === 0 ? (
        <EmptyState icon={Globe} title="Sin páginas públicas" description="Agrega una para compartir fichas o formularios por enlace." />
      ) : links.map((link, index) => (
        <PublicLinkCard
          key={link.key}
          link={link}
          index={index}
          definition={definition}
          readOnly={readOnly}
          onPatch={(patch) => patchLink(index, patch)}
          onRemove={setRemoveIndex}
        />
      ))}
      <ConfirmDialog
        open={removeIndex !== null}
        onOpenChange={(open) => !open && setRemoveIndex(null)}
        title="Quitar página pública"
        description="Al publicar, los enlaces ya compartidos de esta página dejarán de funcionar."
        confirmLabel="Quitar"
        onConfirm={() => { setLinks(links.filter((_, i) => i !== removeIndex)); setRemoveIndex(null); }}
      />
    </div>
  );
}
