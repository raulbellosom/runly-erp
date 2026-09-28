// Module Builder — "Diseño" tree: tabs -> sections -> fields. Fields are
// reordered by drag inside a section and moved between sections (or back to
// "Campos sin colocar") from each row's menu.
import {
  Badge,
  Button,
  SelectField,
  SortableList,
  TextField,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@runly/ui";
import { ArrowDown, ArrowUp, FolderPlus, GripVertical, MoreHorizontal, Paperclip, Plus, Trash2 } from "lucide-react";
import {
  addSection,
  addTab,
  canAddTab,
  hasAttachmentsSection,
  moveSection,
  moveTab,
  placeField,
  removeSection,
  removeTab,
  reorderSectionFields,
  unplacedFields,
  updateSection,
  updateTab,
} from "../../lib/layoutHelpers";
import { FIELD_TYPE_ICONS, DEFAULT_FIELD_ICON } from "../../lib/builderFieldIcons";

const COLUMN_OPTIONS = [
  { value: "1", label: "1 columna" },
  { value: "2", label: "2 columnas" },
  { value: "3", label: "3 columnas" },
];

// Where the attachments section sits in the form (the detail uses the aside
// column automatically when "Detalle en dos columnas" is on).
const PLACEMENT_OPTIONS = [
  { value: "embedded", label: "En el formulario" },
  { value: "aside", label: "Columna lateral" },
];

function fieldSections(layout) {
  return layout.tabs.flatMap((tab) => tab.sections
    .filter((section) => section.type !== "attachments")
    .map((section) => ({ key: section.key, label: layout.tabs.length > 1 ? `${tab.label} / ${section.label}` : section.label })));
}

function MoveMenu({ label, targets, currentKey, onMove, onUnplace }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`Mover ${label}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Mover a</DropdownMenuLabel>
        {targets.filter((target) => target.key !== currentKey).map((target) => (
          <DropdownMenuItem key={target.key} onSelect={() => onMove(target.key)}>{target.label}</DropdownMenuItem>
        ))}
        {onUnplace ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onUnplace}>Quitar de la sección</DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FieldChip({ field, dragHandleProps, isDragging, menu }) {
  const Icon = FIELD_TYPE_ICONS[field.type] ?? DEFAULT_FIELD_ICON;
  return (
    <div className={`flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-2 py-1.5 ${isDragging ? "shadow-lg" : ""}`}>
      {dragHandleProps ? (
        <button type="button" className="cursor-grab touch-none text-[hsl(var(--muted-foreground))]" aria-label={`Reordenar ${field.label}`} {...dragHandleProps}>
          <GripVertical className="h-4 w-4" />
        </button>
      ) : null}
      <Icon className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
      <span className="min-w-0 flex-1 truncate text-sm">{field.label}</span>
      {menu}
    </div>
  );
}

function OrderButtons({ label, onUp, onDown, onRemove, readOnly }) {
  if (readOnly) return null;
  return (
    <div className="flex shrink-0 items-center">
      <Button size="icon-sm" variant="ghost" aria-label={`Subir ${label}`} onClick={onUp}><ArrowUp className="h-3.5 w-3.5" /></Button>
      <Button size="icon-sm" variant="ghost" aria-label={`Bajar ${label}`} onClick={onDown}><ArrowDown className="h-3.5 w-3.5" /></Button>
      {onRemove ? (
        <Button size="icon-sm" variant="ghost" className="text-red-600" aria-label={`Eliminar ${label}`} onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>
      ) : null}
    </div>
  );
}

function SectionBlock({ section, layout, fieldsByKey, targets, readOnly, onChange }) {
  if (section.type === "attachments") {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-[hsl(var(--border))] px-3 py-2">
        <Paperclip className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
        <TextField className="flex-1" aria-label="Nombre de la sección" value={section.label} disabled={readOnly} onChange={(e) => onChange(updateSection(layout, section.key, { label: e.target.value }))} />
        <SelectField
          className="w-44"
          options={PLACEMENT_OPTIONS}
          value={section.placement ?? "embedded"}
          disabled={readOnly}
          onValueChange={(value) => onChange(updateSection(layout, section.key, { placement: value }))}
        />
        <OrderButtons label={section.label} readOnly={readOnly} onUp={() => onChange(moveSection(layout, section.key, -1))} onDown={() => onChange(moveSection(layout, section.key, 1))} onRemove={() => onChange(removeSection(layout, section.key))} />
      </div>
    );
  }
  const items = (section.fields ?? []).map((key) => fieldsByKey.get(key)).filter(Boolean).map((field) => ({ id: field.key, field }));
  return (
    <div className="space-y-2 rounded-xl border border-[hsl(var(--border))] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <TextField className="min-w-40 flex-1" aria-label="Nombre de la sección" value={section.label} disabled={readOnly} onChange={(e) => onChange(updateSection(layout, section.key, { label: e.target.value }))} />
        <SelectField className="w-36" aria-label="Columnas" options={COLUMN_OPTIONS} value={String(section.columns ?? 2)} disabled={readOnly} onValueChange={(value) => onChange(updateSection(layout, section.key, { columns: Number(value) }))} />
        <OrderButtons label={section.label} readOnly={readOnly} onUp={() => onChange(moveSection(layout, section.key, -1))} onDown={() => onChange(moveSection(layout, section.key, 1))} onRemove={() => onChange(removeSection(layout, section.key))} />
      </div>
      {items.length ? (
        readOnly ? (
          <div className="space-y-1.5">{items.map(({ field }) => <FieldChip key={field.key} field={field} />)}</div>
        ) : (
          <SortableList
            items={items}
            onReorder={(next) => onChange(reorderSectionFields(layout, section.key, next.map((item) => item.id)))}
            renderItem={({ field }, { dragHandleProps, isDragging }) => (
              <div className="pb-1.5">
                <FieldChip
                  field={field}
                  dragHandleProps={dragHandleProps}
                  isDragging={isDragging}
                  menu={<MoveMenu label={field.label} targets={targets} currentKey={section.key} onMove={(target) => onChange(placeField(layout, field.key, target))} onUnplace={() => onChange(placeField(layout, field.key, null))} />}
                />
              </div>
            )}
          />
        )
      ) : (
        <p className="px-1 text-xs text-[hsl(var(--muted-foreground))]">Sección vacía. Mueve campos aquí desde otra sección o desde "Campos sin colocar".</p>
      )}
    </div>
  );
}

export function LayoutTree({ layout, entity, readOnly, onChange }) {
  const fieldsByKey = new Map((entity.fields ?? []).map((field) => [field.key, field]));
  const targets = fieldSections(layout);
  const unplaced = unplacedFields(layout, entity);
  const multiTab = layout.tabs.length > 1;

  return (
    <div className="space-y-4">
      {unplaced.length > 0 && (
        <div className="space-y-2 rounded-xl bg-amber-500/10 p-3">
          <p className="text-sm font-medium">Campos sin colocar</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">Si no los colocas, aparecerán al final en "Otros datos".</p>
          {unplaced.map((field) => (
            <FieldChip
              key={field.key}
              field={field}
              menu={readOnly || !targets.length ? null : <MoveMenu label={field.label} targets={targets} onMove={(target) => onChange(placeField(layout, field.key, target))} />}
            />
          ))}
        </div>
      )}

      {layout.tabs.map((tab) => (
        <div key={tab.key} className="space-y-3 rounded-2xl border border-[hsl(var(--border))] p-3">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="shrink-0">Pestaña</Badge>
            <TextField className="flex-1" aria-label="Nombre de la pestaña" value={tab.label} disabled={readOnly} onChange={(e) => onChange(updateTab(layout, tab.key, { label: e.target.value }))} />
            {multiTab ? (
              <OrderButtons label={tab.label} readOnly={readOnly} onUp={() => onChange(moveTab(layout, tab.key, -1))} onDown={() => onChange(moveTab(layout, tab.key, 1))} onRemove={() => onChange(removeTab(layout, tab.key))} />
            ) : null}
          </div>
          {tab.sections.map((section) => (
            <SectionBlock key={section.key} section={section} layout={layout} fieldsByKey={fieldsByKey} targets={targets} readOnly={readOnly} onChange={onChange} />
          ))}
          {!readOnly && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => onChange(addSection(layout, tab.key, { label: "Nueva sección" }))}>
                <Plus className="h-3.5 w-3.5" /> Agregar sección
              </Button>
              {!hasAttachmentsSection(layout) && (
                <Button size="sm" variant="ghost" onClick={() => onChange(addSection(layout, tab.key, { label: "Documentos", type: "attachments" }))}>
                  <Paperclip className="h-3.5 w-3.5" /> Agregar sección de documentos
                </Button>
              )}
            </div>
          )}
        </div>
      ))}

      {!readOnly && canAddTab(layout) && (
        <Button size="sm" variant="outline" onClick={() => onChange(addTab(layout, `Pestaña ${layout.tabs.length + 1}`))}>
          <FolderPlus className="h-4 w-4" /> Agregar pestaña
        </Button>
      )}
    </div>
  );
}
