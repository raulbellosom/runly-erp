import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button, EmptyState, Skeleton, formatBytes, getFileKind } from "@runly/ui";
import { Download, FileText, LinkIcon } from "lucide-react";
import { getApiUrl } from "../../../lib/runtimeConfig.js";

const UNAVAILABLE = {
  revocado: "El propietario revocó este enlace.",
  vencido: "Este enlace ya venció.",
  agotado: "Este enlace alcanzó su número máximo de usos.",
  no_disponible: "Este archivo ya no está disponible.",
};

async function publicFetch(path) {
  const response = await fetch(`${getApiUrl()}${path}`);
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json.error ?? "Enlace no disponible");
    error.reason = json.reason ?? null;
    throw error;
  }
  return json.data;
}

function Preview({ file }) {
  const kind = getFileKind({ mimeType: file.mimeType, originalName: file.name });
  if (file.previewUrl && kind === "image") {
    return <img src={file.previewUrl} alt={file.name} className="mx-auto max-h-[70dvh] max-w-full rounded-xl object-contain" />;
  }
  if (file.previewUrl && file.mimeType === "application/pdf") {
    return <iframe src={file.previewUrl} title={file.name} className="h-[70dvh] w-full rounded-xl border border-[hsl(var(--border))]" />;
  }
  return (
    <EmptyState
      icon={FileText}
      title="Vista previa no disponible"
      description={file.downloadUrl ? "Descarga el archivo para abrirlo." : "Este tipo de archivo no se puede mostrar en el navegador."}
    />
  );
}

// Anonymous view/download page for a runly.files public link.
export default function PublicFileScreen() {
  const { token } = useParams();
  const query = useQuery({
    queryKey: ["public-file", token],
    queryFn: () => publicFetch(`/public/files/${encodeURIComponent(token)}`),
    retry: false,
    // Each load counts as one use of the link; never refetch on focus.
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });
  const file = query.data;

  if (query.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <EmptyState
          icon={LinkIcon}
          title="Este enlace ya no está disponible"
          description={UNAVAILABLE[query.error.reason] ?? "Este enlace no existe o ya no está activo. Pide uno nuevo a quien te lo compartió."}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-4xl flex-col gap-4 p-4 md:p-8">
      <header className="flex items-center gap-3">
        {file?.company?.logoUrl ? <img src={file.company.logoUrl} alt={file.company.name} className="h-8 w-8 shrink-0 rounded-md object-contain" /> : null}
        <div className="min-w-0 flex-1">
          {query.isLoading ? (
            <Skeleton className="h-4 w-48" />
          ) : (
            <>
              <h1 className="truncate text-base font-semibold">{file.name}</h1>
              <p className="text-xs text-[hsl(var(--muted-foreground))]">
                {formatBytes(file.sizeBytes)}
                {file.company?.name ? ` · Compartido por ${file.company.name}` : ""}
              </p>
            </>
          )}
        </div>
        {file?.downloadUrl ? (
          <Button asChild>
            <a href={file.downloadUrl} rel="noopener noreferrer">
              <Download className="h-4 w-4" />
              Descargar
            </a>
          </Button>
        ) : null}
      </header>
      {query.isLoading ? <Skeleton className="h-[60dvh] w-full rounded-xl" /> : <Preview file={file} />}
    </div>
  );
}
