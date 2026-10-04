import { PersonAvatar } from "@runly/ui";
import { useAuth } from "../../../auth/AuthProvider";
import { useGlobalPresence } from "../../../providers/RealtimeProvider";
import { WidgetFrame } from "./WidgetFrame";

const MAX_SHOWN = 8;

export function OnlineUsersWidget({ module }) {
  const { userProfile } = useAuth();
  const { onlineUsers } = useGlobalPresence();
  const users = Object.values(onlineUsers ?? {})
    .filter((u) => u?.userId && u.userId !== userProfile?.id)
    .sort((a, b) => String(a.displayName).localeCompare(String(b.displayName), "es"));
  const shown = users.slice(0, MAX_SHOWN);

  return (
    <WidgetFrame
      module={module}
      title="En línea"
      subtitle={users.length ? `${users.length} ${users.length === 1 ? "persona conectada" : "personas conectadas"}` : "Ahora"}
      isEmpty={users.length === 0}
      emptyText="No hay nadie más conectado en este momento."
    >
      <ul className="grid grid-cols-2 gap-x-3 gap-y-2">
        {shown.map((u) => (
          <li key={u.userId} className="flex min-w-0 items-center gap-2">
            <span className="relative shrink-0">
              <PersonAvatar name={u.displayName} src={u.avatarUrl} size="sm" />
              <span
                aria-hidden
                className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[hsl(var(--card))] bg-emerald-500"
              />
            </span>
            <span className="truncate text-sm text-[hsl(var(--foreground))]">{u.displayName}</span>
          </li>
        ))}
      </ul>
      {users.length > MAX_SHOWN && (
        <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
          +{users.length - MAX_SHOWN} más
        </p>
      )}
    </WidgetFrame>
  );
}
