import { companyFetch } from '../../../lib/companyFetch.js'
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../auth/AuthProvider.jsx";
import { getApiUrl } from "../../../lib/runtimeConfig.js";
import { Button, ConfirmDialog, LoadingState } from "@runly/ui";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";

function fmtDate(d) {
  return new Date(d).toLocaleString("es-MX", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function SubmissionRow({ sub, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const entries = Object.entries(sub.data ?? {});

  return (
    <div className="border-b border-[hsl(var(--border))] last:border-0">
      <div
        className="flex items-center gap-3 px-4 py-3 hover:bg-[hsl(var(--muted)/0.4)] cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        <span className="text-xs text-[hsl(var(--muted-foreground))] w-32 shrink-0">
          {fmtDate(sub.submittedAt)}
        </span>
        <span className="flex-1 text-sm text-[hsl(var(--foreground))] truncate">
          {entries
            .slice(0, 2)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · ")}
          {entries.length > 2 && " ..."}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(sub.id);
            }}
            className="text-xs text-[hsl(var(--destructive))] hover:underline"
          >
            Eliminar
          </button>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-3 ml-36">
          <dl className="space-y-1">
            {entries.map(([k, v]) => (
              <div key={k} className="flex gap-2 text-sm">
                <dt className="font-mono text-xs text-[hsl(var(--muted-foreground))] w-32 shrink-0">
                  {k}
                </dt>
                <dd className="text-[hsl(var(--foreground))]">{String(v)}</dd>
              </div>
            ))}
          </dl>
          {sub.submitterIp && (
            <p className="text-xs text-[hsl(var(--muted-foreground))] mt-2">
              IP: {sub.submitterIp}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function FormSubmissionsPanel({ formId }) {
  const { session } = useAuth();
  const token = session?.access_token;
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [confirmId, setConfirmId] = useState(null);

  const subsQuery = useQuery({
    queryKey: ["form-submissions", formId, page, token],
    queryFn: async () => {
      const res = await companyFetch(
        `${getApiUrl()}/website/forms/${formId}/submissions?page=${page}&pageSize=20`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: Boolean(token) && Boolean(formId),
    staleTime: 15_000,
  });

  const deleteMutation = useMutation({
    mutationFn: async (subId) => {
      const res = await companyFetch(
        `${getApiUrl()}/website/forms/${formId}/submissions/${subId}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      if (!res.ok) throw new Error("Error al eliminar");
    },
    onSuccess: () => {
      toast.success("Envio eliminado");
      setConfirmId(null);
      queryClient.invalidateQueries({ queryKey: ["form-submissions", formId] });
    },
    onError: () => {
      toast.error("Error al eliminar el envio");
      setConfirmId(null);
    },
  });

  const { data, total, pageSize } = subsQuery.data ?? {};
  const submissions = data ?? [];
  const totalPages = Math.ceil((total ?? 0) / (pageSize ?? 20));

  if (subsQuery.isPending) return <LoadingState message="Cargando envíos..." />;

  if (submissions.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-[hsl(var(--muted-foreground))] text-sm">
          No hay envios todavia.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-[hsl(var(--muted-foreground))]">
          {total} envio{total !== 1 ? "s" : ""} en total
        </p>
      </div>
      <div className="rounded-xl border border-[hsl(var(--border))] overflow-hidden">
        {submissions.map((sub) => (
          <SubmissionRow key={sub.id} sub={sub} onDelete={setConfirmId} />
        ))}
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Anterior
          </Button>
          <span className="text-sm text-[hsl(var(--muted-foreground))]">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Siguiente
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirmId)}
        onOpenChange={(open) => {
          if (!open) setConfirmId(null);
        }}
        title="Eliminar envio"
        description="Este envio sera eliminado permanentemente. Esta accion no se puede deshacer."
        confirmLabel="Eliminar"
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(confirmId)}
      />
    </div>
  );
}
