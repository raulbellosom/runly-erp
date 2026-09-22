import { useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Loader2, Maximize2, Search as SearchIcon } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent, ComboboxField, SearchInput } from "@runly/ui";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { isImageMime } from "../lib/chatUtils";
import { FileTypeIcon } from "./ChatFilesGallery";
import { useFileRefSignedUrl } from "../hooks/useFileRefSignedUrl";
import { useRovingFocus } from "../hooks/useRovingFocus";
import { EntityFileViewer } from "./EntityFileViewer";
import { ConnectorRow } from "./ConnectorRow";
import { ENTITY_TYPE_LIST, FLAT_ENTITY_TYPES, fetchEntityOptions, matchesConnectorSearch } from "../lib/entityReferenceTypes";

// How many matches each type contributes to the "Todos" merged view before
// it's truncated behind a "Ver los N" link that switches to that type's own
// full list — keeps the merged view scannable when a query matches broadly.
const ALL_MODE_MATCHES_PER_TYPE = 4;
const ALL_MODE_MIN_QUERY_LENGTH = 2;

// One grid tile — its own component so each file gets its own lazy "card"
// (96x96) thumbnail query, fired only for image files and only once this
// tile actually renders. Loading dozens of full-resolution images up front
// (the previous approach) is exactly what this avoids.
function FilePickerTile({ opt, isSelected, atCap, onToggle, onPreview }) {
  const isImage = isImageMime(opt.mimeType);
  const { data: thumbUrl, isLoading } = useFileRefSignedUrl(opt.value, "card", isImage);
  const disabled = atCap && !isSelected;

  return (
    <div className="relative">
      <button
        type="button"
        data-connector-row
        onClick={() => onToggle(opt)}
        disabled={disabled}
        title={opt.label}
        className={[
          "aspect-square w-full rounded-lg overflow-hidden bg-[hsl(var(--muted))] transition-opacity",
          disabled ? "opacity-40 cursor-not-allowed" : "hover:opacity-80",
        ].join(" ")}
      >
        {isImage ? (
          isLoading ? (
            <div className="w-full h-full flex items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin opacity-40" />
            </div>
          ) : thumbUrl ? (
            <img src={thumbUrl} alt={opt.label} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <FileTypeIcon mimeType={opt.mimeType} />
            </div>
          )
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-1 p-1">
            <FileTypeIcon mimeType={opt.mimeType} />
            <span className="text-[9px] text-[hsl(var(--muted-foreground))] truncate w-full text-center">
              {opt.label}
            </span>
          </div>
        )}
      </button>

      {/* Selection indicator — pointer-events-none so clicks pass through to
          the tile button underneath. White ring + drop shadow instead of a
          theme-token border: this sits on top of arbitrary photo content, so
          it needs to stay legible against any photo color in either theme
          (same reasoning as ChatFilesGallery.jsx's MediaSelectionCircle). */}
      <div
        className={[
          "absolute top-1.5 right-1.5 h-4 w-4 rounded-full flex items-center justify-center pointer-events-none transition-all duration-150",
          "shadow-[0_1px_4px_rgba(0,0,0,0.7)]",
          isSelected
            ? "bg-[hsl(var(--primary))] ring-2 ring-white scale-110"
            : "bg-black/30 ring-2 ring-white/90",
        ].join(" ")}
      >
        {isSelected && (
          <svg viewBox="0 0 10 8" className="w-2 h-1.5" fill="none">
            <path d="M1 4l2.5 2.5L9 1" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onPreview(opt);
        }}
        title="Ver en grande"
        className="absolute bottom-1 left-1 h-5 w-5 rounded-full bg-[hsl(var(--background)/0.75)] flex items-center justify-center text-[hsl(var(--foreground))] hover:bg-[hsl(var(--background))] transition-colors"
      >
        <Maximize2 className="h-3 w-3" />
      </button>
    </div>
  );
}

