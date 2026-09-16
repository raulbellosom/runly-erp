import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { RunlyForm, PageHeader, LoadingState, ErrorState, Button } from "@runly/ui";
import { Eye } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../auth/AuthProvider";
import { useActiveCompany } from "../../../company/ActiveCompanyProvider";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import { runly } from "../../../lib/runly";
import { IDENTITY_USER_FORM } from "../blueprints/identity-user-form.blueprint.js";
import { componentRegistry } from "../../../lib/moduleComponentRegistry.js";

const API_BASE = getApiUrl();

export default function UserEditScreen() {
  // See UserDetailScreen.jsx for why "id" isn't a real react-router param
  // here — ModuleOutlet resolves this route via a flat key lookup, not a
  // nested <Route path=":id">, so the id has to be parsed out of the "*"
  // wildcard instead.
  const { "*": wildcard } = useParams();
  const userId = useMemo(() => {
    const segs = String(wildcard ?? "").replace(/^\/+/, "").split("/").filter(Boolean);
    return segs[2] ?? null;
  }, [wildcard]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const { activeCompanyId } = useActiveCompany();

  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (k) => Boolean(userProfile?.isAdmin || permissions.includes(k));
  const canSubmit = hasPermission("identity.users.update");

  const userQuery = useQuery({
    queryKey: ["identity-user", userId],
    queryFn: () => runly.identity.getUser(userId, token),
    enabled: Boolean(token && userId),
  });
  const user = userQuery.data?.data ?? null;

  if (userQuery.isLoading) return <LoadingState message="Cargando usuario..." />;
  if (userQuery.isError) return <ErrorState title="No se pudo cargar el usuario" />;
  if (!canSubmit) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState title="No tienes permiso para esta acción" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 pb-24">
      <PageHeader
        eyebrow="Editar usuario"
        title={user?.displayName || "Editar usuario"}
        actions={
          <Button variant="outline" onClick={() => navigate(`/app/m/runly.identity/identity/users/${userId}`)}>
            <Eye className="h-4 w-4" />
            Ver detalle
          </Button>
        }
      />
      <div className="mt-6">
        <RunlyForm
          blueprint={IDENTITY_USER_FORM}
          initialData={user ?? {}}
          mode="edit"
          token={token}
          companyId={activeCompanyId}
          apiBaseUrl={API_BASE}
          componentRegistry={componentRegistry}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["identity-user", userId] });
            queryClient.invalidateQueries({ queryKey: ["identity-users"] });
            navigate(`/app/m/runly.identity/identity/users/${userId}`);
          }}
          onCancel={() => navigate(`/app/m/runly.identity/identity/users/${userId}`)}
        />
      </div>
    </div>
  );
}
