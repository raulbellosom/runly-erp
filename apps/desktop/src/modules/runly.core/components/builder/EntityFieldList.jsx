// Module Builder — table-like, drag-sortable list of an entity's fields
// (modelled on Appwrite's Columns view). Editing happens in FieldSheet; this
// component only renders rows, reorders, and raises edit/delete intents.
import {
  Button,
  Badge,
  SortableList,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@runly/ui";
import {
  GripVertical,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { FIELD_TYPE_LABELS } from "../../lib/builderHelpers";
import { FIELD_TYPE_ICONS, DEFAULT_FIELD_ICON } from "../../lib/builderFieldIcons";

const ROW_GRID = "grid grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-[auto_minmax(0,1fr)_10rem_auto] items-center gap-x-3";

function FieldRowContent({ field, readOnly, dragHandleProps, isDragging, onEdit, onDelete }) {
  const Icon = FIELD_TYPE_ICONS[field.type] ?? DEFAULT_FIELD_ICON;
  const typeLabel = FIELD_TYPE_LABELS[field.type] ?? field.type;

  return (
    <div
      className={`${ROW_GRID} px-2 sm:px-3 py-2.5 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] transition-colors hover:bg-[hsl(var(--muted))]/40 ${isDragging ? "relative z-10 shadow-lg rounded-lg" : ""}`}
    >
      {readOnly ? (
        <span className="w-6" />
      ) : (
        <button
          type="button"
          className="flex h-8 w-6 cursor-grab touch-none items-center justify-center rounded text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] active:cursor-grabbing"
          aria-label={`Reordenar ${field.label}`}
          {...dragHandleProps}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}

      <button type="button" className="flex min-w-0 items-center gap-3 text-left cursor-pointer" onClick={onEdit}>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-2 min-w-0">
            <span className="truncate text-sm font-medium">{field.label}</span>
            {field.required && <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0">Requerido</Badge>}
          </span>
          <span className="block truncate font-mono text-xs text-[hsl(var(--muted-foreground))]">
            {field.key}
            <span className="sm:hidden font-sans"> · {typeLabel}</span>
          </span>
        </span>
      </button>

      <span className="hidden sm:block truncate text-sm text-[hsl(var(--muted-foreground))]">{typeLabel}</span>

      {/* modal={false}: the menu opens a Sheet/ConfirmDialog, and a modal menu
          closing into a modal dialog can leave body pointer-events locked. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" aria-label={`Acciones de ${field.label}`}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil />
            {readOnly ? "Ver" : "Editar"}
          </DropdownMenuItem>
          {!readOnly && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-red-600 focus:text-red-600" onSelect={onDelete}>
                <Trash2 />
                Eliminar
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function EntityFieldList({ fields, readOnly, onReorder, onEdit, onDelete }) {
  const items = fields.map((field) => ({ id: field.key, field }));

  return (
    <div className="overflow-hidden rounded-xl border border-[hsl(var(--border))]">
      <div className={`${ROW_GRID} px-2 sm:px-3 py-2 bg-[hsl(var(--muted))]/40 text-xs font-medium text-[hsl(var(--muted-foreground))]`}>
        <span className="w-6" />
        <span>Nombre</span>
        <span className="hidden sm:block">Tipo</span>
        <span className="w-9" />
      </div>
      <div>
        <SortableList
          items={items}
          onReorder={(next) => onReorder(next.map((item) => item.field))}
          renderItem={({ field }, { dragHandleProps, isDragging }) => (
            <FieldRowContent
              field={field}
              readOnly={readOnly}
              dragHandleProps={dragHandleProps}
              isDragging={isDragging}
              onEdit={() => onEdit(field)}
              onDelete={() => onDelete(field)}
            />
          )}
        />
      </div>
    </div>
  );
}
