import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Eye, Pencil, Power, PowerOff, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "../components/Alert.jsx";
import { Checkbox } from "../components/Checkbox.jsx";
import { Skeleton } from "../components/Skeleton.jsx";
import { ActionMenu } from "../components/ActionMenu.jsx";
import { EmptyState } from "../components/EmptyState.jsx";
import { ErrorState } from "../components/ErrorState.jsx";
import { getStoredViewMode } from "../components/ViewModeSwitch.jsx";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/Table.jsx";
import { RunlyCardView } from "./RunlyCardView.jsx";
import { RunlyTableToolbar } from "./RunlyTableToolbar.jsx";
import { BulkActionBar } from "./BulkActionBar.jsx";
import { ColumnConfigPanel } from "./ColumnConfigPanel.jsx";
import { ColumnHeaderMenu } from "./ColumnHeaderMenu.jsx";
import { TablePaginationFooter } from "./TablePaginationFooter.jsx";
import { useColumnConfig } from "./useColumnConfig.js";
import {
  normalizeToFilterBarFilters,
  normalizeSpanishLabel,
  stripMarkdown,
} from "./renderer-adapters.js";
import { resolveColorHex } from "./runly-form-utils.js";
import { formatTableDate } from "../lib/utils.js";
import { buildApiHeaders } from "../lib/apiHeaders.js";
import { ImageAssetCell } from "./ImageAssetCell.jsx";

const DEFAULT_PAGE_SIZE = 20;

function inferRowActionKind(label) {
  const normalized = String(label ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) return "unknown";
  if (
    normalized.includes("desactivar") ||
    normalized.includes("eliminar") ||
    normalized.includes("borrar") ||
    normalized.includes("inactivar") ||
    normalized.includes("disable") ||
    normalized.includes("delete") ||
    normalized.includes("remove")
  ) {
    return "delete";
  }
  if (
    normalized.includes("editar") ||
    normalized.includes("modificar") ||
    normalized.includes("actualizar") ||
    normalized.includes("edit") ||
    normalized.includes("update")
  ) {
    return "edit";
  }
  if (
    normalized.includes("ver") ||
    normalized.includes("detalle") ||
    normalized.includes("view") ||
    normalized.includes("detail")
  ) {
    return "view";
  }
  return "unknown";
}

function getRowId(row, index) {
  if (row?.__runlyRowKey != null) return String(row.__runlyRowKey);
  return row?.id != null ? String(row.id) : `row-${index}`;
}

function withUniqueRowKeys(rows) {
  const seen = new Map();
  return rows.map((row, index) => {
    const baseId = row?.id != null ? String(row.id) : `row-${index}`;
    const nextCount = (seen.get(baseId) ?? 0) + 1;
    seen.set(baseId, nextCount);
    if (nextCount === 1) {
      return { ...row, __runlyRowKey: baseId };
    }
    return { ...row, __runlyRowKey: `${baseId}__dup${nextCount - 1}` };
  });
}

function joinUrl(baseUrl, apiPath) {
  const base = String(baseUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  const path = String(apiPath ?? "").trim();
  if (!path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}

function replacePathTokens(pathTemplate, tokenMap) {
  let path = String(pathTemplate ?? "");
  for (const [key, rawValue] of Object.entries(tokenMap ?? {})) {
    const safeValue = encodeURIComponent(String(rawValue ?? "").trim());
    path = path.replace(new RegExp(`:${key}\\b`, "g"), safeValue);
  }
  return path;
}

function hasUnresolvedPathToken(path) {
  return /:[a-zA-Z0-9_.-]+\b/.test(String(path ?? ""));
}

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === "";
}

function getByPath(input, path) {
  if (!path) return undefined;
  return String(path)
    .split(".")
    .filter(Boolean)
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), input);
}

