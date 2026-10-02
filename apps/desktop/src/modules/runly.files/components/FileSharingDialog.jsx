import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  SearchInput,
  SelectField,
  EmptyState,
  ErrorState,
  LoadingState,
  ConfirmDialog,
  PublicLinksPanel,
} from "@runly/ui";
import { Users, UserPlus, Link2, X } from "lucide-react";
import {
  UserAvatar,
  UserPickerItem,
  UserListSkeleton,
} from "../../runly.chat/components/UserPicker";
import { runly } from "../../../lib/runly";
import { filesError } from "../lib/files-error";

const ROLES = [
  { value: "VIEWER", label: "Puede ver" },
  { value: "EDITOR", label: "Puede editar" },
];
const SCOPES = [
  { value: "RESTRICTED", label: "Privado: solo personas invitadas" },
  { value: "COMPANY", label: "Toda la empresa" },
];
const LINK_MODES = [
  { value: "view", label: "Solo ver" },
  { value: "download", label: "Ver y descargar" },
];

// Public page path inside the SPA (honours VITE_BASE_PATH, e.g. /app/).
function publicFilePath(linkToken) {
  const base = String(import.meta.env?.BASE_URL || "/").replace(/\/?$/, "/");
  return `${base}p/files/${linkToken}`;
}

function unwrap(response) {
  return response?.data ?? response;
}

