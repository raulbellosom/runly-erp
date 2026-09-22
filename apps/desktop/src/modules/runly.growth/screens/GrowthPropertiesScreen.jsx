import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  DataTable,
  ErrorState,
  PageHeader,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@runly/ui";
import { Code2, Globe, HelpCircle, Pencil, Plus, RefreshCw } from "lucide-react";
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

function ConnectHelpPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="icon" aria-label="Ayuda sobre sitios conectados">
          <HelpCircle className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 space-y-3 text-sm" align="end">
        <div>
          <p className="font-semibold text-[hsl(var(--foreground))]">Como conectar un sitio externo</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-4 text-[hsl(var(--muted-foreground))]">
            <li>"Conectar sitio externo" → dale un nombre y su dominio.</li>
            <li>Copia el snippet generado (botón "Ver codigo" si necesitas verlo de nuevo despues).</li>
            <li>Pegalo antes de <code className="font-mono">{"</body>"}</code> en el sitio externo y publicalo.</li>
            <li>Vuelve aqui y dale click a "Verificar" — solo pasa a Activo cuando llega el primer evento real.</li>
          </ol>
        </div>
        <div className="border-t border-[hsl(var(--border))] pt-2">
          <p className="font-semibold text-[hsl(var(--foreground))]">Estados</p>
          <ul className="mt-1 space-y-1 text-[hsl(var(--muted-foreground))]">
            <li><Badge variant="warning">Verificacion pendiente</Badge> — creado, pero aun no llega ningun evento.</li>
            <li><Badge variant="success">Activo</Badge> — ya recibimos al menos un evento real de ese sitio.</li>
          </ul>
        </div>
        <p className="border-t border-[hsl(var(--border))] pt-2 text-xs text-[hsl(var(--muted-foreground))]">
          Si el sitio usa CAPTCHA (Turnstile), configura las claves en "Editar" y vuelve a copiar el snippet —
          el widget solo se activa si esas claves ya estaban en el codigo pegado.
        </p>
      </PopoverContent>
    </Popover>
  );
}

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

  async function handleVerify(propertyId) {
    const result = await verifyMutation.mutateAsync(propertyId);
    if (result?.verified) {
      toast.success("Sitio verificado: ya estamos recibiendo datos.");
    } else {
      toast.info(
        "Aun no recibimos eventos de ese sitio. Verifica que el snippet este publicado.",
      );
    }
    return result;
  }

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
                  {row.original.kind === "external_sdk" && row.original.status === "pending_verification" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={verifyMutation.isPending}
                      onClick={() => handleVerify(row.original.id)}
                    >
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      Verificar
                    </Button>
                  )}
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
    [canManage, verifyMutation.isPending],
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
          <div className="flex items-center gap-2">
            <ConnectHelpPopover />
            {canManage ? (
              <Button type="button" onClick={() => setDialogOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Conectar sitio externo
              </Button>
            ) : null}
          </div>
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
