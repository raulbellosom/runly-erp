// Module Builder — side panel to create or edit one entity field (modelled on
// Appwrite's "Create column" panel). Works on a local draft so half-typed
// changes never hit the autosaved definition until the user confirms.
import { useEffect, useState } from "react";
import {
  Button,
  TextField,
  SelectField,
  SwitchField,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@runly/ui";
import { Plus, Trash2, AlertTriangle, Database, KeyRound, Tag } from "lucide-react";
import {
  FIELD_TYPE_LABELS,
  slugify,
  addSelectOption,
  updateSelectOption,
  removeSelectOption,
  hasDuplicateOptionValues,
} from "../../lib/builderHelpers";
import { FIELD_TYPE_ICONS } from "../../lib/builderFieldIcons";
import { validateFieldKey } from "../../lib/fieldRename";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../../../../auth/AuthProvider";
import { runly } from "../../../../lib/runly";

const FIELD_TYPE_OPTIONS = Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => ({ value, label, icon: FIELD_TYPE_ICONS[value] }));
const EMPTY_FIELD = { label: "", type: "text", required: false };

function SelectOptionsEditor({ field, onChange, readOnly }) {
  const duplicate = hasDuplicateOptionValues(field);
  return (
    <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Opciones</span>
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
      {!(field.options ?? []).length && (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Sin opciones todavía.</p>
      )}
      {(field.options ?? []).length > 0 && (
        <div className="flex items-center gap-2 text-xs font-medium text-[hsl(var(--muted-foreground))]" aria-hidden="true">
          <span className="flex-1">Etiqueta visible</span>
          <span className="w-28 sm:w-36">Valor guardado</span>
          {!readOnly && <span className="w-9" />}
        </div>
      )}
      <div className="space-y-2">
        {(field.options ?? []).map((option, index) => (
          <div key={index} className="flex items-center gap-2">
            <TextField
              className="flex-1 min-w-0"
              placeholder="Etiqueta"
              aria-label={`Etiqueta de la opción ${index + 1}`}
              icon={Tag}
              value={option.label ?? ""}
              disabled={readOnly}
              onChange={(e) => onChange(updateSelectOption(field, index, { label: e.target.value }))}
            />
            <TextField
              className="w-28 sm:w-36 font-mono text-xs"
              placeholder="VALOR"
              aria-label={`Valor de la opción ${index + 1}`}
              value={option.value ?? ""}
              disabled={readOnly}
              onChange={(e) => onChange(updateSelectOption(field, index, { value: e.target.value }))}
            />
            {!readOnly && (
              <Button size="icon" variant="ghost" className="shrink-0 text-red-600" aria-label="Eliminar opción" onClick={() => onChange(removeSelectOption(field, index))}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const FILE_ACCEPT_OPTIONS = [
  { value: "any", label: "Cualquier archivo" },
  { value: "image", label: "Imagen" },
  { value: "document", label: "Documento" },
];

function FileOptionsEditor({ field, onPatch, readOnly }) {
  const accept = field.accept ?? "any";
  return (
    <div className="space-y-4 rounded-xl border border-[hsl(var(--border))] p-3">
      <SelectField
        label="Tipo de archivo"
        hint="Elige Imagen si será una foto: permite usar la cámara y mostrarla en el encabezado del detalle."
        options={FILE_ACCEPT_OPTIONS}
        value={accept}
        disabled={readOnly}
        onValueChange={(value) => onPatch({ accept: value, camera: value === "image" ? field.camera : undefined })}
      />
      {accept === "image" && (
        <SwitchField
          label="Permitir cámara"
          description="En celular ofrece tomar la foto; en escritorio abre la webcam."
          checked={Boolean(field.camera)}
          disabled={readOnly}
          onChange={(checked) => onPatch({ camera: checked || undefined })}
        />
      )}
      <SelectField
        label="Tamaño máximo"
        options={[1, 2, 5, 10].map((mb) => ({ value: String(mb), label: `${mb} MB` }))}
        value={String(field.maxSizeMB ?? 10)}
        disabled={readOnly}
        onValueChange={(value) => onPatch({ maxSizeMB: Number(value) })}
      />
    </div>
  );
}

const RELATION_LABEL_TYPES = new Set(["text", "email", "phone", "select", "number", "decimal", "date", "datetime"]);
const ON_DISABLE_OPTIONS = [
  { value: "restrict", label: "Bloquear (no se puede desactivar mientras se use)" },
  { value: "setNull", label: "Dejar vacío en estos registros" },
  { value: "cascade", label: "Desactivar también estos registros" },
];

function RelationOptionsEditor({ field, definition, onPatch, readOnly }) {
  const target = (definition?.entities ?? []).find((entity) => entity.key === field.targetEntity);
  if (!target) return null;
  const labelOptions = (target.fields ?? [])
    .filter((item) => RELATION_LABEL_TYPES.has(item.type))
    .map((item) => ({ value: item.key, label: item.label }));
  const defaultLabel = (target.fields ?? []).find((item) => ["text", "email", "phone"].includes(item.type));
  const onDisableOptions = ON_DISABLE_OPTIONS.map((option) => (option.value === "setNull" && field.required
    ? { ...option, label: `${option.label} (no disponible: el campo es requerido)`, disabled: true }
    : option));
  return (
    <div className="space-y-4 rounded-xl border border-[hsl(var(--border))] p-3">
      <SelectField
        label="Campo a mostrar"
        hint={defaultLabel ? `Por defecto: ${defaultLabel.label}` : "La entidad relacionada no tiene campos de texto."}
        options={labelOptions}
        value={field.labelField ?? defaultLabel?.key ?? ""}
        disabled={readOnly || !labelOptions.length}
        onValueChange={(value) => onPatch({ labelField: value })}
      />
      <SelectField
        label={`Al desactivar un(a) ${target.label.toLowerCase()} usado(a) aquí`}
        options={onDisableOptions}
        value={field.onDisable ?? "restrict"}
        disabled={readOnly}
        onValueChange={(value) => onPatch({ onDisable: value })}
      />
    </div>
  );
}

export function FieldSheet({ open, onOpenChange, field, entity, definition, existedInPublished, canRenameWithData = false, readOnly, onSubmit }) {
  const isNew = !field;
  const { session } = useAuth();
  const token = session?.access_token;
  const [draft, setDraft] = useState(EMPTY_FIELD);
  const [createMore, setCreateMore] = useState(false);

  useEffect(() => {
    if (open) setDraft(field ?? EMPTY_FIELD);
  }, [open, field]);

  const isSelect = ["select", "multiselect"].includes(draft.type);
  // Relation targets: entities of this module ("entity:<key>") and system
  // entities of other modules ("external:<type>", /relation-targets catalog).
  const catalogQuery = useQuery({
    queryKey: ["relation-targets", token],
    queryFn: () => runly.builder.listRelationTargets(token),
    enabled: open && draft.type === "relation" && Boolean(token),
    staleTime: 5 * 60 * 1000,
  });
  const catalog = catalogQuery.data?.data ?? [];
  const relationTargets = [
    ...(definition?.entities ?? [])
      .filter((e) => e.key !== entity?.key)
      .map((e) => ({ value: `entity:${e.key}`, label: `Este módulo · ${e.label}` })),
    ...catalog.map((target) => ({
      value: `external:${target.type}`,
      label: `${target.moduleName} · ${target.label}${target.installed ? "" : " (módulo no instalado)"}`,
      disabled: !target.installed,
    })),
  ];
  const relationValue = draft.targetExternal ? `external:${draft.targetExternal}` : draft.targetEntity ? `entity:${draft.targetEntity}` : "";
  const externalInfo = draft.targetExternal ? catalog.find((target) => target.type === draft.targetExternal) : null;

  function handleRelationTarget(value) {
    const [kind, key] = value.split(":");
    if (kind === "external") patch({ targetExternal: key, targetEntity: undefined, labelField: undefined, onDisable: undefined });
    else patch({ targetEntity: key, targetExternal: undefined, labelField: undefined });
  }
  const keyPreview = isNew ? slugify(draft.label) : field.key;
  // Unpublished fields rename freely; published ones once their fieldId is published.
  const keyEditable = !isNew && (!existedInPublished || canRenameWithData);
  const keyError = !isNew && keyEditable ? validateFieldKey(draft.key, entity, field.key) : "";

  function patch(p) {
    setDraft((current) => ({ ...current, ...p }));
  }

  function handleTypeChange(type) {
    const next = { type, options: ["select", "multiselect"].includes(type) ? (draft.options ?? []) : undefined };
    if (type !== "relation") Object.assign(next, { targetEntity: undefined, targetExternal: undefined, labelField: undefined, onDisable: undefined });
    if (type !== "file") Object.assign(next, { accept: undefined, camera: undefined, maxSizeMB: undefined });
    patch(next);
  }

  function handleSubmit() {
    onSubmit(draft);
    if (isNew && createMore) setDraft(EMPTY_FIELD);
    else onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col gap-0 overflow-hidden">
        <SheetHeader className="shrink-0 pb-4 pr-8">
          <SheetTitle>{isNew ? "Crear campo" : "Editar campo"}</SheetTitle>
          <SheetDescription>
            {entity?.label ? `Entidad: ${entity.label}` : "Configura el campo de la entidad."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-y-auto -mx-6 px-6 py-1 space-y-4">
          {existedInPublished && (
            <p className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Este campo ya existe en la versión publicada. Si lo eliminas se archiva con sus datos; si cambias su tipo, al publicar se convierten los registros y se te pedirá qué hacer con los que no se puedan convertir.
            </p>
          )}
          <div className="space-y-4">
            <TextField
              label="Etiqueta"
              icon={Tag}
              required
              placeholder="Nombre del campo"
              value={draft.label ?? ""}
              disabled={readOnly}
              onChange={(e) => patch({ label: e.target.value })}
            />
            <SelectField
              label="Tipo"
              options={FIELD_TYPE_OPTIONS}
              value={draft.type}
              disabled={readOnly}
              onValueChange={handleTypeChange}
            />
          </div>
          {isNew || readOnly || !keyEditable ? (
            <div className="space-y-1">
              <span className="text-xs font-medium text-[hsl(var(--muted-foreground))]">Clave</span>
              <p className="flex items-center gap-2 rounded-lg bg-[hsl(var(--muted))] px-3 py-2 font-mono text-xs break-all">
                <KeyRound className="h-3.5 w-3.5 shrink-0 text-[hsl(var(--muted-foreground))]" />
                {keyPreview || "se genera a partir de la etiqueta"}
              </p>
              {isNew && <p className="text-xs text-[hsl(var(--muted-foreground))]">Podrás cambiarla después; el Constructor actualiza todas sus referencias.</p>}
              {!isNew && !readOnly && !keyEditable && (
                <p className="text-xs text-[hsl(var(--muted-foreground))]">Publica una vez el módulo para poder renombrar esta clave conservando sus datos.</p>
              )}
            </div>
          ) : (
            <TextField
              id="builder-field-key"
              label="Clave"
              icon={KeyRound}
              value={draft.key ?? ""}
              error={keyError}
              hint={existedInPublished ? "Al publicar se renombra la columna y se conservan los datos." : "Se actualizan el diseño, las vistas y las demás referencias."}
              onChange={(e) => patch({ key: e.target.value.trim() })}
            />
          )}
          <SwitchField
            label="Requerido"
            description="El registro no se puede guardar sin este valor."
            checked={Boolean(draft.required)}
            disabled={readOnly}
            onChange={(checked) => patch(checked && draft.onDisable === "setNull" ? { required: checked, onDisable: "restrict" } : { required: checked })}
          />
          {isSelect && <SelectOptionsEditor field={draft} onChange={setDraft} readOnly={readOnly} />}
          {draft.type === "relation" && (
            <SelectField
              label="Relacionar con"
              icon={Database}
              options={relationTargets}
              value={relationValue}
              disabled={readOnly}
              placeholder={catalogQuery.isLoading ? "Cargando..." : "Selecciona una entidad"}
              onValueChange={handleRelationTarget}
            />
          )}
          {draft.type === "relation" && externalInfo && (
            <p className="rounded-lg bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-300">
              Se buscará entre los {externalInfo.pluralLabel.toLowerCase()} de {externalInfo.moduleName}, con enlace a su ficha. Quien use tu módulo necesita permiso para verlos (<code>{externalInfo.permission}</code>), y tu módulo dependerá de {externalInfo.moduleName} para que no se desinstale mientras lo uses.
            </p>
          )}
          {draft.type === "relation" && draft.targetEntity && (
            <RelationOptionsEditor field={draft} definition={definition} onPatch={patch} readOnly={readOnly} />
          )}
          {draft.type === "file" && <FileOptionsEditor field={draft} onPatch={patch} readOnly={readOnly} />}
        </div>

        <div className="shrink-0 border-t border-[hsl(var(--border))] -mx-6 px-6 pt-4 mt-4 flex items-center justify-between gap-3">
          {isNew && !readOnly ? (
            <SwitchField label="Crear otro" checked={createMore} onChange={setCreateMore} />
          ) : <span />}
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{readOnly ? "Cerrar" : "Cancelar"}</Button>
            {!readOnly && (
              <Button disabled={!draft.label?.trim() || Boolean(keyError)} onClick={handleSubmit}>
                {isNew ? "Crear" : "Guardar"}
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
