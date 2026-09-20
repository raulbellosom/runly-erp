import { companyFetch } from '../../../lib/companyFetch.js'
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../auth/AuthProvider.jsx";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  EmptyState,
  PageHeader,
  TextField,
  LoadingState,
} from "@runly/ui";
import { toast } from "sonner";
import ThemeColorEditor from "./ThemeColorEditor.jsx";
import ThemeTypographyEditor from "./ThemeTypographyEditor.jsx";

const TABS = ["Colores", "Tipografia"];

async function apiGet(path, token) {
  const res = await companyFetch(`${getApiUrl()}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export default function WebsiteThemeScreen() {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("Colores");
  const [selectedThemeId, setSelectedThemeId] = useState(null);
  const [newThemeOpen, setNewThemeOpen] = useState(false);
  const [newThemeName, setNewThemeName] = useState("");
  const [draft, setDraft] = useState({ tokens: {}, typography: {} });
  const [isDirty, setIsDirty] = useState(false);

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const siteQuery = useQuery({
    queryKey: ["website-site", token],
    queryFn: () => apiGet("/website/site", token),
    enabled: Boolean(token),
    staleTime: 60_000,
  });
  const siteId = siteQuery.data?.data?.id ?? null;
  const site = siteQuery.data?.data ?? null;

  const themesQuery = useQuery({
    queryKey: ["website-themes", siteId, token],
    queryFn: () => apiGet(`/website/themes?siteId=${siteId}`, token),
    enabled: Boolean(token) && Boolean(siteId),
    staleTime: 30_000,
  });
  const themes = themesQuery.data?.data ?? [];

  const activeThemeId = selectedThemeId ?? themes[0]?.id ?? null;

  const themeDetailQuery = useQuery({
    queryKey: ["website-theme", activeThemeId, token],
    queryFn: () => apiGet(`/website/themes/${activeThemeId}`, token),
    enabled: Boolean(token) && Boolean(activeThemeId),
    staleTime: 30_000,
  });
  const themeDetail = themeDetailQuery.data ?? null;

  useEffect(() => {
    if (themeDetail) {
      setDraft({
        tokens: themeDetail.tokens ?? {},
        typography: themeDetail.typography ?? {},
      });
      setIsDirty(false);
    }
  }, [themeDetail?.id]);

  const createThemeMutation = useMutation({
    mutationFn: async (name) => {
      const res = await companyFetch(`${getApiUrl()}/website/themes`, {
        method: "POST",
        headers,
        body: JSON.stringify({ siteId, name, isDefault: themes.length === 0 }),
      });
      if (!res.ok)
        throw new Error(
          (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`,
        );
      return res.json();
    },
    onSuccess: (theme) => {
      toast.success("Tema creado");
      queryClient.invalidateQueries({ queryKey: ["website-themes", siteId] });
      setSelectedThemeId(theme.id);
      setNewThemeOpen(false);
      setNewThemeName("");
    },
    onError: (err) => toast.error(err.message || "Error al crear tema"),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await companyFetch(
        `${getApiUrl()}/website/themes/${activeThemeId}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify({
            tokens: draft.tokens,
            typography: draft.typography,
          }),
        },
      );
      if (!res.ok)
        throw new Error(
          (await res.json().catch(() => ({}))).error || `HTTP ${res.status}`,
        );
      return res.json();
    },
    onSuccess: () => {
      toast.success("Tema guardado");
      setIsDirty(false);
      queryClient.invalidateQueries({
        queryKey: ["website-theme", activeThemeId],
      });
    },
    onError: (err) => toast.error(err.message || "Error al guardar"),
  });

  const useSiteThemeMutation = useMutation({
    mutationFn: async () => {
      const res = await companyFetch(`${getApiUrl()}/website/site/${site.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ themeId: activeThemeId }),
      });
      if (!res.ok) throw new Error("Error al aplicar tema");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Tema aplicado al sitio");
      queryClient.invalidateQueries({ queryKey: ["website-site"] });
    },
    onError: () => toast.error("Error al aplicar el tema"),
  });

  function updateDraft(key, value) {
    setDraft((d) => ({ ...d, [key]: value }));
    setIsDirty(true);
  }

  if (siteQuery.isPending) return <LoadingState variant="page" />;

  if (!siteId) {
    return (
      <div className="p-4 md:p-6 space-y-6">
        <PageHeader
          eyebrow="Runly Website"
          title="Tema"
          description="Personaliza los colores y tipografia del sitio publico."
        />
        <EmptyState
          title="Sitio web no configurado"
          description='Configura tu sitio web primero desde la seccion "Sitio web".'
        />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 h-full">
      <PageHeader
        eyebrow="Runly Website"
        title="Tema"
        description="Personaliza los colores y tipografia del sitio publico."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/app/m/runly.website/templates")}
          >
            Cambiar plantilla
          </Button>
        }
      />

      {themesQuery.isPending ? (
        <LoadingState message="Cargando temas..." />
      ) : themes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center space-y-4">
          <p className="text-muted-foreground text-sm">No hay temas creados.</p>
          <Button size="sm" onClick={() => setNewThemeOpen(true)}>
            Crear primer tema
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Left: config editors */}
          <div className="space-y-4">
            {themes.length > 1 && (
              <div className="flex gap-2 flex-wrap">
                {themes.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => {
                      setSelectedThemeId(t.id);
                      setIsDirty(false);
                    }}
                    className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                      activeThemeId === t.id
                        ? "bg-primary text-primary-foreground border-transparent"
                        : "border-border hover:bg-muted"
                    }`}
                  >
                    {t.name}
                    {t.isDefault && (
                      <span className="ml-1 text-xs opacity-70">(activo)</span>
                    )}
                  </button>
                ))}
              </div>
            )}

            {themeDetailQuery.isPending ? (
              <LoadingState message="Cargando tema..." />
            ) : themeDetail ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex gap-1 border border-border rounded-lg p-0.5">
                    {TABS.map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                          activeTab === tab
                            ? "bg-background shadow-sm font-medium"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {tab}
                        {isDirty && (
                          <span className="ml-1 text-primary">*</span>
                        )}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-2">
                    {site?.themeId !== activeThemeId && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => useSiteThemeMutation.mutate()}
                        disabled={useSiteThemeMutation.isPending}
                      >
                        Usar este tema
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => saveMutation.mutate()}
                      disabled={saveMutation.isPending || !isDirty}
                    >
                      {saveMutation.isPending
                        ? "Guardando..."
                        : "Guardar cambios"}
                    </Button>
                  </div>
                </div>

                {activeTab === "Colores" ? (
                  <ThemeColorEditor
                    tokens={draft.tokens}
                    onChange={(tokens) => updateDraft("tokens", tokens)}
                  />
                ) : (
                  <ThemeTypographyEditor
                    typography={draft.typography}
                    onChange={(typography) =>
                      updateDraft("typography", typography)
                    }
                  />
                )}
              </div>
            ) : null}
          </div>

          {/* Right: preview panel */}
          <div className="rounded-xl border border-border bg-muted overflow-hidden sticky top-6 min-h-75">
            <div className="flex items-center justify-center h-full p-8 text-center text-muted-foreground">
              <div>
                <div
                  className="w-16 h-16 rounded-xl mb-3 mx-auto border border-border"
                  style={{ background: "var(--primary, #4F46E5)" }}
                />
                <p className="text-sm font-medium">Vista previa del tema</p>
                <p className="text-xs mt-1 text-muted-foreground">
                  Guarda los cambios para ver el efecto
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      <Dialog open={newThemeOpen} onOpenChange={setNewThemeOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Nuevo tema</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createThemeMutation.mutate(newThemeName);
            }}
            className="space-y-4 py-2"
          >
            <TextField
              label="Nombre del tema"
              value={newThemeName}
              onChange={(e) => setNewThemeName(e.target.value)}
              placeholder="Predeterminado"
              required
              autoFocus
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setNewThemeOpen(false)}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={createThemeMutation.isPending || !newThemeName.trim()}
              >
                {createThemeMutation.isPending ? "Creando..." : "Crear"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
