import { useRuntimeFetch, useRuntimeAdapters } from '../lib/module-runtime/RuntimeAdapters.jsx';
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
import { RunlyListSkeleton, RunlyListView } from "./RunlyListView.jsx";
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
import { accentFor } from "./records-view-format.js";

// Select value as a tinted pill: stable color per option (or option.color).
function SelectBadge({ label, color }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ color, backgroundColor: `${color}1f` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      {String(label)}
    </span>
  );
}
import { formatTableDate } from "../lib/utils.js";
import { buildApiHeaders } from "../lib/apiHeaders.js";
import { ImageAssetCell } from "./ImageAssetCell.jsx";
import { UserAvatarCell } from "./UserAvatarCell.jsx";
import {
  ColorCell,
  DEFAULT_PAGE_SIZE,
  getByPath,
  getRowId,
  hasUnresolvedPathToken,
  inferRowActionKind,
  isBlank,
  joinUrl,
  normalizeColumns,
  normalizeFilters,
  readPagination,
  renderValue,
  formatTableCurrency,
  replacePathTokens,
  withUniqueRowKeys,
} from "./runly-table-helpers.jsx";

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
  // Row menu text for onDelete; screens whose delete only deactivates pass "Desactivar".
  deleteLabel = "Eliminar",
  onToggleEnabled = null,
  canDeleteRow = null,
  refreshSignal = 0,
  bulkActions = [],
  onExportExcel = null,
  onContextChange = null,
  // Filter values to start with, e.g. from a deep link (?categoryId=...).
  initialFilters = null,
}) {
  const runtimeFetch = useRuntimeFetch();
  const adapters = useRuntimeAdapters();
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
  const preferenceScope = `${apiBaseUrl ?? ""}::${companyId ?? ""}::${token ?? ""}::${tableKey ?? ""}`;
  useEffect(() => {
    if (!tableKey || (!token && !adapters) || !apiBaseUrl) return;
    if (preferenceScopeRef.current === preferenceScope) return;
    preferenceScopeRef.current = preferenceScope;
    let cancelled = false;
    const prefUrl = `${apiBaseUrl.replace(/\/+$/, "")}/profile/me/table-preferences/${encodeURIComponent(tableKey)}`;
    runtimeFetch(prefUrl, { headers: buildApiHeaders(token, companyId) })
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
    companyId,
  ]);

  // ── Preference save (debounced 800ms) ─────────────────────────────────────
  const saveTimerRef = useRef(null);
  const pendingSaveRef = useRef(false);

  const schedulePreferenceSave = useCallback(() => {
    if (!tableKey || (!token && !adapters) || !apiBaseUrl) return;
    if (preferenceScopeRef.current !== preferenceScope) return;
    pendingSaveRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (!pendingSaveRef.current) return;
      pendingSaveRef.current = false;
      const config = toConfigRef.current();
      const prefUrl = `${apiBaseUrl.replace(/\/+$/, "")}/profile/me/table-preferences/${encodeURIComponent(tableKey)}`;
      runtimeFetch(prefUrl, {
        method: "PUT",
        headers: buildApiHeaders(token, companyId, { "Content-Type": "application/json" }),
        body: JSON.stringify(config),
      }).catch(() => {});
    }, 800);
  }, [runtimeFetch, apiBaseUrl, tableKey, token, preferenceScope, companyId]);

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
    if (tableKey && (token || adapters) && apiBaseUrl) {
      const prefUrl = `${apiBaseUrl.replace(/\/+$/, "")}/profile/me/table-preferences/${encodeURIComponent(tableKey)}`;
      runtimeFetch(prefUrl, {
        method: "DELETE",
        headers: buildApiHeaders(token, companyId),
      }).catch(() => {});
    }
  }, [resetToDefaults, apiBaseUrl, tableKey, token, companyId]);

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
  const [filterValues, setFilterValues] = useState(() => initialFilters ?? {});
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
        const response = await runtimeFetch(endpoint, {
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
    runtimeFetch,
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
          label: deleteLabel,
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
      onToggleEnabled
        ? {
            kind: "toggle",
            icon: row.enabled ? PowerOff : Power,
            run: () => onToggleEnabled(row),
          }
        : null,
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
        else if (kind === "toggle" && onToggleEnabled)
          chosen = fallbackQueue.find((item) => item.kind === "toggle");
        else if (kind === "delete" && onDelete)
          chosen = fallbackQueue.find((item) => item.kind === "delete");

        if (!chosen) {
          chosen =
            fallbackQueue.find((item) => !usedKinds.has(item.kind)) ?? null;
        }
        if (!chosen) return null;

        usedKinds.add(chosen.kind);
        return {
          label:
            chosen.kind === "toggle"
              ? (row.enabled ? "Desactivar" : "Activar")
              : chosen.kind === "delete" && deleteLabel !== "Eliminar"
                ? deleteLabel
                : (label || "Accion"),
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

  // Error / empty placeholder shared by every view (null when there are rows).
  const renderStatusView = () => {
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
    return null;
  };

  // ── Table view ────────────────────────────────────────────────────────────

  const renderTableView = () => {
    const allSelected = rows.length > 0 && selectedIds.size === rows.length;
    const someSelected = selectedIds.size > 0 && selectedIds.size < rows.length;

    if (loading) {
      return (
        <div className="rounded-2xl glass-shell-flat overflow-clip">
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

    const statusView = renderStatusView();
    if (statusView) return statusView;

    return (
      <div className="rounded-2xl glass-shell-flat overflow-clip">
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
                    sortDir={sortBy === col.field ? sortDir : null}
                    onSort={(field, dir) => handleSortChange({ sortBy: field, sortDir: dir })}
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
                        (o) => String(o?.value ?? o) === str,
                      );
                      cellContent = str ? (
                        <SelectBadge label={opt?.label ?? opt ?? str} color={resolveColorHex(opt?.color) ?? accentFor(col, value)} />
                      ) : renderValue(value);
                    } else if (col.type === "image" && (col.avatarUserField || col.avatarSignedUrlPath || col.avatarLabelField)) {
                      cellContent = (
                        <UserAvatarCell
                          value={value}
                          row={row}
                          column={col}
                          token={token}
                          apiBaseUrl={apiBaseUrl}
                          companyId={companyId}
                        />
                      );
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

  // ── List view (stacked rows) — RunlyListView.jsx ─────────────────────────

  const renderListView = () => {
    if (loading) return <RunlyListSkeleton />;
    return renderStatusView() ?? (
      <RunlyListView
        columns={visibleColumns}
        rows={rows}
        subtitleField={schema.subtitleField ?? null}
        statusField={schema.statusField ?? null}
        selectedIds={selectedIds}
        onToggleSelect={handleToggleRow}
        getRowId={getRowId}
        rowMenuItems={rowMenuItems}
        onView={onView}
        accentColor={accentColor}
        token={token}
        apiBaseUrl={apiBaseUrl}
        companyId={companyId}
      />
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

    const statusView = renderStatusView();
    if (statusView) return statusView;

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
        rowMenuItems={rowMenuItems}
        subtitleField={schema.subtitleField ?? null}
        statusField={schema.statusField ?? null}
        cardMedia={schema.cardMedia ?? null}
        accentColor={accentColor}
        resolveItemColor={resolveItemColor}
        onView={onView}
        token={token}
        apiBaseUrl={apiBaseUrl}
        companyId={companyId}
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
          showSortMenu={view !== "table"}
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
