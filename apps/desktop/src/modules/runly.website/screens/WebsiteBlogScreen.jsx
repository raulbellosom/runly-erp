import { companyFetch } from '../../../lib/companyFetch.js'
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth/AuthProvider.jsx";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import {
  Badge,
  Button,
  PageHeader,
  EmptyState,
  ConfirmDialog,
  SelectField,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  LoadingState,
} from "@runly/ui";
import { toast } from "sonner";
import WebsiteNewBlogPostDialog from "./WebsiteNewBlogPostDialog.jsx";

async function apiGet(path, token) {
  const res = await companyFetch(`${getApiUrl()}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const STATUS_LABELS = {
  draft: "Borrador",
  published: "Publicado",
  archived: "Archivado",
};
const STATUS_VARIANT = { published: "success", draft: "warning", archived: "secondary" };

function fmtDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("es-MX", { dateStyle: "medium" });
}

export default function WebsiteBlogScreen() {
  const { session } = useAuth();
  const token = session?.access_token;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);

  const siteQuery = useQuery({
    queryKey: ["website-site", token],
    queryFn: () => apiGet("/website/site", token),
    enabled: Boolean(token),
    staleTime: 60_000,
  });
  const siteId = siteQuery.data?.data?.id ?? null;

  const catsQuery = useQuery({
    queryKey: ["blog-categories", siteId, token],
    queryFn: () => apiGet(`/website/blog/categories?siteId=${siteId}`, token),
    enabled: Boolean(token) && Boolean(siteId),
    staleTime: 60_000,
  });
  const categories = catsQuery.data?.data ?? [];

  const postsQuery = useQuery({
    queryKey: ["blog-posts", siteId, categoryFilter, token],
    queryFn: () =>
      apiGet(
        `/website/blog/posts?siteId=${siteId}${categoryFilter ? `&categoryId=${categoryFilter}` : ""}`,
        token,
      ),
    enabled: Boolean(token) && Boolean(siteId),
    staleTime: 30_000,
  });
  const posts = postsQuery.data?.data ?? [];

  const deleteMutation = useMutation({
    mutationFn: async (postId) => {
      const res = await companyFetch(`${getApiUrl()}/website/blog/posts/${postId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    onSuccess: () => {
      toast.success("Entrada eliminada");
      queryClient.invalidateQueries({ queryKey: ["blog-posts", siteId] });
      setDeleteTarget(null);
    },
    onError: () => {
      toast.error("Error al eliminar la entrada");
      setDeleteTarget(null);
    },
  });

  if (siteQuery.isPending) return <LoadingState variant="page" />;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        eyebrow="Runly Website"
        title="Blog"
        description="Gestiona las entradas del blog publico."
        actions={
          <Button onClick={() => setDialogOpen(true)} disabled={!siteId}>
            Nuevo post
          </Button>
        }
      />

      {!siteId ? (
        <EmptyState
          title="Sitio web no configurado"
          description='Configura tu sitio web primero desde la seccion "Sitio web".'
        />
      ) : (
        <>
          {categories.length > 0 && (
            <div className="max-w-xs">
              <SelectField
                label="Categoria"
                value={categoryFilter}
                onChange={setCategoryFilter}
                options={[
                  { value: "", label: "Todas las categorias" },
                  ...categories.map((cat) => ({
                    value: cat.id,
                    label: cat.name,
                  })),
                ]}
              />
            </div>
          )}

          {postsQuery.isPending ? (
            <LoadingState message="Cargando entradas..." />
          ) : posts.length === 0 ? (
            <EmptyState
              title="Sin entradas de blog"
              description="Crea tu primera entrada para empezar a publicar contenido."
              action={{
                label: "Crear primera entrada",
                onClick: () => setDialogOpen(true),
              }}
            />
          ) : (
            <div className="rounded-xl border border-[hsl(var(--border))] overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Titulo</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Publicado</TableHead>
                    <TableHead className="w-24" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {posts.map((post) => (
                    <TableRow
                      key={post.id}
                      className="cursor-pointer"
                      onClick={() =>
                        navigate(`/app/m/runly.website/blog/${post.id}/editor`)
                      }
                    >
                      <TableCell className="font-medium text-[hsl(var(--foreground))]">
                        {post.title}
                      </TableCell>
                      <TableCell className="text-[hsl(var(--muted-foreground))]">
                        {post.category?.name ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_VARIANT[post.status] ?? "secondary"}>
                          {STATUS_LABELS[post.status] ?? post.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-[hsl(var(--muted-foreground))] text-xs">
                        {fmtDate(post.publishedAt)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(
                                `/app/m/runly.website/blog/${post.id}/editor`,
                              );
                            }}
                            className="text-xs text-[hsl(var(--primary))] hover:underline"
                          >
                            Editar
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteTarget(post);
                            }}
                            disabled={deleteMutation.isPending}
                            className="text-xs text-[hsl(var(--destructive))] hover:underline disabled:opacity-50"
                          >
                            Eliminar
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      <WebsiteNewBlogPostDialog
        siteId={siteId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCreated={(post) => {
          queryClient.invalidateQueries({ queryKey: ["blog-posts", siteId] });
          navigate(`/app/m/runly.website/blog/${post.id}/editor`);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Eliminar entrada"
        description={`Se eliminara permanentemente la entrada "${deleteTarget?.title}". Esta accion no se puede deshacer.`}
        confirmLabel="Eliminar"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(deleteTarget?.id)}
      />
    </div>
  );
}
