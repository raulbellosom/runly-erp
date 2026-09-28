// Module Builder — "Diseño" building blocks: one card per section kind
// (fields, documentos adjuntos, registros relacionados) plus the shared row
// pieces (field chip, menus, order buttons, rule badge, columns picker).
// Each kind has its own icon, accent and one-line explanation so authors can
// tell a section from a tab without reading the JSON contract.
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
import { ArrowDown, ArrowUp, Eye, GripVertical, LayoutGrid, Link2, MoreHorizontal, Paperclip, Trash2 } from "lucide-react";
import {
  moveSection,
  placeField,
  removeSection,
  reorderSectionFields,
  ruleSummary,
  setFieldRule,
  setSectionRule,
  updateSection,
} from "../../lib/layoutHelpers";
import { FIELD_TYPE_ICONS, DEFAULT_FIELD_ICON } from "../../lib/builderFieldIcons";

// Where the attachments section sits in the form (the detail uses the aside
// column automatically when "Detalle en dos columnas" is on).
const PLACEMENT_OPTIONS = [
  { value: "embedded", label: "Dentro del formulario" },
  { value: "aside", label: "En la columna lateral" },
];

export const SECTION_KINDS = {
  fields: {
    icon: LayoutGrid,
    caption: "Sección",
    accent: "border-l-sky-500",
    iconClass: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
  attachments: {
    icon: Paperclip,
    caption: "Documentos adjuntos",
    accent: "border-l-amber-500",
    iconClass: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    help: "Aquí se adjuntan varios archivos sueltos a cada registro (contratos, PDFs, fotos extra). Para un archivo concreto, como la foto del cliente, usa un campo de tipo Archivo: sus archivos no se repiten aquí.",
  },
  related: {
    icon: Link2,
    caption: "Registros relacionados",
    accent: "border-l-violet-500",
    iconClass: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
    help: "Muestra en el detalle la lista de registros de otra entidad que apuntan a este. No aparece en el formulario.",
  },
};

export function RuleBadge({ rule, fieldsByKey }) {
  if (!rule) return null;
  return (
    <Badge variant="outline" className="max-w-56 shrink-0 gap-1 truncate text-[11px]">
      <Eye className="h-3 w-3" />
      <span className="truncate">Visible si {ruleSummary(rule, fieldsByKey)}</span>
    </Badge>
  );
}

export function ConditionButton({ label, active, onClick }) {
  return (
    <Button size="icon-sm" variant="ghost" className={active ? "text-(--brand-primary)" : ""} aria-label={`Condición de ${label}`} title="Mostrar solo si..." onClick={onClick}>
      <Eye className="h-3.5 w-3.5" />
    </Button>
  );
}

export function OrderButtons({ label, onUp, onDown, onRemove, readOnly }) {
  if (readOnly) return null;
  return (
    <div className="flex shrink-0 items-center">
      <Button size="icon-sm" variant="ghost" aria-label={`Subir ${label}`} title="Subir" onClick={onUp}><ArrowUp className="h-3.5 w-3.5" /></Button>
      <Button size="icon-sm" variant="ghost" aria-label={`Bajar ${label}`} title="Bajar" onClick={onDown}><ArrowDown className="h-3.5 w-3.5" /></Button>
      {onRemove ? (
        <Button size="icon-sm" variant="ghost" className="text-red-600" aria-label={`Eliminar ${label}`} title="Eliminar" onClick={onRemove}><Trash2 className="h-3.5 w-3.5" /></Button>
      ) : null}
    </div>
  );
}

// Segmented 1/2/3 columns control drawn as little column bars.
function ColumnsPicker({ value, onChange, disabled }) {
  return (
    <div className="flex shrink-0 items-center gap-1 rounded-lg bg-[hsl(var(--muted))] p-0.5" role="radiogroup" aria-label="Columnas">
      {[1, 2, 3].map((count) => (
        <button
          key={count}
          type="button"
          role="radio"
          aria-checked={value === count}
          aria-label={`${count} ${count === 1 ? "columna" : "columnas"}`}
          title={`${count} ${count === 1 ? "columna" : "columnas"}`}
          disabled={disabled}
          onClick={() => onChange(count)}
          className={`flex h-7 w-9 cursor-pointer items-center justify-center gap-0.5 rounded-md transition-colors ${value === count ? "bg-[hsl(var(--card))] text-(--brand-primary) shadow-sm" : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"}`}
        >
          {Array.from({ length: count }).map((_, index) => <span key={index} className="h-3.5 w-1.5 rounded-sm bg-current" />)}
        </button>
      ))}
    </div>
  );
}

export function FieldMenu({ label, targets, currentKey, onMove, onUnplace, onCondition }) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={`Acciones de ${label}`}>
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onCondition ? (
          <>
            <DropdownMenuItem onSelect={onCondition}>Mostrar solo si...</DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
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

export function FieldChip({ field, dragHandleProps, isDragging, menu, badge }) {
  const Icon = FIELD_TYPE_ICONS[field.type] ?? DEFAULT_FIELD_ICON;
  return (
    <div className={`flex items-center gap-2 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 ${isDragging ? "shadow-lg" : ""}`}>
      {dragHandleProps ? (
        <button type="button" className="cursor-grab touch-none text-[hsl(var(--muted-foreground))]" aria-label={`Reordenar ${field.label}`} {...dragHandleProps}>
          <GripVertical className="h-4 w-4" />
        </button>
      ) : null}
      <Icon className="h-4 w-4 shrink-0 text-[hsl(var(--muted-foreground))]" />
      <span className="min-w-0 flex-1 truncate text-sm">{field.label}</span>
      {field.required && <span className="shrink-0 text-xs text-red-500" title="Requerido">*</span>}
      {badge}
      {menu}
    </div>
  );
}

function SectionHeader({ kind, section, layout, fieldsByKey, readOnly, onChange, onEditRule, extra }) {
  const Icon = kind.icon;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${kind.iconClass}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-40 flex-1">
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{kind.caption}</span>
        <TextField
          aria-label={`Título de la ${kind.caption.toLowerCase()}`}
          placeholder="Título que verá el usuario"
          value={section.label}
          disabled={readOnly}
          onChange={(e) => onChange(updateSection(layout, section.key, { label: e.target.value }))}
        />
      </div>
      {extra}
      <RuleBadge rule={section.visibleWhen} fieldsByKey={fieldsByKey} />
      {!readOnly && (
        <ConditionButton
          label={section.label}
          active={Boolean(section.visibleWhen)}
          onClick={() => onEditRule({
            title: section.label,
            rule: section.visibleWhen,
            excludeFields: section.fields ?? [],
            apply: (rule) => setSectionRule(layout, section.key, rule),
          })}
        />
      )}
      <OrderButtons
        label={section.label}
        readOnly={readOnly}
        onUp={() => onChange(moveSection(layout, section.key, -1))}
        onDown={() => onChange(moveSection(layout, section.key, 1))}
        onRemove={() => onChange(removeSection(layout, section.key))}
      />
    </div>
  );
}

export function SectionCard({ section, layout, fieldsByKey, targets, readOnly, onChange, onEditRule, relatedLabel }) {
  const type = section.type ?? "fields";
  const kind = SECTION_KINDS[type] ?? SECTION_KINDS.fields;
  const shell = `space-y-3 rounded-xl border border-l-4 border-[hsl(var(--border))] ${kind.accent} bg-[hsl(var(--card))] p-3`;
  const headerProps = { kind, section, layout, fieldsByKey, readOnly, onChange, onEditRule };

  if (type === "attachments" || type === "related") {
    return (
      <div className={shell}>
        <SectionHeader
          {...headerProps}
          extra={type === "attachments" ? (
            <SelectField className="w-52" options={PLACEMENT_OPTIONS} value={section.placement ?? "embedded"} disabled={readOnly} onValueChange={(value) => onChange(updateSection(layout, section.key, { placement: value }))} />
          ) : null}
        />
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          {type === "related" && relatedLabel ? `Lista de ${relatedLabel}. ` : ""}{kind.help}
        </p>
      </div>
    );
  }

  const items = (section.fields ?? []).map((key) => fieldsByKey.get(key)).filter(Boolean).map((field) => ({ id: field.key, field }));
  const fieldBadge = (field) => <RuleBadge rule={section.fieldRules?.[field.key]} fieldsByKey={fieldsByKey} />;
  return (
    <div className={shell}>
      <SectionHeader
        {...headerProps}
        extra={<ColumnsPicker value={section.columns ?? 2} disabled={readOnly} onChange={(columns) => onChange(updateSection(layout, section.key, { columns }))} />}
      />
      {items.length ? (
        readOnly ? (
          <div className="space-y-1.5">{items.map(({ field }) => <FieldChip key={field.key} field={field} badge={fieldBadge(field)} />)}</div>
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
                  badge={fieldBadge(field)}
                  menu={(
                    <FieldMenu
                      label={field.label}
                      targets={targets}
                      currentKey={section.key}
                      onMove={(target) => onChange(placeField(layout, field.key, target))}
                      onUnplace={() => onChange(placeField(layout, field.key, null))}
                      onCondition={() => onEditRule({
                        title: field.label,
                        rule: section.fieldRules?.[field.key],
                        excludeFields: [field.key],
                        apply: (rule) => setFieldRule(layout, section.key, field.key, rule),
                      })}
                    />
                  )}
                />
              </div>
            )}
          />
        )
      ) : (
        <p className="rounded-lg border border-dashed border-[hsl(var(--border))] px-3 py-3 text-center text-xs text-[hsl(var(--muted-foreground))]">
          Sección vacía. Usa el menú de un campo (···) para moverlo aquí.
        </p>
      )}
    </div>
  );
}
