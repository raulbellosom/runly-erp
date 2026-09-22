import { useState, useEffect, useRef } from "react";
import { EmptyState, Skeleton, Badge, renderMentionText } from "@runly/ui";
import { MessageSquare, Search, ExternalLink, Clock, UserCheck, ChevronDown } from "lucide-react";
import { ChatWindow } from "../components/ChatWindow";
import { useExternalInbox } from "../hooks/useExternalInbox";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";

// ------------------------------------------------------------------
// Utilities
// ------------------------------------------------------------------

function formatRelative(date) {
  if (!date) return "";
  const d = new Date(date);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "ahora";
  if (diffMin < 60) return `hace ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `hace ${diffH}h`;
  const diffD = Math.floor(diffH / 24);
  if (diffD === 1) return "ayer";
  if (diffD < 7) return d.toLocaleDateString("es-MX", { weekday: "short" });
  return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
}

function formatExact(date) {
  if (!date) return "";
  return new Date(date).toLocaleString("es-MX", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
}

// ------------------------------------------------------------------
// Conversation list item
// ------------------------------------------------------------------

const STATUS_OPTIONS = [
  { value: "open", label: "Abiertos" },
  { value: "pending", label: "Pendientes" },
  { value: "closed", label: "Cerrados" },
];

function ExternalConversationItem({ conv, isActive, onClick }) {
  const name = conv.guest_name ?? conv.guest_email ?? "Visitante";
  const unread = conv.unread_count ?? 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "w-full flex items-start gap-3 px-3 py-2.5 rounded-xl text-left transition-colors touch-manipulation",
        isActive
          ? "bg-[hsl(var(--primary)/0.1)] text-[hsl(var(--primary))]"
          : "hover:bg-[hsl(var(--muted))]",
      ].join(" ")}
    >
      <div className="relative shrink-0">
        <div className="h-9 w-9 rounded-full bg-violet-100 dark:bg-violet-900 flex items-center justify-center text-sm font-semibold text-violet-600 dark:text-violet-300 uppercase">
          {name[0]}
        </div>
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 h-4 min-w-4 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center px-1 ring-2 ring-[hsl(var(--background))]">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className={["text-sm truncate", unread > 0 ? "font-semibold" : "font-medium"].join(" ")}>{name}</p>
          <span className="text-[10px] text-[hsl(var(--muted-foreground))] shrink-0 tabular-nums">
            {formatRelative(conv.last_message?.createdAt ?? conv.created_at)}
          </span>
        </div>
        {conv.tracking_code && (
          <p className="text-[9px] font-mono font-semibold text-[hsl(var(--primary))] opacity-60 mt-0.5 tracking-wide">
            {conv.tracking_code}
          </p>
        )}
        {conv.guest_page_url && (
          <p className="text-[10px] text-[hsl(var(--muted-foreground))] truncate mt-0.5">
            {conv.guest_page_url.replace(/^https?:\/\//, "")}
          </p>
        )}
        {conv.last_message?.body && (
          <p className={["text-xs truncate mt-0.5", unread > 0 ? "text-[hsl(var(--foreground))]" : "text-[hsl(var(--muted-foreground))]"].join(" ")}>
            {renderMentionText(conv.last_message.body)}
          </p>
        )}
      </div>
    </button>
  );
}

// ------------------------------------------------------------------
// Session expiry countdown
// ------------------------------------------------------------------

function useExpiryCountdown(idleExpiresAt) {
  const [remaining, setRemaining] = useState("");

  useEffect(() => {
    if (!idleExpiresAt) return;
    function update() {
      const diffMs = new Date(idleExpiresAt) - new Date();
      if (diffMs <= 0) { setRemaining("Expirada"); return; }
      const mins = Math.floor(diffMs / 60000);
      const secs = Math.floor((diffMs % 60000) / 1000);
      setRemaining(mins > 0 ? `${mins}m ${secs}s` : `${secs}s`);
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [idleExpiresAt]);

  return remaining;
}

// ------------------------------------------------------------------
// Operator reassignment dropdown
// ------------------------------------------------------------------

function ReassignDropdown({ conversationId, currentUserId, onReassigned }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  const { data } = useQuery({
    queryKey: ["chat-available-operators"],
    queryFn: () => runly.chat.listAvailableOperators(token),
    enabled: open && Boolean(token),
    staleTime: 30_000,
  });

  const { mutate, isPending } = useMutation({
    mutationFn: (userId) => runly.chat.assignOperator(conversationId, userId, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-external-inbox"] });
      setOpen(false);
      onReassigned?.();
    },
  });

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e) {
      if (!containerRef.current?.contains(e.target)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const operators = data?.data ?? [];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        className="flex items-center gap-1 text-xs text-[hsl(var(--primary))] hover:underline"
      >
        <UserCheck className="h-3 w-3 shrink-0" />
        <span>Reasignar</span>
        <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute top-full mt-1 left-0 z-50 w-52 rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] shadow-xl overflow-hidden">
          {operators.length === 0 && (
            <p className="text-xs text-[hsl(var(--muted-foreground))] px-3 py-4 text-center">
              Sin operadores disponibles.
            </p>
          )}
          {operators.map((op) => (
            <button
              key={op.id}
              type="button"
              onClick={() => mutate(op.id)}
              className={[
                "w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-[hsl(var(--muted))] transition-colors text-left",
                op.id === currentUserId ? "text-[hsl(var(--primary))]" : "",
              ].join(" ")}
            >
              <div className="h-6 w-6 rounded-full bg-[hsl(var(--muted))] flex items-center justify-center text-[10px] font-semibold shrink-0 uppercase">
                {(op.displayName ?? op.email ?? "?")[0]}
              </div>
              <span className="truncate">{op.displayName ?? op.email ?? "Operador"}</span>
              {op.id === currentUserId && <span className="ml-auto text-[9px] opacity-60">actual</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// Visitor info panel (right column) — desktop only
// ------------------------------------------------------------------

function VisitorInfoPanel({ conversation, onReassigned }) {
  if (!conversation) return null;
  const name = conversation.guest_name ?? conversation.guest_email ?? "Visitante";
  const email = conversation.guest_email;
  const pageUrl = conversation.guest_page_url;
  const createdAt = conversation.created_at;
  const trackingCode = conversation.tracking_code ?? null;
  const idleExpiresAt = conversation.idle_expires_at ?? conversation.idleExpiresAt;
  const countdown = useExpiryCountdown(conversation.status !== "closed" ? idleExpiresAt : null);

  return (
    <aside className="hidden lg:flex w-64 shrink-0 border-l border-[hsl(var(--border))] bg-[hsl(var(--surface-2))] flex-col overflow-y-auto">
      <div className="p-4 space-y-4">
        {/* Guest identity */}
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] font-medium mb-2">Visitante</p>
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-full bg-violet-100 dark:bg-violet-900 flex items-center justify-center text-sm font-semibold text-violet-600 dark:text-violet-300 uppercase shrink-0">
              {name[0]}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium truncate">{name}</p>
              {email && <p className="text-xs text-[hsl(var(--muted-foreground))] truncate">{email}</p>}
            </div>
          </div>
        </div>

        {/* Tracking code */}
        {trackingCode && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] font-medium mb-1">Numero de seguimiento</p>
            <p className="text-sm font-mono font-semibold text-[hsl(var(--primary))] tracking-wide select-all">
              {trackingCode}
            </p>
          </div>
        )}

        {/* Source URL */}
        {pageUrl && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] font-medium mb-1">Pagina de origen</p>
            <a
              href={pageUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-[hsl(var(--primary))] hover:underline"
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">{pageUrl.replace(/^https?:\/\//, "")}</span>
            </a>
          </div>
        )}

        {/* Session start */}
        {createdAt && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] font-medium mb-1">Inicio de sesion</p>
            <div className="flex items-center gap-1 text-xs text-[hsl(var(--muted-foreground))]">
              <Clock className="h-3 w-3 shrink-0" />
              <span>{formatExact(createdAt)}</span>
            </div>
          </div>
        )}

        {/* Idle expiry countdown */}
        {countdown && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] font-medium mb-1">Sesion expira en</p>
            <div className={[
              "flex items-center gap-1 text-xs font-mono tabular-nums",
              countdown === "Expirada" ? "text-red-400" : "text-amber-400",
            ].join(" ")}>
              <Clock className="h-3 w-3 shrink-0" />
              <span>{countdown}</span>
            </div>
          </div>
        )}

        {/* Status */}
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] font-medium mb-1">Estado</p>
          <Badge variant={conversation.status === "closed" ? "secondary" : conversation.status === "pending" ? "warning" : "success"}>
            {conversation.status === "open" ? "Abierta" : conversation.status === "pending" ? "Pendiente" : "Cerrada"}
          </Badge>
        </div>

        {/* Guest read receipt */}
        <div>
          <p className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] font-medium mb-1">Lectura del visitante</p>
          <p className="text-xs text-[hsl(var(--muted-foreground))]">
            {conversation.guest_last_read_at
              ? `Visto ${formatRelative(conversation.guest_last_read_at)}`
              : "Aun no leido"}
          </p>
        </div>

        {/* Operator reassignment */}
        {conversation.status !== "closed" && (
          <div>
            <p className="text-[10px] uppercase tracking-wide text-[hsl(var(--muted-foreground))] font-medium mb-1">Operador asignado</p>
            <ReassignDropdown
              conversationId={conversation.id}
              currentUserId={conversation.assigned_user_id ?? conversation.assignedUserId}
              onReassigned={onReassigned}
            />
          </div>
        )}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------
// Main screen
// ------------------------------------------------------------------

export function ExternalInboxScreen() {
  const [statusFilter, setStatusFilter] = useState("open");
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [isAvailable, setIsAvailable] = useState(false);
  const [togglingAvailability, setTogglingAvailability] = useState(false);
  // "list" | "chat" — only matters on mobile (<md)
  const [mobileView, setMobileView] = useState("list");

  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof userProfile?.availableForChat === "boolean") {
      setIsAvailable(userProfile.availableForChat);
    }
  }, [userProfile?.availableForChat]);

  // Debounce search to avoid firing on every keystroke
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Search is server-side: includes tracking_code, email, name
  const { data, isLoading } = useExternalInbox(statusFilter, debouncedSearch || null);
  const filtered = data?.data ?? [];

  async function handleToggleAvailability() {
    if (!token) return;
    setTogglingAvailability(true);
    try {
      const next = !isAvailable;
      await runly.chat.toggleAvailability(next, token);
      setIsAvailable(next);
    } catch { /* non-fatal */ }
    finally { setTogglingAvailability(false); }
  }

  function handleSelectConversation(conv) {
    setSelected(conv);
    setMobileView("chat");
  }

  function handleBack() {
    setMobileView("list");
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar — compact on mobile */}
      <div className="shrink-0 px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between gap-3 border-b border-[hsl(var(--border))]">
        <div className="min-w-0">
          <h1 className="text-base sm:text-lg font-semibold tracking-tight truncate">Bandeja externa</h1>
          <p className="hidden sm:block text-xs text-[hsl(var(--muted-foreground))]">Conversaciones de soporte en vivo</p>
        </div>
        <button
          type="button"
          onClick={handleToggleAvailability}
          disabled={togglingAvailability}
          className={[
            "shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-colors border",
            isAvailable
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20"
              : "bg-[hsl(var(--muted))] border-[hsl(var(--border))] text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--muted)/0.8)]",
          ].join(" ")}
          title={isAvailable ? "Disponible — clic para desactivar" : "No disponible — clic para activar"}
        >
          <span className={["w-1.5 h-1.5 rounded-full", isAvailable ? "bg-emerald-400" : "bg-[hsl(var(--muted-foreground))]"].join(" ")} />
          <span className="hidden xs:inline">{isAvailable ? "Disponible" : "No disponible"}</span>
          <span className="xs:hidden">{isAvailable ? "Activo" : "Inactivo"}</span>
        </button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left: conversation list — full width on mobile when mobileView === "list", fixed w on desktop */}
        <aside className={[
          "flex flex-col shrink-0 border-r border-[hsl(var(--border))] bg-[hsl(var(--surface-2))]",
          "w-full md:w-72",
          mobileView === "chat" ? "hidden md:flex" : "flex",
        ].join(" ")}>
          {/* Search */}
          <div className="px-3 py-2 border-b border-[hsl(var(--border))]">
            <div className="flex items-center gap-2 bg-[hsl(var(--muted))] rounded-lg px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 text-[hsl(var(--muted-foreground))] shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-[hsl(var(--muted-foreground))]"
              />
            </div>
          </div>

          {/* Status tabs */}
          <div className="flex border-b border-[hsl(var(--border))] shrink-0">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setStatusFilter(opt.value)}
                className={[
                  "flex-1 py-2 text-xs font-medium transition-colors",
                  statusFilter === opt.value
                    ? "text-[hsl(var(--primary))] border-b-2 border-[hsl(var(--primary))]"
                    : "text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]",
                ].join(" ")}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
            {isLoading && Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-2 py-2">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-3 w-28" />
                  <Skeleton className="h-2.5 w-40" />
                </div>
              </div>
            ))}
            {!isLoading && filtered.length === 0 && (
              <EmptyState
                className="py-8"
                title="Sin conversaciones"
                description={search ? "Sin resultados para tu busqueda." : `No hay conversaciones ${statusFilter === "open" ? "abiertas" : statusFilter === "pending" ? "pendientes" : "cerradas"}.`}
              />
            )}
            {filtered.map((conv) => (
              <ExternalConversationItem
                key={conv.id}
                conv={conv}
                isActive={selected?.id === conv.id}
                onClick={() => handleSelectConversation(conv)}
              />
            ))}
          </div>
        </aside>

        {/* Center: chat pane — full width on mobile when mobileView === "chat" */}
        <div className={[
          "flex flex-1 min-w-0 min-h-0",
          mobileView === "list" ? "hidden md:flex" : "flex",
        ].join(" ")}>
          {selected ? (
            <ChatWindow
              key={selected.id}
              conversation={selected}
              variant="external"
              onClose={handleBack}
              onConversationUpdate={(patch) =>
                setSelected((prev) => (prev ? { ...prev, ...patch } : prev))
              }
            />
          ) : (
            <div className="flex-1 hidden md:flex items-center justify-center text-[hsl(var(--muted-foreground))]">
              <div className="text-center space-y-3">
                <div className="mx-auto h-14 w-14 rounded-2xl bg-[hsl(var(--muted))] flex items-center justify-center">
                  <MessageSquare className="h-7 w-7 text-[hsl(var(--primary)/0.4)]" />
                </div>
                <p className="text-sm">Selecciona una conversacion</p>
              </div>
            </div>
          )}
        </div>

        {/* Right: visitor info — desktop only (lg+) */}
        <VisitorInfoPanel
          conversation={selected}
          onReassigned={() => queryClient.invalidateQueries({ queryKey: ["chat-external-inbox"] })}
        />
      </div>
    </div>
  );
}
