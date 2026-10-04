// "Cambios de estructura" (spec 2026-10-03-rme3-module-platform-v2 §8.3): one
// row per schema operation of a module update with its safety badge and, when
// needed, the decision the admin must take (value for existing rows, or what
// to do with values that do not convert). Rows come from the API's
// describeStructure() (module-update-report.js); decisions are sent back as
// { [row.id]: { backfill } | { onConversionFailure: 'null' } }.
import { Badge, SelectField, TextField } from "@runly/ui";
import { Database } from "lucide-react";

const BADGES = {
  SAFE: { label: "Seguro", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  CONDITIONAL: { label: "Seguro", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  NEEDS_BACKFILL: { label: "Requiere dato", className: "bg-amber-500/10 text-amber-800 dark:text-amber-300" },
  NEEDS_CONVERSION: { label: "Revisión", className: "bg-amber-500/10 text-amber-800 dark:text-amber-300" },
};
const BLOCKED = { label: "Bloqueado", className: "bg-red-500/10 text-red-700 dark:text-red-300" };
const CONVERSION_OPTIONS = [
  { value: "abort", label: "Cancelar la actualización" },
  { value: "null", label: "Dejar vacíos esos registros" },
];

// Rows still waiting for a valid decision.
export function missingDecisions(rows, decisions) {
  return (rows ?? []).filter((row) => {
    const decision = decisions?.[row.id] ?? {};
    if (row.needs === "backfill") return !String(decision.backfill ?? "").trim();
    if (row.needs === "conversion") return decision.onConversionFailure !== "null" || row.nullable === false;
    return false;
  });
}

function DecisionInput({ row, decision, onChange, disabled }) {
  if (row.needs === "backfill") {
    return (
      <TextField
        label="Valor para los registros existentes"
        value={decision?.backfill ?? ""}
        placeholder={row.suggestedValue != null ? String(row.suggestedValue) : ""}
        disabled={disabled}
        onChange={(e) => onChange({ backfill: e.target.value })}
      />
    );
  }
  if (row.needs === "conversion") {
    if (row.nullable === false) {
      return <p className="text-xs text-red-700 dark:text-red-300">El campo es obligatorio: corrige esos registros o hazlo opcional en esta versión.</p>;
    }
    return (
      <SelectField
        label={`${row.failingRows} registro(s) que no se convierten`}
        options={CONVERSION_OPTIONS}
        value={decision?.onConversionFailure ?? "abort"}
        disabled={disabled}
        onValueChange={(value) => onChange({ onConversionFailure: value })}
      />
    );
  }
  return null;
}

export function StructureChangesTable({ rows, decisions, onChange, disabled = false }) {
  if (!rows?.length) return null;
  const update = (id, patch) => onChange({ ...decisions, [id]: { ...(decisions?.[id] ?? {}), ...patch } });
  return (
    <section className="space-y-2 rounded-xl border border-[hsl(var(--border))] p-3">
      <p className="flex items-center gap-2 text-sm font-medium"><Database className="h-4 w-4" /> Cambios de estructura</p>
      <ul className="divide-y divide-[hsl(var(--border))]">
        {rows.map((row) => {
          const blocked = row.blocker && !row.needs;
          const badge = blocked ? BLOCKED : BADGES[row.safety] ?? BLOCKED;
          return (
            <li key={row.id} className="space-y-2 py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm">{row.description}</p>
                <Badge variant="outline" className={`shrink-0 border-transparent ${badge.className}`}>{badge.label}</Badge>
              </div>
              {row.needs && (
                <div className="max-w-sm">
                  <DecisionInput row={row} decision={decisions?.[row.id]} disabled={disabled} onChange={(patch) => update(row.id, patch)} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">
        Antes de aplicar se guarda un respaldo de las tablas del módulo por 14 días. Si algo falla, no se aplica ningún cambio.
      </p>
    </section>
  );
}
