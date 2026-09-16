import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  Button,
  ConfirmDialog,
  RunlyDetail,
  DetailActionBar,
  ErrorState,
  LoadingState,
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  TextField,
} from "@runly/ui";
import { ArrowLeft, Pencil, Power, PowerOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { useActiveCompany } from "../../../company/ActiveCompanyProvider";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import { runly } from "../../../lib/runly";
import { IDENTITY_ROLE_DETAIL } from "../blueprints/identity-role-detail.blueprint.js";
import { componentRegistry } from "../../../lib/moduleComponentRegistry.js";

const API_BASE = getApiUrl();

export default function RoleEditorScreen() {
  // See UserDetailScreen.jsx for why "id" isn't a real react-router param
  // here — ModuleOutlet resolves this route via a flat key lookup, not a
  // nested <Route path=":id">, so the id has to be parsed out of the "*"
  // wildcard instead.
  const { "*": wildcard } = useParams();
  const roleId = useMemo(() => {
    const segs = String(wildcard ?? "").replace(/^\/+/, "").split("/").filter(Boolean);
    return segs[2] ?? null;
  }, [wildcard]);
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const navigate = useNavigate();
  const { activeCompanyId } = useActiveCompany();
  const queryClient = useQueryClient();
  const [editSheetOpen, setEditSheetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (key) => Boolean(userProfile?.isAdmin || permissions.includes(key));
  const canReadRoles = hasPermission("identity.roles.read");
  const canManageRoles = hasPermission("identity.roles.update");
  const canDeleteRoles = hasPermission("identity.roles.delete");

  const rolesQuery = useQuery({
    queryKey: ["identity-roles"],
    queryFn: () => runly.identity.listRoles(token),
    enabled: Boolean(token) && canReadRoles,
  });
  const role = (rolesQuery.data?.data ?? []).find((r) => r.id === roleId) ?? null;

  const toggleRoleMutation = useMutation({
    mutationFn: ({ id, enabled }) => runly.identity.setRoleEnabled(id, enabled, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["identity-roles"] });
      toast.success("Estado actualizado");
    },
    onError: () => toast.error("No se pudo cambiar el estado"),
  });

  const updateRoleMutation = useMutation({
    mutationFn: ({ id, data }) => runly.identity.updateRole(id, data, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["identity-roles"] });
      setEditSheetOpen(false);
      toast.success("Rol actualizado");
    },
    onError: () => toast.error("No se pudo actualizar el rol"),
  });

  const deleteRoleMutation = useMutation({
    mutationFn: (id) => runly.identity.deleteRole(id, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["identity-roles"] });
      toast.success("Rol eliminado");
      navigate("/app/m/runly.identity/identity/roles");
    },
    onError: (err) => toast.error(err?.message || "No se pudo eliminar el rol"),
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm({ defaultValues: { name: "", description: "" } });

  function openEditSheet() {
    if (!role) return;
    reset({ name: role.name, description: role.description ?? "" });
    setEditSheetOpen(true);
  }

  function onEditSubmit(data) {
    if (!role) return;
    updateRoleMutation.mutate({ id: role.id, data });
  }

  if (!canReadRoles) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState title="No tienes permisos para consultar roles." />
      </div>
    );
  }
  if (rolesQuery.isLoading) {
    return (
      <div className="p-4 md:p-6">
        <LoadingState message="Cargando rol" />
      </div>
    );
  }
  if (!role) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState title="Rol no encontrado" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-dvh">
      <RunlyDetail
        blueprint={IDENTITY_ROLE_DETAIL}
        data={role}
        token={token}
        companyId={activeCompanyId}
        apiBaseUrl={API_BASE}
        componentRegistry={componentRegistry}
        heroActions={
          <DetailActionBar
            primary={
              canManageRoles && !role.system ? { label: "Editar", icon: <Pencil className="h-4 w-4" />, onClick: openEditSheet } : null
            }
            secondary={[
              { label: "Volver a roles", icon: <ArrowLeft className="h-4 w-4" />, onClick: () => navigate("/app/m/runly.identity/identity/roles") },
              canManageRoles && !role.system
                ? {
                    label: role.enabled ? "Desactivar" : "Activar",
                    icon: role.enabled ? <PowerOff className="h-4 w-4" /> : <Power className="h-4 w-4" />,
                    onClick: () => toggleRoleMutation.mutate({ id: role.id, enabled: !role.enabled }),
                    loading: toggleRoleMutation.isPending,
                  }
                : null,
              canDeleteRoles && !role.system
                ? {
                    label: "Eliminar rol",
                    icon: <Trash2 className="h-4 w-4" />,
                    onClick: () => setDeleteOpen(true),
                    destructive: true,
                  }
                : null,
            ].filter(Boolean)}
          />
        }
      />

      <Sheet
        open={editSheetOpen}
        onOpenChange={(v) => {
          if (!updateRoleMutation.isPending) setEditSheetOpen(v);
        }}
      >
        <SheetContent className="sm:max-w-md lg:max-w-xl xl:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Editar rol</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto py-4">
            <form id="edit-role-form" onSubmit={handleSubmit(onEditSubmit)} className="space-y-4">
              <TextField
                label="Nombre visible"
                required
                placeholder="Supervisor de ventas"
                error={errors.name?.message}
                {...register("name", { required: "El nombre es obligatorio" })}
              />
              <TextField
                label="Descripcion"
                placeholder="Describe las responsabilidades de este rol (opcional)"
                {...register("description")}
              />
            </form>
          </div>
          <SheetFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditSheetOpen(false)} disabled={updateRoleMutation.isPending}>
              Cancelar
            </Button>
            <Button type="submit" form="edit-role-form" disabled={updateRoleMutation.isPending}>
              {updateRoleMutation.isPending ? "Guardando..." : "Guardar cambios"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={(v) => !v && setDeleteOpen(false)}
        title="Eliminar rol"
        description={
          (role?.memberCount ?? 0) > 0
            ? `El rol "${role?.name}" tiene ${role.memberCount} ${role.memberCount === 1 ? "usuario asignado" : "usuarios asignados"}. Al eliminarlo quedaran sin rol y perderan todos los permisos asociados a este rol.`
            : `¿Confirmas que quieres eliminar "${role?.name}"? Esta accion no se puede deshacer.`
        }
        confirmLabel={(role?.memberCount ?? 0) > 0 ? "Eliminar de todas formas" : "Eliminar"}
        onConfirm={() => deleteRoleMutation.mutate(role.id)}
        loading={deleteRoleMutation.isPending}
      />
    </div>
  );
}
