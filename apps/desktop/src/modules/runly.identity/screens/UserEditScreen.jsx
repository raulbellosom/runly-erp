import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  RunlyForm,
  PageHeader,
  LoadingState,
  ErrorState,
  Button,
  Card,
  DistDropZone,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  PasswordField,
  ConfirmDialog,
} from "@runly/ui";
import { Camera, Eye, KeyRound, Send } from "lucide-react";
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
  const isSystemAdmin = Boolean(userProfile?.isSystemAdmin);

  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [sendResetOpen, setSendResetOpen] = useState(false);

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

  const setPasswordMutation = useMutation({
    mutationFn: () => runly.identity.setUserPassword(userId, newPassword, token),
    onSuccess: () => {
      toast.success("Contraseña actualizada");
      setPasswordDialogOpen(false);
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err) => toast.error(err?.message || "No se pudo actualizar la contraseña"),
  });

  const sendResetMutation = useMutation({
    mutationFn: () => runly.identity.sendUserPasswordReset(userId, token),
    onSuccess: () => {
      toast.success("Enlace de restablecimiento enviado");
      setSendResetOpen(false);
    },
    onError: (err) => toast.error(err?.message || "No se pudo enviar el enlace"),
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
      {(isSelf || isSystemAdmin) && <Card variant="shell-flat" className="mt-6 p-4 md:p-5 space-y-3">
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
      </Card>}
      {!isSelf && (isSystemAdmin || canSubmit) && (
        <Card variant="shell-flat" className="mt-6 p-4 md:p-5 space-y-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            <h3 className="text-sm font-semibold text-[hsl(var(--foreground))]">Contraseña</h3>
          </div>
          {isSystemAdmin ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Como administrador del sistema puedes fijar la contraseña de este usuario directamente.
              </p>
              <Button type="button" variant="outline" onClick={() => setPasswordDialogOpen(true)}>
                <KeyRound className="h-4 w-4" />
                Cambiar contraseña
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Envía un enlace para que este usuario restablezca su propia contraseña.
              </p>
              <Button type="button" variant="outline" onClick={() => setSendResetOpen(true)}>
                <Send className="h-4 w-4" />
                Enviar restablecimiento
              </Button>
            </div>
          )}
        </Card>
      )}

      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambiar contraseña</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <PasswordField
              label="Nueva contraseña"
              showStrength
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <PasswordField
              label="Confirmar nueva contraseña"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPasswordDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={
                newPassword.length < 8 ||
                newPassword !== confirmPassword ||
                setPasswordMutation.isPending
              }
              onClick={() => setPasswordMutation.mutate()}
            >
              {setPasswordMutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={sendResetOpen}
        onOpenChange={setSendResetOpen}
        title="Enviar restablecimiento de contraseña"
        description="Se enviará un correo con un enlace para que el usuario elija una nueva contraseña."
        detail={user?.displayName || user?.email}
        confirmLabel="Enviar"
        onConfirm={() => sendResetMutation.mutate()}
        loading={sendResetMutation.isPending}
      />

      <div className="mt-6">
        {!isSelf ? <RunlyForm
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
        /> : <Card variant="shell-flat" className="p-4">
          <p>La persona administra su perfil desde Mi perfil. Los roles y el acceso a esta empresa se administran en el detalle del usuario.</p>
          <Button className="mt-3" onClick={() => navigate(`/app/m/runly.identity/identity/users/${userId}`)}>Administrar acceso empresarial</Button>
        </Card>}
      </div>
    </div>
  );
}
