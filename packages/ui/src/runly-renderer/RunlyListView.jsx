import { Checkbox } from "../components/Checkbox.jsx";
import { Skeleton } from "../components/Skeleton.jsx";
import { ActionMenu } from "../components/ActionMenu.jsx";
import { resolveColorHex } from "./runly-form-utils.js";
import { ImageAssetCell } from "./ImageAssetCell.jsx";
import { formatCellText, getByPath, pickCardColumns } from "./table-card-columns.js";

export function RunlyListSkeleton() {
  return (
    <div className="rounded-2xl glass-shell-flat overflow-clip">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={`sk-list-${i}`}
          className="flex items-center gap-3 px-4 py-4 border-b border-[hsl(var(--border))] last:border-0"
        >
          <Skeleton className="h-4 w-4 rounded shrink-0" />
          <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
          <div className="shrink-0 w-48 space-y-1.5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="hidden sm:grid sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2 flex-1">
            {Array.from({ length: 4 }).map((__, j) => (
              <div key={j} className="space-y-1">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-3.5 w-24" />
              </div>
            ))}
          </div>
          <Skeleton className="h-7 w-7 rounded-md shrink-0" />
        </div>
      ))}
    </div>
  );
}

// Stacked rows: photo, title (the record's name) + subtitle + status, then a
// label/value grid of the remaining visible columns.
export function RunlyListView({
  columns,
  rows,
  subtitleField = null,
  statusField = null,
  selectedIds,
  onToggleSelect,
  getRowId,
  rowMenuItems,
  onView,
  accentColor = null,
  token,
  apiBaseUrl,
  companyId,
}) {
  const { primary, subtitle, status, color, image, details } = pickCardColumns(columns, subtitleField, statusField);

  return (
    <div className="rounded-2xl glass-shell-flat overflow-clip">
      {rows.map((row, rowIndex) => {
        const id = getRowId(row, rowIndex);
        const isSelected = selectedIds.has(id);
        const title = primary ? formatCellText(primary, row) : `Registro ${rowIndex + 1}`;
        const subtitleText = subtitle ? formatCellText(subtitle, row) : "—";
        const statusText = status ? formatCellText(status, row) : "—";
        const itemColor = color ? resolveColorHex(getByPath(row, color.field)) || null : null;
        const tint = itemColor ?? accentColor;
        const menuItems = rowMenuItems(row);

        let media;
        if (image?.type === "image-asset") {
          media = (
            <ImageAssetCell
              variant="avatar"
              value={getByPath(row, image.field)}
              row={row}
              column={image}
              token={token}
              apiBaseUrl={apiBaseUrl}
              companyId={companyId}
            />
          );
        } else if (image && getByPath(row, image.field)) {
          media = (
            <img
              src={getByPath(row, image.field)}
              alt={title}
              className="h-10 w-10 rounded-xl shrink-0 object-cover"
            />
          );
        } else {
          media = (
            <div
              className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: tint ? `${tint}26` : "hsl(var(--muted))" }}
            >
              <span
                className="text-sm font-semibold"
                style={{ color: tint ?? "hsl(var(--muted-foreground))" }}
              >
                {title !== "—" ? title.charAt(0).toUpperCase() : "#"}
              </span>
            </div>
          );
        }

        return (
          <div
            key={id}
            className={`flex items-center gap-3 px-4 py-3.5 border-b border-[hsl(var(--border))] last:border-0 hover:bg-[hsl(var(--muted))]/30 transition-colors${isSelected ? " bg-indigo-500/5" : ""}`}
          >
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggleSelect(id)}
              aria-label="Seleccionar"
              className="shrink-0"
            />
            {media}

            <div className="w-40 shrink-0 min-w-0 sm:w-48">
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
              {statusText !== "—" && (
                <span className="mt-1 inline-block rounded-full bg-[hsl(var(--muted))] px-2.5 py-0.5 text-xs font-medium text-[hsl(var(--foreground))]">
                  {statusText}
                </span>
              )}
            </div>

            {details.length > 0 && (
              <div className="hidden min-w-0 flex-1 gap-x-6 gap-y-1.5 sm:grid sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {details.map((col) => {
                  const text = formatCellText(col, row);
                  if (text === "—") return null;
                  return (
                    <div key={col.key} className="min-w-0">
                      <p className="truncate text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]/70">
                        {col.label}
                      </p>
                      <p className="truncate text-xs text-[hsl(var(--foreground))]" title={text}>{text}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {menuItems.length > 0 && (
              <div className="ml-auto">
                <ActionMenu items={menuItems} label="Acciones del registro" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