// A real thumbnail grid for the "Archivo" type instead of a filename-only
// text list — the point of attaching a file reference is usually to pick a
// specific photo/document by how it LOOKS, not by remembering its exact
// filename. Supports selecting several files at once (confirmed via the
// "Adjuntar (N)" button, capped at `maxSelect`) and a per-tile "ver en
// grande" preview through the same viewer used for already-sent references.
// `search` comes from the picker's single shared search box, not its own.
function FilePickerGrid({ options, isLoading, search, maxSelect, onConfirm }) {
  const [selected, setSelected] = useState([]);
  const [previewOpt, setPreviewOpt] = useState(null);
  const rovingKeyDown = useRovingFocus();

  const filtered = useMemo(() => {
    if (!search.trim()) return options;
    const q = search.toLowerCase();
    return options.filter((o) => o.label?.toLowerCase().includes(q));
  }, [options, search]);

  const atCap = maxSelect != null && selected.length >= maxSelect;

  function toggle(opt) {
    setSelected((prev) => {
      const exists = prev.some((s) => s.value === opt.value);
      if (exists) return prev.filter((s) => s.value !== opt.value);
      if (maxSelect != null && prev.length >= maxSelect) return prev;
      return [...prev, opt];
    });
  }

  const previewFiles = previewOpt
    ? [{ id: previewOpt.value, mimeType: previewOpt.mimeType, originalName: previewOpt.label, sizeBytes: previewOpt.sizeBytes ?? null }]
    : [];

  return (
    <div className="space-y-2">
      {isLoading ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))] py-6 text-center">Cargando...</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))] py-6 text-center">Sin resultados</p>
      ) : (
        <div className="grid grid-cols-4 gap-1.5 max-h-72 overflow-y-auto pr-1" onKeyDown={rovingKeyDown}>
          {filtered.map((opt) => (
            <FilePickerTile
              key={opt.value}
              opt={opt}
              isSelected={selected.some((s) => s.value === opt.value)}
              atCap={atCap}
              onToggle={toggle}
              onPreview={setPreviewOpt}
            />
          ))}
        </div>
      )}
      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
          {selected.length > 0
            ? `${selected.length} seleccionado${selected.length === 1 ? "" : "s"}`
            : "Selecciona uno o varios"}
        </span>
        <button
          type="button"
          onClick={() => onConfirm(selected)}
          disabled={selected.length === 0}
          className="text-xs font-medium px-3 py-1.5 rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          Adjuntar{selected.length > 0 ? ` (${selected.length})` : ""}
        </button>
      </div>
      <EntityFileViewer
        open={Boolean(previewOpt)}
        onOpenChange={(v) => {
          if (!v) setPreviewOpt(null);
        }}
        files={previewFiles}
        activeIndex={0}
      />
    </div>
  );
}

// Single-select list for any flat type except `file` (its own thumbnail
// grid above) — every row renders through the shared ConnectorRow, filtered
// by the picker's shared search box. Clicking a row attaches it immediately,
// same quick single-pick behavior every type except file/inventory_item had
// before this redesign.
function SingleSelectList({ entityType, query, search, onPick }) {
  const rovingKeyDown = useRovingFocus();
  const filtered = useMemo(
    () => (query?.data ?? []).filter((o) => matchesConnectorSearch(o, search)),
    [query?.data, search],
  );

  if (query?.isLoading) {
    return <p className="text-xs text-[hsl(var(--muted-foreground))] py-6 text-center">Cargando...</p>;
  }
  if (filtered.length === 0) {
    return <p className="text-xs text-[hsl(var(--muted-foreground))] py-6 text-center">Sin resultados</p>;
  }
  return (
    <div className="space-y-1 max-h-80 overflow-y-auto pr-1" onKeyDown={rovingKeyDown}>
      {filtered.map((opt) => (
        <ConnectorRow key={opt.value} entityType={entityType} opt={opt} onClick={() => onPick(opt.value, opt.label)} />
      ))}
    </div>
  );
}

// Multi-select list for `inventory_item` — several items can be attached to
// the same message at once (confirmed via "Adjuntar (N)"), mirroring
// FilePickerGrid's multi-select confirm flow but as rows instead of tiles.
function MultiSelectList({ entityType, query, search, maxSelect, onConfirm }) {
  const [selected, setSelected] = useState([]);
  const rovingKeyDown = useRovingFocus();

  const filtered = useMemo(
    () => (query?.data ?? []).filter((o) => matchesConnectorSearch(o, search)),
    [query?.data, search],
  );

  const atCap = maxSelect != null && selected.length >= maxSelect;

  function toggle(opt) {
    setSelected((prev) => {
      const exists = prev.some((s) => s.value === opt.value);
      if (exists) return prev.filter((s) => s.value !== opt.value);
      if (maxSelect != null && prev.length >= maxSelect) return prev;
      return [...prev, opt];
    });
  }

  return (
    <div className="space-y-2">
      {query?.isLoading ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))] py-6 text-center">Cargando...</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))] py-6 text-center">Sin resultados</p>
      ) : (
        <div className="space-y-1 max-h-72 overflow-y-auto pr-1" onKeyDown={rovingKeyDown}>
          {filtered.map((opt) => (
            <ConnectorRow
              key={opt.value}
              entityType={entityType}
              opt={opt}
              isSelected={selected.some((s) => s.value === opt.value)}
              disabled={atCap && !selected.some((s) => s.value === opt.value)}
              onClick={() => toggle(opt)}
            />
          ))}
        </div>
      )}
      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] text-[hsl(var(--muted-foreground))]">
          {selected.length > 0
            ? `${selected.length} seleccionado${selected.length === 1 ? "" : "s"}`
            : "Selecciona uno o varios"}
        </span>
        <button
          type="button"
          onClick={() => onConfirm(selected)}
          disabled={selected.length === 0}
          className="text-xs font-medium px-3 py-1.5 rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
        >
          Adjuntar{selected.length > 0 ? ` (${selected.length})` : ""}
        </button>
      </div>
    </div>
  );
}

