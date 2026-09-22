import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  DataTable,
  ErrorState,
  PageHeader,
} from "@runly/ui";
import { Code2, Globe, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "../../../auth/AuthProvider.jsx";
import { useActiveCompany } from "../../../company/ActiveCompanyProvider.jsx";
import { runly } from "../../../lib/runly.js";
import { ConnectExternalSiteDialog } from "../components/ConnectExternalSiteDialog.jsx";
import { EditPropertyDialog } from "../components/EditPropertyDialog.jsx";

const KIND_LABEL = {
  website_module: "Sitio del modulo Web",
  external_sdk: "Sitio externo (SDK)",
};

const STATUS_LABEL = {
  active: "Activo",
  pending_verification: "Verificacion pendiente",
  disabled: "Desactivado",
};

const STATUS_VARIANT = {
  active: "success",
  pending_verification: "warning",
  disabled: "secondary",
};

export default function GrowthPropertiesScreen() {
  const { session, userProfile } = useAuth();
  const { activeCompany } = useActiveCompany();
  const token = session?.access_token;
  const permissions = userProfile?.permissions ?? [];
  const canAccess = Boolean(
    userProfile?.isAdmin || permissions.includes("growth.access"),
  );
  const canManage = Boolean(
    userProfile?.isAdmin || permissions.includes("growth.properties.manage"),
  );
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [snippetTarget, setSnippetTarget] = useState(null);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["growth", "properties"],
    queryFn: () => runly.growth.listProperties(token),
    enabled: Boolean(token && canAccess),
  });

  const createMutation = useMutation({
    mutationFn: (payload) => runly.growth.createProperty(payload, token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["growth", "properties"] }),
    onError: (err) => toast.error(err?.message || "No se pudo crear el sitio"),
  });

  const verifyMutation = useMutation({
    mutationFn: (propertyId) => runly.growth.verifyProperty(propertyId, token),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["growth", "properties"] }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ propertyId, payload }) => runly.growth.updateProperty(propertyId, payload, token),
    onSuccess: () => {
      toast.success("Sitio actualizado");
      setEditTarget(null);
      queryClient.invalidateQueries({ queryKey: ["growth", "properties"] });
    },
    onError: (err) => toast.error(err?.message || "No se pudo guardar el sitio"),
  });

  const properties = data?.data ?? [];

  const columns = useMemo(
    () => [
      { accessorKey: "name", header: "Nombre" },
      { accessorKey: "domain", header: "Dominio" },
      {
        accessorKey: "kind",
        header: "Tipo",
        cell: ({ row }) => KIND_LABEL[row.original.kind] ?? row.original.kind,
      },
      {
        accessorKey: "status",
        header: "Estado",
        cell: ({ row }) => (
          <Badge variant={STATUS_VARIANT[row.original.status] ?? "secondary"}>
            {STATUS_LABEL[row.original.status] ?? row.original.status}
          </Badge>
        ),
      },
      ...(canManage
        ? [
            {
              id: "actions",
              header: "",
              cell: ({ row }) => (
                <div className="flex gap-2 justify-end">
                  {row.original.kind === "external_sdk" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSnippetTarget(row.original)}
                    >
                      <Code2 className="mr-1.5 h-3.5 w-3.5" />
                      Ver codigo
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setEditTarget(row.original)}
                  >
                    <Pencil className="mr-1.5 h-3.5 w-3.5" />
                    Editar
                  </Button>
                </div>
              ),
            },
          ]
        : []),
    ],
    [canManage],
  );

  if (!canAccess) {
    return (
      <div className="min-h-dvh p-4 md:p-6">
        <PageHeader eyebrow="Runly Growth" title="Sitios conectados" />
        <ErrorState description="No tienes permisos para ver los sitios conectados." />
      </div>
    );
  }

  return (
    <div className="min-h-dvh space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="Runly Growth"
        title="Sitios conectados"
        description="Sitios rastreados por Growth, ya sea publicados con el modulo Web o conectados externamente via SDK."
        actions={
          canManage ? (
            <Button type="button" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Conectar sitio externo
            </Button>
          ) : null
        }
      />

      {isError ? (
        <ErrorState description={error?.message} onRetry={() => refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={properties}
          isLoading={isLoading}
          emptyIcon={Globe}
          emptyTitle="Sin sitios conectados"
          emptyDescription="Conecta un sitio externo o instala el modulo Web para empezar a rastrear."
          showToolbar={false}
        />
      )}

      <ConnectExternalSiteDialog
        open={dialogOpen || Boolean(snippetTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setDialogOpen(false);
            setSnippetTarget(null);
          }
        }}
        companySlug={activeCompany?.slug}
        existingProperty={snippetTarget}
        creating={createMutation.isPending}
        verifying={verifyMutation.isPending}
        onCreate={(payload) => createMutation.mutateAsync(payload).then((res) => res.data)}
        onVerify={(propertyId) => verifyMutation.mutateAsync(propertyId)}
      />

      <EditPropertyDialog
        open={Boolean(editTarget)}
        onOpenChange={(open) => { if (!open) setEditTarget(null); }}
        property={editTarget}
        saving={updateMutation.isPending}
        onSave={(payload) =>
          updateMutation.mutate({ propertyId: editTarget.id, payload })
        }
      />
    </div>
  );
}
