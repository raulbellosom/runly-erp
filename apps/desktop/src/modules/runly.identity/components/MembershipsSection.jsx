import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Badge, Button, SelectField, SwitchField, Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, EmptyState } from "@runly/ui";
import { Building2, Plus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";
import { CompanyLogo } from "../../../components/CompanySwitcher";

const NO_ROLE_VALUE = "__none__";

function roleOptionsForCompany(roles, companyId) {
  return [
    { value: NO_ROLE_VALUE, label: "Sin rol" },
    ...roles
      .filter((role) => role.companyId === null || role.companyId === companyId)
      .map((role) => ({ value: role.id, label: role.name })),
  ];
}

export default function MembershipsSection({ data }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const userId = data?.id;
  const memberships = data?.memberships ?? [];
  const [addOpen, setAddOpen] = useState(false);
  const [addCompanyId, setAddCompanyId] = useState("");
  const [addRoleId, setAddRoleId] = useState(NO_ROLE_VALUE);
  const [savingMembershipId, setSavingMembershipId] = useState(null);

  const rolesQuery = useQuery({
    queryKey: ["identity-roles"],
    queryFn: () => runly.identity.listRoles(token),
    enabled: Boolean(token),
  });
  const companiesQuery = useQuery({
    queryKey: ["identity-company-options"],
    queryFn: () => runly.identity.listCompanyOptions(token),
    enabled: Boolean(token) && addOpen,
  });
  const roles = rolesQuery.data?.data ?? [];
  const companies = companiesQuery.data?.data ?? [];

  const assignedCompanyIds = useMemo(() => new Set(memberships.filter((m) => m.enabled).map((m) => m.companyId)), [memberships]);
  const companyOptions = companies
    .filter((c) => !assignedCompanyIds.has(c.id))
    .map((c) => ({ value: c.id, label: c.name }));

  const updateMutation = useMutation({
    mutationFn: ({ membershipId, patch }) => runly.identity.updateMembership(userId, membershipId, patch, token),
    onMutate: ({ membershipId }) => setSavingMembershipId(membershipId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["identity-user", userId] });
      toast.success("Membresía actualizada");
    },
    onError: (err) => toast.error(err?.message || "No se pudo actualizar la membresía"),
    onSettled: () => setSavingMembershipId(null),
  });

  const createMutation = useMutation({
    mutationFn: (payload) => runly.identity.createMembership(userId, payload, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["identity-user", userId] });
      toast.success("Empresa asignada");
      setAddOpen(false);
      setAddCompanyId("");
      setAddRoleId(NO_ROLE_VALUE);
    },
    onError: (err) => toast.error(err?.message || "No se pudo asignar la empresa"),
  });

  if (!userId) return null;

  return (
    <div className="space-y-3">
      {memberships.length === 0 ? (
        <EmptyState icon={Building2} title="Sin empresas asignadas" description="Este usuario no tiene acceso a ninguna empresa todavía." />
      ) : (
        <div className="space-y-3">
          {memberships.map((membership) => (
            <div key={membership.id} className="flex flex-col gap-3 rounded-lg border border-[hsl(var(--border))] p-3">
              <div className="flex items-center gap-2.5">
                <CompanyLogo
                  company={{
                    name: membership.companyName,
                    logoUrl: membership.companyLogoUrl,
                    primaryColor: membership.companyPrimaryColor,
                  }}
                  size={28}
                />
                <p
                  className="min-w-0 flex-1 text-sm font-medium leading-snug"
                  title={membership.companyName ?? "Empresa"}
                >
                  {membership.companyName ?? "Empresa"}
                </p>
                <Badge variant={membership.enabled ? "success" : "secondary"} className="shrink-0">
                  {membership.enabled ? "Activo" : "Inactivo"}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <SelectField
                  className="flex-1"
                  value={membership.roleId ?? NO_ROLE_VALUE}
                  options={roleOptionsForCompany(roles, membership.companyId)}
                  disabled={savingMembershipId === membership.id}
                  onValueChange={(value) =>
                    updateMutation.mutate({
                      membershipId: membership.id,
                      patch: { roleId: value === NO_ROLE_VALUE ? null : value },
                    })
                  }
                />
                <SwitchField
                  checked={membership.enabled}
                  disabled={savingMembershipId === membership.id}
                  onChange={(checked) =>
                    updateMutation.mutate({ membershipId: membership.id, patch: { enabled: checked } })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
        <Plus className="h-4 w-4" />
        Agregar empresa
      </Button>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Agregar empresa</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <SelectField
              label="Empresa"
              placeholder="Seleccionar empresa"
              value={addCompanyId}
              options={companyOptions}
              onValueChange={setAddCompanyId}
            />
            <SelectField
              label="Rol"
              value={addRoleId}
              options={roleOptionsForCompany(roles, addCompanyId)}
              onValueChange={setAddRoleId}
              disabled={!addCompanyId}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={!addCompanyId || createMutation.isPending}
              onClick={() =>
                createMutation.mutate({
                  companyId: addCompanyId,
                  roleId: addRoleId === NO_ROLE_VALUE ? null : addRoleId,
                })
              }
            >
              {createMutation.isPending ? "Guardando..." : "Agregar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
