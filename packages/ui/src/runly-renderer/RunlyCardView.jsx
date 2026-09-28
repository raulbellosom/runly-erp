import { Eye, ImageIcon, FileText, Pencil, Trash2, Image } from "lucide-react";
import { Checkbox } from "../components/Checkbox.jsx";
import { ActionMenu } from "../components/ActionMenu.jsx";
import { stripMarkdown } from "./renderer-adapters.js";

const STATUS_LABELS = {
  active: "Activo",
  inactive: "Inactivo",
  maintenance: "En mantenimiento",
  retired: "Retirado",
  pending: "Pendiente",
  disabled: "Desactivado",
};

function renderValue(value) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  const str = String(value);
  return STATUS_LABELS[str.toLowerCase()] ?? str;
}

function formatCardDate(value) {
  if (!value) return "—";
  const str = String(value);
  const datePart = str.includes("T") ? str.slice(0, 10) : str;
  const [year, month, day] = datePart.split("-");
  if (!year || !month || !day) return str;
  return `${day}/${month}/${year}`;
}

function formatCardCurrency(value, currencyCode = "MXN") {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "—";
  const code = currencyCode && /^[A-Z]{3}$/.test(String(currencyCode).toUpperCase())
    ? String(currencyCode).toUpperCase()
    : "MXN";
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: code }).format(amount);
}

function renderColValue(col, value, row = {}) {
  if (col.type === "date" || col.type === "datetime") return formatCardDate(value);
  if (col.type === "currency" || col.type === "decimal") return formatCardCurrency(value, row.currency);
  if (col.type === "select" && col.options) {
    const opt = col.options.find((o) => String(o.value) === String(value ?? ""));
    return opt?.label ?? renderValue(value);
  }
  if (col.type === "markdown") return stripMarkdown(value);
  return renderValue(value);
}

export function RunlyCardView({
  columns = [],
  rows = [],
  selectedIds = new Set(),
  onToggleSelect,
  getRowId,
  viewActionLabel = "Ver",
  editActionLabel = "Editar",
  deleteActionLabel = "Eliminar",
  accentColor = null,
  resolveItemColor = null,
  onView,
  onEdit,
  onDelete,
}) {
  const primaryColumn = columns[0] ?? null;
  const statusColumn = columns.find((c) => /^(status|estado|published)$/i.test(c.field)) ?? null;
  const colorColumn = columns.find((c) => c.type === "color") ?? null;
  const imageColumn = columns.find((c) => c.type === "image") ?? null;
  const secondaryColumns = columns.filter(
    (c) => c !== primaryColumn && c !== statusColumn && c !== colorColumn && c !== imageColumn,
  );

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {rows.map((row, rowIndex) => {
        const id = getRowId ? getRowId(row, rowIndex) : (row?.id != null ? String(row.id) : `card-${rowIndex}`);
        const isSelected = selectedIds.has(id);

        const titleVal = primaryColumn
          ? renderValue(row[primaryColumn.field])
          : `Registro ${rowIndex + 1}`;
        const initials =
          titleVal !== "—" && titleVal.length > 0 ? titleVal.charAt(0).toUpperCase() : "#";

        const itemColor = resolveItemColor ? resolveItemColor(row) : null;
        const effectiveColor = itemColor || accentColor;
        const imageUrl = imageColumn ? (row[imageColumn.field] || null) : null;

        const imageCount = Number(row.image_count ?? 0);
        const docCount = Number(row.doc_count ?? 0);
        const otherCount = Math.max(0, docCount - imageCount);
        const hasFiles = docCount > 0;

        const menuItems = [
          onView && { label: viewActionLabel, icon: Eye, onClick: () => onView(row) },
          onEdit && { label: editActionLabel, icon: Pencil, onClick: () => onEdit(row) },
          onDelete && { label: deleteActionLabel, icon: Trash2, variant: "destructive", onClick: () => onDelete(row) },
        ].filter(Boolean);

        return (
          <div
            key={id}
            className={`surface-card group flex flex-col rounded-2xl border overflow-hidden transition-all duration-150 hover:bg-[hsl(var(--muted))]/20${
              isSelected
                ? " border-indigo-500/60 bg-indigo-500/5"
                : " border-[hsl(var(--border))] hover:border-[hsl(var(--border))]/60"
            }`}
          >
            {effectiveColor && (
              <div className="h-1.5 w-full shrink-0" style={{ backgroundColor: effectiveColor }} />
            )}

            <div className="flex flex-col gap-3 p-4">
              <div className="flex items-start gap-3">
                {onToggleSelect && (
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => onToggleSelect(id)}
                    aria-label="Seleccionar"
                    className="mt-0.5 shrink-0"
                  />
                )}
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={titleVal}
                    className="h-10 w-10 rounded-xl shrink-0 object-cover"
                  />
                ) : (
                  <div
                    className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor: effectiveColor ? `${effectiveColor}26` : "hsl(var(--muted))",
                    }}
                  >
                    <span
                      className="text-sm font-semibold"
                      style={{ color: effectiveColor ?? "hsl(var(--muted-foreground))" }}
                    >
                      {initials}
                    </span>
                  </div>
                )}
                <div className="min-w-0 flex-1 pt-0.5">
                  <button
                    type="button"
                    onClick={onView ? () => onView(row) : undefined}
                    className="truncate text-sm font-semibold text-[hsl(var(--foreground))] hover:underline focus:outline-none focus-visible:underline text-left w-full"
                  >
                    {titleVal}
                  </button>
                  {statusColumn && renderColValue(statusColumn, row[statusColumn.field], row) !== "—" && (
                    <div className="mt-1">
                      <span className="inline-block text-xs font-medium text-[hsl(var(--foreground))] bg-[hsl(var(--muted))] rounded-full px-2.5 py-0.5">
                        {renderColValue(statusColumn, row[statusColumn.field], row)}
                      </span>
                    </div>
                  )}
                </div>
                {menuItems.length > 0 && (
                  <ActionMenu items={menuItems} label="Acciones del registro" />
                )}
              </div>

              {secondaryColumns.length > 0 && (
                <div className="space-y-1.5 border-t border-[hsl(var(--border))]/50 pt-2.5">
                  {secondaryColumns.map((col) => {
                    const val = renderColValue(col, row[col.field], row);
                    if (val === "—") return null;
                    return (
                      <div
                        key={col.key}
                        className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"
                      >
                        <span className="shrink-0 font-medium text-[hsl(var(--foreground))]/70">{col.label}:</span>
                        <span className="truncate">{val}</span>
                      </div>
                    );
                  })}
                </div>
              )}

              {hasFiles && (
                <div className="flex items-center gap-3 border-t border-[hsl(var(--border))]/50 pt-2.5">
                  {imageCount > 0 && (
                    <span className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]">
                      <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                      {imageCount}
                    </span>
                  )}
                  {otherCount > 0 && (
                    <span className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]">
                      <FileText className="h-3.5 w-3.5 shrink-0" />
                      {otherCount}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
