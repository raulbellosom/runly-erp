import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  PageHeader,
  Input,
  EmptyState,
  ErrorState,
  MarkdownViewer,
} from "@runly/ui";
import { runly } from "../lib/runly";
import { useAuth } from "../auth/AuthProvider";

export function HelpCenterScreen() {
  const { session } = useAuth();
  const token = session?.access_token;
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState("");
  // Deep-linked from the Ctrl+K search palette's "Ayuda" results
  // (search-providers.js's helpProvider.target), which pass ?module=<key>.
  const [selectedModuleKey, setSelectedModuleKey] = useState(() => searchParams.get("module"));

  const modulesQuery = useQuery({
    queryKey: ["help", "modules"],
    queryFn: () => runly.help.listModules(token).then((r) => r.data),
    enabled: Boolean(token),
  });

  const moduleQuery = useQuery({
    queryKey: ["help", "module", selectedModuleKey],
    queryFn: () => runly.help.getModuleHelp(selectedModuleKey, token).then((r) => r.data),
    enabled: Boolean(token) && Boolean(selectedModuleKey),
  });

  const searchQuery = useQuery({
    queryKey: ["help", "search", query],
    queryFn: () => runly.help.searchHelp(query, token).then((r) => r.data),
    enabled: Boolean(token) && query.trim().length >= 2,
  });

  const isSearching = query.trim().length >= 2;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <PageHeader title="Ayuda" description="Documentacion de los modulos instalados en esta instancia." />

      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelectedModuleKey(null);
        }}
        placeholder="Buscar en la ayuda..."
        className="mb-6"
      />

      {isSearching && (
        <div className="space-y-4">
          {searchQuery.isLoading && <p className="text-sm text-[hsl(var(--muted-foreground))]">Buscando...</p>}
          {searchQuery.isError && <ErrorState description="No se pudo completar la busqueda." />}
          {searchQuery.data?.length === 0 && (
            <EmptyState title="Sin resultados" description="Prueba con otras palabras." />
          )}
          {searchQuery.data?.map((r) => (
            <button
              key={`${r.moduleKey}-${r.viewKey ?? "overview"}`}
              type="button"
              onClick={() => {
                setSelectedModuleKey(r.moduleKey);
                setQuery("");
              }}
              className="block w-full text-left rounded-lg border border-[hsl(var(--border))] p-3 hover:bg-[hsl(var(--muted))] transition-colors"
            >
              <p className="text-xs uppercase tracking-wide text-[hsl(var(--muted-foreground))]">{r.moduleName}</p>
              <p className="text-sm font-medium">{r.title}</p>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">{r.snippet}</p>
            </button>
          ))}
        </div>
      )}

      {!isSearching && !selectedModuleKey && (
        <div className="grid gap-3 sm:grid-cols-2">
          {modulesQuery.isLoading && <p className="text-sm text-[hsl(var(--muted-foreground))]">Cargando...</p>}
          {modulesQuery.data?.length === 0 && (
            <EmptyState title="Aun no hay ayuda disponible" description="Vuelve mas tarde." />
          )}
          {modulesQuery.data?.map((m) => (
            <button
              key={m.moduleKey}
              type="button"
              onClick={() => setSelectedModuleKey(m.moduleKey)}
              className="text-left rounded-lg border border-[hsl(var(--border))] p-4 hover:bg-[hsl(var(--muted))] transition-colors"
            >
              <p className="text-sm font-semibold">{m.name}</p>
              <p className="text-sm text-[hsl(var(--muted-foreground))]">{m.summary}</p>
            </button>
          ))}
        </div>
      )}

      {!isSearching && selectedModuleKey && (
        <div>
          <button
            type="button"
            onClick={() => setSelectedModuleKey(null)}
            className="mb-4 text-xs text-[hsl(var(--primary))] hover:underline"
          >
            Volver a modulos
          </button>
          {moduleQuery.isLoading && <p className="text-sm text-[hsl(var(--muted-foreground))]">Cargando...</p>}
          {moduleQuery.data?.overview && (
            <div className="mb-6">
              <h2 className="text-lg font-semibold mb-2">{moduleQuery.data.overview.title}</h2>
              <MarkdownViewer value={moduleQuery.data.overview.content} />
            </div>
          )}
          {moduleQuery.data?.views?.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Pestanas documentadas</h3>
              {moduleQuery.data.views.map((v) => (
                <div key={v.viewKey} className="rounded-lg border border-[hsl(var(--border))] p-3">
                  <p className="text-sm font-medium">{v.title}</p>
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">{v.summary}</p>
                </div>
              ))}
            </div>
          )}
          {!moduleQuery.isLoading && !moduleQuery.data?.overview && (
            <EmptyState title="Aun no hay ayuda para este modulo" />
          )}
        </div>
      )}
    </div>
  );
}
