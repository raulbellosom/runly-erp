// Module Builder — one collapsible entity card on the Datos tab: entity
// settings on top, then the "Campos" section (sortable field list + FieldSheet
// for create/edit). Collapsing keeps long entity lists manageable.
import { useState } from "react";
import {
  Button,
  Badge,
  TextField,
  SwitchField,
  ConfirmDialog,
  EmptyState,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@runly/ui";
import { ChevronRight, Database, LayoutTemplate, MoreHorizontal, Plus, Rows3, Tag, Tags, Trash2 } from "lucide-react";
import {
  addField,
  updateEntity,
  updateField,
  removeField,
  fieldExistedInPublished,
} from "../../lib/builderHelpers";
import { EntityFieldList } from "./EntityFieldList";
import { FieldSheet } from "./FieldSheet";
import { LayoutDesignerSheet } from "./LayoutDesignerSheet";

// addField() only knows key/label/type; the extra attributes the sheet
// collects (required, options, targetEntity) are applied to the field it
// just appended.
function addFieldFromDraft(definition, entityKey, draft) {
  const withField = addField(definition, entityKey, { label: draft.label, type: draft.type });
  const fields = withField.entities.find((e) => e.key === entityKey)?.fields ?? [];
  const created = fields[fields.length - 1];
  if (!created) return withField;
  const { label, type, key, ...extra } = draft;
  return updateField(withField, entityKey, created.key, extra);
}

export function EntityCard({ entity, definition, onChange, publishedDefinition, readOnly, expanded, onToggle, onDelete }) {
  const [sheet, setSheet] = useState({ open: false, field: null });
  const [confirmDeleteField, setConfirmDeleteField] = useState(null);
  const [designOpen, setDesignOpen] = useState(false);
  const fields = entity.fields ?? [];

  function patchEntity(patch) {
    onChange((d) => updateEntity(d, entity.key, patch));
  }

  function handleSubmitField(draft) {
    if (sheet.field) onChange((d) => updateField(d, entity.key, sheet.field.key, draft));
    else onChange((d) => addFieldFromDraft(d, entity.key, draft));
  }

  return (
    <section className="rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]">
      <div className="flex items-center gap-2 px-3 py-3 sm:px-4">
        <button
          type="button"
          className="flex flex-1 min-w-0 items-center gap-3 text-left cursor-pointer"
          aria-expanded={expanded}
          onClick={onToggle}
        >
          <ChevronRight className={`h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))] transition-transform ${expanded ? "rotate-90" : ""}`} />
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[hsl(var(--muted))]">
            <Database className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold">{entity.label || "Sin nombre"}</span>
            <span className="block truncate font-mono text-xs text-[hsl(var(--muted-foreground))]">{entity.key}</span>
          </span>
        </button>
        <Badge variant="outline" className="shrink-0">{fields.length} {fields.length === 1 ? "campo" : "campos"}</Badge>
        {!readOnly && (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="ghost" aria-label={`Acciones de ${entity.label}`}>
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="text-red-600 focus:text-red-600" onSelect={onDelete}>
                <Trash2 />
                Eliminar entidad
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {expanded && (
        <div className="space-y-5 border-t border-[hsl(var(--border))] px-3 py-4 sm:px-4">
          <div className="grid gap-4 md:grid-cols-2">
            <TextField
              label="Nombre (singular)"
              icon={Tag}
              placeholder="Artículo"
              value={entity.label ?? ""}
              disabled={readOnly}
              onChange={(e) => patchEntity({ label: e.target.value })}
            />
            <TextField
              label="Nombre (plural)"
              icon={Tags}
              placeholder="Artículos"
              value={entity.pluralLabel ?? ""}
              disabled={readOnly}
              onChange={(e) => patchEntity({ pluralLabel: e.target.value })}
            />
          </div>
          <div className="rounded-xl border border-[hsl(var(--border))] px-4 py-3">
            <SwitchField
              label="Eliminación suave (recomendado)"
              description="Los registros eliminados se ocultan en lugar de borrarse definitivamente."
              checked={entity.softDelete !== false}
              disabled={readOnly}
              onChange={(checked) => patchEntity({ softDelete: checked })}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Rows3 className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                <h3 className="text-sm font-semibold">Campos</h3>
                <span className="text-xs text-[hsl(var(--muted-foreground))]">{fields.length}</span>
              </div>
              <div className="flex items-center gap-2">
                {fields.length > 0 && (
                  <Button size="sm" variant="ghost" onClick={() => setDesignOpen(true)}>
                    <LayoutTemplate className="h-3.5 w-3.5" />
                    Diseño{entity.layout ? " personalizado" : ""}
                  </Button>
                )}
                {!readOnly && (
                  <Button size="sm" variant="outline" onClick={() => setSheet({ open: true, field: null })}>
                    <Plus className="h-3.5 w-3.5" />
                    Crear campo
                  </Button>
                )}
              </div>
            </div>
            {fields.length ? (
              <EntityFieldList
                fields={fields}
                readOnly={readOnly}
                onReorder={(next) => patchEntity({ fields: next })}
                onEdit={(field) => setSheet({ open: true, field })}
                onDelete={(field) => setConfirmDeleteField(field)}
              />
            ) : (
              <EmptyState
                icon={Rows3}
                title="Sin campos"
                description="Agrega los datos que guardará esta entidad."
                action={!readOnly ? { label: "Crear campo", onClick: () => setSheet({ open: true, field: null }) } : undefined}
              />
            )}
          </div>
        </div>
      )}

      <FieldSheet
        open={sheet.open}
        onOpenChange={(open) => setSheet((s) => ({ ...s, open }))}
        field={sheet.field}
        entity={entity}
        definition={definition}
        existedInPublished={Boolean(sheet.field) && fieldExistedInPublished(publishedDefinition, entity.key, sheet.field.key)}
        readOnly={readOnly}
        onSubmit={handleSubmitField}
      />

      <LayoutDesignerSheet
        open={designOpen}
        onOpenChange={setDesignOpen}
        moduleKey={definition.key}
        entities={definition.entities ?? []}
        entity={entity}
        readOnly={readOnly}
        onSave={(layout) => patchEntity({ layout })}
        onPatchField={(fieldKey, patch) => onChange((d) => updateField(d, entity.key, fieldKey, patch))}
      />

      <ConfirmDialog
        open={Boolean(confirmDeleteField)}
        onOpenChange={(open) => !open && setConfirmDeleteField(null)}
        title="Eliminar campo"
        description={
          confirmDeleteField && fieldExistedInPublished(publishedDefinition, entity.key, confirmDeleteField.key)
            ? `"${confirmDeleteField.label}" ya existe en la versión publicada. Eliminarlo es un cambio destructivo y bloqueará la publicación.`
            : `Se eliminará "${confirmDeleteField?.label}" del borrador.`
        }
        confirmLabel="Eliminar"
        onConfirm={() => {
          onChange((d) => removeField(d, entity.key, confirmDeleteField.key));
          setConfirmDeleteField(null);
        }}
      />
    </section>
  );
}