function normalizeColumns(schema) {
  const rawColumns = Array.isArray(schema?.columns) ? schema.columns : [];
  const primaryFieldName =
    schema?.primaryField ?? schema?.recordTitleField ?? null;

  const cols = rawColumns
    .map((entry) => {
      if (typeof entry === "string") {
        return {
          key: entry,
          field: entry,
          label: entry,
          component: null,
          sortable: false,
          isLink: primaryFieldName === entry,
        };
      }
      if (!entry || typeof entry !== "object") return null;
      const field = entry.field ?? entry.key ?? entry.name ?? null;
      if (!field) return null;
      const fieldStr = String(field);
      const isLink =
        Boolean(entry.primary) ||
        Boolean(entry.link) ||
        (primaryFieldName !== null && fieldStr === primaryFieldName);
      return {
        key: fieldStr,
        field: fieldStr,
        label: normalizeSpanishLabel(entry.label ?? entry.title ?? fieldStr),
        component: entry.component ?? null,
        type: entry.type ?? null,
        options: Array.isArray(entry.options) ? entry.options : null,
        hrefTemplate:
          typeof entry.hrefTemplate === "string" && entry.hrefTemplate.trim()
            ? entry.hrefTemplate.trim()
            : null,
        sortable: Boolean(entry.sortable),
        defaultVisible: entry.defaultVisible !== false,
        isLink,
        // type: "image-asset" (ImageAssetCell) options — see its own doc
        // comment for what each does.
        imagesApiPath:
          typeof entry.imagesApiPath === "string" && entry.imagesApiPath.trim()
            ? entry.imagesApiPath.trim()
            : null,
        avatarUserField:
          typeof entry.avatarUserField === "string" && entry.avatarUserField.trim()
            ? entry.avatarUserField.trim()
            : null,
        avatarLabelField:
          typeof entry.avatarLabelField === "string" && entry.avatarLabelField.trim()
            ? entry.avatarLabelField.trim()
            : null,
      };
    })
    .filter(Boolean);

  if (cols.length > 0 && !cols.some((c) => c.isLink)) {
    cols[0] = { ...cols[0], isLink: true };
  }

  return cols;
}

function normalizeFilters(schema) {
  const rawFilters = schema?.filters;
  if (Array.isArray(rawFilters)) {
    return rawFilters
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const key = entry.field ?? entry.key ?? entry.name ?? null;
        if (!key) return null;
        return {
          key: String(key),
          label: normalizeSpanishLabel(
            entry.label ?? entry.title ?? String(key),
          ),
          type: entry.type === "select" ? "select" : "text",
          options: Array.isArray(entry.options) ? entry.options : [],
        };
      })
      .filter(Boolean);
  }
  if (rawFilters && typeof rawFilters === "object") {
    return Object.entries(rawFilters)
      .map(([key, value]) => {
        if (value && typeof value === "object") {
          return {
            key,
            label: value.label ?? value.title ?? key,
            type: value.type === "select" ? "select" : "text",
            options: Array.isArray(value.options) ? value.options : [],
          };
        }
        return { key, label: key, type: "text", options: [] };
      })
      .filter(Boolean);
  }
  return [];
}

function readPagination(payload, fallbackPage, fallbackPageSize, dataLength) {
  const pagination = payload?.pagination ?? {};
  const page = Number.isFinite(Number(pagination.page))
    ? Number(pagination.page)
    : fallbackPage;
  const pageSize = Number.isFinite(Number(pagination.pageSize))
    ? Number(pagination.pageSize)
    : fallbackPageSize;
  const total = Number.isFinite(Number(pagination.total))
    ? Number(pagination.total)
    : dataLength;
  return {
    page: Math.max(1, page),
    pageSize: Math.max(1, pageSize),
    total: Math.max(0, total),
  };
}

const STATUS_LABELS = {
  active: "Activo",
  inactive: "Inactivo",
  maintenance: "En mantenimiento",
  retired: "Retirado",
  pending: "Pendiente",
  disabled: "Desactivado",
  draft: "Borrador",
  finalized: "Finalizado",
};


function formatTableCurrency(value, currencyCode = "MXN") {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return "—";
  const code = currencyCode && /^[A-Z]{3}$/.test(String(currencyCode).toUpperCase())
    ? String(currencyCode).toUpperCase()
    : "MXN";
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: code,
  }).format(amount);
}

function renderValue(value) {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  const str = String(value);
  return STATUS_LABELS[str.toLowerCase()] ?? str;
}

function ColorCell({ value }) {
  if (!value || value === "—")
    return <span className="text-muted-foreground">—</span>;
  const hex = resolveColorHex(value);
  const displayName = value.startsWith("#") ? value : value;
  return (
    <span className="flex items-center gap-1.5">
      {hex && (
        <span
          className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border border-border shadow-sm"
          style={{ backgroundColor: hex }}
        />
      )}
      <span>{displayName}</span>
    </span>
  );
}

