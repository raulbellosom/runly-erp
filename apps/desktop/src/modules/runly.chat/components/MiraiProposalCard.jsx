// apps/desktop/src/modules/runly.chat/components/MiraiProposalCard.jsx
//
// Confirmation card for a MirAI write action (spec 2026-09-30-mirai-actions
// §7.2). Nothing is written until the author presses Confirmar; delete
// actions ask again through ConfirmDialog.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, ConfirmDialog, Skeleton } from "@runly/ui";
import { ArrowRight, Check, ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import { useMiraiProposal, useDecideMiraiProposal } from "../hooks/useMiraiProposal";

const STATUS = {
  pending: "Por confirmar",
  executing: "Ejecutando",
  executed: "Ejecutado",
  cancelled: "Cancelado",
  superseded: "Reemplazado",
  expired: "Vencido",
  failed: "Fallo",
};

export function MiraiProposalCard({ proposalId, conversationId }) {
  const navigate = useNavigate();
  const { data: proposal, isLoading, isError } = useMiraiProposal(proposalId);
  const decide = useDecideMiraiProposal(proposalId, { conversationId });
  const [confirmOpen, setConfirmOpen] = useState(false);

  if (isLoading) return <Skeleton className="mt-2 h-24 w-full max-w-sm rounded-xl" />;
  if (isError || !proposal) return null;

  const pending = proposal.status === "pending";
  async function run(decision) {
    try {
      await decide.mutateAsync(decision);
    } catch (err) {
      toast.error(err?.message ?? "No se pudo procesar la propuesta.");
    }
  }

  return (
    <div
      className={[
        "mt-2 w-full max-w-sm rounded-xl border bg-[hsl(var(--card))] p-3 text-sm text-[hsl(var(--foreground))]",
        proposal.destructive ? "border-[hsl(var(--destructive))]" : "border-[hsl(var(--border))]",
      ].join(" ")}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-medium">{proposal.preview?.title ?? "Accion propuesta"}</p>
        <Badge variant={proposal.status === "failed" ? "destructive" : proposal.status === "executed" ? "default" : "secondary"}>
          {STATUS[proposal.status] ?? proposal.status}
        </Badge>
      </div>
      <dl className="space-y-1">
        {(proposal.preview?.fields ?? []).map((field, i) => (
          <div key={`${field.label}-${i}`} className="grid grid-cols-[6.5rem_1fr] gap-2">
            <dt className="text-[hsl(var(--muted-foreground))]">{field.label}</dt>
            <dd className="min-w-0 wrap-anywhere">
              {field.before != null && (
                <>
                  <span className="text-[hsl(var(--muted-foreground))] line-through">{String(field.before)}</span>
                  <ArrowRight className="mx-1 inline h-3 w-3" />
                </>
              )}
              {String(field.value ?? "")}
            </dd>
          </div>
        ))}
      </dl>
      {proposal.status === "failed" && proposal.error && (
        <p className="mt-2 text-xs text-[hsl(var(--destructive))]">{proposal.error}</p>
      )}
      {proposal.status === "executed" && proposal.result?.link && (
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => navigate(proposal.result.link)}>
          <ExternalLink className="h-4 w-4" />Ver registro
        </Button>
      )}
      {pending && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={proposal.destructive ? "destructive" : "default"}
            disabled={decide.isPending}
            onClick={() => (proposal.destructive ? setConfirmOpen(true) : run("confirm"))}
          >
            <Check className="h-4 w-4" />Confirmar
          </Button>
          <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => run("cancel")}>
            <X className="h-4 w-4" />Cancelar
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Confirmar eliminacion"
        description="MirAI eliminara este registro. Esta accion no se puede deshacer desde el chat."
        confirmLabel="Eliminar"
        loading={decide.isPending}
        onConfirm={async () => { await run("confirm"); setConfirmOpen(false); }}
      />
    </div>
  );
}
