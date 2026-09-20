import { companyFetch } from '../../../lib/companyFetch.js'
import { useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LoadingState } from "@runly/ui";
import {
  AtlasWebBuilderEditor,
  baseBlocks,
  serializePage,
  parsePage,
  defaultTheme,
  defineTheme,
} from "@raulbellosom/atlas-web-builder";
import "@raulbellosom/atlas-web-builder/styles";
import { useAuth } from "../../../auth/AuthProvider.jsx";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import {
  buildRunlyBlocks,
  buildRunlyTemplates,
} from "../../../website/runlyBlocks/index.js";
import { toast } from "sonner";

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
  return res.json();
}

function createAssetSource(token) {
  const apiUrl = getApiUrl();
  return {
    async list() {
      try {
        const data = await apiFetch("/files?pageSize=100", token);
        const files = (data.data ?? []).filter((f) =>
          f.mimeType?.startsWith("image/"),
        );
        if (!files.length) return [];
        const urlRes = await apiFetch("/files/batch-signed-urls", token, {
          method: "POST",
          body: JSON.stringify({ fileIds: files.map((f) => f.id) }),
        });
        const urlMap = urlRes.data ?? {};
        return files
          .filter((f) => urlMap[f.id])
          .map((f) => ({
            id: f.id,
            name: f.originalName ?? f.id,
            kind: "image",
            url: urlMap[f.id],
          }));
      } catch {
        return [];
      }
    },
    async upload(file) {
      const form = new FormData();
      form.append("file", file);
      form.append("visibility", "PUBLIC");
      form.append("moduleKey", "runly.website");
      const res = await companyFetch(`${apiUrl}/files/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      const f = data.data;
      return {
        id: f.id,
        name: f.originalName ?? f.id,
        kind: "image",
        url: f.url ?? "",
      };
    },
    async remove(id) {
      await apiFetch(`/files/${id}`, token, { method: "DELETE" });
    },
  };
}

// pageIdProp: when rendered inline from the public website (not from a route URL)
// topOffset: pixels to offset the fixed container from the top (for pinned editor bar)
export default function WebsitePageEditorScreen({
  pageId: pageIdProp,
  topOffset = 0,
} = {}) {
  const { "*": wildcard } = useParams();
  const navigate = useNavigate();
  const pageId =
    pageIdProp ?? wildcard?.match(/^pages\/([^/]+)\/editor$/)?.[1] ?? null;

  // When accessed directly from the AppShell route (pageIdProp is null),
  // redirect to the public website URL with ?edit=1 so the editor runs
  // in PublicWebsiteEntry context (correct z-index, EditorContextBar, publish button, etc.)
  const isInAppShell = pageIdProp === undefined || pageIdProp === null;

  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();

  const pageQuery = useQuery({
    queryKey: ["website-page", pageId, token],
    queryFn: () => apiFetch(`/website/pages/${pageId}`, token),
    enabled: Boolean(token) && Boolean(pageId),
  });

  const siteQuery = useQuery({
    queryKey: ["website-site", token],
    queryFn: () => apiFetch("/website/site", token),
    enabled: Boolean(token),
    staleTime: 60_000,
  });

  const themeQuery = useQuery({
    queryKey: ["website-theme", token],
    queryFn: () => apiFetch("/website/theme", token),
    enabled: Boolean(token),
    staleTime: 60_000,
  });

  const saveDraftMutation = useMutation({
    mutationFn: (page) =>
      apiFetch(`/website/pages/${pageId}/draft`, token, {
        method: "POST",
        body: JSON.stringify({ draft_builder_data: serializePage(page) }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["website-page", pageId] });
      toast.success("Borrador guardado");
    },
    onError: (err) => toast.error(err.message),
  });

  const publishMutation = useMutation({
    mutationFn: (page) =>
      apiFetch(`/website/pages/${pageId}/publish`, token, {
        method: "POST",
        body: JSON.stringify({ draft_builder_data: serializePage(page) }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["website-page", pageId] });
      toast.success("Pagina publicada");
    },
    onError: (err) => toast.error(err.message),
  });

  // Redirect to public website edit mode when accessed from AppShell route
  useEffect(() => {
    if (!isInAppShell) return;
    const routePath = pageQuery.data?.data?.routePath;
    if (!routePath) return;
    navigate(routePath + "?edit=1", { replace: true });
  }, [isInAppShell, pageQuery.data, navigate]);

  const pageData = pageQuery.data?.data ?? null;
  const themeData = themeQuery.data?.data ?? null;

  const resolvedTheme = themeData?.tokens
    ? defineTheme({
        ...defaultTheme,
        id: "atlas-site",
        name: "Site Theme",
        tokens: { ...defaultTheme.tokens, ...themeData.tokens },
      })
    : defaultTheme;

  let initialPage = null;
  if (pageData?.draftBuilderData) {
    try {
      initialPage =
        typeof pageData.draftBuilderData === "string"
          ? parsePage(pageData.draftBuilderData)
          : parsePage(JSON.stringify(pageData.draftBuilderData));
    } catch {
      initialPage = null;
    }
  }

  if (!initialPage && pageData) {
    initialPage = {
      schemaVersion: 1,
      id: `page_${pageData.id}`,
      slug: pageData.slug ?? "/",
      title: pageData.title ?? "Nueva pagina",
      visibility: "public",
      regions: { main: { id: "region_main", children: [] } },
      blocks: {},
      seo: {
        title: pageData.title ?? "",
        description: "",
        canonical: null,
        ogImageAssetId: null,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  if (pageQuery.isError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3 text-sm">
        <p className="text-red-400">No se pudo cargar la pagina.</p>
        <button
          className="text-[hsl(var(--primary))] hover:underline"
          onClick={() => window.location.reload()}
        >
          Reintentar
        </button>
      </div>
    );
  }

  // While waiting to redirect to public URL
  if (isInAppShell && !pageQuery.isError) {
    return <LoadingState variant="page" message="Cargando editor..." />;
  }

  const siteType = siteQuery.data?.data?.siteType ?? "informational";

  return (
    <div
      style={{
        position: "fixed",
        top: topOffset,
        left: 0,
        right: 0,
        bottom: 0,
      }}
    >
      <AtlasWebBuilderEditor
        blocks={[...baseBlocks, ...buildRunlyBlocks(siteType)]}
        templates={buildRunlyTemplates(siteType)}
        initialPage={initialPage}
        theme={resolvedTheme}
        assets={createAssetSource(token)}
        brandName="Runly ERP"
        onSaveDraft={(page) => saveDraftMutation.mutate(page)}
        onPublish={(page) => publishMutation.mutate(page)}
        resources={
          siteType === "ecommerce"
            ? {
                products: async ({ categoryId, limit }) => {
                  try {
                    const url = `${getApiUrl()}/catalog/products?limit=${limit ?? 20}${categoryId ? `&categoryId=${categoryId}` : ""}`;
                    const res = await companyFetch(url, {
                      headers: { Authorization: `Bearer ${token}` },
                    });
                    const data = await res.json();
                    return data.data ?? [];
                  } catch {
                    return [];
                  }
                },
              }
            : undefined
        }
      />
    </div>
  );
}
