import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Lock, TriangleAlert } from "lucide-react";
import { Skeleton } from "@runly/ui";
import { useAuth } from "../../../auth/AuthProvider";
import { ModuleIcon } from "../../../components/ModuleCard";
import { getModuleLaunchPath } from "../../../lib/runtimeModules";

// Token-scoped query for a widget. Widgets are glanceable: a short stale time,
// no retries on 401/403 (the API is the permission authority).
export function useWidgetQuery(key, fetcher, options = {}) {
  const { session } = useAuth();
  const token = session?.access_token;
  return useQuery({
    queryKey: ["home-widget", ...key, token],
    queryFn: () => fetcher(token),
    enabled: Boolean(token) && options.enabled !== false,
    staleTime: 60_000,
    retry: (count, err) => ![401, 403, 404].includes(err?.status) && count < 1,
  });
}

// Unwraps `{ data }` envelopes; some endpoints return bare arrays.
export function unwrap(res) {
  return res && typeof res === "object" && !Array.isArray(res) && "data" in res ? res.data : res;
}

const moneyFormatters = new Map();
export function formatMoney(value, currency = "MXN") {
  const key = currency || "MXN";
  if (!moneyFormatters.has(key)) {
    try {
      moneyFormatters.set(
        key,
        new Intl.NumberFormat("es-MX", { style: "currency", currency: key, maximumFractionDigits: 0 }),
      );
    } catch {
      moneyFormatters.set(key, new Intl.NumberFormat("es-MX", { maximumFractionDigits: 0 }));
    }
  }
  return moneyFormatters.get(key).format(Number(value) || 0);
}

function WidgetState({ icon: Icon, children }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 py-5 text-center md:py-0 text-sm text-[hsl(var(--muted-foreground))]">
      {Icon && <Icon size={18} aria-hidden />}
      <p className="max-w-56 leading-snug">{children}</p>
    </div>
  );
}

export function WidgetEmpty({ children }) {
  return <WidgetState>{children}</WidgetState>;
}

// Shared chrome: header with module icon + title + "Abrir" link, then a body
// that renders loading / denied / error states before `children`.
export function WidgetFrame({ module, title, subtitle, query, isEmpty, emptyText, children }) {
  const status = query?.error?.status;
  let body = children;
  if (query?.isLoading) {
    body = (
      <div className="space-y-2.5 pt-1">
        <Skeleton className="h-8 w-2/3 rounded-lg" />
        <Skeleton className="h-4 w-full rounded" />
        <Skeleton className="h-4 w-5/6 rounded" />
        <Skeleton className="h-4 w-3/4 rounded" />
      </div>
    );
  } else if (status === 401 || status === 403) {
    body = <WidgetState icon={Lock}>Sin acceso a esta información.</WidgetState>;
  } else if (query?.isError) {
    body = (
      <WidgetState icon={TriangleAlert}>
        No se pudo cargar.{" "}
        <button
          type="button"
          onClick={() => query.refetch()}
          className="cursor-pointer font-medium text-[hsl(var(--foreground))] underline-offset-2 hover:underline"
        >
          Reintentar
        </button>
      </WidgetState>
    );
  } else if (isEmpty) {
    body = <WidgetEmpty>{emptyText}</WidgetEmpty>;
  }

  return (
    <section
      aria-label={title}
      className="flex flex-col md:h-60 overflow-hidden rounded-2xl border border-[hsl(var(--border))] bg-[hsl(var(--card))]"
    >
      <header className="flex items-center gap-2.5 px-4 pb-2 pt-3.5">
        <span className="scale-[0.85]">
          <ModuleIcon module={module} size="sm" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold leading-tight text-[hsl(var(--foreground))]">
            {title}
          </h3>
          {subtitle && (
            <p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{subtitle}</p>
          )}
        </div>
        <Link
          to={getModuleLaunchPath(module)}
          className="flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--muted))] hover:text-[hsl(var(--foreground))]"
        >
          Abrir
          <ArrowRight size={13} aria-hidden />
        </Link>
      </header>
      <div className="min-h-0 flex-1 overflow-hidden px-4 pb-4">{body}</div>
    </section>
  );
}

// Big headline number with a small caption.
export function HeadlineStat({ label, value, hint }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wider text-[hsl(var(--muted-foreground))]">
        {label}
      </p>
      <p className="truncate text-2xl font-bold tabular-nums tracking-tight text-[hsl(var(--foreground))]">
        {value}
      </p>
      {hint && <p className="text-xs text-[hsl(var(--muted-foreground))]">{hint}</p>}
    </div>
  );
}
