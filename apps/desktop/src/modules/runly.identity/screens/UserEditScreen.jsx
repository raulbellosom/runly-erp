import { useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { RunlyForm, PageHeader, LoadingState, ErrorState, Button, Card, DistDropZone } from "@runly/ui";
import { Camera, Eye } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
  const { session, userProfile, refreshProfile } = useAuth();
  const token = session?.access_token;
  const { activeCompanyId } = useActiveCompany();
  const isSelf = userId === userProfile?.id;

  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (k) => Boolean(userProfile?.isAdmin || permissions.includes(k));
  const canSubmit = hasPermission("identity.users.update");

  const userQuery = useQuery({
    queryKey: ["identity-user", userId],
    queryFn: () => runly.identity.getUser(userId, token),
    enabled: Boolean(token && userId),
  });
  const user = userQuery.data?.data ?? null;

  const avatarMutation = useMutation({
    mutationFn: (file) => runly.identity.uploadUserAvatar(userId, file, token),
    onMutate: () => toast.loading("Subiendo foto de perfil..."),
    onSuccess: async (_data, _vars, toastId) => {
      await queryClient.invalidateQueries({ queryKey: ["identity-user", userId] });
      await queryClient.invalidateQueries({ queryKey: ["identity-users"] });
      if (isSelf) {
        await queryClient.invalidateQueries({ queryKey: ["profile-me"] });
        refreshProfile(session);
      }
      toast.success("Foto de perfil actualizada", { id: toastId });
    },
    onError: (_err, _vars, toastId) => toast.error("No se pudo actualizar la foto de perfil", { id: toastId }),
  });

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
      <Card variant="shell" className="mt-6 p-4 md:p-5 space-y-3">
        <div className="flex items-center gap-2">
          <Camera className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
          <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Foto de perfil</h3>
        </div>
        <DistDropZone
          variant="compact"
          accept="image/*"
          maxSizeMB={10}
          onFile={(file) => avatarMutation.mutate(file)}
          isUploading={avatarMutation.isPending}
          emptyLabel="Arrastra o haz clic para subir una foto"
          emptyHint="JPG, PNG o WebP · máximo 10 MB"
        />
      </Card>
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
