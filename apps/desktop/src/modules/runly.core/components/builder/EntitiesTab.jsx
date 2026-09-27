// Module Builder — Datos tab: entities + field editor (Etapas 7-8). This is
// the central editor. Field reordering uses up/down buttons rather than a
// drag canvas — "buena interfaz de configuración estructurada" is the
// explicit bar for the MVP, not a Figma clone.
import { useState } from "react";
import {
  Button,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  TextField,
  SelectField,
  CheckboxField,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@runly/ui";
import { Plus, Trash2, ChevronUp, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import {
  FIELD_TYPE_LABELS,
  addEntity,
  updateEntity,
  removeEntity,
  addField,
  updateField,
  removeField,
  moveField,
  fieldExistedInPublished,
  addSelectOption,
  updateSelectOption,
  removeSelectOption,
  hasDuplicateOptionValues,
} from "../../lib/builderHelpers";

const FIELD_TYPE_OPTIONS = Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => ({ value, label }));

function SelectOptionsEditor({ field, onChange, readOnly }) {
  const duplicate = hasDuplicateOptionValues(field);
  return (
    <div className="space-y-2 rounded-lg border border-[hsl(var(--border))] p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Opciones</span>
        {!readOnly && (
          <Button size="sm" variant="ghost" onClick={() => onChange(addSelectOption(field))}>
            <Plus className="h-3.5 w-3.5" />
            Añadir opción
          </Button>
        )}
      </div>
      {duplicate && (
        <p className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          Hay valores repetidos.
        </p>
      )}
      <div className="space-y-1.5">
        {(field.options ?? []).map((option, index) => (
          <div key={index} className="flex items-center gap-2">
            <TextField
              className="flex-1"
              placeholder="Etiqueta"
              value={option.label ?? ""}
              disabled={readOnly}
              onChange={(e) => onChange(updateSelectOption(field, index, { label: e.target.value }))}
            />
            <TextField
              className="w-40 font-mono text-xs"
              placeholder="VALOR"
              value={option.value ?? ""}
              disabled={readOnly}
              onChange={(e) => onChange(updateSelectOption(field, index, { value: e.target.value }))}
            />
            {!readOnly && (
              <Button size="icon" variant="ghost" onClick={() => onChange(removeSelectOption(field, index))}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function FieldRow({ entity, field, index, total, definition, onChange, publishedDefinition, readOnly }) {
  const [expanded, setExpanded] = useState(false);
  const existedInPublished = fieldExistedInPublished(publishedDefinition, entity.key, field.key);

  function patchField(patch) {
    onChange(updateField(definition, entity.key, field.key, patch));
  }

  return (
    <div className="rounded-lg border border-[hsl(var(--border))]">
      <div className="flex items-center gap-2 px-3 py-2">
        <button type="button" className="cursor-pointer" onClick={() => setExpanded((v) => !v)}>
          <ChevronRight className={`h-4 w-4 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{field.label}</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))] font-mono">{field.key}</p>
        </div>
        <Badge variant="outline">{FIELD_TYPE_LABELS[field.type] ?? field.type}</Badge>
        {field.required && <Badge variant="secondary">Requerido</Badge>}
        {!readOnly && (
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" disabled={index === 0} onClick={() => onChange(moveField(definition, entity.key, field.key, -1))}>
              <ChevronUp className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" disabled={index === total - 1} onClick={() => onChange(moveField(definition, entity.key, field.key, 1))}>
              <ChevronDown className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="text-red-600" onClick={() => onChange(removeField(definition, entity.key, field.key))}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>
      {expanded && (
        <div className="border-t border-[hsl(var(--border))] p-3 space-y-3">
          {existedInPublished && (
            <p className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Este campo ya existe en la versión publicada. Eliminarlo bloqueará la publicación (cambio destructivo).
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Etiqueta" value={field.label ?? ""} disabled={readOnly} onChange={(e) => patchField({ label: e.target.value })} />
            <SelectField
              label="Tipo"
              options={FIELD_TYPE_OPTIONS}
              value={field.type}
              disabled={readOnly}
              onValueChange={(value) => patchField({ type: value, options: ["select", "multiselect"].includes(value) ? (field.options ?? []) : undefined })}
            />
          </div>
          <CheckboxField
            label="Requerido"
            checked={Boolean(field.required)}
            disabled={readOnly}
            onChange={(e) => patchField({ required: e.target.checked })}
          />
          {["select", "multiselect"].includes(field.type) && (
            <SelectOptionsEditor field={field} onChange={patchField} readOnly={readOnly} />
          )}
          {field.type === "relation" && (
            <SelectField
              label="Entidad relacionada"
              options={definition.entities.filter((e) => e.key !== entity.key).map((e) => ({ value: e.key, label: e.label }))}
              value={field.targetEntity ?? ""}
              disabled={readOnly}
              onValueChange={(value) => patchField({ targetEntity: value })}
            />
          )}
        </div>
      )}
    </div>
  );
}

function EntityCard({ entity, definition, onChange, publishedDefinition, readOnly, onDelete }) {
  const [addingField, setAddingField] = useState(false);
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState("text");

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <div className="flex-1 min-w-0 space-y-2">
          <TextField
            value={entity.label}
            disabled={readOnly}
            onChange={(e) => onChange(updateEntity(definition, entity.key, { label: e.target.value }))}
            placeholder="Etiqueta de la entidad"
          />
          <p className="text-xs text-[hsl(var(--muted-foreground))] font-mono">{entity.key}</p>
        </div>
        {!readOnly && (
          <Button size="icon" variant="ghost" className="text-red-600" onClick={onDelete}>
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="Etiqueta plural"
            value={entity.pluralLabel ?? ""}
            disabled={readOnly}
            onChange={(e) => onChange(updateEntity(definition, entity.key, { pluralLabel: e.target.value }))}
          />
          <CheckboxField
            label="Eliminación suave (recomendado)"
            checked={entity.softDelete !== false}
            disabled={readOnly}
            onChange={(e) => onChange(updateEntity(definition, entity.key, { softDelete: e.target.checked }))}
          />
        </div>

        <div className="space-y-2">
          {(entity.fields ?? []).map((field, index) => (
            <FieldRow
              key={field.key}
              entity={entity}
              field={field}
              index={index}
              total={entity.fields.length}
              definition={definition}
              onChange={onChange}
              publishedDefinition={publishedDefinition}
              readOnly={readOnly}
            />
          ))}
          {!entity.fields?.length && (
            <p className="text-sm text-[hsl(var(--muted-foreground))] px-1">Esta entidad no tiene campos todavía.</p>
          )}
        </div>

        {!readOnly && (
          <Button variant="outline" size="sm" onClick={() => setAddingField(true)}>
            <Plus className="h-3.5 w-3.5" />
            Campo
          </Button>
        )}
      </CardContent>

      <Dialog open={addingField} onOpenChange={setAddingField}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nuevo campo</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <TextField label="Etiqueta" value={newFieldLabel} onChange={(e) => setNewFieldLabel(e.target.value)} />
            <SelectField label="Tipo" options={FIELD_TYPE_OPTIONS} value={newFieldType} onValueChange={setNewFieldType} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddingField(false)}>Cancelar</Button>
            <Button
              disabled={!newFieldLabel.trim()}
              onClick={() => {
                onChange(addField(definition, entity.key, { label: newFieldLabel, type: newFieldType }));
                setNewFieldLabel("");
                setNewFieldType("text");
                setAddingField(false);
              }}
            >
              Añadir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export function EntitiesTab({ definition, onChange, publishedDefinition, readOnly }) {
  const [addingEntity, setAddingEntity] = useState(false);
  const [newEntityLabel, setNewEntityLabel] = useState("");
  const [confirmDeleteEntity, setConfirmDeleteEntity] = useState(null);

  return (
    <div className="space-y-4 pt-4">
      {definition.entities.map((entity) => (
        <EntityCard
          key={entity.key}
          entity={entity}
          definition={definition}
          onChange={onChange}
          publishedDefinition={publishedDefinition}
          readOnly={readOnly}
          onDelete={() => setConfirmDeleteEntity(entity)}
        />
      ))}

      {!readOnly && (
        <Button variant="outline" onClick={() => setAddingEntity(true)}>
          <Plus className="h-4 w-4" />
          Añadir entidad
        </Button>
      )}

      <Dialog open={addingEntity} onOpenChange={setAddingEntity}>
        <DialogContent>
          <DialogHeader><DialogTitle>Nueva entidad</DialogTitle></DialogHeader>
          <TextField label="Nombre" value={newEntityLabel} onChange={(e) => setNewEntityLabel(e.target.value)} placeholder="Vehículo" />
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddingEntity(false)}>Cancelar</Button>
            <Button
              disabled={!newEntityLabel.trim()}
              onClick={() => {
                onChange(addEntity(definition, { label: newEntityLabel }));
                setNewEntityLabel("");
                setAddingEntity(false);
              }}
            >
              Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(confirmDeleteEntity)}
        onOpenChange={(open) => !open && setConfirmDeleteEntity(null)}
        title="Eliminar entidad"
        description={`Se eliminará "${confirmDeleteEntity?.label}" y sus vistas asociadas del borrador.`}
        confirmLabel="Eliminar"
        onConfirm={() => {
          onChange(removeEntity(definition, confirmDeleteEntity.key));
          setConfirmDeleteEntity(null);
        }}
      />
    </div>
  );
}
