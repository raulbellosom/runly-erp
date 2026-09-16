// "Permisos adicionales" — additive per-user permission grants (ALLOW-only).
// Effective permissions for a user are (role) ∪ (these grants); this card never
// removes what the role provides — those rows show locked with a "Del rol" badge.
// Spec: docs/superpowers/specs/2026-09-08-per-user-permission-grants.md
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  EmptyState,
  ErrorState,
  Skeleton,
  UnsavedChangesBar,
} from "@runly/ui";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { runly } from "../../../lib/runly";
import PermissionFeatureTree from "./PermissionFeatureTree";

export default function UserPermissionGrantsCard({ userId, token, canManage }) {
  const queryClient = useQueryClient();
  const [pendingKeys, setPendingKeys] = useState(null);

  const permissionsQuery = useQuery({
    queryKey: ["identity-permissions"],
    queryFn: () => runly.identity.listPermissions(token),
    enabled: Boolean(token),
  });

  const grantsQuery = useQuery({
    queryKey: ["identity-user-grants", userId],
    queryFn: () => runly.identity.getUserPermissionGrants(userId, token),
    enabled: Boolean(token && userId),
  });

  const allPermissions = permissionsQuery.data?.data?.permissions ?? [];
  const grantedKeys = useMemo(
    () => grantsQuery.data?.data?.grantedKeys ?? [],
    [grantsQuery.data],
  );
  const roleKeys = useMemo(
    () => new Set(grantsQuery.data?.data?.roleKeys ?? []),
    [grantsQuery.data],
  );
  const savedKeys = useMemo(() => new Set(grantedKeys), [grantedKeys]);

  useEffect(() => {
    setPendingKeys(new Set(grantedKeys));
  }, [grantedKeys]);

  const isDirty = useMemo(() => {
    if (!pendingKeys) return false;
    if (pendingKeys.size !== savedKeys.size) return true;
    for (const k of pendingKeys) if (!savedKeys.has(k)) return true;
    return false;
  }, [pendingKeys, savedKeys]);

  const saveMutation = useMutation({
    mutationFn: (keys) =>
      runly.identity.setUserPermissionGrants(userId, { permissionKeys: keys }, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["identity-user-grants", userId] });
      queryClient.invalidateQueries({ queryKey: ["identity-users"] });
      toast.success("Permisos actualizados");
    },
    onError: (err) => toast.error(err?.message ?? "No se pudieron guardar los permisos"),
  });

  function togglePermission(key) {
    if (!canManage || roleKeys.has(key)) return;
    setPendingKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function bulkToggle(keys, checked) {
    if (!canManage) return;
    setPendingKeys((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (roleKeys.has(key)) continue;
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  const isLoading = permissionsQuery.isLoading || grantsQuery.isLoading;
  const isError = permissionsQuery.isError || grantsQuery.isError;

  // No outer Card here on purpose: this component only ever renders inside a
  // RunlyDetail "Permisos" section, which already provides the glass-shell
  // box + title. Wrapping it in a second Card stacked four backdrop-filter
  // blur layers on top of each other (section > this card > each module card
  // > header row), which is both visually redundant and a real cause of
  // intermittent GPU-compositing flicker on this much translucency at once.
  return (
    <div className="space-y-4">
      <p className="text-xs text-[hsl(var(--muted-foreground))] dark:text-slate-400">
        Permisos extra para esta persona, ademas de los que ya da su rol. Aqui
        no se pueden quitar los permisos del rol.
      </p>
      {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : isError ? (
          <ErrorState
            title="Error al cargar permisos"
            onRetry={() => {
              permissionsQuery.refetch();
              grantsQuery.refetch();
            }}
          />
        ) : allPermissions.length === 0 ? (
          <EmptyState
            icon={KeyRound}
            title="Sin permisos disponibles"
            description="No hay permisos definidos en el sistema."
          />
        ) : (
          <>
            <div className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))] dark:text-slate-400">
              <Badge variant="secondary" className="tabular-nums">
                {pendingKeys?.size ?? savedKeys.size} concedidos
              </Badge>
              {!canManage && (
                <Badge variant="secondary" className="text-[10px]">
                  Solo lectura
                </Badge>
              )}
            </div>
            <PermissionFeatureTree
              allPermissions={allPermissions}
              pendingKeys={pendingKeys ?? savedKeys}
              baselineKeys={savedKeys}
              lockedKeys={roleKeys}
              onTogglePermission={togglePermission}
              onBulkToggle={bulkToggle}
              disabled={!canManage || saveMutation.isPending}
            />
          </>
        )}

      {isDirty && canManage && (
        <UnsavedChangesBar
          message="Cambios sin guardar en permisos"
          saving={saveMutation.isPending}
          saveLabel="Guardar permisos"
          onDiscard={() => setPendingKeys(new Set(savedKeys))}
          onSave={() => saveMutation.mutate([...(pendingKeys ?? [])])}
        />
      )}
    </div>
  );
}
