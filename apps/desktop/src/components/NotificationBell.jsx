import { useEffect, useState } from "react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";
import {
  Bell,
  BellOff,
  Info,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from "@runly/ui";
import { runly } from "../lib/runly";
import { getSystemNotificationPermission, isTauriRuntime } from "../lib/systemNotifications";
import { isWebPushSupported } from "../lib/webPush";
import { useNotificationSoundStore } from "../stores/notificationSound";

function timeAgo(date) {
  const diff = Date.now() - new Date(date).getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `hace ${days} día${days !== 1 ? "s" : ""}`;
  if (hours > 0) return `hace ${hours} hora${hours !== 1 ? "s" : ""}`;
  if (minutes > 0) return `hace ${minutes} minuto${minutes !== 1 ? "s" : ""}`;
  return "hace un momento";
}

const KIND_ICONS = {
  info: Info,
  warning: AlertTriangle,
  error: AlertCircle,
  success: CheckCircle2,
};

const KIND_COLORS = {
  info: "#3b82f6",
  warning: "#f59e0b",
  error: "#ef4444",
  success: "#22c55e",
};

export function NotificationBell({
  token,
  onNavigate,
  onSeeAll,
}) {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => runly.notifications.list(token, { unreadOnly: false, limit: 20 }),
    enabled: Boolean(token),
    refetchInterval: 30_000,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });

  const { data: unreadData } = useQuery({
    queryKey: ['notifications', 'bell-unread'],
    queryFn: () => runly.notifications.list(token, { unreadOnly: true, limit: 10 }),
    enabled: Boolean(token),
    refetchInterval: 30_000,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });

  const notifications = Array.isArray(data) ? data : (data?.data ?? []);
  const unreadCount = unreadData?.unreadCount ?? data?.unreadCount ?? notifications.filter((n) => !n.read).length;
  const unread = unreadData?.data ?? [];
  const unreadIds = new Set(unread.map((n) => n.id));
  const recent = [...unread, ...notifications.filter((n) => !unreadIds.has(n.id))].slice(0, 10);

  const markAllRead = useMutation({
    mutationFn: () => runly.notifications.markAllRead(token),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markOneRead = useMutation({
    mutationFn: (id) => runly.notifications.markRead(token, id),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const [open, setOpen] = useState(false);
  const [showEnableReminder, setShowEnableReminder] = useState(false);
  const soundMuted = useNotificationSoundStore((s) => s.muted);
  const toggleSound = useNotificationSoundStore((s) => s.toggle);

  useEffect(() => {
    let cancelled = false;
    async function checkPermission() {
      const permission = isTauriRuntime()
        ? await getSystemNotificationPermission().catch(() => "unsupported")
        : isWebPushSupported()
          ? (typeof Notification !== "undefined" ? Notification.permission : "unsupported")
          : "unsupported";
      if (!cancelled) setShowEnableReminder(permission !== "granted" && permission !== "unsupported");
    }
    checkPermission();
    return () => { cancelled = true; };
  }, []);

  function handleEnableReminderClick() {
    setOpen(false);
    if (typeof onNavigate === "function") onNavigate("/m/runly.notifications/settings");
  }

  function handleNotificationClick(notification) {
    if (!notification) return;
    setOpen(false);
    if (!notification.read) {
      queryClient.setQueryData(["notifications"], (old) => {
        const list = Array.isArray(old) ? old : (old?.data ?? []);
        const updated = list.map((n) =>
          n.id === notification.id ? { ...n, read: true } : n
        );
        return Array.isArray(old) ? updated : { ...old, data: updated, unreadCount: Math.max(0, (old?.unreadCount ?? unreadCount) - 1) };
      });
      queryClient.setQueryData(['notifications', 'bell-unread'], (old) => old ? {
        ...old,
        data: (old.data ?? []).filter((n) => n.id !== notification.id),
        unreadCount: Math.max(0, (old.unreadCount ?? unreadCount) - 1),
      } : old);
      markOneRead.mutate(notification.id);
    }
    if (notification.link && typeof onNavigate === "function") {
      onNavigate(notification.link);
      return;
    }
    if (typeof onSeeAll === "function") {
      onSeeAll();
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          title="Notificaciones"
          className="relative h-9 w-9 flex items-center justify-center rounded-lg cursor-pointer text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors duration-150 outline-none"
        >
          <Bell size={16} />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 h-4 min-w-4 px-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none pointer-events-none shadow-[0_0_8px_rgba(239,68,68,0.65)]">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-[hsl(var(--border))] shrink-0">
          <span className="text-sm font-semibold text-[hsl(var(--foreground))]">
            Notificaciones
          </span>
          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] transition-colors cursor-pointer disabled:opacity-50"
              >
                Marcar todo como leído
              </button>
            )}
            <button
              type="button"
              onClick={toggleSound}
              title={soundMuted ? "Activar sonido de notificaciones" : "Silenciar sonido de notificaciones"}
              className="h-6 w-6 flex items-center justify-center rounded-md text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors cursor-pointer shrink-0"
            >
              {soundMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
          </div>
        </div>
        {showEnableReminder && (
          <button
            type="button"
            onClick={handleEnableReminderClick}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 hover:bg-amber-500/15 transition-colors cursor-pointer border-b border-[hsl(var(--border))] text-left"
          >
            <BellOff size={13} className="shrink-0" />
            Activa las notificaciones para no perderte avisos
          </button>
        )}
        {/* Notification list */}
        <div className="max-h-80 overflow-y-auto">
          {recent.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-[hsl(var(--muted-foreground))]">
              <Bell size={24} className="opacity-40" />
              <p className="text-sm">Sin notificaciones</p>
            </div>
          ) : (
            recent.map((notification) => {
              const KindIcon = KIND_ICONS[notification.kind] ?? Info;
              const kindColor =
                KIND_COLORS[notification.kind] ?? KIND_COLORS.info;
              return (
                <button
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-(--glass-tint) transition-colors duration-150 cursor-pointer text-left border-b border-[hsl(var(--border))] last:border-0"
                >
                  <KindIcon
                    size={14}
                    className="mt-0.5 shrink-0"
                    style={{ color: kindColor }}
                  />
                  <div className="flex-1 min-w-0">
                    <p
                      className={`text-xs font-medium truncate ${
                        notification.read
                          ? "text-[hsl(var(--foreground))]/75"
                          : "text-[hsl(var(--foreground))]"
                      }`}
                    >
                      {notification.title}
                    </p>
                    {notification.body && (
                      <p className="text-xs text-[hsl(var(--muted-foreground))] truncate mt-0.5">
                        {notification.body}
                      </p>
                    )}
                    <p className="text-[10px] text-[hsl(var(--muted-foreground))] mt-1">
                      {timeAgo(notification.createdAt)}
                    </p>
                  </div>
                  {!notification.read && (
                    <span
                      className="h-2 w-2 rounded-full shrink-0 mt-1.5"
                      style={{ backgroundColor: "var(--brand-primary)" }}
                    />
                  )}
                </button>
              );
            })
          )}
        </div>
        <div className="border-t border-[hsl(var(--border))] p-2">
          <button
            type="button"
            onClick={() => { setOpen(false); onSeeAll?.(); }}
            className="w-full rounded-md px-3 py-2 text-xs text-left text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] hover:bg-[hsl(var(--muted))] transition-colors cursor-pointer"
          >
            Ver todas las notificaciones
          </button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
