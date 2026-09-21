import { useState, useMemo, useRef, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  LayoutGrid,
  List,
  Calendar,
  Settings2,
  Users,
  Menu,
  X,
  SlidersHorizontal,
  Download,
  MessageSquare,
  MoreVertical,
  Pencil,
} from "lucide-react";
import {
  Button, Badge, EmptyState, ErrorState, LoadingState,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
} from "@runly/ui";
import { useProjects, useWorkspaceUsers } from "../hooks/useProjectsData";
import { useProjectRealtime } from "../hooks/useProjectRealtime";
import { runly } from "../../../lib/runly";
import { useAuth } from "../../../auth/AuthProvider";
import { toast } from "sonner";
import { getProjectIcon } from "../lib/projectIcons.js";
import { UserAvatarContext } from "../lib/UserAvatarContext.js";
import KanbanView from "../components/KanbanView.jsx";
import ListView from "../components/ListView.jsx";
import TimelineView from "../components/TimelineView.jsx";
import TaskDetailPanel from "../components/TaskDetailPanel.jsx";
import ProjectFormModal from "../components/ProjectFormModal.jsx";
import TaskFormModal from "../components/TaskFormModal.jsx";
import StatusEditor from "../components/StatusEditor.jsx";
import MembersPanel from "../components/MembersPanel.jsx";
import ProjectFieldsSheet from "../components/ProjectFieldsSheet.jsx";

const VIEWS = [
  { key: "kanban", label: "Kanban", Icon: LayoutGrid },
  { key: "list", label: "Lista", Icon: List },
  { key: "timeline", label: "Timeline", Icon: Calendar },
];

const LIFECYCLE_BADGE = {
  ACTIVE: { label: "Activo", variant: "success" },
  COMPLETED: { label: "Completado", variant: "secondary" },
  ARCHIVED: { label: "Archivado", variant: "outline" },
};

