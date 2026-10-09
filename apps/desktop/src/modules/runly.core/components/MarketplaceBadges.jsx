// Shared Marketplace marks. Trust wording/icons are distinct per level and only
// "Oficial Runly" uses the official mark; revoked/withdrawn/incompatible alerts
// keep separate tones. All catalog text renders as plain text (never HTML).
import { BadgeCheck, Building2, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { moduleAlerts } from "../lib/marketplace";

const TRUST = {
  official: { icon: BadgeCheck, label: "Oficial Runly", className: "bg-sky-500/10 text-sky-700 dark:text-sky-300" },
  "community-verified": { icon: ShieldCheck, label: "Publicador verificado · Comunidad", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  community: { icon: Users, label: "Comunidad · publicador no verificado", className: "bg-slate-500/10 text-slate-700 dark:text-slate-300" },
  managed: { icon: Building2, label: "Catálogo administrado", className: "bg-violet-500/10 text-violet-700 dark:text-violet-300" },
  untrusted: { icon: ShieldAlert, label: "Firma no confiable", className: "bg-red-500/10 text-red-700 dark:text-red-300" },
};
const ALERT_TONES = { danger: "bg-red-500/10 text-red-700 dark:text-red-300", warning: "bg-amber-500/10 text-amber-800 dark:text-amber-300", notice: "bg-slate-500/10 text-slate-700 dark:text-slate-300" };
export const date = (value) => (value ? new Date(value).toLocaleString() : "—");
// Catalog colours are data: only a plain #rrggbb value reaches inline styles.
export const safeColor = (value) => (/^#[0-9a-fA-F]{6}$/.test(value ?? "") ? value : "#2563EB");

export function TrustBadge({ trust }) {
  const meta = TRUST[trust] ?? TRUST.untrusted;
  const Icon = meta.icon;
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`} data-trust={trust}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{meta.label}</span>;
}

export function ModuleAlerts({ entry }) {
  return moduleAlerts(entry).map((alert) => (
    <div key={alert.kind} role={alert.tone === "danger" ? "alert" : undefined} data-alert={alert.kind} className={`rounded-lg px-2 py-1.5 text-xs ${ALERT_TONES[alert.tone]}`}>
      <p className="font-medium">{alert.title}</p>
      {alert.text && <p>{alert.text}</p>}
      {alert.hint && <p className="opacity-80">{alert.hint}</p>}
      {alert.replacement && <p>Versión recomendada: v{alert.replacement}</p>}
    </div>
  ));
}
