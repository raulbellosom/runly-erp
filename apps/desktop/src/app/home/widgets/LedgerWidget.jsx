import { runly } from "../../../lib/runly";
import { HeadlineStat, WidgetFrame, formatMoney, unwrap, useWidgetQuery } from "./WidgetFrame";

const MAX_ACCOUNTS = 4;

function balanceOf(a) {
  return Number(a.current_balance ?? a.currentBalance ?? 0) || 0;
}

export function LedgerWidget({ module }) {
  const query = useWidgetQuery(["ledger-accounts"], (token) => runly.ledger.listAccounts(token));
  const accounts = (unwrap(query.data) ?? []).filter((a) => a?.enabled !== false);

  const totals = new Map();
  for (const a of accounts) {
    const cur = a.currency || "MXN";
    totals.set(cur, (totals.get(cur) ?? 0) + balanceOf(a));
  }
  const [mainCurrency, mainTotal] = [...totals.entries()][0] ?? ["MXN", 0];
  const otherTotals = [...totals.entries()].slice(1, 3);
  const top = [...accounts]
    .sort((a, b) => Math.abs(balanceOf(b)) - Math.abs(balanceOf(a)))
    .slice(0, MAX_ACCOUNTS);

  return (
    <WidgetFrame
      module={module}
      title="Cuentas"
      subtitle={`${accounts.length} ${accounts.length === 1 ? "cuenta" : "cuentas"}`}
      query={query}
      isEmpty={accounts.length === 0}
      emptyText="No hay cuentas registradas."
    >
      <HeadlineStat
        label={`Total ${mainCurrency}`}
        value={formatMoney(mainTotal, mainCurrency)}
        hint={otherTotals.map(([cur, total]) => formatMoney(total, cur)).join(" · ") || null}
      />
      <ul className="mt-3 divide-y divide-[hsl(var(--border))]">
        {top.map((a) => (
          <li key={a.id} className="flex items-center gap-2 py-1.5 text-sm">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium leading-tight text-[hsl(var(--foreground))]">{a.name}</p>
              {a.bank && (
                <p className="truncate text-[11px] text-[hsl(var(--muted-foreground))]">{a.bank}</p>
              )}
            </div>
            <span className="shrink-0 text-sm font-semibold tabular-nums text-[hsl(var(--foreground))]">
              {formatMoney(balanceOf(a), a.currency)}
            </span>
          </li>
        ))}
      </ul>
    </WidgetFrame>
  );
}