export default function ProjectsScreen() {
  const { data: projects, isLoading, isError, error } = useProjects();
  const { data: workspaceUsersData } = useWorkspaceUsers();
  const avatarMap = useMemo(() => {
    const users = workspaceUsersData?.data ?? workspaceUsersData ?? [];
    return new Map(users.map((u) => [u.id, u.avatarUrl ?? null]));
  }, [workspaceUsersData]);
  const [selectedId, _setSelectedId] = useState(
    () => localStorage.getItem("runly.projects.selectedId") ?? null
  );
  function setSelectedId(id) {
    _setSelectedId(id);
    if (id) localStorage.setItem("runly.projects.selectedId", id);
    else localStorage.removeItem("runly.projects.selectedId");
  }
  const [activeView, setActiveView] = useState("kanban");
  const [taskPanelId, setTaskPanelId] = useState(null);
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [statusEditorOpen, setStatusEditorOpen] = useState(false);
  const [taskFormOpen, setTaskFormOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [fieldsSheetOpen, setFieldsSheetOpen] = useState(false);

  const [searchParams, setSearchParams] = useSearchParams();

  // Capture the deep-link value on first render before clearing the URL.
  const initialOpenRef = useRef(searchParams.get("open") ?? null);

  // Clear ?open from the URL immediately so back-navigation doesn't re-trigger.
  useEffect(() => {
    if (searchParams.has("open")) {
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Process deep link: tasks open immediately; projects wait for the list to load.
  useEffect(() => {
    const open = initialOpenRef.current;
    if (!open) return;

    if (open.startsWith("task:")) {
      const taskId = open.slice("task:".length);
      if (taskId) {
        initialOpenRef.current = null;
        openTask(taskId);
      }
      return;
    }

    if (open.startsWith("project:") && !isLoading) {
      const projectId = open.slice("project:".length);
      if (projectId) {
        initialOpenRef.current = null;
        setSelectedId(projectId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const projectList = projects?.data ?? projects ?? [];
  const selectedProject =
    projectList.find((p) => p.id === selectedId) ?? projectList[0] ?? null;
  const effectiveId = selectedProject?.id ?? null;

  useProjectRealtime(effectiveId);

  const linkedChannelQuery = useQuery({
    queryKey: ["project-linked-channel", effectiveId],
    queryFn: async () => {
      const res = await runly.chat.getLinkedChannel("runly.projects", effectiveId, token);
      return res?.data ?? null;
    },
    enabled: Boolean(effectiveId && token),
    staleTime: 30_000,
  });

  const createChannelMutation = useMutation({
    mutationFn: async () => {
      // GET /projects/:id/members returns a raw array, not { data: [...] }.
      const membersRes = await runly.projects.listMembers(effectiveId, token);
      const memberUserIds = (membersRes?.data ?? membersRes ?? [])
        .map((m) => m.userId)
        .filter(Boolean);
      return runly.chat.createChannel(
        {
          title: selectedProject?.name ?? "Proyecto",
          linkedModule: "runly.projects",
          linkedEntityId: effectiveId,
          memberUserIds,
        },
        token
      );
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["project-linked-channel", effectiveId] });
      queryClient.invalidateQueries({ queryKey: ["chat-conversations"] });
      const conversationId = res?.data?.id;
      if (conversationId) navigate(`/app/m/runly.chat/chat/inbox/${conversationId}`);
    },
    onError: () => toast.error("No se pudo crear el canal."),
  });

  function handleChatChannelClick() {
    const existing = linkedChannelQuery.data;
    if (existing?.id) {
      navigate(`/app/m/runly.chat/chat/inbox/${existing.id}`);
    } else {
      createChannelMutation.mutate();
    }
  }

  async function handleExport() {
    if (!effectiveId) return;
    try {
      const blob = await runly.projects.exportProjectCsv(effectiveId, session?.access_token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `proyecto-tareas.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("No se pudo exportar el proyecto");
    }
  }

  function openTask(taskId) {
    setTaskPanelId(taskId);
  }
  function closeTask() {
    setTaskPanelId(null);
  }
  function closeSidebar() {
    setSidebarOpen(false);
  }

  if (isLoading)
    return <LoadingState variant="page" message="Cargando proyectos..." />;

  if (isError) {
    return (
      <ErrorState
        title="No se pudo cargar Proyectos"
        message={error?.message}
      />
    );
  }

  return (
    <UserAvatarContext.Provider value={avatarMap}>
      <div className="flex h-full min-h-0 relative">
        {/* Mobile backdrop */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-10 bg-black/40 lg:hidden"
            onClick={closeSidebar}
          />
        )}

        {/* Project list sidebar */}
        <aside
          className={[
            "w-60 shrink-0 border-r border-border flex flex-col bg-background",
            "transition-transform duration-200 ease-in-out",
            // Mobile: fixed drawer — avoids overflow-x-clip clipping on the main scroll container
            "fixed top-14 left-0 bottom-0 z-20",
            // Desktop: always visible as a normal flex child
            "lg:static lg:z-auto lg:translate-x-0",
            sidebarOpen
              ? "translate-x-0"
              : "-translate-x-full lg:translate-x-0",
          ].join(" ")}
        >
          <div className="flex items-center justify-between px-3 pt-4 pb-2">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Proyectos
            </span>
            <button
              onClick={closeSidebar}
              className="lg:hidden text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={14} />
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-2 space-y-0.5">
            {projectList.length === 0 && (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                Sin proyectos
              </p>
            )}
            {projectList.map((p) => {
              const ProjIcon = getProjectIcon(p.icon);
              const isActive = p.id === effectiveId;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedId(p.id);
                    closeSidebar();
                  }}
                  className={[
                    "w-full text-left px-2 py-1.5 rounded text-sm flex items-center gap-2 transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  ].join(" ")}
                >
                  <span
                    className="inline-flex w-5 h-5 rounded items-center justify-center shrink-0"
                    style={{ background: p.color ?? "#6366f1" }}
                  >
                    <ProjIcon size={11} className="text-white" />
                  </span>
                  <span className="truncate flex-1">{p.name}</span>
                </button>
              );
            })}
          </nav>
          <div className="p-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground text-xs"
              onClick={() => {
                setEditingProject(null);
                setProjectFormOpen(true);
              }}
            >
              <Plus size={14} className="mr-1" />
              Nuevo proyecto
            </Button>
          </div>
        </aside>

        {/* Main area */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {!selectedProject ? (
            <div className="relative flex-1 flex flex-col">
              <div className="px-4 py-3 lg:hidden border-b border-border">
                <button
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setSidebarOpen(true)}
                >
                  <Menu size={16} />
                </button>
              </div>
              <EmptyState
                title="Sin proyectos"
                description="Crea tu primer proyecto para empezar a gestionar tareas."
                action={{
                  label: "Nuevo proyecto",
                  onClick: () => {
                    setEditingProject(null);
                    setProjectFormOpen(true);
                  },
                }}
              />
            </div>
          ) : (
            <>
              {/* Project header */}
              <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
                {/* Mobile hamburger */}
                <button
                  className="lg:hidden text-muted-foreground hover:text-foreground transition-colors shrink-0"
                  onClick={() => setSidebarOpen(true)}
                >
                  <Menu size={16} />
                </button>

                {/* Project icon + name */}
                <ProjectBadge project={selectedProject} />
                <div className="flex-1 min-w-0">
                  <h1 className="text-sm font-semibold leading-tight truncate">
                    {selectedProject.name}
                  </h1>
                </div>

                <Badge
                  variant={
                    LIFECYCLE_BADGE[selectedProject.status]?.variant ??
                    "secondary"
                  }
                  className="text-xs hidden sm:inline-flex"
                >
                  {LIFECYCLE_BADGE[selectedProject.status]?.label ??
                    selectedProject.status}
                </Badge>

                <Button
                  variant="ghost"
                  size="icon"
                  title="Miembros"
                  onClick={() => setMembersOpen(true)}
                >
                  <Users size={15} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden sm:flex"
                  onClick={handleChatChannelClick}
                  disabled={createChannelMutation.isPending || linkedChannelQuery.isLoading}
                  title={linkedChannelQuery.data?.id ? "Ir al canal" : "Crear canal de chat"}
                >
                  <MessageSquare size={15} className="mr-1" />
                  {linkedChannelQuery.data?.id ? "Ir al canal" : "Crear canal"}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Gestionar columnas"
                  className="hidden sm:flex"
                  onClick={() => setStatusEditorOpen(true)}
                >
                  <Settings2 size={15} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Campos personalizados"
                  className="hidden sm:flex"
                  onClick={() => setFieldsSheetOpen(true)}
                >
                  <SlidersHorizontal size={15} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Exportar CSV"
                  className="hidden sm:flex"
                  onClick={handleExport}
                >
                  <Download size={15} />
                </Button>
                <Button size="sm" onClick={() => setTaskFormOpen(true)}>
                  <Plus size={13} className="mr-1 hidden sm:inline" />
                  <span className="hidden sm:inline">Nueva tarea</span>
                  <Plus size={13} className="sm:hidden" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="hidden sm:flex"
                  onClick={() => {
                    setEditingProject(selectedProject);
                    setProjectFormOpen(true);
                  }}
                >
                  Editar
                </Button>

                {/* Mobile: actions hidden above on desktop collapse into this menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="sm:hidden" title="Mas acciones">
                      <MoreVertical size={15} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() => {
                        setEditingProject(selectedProject);
                        setProjectFormOpen(true);
                      }}
                    >
                      <Pencil size={14} className="mr-2" />
                      Editar proyecto
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setStatusEditorOpen(true)}>
                      <Settings2 size={14} className="mr-2" />
                      Gestionar columnas
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setFieldsSheetOpen(true)}>
                      <SlidersHorizontal size={14} className="mr-2" />
                      Campos personalizados
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={handleExport}>
                      <Download size={14} className="mr-2" />
                      Exportar CSV
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={handleChatChannelClick}
                      disabled={createChannelMutation.isPending || linkedChannelQuery.isLoading}
                    >
                      <MessageSquare size={14} className="mr-2" />
                      {linkedChannelQuery.data?.id ? "Ir al canal" : "Crear canal de chat"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                {/* View switcher */}
                <div className="flex gap-0.5 border border-border rounded-md p-0.5">
                  {VIEWS.map(({ key, label, Icon }) => (
                    <button
                      key={key}
                      onClick={() => setActiveView(key)}
                      title={label}
                      className={[
                        "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
                        activeView === key
                          ? "bg-background text-foreground shadow-sm ring-1 ring-border/60 font-medium"
                          : "text-muted-foreground hover:text-foreground",
                      ].join(" ")}
                    >
                      <Icon size={13} />
                      <span className="hidden md:inline">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Active view */}
              <div className="flex-1 min-h-0 overflow-hidden">
                {activeView === "kanban" && (
                  <KanbanView
                    projectId={effectiveId}
                    onTaskClick={openTask}
                    showSubtasks
                  />
                )}
                {activeView === "list" && (
                  <ListView
                    projectId={effectiveId}
                    onTaskClick={openTask}
                    showSubtasks
                  />
                )}
                {activeView === "timeline" && (
                  <TimelineView
                    projectId={effectiveId}
                    onTaskClick={openTask}
                    showSubtasks
                  />
                )}
              </div>
            </>
          )}
        </main>

        {/* Task detail panel */}
        {taskPanelId && (
          <TaskDetailPanel
            projectId={effectiveId}
            taskId={taskPanelId}
            onClose={closeTask}
            onOpenTask={openTask}
          />
        )}

        <ProjectFormModal
          open={projectFormOpen}
          onOpenChange={setProjectFormOpen}
          project={editingProject}
          onCreated={(p) => setSelectedId(p.id)}
          onArchived={() => setSelectedId(null)}
        />

        {effectiveId && (
          <TaskFormModal
            open={taskFormOpen}
            onOpenChange={setTaskFormOpen}
            projectId={effectiveId}
          />
        )}

        {selectedProject && (
          <StatusEditor
            open={statusEditorOpen}
            onOpenChange={setStatusEditorOpen}
            projectId={effectiveId}
          />
        )}

        {selectedProject && (
          <MembersPanel
            open={membersOpen}
            onOpenChange={setMembersOpen}
            projectId={effectiveId}
          />
        )}

        {selectedProject && (
          <ProjectFieldsSheet
            open={fieldsSheetOpen}
            onOpenChange={setFieldsSheetOpen}
            projectId={effectiveId}
          />
        )}
      </div>
    </UserAvatarContext.Provider>
  );
}

function ProjectBadge({ project }) {
  const ProjIcon = getProjectIcon(project.icon);
  return (
    <span
      className="w-6 h-6 rounded flex items-center justify-center shrink-0"
      style={{ background: project.color ?? "#6366f1" }}
    >
      <ProjIcon size={13} className="text-white" />
    </span>
  );
}