export function RunlyTable({
  blueprint,
  token,
  companyId = null,
  apiBaseUrl,
  componentRegistry = null,
  accentColor = null,
  onCreate,
  onView,
  onEdit,
  onDelete,
  onToggleEnabled = null,
  canDeleteRow = null,
  refreshSignal = 0,
  bulkActions = [],
  onExportExcel = null,
  onContextChange = null,
}) {
  const schema = blueprint?.schema ?? {};
  const apiPath =
    typeof schema.apiPath === "string" ? schema.apiPath.trim() : "";
  const tableKey = blueprint?.key ?? apiPath;
  const blueprintColumns = useMemo(() => normalizeColumns(schema), [schema]);
  const filters = useMemo(() => normalizeFilters(schema), [schema]);
  const filterBarFilters = useMemo(
    () => normalizeToFilterBarFilters(filters),
    [filters],
  );
  const searchable = schema.searchable !== false && blueprintColumns.length > 0;
  const defaultPageSize = Number.isFinite(
    Number(schema?.pagination?.defaultPageSize),
  )
    ? Math.max(1, Number(schema.pagination.defaultPageSize))
    : DEFAULT_PAGE_SIZE;

  const colConfig = useColumnConfig({
    columns: blueprintColumns,
    savedPreference: null,
    defaultPageSize,
  });
  const {
    allColumns,
    visibleColumns,
    hiddenCount,
    reorderColumns,
    moveColumn,
    toggleColumn,
    pageSize,
    setPageSize,
    resetToDefaults,
    setFromConfig,
    toConfig,
  } = colConfig;

  // Async callbacks read the latest committed configuration.
  const toConfigRef = useRef(toConfig);
  useLayoutEffect(() => { toConfigRef.current = toConfig; }, [toConfig]);

  const sortableColumns = useMemo(
    () => visibleColumns.filter((c) => c.sortable),
    [visibleColumns],
  );

  const [columnPanelOpen, setColumnPanelOpen] = useState(false);

  // ── Preference load ────────────────────────────────────────────────────────
  const preferenceScopeRef = useRef("");
  const preferenceScope = `${apiBaseUrl ?? ""}::${token ?? ""}::${tableKey ?? ""}`;
  useEffect(() => {
    if (!tableKey || !token || !apiBaseUrl) return;
    if (preferenceScopeRef.current === preferenceScope) return;
    preferenceScopeRef.current = preferenceScope;
    let cancelled = false;
    const prefUrl = `${apiBaseUrl.replace(/\/+$/, "")}/profile/me/table-preferences/${encodeURIComponent(tableKey)}`;
    fetch(prefUrl, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        if (json?.data) {
          setFromConfig(json.data);
          return;
        }
        resetToDefaults();
      })
      .catch(() => {
        if (cancelled) return;
        resetToDefaults();
      });
    return () => {
      cancelled = true;
    };
  }, [
    apiBaseUrl,
    tableKey,
    token,
    setFromConfig,
    resetToDefaults,
    preferenceScope,
  ]);

  // ── Preference save (debounced 800ms) ─────────────────────────────────────
  const saveTimerRef = useRef(null);
  const pendingSaveRef = useRef(false);

  const schedulePreferenceSave = useCallback(() => {
    if (!tableKey || !token || !apiBaseUrl) return;
    if (preferenceScopeRef.current !== preferenceScope) return;
    pendingSaveRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (!pendingSaveRef.current) return;
      pendingSaveRef.current = false;
      const config = toConfigRef.current();
      const prefUrl = `${apiBaseUrl.replace(/\/+$/, "")}/profile/me/table-preferences/${encodeURIComponent(tableKey)}`;
      fetch(prefUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(config),
      }).catch(() => {});
    }, 800);
  }, [apiBaseUrl, tableKey, token, preferenceScope]);

  const handleReorderColumns = useCallback(
    (activeKey, overKey) => {
      reorderColumns(activeKey, overKey);
      schedulePreferenceSave();
    },
    [reorderColumns, schedulePreferenceSave],
  );

  const handleToggleColumn = useCallback(
    (key) => {
      toggleColumn(key);
      schedulePreferenceSave();
    },
    [toggleColumn, schedulePreferenceSave],
  );

  const handleResetToDefaults = useCallback(async () => {
    resetToDefaults();
    if (tableKey && token && apiBaseUrl) {
      const prefUrl = `${apiBaseUrl.replace(/\/+$/, "")}/profile/me/table-preferences/${encodeURIComponent(tableKey)}`;
      fetch(prefUrl, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  }, [resetToDefaults, apiBaseUrl, tableKey, token]);

  const handlePageSizeChange = useCallback(
    (size) => {
      setPageSize(size);
      setPage(1);
      schedulePreferenceSave();
    },
    [setPageSize, schedulePreferenceSave],
  );

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filterValues, setFilterValues] = useState({});
  const [sortBy, setSortBy] = useState("");
  const [sortDir, setSortDir] = useState("asc");
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({
    page: 1,
    pageSize: defaultPageSize,
    total: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reloadTick, setReloadTick] = useState(0);
  const storageKey = `runly.renderer.${apiPath.replace(/\//g, ".")}`;
  const [view, setView] = useState(() =>
    getStoredViewMode(storageKey, schema.defaultViewMode ?? "table"),
  );
  const [selectedIds, setSelectedIds] = useState(new Set());

  const selectedRows = useMemo(
    () => rows.filter((row, i) => selectedIds.has(getRowId(row, i))),
    [rows, selectedIds],
  );

  useEffect(() => {
    onContextChange?.({ selectedIds: [...selectedIds], search, filters: filterValues, total: pagination.total });
  }, [onContextChange, selectedIds, search, filterValues, pagination.total]);

  useEffect(() => {
    if (!apiPath) return;
    const controller = new AbortController();
    const run = async () => {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("pageSize", String(pageSize));
        if (searchable && !isBlank(search))
          params.set("search", String(search).trim());
        for (const [key, value] of Object.entries(filterValues)) {
          if (isBlank(value)) continue;
          params.set(key, String(value).trim());
        }
        if (sortBy) {
          params.set("sortBy", sortBy);
          params.set("sortDir", sortDir);
        }
        const endpoint = `${joinUrl(apiBaseUrl, apiPath)}?${params.toString()}`;
        const response = await fetch(endpoint, {
          method: "GET",
          headers: buildApiHeaders(token, companyId),
          signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(body || "No se pudo cargar la información.");
        }
        const payload = await response.json();
        const nextRowsRaw = Array.isArray(payload?.data) ? payload.data : [];
        const nextRows = withUniqueRowKeys(nextRowsRaw);
        const nextPagination = readPagination(
          payload,
          page,
          pageSize,
          nextRows.length,
        );
        setRows(nextRows);
        setPagination(nextPagination);
      } catch (err) {
        if (controller.signal.aborted) return;
        setRows([]);
        setPagination((prev) => ({ ...prev, total: 0 }));
        setError(
          err instanceof Error
            ? err.message
            : "No se pudo cargar la información.",
        );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    run();
    return () => controller.abort();
  }, [
    apiBaseUrl,
    apiPath,
    filterValues,
    page,
    pageSize,
    reloadTick,
    refreshSignal,
    search,
    searchable,
    sortBy,
    sortDir,
    token,
    companyId,
  ]);

  useEffect(() => {
    setSelectedIds(new Set());
  }, [rows]);

  const filtersActiveCount = Object.values(filterValues).filter(Boolean).length;

  if (!apiPath) {
    return (
      <Alert variant="warning">
        <AlertTitle>Vista sin configuración</AlertTitle>
        <AlertDescription>
          Esta vista no tiene <code>schema.apiPath</code>. No se puede cargar la
          información.
        </AlertDescription>
      </Alert>
    );
  }

  const rowActions = Array.isArray(schema.rowActions) ? schema.rowActions : [];

  const viewActionLabel =
    rowActions.find((a) => inferRowActionKind(a?.label) === "view")?.label ??
    "Ver detalle";
  const editActionLabel =
    rowActions.find((a) => inferRowActionKind(a?.label) === "edit")?.label ??
    "Editar";
  const deleteActionLabel =
    rowActions.find((a) => inferRowActionKind(a?.label) === "delete")?.label ??
    "Eliminar";

  const rowMenuItems = (row) => {
    if (rowActions.length === 0) {
      return [
        onView && {
          label: "Ver",
          icon: Eye,
          onClick: () => onView(row),
        },
        onEdit && {
          label: "Editar",
          icon: Pencil,
          onClick: () => onEdit(row),
        },
        onToggleEnabled && {
          label: row.enabled ? "Desactivar" : "Activar",
          icon: row.enabled ? PowerOff : Power,
          onClick: () => onToggleEnabled(row),
        },
        onDelete && {
          label: "Eliminar",
          icon: Trash2,
          variant: "destructive",
          onClick: () => onDelete(row),
        },
      ].filter(Boolean);
    }

    const deleteAllowed =
      onDelete &&
      (typeof canDeleteRow === "function" ? canDeleteRow(row) : true);
    const fallbackQueue = [
      onView ? { kind: "view", icon: Eye, run: () => onView(row) } : null,
      onEdit ? { kind: "edit", icon: Pencil, run: () => onEdit(row) } : null,
      deleteAllowed
        ? {
            kind: "delete",
            icon: Trash2,
            variant: "destructive",
            run: () => onDelete(row),
          }
        : null,
    ].filter(Boolean);
    const usedKinds = new Set();

    return rowActions
      .map((action) => {
        const label = normalizeSpanishLabel(action?.label ?? "");
        const kind = inferRowActionKind(label);
        let chosen = null;

        if (kind === "view" && onView)
          chosen = fallbackQueue.find((item) => item.kind === "view");
        else if (kind === "edit" && onEdit)
          chosen = fallbackQueue.find((item) => item.kind === "edit");
        else if (kind === "delete" && onDelete)
          chosen = fallbackQueue.find((item) => item.kind === "delete");

        if (!chosen) {
          chosen =
            fallbackQueue.find((item) => !usedKinds.has(item.kind)) ?? null;
        }
        if (!chosen) return null;

        usedKinds.add(chosen.kind);
        return {
          label: label || "Accion",
          icon: chosen.icon,
          variant: chosen.variant,
          onClick: chosen.run,
        };
      })
      .filter(Boolean);
  };

  const handleSortChange = ({ sortBy: nextField, sortDir: nextDir }) => {
    setPage(1);
    setSortBy(nextField);
    setSortDir(nextDir);
  };

  const handleToggleRow = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleToggleAll = () => {
    if (selectedIds.size === rows.length && rows.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(rows.map((row, i) => getRowId(row, i))));
    }
  };

  // ── Table view ────────────────────────────────────────────────────────────

  const renderTableView = () => {
    const allSelected = rows.length > 0 && selectedIds.size === rows.length;
    const someSelected = selectedIds.size > 0 && selectedIds.size < rows.length;

    if (loading) {
      return (
        <div className="rounded-2xl glass-shell overflow-clip">
          <Table>
            <TableHeader>
              <TableRow className="bg-[hsl(var(--muted))]/40 hover:bg-[hsl(var(--muted))]/40">
                <TableHead className="w-10" />
                {visibleColumns.map((col) => (
                  <TableHead key={col.key}>{col.label}</TableHead>
                ))}
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 7 }).map((_, i) => (
                <TableRow key={`sk-${i}`}>
                  <TableCell>
                    <Skeleton className="h-4 w-4 rounded" />
                  </TableCell>
                  {visibleColumns.map((col) => (
                    <TableCell key={`sk-${col.key}-${i}`}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                  <TableCell>
                    <Skeleton className="h-7 w-7 rounded-md" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      );
    }

    if (error) {
      return (
        <ErrorState
          description={error}
          onRetry={() => setReloadTick((c) => c + 1)}
        />
      );
    }

    if (rows.length === 0) {
      return (
        <EmptyState
          title="Sin registros"
          description={normalizeSpanishLabel(
            schema?.emptyState?.message ?? "No hay registros para mostrar.",
          )}
          action={
            onCreate ? { label: "Agregar", onClick: onCreate } : undefined
          }
        />
      );
    }

    return (
      <div className="rounded-2xl glass-shell overflow-clip">
        <Table>
          <TableHeader>
            <TableRow className="bg-[hsl(var(--muted))]/40 hover:bg-[hsl(var(--muted))]/40">
              <TableHead className="w-10">
                <Checkbox
                  checked={
                    allSelected ? true : someSelected ? "indeterminate" : false
                  }
                  onCheckedChange={handleToggleAll}
                  aria-label="Seleccionar todos"
                />
              </TableHead>
              {visibleColumns.map((col, colIdx) => (
                <TableHead key={col.key}>
                  <ColumnHeaderMenu
                    column={col}
                    canMoveLeft={!col.pinned && colIdx > 0}
                    canMoveRight={
                      !col.pinned && colIdx < visibleColumns.length - 1
                    }
                    onHide={handleToggleColumn}
                    onMoveLeft={(key) => {
                      moveColumn(key, "left");
                      schedulePreferenceSave();
                    }}
                    onMoveRight={(key) => {
                      moveColumn(key, "right");
                      schedulePreferenceSave();
                    }}
                  >
                    {col.label}
                  </ColumnHeaderMenu>
                </TableHead>
              ))}
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row, rowIndex) => {
              const id = getRowId(row, rowIndex);
              const isSelected = selectedIds.has(id);
              const zebraClass =
                !isSelected && rowIndex % 2 === 1
                  ? "bg-[hsl(var(--muted))]/20"
                  : undefined;
              return (
                <TableRow
                  key={id}
                  data-selected={isSelected || undefined}
                  className={zebraClass}
                >
                  <TableCell>
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => handleToggleRow(id)}
                      aria-label="Seleccionar fila"
                    />
                  </TableCell>
                  {visibleColumns.map((col) => {
                    const value = getByPath(row, col.field);
                    const colHref = col.hrefTemplate
                      ? replacePathTokens(col.hrefTemplate, row)
                      : null;
                    const hasColumnHref =
                      Boolean(colHref) && !hasUnresolvedPathToken(colHref);
                    let cellContent;
                    if (col.component && componentRegistry) {
                      const Comp = componentRegistry.resolve(col.component);
                      cellContent = Comp ? (
                        <Comp
                          {...{
                            [col.field]: value,
                            value,
                            row,
                            token,
                            apiBaseUrl,
                          }}
                        />
                      ) : (
                        renderValue(value)
                      );
                    } else if (col.type === "color") {
                      cellContent = <ColorCell value={value} />;
                    } else if (hasColumnHref && !col.component) {
                      cellContent = (
                        <a
                          href={colHref}
                          className="text-left font-medium hover:underline focus:outline-none focus-visible:underline"
                        >
                          {renderValue(value)}
                        </a>
                      );
                    } else if (col.isLink && onView && !col.component) {
                      cellContent = (
                        <button
                          type="button"
                          onClick={() => onView(row)}
                          className="text-left font-medium hover:underline focus:outline-none focus-visible:underline"
                        >
                          {renderValue(value)}
                        </button>
                      );
                    } else if (col.type === "select" && col.options) {
                      const str = String(value ?? "");
                      const opt = col.options.find(
                        (o) => String(o.value) === str,
                      );
                      cellContent = opt?.label ?? renderValue(value);
                    } else if (col.type === "image") {
                      cellContent = value ? (
                        <img
                          src={value}
                          alt=""
                          className="h-8 w-8 rounded-lg object-cover"
                        />
                      ) : (
                        <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>
                      );
                    } else if (col.type === "image-asset") {
                      cellContent = (
                        <ImageAssetCell
                          value={value}
                          row={row}
                          token={token}
                          apiBaseUrl={apiBaseUrl}
                          companyId={companyId}
                          column={col}
                        />
                      );
                    } else if (col.type === "markdown") {
                      cellContent = stripMarkdown(value);
                    } else if (col.type === "date") {
                      cellContent = formatTableDate(value, false);
                    } else if (col.type === "datetime") {
                      cellContent = formatTableDate(value, true);
                    } else if (
                      col.type === "currency" ||
                      col.type === "decimal"
                    ) {
                      cellContent = formatTableCurrency(value, row.currency);
                    } else {
                      cellContent = renderValue(value);
                    }
                    const truncateCell = !col.component && col.type !== "color" && col.type !== "image" && col.type !== "image-asset";
                    return (
                      <TableCell
                        key={`${col.key}-${rowIndex}`}
                        className={truncateCell ? "max-w-50" : undefined}
                      >
                        {truncateCell ? (
                          <div
                            className="truncate"
                            title={
                              typeof cellContent === "string"
                                ? cellContent
                                : undefined
                            }
                          >
                            {cellContent}
                          </div>
                        ) : (
                          cellContent
                        )}
                      </TableCell>
                    );
                  })}
                  <TableCell>
                    <ActionMenu
                      items={rowMenuItems(row)}
                      label="Acciones del registro"
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    );
  };

  // ── List view (stacked rows) ───────────────────────────────────────────────

  const renderListView = () => {
    const primaryCol = visibleColumns[0] ?? null;
    const statusCol =
      visibleColumns.find((c) => /^(status|estado)$/i.test(c.field)) ?? null;
    const colorCol = visibleColumns.find((c) => c.type === "color") ?? null;
    const imageCol = visibleColumns.find((c) => c.type === "image") ?? null;
    const detailCols = visibleColumns.filter(
      (c) => c !== primaryCol && c !== statusCol && c !== colorCol && c !== imageCol,
    );

    if (loading) {
      return (
        <div className="rounded-2xl glass-shell overflow-clip">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={`sk-list-${i}`}
              className="flex items-center gap-3 px-4 py-4 border-b border-[hsl(var(--border))] last:border-0"
            >
              <Skeleton className="h-4 w-4 rounded shrink-0" />
              <Skeleton className="h-9 w-9 rounded-xl shrink-0" />
              <div className="shrink-0 w-36 space-y-1.5">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <div className="hidden sm:grid sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-6 gap-y-2 flex-1">
                {Array.from({ length: 5 }).map((__, j) => (
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

    if (error) {
      return (
        <ErrorState
          description={error}
          onRetry={() => setReloadTick((c) => c + 1)}
        />
      );
    }

    if (rows.length === 0) {
      return (
        <EmptyState
          title="Sin registros"
          description={normalizeSpanishLabel(
            schema?.emptyState?.message ?? "No hay registros para mostrar.",
          )}
          action={
            onCreate ? { label: "Agregar", onClick: onCreate } : undefined
          }
        />
      );
    }

    return (
      <div className="rounded-2xl glass-shell overflow-clip">
        {rows.map((row, rowIndex) => {
          const id = getRowId(row, rowIndex);
          const isSelected = selectedIds.has(id);
          const titleVal = primaryCol
            ? renderValue(getByPath(row, primaryCol.field))
            : `Registro ${rowIndex + 1}`;
          const initials =
            titleVal !== "—" && titleVal.length > 0
              ? titleVal.charAt(0).toUpperCase()
              : "#";
          const menuItems = rowMenuItems(row);
          const itemColorHex = colorCol
            ? resolveColorHex(getByPath(row, colorCol.field)) || null
            : null;
          const avatarBg = itemColorHex
            ? `${itemColorHex}33`
            : accentColor
              ? `${accentColor}26`
              : "hsl(var(--muted))";
          const avatarText =
            itemColorHex ?? accentColor ?? "hsl(var(--muted-foreground))";
          const rowImageUrl = imageCol ? (getByPath(row, imageCol.field) || null) : null;
          const statusVal = statusCol
            ? (() => {
                const v = getByPath(row, statusCol.field);
                if (statusCol.type === "select" && statusCol.options) {
                  const opt = statusCol.options.find(
                    (o) => String(o.value) === String(v ?? ""),
                  );
                  return opt?.label ?? renderValue(v);
                }
                return renderValue(v);
              })()
            : null;

          return (
            <div
              key={id}
              className={`flex items-center gap-3 px-4 py-3.5 border-b border-[hsl(var(--border))] last:border-0 hover:bg-[hsl(var(--muted))]/30 transition-colors${isSelected ? " bg-indigo-500/5" : ""}`}
            >
              <Checkbox
                checked={isSelected}
                onCheckedChange={() => handleToggleRow(id)}
                aria-label="Seleccionar"
                className="shrink-0"
              />
              {rowImageUrl ? (
                <img
                  src={rowImageUrl}
                  alt={titleVal}
                  className="h-9 w-9 rounded-xl shrink-0 object-cover"
                />
              ) : (
                <div
                  className="h-9 w-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: avatarBg }}
                >
                  <span
                    className="text-sm font-semibold"
                    style={{ color: avatarText }}
                  >
                    {initials}
                  </span>
                </div>
              )}

              {/* Title + status — fixed width column */}
              <div className="shrink-0 w-36 min-w-0">
                <button
                  type="button"
                  onClick={onView ? () => onView(row) : undefined}
                  className="truncate text-sm font-semibold text-[hsl(var(--foreground))] hover:underline focus:outline-none focus-visible:underline text-left w-full"
                >
                  {titleVal}
                </button>
                {statusVal && statusVal !== "—" && (
                  <span className="mt-1 inline-block text-xs font-medium text-[hsl(var(--foreground))] bg-[hsl(var(--muted))] rounded-full px-2.5 py-0.5">
                    {statusVal}
                  </span>
                )}
              </div>

              {/* Detail columns grid — fills remaining space */}
              {detailCols.length > 0 && (
                <div className="hidden sm:grid sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-6 gap-y-1.5 flex-1 min-w-0">
                  {detailCols.map((col) => {
                    const rawVal = getByPath(row, col.field);
                    let formatted;
                    if (col.type === "date") {
                      formatted = formatTableDate(rawVal, false);
                    } else if (col.type === "datetime") {
                      formatted = formatTableDate(rawVal, true);
                    } else if (col.type === "currency" || col.type === "decimal") {
                      formatted = formatTableCurrency(rawVal, row.currency);
                    } else if (col.type === "select" && col.options) {
                      const opt = col.options.find(
                        (o) => String(o.value) === String(rawVal ?? ""),
                      );
                      formatted = opt?.label ?? renderValue(rawVal);
                    } else if (col.type === "markdown") {
                      formatted = stripMarkdown(rawVal);
                    } else {
                      formatted = renderValue(rawVal);
                    }
                    if (formatted === "—") return null;
                    return (
                      <div key={col.key} className="min-w-0">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-[hsl(var(--muted-foreground))]/70 truncate">
                          {col.label}
                        </p>
                        <p className="text-xs text-[hsl(var(--foreground))] truncate">
                          {formatted}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}

              {menuItems.length > 0 && (
                <ActionMenu items={menuItems} label="Acciones del registro" />
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ── Card grid view ────────────────────────────────────────────────────────

  const renderCardGridView = () => {
    if (loading) {
      return (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={`sk-card-${i}`}
              className="rounded-2xl border border-[hsl(var(--border))] p-4 space-y-3"
            >
              <div className="flex items-start gap-3">
                <Skeleton className="h-9 w-9 rounded-xl shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
              <div className="border-t border-[hsl(var(--border))]/50 pt-2.5 space-y-1.5">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (error) {
      return (
        <ErrorState
          description={error}
          onRetry={() => setReloadTick((c) => c + 1)}
        />
      );
    }

    if (rows.length === 0) {
      return (
        <EmptyState
          title="Sin registros"
          description={normalizeSpanishLabel(
            schema?.emptyState?.message ?? "No hay registros para mostrar.",
          )}
          action={
            onCreate ? { label: "Agregar", onClick: onCreate } : undefined
          }
        />
      );
    }

    const cardColorCol = visibleColumns.find((c) => c.type === "color") ?? null;
    const resolveItemColor = cardColorCol
      ? (row) => resolveColorHex(getByPath(row, cardColorCol.field)) || null
      : null;

    return (
      <RunlyCardView
        columns={visibleColumns}
        rows={rows}
        selectedIds={selectedIds}
        onToggleSelect={handleToggleRow}
        getRowId={getRowId}
        viewActionLabel={viewActionLabel}
        editActionLabel={editActionLabel}
        deleteActionLabel={deleteActionLabel}
        accentColor={accentColor}
        resolveItemColor={resolveItemColor}
        onView={onView}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    );
  };

  return (
    <>
      <div className="flex flex-col gap-4">
        <RunlyTableToolbar
          storageKey={storageKey}
          search={searchable ? search : ""}
          onSearchChange={
            searchable
              ? (val) => {
                  setPage(1);
                  setSearch(val);
                }
              : undefined
          }
          searchPlaceholder={schema?.searchPlaceholder ?? "Buscar..."}
          filterBarFilters={filterBarFilters}
          filterValues={filterValues}
          onFilterChange={(next) => {
            setPage(1);
            setFilterValues(next);
          }}
          filtersActiveCount={filtersActiveCount}
          onFiltersClear={() => {
            setPage(1);
            setFilterValues({});
          }}
          sortableColumns={sortableColumns}
          sortBy={sortBy}
          sortDir={sortDir}
          onSortChange={handleSortChange}
          views={["table", "cards", "grid"]}
          view={view}
          onViewChange={setView}
          selectedCount={selectedIds.size}
          onClearSelection={() => setSelectedIds(new Set())}
          totalCount={pagination.total}
          loading={loading}
          onReload={() => setReloadTick((c) => c + 1)}
          hiddenColumnCount={hiddenCount}
          onOpenColumnConfig={() => setColumnPanelOpen(true)}
        />
        {view === "cards"
          ? renderListView()
          : view === "grid"
            ? renderCardGridView()
            : renderTableView()}
        <TablePaginationFooter
          page={page}
          pageSize={pageSize}
          total={pagination.total}
          onPageChange={setPage}
          onPageSizeChange={handlePageSizeChange}
        />
      </div>

      <ColumnConfigPanel
        open={columnPanelOpen}
        onOpenChange={setColumnPanelOpen}
        allColumns={allColumns}
        columnVisibility={colConfig.columnVisibility}
        onReorder={handleReorderColumns}
        onToggle={handleToggleColumn}
        onReset={handleResetToDefaults}
      />

      <BulkActionBar
        selectedCount={selectedIds.size}
        selectedRows={selectedRows}
        visibleColumns={visibleColumns}
        onClear={() => setSelectedIds(new Set())}
        bulkActions={bulkActions}
        onExportExcel={onExportExcel}
      />
    </>
  );
}
