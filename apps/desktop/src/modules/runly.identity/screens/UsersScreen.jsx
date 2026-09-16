import { toLocalIso } from '../../../lib/localDate.js';
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { RunlyTable, Button, ConfirmDialog, ErrorState, PageHeader } from "@runly/ui";
import {
  FileSpreadsheet,
  FileText,
  Power,
  PowerOff,
  Trash2,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { useActiveCompany } from "../../../company/ActiveCompanyProvider";
import { runly } from "../../../lib/runly";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import { IDENTITY_USER_TABLE } from "../blueprints/identity-user-table.blueprint.js";

const API_BASE_URL = getApiUrl();
const PROTECTED_ROLE_KEYS = new Set(["runly.admin", "system.admin"]);

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 100);
}

function getRoleKey(row) {
  return String(row?.memberships?.[0]?.roleKey ?? "").trim().toLowerCase();
}

function isProtectedAdminUser(row) {
  const roleKey = getRoleKey(row);
  return PROTECTED_ROLE_KEYS.has(roleKey);
}

function getUniformStatusMode(rows) {
  if (!rows.length) return "mixed";
  const allEnabled = rows.every((row) => Boolean(row.enabled));
  const allDisabled = rows.every((row) => !row.enabled);
  if (allEnabled) return "disable";
  if (allDisabled) return "enable";
  return "mixed";
}

