import { companyFetch } from '../../../lib/companyFetch.js'
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/AuthProvider.jsx";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import {
  Badge,
  Button,
  SelectField,
  Switch,
  StatCard,
  PageHeader,
  TextField,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  LoadingState,
} from "@runly/ui";
import { Globe, FileText, BookOpen, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import WebsiteWizard from "./WebsiteWizard.jsx";

const SITE_TYPES = [
  { value: "website", label: "Sitio informativo" },
  { value: "ecommerce", label: "Tienda online" },
  { value: "blog", label: "Blog / Contenido" },
  { value: "landing", label: "Landing page" },
];

async function apiFetch(path, token, options = {}) {
  const res = await companyFetch(`${getApiUrl()}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export default function WebsiteOverviewScreen() {
  const { session } = useAuth();
  const token = session?.access_token;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [formName, setFormName] = useState("");
  const [formDomain, setFormDomain] = useState("");
  const [formSiteType, setFormSiteType] = useState("website");

  const siteQuery = useQuery({
    queryKey: ["website-site", token],
    queryFn: () => apiFetch("/website/site", token),
    enabled: Boolean(token),
    staleTime: 60_000,
  });

  const site = siteQuery.data?.data ?? null;

  useEffect(() => {
    if (site) {
      setFormName(site.name ?? "");
      setFormDomain(site.domain ?? "");
      setFormSiteType(site.siteType ?? "website");
    }
  }, [site]);

  const publishedPagesQuery = useQuery({
    queryKey: ["website-pages-stats", "published", site?.id],
    queryFn: () =>
      apiFetch(
        `/website/pages?siteId=${site.id}&status=published&pageSize=1`,
        token,
      ),
    enabled: Boolean(token) && Boolean(site?.id),
    staleTime: 60_000,
  });

  const draftPagesQuery = useQuery({
    queryKey: ["website-pages-stats", "draft", site?.id],
    queryFn: () =>
      apiFetch(
        `/website/pages?siteId=${site.id}&status=draft&pageSize=1`,
        token,
      ),
    enabled: Boolean(token) && Boolean(site?.id),
    staleTime: 60_000,
  });

  const blogQuery = useQuery({
    queryKey: ["website-blog-stats", site?.id],
    queryFn: () =>
      apiFetch(`/website/blog/posts?siteId=${site.id}&pageSize=1`, token),
    enabled: Boolean(token) && Boolean(site?.id),
    staleTime: 60_000,
  });

  const formsQuery = useQuery({
    queryKey: ["website-forms-stats", site?.id],
    queryFn: () => apiFetch(`/website/forms?siteId=${site.id}`, token),
    enabled: Boolean(token) && Boolean(site?.id),
    staleTime: 60_000,
  });

  const updateMutation = useMutation({
    mutationFn: (data) =>
      apiFetch(`/website/site/${site.id}`, token, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["website-site"] });
      toast.success("Sitio actualizado");
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/website/site/${site.id}`, token, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["website-site"] });
      setDeleteOpen(false);
      setDeleteText("");
      toast.success("Sitio web eliminado");
    },
    onError: (err) => toast.error(err.message),
  });

  if (siteQuery.isPending) return <LoadingState variant="page" />;

  if (!site) return <WebsiteWizard />;

  const submissionsTotal = (formsQuery.data?.data ?? []).reduce(
    (sum, f) => sum + (f._count?.submissions ?? 0),
    0,
  );

  function handleSaveConfig() {
    updateMutation.mutate({
      name: formName.trim() || undefined,
      domain: formDomain.trim() || null,
      siteType: formSiteType,
    });
  }

  function handleStatusToggle(checked) {
    updateMutation.mutate({ status: checked ? "published" : "draft" });
  }

  function closeDeleteDialog() {
    setDeleteOpen(false);
    setDeleteText("");
  }

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Page header with status toggle */}
      <PageHeader
        eyebrow="Runly Website"
        title={site.name}
        description={
          site.domain ? `https://${site.domain}` : "Dominio no configurado"
        }
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={site.status === "published" ? "success" : "warning"}>
              {site.status === "published" ? "Publicado" : "Borrador"}
            </Badge>
            <Switch
              checked={site.status === "published"}
              onCheckedChange={handleStatusToggle}
              disabled={updateMutation.isPending}
            />
          </div>
        }
      />

      {/* Stats */}
      <section>
        <h2 className="text-xs font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-widest mb-4">
          Resumen
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div
            className="cursor-pointer"
            onClick={() => navigate("/app/m/runly.website/pages")}
          >
            <StatCard
              label="Pag. publicadas"
              value={publishedPagesQuery.data?.total ?? "—"}
              icon={Globe}
              loading={publishedPagesQuery.isPending}
            />
          </div>
          <div
            className="cursor-pointer"
            onClick={() => navigate("/app/m/runly.website/pages")}
          >
            <StatCard
              label="Borradores"
              value={draftPagesQuery.data?.total ?? "—"}
              icon={FileText}
              loading={draftPagesQuery.isPending}
            />
          </div>
          <div
            className="cursor-pointer"
            onClick={() => navigate("/app/m/runly.website/blog")}
          >
            <StatCard
              label="Posts de blog"
              value={blogQuery.data?.total ?? "—"}
              icon={BookOpen}
              loading={blogQuery.isPending}
            />
          </div>
          <div
            className="cursor-pointer"
            onClick={() => navigate("/app/m/runly.website/forms")}
          >
            <StatCard
              label="Envios de formulario"
              value={formsQuery.isPending ? "—" : submissionsTotal}
              icon={MessageSquare}
              loading={formsQuery.isPending}
            />
          </div>
        </div>
      </section>

      {/* Config + Danger zone — two columns on large screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Config */}
        <section className="rounded-xl border border-[hsl(var(--border))] p-6 space-y-6">
          <h2 className="text-base font-semibold text-[hsl(var(--foreground))]">
            Configuracion del sitio
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TextField
              label="Nombre"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Mi sitio web"
            />
            <TextField
              label="Dominio"
              value={formDomain}
              onChange={(e) => setFormDomain(e.target.value)}
              placeholder="misitioweb.com"
            />
          </div>

          <div className="max-w-xs">
            <SelectField
              label="Tipo de sitio"
              value={formSiteType}
              onChange={setFormSiteType}
              options={SITE_TYPES}
            />
          </div>

          <div className="flex justify-end">
            <Button
              onClick={handleSaveConfig}
              disabled={updateMutation.isPending}
            >
              {updateMutation.isPending ? "Guardando..." : "Guardar cambios"}
            </Button>
          </div>
        </section>

        {/* Danger zone */}
        <section className="rounded-xl border border-red-200 p-6 space-y-3">
          <h2 className="text-base font-semibold text-red-700">
            Zona de peligro
          </h2>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Eliminar el sitio web borra de forma permanente todas las paginas,
            posts de blog, formularios, menus y temas. Esta accion no se puede
            deshacer.
          </p>
          <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
            Eliminar sitio web
          </Button>
        </section>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open) closeDeleteDialog();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar sitio web</DialogTitle>
            <DialogDescription>
              Esta accion es irreversible. Se eliminaran todas las paginas,
              posts de blog, formularios, menus y temas del sitio{" "}
              <strong>{site.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <TextField
              label={`Escribe el nombre del sitio para confirmar: ${site.name}`}
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              placeholder={site.name}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDeleteDialog}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deleteText !== site.name || deleteMutation.isPending}
              onClick={() => deleteMutation.mutate()}
            >
              {deleteMutation.isPending ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
