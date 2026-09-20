import { companyFetch } from '../../../lib/companyFetch.js'
import { useParams } from "react-router-dom";
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

export default function WebsiteBlogPostEditorScreen() {
  const { "*": wildcard } = useParams();
  const postId = wildcard?.match(/^blog\/([^/]+)\/editor$/)?.[1] ?? null;
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();

  const postQuery = useQuery({
    queryKey: ["blog-post", postId, token],
    queryFn: () => apiFetch(`/website/blog/posts/${postId}`, token),
    enabled: Boolean(token) && Boolean(postId),
  });

  const themeQuery = useQuery({
    queryKey: ["website-theme", token],
    queryFn: () => apiFetch("/website/theme", token),
    enabled: Boolean(token),
    staleTime: 60_000,
  });

  const saveDraftMutation = useMutation({
    mutationFn: (page) =>
      apiFetch(`/website/blog/posts/${postId}/draft`, token, {
        method: "POST",
        body: JSON.stringify({ draft_builder_data: serializePage(page) }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blog-post", postId] });
      toast.success("Borrador guardado");
    },
    onError: (err) => toast.error(err.message),
  });

  const publishMutation = useMutation({
    mutationFn: (page) =>
      apiFetch(`/website/blog/posts/${postId}/publish`, token, {
        method: "POST",
        body: JSON.stringify({ draft_builder_data: serializePage(page) }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["blog-post", postId] });
      queryClient.invalidateQueries({ queryKey: ["blog-posts"] });
      toast.success("Entrada publicada");
    },
    onError: (err) => toast.error(err.message),
  });

  const postData = postQuery.data?.data ?? null;
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
  if (postData?.draft_builder_data) {
    try {
      initialPage =
        typeof postData.draft_builder_data === "string"
          ? parsePage(postData.draft_builder_data)
          : parsePage(JSON.stringify(postData.draft_builder_data));
    } catch {
      initialPage = null;
    }
  }

  if (!initialPage && postData) {
    initialPage = {
      schemaVersion: 1,
      id: `blog_${postData.id}`,
      slug: postData.slug ?? "/blog/nueva-entrada",
      title: postData.title ?? "Nueva entrada",
      visibility: "public",
      regions: { main: { id: "region_main", children: [] } },
      blocks: {},
      seo: {
        title: postData.title ?? "",
        description: postData.excerpt ?? "",
        canonical: null,
        ogImageAssetId: null,
      },
      updatedAt: new Date().toISOString(),
    };
  }

  if (postQuery.isPending || !initialPage) {
    return <LoadingState variant="page" message="Cargando editor..." />;
  }

  return (
    <div style={{ position: "fixed", inset: 0 }}>
      <AtlasWebBuilderEditor
        blocks={baseBlocks}
        initialPage={initialPage}
        theme={resolvedTheme}
        assets={createAssetSource(token)}
        brandName="Runly ERP"
        onSaveDraft={(page) => saveDraftMutation.mutate(page)}
        onPublish={(page) => publishMutation.mutate(page)}
      />
    </div>
  );
}