export default function UsersScreen() {
  const navigate = useNavigate();
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const { activeCompanyId } = useActiveCompany();
  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (key) =>
    Boolean(userProfile?.isAdmin || permissions.includes(key));

  const canReadUsers = hasPermission("identity.users.read");
  const canCreateUsers = hasPermission("identity.users.create");
  const canUpdateUsers = hasPermission("identity.users.update");
  const canDeleteUsers = hasPermission("identity.users.delete");

  const [refreshSignal, setRefreshSignal] = useState(0);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [bulkState, setBulkState] = useState(null);

  const bulkEnabledMutation = useMutation({
    mutationFn: async ({ ids, enabled }) => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      return runly.identity.setUsersEnabled(ids, enabled, token);
    },
    onSuccess: () => {
      setRefreshSignal((value) => value + 1);
      setBulkState(null);
      toast.success("Usuarios actualizados");
    },
    onError: () => toast.error("No se pudo actualizar el estado de los usuarios"),
  });

  const deleteUserMutation = useMutation({
    mutationFn: (id) => runly.identity.deleteUser(id, token),
    onSuccess: () => {
      setRefreshSignal((value) => value + 1);
      setDeleteTarget(null);
      toast.success("Usuario eliminado");
    },
    onError: (error) => {
      toast.error(error?.message || "No se pudo eliminar el usuario");
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids) => runly.identity.deleteUsersBulk(ids, token),
    onSuccess: () => {
      setRefreshSignal((value) => value + 1);
      setBulkState(null);
      toast.success("Usuarios eliminados");
    },
    onError: (error) => {
      toast.error(error?.message || "No se pudieron eliminar los usuarios");
    },
  });

  const bulkActions = useMemo(() => {
    const actions = [];

    actions.push({
      label: "Exportar Excel",
      icon: FileSpreadsheet,
      onClick: async (selectedRows) => {
        try {
          const ids = selectedRows.map((row) => row.id).filter(Boolean);
          if (!ids.length) return;
          const blob = await runly.identity.exportUsersExcel(ids, token);
          downloadBlob(blob, `usuarios-${toLocalIso()}.xlsx`);
          toast.success("Excel generado");
        } catch {
          toast.error("No se pudo exportar el archivo Excel");
        }
      },
    });

    actions.push({
      label: "Exportar PDF",
      icon: FileText,
      onClick: async (selectedRows) => {
        try {
          const ids = selectedRows.map((row) => row.id).filter(Boolean);
          if (!ids.length) return;
          const blob = await runly.identity.exportUsersPdf(ids, token);
          downloadBlob(blob, `usuarios-${toLocalIso()}.pdf`);
          toast.success("PDF generado");
        } catch {
          toast.error("No se pudo generar el PDF");
        }
      },
    });

    if (canUpdateUsers) {
      actions.push((selectedRows) => {
        const mode = getUniformStatusMode(selectedRows);
        if (mode === "mixed") {
          return {
            label: "Estado",
            icon: Power,
            disabled: true,
            title: "Solo disponible cuando todos tienen el mismo estado.",
            onClick: () => {},
          };
        }
        const enabling = mode === "enable";
        return {
          label: enabling ? "Activar" : "Desactivar",
          icon: enabling ? Power : PowerOff,
          onClick: () =>
            setBulkState({
              type: "enable",
              rows: selectedRows,
              enabled: enabling,
            }),
        };
      });
    }

    if (canDeleteUsers) {
      actions.push((selectedRows) => ({
        label: "Eliminar",
        icon: Trash2,
        variant: "destructive",
        disabled: selectedRows.some(isProtectedAdminUser),
        title: selectedRows.some(isProtectedAdminUser)
          ? "No puedes eliminar usuarios con rol Runly Admin o System Admin."
          : undefined,
        onClick: () => setBulkState({ type: "delete", rows: selectedRows }),
      }));
    }

    return actions;
  }, [canDeleteUsers, canUpdateUsers, token]);

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-dvh">
      <PageHeader
        eyebrow="Runly Identity"
        title="Usuarios"
        description="Gestiona usuarios, roles y estado de acceso de la instancia."
        actions={
          canCreateUsers ? (
            <Button onClick={() => navigate("/app/m/runly.identity/identity/users/new")}>
              <UserPlus className="h-4 w-4" />
              Nuevo usuario
            </Button>
          ) : null
        }
      />

      {canReadUsers ? (
        <RunlyTable
          blueprint={IDENTITY_USER_TABLE}
          token={token}
          companyId={activeCompanyId}
          apiBaseUrl={API_BASE_URL}
          onView={(row) => navigate(`/app/m/runly.identity/identity/users/${row.id}`)}
          onEdit={
            canUpdateUsers
              ? (row) => navigate(`/app/m/runly.identity/identity/users/${row.id}/edit`)
              : undefined
          }
          onDelete={
            canDeleteUsers
              ? (row) => {
                  if (row.id === userProfile?.id) {
                    toast.error("No puedes eliminar tu propia cuenta");
                    return;
                  }
                  if (isProtectedAdminUser(row)) {
                    toast.error("No puedes eliminar usuarios Runly Admin/System Admin");
                    return;
                  }
                  setDeleteTarget(row);
                }
              : undefined
          }
          canDeleteRow={(row) =>
            row?.id !== userProfile?.id && !isProtectedAdminUser(row)
          }
          refreshSignal={refreshSignal}
          bulkActions={bulkActions}
        />
      ) : null}

      <ConfirmDialog
        open={canReadUsers && Boolean(deleteTarget)}
        onOpenChange={(value) => !value && setDeleteTarget(null)}
        title="Eliminar usuario"
        description="Esta accion eliminara la cuenta del usuario de forma permanente."
        detail={deleteTarget?.displayName || deleteTarget?.email}
        confirmLabel="Eliminar"
        onConfirm={() => deleteUserMutation.mutate(deleteTarget.id)}
        loading={deleteUserMutation.isPending}
      />

      <ConfirmDialog
        open={canReadUsers && Boolean(bulkState)}
        onOpenChange={(value) => !value && setBulkState(null)}
        title={
          bulkState?.type === "delete"
            ? "Eliminar usuarios seleccionados"
            : bulkState?.enabled
              ? "Activar usuarios seleccionados"
              : "Desactivar usuarios seleccionados"
        }
        description={
          bulkState?.type === "delete"
            ? "Esta accion elimina usuarios de forma permanente."
            : "Se actualizara el estado de los usuarios seleccionados."
        }
        detail={`${bulkState?.rows?.length ?? 0} usuarios seleccionados`}
        confirmLabel={bulkState?.type === "delete" ? "Eliminar" : "Confirmar"}
        onConfirm={() => {
          const selectedRows = bulkState?.rows ?? [];
          const selectedIds = selectedRows.map((row) => row.id).filter(Boolean);
          const safeRows = selectedRows.filter(
            (row) => row.id !== userProfile?.id && !isProtectedAdminUser(row),
          );
          const safeIds = safeRows.map((row) => row.id).filter(Boolean);

          if (!safeIds.length) {
            setBulkState(null);
            toast.error("No hay usuarios validos seleccionados");
            return;
          }

          if (bulkState?.type === "delete") {
            bulkDeleteMutation.mutate(safeIds);
            return;
          }

          bulkEnabledMutation.mutate({
            ids: safeIds,
            enabled: Boolean(bulkState?.enabled),
          });
        }}
        loading={bulkDeleteMutation.isPending || bulkEnabledMutation.isPending}
      />

      {!canReadUsers && (
        <ErrorState message="No tienes permisos para consultar usuarios." />
      )}
    </div>
  );
}