// `task` can't use the flat fetchEntityOptions path: GET /projects/:id/tasks
// is per-project only, there's no cross-project task list endpoint. Its own
// two-level cascade instead of the shared search box, which is hidden while
// this type is active (see isTaskType in EntityReferencePicker below).
function TaskPickerCascade({ token, onPick }) {
  const [projectId, setProjectId] = useState(null);

  const projectsQuery = useQuery({
    queryKey: ["chat-entity-ref-task-projects", token],
    queryFn: async () => {
      const res = await runly.projects.listProjects(token);
      return (res?.data ?? res ?? []).map((p) => ({ label: p.name, value: p.id }));
    },
    enabled: Boolean(token),
    staleTime: 30_000,
  });

  const tasksQuery = useQuery({
    queryKey: ["chat-entity-ref-task-tasks", projectId, token],
    queryFn: async () => {
      const res = await runly.projects.listTasks(projectId, {}, token);
      return (res?.data ?? res ?? []).map((t) => ({ label: t.title, value: t.id }));
    },
    enabled: Boolean(projectId && token),
    staleTime: 30_000,
  });

  return (
    <div className="space-y-2">
      <ComboboxField
        label="Proyecto"
        options={projectsQuery.data ?? []}
        value={projectId}
        onChange={setProjectId}
        placeholder="Selecciona un proyecto..."
        emptyText={projectsQuery.isLoading ? "Cargando..." : "Sin resultados"}
      />
      {projectId && (
        <ComboboxField
          label="Tarea"
          options={tasksQuery.data ?? []}
          value={null}
          onChange={(recordId) => {
            const opt = (tasksQuery.data ?? []).find((o) => o.value === recordId);
            if (!opt) return;
            onPick(recordId, opt.label);
          }}
          placeholder="Buscar tarea..."
          emptyText={tasksQuery.isLoading ? "Cargando..." : "Sin tareas en este proyecto"}
        />
      )}
    </div>
  );
}

function TypeChip({ label, Icon, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        "inline-flex items-center gap-1 shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
        active
          ? "border-[hsl(var(--primary))] bg-[hsl(var(--primary)/0.12)] text-[hsl(var(--primary))]"
          : "border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted))]",
      ].join(" ")}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {label}
    </button>
  );
}

