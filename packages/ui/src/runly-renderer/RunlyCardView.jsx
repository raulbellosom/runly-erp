import { Eye, ImageIcon, FileText, Pencil, Trash2 } from "lucide-react";
import { Checkbox } from "../components/Checkbox.jsx";
import { ActionMenu } from "../components/ActionMenu.jsx";
import { ImageAssetCell } from "./ImageAssetCell.jsx";
import { formatCellText, getByPath, pickCardColumns } from "./table-card-columns.js";

// Grid of record cards. When the table has a photo column the card opens with
// a cover image; the title is the record's name (the link column), never the
// photo column's file id.
export function RunlyCardView({
  columns = [],
  rows = [],
  subtitleField = null,
  selectedIds = new Set(),
  onToggleSelect,
  getRowId,
  rowMenuItems = null,
  viewActionLabel = "Ver",
  editActionLabel = "Editar",
  deleteActionLabel = "Eliminar",
  accentColor = null,
  resolveItemColor = null,
  onView,
  onEdit,
  onDelete,
  token,
  apiBaseUrl,
  companyId,
}) {
  const { primary, subtitle, status, image, details } = pickCardColumns(columns, subtitleField);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {rows.map((row, rowIndex) => {
        const id = getRowId ? getRowId(row, rowIndex) : (row?.id != null ? String(row.id) : `card-${rowIndex}`);
        const isSelected = selectedIds.has(id);
        const title = primary ? formatCellText(primary, row) : `Registro ${rowIndex + 1}`;
        const subtitleText = subtitle ? formatCellText(subtitle, row) : "—";
        const statusText = status ? formatCellText(status, row) : "—";
        const effectiveColor = (resolveItemColor ? resolveItemColor(row) : null) || accentColor;
        const imageUrl = image?.type === "image" ? (getByPath(row, image.field) || null) : null;

        const imageCount = Number(row.image_count ?? 0);
        const docCount = Number(row.doc_count ?? 0);
        const otherCount = Math.max(0, docCount - imageCount);

        const menuItems = rowMenuItems
          ? rowMenuItems(row)
          : [
              onView && { label: viewActionLabel, icon: Eye, onClick: () => onView(row) },
              onEdit && { label: editActionLabel, icon: Pencil, onClick: () => onEdit(row) },
              onDelete && { label: deleteActionLabel, icon: Trash2, variant: "destructive", onClick: () => onDelete(row) },
            ].filter(Boolean);

        const selectBox = onToggleSelect ? (
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggleSelect(id)}
            aria-label="Seleccionar"
            className="shrink-0 bg-[hsl(var(--background))]/80"
          />
        ) : null;
        const menu = menuItems.length > 0 ? <ActionMenu items={menuItems} label="Acciones del registro" /> : null;

        return (
          <div
            key={id}
            className={`surface-card group flex flex-col overflow-hidden rounded-2xl border transition-all duration-150 hover:bg-[hsl(var(--muted))]/20${
              isSelected
                ? " border-indigo-500/60 bg-indigo-500/5"
                : " border-[hsl(var(--border))] hover:border-[hsl(var(--border))]/60"
            }`}
          >
            {image ? (
              <div className="relative border-b border-[hsl(var(--border))]/50">
                {image.type === "image-asset" ? (
                  <ImageAssetCell
                    variant="cover"
                    value={getByPath(row, image.field)}
                    row={row}
                    column={image}
                    token={token}
                    apiBaseUrl={apiBaseUrl}
                    companyId={companyId}
                  />
                ) : imageUrl ? (
                  <img src={imageUrl} alt={title} className="aspect-4/3 w-full object-cover" />
                ) : (
                  <div className="flex aspect-4/3 w-full items-center justify-center bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]">
                    <ImageIcon className="h-8 w-8 opacity-40" aria-hidden="true" />
                  </div>
                )}
                {selectBox && <div className="absolute left-3 top-3">{selectBox}</div>}
              </div>
            ) : effectiveColor ? (
              <div className="h-1.5 w-full shrink-0" style={{ backgroundColor: effectiveColor }} />
            ) : null}

            <div className="flex flex-1 flex-col gap-3 p-4">
              <div className="flex items-start gap-2">
                {!image && selectBox && <div className="mt-0.5">{selectBox}</div>}
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={onView ? () => onView(row) : undefined}
                    className="block w-full truncate text-left text-sm font-semibold text-[hsl(var(--foreground))] hover:underline focus:outline-none focus-visible:underline"
                    title={title}
                  >
                    {title}
                  </button>
                  {subtitleText !== "—" && (
                    <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{subtitleText}</p>
                  )}
                </div>
                {menu}
              </div>

              {statusText !== "—" && (
                <span className="w-fit rounded-full bg-[hsl(var(--muted))] px-2.5 py-0.5 text-xs font-medium text-[hsl(var(--foreground))]">
                  {statusText}
                </span>
              )}

              {details.length > 0 && (
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 border-t border-[hsl(var(--border))]/50 pt-3">
                  {details.map((col) => {
                    const text = formatCellText(col, row);
                    if (text === "—") return null;
                    return (
                      <div key={col.key} className="min-w-0">
                        <dt className="truncate text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]/70">
                          {col.label}
                        </dt>
                        <dd className="truncate text-xs text-[hsl(var(--foreground))]" title={text}>{text}</dd>
                      </div>
                    );
                  })}
                </dl>
              )}

              {docCount > 0 && (
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
