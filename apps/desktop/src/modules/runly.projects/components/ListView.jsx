import { useState, useMemo } from "react";
import {
  SearchInput,
  EmptyState,
  SelectField,
  ConfirmDialog,
  Checkbox,
  LoadingState,
  Table,
  TableHeader,
  TableBody,
} from "@runly/ui";
import { ChevronRight, CornerDownRight, Trash2, X, Lock, RefreshCw, Paperclip } from "lucide-react";
import { toast } from "sonner";
import {
  useStatuses,
  useTasks,
  useBulkUpdateTasks,
  useBulkDeleteTasks,
  useProjectMembers,
} from "../hooks/useProjectsData";
import { AssigneeChip, StackedAssignees } from "../lib/AssigneeChip.jsx";

const PRIORITY_OPTIONS = [
  { value: "__all__", label: "Todas" },
  { value: "URGENT", label: "Urgente" },
  { value: "HIGH", label: "Alta" },
  { value: "MEDIUM", label: "Media" },
  { value: "LOW", label: "Baja" },
  { value: "NONE", label: "Normal" },
];

const PRIORITY_BADGE = {
  URGENT: { label: "Urgente", cls: "bg-red-500/20 text-red-400" },
  HIGH: { label: "Alta", cls: "bg-orange-500/20 text-orange-400" },
  MEDIUM: { label: "Media", cls: "bg-blue-500/20 text-blue-400" },
  LOW: { label: "Baja", cls: "bg-slate-500/20 text-slate-400" },
  NONE: { label: "Normal", cls: "bg-muted text-muted-foreground" },
};

function parseDateSafe(d) {
  if (!d) return null;
  const str = String(d);
  const part = str.includes("T") ? str.slice(0, 10) : str;
  return new Date(`${part}T12:00:00`);
}

function isOverdue(dueDate) {
  if (!dueDate) return false;
  return parseDateSafe(dueDate) < new Date();
}

function formatDate(d) {
  if (!d) return "—";
  return parseDateSafe(d).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
  });
}

