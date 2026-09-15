import { useMemo, useState } from "react";
import { getFileKind } from "@runly/ui";

const NAVIGABLE_ORIGIN_MODULES = new Set([
  "runly.files",
  "runly.company",
  "runly.contacts",
]);

function sortByValue(items, by, dir) {
  const factor = dir === "asc" ? 1 : -1;
  const sorted = [...items];

  sorted.sort((a, b) => {
    if (by === "originalName") {
      return (
        a.originalName.localeCompare(b.originalName, "es", {
          sensitivity: "base",
        }) * factor
      );
    }
    if (by === "sizeBytes") {
      return ((a.sizeBytes ?? 0) - (b.sizeBytes ?? 0)) * factor;
    }
    const left = new Date(a.createdAt).getTime();
    const right = new Date(b.createdAt).getTime();
    return (left - right) * factor;
  });

  return sorted;
}

export function useFilesExplorer(files = [], { server = false } = {}) {
  const [viewMode, setViewMode] = useState("table");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({
    enabled: "",
    kind: "",
    moduleKey: "",
    origin: "",
  });
  const [sort, setSort] = useState({ by: "createdAt", dir: "desc" });
  const [selectedIds, setSelectedIds] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);

  const filteredFiles = useMemo(() => {
    if (server) return files;
    const q = search.trim().toLowerCase();

    const base = files.filter((file) => {
      if (q) {
        const haystack = [
          file.originalName,
          file.mimeType,
          file.moduleKey,
          file.entityType,
        ]
          .map((item) => String(item ?? "").toLowerCase())
          .join(" ");
        if (!haystack.includes(q)) return false;
      }

      if (filters.enabled) {
        const value = filters.enabled === "true";
        if (Boolean(file.enabled) !== value) return false;
      }

      if (filters.kind) {
        if (getFileKind(file) !== filters.kind) return false;
      }

      if (filters.moduleKey && file.moduleKey !== filters.moduleKey) {
        return false;
      }

      if (filters.origin) {
        const navigable = NAVIGABLE_ORIGIN_MODULES.has(file.moduleKey);
        if (filters.origin === "mapped" && !navigable) return false;
        if (filters.origin === "unmapped" && navigable) return false;
      }

      return true;
    });

    return sortByValue(base, sort.by, sort.dir);
  }, [files, search, filters, sort, server]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  function toggleSelect(fileId) {
    setSelectedIds((prev) =>
      prev.includes(fileId)
        ? prev.filter((id) => id !== fileId)
        : [...prev, fileId],
    );
  }

  function clearSelection() {
    setSelectedIds([]);
  }

  function selectVisible() {
    setSelectedIds(filteredFiles.map((file) => file.id));
  }

  function openById(fileId) {
    const idx = filteredFiles.findIndex((item) => item.id === fileId);
    setActiveIndex(idx);
  }

  return {
    viewMode,
    setViewMode,
    search,
    setSearch,
    filters,
    setFilters,
    sort,
    setSort,
    selectedIds,
    selectedSet,
    setSelectedIds,
    selectedCount: selectedIds.length,
    clearSelection,
    selectVisible,
    toggleSelect,
    filteredFiles,
    activeIndex,
    setActiveIndex,
    openById,
  };
}
