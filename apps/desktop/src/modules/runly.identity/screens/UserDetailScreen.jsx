import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  RunlyDetail,
  LoadingState,
  ErrorState,
  ConfirmDialog,
  DetailActionBar,
  DistDropZone,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@runly/ui";
import { ArrowLeft, Camera, Pencil, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { useActiveCompany } from "../../../company/ActiveCompanyProvider";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import { runly } from "../../../lib/runly";
import { IDENTITY_USER_DETAIL } from "../blueprints/identity-user-detail.blueprint.js";
import { componentRegistry } from "../../../lib/moduleComponentRegistry.js";

const API_BASE = getApiUrl();

// Mirrors apps/api/src/index.js's PROTECTED_IDENTITY_ROLE_KEYS /
// hasProtectedIdentityAdminRole (checked 2026-09-16): any ENABLED membership
// with one of these role keys makes the user undeletable from the UI. Keep
// this set and the enabled-membership check in sync with the API.
const PROTECTED_ROLE_KEYS = new Set(["runly.admin", "atlas.admin", "system.admin"]);

function isProtectedAdminUser(user) {
  const memberships = Array.isArray(user?.memberships) ? user.memberships : [];
  return memberships.some((membership) => {
    if (!membership?.enabled) return false;
    const roleKey = String(membership?.roleKey ?? "").trim().toLowerCase();
    return PROTECTED_ROLE_KEYS.has(roleKey);
  });
}

export default function UserDetailScreen() {
  // ModuleOutlet resolves "runly.identity:/identity/users/:id" to this file
  // via a flat key lookup (see apps/desktop/src/app/module-screen-resolver.js)
  // rather than a nested <Route path=":id">, so react-router never populates
  // a named "id" param — only the catch-all "*" wildcard is available. Every
  // other directly-registered detail screen in this app (AccountScreen.jsx,
  // ReportDetailScreen.jsx, InventoryItemDetail.jsx, ...) parses the id out
  // of that wildcard the same way.
  const { "*": wildcard } = useParams();
  const userId = useMemo(() => {
    const segs = String(wildcard ?? "").replace(/^\/+/, "").split("/").filter(Boolean);
    return segs[2] ?? null;
  }, [wildcard]);
  const { session, userProfile, refreshProfile } = useAuth();
  const token = session?.access_token;
  const navigate = useNavigate();
  const { activeCompanyId } = useActiveCompany();
  const queryClient = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [avatarDialogOpen, setAvatarDialogOpen] = useState(false);

  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (k) => Boolean(userProfile?.isAdmin || permissions.includes(k));
  const canUpdate = hasPermission("identity.users.update");
  const canDelete = hasPermission("identity.users.delete");
  const isSelf = userId === userProfile?.id;

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
      setAvatarDialogOpen(false);
    },
    onError: (_err, _vars, toastId) => toast.error("No se pudo actualizar la foto de perfil", { id: toastId }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => runly.identity.deleteUser(userId, token),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["identity-users"] });
      toast.success("Usuario eliminado");
      navigate("/app/m/runly.identity/identity/users");
    },
    onError: (err) => {
      try {
        toast.error(JSON.parse(err?.message || "{}").error || "No se pudo eliminar el usuario");
      } catch {
        toast.error("No se pudo eliminar el usuario");
      }
    },
  });

  if (userQuery.isLoading) {
    return (
      <div className="p-4 md:p-6">
        <LoadingState message="Cargando usuario" />
      </div>
    );
  }
  if (!user) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState title="Usuario no encontrado" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-dvh">
      <RunlyDetail
        blueprint={IDENTITY_USER_DETAIL}
        data={user}
        token={token}
        companyId={activeCompanyId}
        apiBaseUrl={API_BASE}
        componentRegistry={componentRegistry}
        heroActions={
          <DetailActionBar
            primary={
              canUpdate
                ? {
                    label: "Editar",
                    icon: <Pencil className="h-4 w-4" />,
                    onClick: () => navigate(`/app/m/runly.identity/identity/users/${userId}/edit`),
                  }
                : null
            }
            secondary={[
              {
                label: "Volver a usuarios",
                icon: <ArrowLeft className="h-4 w-4" />,
                onClick: () => navigate("/app/m/runly.identity/identity/users"),
              },
              canUpdate
                ? {
                    label: "Cambiar foto",
                    icon: <Camera className="h-4 w-4" />,
                    onClick: () => setAvatarDialogOpen(true),
                  }
                : null,
              canDelete && !isSelf
                ? {
                    label: "Eliminar usuario",
                    icon: <Trash2 className="h-4 w-4" />,
                    onClick: () => setDeleteOpen(true),
                    destructive: true,
                  }
                : null,
            ].filter(Boolean)}
          />
        }
      />

      <Dialog open={avatarDialogOpen} onOpenChange={setAvatarDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar foto de perfil</DialogTitle>
          </DialogHeader>
          <DistDropZone
            variant="compact"
            accept="image/*"
            maxSizeMB={10}
            onFile={(file) => avatarMutation.mutate(file)}
            isUploading={avatarMutation.isPending}
            emptyLabel="Arrastra o haz clic para subir una foto"
            emptyHint="JPG, PNG o WebP · máximo 10 MB"
          />
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="¿Eliminar usuario?"
        description="Esta acción es irreversible. Se eliminará la cuenta del usuario y no podrá recuperarse."
        detail={user.displayName || user.email}
        confirmLabel="Eliminar"
        onConfirm={() => {
          if (isProtectedAdminUser(user)) {
            toast.error("No puedes eliminar usuarios Runly Admin/System Admin");
            setDeleteOpen(false);
            return;
          }
          deleteMutation.mutate();
        }}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}
