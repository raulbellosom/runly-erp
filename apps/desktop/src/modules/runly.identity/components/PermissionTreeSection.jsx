import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EmptyState, UnsavedChangesBar } from "@runly/ui";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import PermissionFeatureTree from "./PermissionFeatureTree";

export default function PermissionTreeSection({ data, token }) {
  const { userProfile } = useAuth();
  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (k) => Boolean(userProfile?.isAdmin || permissions.includes(k));
  const canReadPermissions = hasPermission("identity.permissions.read");
  const canManagePermissions = hasPermission("identity.permissions.update");
  const queryClient = useQueryClient();
  const roleId = data?.id;

  const [pendingKeys, setPendingKeys] = useState(null);

  const permissionsQuery = useQuery({
    queryKey: ["identity-permissions"],
    queryFn: () => runly.identity.listPermissions(token),
    enabled: Boolean(token) && canReadPermissions,
  });
  const allPermissions = permissionsQuery.data?.data?.permissions ?? [];

  useEffect(() => {
    setPendingKeys(new Set(data?.permissionKeys ?? []));
  }, [roleId, data?.permissionKeys?.join(",")]);

  const savedKeys = useMemo(() => new Set(data?.permissionKeys ?? []), [data]);

  const isDirty = useMemo(() => {
    if (!pendingKeys) return false;
    if (pendingKeys.size !== savedKeys.size) return true;
    for (const k of pendingKeys) if (!savedKeys.has(k)) return true;
    return false;
  }, [pendingKeys, savedKeys]);

  const savePermsMutation = useMutation({
    mutationFn: ({ id, keys }) => runly.identity.setRolePermissions(id, [...keys], token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["identity-roles"] });
      toast.success("Permisos guardados");
    },
    onError: () => toast.error("No se pudieron guardar los permisos"),
  });

  function togglePermission(key) {
    if (!canManagePermissions) return;
    setPendingKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function togglePermissionGroup(keys, checked) {
    if (!canManagePermissions) return;
    setPendingKeys((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  if (!canReadPermissions) {
    return (
      <EmptyState
        icon={KeyRound}
        title="Sin acceso al catalogo de permisos"
        description="Necesitas el permiso identity.permissions.read para ver el catalogo."
      />
    );
  }
  if (allPermissions.length === 0) {
    return <EmptyState icon={KeyRound} title="Sin permisos disponibles" description="No hay permisos definidos en el sistema." />;
  }

  return (
    <>
      <PermissionFeatureTree
        key={roleId}
        allPermissions={allPermissions}
        pendingKeys={pendingKeys ?? savedKeys}
        baselineKeys={savedKeys}
        onTogglePermission={togglePermission}
        onBulkToggle={togglePermissionGroup}
        disabled={!canManagePermissions || savePermsMutation.isPending}
      />
      {isDirty && canManagePermissions && (
        <UnsavedChangesBar
          className="mt-4"
          message="Cambios sin guardar en permisos"
          saving={savePermsMutation.isPending}
          saveLabel="Guardar permisos"
          onDiscard={() => setPendingKeys(new Set(savedKeys))}
          onSave={() => savePermsMutation.mutate({ id: roleId, keys: pendingKeys })}
        />
      )}
    </>
  );
}
