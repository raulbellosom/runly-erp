import { useCallback, useMemo, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";

export const DEFAULT_PAGE_SIZE = 20;

export function useColumnConfig({ columns, savedPreference, defaultPageSize = DEFAULT_PAGE_SIZE }) {
  const [columnOrder, setColumnOrder] = useState(() =>
    buildInitialOrder(columns, savedPreference),
  );

  const [columnVisibility, setColumnVisibility] = useState(() =>
    buildInitialVisibility(columns, savedPreference),
  );

  const [pageSize, setPageSizeState] = useState(
    () => savedPreference?.pageSize ?? defaultPageSize,
  );

  const columnMap = useMemo(
    () => Object.fromEntries(columns.map((c) => [c.key, c])),
    [columns],
  );

  const allColumns = useMemo(() => {
    const pinned = columnOrder.filter((k) => columnMap[k]?.pinned);
    const rest = columnOrder.filter((k) => !columnMap[k]?.pinned);
    return [...pinned, ...rest].map((k) => columnMap[k]).filter(Boolean);
  }, [columnOrder, columnMap]);

  const visibleColumns = useMemo(
    () => allColumns.filter((c) => columnVisibility[c.key] !== false),
    [allColumns, columnVisibility],
  );

  const hiddenCount = useMemo(
    () => Object.values(columnVisibility).filter((v) => v === false).length,
    [columnVisibility],
  );

  const reorderColumns = useCallback((activeKey, overKey) => {
    setColumnOrder((prev) => {
      const from = prev.indexOf(activeKey);
      const to = prev.indexOf(overKey);
      if (from === -1 || to === -1 || from === to) return prev;
      return arrayMove(prev, from, to);
    });
  }, []);

  const moveColumn = useCallback((key, direction) => {
    setColumnOrder((prev) => {
      const idx = prev.indexOf(key);
      if (idx === -1) return prev;
      const target = direction === "left" ? idx - 1 : idx + 1;
      if (target < 0 || target >= prev.length) return prev;
      return arrayMove(prev, idx, target);
    });
  }, []);

  const toggleColumn = useCallback((key) => {
    setColumnVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const setPageSize = useCallback((size) => {
    setPageSizeState(size);
  }, []);

  const resetToDefaults = useCallback(() => {
    setColumnOrder(columns.map((c) => c.key));
    setColumnVisibility(
      Object.fromEntries(columns.map((c) => [c.key, c.defaultVisible !== false])),
    );
    setPageSizeState(defaultPageSize);
  }, [columns, defaultPageSize]);

  const setFromConfig = useCallback(
    (config) => {
      if (!config) return;
      setColumnOrder(buildInitialOrder(columns, config));
      setColumnVisibility(buildInitialVisibility(columns, config));
      if (Number.isFinite(config.pageSize)) setPageSizeState(config.pageSize);
    },
    [columns],
  );

  const toConfig = useCallback(
    () => ({
      columns: columnOrder.map((key, order) => ({
        key,
        visible: columnVisibility[key] !== false,
        order,
      })),
      pageSize,
    }),
    [columnOrder, columnVisibility, pageSize],
  );

  return {
    allColumns,
    visibleColumns,
    columnOrder,
    columnVisibility,
    pageSize,
    hiddenCount,
    reorderColumns,
    moveColumn,
    toggleColumn,
    setPageSize,
    resetToDefaults,
    setFromConfig,
    toConfig,
  };
}

function buildInitialOrder(columns, savedPreference) {
  if (!savedPreference?.columns?.length) return columns.map((c) => c.key);

  const saved = savedPreference.columns
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((c) => c.key)
    .filter((k) => columns.some((c) => c.key === k));

  // Columns added to the blueprint after the preference was saved slot in at
  // their blueprint position (right after their blueprint predecessor), not at
  // the far end — a new leading photo column must stay first.
  const order = [...saved];
  columns.forEach((col, index) => {
    if (order.includes(col.key)) return;
    const prevKey = index > 0 ? columns[index - 1].key : null;
    const at = prevKey ? order.indexOf(prevKey) + 1 : 0;
    order.splice(at, 0, col.key);
  });
  return order;
}

function buildInitialVisibility(columns, savedPreference) {
  const defaults = Object.fromEntries(
    columns.map((c) => [c.key, c.defaultVisible !== false]),
  );
  if (!savedPreference?.columns?.length) return defaults;
  const overrides = Object.fromEntries(
    savedPreference.columns.map((c) => [c.key, c.visible !== false]),
  );
  return { ...defaults, ...overrides };
}