export function FileSharingDialog({
  file,
  token,
  userId,
  profileId,
  isCompanyAdmin,
  onClose,
  onCopyLink,
}) {
  const queryClient = useQueryClient();
  const canManageLinks = Boolean(isCompanyAdmin || (file.uploadedById && file.uploadedById === profileId));
  const linksApi = useMemo(() => {
    const withPath = (link) => ({ ...link, path: publicFilePath(link.token) });
    return {
      list: async () => (unwrap(await runly.files.listLinks(file.id, token)) ?? []).map(withPath),
      create: async ({ mode, label, expiresAt, maxUses }) =>
        withPath(unwrap(await runly.files.createLink(file.id, { mode, label, expiresAt, maxUses }, token))),
      revoke: (linkId) => runly.files.revokeLink(file.id, linkId, token),
    };
  }, [file.id, token]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState([]);
  const [role, setRole] = useState("VIEWER");
  const [revoke, setRevoke] = useState(null);
  const access = useQuery({
    queryKey: ["file-access", file.id, userId],
    queryFn: () => runly.files.getAccess(file.id, token),
    staleTime: 0,
    gcTime: 0,
  });
  const data = access.data?.data;
  const members = useQuery({
    queryKey: ["file-members", file.id, userId, search],
    queryFn: () => runly.files.accessMembers(file.id, search, token),
    enabled: Boolean(data?.canManage),
    staleTime: 0,
    gcTime: 0,
  });

  const invalidateAccess = () => {
    queryClient.invalidateQueries({ queryKey: ["file-access", file.id, userId] });
    queryClient.invalidateQueries({ queryKey: ["files-list"] });
    queryClient.invalidateQueries({ queryKey: ["file-invitations"] });
  };

  const update = useMutation({
    mutationFn: (body) => runly.files.updateAccess(file.id, body, token),
    onSuccess: () => {
      invalidateAccess();
      setRevoke(null);
    },
  });

  // Multi-invite: apply the chosen role to every selected person. Sequential so
  // the per-file row lock in changeSharing never contends, and so a partial
  // failure leaves the successful invites applied (the list refetches on settle).
  const inviteMany = useMutation({
    mutationFn: async ({ userIds, role: r }) => {
      const failures = [];
      for (const uid of userIds) {
        try {
          await runly.files.updateAccess(file.id, { userId: uid, role: r }, token);
        } catch (e) {
          failures.push(e);
        }
      }
      if (failures.length) {
        throw failures.length === userIds.length
          ? failures[0]
          : new Error(`No se pudo invitar a ${failures.length} de ${userIds.length} personas. El resto sí.`);
      }
    },
    onSettled: invalidateAccess,
    onSuccess: () => setSelected([]),
  });

  function toggle(u) {
    setSelected((prev) =>
      prev.some((s) => s.id === u.id) ? prev.filter((s) => s.id !== u.id) : [...prev, u],
    );
  }

  const options = useMemo(() => {
    const sharedIds = new Set((data?.shares ?? []).map((s) => s.userId));
    return (members.data?.data ?? []).filter(
      (u) => u.id !== data?.owner?.id && !sharedIds.has(u.id),
    );
  }, [members.data, data]);

  return (
    <>
      <Dialog
        open
        onOpenChange={(open) => {
          if (!open && !update.isPending && !inviteMany.isPending) onClose();
        }}
      >
        <DialogContent scrollable className="sm:max-w-xl max-h-[85dvh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Compartir archivo
            </DialogTitle>
            <DialogDescription className="truncate">
              {file.originalName}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
          {access.isLoading ? (
            <LoadingState message="Cargando acceso…" />
          ) : access.isError ? (
            <ErrorState
              title="No se pudo consultar el acceso"
              description={filesError(access.error)}
              onRetry={() => access.refetch()}
            />
          ) : (
            <div className="space-y-5">
              {data.canManage ? (
                <>
                  <SelectField
                    id="file-scope"
                    label="Acceso general"
                    options={SCOPES}
                    value={data.scope}
                    onChange={(scope) => update.mutate({ scope })}
                    disabled={update.isPending}
                  />
                  <p className="text-xs text-[hsl(var(--muted-foreground))]">
                    Los archivos privados solo los ven tú, las personas invitadas
                    y los administradores.
                  </p>
                  <div className="space-y-3 rounded-xl border p-4">
                    <div>
                      <label
                        htmlFor="file-recipient"
                        className="text-sm font-medium"
                      >
                        Invitar a personas de la empresa
                      </label>
                      <SearchInput
                        id="file-recipient"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Buscar nombre o correo…"
                        className="mt-1.5"
                      />
                    </div>

                    {selected.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {selected.map((u) => (
                          <span
                            key={u.id}
                            className="inline-flex items-center gap-1.5 rounded-full bg-[hsl(var(--muted))] py-1 pl-1 pr-2 text-xs"
                          >
                            <UserAvatar user={u} size="sm" />
                            <span className="max-w-36 truncate">
                              {u.displayName}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggle(u)}
                              aria-label={`Quitar a ${u.displayName}`}
                              className="rounded-full p-0.5 hover:bg-[hsl(var(--border))]"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="max-h-56 overflow-y-auto rounded-lg border p-1">
                      {members.isError ? (
                        <p role="alert" className="px-3 py-4 text-sm text-destructive">
                          No se pudieron cargar las personas. Vuelve a buscar.
                        </p>
                      ) : members.isFetching && !members.data ? (
                        <UserListSkeleton />
                      ) : options.length === 0 ? (
                        <p className="px-3 py-4 text-sm text-[hsl(var(--muted-foreground))]">
                          {members.isFetching
                            ? "Buscando…"
                            : "Sin personas disponibles"}
                        </p>
                      ) : (
                        options.map((u) => (
                          <UserPickerItem
                            key={u.id}
                            user={u}
                            selected={selected.some((s) => s.id === u.id)}
                            onToggle={toggle}
                          />
                        ))
                      )}
                    </div>

                    <div className="flex items-end gap-3">
                      <div className="flex-1">
                        <SelectField
                          id="invite-role"
                          label="Permiso"
                          value={role}
                          onChange={setRole}
                          options={ROLES}
                          disabled={inviteMany.isPending}
                        />
                      </div>
                      <Button
                        onClick={() =>
                          inviteMany.mutate({
                            userIds: selected.map((s) => s.id),
                            role,
                          })
                        }
                        disabled={selected.length === 0 || inviteMany.isPending}
                      >
                        <UserPlus className="h-4 w-4" />
                        {inviteMany.isPending
                          ? "Invitando…"
                          : `Invitar${selected.length ? ` (${selected.length})` : ""}`}
                      </Button>
                    </div>
                    {inviteMany.isError && (
                      <p role="alert" className="text-sm text-destructive">
                        {filesError(inviteMany.error)}
                      </p>
                    )}
                    <p className="text-xs text-[hsl(var(--muted-foreground))]">
                      Cada invitación aparecerá en Archivos → Invitaciones.
                    </p>
                  </div>
                </>
              ) : (
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  {file.entityType === "AtlasFile"
                    ? "El propietario o un administrador gestiona el acceso a este documento."
                    : "Este adjunto lo ve quien tenga acceso al registro en su módulo de origen."}
                </p>
              )}
              {data.owner && (
                <div className="flex items-center gap-2 text-sm">
                  <UserAvatar user={data.owner} size="sm" />
                  <span className="min-w-0 flex-1 truncate">
                    {data.owner.displayName}
                  </span>
                  <Badge variant="secondary">Propietario</Badge>
                </div>
              )}
              {data.canManage &&
                (data.shares.length ? (
                  <ul className="space-y-3">
                    {data.shares.map((share) => (
                      <li
                        key={share.id}
                        className="flex flex-wrap items-center gap-2 border-t pt-3"
                      >
                        <UserAvatar
                          user={share.user ?? { displayName: "Usuario" }}
                          size="sm"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {share.user?.displayName ?? "Usuario"}
                          </p>
                          <p className="text-xs text-[hsl(var(--muted-foreground))]">
                            {share.status === "ACCEPTED"
                              ? "Aceptada"
                              : share.status === "DECLINED"
                                ? "Rechazada"
                                : "Pendiente de aceptar"}
                          </p>
                        </div>
                        <SelectField
                          id={`share-${share.id}`}
                          label={`Permiso de ${share.user?.displayName ?? "usuario"}`}
                          value={share.role}
                          options={ROLES}
                          onChange={(next) =>
                            update.mutate({ userId: share.userId, role: next })
                          }
                          disabled={update.isPending}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setRevoke(share)}
                          disabled={update.isPending}
                        >
                          Retirar
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState
                    variant="compact"
                    title="Todavía no hay invitaciones a este documento."
                  />
                ))}
              {update.isError && (
                <p role="alert" className="text-sm text-destructive">
                  {filesError(update.error)}
                </p>
              )}
              <Button variant="outline" onClick={() => onCopyLink(file)}>
                <Link2 className="h-4 w-4" />
                Copiar enlace de Runly
              </Button>
              {canManageLinks && file.enabled !== false && (
                <div className="border-t pt-4">
                  <PublicLinksPanel
                    title="Enlaces públicos"
                    api={linksApi}
                    modes={LINK_MODES}
                  />
                </div>
              )}
            </div>
          )}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={Boolean(revoke)}
        onOpenChange={(open) => {
          if (!open) setRevoke(null);
        }}
        title="Retirar acceso"
        description="Se eliminará la invitación y el acceso concedido. Si el acceso general permite a la empresa entrar, esa persona conservará ese acceso general."
        confirmLabel="Retirar"
        onConfirm={() =>
          update.mutateAsync({
            userId: revoke.userId,
            role: revoke.role,
            revoke: true,
          })
        }
      />
    </>
  );
}
