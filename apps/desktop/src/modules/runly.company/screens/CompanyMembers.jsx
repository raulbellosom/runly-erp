import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  EmptyState,
  ErrorState,
  PageHeader,
  SearchInput,
  SelectField,
  Skeleton,
  SwitchField,
} from "@runly/ui";
import { useNavigate } from "react-router-dom";
import { Users, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";

const NO_ROLE_VALUE = "__none__";

function MemberAvatar({ member }) {
  const initials = (member?.displayName || member?.email || "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  if (member?.avatarUrl) {
    return (
      <img
        src={member.avatarUrl}
        alt={member.displayName}
        className="h-9 w-9 rounded-full object-cover shrink-0"
      />
    );
  }
  return (
    <div
      className="h-9 w-9 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0"
      style={{ backgroundColor: "var(--brand-primary)" }}
    >
      {initials}
    </div>
  );
}

export default function CompanyMembers() {
  const navigate = useNavigate();
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const canRead = Boolean(
    userProfile?.isAdmin || userProfile?.permissions?.includes("company.members.read"),
  );
  const canManage = Boolean(
    userProfile?.isAdmin || userProfile?.permissions?.includes("company.members.manage"),
  );
  const canOpenIdentity = Boolean(
    userProfile?.isAdmin || userProfile?.permissions?.includes("identity.users.read"),
  );

  const { data, isLoading } = useQuery({
    queryKey: ["company-members"],
    queryFn: () => runly.company.listMembers(token),
    enabled: Boolean(token) && canRead,
  });
  const rolesQuery = useQuery({
    queryKey: ["company-member-roles"],
    queryFn: () => runly.company.listMemberRoles(token),
    enabled: Boolean(token) && canRead,
  });
  const members = data?.data ?? [];
  const roles = rolesQuery.data?.data ?? [];
  const roleOptions = [{ value: NO_ROLE_VALUE, label: "Sin rol" }, ...roles.map((r) => ({ value: r.id, label: r.name }))];

  const [savingMembershipId, setSavingMembershipId] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);
  const [addRoleId, setAddRoleId] = useState(NO_ROLE_VALUE);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (!addOpen) {
      setQuery("");
      setResults([]);
      setSelected(null);
      setAddRoleId(NO_ROLE_VALUE);
    }
  }, [addOpen]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await runly.company.searchMemberCandidates(query.trim(), token);
        setResults(res?.data ?? []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, token]);

  const updateMutation = useMutation({
    mutationFn: ({ membershipId, patch }) => runly.company.updateMember(membershipId, patch, token),
    onMutate: ({ membershipId }) => setSavingMembershipId(membershipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-members"] });
      toast.success("Membresía actualizada");
    },
    onError: (err) => toast.error(err?.message || "No se pudo actualizar la membresía"),
    onSettled: () => setSavingMembershipId(null),
  });

  const addMutation = useMutation({
    mutationFn: (payload) => runly.company.addMember(payload, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-members"] });
      toast.success("Miembro agregado");
      setAddOpen(false);
    },
    onError: (err) => toast.error(err?.message || "No se pudo agregar el miembro"),
  });

  const disabled = !canManage;

  return (
    <div className="flex flex-col min-h-full">
      <div className="flex-1 p-4 md:p-6">
        <div className="space-y-6">
          <PageHeader
            eyebrow="Empresa"
            title="Miembros"
            description="Usuarios con acceso a esta empresa."
            actions={
              <>
                {canOpenIdentity && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate("/app/m/runly.identity/identity/users")}
                  >
                    Gestión avanzada de usuarios
                  </Button>
                )}
                {canManage && (
                  <Button type="button" onClick={() => setAddOpen(true)}>
                    <UserPlus className="h-4 w-4" />
                    Agregar miembro
                  </Button>
                )}
              </>
            }
          />

          {!canRead ? (
            <ErrorState message="No tienes permisos para consultar los miembros de la empresa." />
          ) : (
            <Card className="p-6 space-y-4">
              {isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : members.length === 0 ? (
                <EmptyState
                  icon={Users}
                  title="Sin miembros"
                  description="Esta empresa todavía no tiene miembros."
                />
              ) : (
                <div className="space-y-2">
                  {members.map((member) => (
                    <div
                      key={member.membershipId}
                      className="flex flex-col gap-2 rounded-lg border border-[hsl(var(--border))] p-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <MemberAvatar member={member} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{member.displayName || "Usuario"}</p>
                          <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{member.email}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {canManage ? (
                          <>
                            <SelectField
                              value={member.roleId ?? NO_ROLE_VALUE}
                              options={roleOptions}
                              disabled={savingMembershipId === member.membershipId}
                              onValueChange={(value) =>
                                updateMutation.mutate({
                                  membershipId: member.membershipId,
                                  patch: { roleId: value === NO_ROLE_VALUE ? null : value },
                                })
                              }
                            />
                            <SwitchField
                              checked={member.enabled}
                              disabled={savingMembershipId === member.membershipId}
                              onChange={(checked) =>
                                updateMutation.mutate({
                                  membershipId: member.membershipId,
                                  patch: { enabled: checked },
                                })
                              }
                            />
                          </>
                        ) : (
                          <span className="text-xs text-[hsl(var(--muted-foreground))]">
                            {member.roleName ?? "Sin rol"} · {member.enabled ? "Activo" : "Deshabilitado"}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar miembro</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!selected ? (
              <>
                <SearchInput
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onClear={() => setQuery("")}
                  placeholder="Nombre o correo electrónico..."
                  autoFocus
                />
                {query.trim().length >= 2 && (
                  <div className="max-h-52 overflow-y-auto rounded-md border border-[hsl(var(--border))]">
                    {searching && (
                      <div className="p-3 text-sm text-[hsl(var(--muted-foreground))]">Buscando...</div>
                    )}
                    {!searching && results.length === 0 && (
                      <div className="p-3 text-sm text-[hsl(var(--muted-foreground))]">
                        No se encontraron usuarios.
                      </div>
                    )}
                    {!searching &&
                      results.map((candidate) => (
                        <button
                          key={candidate.userId}
                          type="button"
                          onClick={() => setSelected(candidate)}
                          className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[hsl(var(--muted)/0.5)] transition-colors"
                        >
                          <MemberAvatar member={candidate} />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{candidate.displayName}</p>
                            <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{candidate.email}</p>
                          </div>
                        </button>
                      ))}
                  </div>
                )}
              </>
            ) : (
              <div className="flex items-center gap-3 rounded-md border border-[hsl(var(--border))] px-3 py-2">
                <MemberAvatar member={selected} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{selected.displayName}</p>
                  <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{selected.email}</p>
                </div>
                <Button variant="ghost" size="sm" type="button" onClick={() => setSelected(null)}>
                  Cambiar
                </Button>
              </div>
            )}

            <SelectField
              label="Rol"
              value={addRoleId}
              options={roleOptions}
              onValueChange={setAddRoleId}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!selected || addMutation.isPending}
              onClick={() =>
                addMutation.mutate({
                  userId: selected.userId,
                  roleId: addRoleId === NO_ROLE_VALUE ? null : addRoleId,
                })
              }
            >
              {addMutation.isPending ? "Agregando..." : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
