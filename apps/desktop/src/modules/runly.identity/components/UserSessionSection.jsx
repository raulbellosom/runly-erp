import { useQuery } from "@tanstack/react-query";
import { Badge } from "@runly/ui";
import { runly } from "../../../lib/runly";

function formatDateTime(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("es-MX", { dateStyle: "medium", timeStyle: "short" });
}

function formatRelative(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return "hace unos segundos";
  const min = Math.round(sec / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  const days = Math.round(h / 24);
  return `hace ${days} d`;
}

function ConfirmationBadge({ value }) {
  return value ? (
    <Badge variant="success">Confirmado</Badge>
  ) : (
    <Badge variant="secondary">Sin confirmar</Badge>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-sm">
      <span className="text-[hsl(var(--muted-foreground))]">{label}</span>
      <span className="text-right text-[hsl(var(--foreground))]">{children}</span>
    </div>
  );
}

export default function UserSessionSection({ data, token }) {
  const userId = data?.id;
  const sessionQuery = useQuery({
    queryKey: ["identity-user-session", userId],
    queryFn: () => runly.identity.getUserSession(userId, token),
    enabled: Boolean(token && userId),
    retry: false,
  });

  // A 403 (missing identity.users.sessions.read) or any other error hides the
  // section entirely — the API is the authoritative gate, the frontend never
  // shows an error toast for this optional, permission-gated panel.
  if (sessionQuery.isError) return null;

  if (sessionQuery.isLoading) {
    return (
      <div className="space-y-2 p-1">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-6 rounded-lg bg-[hsl(var(--muted))] animate-pulse" />
        ))}
      </div>
    );
  }

  const info = sessionQuery.data?.data ?? null;
  if (!info) {
    return (
      <p className="p-1 text-sm text-[hsl(var(--muted-foreground))]">
        Información de sesión no disponible.
      </p>
    );
  }

  const isBanned = Boolean(info.bannedUntil) && new Date(info.bannedUntil).getTime() > Date.now();
  const providers = Array.isArray(info.providers) && info.providers.length
    ? info.providers.join(", ")
    : "—";

  return (
    <div className="divide-y divide-[hsl(var(--border))]">
      <Field label="Último inicio de sesión">
        {info.lastSignInAt
          ? `${formatRelative(info.lastSignInAt)} — ${formatDateTime(info.lastSignInAt)}`
          : "Nunca"}
      </Field>
      <Field label="Cuenta creada en Supabase">
        {formatDateTime(info.createdAt) ?? "—"}
      </Field>
      <Field label="Correo confirmado">
        <ConfirmationBadge value={info.emailConfirmedAt} />
      </Field>
      <Field label="Teléfono confirmado">
        <ConfirmationBadge value={info.phoneConfirmedAt} />
      </Field>
      <Field label="Proveedor de acceso">{providers}</Field>
      <Field label="Estado de la cuenta">
        {isBanned ? (
          <Badge variant="destructive">Suspendida hasta {formatDateTime(info.bannedUntil)}</Badge>
        ) : (
          <Badge variant="success">Activa</Badge>
        )}
      </Field>
    </div>
  );
}
