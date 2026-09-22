import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AdvancedFileViewer,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  PageHeader,
} from "@runly/ui";
import { Download, Files } from "lucide-react";
import { toast } from "sonner";

import { useAuth } from "../../../auth/AuthProvider.jsx";
import { runly } from "../../../lib/runly.js";

function formatDate(value) {
  if (!value) return "Pendiente";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function GeneratedDocumentsScreen() {
  const queryClient = useQueryClient();
  const { session, userProfile } = useAuth();
  const token = session?.access_token;
  const permissions = userProfile?.permissions ?? [];
  const allowed = (key) => userProfile?.isAdmin || permissions.includes(key);
  const [toggleTarget, setToggleTarget] = useState(null);
  const [viewerFile, setViewerFile] = useState(null);
  const query = useQuery({
    queryKey: ["documents", "generated"],
    queryFn: () => runly.documents.listGenerated(token, { enabled: true, pageSize: 100 }),
    enabled: Boolean(token && allowed("documents.generated.read")),
  });
  const disableMutation = useMutation({
    mutationFn: (item) => runly.documents.setGeneratedEnabled(item.id, false, token),
    onSuccess: async () => {
      setToggleTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["documents", "generated"] });
    },
    onError: (error) => toast.error(error.message),
  });

  async function openDocument(item) {
    try {
      const download = await runly.documents.getGeneratedDownload(item.id, token);
      setViewerFile({
        id: item.fileAsset?.id ?? item.id,
        originalName: item.fileAsset?.originalName ?? `${item.template?.name ?? "documento"}.pdf`,
        mimeType: "application/pdf",
        signedUrl: download.url,
      });
    } catch (error) {
      toast.error(error.message);
    }
  }

  const columns = useMemo(() => [
    {
      id: "document",
      header: "Documento",
      cell: ({ row }) => (
        <button type="button" className="text-left font-medium hover:underline" onClick={() => openDocument(row.original)}>
          {row.original.template?.name ?? "Documento"}
          <span className="block text-xs text-[hsl(var(--muted-foreground))]">
            Version {row.original.version?.versionNumber ?? "-"}
          </span>
        </button>
      ),
    },
    { accessorKey: "sourceType", header: "Origen" },
    {
      id: "status",
      header: "Estado",
      cell: ({ row }) => <Badge variant={row.original.status === "ready" ? "success" : "secondary"}>{row.original.status}</Badge>,
    },
    {
      id: "date",
      header: "Generado",
      cell: ({ row }) => formatDate(row.original.generatedAt),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => openDocument(row.original)}>
            <Download className="h-4 w-4" />
          </Button>
          {allowed("documents.generated.delete") ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setToggleTarget(row.original)}>
              Desactivar
            </Button>
          ) : null}
        </div>
      ),
    },
  ], [permissions, userProfile?.isAdmin, token]);

  return (
    <div className="min-h-dvh space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="Runly Documents"
        title="Documentos generados"
        description="Historial de PDFs vinculados a sus entidades de origen."
      />
      <DataTable
        columns={columns}
        data={query.data?.items ?? []}
        isLoading={query.isLoading}
        isError={query.isError}
        onRetry={() => query.refetch()}
        emptyIcon={Files}
        emptyTitle="No hay documentos generados"
        emptyDescription="Los PDFs generados desde Growth apareceran aqui."
      />
      {viewerFile && (
        <AdvancedFileViewer
          open={Boolean(viewerFile)}
          onOpenChange={(open) => !open && setViewerFile(null)}
          files={[viewerFile]}
          activeIndex={0}
          onIndexChange={() => {}}
          onResolveSignedUrl={(file) => file.signedUrl}
        />
      )}
      <ConfirmDialog
        open={Boolean(toggleTarget)}
        onOpenChange={(open) => !open && setToggleTarget(null)}
        title="Desactivar documento"
        description="El archivo dejara de aparecer en el historial activo."
        confirmLabel="Desactivar"
        onConfirm={() => disableMutation.mutate(toggleTarget)}
        loading={disableMutation.isPending}
      />
    </div>
  );
}
