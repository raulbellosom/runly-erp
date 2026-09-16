import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import {
  Button,
  ErrorState,
  PageHeader,
  RunlyCrudView,
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  TextField,
} from "@runly/ui";
import { Shield } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { useActiveCompany } from "../../../company/ActiveCompanyProvider";
import { runly } from "../../../lib/runly";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import { IDENTITY_ROLE_TABLE } from "../blueprints/identity-role-table.blueprint.js";

const API_BASE_URL = getApiUrl();

export default function RolesScreen() {
  const navigate = useNavigate();
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const { activeCompanyId } = useActiveCompany();
  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (key) => Boolean(userProfile?.isAdmin || permissions.includes(key));
  const canReadRoles = hasPermission("identity.roles.read");
  const canCreateRoles = hasPermission("identity.roles.create");
  const queryClient = useQueryClient();

  const [sheetOpen, setSheetOpen] = useState(false);

  const createRoleMutation = useMutation({
    mutationFn: (data) => runly.identity.createRole(data, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["identity-roles"] });
      setSheetOpen(false);
      toast.success("Rol creado");
    },
    onError: () => toast.error("No se pudo crear el rol"),
  });

  const {
    register: registerCreate,
    handleSubmit: handleCreateSubmit,
    reset: resetCreate,
    formState: { errors: createErrors },
  } = useForm({ defaultValues: { key: "", name: "", description: "" } });

  function onCreateSubmit(data) {
    createRoleMutation.mutate(data);
  }

  return (
    <div className="p-4 md:p-6 space-y-6 min-h-dvh">
      <PageHeader
        eyebrow="Runly Identity"
        title="Roles y permisos"
        description="Define roles y asigna permisos para controlar el acceso en tu instancia."
        actions={
          canCreateRoles && (
            <Button
              onClick={() => {
                resetCreate();
                setSheetOpen(true);
              }}
            >
              <Shield className="h-4 w-4" />
              Nuevo rol
            </Button>
          )
        }
      />

      {!canReadRoles ? (
        <ErrorState title="No tienes permisos para consultar roles." />
      ) : (
        <RunlyCrudView
          tableBlueprint={IDENTITY_ROLE_TABLE}
          token={token}
          companyId={activeCompanyId}
          apiBaseUrl={API_BASE_URL}
          suppressToolbarCreate
          onNavigate={({ recordId }) => {
            if (recordId) navigate(`/app/m/runly.identity/identity/roles/${recordId}`);
          }}
        />
      )}

      <Sheet
        open={sheetOpen}
        onOpenChange={(v) => {
          if (!createRoleMutation.isPending) setSheetOpen(v);
        }}
      >
        <SheetContent className="sm:max-w-md lg:max-w-xl xl:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Nuevo rol</SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto py-4">
            <form id="create-role-form" onSubmit={handleCreateSubmit(onCreateSubmit)} className="space-y-4">
              <TextField
                label="Clave interna"
                required
                placeholder="ej. ventas.supervisor"
                error={createErrors.key?.message}
                {...registerCreate("key", { required: "La clave es obligatoria" })}
              />
              <TextField
                label="Nombre visible"
                required
                placeholder="Supervisor de ventas"
                error={createErrors.name?.message}
                {...registerCreate("name", { required: "El nombre es obligatorio" })}
              />
              <TextField
                label="Descripcion"
                placeholder="Gestiona equipo y operaciones comerciales (opcional)"
                {...registerCreate("description")}
              />
            </form>
          </div>
          <SheetFooter className="gap-2">
            <Button variant="outline" onClick={() => setSheetOpen(false)} disabled={createRoleMutation.isPending}>
              Cancelar
            </Button>
            <Button type="submit" form="create-role-form" disabled={createRoleMutation.isPending}>
              {createRoleMutation.isPending ? "Creando..." : "Crear rol"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
