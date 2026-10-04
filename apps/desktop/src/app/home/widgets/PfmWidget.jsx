import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { runly } from "../../../lib/runly";
import { HeadlineStat, WidgetFrame, formatMoney, unwrap, useWidgetQuery } from "./WidgetFrame";

// Expense change vs previous month, always shown with an icon + words.
function ExpenseDelta({ current, previous }) {
  if (!previous) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  const Icon = pct > 0 ? ArrowUpRight : pct < 0 ? ArrowDownRight : Minus;
  const text = pct === 0 ? "igual que el mes anterior" : `${Math.abs(pct)}% ${pct > 0 ? "más" : "menos"} que el mes anterior`;
  return (
    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[hsl(var(--muted-foreground))]">
      <Icon size={12} aria-hidden className={pct > 0 ? "text-amber-500" : pct < 0 ? "text-emerald-500" : ""} />
      {text}
    </p>
  );
}

export function PfmWidget({ module }) {
  const summary = useWidgetQuery(["pfm-summary"], (token) => runly.pfm.getSummary(token));
  const wallets = useWidgetQuery(["pfm-wallets"], (token) => runly.pfm.listWallets(token));

  const s = unwrap(summary.data) ?? {};
  const list = (unwrap(wallets.data) ?? []).filter((w) => w?.enabled !== false);
  const currency = list[0]?.currency ?? "MXN";
  const top = [...list]
    .sort((a, b) => Math.abs(Number(b.currentBalance) || 0) - Math.abs(Number(a.currentBalance) || 0))
    .slice(0, 3);

  return (
    <WidgetFrame
      module={module}
      title="Finanzas personales"
      subtitle="Este mes"
      query={summary}
      isEmpty={list.length === 0 && !wallets.isLoading}
      emptyText="Aún no tienes carteras registradas."
    >
      <HeadlineStat label="Saldo total" value={formatMoney(s.totalBalance, currency)} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-[hsl(var(--muted))]/60 px-3 py-2">
          <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Ingresos</p>
          <p className="truncate text-sm font-semibold tabular-nums text-[hsl(var(--foreground))]">
            {formatMoney(s.monthIncome, currency)}
          </p>
        </div>
        <div className="rounded-xl bg-[hsl(var(--muted))]/60 px-3 py-2">
          <p className="text-[11px] text-[hsl(var(--muted-foreground))]">Gastos</p>
          <p className="truncate text-sm font-semibold tabular-nums text-[hsl(var(--foreground))]">
            {formatMoney(s.monthExpense, currency)}
          </p>
        </div>
      </div>
      <ExpenseDelta current={Number(s.monthExpense) || 0} previous={Number(s.prevMonthExpense) || 0} />
      <ul className="mt-2 space-y-1">
        {top.map((w) => (
          <li key={w.id} className="flex items-center gap-2 text-xs">
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: w.color ?? "hsl(var(--muted-foreground))" }}
            />
            <span className="min-w-0 flex-1 truncate text-[hsl(var(--muted-foreground))]">{w.name}</span>
            <span className="font-medium tabular-nums text-[hsl(var(--foreground))]">
              {formatMoney(w.currentBalance, w.currency)}
            </span>
          </li>
        ))}
      </ul>
    </WidgetFrame>
  );
}
