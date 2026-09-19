import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Button,
  ConfirmDialog,
  DatePickerField,
  SelectField,
  AttachmentsPanel,
  LoadingState,
  ComboboxField,
  Input,
  MarkdownField,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@runly/ui";
import { Skeleton } from "@runly/ui";
import { Trash2, Plus, X, Activity, Lock, SmilePlus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import {
  useTask,
  useUpdateTask,
  useDeleteTask,
  useCreateTask,
  useStatuses,
  useProjectMembers,
  useAddAssignee,
  useRemoveAssignee,
  useCreateComment,
  useUpdateComment,
  useDeleteComment,
  useTaskActivity,
  useTaskDependencies,
  useAddDependency,
  useRemoveDependency,
  useTaskFieldValues,
  useUpsertFieldValues,
  useAllTasksForPicker,
  useToggleTaskReaction,
  useTaskComments,
} from "../hooks/useProjectsData";
import { SubtaskRow } from "./SubtaskRow.jsx";
import { AssigneeAvatar } from "../lib/AssigneeChip.jsx";
import { UserPickerDropdown } from "../lib/UserPickerDropdown.jsx";
import MentionTextarea, { renderMentionText } from "./MentionTextarea.jsx";

const API_BASE_URL = getApiUrl();


function groupReactions(reactions = [], currentUserId = null) {
  const map = new Map();
  for (const r of reactions) {
    if (!map.has(r.emoji)) map.set(r.emoji, { emoji: r.emoji, count: 0, users: [], isMine: false });
    const entry = map.get(r.emoji);
    entry.count++;
    const name = r.user
      ? [r.user.firstName, r.user.lastName].filter(Boolean).join(" ") || "?"
      : "?";
    entry.users.push(name);
    if (currentUserId && r.userId === currentUserId) entry.isMine = true;
  }
  return [...map.values()];
}

const REACTIONS = ['👍', '👎', '❤️', '🎉', '😄', '😮', '😢', '🔥', '👀', '✅', '🚀', '💯']

// Radix Popover (portals to <body>) instead of a hand-rolled `position:
// absolute` div — this panel renders inside a Sheet's overflow-y-auto region,
// which clipped/mispositioned a locally absolute-positioned popup.
function EmojiPicker({ onSelect }) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted active:bg-muted transition-colors"
        >
          <SmilePlus className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        collisionPadding={8}
        className="w-auto p-2 pointer-events-auto"
        style={{ zIndex: 10001 }}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="grid grid-cols-6 gap-1">
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              onClick={() => { onSelect(emoji); setOpen(false); }}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-lg hover:bg-muted transition-colors"
            >
              {emoji}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

const PRIORITY_OPTIONS = [
  { value: "NONE", label: "Normal" },
  { value: "LOW", label: "Baja" },
  { value: "MEDIUM", label: "Media" },
  { value: "HIGH", label: "Alta" },
  { value: "URGENT", label: "Urgente" },
];

const RRULE_OPTIONS = [
  { value: "NONE", label: "No repetir" },
  { value: "FREQ=DAILY", label: "Cada dia" },
  { value: "FREQ=WEEKLY", label: "Cada semana" },
  { value: "FREQ=WEEKLY;INTERVAL=2", label: "Cada dos semanas" },
  { value: "FREQ=MONTHLY", label: "Cada mes" },
];

function formatDate(d) {
  return new Date(d).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AssigneeAdder({ currentAssigneeIds, onAdd, members }) {
  const [open, setOpen] = useState(false);

  const available = members
    .filter((m) => {
      const uid = m.userId ?? m.user?.id ?? m.id;
      return !currentAssigneeIds.includes(uid);
    })
    .map((m) => ({ ...(m.user ?? m), id: m.userId ?? m.user?.id ?? m.id }));

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
      >
        <Plus size={11} />
        Agregar miembro
      </button>
    );
  }

  return (
    <div className="w-80 max-w-full">
      <UserPickerDropdown
        users={available}
        value=""
        onChange={(uid) => {
          if (uid) {
            onAdd(uid);
            setOpen(false);
          }
        }}
        placeholder="Buscar miembro..."
        emptyMessage="Sin miembros disponibles"
        autoFocus
        onBlur={() => setOpen(false)}
      />
    </div>
  );
}

