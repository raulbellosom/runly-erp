// Presentational only — RunlyForm computes `percent` and passes it in.
export function FormCompletionRing({ percent, filledCount, totalCount }) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  return (
    <div className="glass-shell flex items-center gap-3 rounded-2xl px-4 py-3">
      <div className="relative h-11 w-11 shrink-0">
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background: `conic-gradient(hsl(var(--primary)) ${pct * 3.6}deg, hsl(var(--border)) 0deg)`,
          }}
        />
        <div className="absolute inset-1 flex items-center justify-center rounded-full bg-[hsl(var(--card))]">
          <span className="text-[11px] font-semibold text-[hsl(var(--foreground))]">{pct}%</span>
        </div>
      </div>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-medium text-[hsl(var(--foreground))]">Ficha completada</span>
        <span className="text-xs text-[hsl(var(--muted-foreground))]">
          {filledCount} de {totalCount} campos
        </span>
      </div>
    </div>
  );
}
