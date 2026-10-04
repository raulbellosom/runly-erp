import { Download, X } from "lucide-react";
import { toLocalIso } from "@runly/core/browser";
import { Button } from "../components/Button.jsx";

function getByPath(input, path) {
  if (!path) return undefined;
  return String(path)
    .split(".")
    .filter(Boolean)
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), input);
}

function formatCsvValue(value, col) {
  if (value === undefined || value === null || value === "") return "";
  if (col.type === "select" && Array.isArray(col.options)) {
    const opt = col.options.find((o) => String(o.value) === String(value));
    if (opt) return opt.label;
  }
  if (col.type === "date" || col.type === "datetime") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString("es-MX", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    }
  }
  if (col.type === "boolean") return value ? "Si" : "No";
  return String(value);
}

function exportCsv(rows, columns) {
  const headers = columns.map((c) => c.label);
  const body = rows.map((row) =>
    columns
      .map((col) => {
        const v = getByPath(row, col.field) ?? "";
        const formatted = formatCsvValue(v, col);
        return `"${formatted.replace(/"/g, '""')}"`;
      })
      .join(","),
  );
  const csv = [headers.join(","), ...body].join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `export-${toLocalIso()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function BulkActionBar({
  selectedCount,
  selectedRows,
  visibleColumns,
  onClear,
  bulkActions = [],
  onExportExcel,
}) {
  if (selectedCount === 0) return null;

  const resolvedActions = bulkActions
    .map((action) =>
      typeof action === "function" ? action(selectedRows) : action,
    )
    .filter((action) => action && action.hidden !== true);

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 max-w-[calc(100vw-1rem)]">
      <div className="flex items-center gap-1 overflow-x-auto whitespace-nowrap rounded-lg border border-border bg-background px-3 py-2 shadow-lg">
        <span className="mr-2 text-sm font-medium text-foreground whitespace-nowrap">
          <span className="hidden sm:inline">
            {selectedCount}{" "}
            {selectedCount === 1 ? "seleccionado" : "seleccionados"}
          </span>
          <span className="sm:hidden">{selectedCount} sel.</span>
        </span>

        <div className="mr-1 h-4 w-px bg-border" />

        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={() => exportCsv(selectedRows, visibleColumns)}
        >
          <Download className="h-3.5 w-3.5" />
          Exportar CSV
        </Button>

        {onExportExcel && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => onExportExcel(selectedRows, visibleColumns)}
          >
            <Download className="h-3.5 w-3.5" />
            Exportar Excel
          </Button>
        )}

        {resolvedActions.map((action, i) => {
          const Icon = action.icon ?? null;
          const disabled =
            typeof action.disabled === "function"
              ? Boolean(action.disabled(selectedRows))
              : Boolean(action.disabled);
          return (
            <Button
              key={i}
              variant={action.variant === "destructive" ? "destructive" : "ghost"}
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => action.onClick(selectedRows)}
              disabled={disabled}
              title={action.title ?? undefined}
            >
              {Icon && <Icon className="h-3.5 w-3.5" />}
              {action.label}
            </Button>
          );
        })}

        <div className="ml-1 h-4 w-px bg-border" />

        <button
          type="button"
          className="ml-1 rounded p-0.5 text-muted-foreground hover:text-foreground"
          onClick={onClear}
          aria-label="Limpiar seleccion"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