// The chat composer's "conectores" picker: attaches a reference to another
// module's record (a contact, file, vehicle, inventory item, ...) to a
// message. Opens straight into a single search box plus a row of type
// filter chips — "Todos" searches every module at once (2+ characters, to
// avoid firing nine requests on open), or a chip narrows to one module's
// full picker (a thumbnail grid for files, a project/task cascade for
// tasks, everything else a searchable list of rich rows via ConnectorRow).
export function EntityReferencePicker({ open, onOpenChange, onPick, maxSelect, children }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const [activeType, setActiveType] = useState("all");
  const [search, setSearch] = useState("");
  const rovingKeyDown = useRovingFocus();

  const isAll = activeType === "all";
  const isFileType = activeType === "file";
  const isTaskType = activeType === "task";
  const isInventoryType = activeType === "inventory_item";
  const isSingleListType = !isAll && !isFileType && !isTaskType && !isInventoryType;

  const isAllSearchActive = isAll && search.trim().length >= ALL_MODE_MIN_QUERY_LENGTH;

  // One query per flat type, kept alive independently: enabled when it's the
  // active chip, or when "Todos" is active with a long-enough query. Reusing
  // the same query for both modes means switching from a "Todos" match into
  // that type's own full list (via "Ver los N") is instant, already cached.
  const optionsQueries = useQueries({
    queries: FLAT_ENTITY_TYPES.map((t) => ({
      queryKey: ["chat-entity-ref-options", t.value, token],
      queryFn: () => fetchEntityOptions(t.value, token),
      enabled: Boolean(token) && (activeType === t.value || isAllSearchActive),
      staleTime: 30_000,
    })),
  });
  const resultsByType = useMemo(() => {
    const map = {};
    FLAT_ENTITY_TYPES.forEach((t, i) => {
      map[t.value] = optionsQueries[i];
    });
    return map;
  }, [optionsQueries]);

  const groupedResults = useMemo(() => {
    if (!isAllSearchActive) return [];
    return FLAT_ENTITY_TYPES.map((t) => {
      const matches = (resultsByType[t.value]?.data ?? []).filter((o) => matchesConnectorSearch(o, search));
      return { type: t, matches: matches.slice(0, ALL_MODE_MATCHES_PER_TYPE), total: matches.length };
    }).filter((g) => g.matches.length > 0);
  }, [isAllSearchActive, search, resultsByType]);

  const isAllSearchLoading = isAllSearchActive && FLAT_ENTITY_TYPES.some((t) => resultsByType[t.value]?.isLoading);

  function close() {
    onOpenChange(false);
    setActiveType("all");
    setSearch("");
  }

  function handlePick(entityType, recordId, label) {
    onPick({ entityType, recordId, label });
    close();
  }

  function handleConfirmMulti(entityType, selectedOpts) {
    for (const opt of selectedOpts) onPick({ entityType, recordId: opt.value, label: opt.label });
    close();
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) {
          setActiveType("all");
          setSearch("");
        }
      }}
    >
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent side="top" align="start" className="w-96 p-3 space-y-2.5">
        {!isTaskType && (
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
            placeholder="Buscar contacto, archivo, vehículo, inventario..."
            aria-label="Buscar conector"
            autoFocus
          />
        )}

        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5" role="group" aria-label="Filtrar por tipo de conector">
          <TypeChip label="Todos" Icon={SearchIcon} active={isAll} onClick={() => setActiveType("all")} />
          {ENTITY_TYPE_LIST.map((t) => (
            <TypeChip key={t.value} label={t.label} Icon={t.Icon} active={activeType === t.value} onClick={() => setActiveType(t.value)} />
          ))}
        </div>

        {isAll && (
          !isAllSearchActive ? (
            <p className="text-xs text-[hsl(var(--muted-foreground))] py-6 text-center px-4">
              Escribe al menos {ALL_MODE_MIN_QUERY_LENGTH} letras para buscar en todos los conectores, o elige un tipo arriba.
            </p>
          ) : isAllSearchLoading && groupedResults.length === 0 ? (
            <p className="text-xs text-[hsl(var(--muted-foreground))] py-6 text-center">Buscando...</p>
          ) : groupedResults.length === 0 ? (
            <p className="text-xs text-[hsl(var(--muted-foreground))] py-6 text-center">Sin resultados</p>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto pr-1" onKeyDown={rovingKeyDown}>
              {groupedResults.map(({ type, matches, total }) => (
                <div key={type.value}>
                  <div className="flex items-center justify-between px-1 pb-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-[hsl(var(--muted-foreground))]">
                      {type.label}
                    </span>
                    {total > matches.length && (
                      <button
                        type="button"
                        onClick={() => setActiveType(type.value)}
                        className="text-[10px] font-medium text-[hsl(var(--primary))] hover:underline"
                      >
                        Ver los {total}
                      </button>
                    )}
                  </div>
                  <div className="space-y-1">
                    {matches.map((opt) => (
                      <ConnectorRow
                        key={opt.value}
                        entityType={type.value}
                        opt={opt}
                        onClick={() => handlePick(type.value, opt.value, opt.label)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {isFileType && (
          <FilePickerGrid
            options={resultsByType.file?.data ?? []}
            isLoading={resultsByType.file?.isLoading}
            search={search}
            maxSelect={maxSelect}
            onConfirm={(opts) => handleConfirmMulti("file", opts)}
          />
        )}
        {isTaskType && <TaskPickerCascade token={token} onPick={(id, label) => handlePick("task", id, label)} />}
        {isInventoryType && (
          <MultiSelectList
            entityType="inventory_item"
            query={resultsByType.inventory_item}
            search={search}
            maxSelect={maxSelect}
            onConfirm={(opts) => handleConfirmMulti("inventory_item", opts)}
          />
        )}
        {isSingleListType && (
          <SingleSelectList
            entityType={activeType}
            query={resultsByType[activeType]}
            search={search}
            onPick={(id, label) => handlePick(activeType, id, label)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