export default function TaskDetailPanel({ projectId, taskId, onClose, onOpenTask }) {
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const userId = userProfile?.id ?? session?.user?.id;
  const [floatingLayer, setFloatingLayer] = useState(null);

  const { data: task, isLoading } = useTask(projectId, taskId);
  const { data: statuses = [] } = useStatuses(projectId);
  const { data: membersData } = useProjectMembers(projectId);
  const { data: activityData } = useTaskActivity(taskId);
  const { data: depsData } = useTaskDependencies(projectId, taskId);
  const { data: fieldValuesData } = useTaskFieldValues(projectId, taskId);
  const [depsExpanded, setDepsExpanded] = useState(false);
  const { data: allTasksData } = useAllTasksForPicker(projectId, depsExpanded);
  const members = useMemo(() => membersData?.data ?? membersData ?? [], [membersData]);
  const activityEvents = useMemo(() => activityData?.data ?? activityData ?? [], [activityData]);
  const deps = useMemo(() => depsData ?? { blockedBy: [], blocking: [] }, [depsData]);
  const fieldValues = useMemo(() => fieldValuesData ?? [], [fieldValuesData]);
  const allTasks = useMemo(
    () => (allTasksData?.data ?? allTasksData ?? []).filter((t) => t.id !== taskId),
    [allTasksData, taskId],
  );

  const attachmentsConfig = useMemo(() => ({
    label: "Archivos",
    listPath: `/projects/${projectId}/tasks/:id/attachments`,
    addPath: `/projects/${projectId}/tasks/:id/attachments`,
    removePath: `/projects/${projectId}/tasks/:id/attachments/:docId`,
    upload: { endpoint: "/files/upload", moduleKey: "runly.projects", entityType: "Task" },
    fields: { fileAssetId: "id" },
    signedUrl: { endpointTemplate: "/files/:fileId/signed-url" },
  }), [projectId]);

  const updateTask = useUpdateTask(projectId);
  const deleteTask = useDeleteTask(projectId);
  const createSubtask = useCreateTask(projectId);
  const addAssignee = useAddAssignee(projectId, taskId);
  const removeAssignee = useRemoveAssignee(projectId, taskId);
  const addDependency = useAddDependency(projectId, taskId);
  const removeDependency = useRemoveDependency(projectId, taskId);
  const upsertFieldValues = useUpsertFieldValues(projectId, taskId);
  const { data: taskComments = [] } = useTaskComments(projectId, taskId);

  const { data: taskFilesData } = useQuery({
    queryKey: ['projects', projectId, 'tasks', taskId, 'attachments'],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE_URL}/projects/${projectId}/tasks/${taskId}/attachments`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Attachments fetch failed (${res.status})`);
      }
      return res.json();
    },
    enabled: Boolean(projectId && taskId && token),
    staleTime: 30_000,
  });

  const createComment = useCreateComment(projectId, taskId);
  const updateComment = useUpdateComment(projectId, taskId);
  const deleteComment = useDeleteComment(projectId, taskId);
  const toggleReaction = useToggleTaskReaction(projectId, taskId);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [newSubtask, setNewSubtask] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [editingCommentId, setEditingCommentId] = useState(null);
  const [editingBody, setEditingBody] = useState("");
  const [deleteCommentId, setDeleteCommentId] = useState(null);
  const [depPickerOpen, setDepPickerOpen] = useState(false);
  const [depPickerValue, setDepPickerValue] = useState("");
  const [localFieldValues, setLocalFieldValues] = useState({});

  useEffect(() => {
    if (task) {
      setTitle(task.title ?? "");
      setDescription(task.description ?? "");
    }
  }, [task?.id]);

  // Sync local field value state when server data arrives
  useEffect(() => {
    const map = {};
    for (const entry of fieldValues) {
      map[entry.field?.id ?? entry.fieldId] = entry.value ?? "";
    }
    setLocalFieldValues(map);
  }, [fieldValues]);

  // { id, displayName } shape for @mention picker
  const mentionMembers = useMemo(
    () =>
      members.map((m) => {
        const u = m.user ?? m;
        const id = m.userId ?? u.id;
        const displayName =
          [u.firstName, u.lastName].filter(Boolean).join(" ").trim() ||
          u.email ||
          "";
        return { id, displayName };
      }),
    [members],
  );

  // Merge comments + activity events into one chronological feed
  const feedItems = useMemo(() => {
    const comments = taskComments.map((c) => ({
      kind: "comment",
      createdAt: c.createdAt,
      data: c,
    }));
    const events = activityEvents.map((e) => ({
      kind: "event",
      createdAt: e.createdAt,
      data: e,
    }));
    return [...comments, ...events].sort(
      (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
    );
  }, [taskComments, activityEvents]);

  function saveField(field, value) {
    if (!task) return;
    updateTask.mutate(
      { taskId: task.id, [field]: value },
      { onError: () => toast.error("No se pudo guardar el cambio") },
    );
  }

  function handleTitleBlur() {
    const trimmed = title.trim();
    if (trimmed && trimmed !== task?.title) saveField("title", trimmed);
  }

  function handleDescriptionBlur() {
    if (description !== task?.description)
      saveField("description", description || null);
  }

  function handleAddSubtask(e) {
    e.preventDefault();
    const t = newSubtask.trim();
    if (!t || !task) return;
    createSubtask.mutate(
      { title: t, statusId: task.statusId, parentTaskId: task.id },
      {
        onSuccess: () => setNewSubtask(""),
        onError: () => toast.error("No se pudo crear la subtarea"),
      },
    );
  }

  function handleDeleteSubtask(subtaskId) {
    deleteTask.mutate(subtaskId, {
      onError: () => toast.error("No se pudo eliminar la subtarea"),
    });
  }

  function handleDelete() {
    deleteTask.mutate(task.id, {
      onSuccess: () => {
        toast.success("Tarea eliminada");
        onClose();
      },
      onError: () => toast.error("No se pudo eliminar la tarea"),
    });
  }

  function handleSubmitComment(e) {
    e?.preventDefault();
    const body = commentBody.trim();
    if (!body) return;
    setCommentBody("");
    createComment.mutate({ body });
  }

  function handleEditComment(comment) {
    setEditingCommentId(comment.id);
    setEditingBody(comment.body);
  }

  function handleSaveEdit() {
    updateComment.mutate(
      { commentId: editingCommentId, body: editingBody },
      {
        onSuccess: () => {
          setEditingCommentId(null);
          setEditingBody("");
        },
        onError: () => toast.error("No se pudo editar el comentario"),
      },
    );
  }

  function handleDeleteComment() {
    deleteComment.mutate(
      { commentId: deleteCommentId },
      {
        onSuccess: () => setDeleteCommentId(null),
        onError: () => toast.error("No se pudo eliminar el comentario"),
      },
    );
  }

  const statusOptions = (statuses?.data ?? statuses ?? []).map((s) => ({
    value: s.id,
    label: s.name,
  }));
  const subtasks = task?.subtasks ?? [];
  const isPending =
    updateTask.isPending ||
    createSubtask.isPending ||
    deleteTask.isPending ||
    addAssignee.isPending ||
    removeAssignee.isPending ||
    createComment.isPending ||
    updateComment.isPending ||
    deleteComment.isPending;

  return (
    <>
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <SheetContent
          className="w-full flex flex-col gap-0 p-0"
          style={{
            maxWidth: "860px",
            backdropFilter: "none",
            WebkitBackdropFilter: "none",
            background: "hsl(var(--background))",
          }}
        >
          {/* Portal container for floating UI (emoji picker, mention dropdown).
              Rendering portals here — inside the Radix dialog tree — prevents
              the dialog's DismissableLayer from intercepting pointer events on
              those overlays. */}
          <div ref={setFloatingLayer} className="contents" />
          <div
            className={`h-0.5 shrink-0 transition-opacity duration-200 bg-primary ${isPending ? "opacity-100 animate-pulse" : "opacity-0"}`}
          />

          <SheetHeader className="pl-6 pr-20 py-4 border-b border-border shrink-0">
            <SheetTitle className="sr-only">Detalles de tarea</SheetTitle>
            <div className="flex items-center gap-2">
              {isLoading && !task ? (
                <>
                  <Skeleton className="h-5 w-10 rounded shrink-0" />
                  <Skeleton className="h-6 flex-1 rounded" />
                </>
              ) : (
                <>
                  {task?.taskNumber != null && (
                    <span className="text-xs text-muted-foreground font-mono shrink-0 bg-muted px-1.5 py-0.5 rounded">
                      T-{task.taskNumber}
                    </span>
                  )}
                  <textarea
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={handleTitleBlur}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        e.currentTarget.blur();
                      }
                    }}
                    rows={1}
                    className="flex-1 text-base font-semibold bg-transparent border-none outline-none focus:ring-0 resize-none leading-snug"
                    style={{ fieldSizing: "content" }}
                    placeholder="Nombre de la tarea"
                  />
                  <button
                    onClick={() => setDeleteOpen(true)}
                    className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                    title="Eliminar tarea"
                  >
                    <Trash2 size={16} />
                  </button>
                </>
              )}
            </div>
          </SheetHeader>

          <div className="flex-1 md:overflow-y-auto">
            {isLoading ? (
              <LoadingState />
            ) : task ? (
              <div className="flex flex-col gap-4 p-6">
                <SelectField
                  label="Estado"
                  value={task.statusId}
                  onValueChange={(v) => saveField("statusId", v)}
                  options={statusOptions}
                />
                <SelectField
                  label="Prioridad"
                  value={task.priority}
                  onValueChange={(v) => saveField("priority", v)}
                  options={PRIORITY_OPTIONS}
                />
                <SelectField
                  label="Repetir"
                  value={task.rrule ?? "NONE"}
                  onValueChange={(v) =>
                    saveField("rrule", v === "NONE" ? null : v)
                  }
                  options={RRULE_OPTIONS}
                />

                {/* Multi-assignee manager */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">
                    Asignado a
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {(task.assignees ?? []).map((row) => {
                      const u = row.user;
                      const name =
                        [u?.firstName, u?.lastName]
                          .filter(Boolean)
                          .join(" ")
                          .trim() ||
                        u?.email ||
                        "";
                      return (
                        <span
                          key={row.userId ?? u?.id}
                          className="flex items-center gap-1 bg-muted border border-border rounded-full px-2 py-0.5 text-xs"
                        >
                          <AssigneeAvatar user={u ?? {}} size="sm" />
                          <span className="max-w-22.5 truncate">{name}</span>
                          <button
                            onClick={() =>
                              removeAssignee.mutate(
                                { userId: row.userId ?? u?.id },
                                {
                                  onError: () =>
                                    toast.error("No se pudo quitar asignado"),
                                },
                              )
                            }
                            className="ml-0.5 text-muted-foreground hover:text-destructive transition-colors"
                            tabIndex={-1}
                          >
                            <X size={10} />
                          </button>
                        </span>
                      );
                    })}
                  </div>
                  <AssigneeAdder
                    currentAssigneeIds={(task.assignees ?? []).map(
                      (r) => r.userId ?? r.user?.id,
                    )}
                    onAdd={(uid) =>
                      addAssignee.mutate(
                        { userId: uid },
                        { onError: () => toast.error("No se pudo asignar") },
                      )
                    }
                    members={members}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <DatePickerField
                    label="Fecha inicio"
                    value={task.startDate ?? null}
                    onChange={(d) => saveField("startDate", d ?? null)}
                  />
                  <DatePickerField
                    label="Fecha vencimiento"
                    value={task.dueDate ?? null}
                    onChange={(d) => saveField("dueDate", d ?? null)}
                  />
                </div>

                {/* Dependencias */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <button
                      type="button"
                      onClick={() => setDepsExpanded(true)}
                      className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block w-full text-left"
                    >
                      Dependencias
                    </button>
                    <button
                      onClick={() => {
                        setDepPickerOpen((o) => !o);
                        setDepPickerValue("");
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                    >
                      <Plus size={11} />
                      Agregar bloqueo
                    </button>
                  </div>

                  {depPickerOpen && (
                    <div className="mb-3">
                      <ComboboxField
                        label=""
                        value={depPickerValue}
                        onValueChange={(v) => {
                          if (!v) return;
                          addDependency.mutate(
                            { blockerId: v },
                            {
                              onSuccess: () => {
                                setDepPickerOpen(false);
                                setDepPickerValue("");
                              },
                            },
                          );
                        }}
                        options={allTasks.map((t) => ({
                          value: t.id,
                          label: `T-${t.taskNumber ?? "?"} ${t.title}`,
                        }))}
                        placeholder="Buscar tarea bloqueante..."
                        emptyMessage="Sin tareas disponibles"
                      />
                    </div>
                  )}

                  {deps.blockedBy.length > 0 && (
                    <div className="mb-2">
                      <p className="text-[11px] text-muted-foreground mb-1">
                        Bloqueado por
                      </p>
                      <div className="space-y-1">
                        {deps.blockedBy.map((dep) => (
                          <div
                            key={dep.id}
                            className="flex items-center gap-1.5 text-xs bg-muted rounded px-2 py-1"
                          >
                            <Lock
                              size={10}
                              className="text-muted-foreground shrink-0"
                            />
                            <span className="font-mono text-muted-foreground shrink-0">
                              T-{dep.blocker?.taskNumber ?? "?"}
                            </span>
                            <span className="flex-1 truncate">
                              {dep.blocker?.title}
                            </span>
                            <button
                              onClick={() => removeDependency.mutate(dep.id)}
                              className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {deps.blocking.length > 0 && (
                    <div>
                      <p className="text-[11px] text-muted-foreground mb-1">
                        Bloquea
                      </p>
                      <div className="space-y-1">
                        {deps.blocking.map((dep) => (
                          <div
                            key={dep.id}
                            className="flex items-center gap-1.5 text-xs bg-muted rounded px-2 py-1"
                          >
                            <span className="font-mono text-muted-foreground shrink-0">
                              T-{dep.blocked?.taskNumber ?? "?"}
                            </span>
                            <span className="flex-1 truncate">
                              {dep.blocked?.title}
                            </span>
                            <button
                              onClick={() => removeDependency.mutate(dep.id)}
                              className="text-muted-foreground hover:text-destructive transition-colors shrink-0"
                            >
                              <X size={10} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {deps.blockedBy.length === 0 &&
                    deps.blocking.length === 0 &&
                    !depPickerOpen && (
                      <p className="text-xs text-muted-foreground">
                        Sin dependencias.
                      </p>
                    )}
                </div>

                <MarkdownField
                  label="Descripcion"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={handleDescriptionBlur}
                  placeholder="Agrega una descripcion... (**negrita**, *italica*, # encabezado)"
                />

                {/* Campos personalizados */}
                {fieldValues.length > 0 && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 block">
                      Campos
                    </label>
                    <div className="space-y-3">
                      {fieldValues.map((entry) => {
                        const field = entry.field ?? {};
                        const fid = field.id ?? entry.fieldId;
                        const val = localFieldValues[fid] ?? "";

                        const saveFieldValue = (newVal) => {
                          const trimmed =
                            typeof newVal === "string" ? newVal.trim() : newVal;
                          setLocalFieldValues((prev) => ({
                            ...prev,
                            [fid]: trimmed ?? "",
                          }));
                          upsertFieldValues.mutate([
                            { fieldId: fid, value: trimmed || null },
                          ]);
                        };

                        if (field.kind === "SELECT") {
                          const opts = (field.options ?? []).map((o) => ({
                            value: o,
                            label: o,
                          }));
                          return (
                            <SelectField
                              key={fid}
                              label={field.name}
                              value={val || ""}
                              onValueChange={saveFieldValue}
                              options={[
                                { value: "", label: "— Sin seleccionar" },
                                ...opts,
                              ]}
                            />
                          );
                        }

                        if (field.kind === "DATE") {
                          return (
                            <DatePickerField
                              key={fid}
                              label={field.name}
                              value={val || null}
                              onChange={(d) => saveFieldValue(d || null)}
                            />
                          );
                        }

                        return (
                          <div key={fid}>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1 block">
                              {field.name}
                            </label>
                            <Input
                              type={field.kind === "NUMBER" ? "number" : "text"}
                              value={val}
                              onChange={(e) =>
                                setLocalFieldValues((prev) => ({
                                  ...prev,
                                  [fid]: e.target.value,
                                }))
                              }
                              onBlur={() => saveFieldValue(val)}
                              placeholder={`Ingresar ${field.name?.toLowerCase() ?? "valor"}...`}
                              className="h-8 text-sm"
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Subtareas */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">
                    Subtareas ({subtasks.length})
                  </label>
                  <div className="space-y-0.5">
                    {subtasks.map((sub) => (
                      <SubtaskRow
                        key={sub.id}
                        task={sub}
                        projectId={projectId}
                        onDelete={handleDeleteSubtask}
                        onOpen={onOpenTask}
                      />
                    ))}
                  </div>
                  <form onSubmit={handleAddSubtask} className="mt-2 flex gap-2">
                    <Input
                      value={newSubtask}
                      onChange={(e) => setNewSubtask(e.target.value)}
                      placeholder="Nueva subtarea..."
                      className="flex-1"
                    />
                    <Button
                      size="sm"
                      type="submit"
                      disabled={!newSubtask.trim()}
                    >
                      <Plus size={14} />
                    </Button>
                  </form>
                </div>

                {/* Archivos */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2 block">
                    Archivos
                  </label>
                  <AttachmentsPanel
                    apiBaseUrl={API_BASE_URL}
                    token={token}
                    recordId={task.id}
                    config={attachmentsConfig}
                    context="detail"
                    showHeading={false}
                    prefetchedData={Array.isArray(taskFilesData) ? taskFilesData : taskFilesData?.data}
                  />
                </div>

                {/* Actividad + Comentarios (feed cronologico) */}
                <div>
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 block">
                    Actividad
                  </label>

                  <div className="space-y-3 mb-4">
                    {feedItems.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Sin actividad aun.
                      </p>
                    )}
                    {feedItems.map((item) => {
                      if (item.kind === "event") {
                        const ev = item.data;
                        return (
                          <div
                            key={`ev-${ev.id}`}
                            className="flex items-center gap-2 py-0.5"
                          >
                            <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                              <Activity
                                size={11}
                                className="text-muted-foreground"
                              />
                            </div>
                            <span className="text-xs text-muted-foreground flex-1 min-w-0">
                              {ev.summary}
                            </span>
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {formatDate(ev.createdAt)}
                            </span>
                          </div>
                        );
                      }

                      const comment = item.data;
                      const authorName =
                        [
                          comment.author?.firstName,
                          comment.author?.lastName,
                        ]
                          .filter(Boolean)
                          .join(" ") ||
                        comment.author?.email ||
                        "Usuario";
                      const isAuthor = comment.authorId === userId;
                      const isEditing = editingCommentId === comment.id;

                      const commentReactions = groupReactions(comment.reactions ?? [], userId);
                      return (
                        <div
                          key={`cm-${comment.id}`}
                          className={`flex gap-2 group transition-opacity${comment._pending ? " opacity-60" : ""}`}
                        >
                          <AssigneeAvatar
                            user={comment.author ?? {}}
                            size="sm"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-col gap-0.5 mb-0.5">
                              <span className="text-xs font-medium leading-tight">
                                {authorName}
                              </span>
                              <div className="flex items-center gap-1.5">
                                {comment._pending ? (
                                  <span className="text-[10px] text-muted-foreground">Enviando...</span>
                                ) : (
                                  <span className="text-[10px] text-muted-foreground">
                                    {formatDate(comment.createdAt)}
                                  </span>
                                )}
                                {!comment._pending && comment.editedAt && (
                                  <span className="text-[10px] text-muted-foreground">
                                    (editado)
                                  </span>
                                )}
                              </div>
                            </div>
                            {isEditing ? (
                              <div className="space-y-1.5">
                                <MentionTextarea
                                  value={editingBody}
                                  onChange={setEditingBody}
                                  members={mentionMembers}
                                  rows={2}
                                  portalContainer={floatingLayer}
                                />
                                <div className="flex gap-1.5">
                                  <Button
                                    size="sm"
                                    onClick={handleSaveEdit}
                                    disabled={!editingBody.trim()}
                                  >
                                    Guardar
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setEditingCommentId(null)}
                                  >
                                    Cancelar
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <p className="text-sm text-foreground whitespace-pre-wrap">
                                {renderMentionText(comment.body)}
                              </p>
                            )}
                            {/* Reactions */}
                            {!isEditing && (
                              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                                {commentReactions.map((r) => (
                                  <Tooltip key={r.emoji}>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        onClick={() => toggleReaction.mutate({ commentId: comment.id, emoji: r.emoji })}
                                        disabled={toggleReaction.isPending}
                                        className={[
                                          "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs transition-colors",
                                          "disabled:cursor-not-allowed disabled:opacity-60",
                                          r.isMine
                                            ? "border-indigo-500/60 bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/25"
                                            : "border-border bg-muted/40 text-muted-foreground hover:bg-muted",
                                        ].join(" ")}
                                      >
                                        <span>{r.emoji}</span>
                                        <span>{r.count}</span>
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top">
                                      <p className="text-xs">{r.users.join(", ")}</p>
                                    </TooltipContent>
                                  </Tooltip>
                                ))}
                                <EmojiPicker onSelect={(emoji) => toggleReaction.mutate({ commentId: comment.id, emoji })} />
                              </div>
                            )}
                          </div>
                          {!isEditing && isAuthor && (
                            <div className="flex gap-1 opacity-30 md:opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                              <button
                                onClick={() => handleEditComment(comment)}
                                className="text-muted-foreground hover:text-foreground text-xs px-1"
                              >
                                Editar
                              </button>
                              <button
                                onClick={() => setDeleteCommentId(comment.id)}
                                className="text-muted-foreground hover:text-destructive text-xs px-1"
                              >
                                <Trash2 size={11} />
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="space-y-2">
                    <MentionTextarea
                      value={commentBody}
                      onChange={setCommentBody}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey))
                          handleSubmitComment();
                      }}
                      members={mentionMembers}
                      rows={2}
                      placeholder="Escribe un comentario... (@ para mencionar, Ctrl+Enter para enviar)"
                      portalContainer={floatingLayer}
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={handleSubmitComment}
                        disabled={!commentBody.trim() || createComment.isPending}
                      >
                        Comentar
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Eliminar tarea"
        description="Se eliminara la tarea y todas sus subtareas. Esta accion no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={handleDelete}
      />
      <ConfirmDialog
        open={Boolean(deleteCommentId)}
        onOpenChange={(open) => {
          if (!open) setDeleteCommentId(null);
        }}
        title="Eliminar comentario"
        description="Esta accion no se puede deshacer."
        confirmLabel="Eliminar"
        onConfirm={handleDeleteComment}
      />
    </>
  );
}
