import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Badge, Button, PageHeader, Skeleton, StatStrip } from "@runly/ui";
import { ArrowRight, Shield, Users } from "lucide-react";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";

// ── Quick link card ───────────────────────────────────────────────────────────

function QuickLink({ icon: Icon, title, description, href, color }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(href)}
      className="glass-subtle rounded-2xl border border-[hsl(var(--border))] p-4 flex items-center gap-4 hover:bg-[hsl(var(--muted))]/30 transition-colors text-left w-full group"
    >
      <div
        className="h-10 w-10 rounded-xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${color}15` }}
      >
        <Icon className="h-4 w-4" style={{ color }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-[hsl(var(--foreground))]">{title}</p>
        <p className="text-xs text-[hsl(var(--muted-foreground))] mt-0.5 truncate">{description}</p>
      </div>
      <ArrowRight className="h-4 w-4 text-[hsl(var(--muted-foreground))] shrink-0 group-hover:translate-x-0.5 transition-transform" />
    </button>
  );
}

// ── Role row ──────────────────────────────────────────────────────────────────

function RoleRow({ role, navigate }) {
  return (
    <button
      type="button"
      onClick={() => navigate(`/app/m/runly.identity/identity/roles/${role.id}`)}
      className="flex items-center gap-3 px-4 py-3 border-b border-[hsl(var(--border))]/60 last:border-b-0 hover:bg-[hsl(var(--muted))]/20 transition-colors w-full text-left"
    >
      <Shield className="h-4 w-4 text-[hsl(var(--muted-foreground))] shrink-0" />
      <span className="flex-1 text-sm font-medium text-[hsl(var(--foreground))] truncate">
        {role.name}
      </span>
      <span className="text-xs tabular-nums text-[hsl(var(--muted-foreground))] shrink-0">
        {role.permissionKeys?.length ?? 0} permisos
      </span>
      <Badge variant={role.enabled ? "success" : "secondary"} className="shrink-0">
        {role.enabled ? "Activo" : "Inactivo"}
      </Badge>
    </button>
  );
}

// ── Main screen ───────────────────────────────────────────────────────────────

export default function IdentityOverview() {
  const { session, userProfile } = useAuth();
  const navigate = useNavigate();
  const token = session?.access_token;

  const permissions = userProfile?.permissions ?? [];
  const canReadUsers =
    userProfile?.isAdmin || permissions.includes("identity.users.read");
  const canReadRoles =
    userProfile?.isAdmin || permissions.includes("identity.roles.read");

  const usersQuery = useQuery({
    queryKey: ["identity-users"],
    queryFn: () => runly.identity.listUsers(token),
    enabled: Boolean(token) && canReadUsers,
  });

  const rolesQuery = useQuery({
    queryKey: ["identity-roles"],
    queryFn: () => runly.identity.listRoles(token),
    enabled: Boolean(token) && canReadRoles,
  });

  const users = usersQuery.data?.data ?? [];
  const roles = rolesQuery.data?.data ?? [];

  const activeUsers = users.filter((u) => u.status === "ACTIVE" || u.enabled !== false);
  const customRoles = roles.filter((r) => !r.system);

  const isLoadingUsers = canReadUsers && usersQuery.isLoading;
  const isLoadingRoles = canReadRoles && rolesQuery.isLoading;

  const brandColor = "var(--brand-primary)";
  const violet = "#8b5cf6";

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        eyebrow="Runly Identity"
        title="Identidad y acceso"
        description="Gestiona usuarios, roles y permisos del sistema."
        actions={
          canReadUsers && (
            <Button onClick={() => navigate("/app/m/runly.identity/identity/users")}>
              <Users className="h-4 w-4" />
              Ver usuarios
            </Button>
          )
        }
      />

      {/* Stat grid */}
      <StatStrip
        items={[
          {
            key: "users",
            label: "Usuarios",
            icon: "Users",
            value: isLoadingUsers ? "…" : canReadUsers ? String(users.length) : "—",
          },
          {
            key: "active",
            label: "Activos",
            icon: "UserCheck",
            value: isLoadingUsers ? "…" : canReadUsers ? String(activeUsers.length) : "—",
          },
          {
            key: "roles",
            label: "Roles",
            icon: "Shield",
            value: isLoadingRoles ? "…" : canReadRoles ? String(roles.length) : "—",
          },
          {
            key: "custom-roles",
            label: "Roles personalizados",
            icon: "KeyRound",
            value: isLoadingRoles ? "…" : canReadRoles ? String(customRoles.length) : "—",
          },
        ]}
      />

      {/* Quick access */}
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-[hsl(var(--muted-foreground))] mb-3">
          Acceso rapido
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <QuickLink
            icon={Users}
            title="Usuarios"
            description="Administra cuentas, estado y perfiles de acceso"
            href="/app/m/runly.identity/identity/users"
            color={brandColor}
          />
          <QuickLink
            icon={Shield}
            title="Roles y permisos"
            description="Define roles y asigna permisos granulares por modulo"
            href="/app/m/runly.identity/identity/roles"
            color={violet}
          />
        </div>
      </div>

      {/* Recent roles preview */}
      {canReadRoles && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-[hsl(var(--muted-foreground))]">
              Roles recientes
            </p>
            <button
              type="button"
              onClick={() => navigate("/app/m/runly.identity/identity/roles")}
              className="text-xs hover:underline cursor-pointer"
              style={{ color: brandColor }}
            >
              Ver todos
            </button>
          </div>
          <div className="glass rounded-2xl border border-[hsl(var(--border))] overflow-hidden">
            {isLoadingRoles ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full rounded-xl" />
                ))}
              </div>
            ) : roles.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  No hay roles registrados.
                </p>
              </div>
            ) : (
              roles.slice(0, 5).map((role) => (
                <RoleRow key={role.id} role={role} navigate={navigate} />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
