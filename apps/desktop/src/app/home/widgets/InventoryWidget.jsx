import { runly } from "../../../lib/runly";
import { WidgetFrame, unwrap, useWidgetQuery } from "./WidgetFrame";

function Stat({ label, value, note }) {
  return (
    <div className="rounded-xl bg-[hsl(var(--muted))]/60 px-3 py-2">
      <p className="text-xl font-bold tabular-nums leading-none text-[hsl(var(--foreground))]">{value}</p>
      <p className="mt-1 text-xs leading-tight text-[hsl(var(--muted-foreground))]">{label}</p>
      {note && <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400">{note}</p>}
    </div>
  );
}

export function InventoryWidget({ module }) {
  const query = useWidgetQuery(["inventory-dashboard"], (token) =>
    runly.inventory.getDashboard({}, token),
  );
  const d = unwrap(query.data) ?? {};
  const pending = Array.isArray(d.pendingProposals) ? d.pendingProposals.length : 0;
  const expiring = d.warranties?.in30 ?? 0;

  return (
    <WidgetFrame
      module={module}
      title="Inventario"
      subtitle={`${d.total ?? 0} activos registrados`}
      query={query}
      isEmpty={!d.total}
      emptyText="Aún no hay activos en el inventario."
    >
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Vigentes" value={d.activeCount ?? 0} />
        <Stat label="Asignados" value={d.assignedCount ?? 0} />
        <Stat label="Propuestas pendientes" value={pending} note={pending ? "Requieren revisión" : null} />
        <Stat label="Garantías vencen en 30 días" value={expiring} note={expiring ? "Por vencer" : null} />
      </div>
    </WidgetFrame>
  );
}