export default function ListView({
  projectId,
  onTaskClick,
  showSubtasks = false,
}) {
  const { data: statusesData } = useStatuses(projectId);
  const { data: tasksData, isLoading } = useTasks(projectId, {
    ...(showSubtasks ? { include_subtasks: "true" } : { parentTaskId: "null" }),
  });
  const statuses = statusesData?.data ?? statusesData ?? [];
  const tasks = tasksData?.data ?? tasksData ?? [];

  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("__all__");
  const [filterPriority, setFilterPriority] = useState("__all__");
  const { data: membersData } = useProjectMembers(projectId);
  const members = membersData?.data ?? membersData ?? [];

  const [selectedIds, setSelectedIds] = useState(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const bulkUpdate = useBulkUpdateTasks(projectId);
  const bulkDelete = useBulkDeleteTasks(projectId);

  const statusMap = useMemo(() => {
    const m = {};
    for (const s of statuses) m[s.id] = s;
    return m;
  }, [statuses]);

  const filtered = useMemo(() => {
    let list = tasks;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((t) => t.title.toLowerCase().includes(q));
    }
    if (filterStatus && filterStatus !== "__all__")
      list = list.filter((t) => t.statusId === filterStatus);
    if (filterPriority && filterPriority !== "__all__")
      list = list.filter((t) => t.priority === filterPriority);
    return list.sort((a, b) => {
      const sA = statusMap[a.statusId]?.position ?? 0;
      const sB = statusMap[b.statusId]?.position ?? 0;
      if (sA !== sB) return sA - sB;
      return a.position - b.position;
    });
  }, [tasks, search, filterStatus, filterPriority, statusMap]);

  function toggleRow(id) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((t) => t.id)));
    }
  }

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function handleBulkDelete() {
    bulkDelete.mutate(
      { taskIds: [...selectedIds] },
      {
        onSuccess: () => {
          clearSelection();
          setBulkDeleteOpen(false);
        },
        onError: () => toast.error("No se pudo eliminar las tareas"),
      },
    );
  }

  function handleBulkStatus(statusId) {
    if (!statusId || statusId === "") return;
    bulkUpdate.mutate(
      { taskIds: [...selectedIds], patch: { statusId } },
      {
        onSuccess: clearSelection,
        onError: () => toast.error("No se pudo actualizar las tareas"),
      },
    );
  }

  function handleBulkAssign(assigneeId) {
    if (!assigneeId || assigneeId === "") return;
    bulkUpdate.mutate(
      { taskIds: [...selectedIds], patch: { assigneeId } },
      {
        onSuccess: clearSelection,
        onError: () => toast.error("No se pudo asignar las tareas"),
      },
    );
  }

  function handleBulkPriority(priority) {
    if (!priority || priority === "") return;
    bulkUpdate.mutate(
      { taskIds: [...selectedIds], patch: { priority } },
      {
        onSuccess: clearSelection,
        onError: () => toast.error("No se pudo cambiar la prioridad"),
      },
    );
  }

  return (
    <>
      <div className="flex flex-col h-full overflow-hidden relative">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0 flex-wrap">
          <SearchInput
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar tareas..."
            className="w-48"
          />
          <SelectField
            value={filterStatus}
            onValueChange={setFilterStatus}
            options={[
              { value: "__all__", label: "Estado: Todos" },
              ...statuses.map((s) => ({ value: s.id, label: s.name })),
            ]}
          />
          <SelectField
            value={filterPriority}
            onValueChange={setFilterPriority}
            options={PRIORITY_OPTIONS.map((o) => ({
              value: o.value,
              label:
                o.value !== "__all__"
                  ? `Prioridad: ${o.label}`
                  : "Prioridad: Todas",
            }))}
          />
        </div>

        <div className="flex-1 overflow-y-auto">
          {isLoading && <LoadingState message="Cargando tareas..." />}
          {!isLoading && filtered.length === 0 && (
            <EmptyState
              title="Sin tareas"
              description="No hay tareas que coincidan con los filtros."
            />
          )}
          {filtered.length > 0 && (
            <Table className="text-sm">
              <TableHeader className="sticky top-0 bg-background border-b border-border z-10">
                <tr>
                  <th className="px-3 py-2 w-8">
                    <Checkbox
                      checked={
                        filtered.length > 0 &&
                        selectedIds.size === filtered.length
                      }
                      onCheckedChange={toggleAll}
                    />
                  </th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Tarea
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide w-36">
                    Asignado
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide w-24">
                    Prioridad
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide w-24">
                    Inicio
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide w-24">
                    Vence
                  </th>
                  <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground uppercase tracking-wide w-40">
                    Estado
                  </th>
                </tr>
              </TableHeader>
              <TableBody>
                {filtered.map((task) => {
                  const status = statusMap[task.statusId];
                  const priority =
                    PRIORITY_BADGE[task.priority] ?? PRIORITY_BADGE.NONE;
                  const overdue = isOverdue(task.dueDate);
                  return (
                    <tr
                      key={task.id}
                      onClick={() => onTaskClick(task.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onTaskClick(task.id);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      className="border-b border-border hover:bg-muted/50 focus-visible:outline-none focus-visible:bg-muted/50 cursor-pointer transition-colors"
                    >
                      <td
                        className="px-3 py-2.5 w-8"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Checkbox
                          checked={selectedIds.has(task.id)}
                          onCheckedChange={() => toggleRow(task.id)}
                        />
                      </td>
                      <td className="px-4 py-2.5">
                        <div
                          className={[
                            "flex items-center gap-2",
                            task.parentTaskId
                              ? "pl-3 border-l-2 border-indigo-400/50"
                              : "",
                          ].join(" ")}
                        >
                          {task.parentTaskId && (
                            <CornerDownRight
                              size={10}
                              className="text-indigo-400/70 shrink-0"
                            />
                          )}
                          <div className="min-w-0">
                            {task.taskNumber != null && (
                              <span className="text-[10px] text-muted-foreground font-mono block">
                                T-{task.taskNumber}
                              </span>
                            )}
                            <span className="truncate max-w-sm block">
                              {task.title}
                            </span>
                            {task.parent && (
                              <span className="text-[10px] text-muted-foreground truncate block">
                                {task.parent.title}
                              </span>
                            )}
                          </div>
                          {task._count?.subtasks > 0 && (
                            <span className="text-xs text-muted-foreground shrink-0">
                              ({task._count.subtasks})
                            </span>
                          )}
                          {task._count?.attachments > 0 && (
                            <span className="flex items-center gap-0.5 text-xs text-muted-foreground shrink-0">
                              <Paperclip size={11} />
                              {task._count.attachments}
                            </span>
                          )}
                          {task.blockedBy?.length > 0 && (
                            <Lock size={11} className="text-amber-500 shrink-0" title="Tarea bloqueada" />
                          )}
                          {task.rrule && (
                            <RefreshCw size={11} className="text-indigo-400 shrink-0" title="Tarea recurrente" />
                          )}
                          <ChevronRight
                            size={14}
                            className="ml-auto text-muted-foreground shrink-0"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <StackedAssignees
                          assignees={task.assignees}
                          fallback={task.assignee}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`text-xs rounded-full px-2 py-0.5 ${priority.cls}`}
                        >
                          {priority.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {formatDate(task.startDate)}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-xs ${overdue ? "text-red-400 font-medium" : "text-muted-foreground"}`}
                      >
                        {formatDate(task.dueDate)}
                      </td>
                      <td className="px-3 py-2.5">
                        {status && (
                          <span
                            className="text-xs rounded-full px-2 py-0.5 border whitespace-nowrap"
                            style={{
                              borderColor: `${status.color}50`,
                              color: status.color,
                            }}
                          >
                            {status.name}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Floating bulk action bar */}
        {selectedIds.size > 0 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex flex-wrap items-center justify-center gap-2 bg-background border border-border rounded-lg shadow-lg px-4 py-2.5 text-sm max-w-[calc(100%-2rem)]">
            <span className="text-muted-foreground mr-1 shrink-0">
              {selectedIds.size} tarea{selectedIds.size !== 1 ? "s" : ""}
            </span>
            <SelectField
              value=""
              onValueChange={handleBulkStatus}
              options={[
                { value: "", label: "Cambiar estado" },
                ...statuses.map((s) => ({ value: s.id, label: s.name })),
              ]}
            />
            <SelectField
              value=""
              onValueChange={handleBulkAssign}
              options={[
                { value: "", label: "Asignar" },
                ...members.map((m) => {
                  const u = m.user ?? m;
                  return {
                    value: m.userId ?? u.id,
                    label:
                      [u.firstName, u.lastName].filter(Boolean).join(" ") ||
                      u.email ||
                      u.id,
                  };
                }),
              ]}
            />
            <SelectField
              value=""
              onValueChange={handleBulkPriority}
              options={[
                { value: "", label: "Prioridad" },
                { value: "URGENT", label: "Urgente" },
                { value: "HIGH", label: "Alta" },
                { value: "MEDIUM", label: "Media" },
                { value: "LOW", label: "Baja" },
                { value: "NONE", label: "Normal" },
              ]}
            />
            <button
              onClick={() => setBulkDeleteOpen(true)}
              className="flex items-center gap-1 text-destructive hover:text-destructive/80 transition-colors px-2 py-1 rounded hover:bg-destructive/10"
            >
              <Trash2 size={13} />
              Eliminar
            </button>
            <button
              onClick={clearSelection}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        title={`Eliminar ${selectedIds.size} tarea${selectedIds.size !== 1 ? "s" : ""}`}
        description="Esta accion eliminara las tareas seleccionadas y sus subtareas. No se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={handleBulkDelete}
      />
    </>
  );
}
