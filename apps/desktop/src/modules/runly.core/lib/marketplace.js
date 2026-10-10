// Runly Marketplace presentation logic (pure, testable). Data comes from the
// verified /module-catalog/v2 response; nothing here decides trust, it only
// renders the trust the API derived from signatures.

export const TRUST_FILTERS = [
  { id: "all", label: "Todos" },
  { id: "official", label: "Oficial Runly" },
  { id: "community-verified", label: "Comunidad verificada" },
  { id: "community", label: "Comunidad" },
  { id: "managed", label: "Administrado" },
];

export const STATE_LABELS = {
  "built-in": "Incluido en Runly",
  available: "Disponible",
  installed: "Instalado",
  update: "Actualización disponible",
};

export const COMPATIBILITY_REASONS = {
  runly_version: "Versión de Runly",
  contracts: "Contratos de compilador/runtime",
  services: "Servicios no disponibles",
  events: "Eventos no disponibles",
  connections: "Conexiones no disponibles",
  dependencies: "Módulos requeridos no instalados",
};

export const DEPENDENCY_STATUS = {
  satisfied: "Instalado",
  "install-first": "Instálalo primero desde el Marketplace",
  missing: "No disponible en esta instancia",
};

export const CATALOG_ALERTS = {
  rollback: "Se recibió un catálogo más antiguo que el último verificado.",
  equivocation: "Se recibieron dos catálogos distintos con la misma secuencia.",
  chain_broken: "El catálogo no continúa la cadena del último verificado.",
  downgrade: "Se recibió un formato de catálogo anterior al esperado.",
  signature_untrusted: "La firma del catálogo no es de una clave confiable.",
  invalid: "El catálogo recibido no es válido.",
  transport_rejected: "La descarga del catálogo fue bloqueada por seguridad.",
};
export function alertMessage(code) {
  if (!code) return null;
  const suffix = Object.keys(CATALOG_ALERTS).find((key) => code.endsWith(`_${key}`));
  return suffix ? CATALOG_ALERTS[suffix] : code;
}

export const INSTALL_STEPS = [
  { id: "downloading", label: "Descargando" },
  { id: "verifying", label: "Verificando firma y SHA-256" },
  { id: "preflight", label: "Comprobaciones previas" },
  { id: "installing", label: "Instalando" },
  { id: "enabled", label: "Habilitado" },
];

// Step status from what the server reported: completed phases, the running
// stage, and the phase where an error happened (error.details.phase).
export function stepStatuses({ completed = [], running = null, failedPhase = null }) {
  const done = new Set(completed);
  return INSTALL_STEPS.map((step) => {
    if (failedPhase === step.id) return { ...step, status: "failed" };
    if (done.has(step.id)) return { ...step, status: "done" };
    if (running === step.id) return { ...step, status: "running" };
    return { ...step, status: "pending" };
  });
}

// Revoked (security/trust incident) and withdrawn (publisher retirement) never share wording.
export function moduleAlerts(entry) {
  const alerts = [];
  if (entry.installedWarning) alerts.push({ tone: "danger", kind: "revoked", title: "Esta versión fue revocada", text: entry.installedWarning.reason, hint: "No se desinstala ni se borran datos automáticamente. Revisa la actualización recomendada.", replacement: entry.installedWarning.replacement?.version ?? null });
  else if (entry.revocation) alerts.push({ tone: "danger", kind: "revoked", title: "Versión revocada · no instalable", text: entry.revocation.reason, hint: null, replacement: entry.revocation.replacement?.version ?? null });
  if (entry.installedNotice?.type === "withdrawn") alerts.push({ tone: "notice", kind: "withdrawn", title: "Retirada por el publicador", text: entry.installedNotice.message, hint: null, replacement: null });
  if (entry.compatibility && !entry.compatibility.compatible) alerts.push({ tone: "warning", kind: "incompatible", title: "No compatible con esta instancia", text: entry.compatibility.reasons.map((r) => COMPATIBILITY_REASONS[r] ?? r).join(", "), hint: null, replacement: null });
  return alerts;
}

// What the administrator may do. Built-ins come with Runly; nothing is offered
// from stale/offline/alerted data, revoked or untrusted releases.
export function availableAction(entry, { canManage, blocked, freshness = "fresh" }) {
  if (!canManage || entry.builtIn || entry.state === "built-in" || entry.state === "installed") return null;
  if (blocked || freshness === "expired" || entry.trust === "untrusted" || entry.revocation || entry.availability !== "available" || !entry.compatibility?.compatible) return { type: entry.state === "update" ? "update" : "install", disabled: true };
  return { type: entry.state === "update" ? "update" : "install", disabled: false };
}

export function filterModules(modules, { query = "", trust = "all" } = {}) {
  const needle = query.trim().toLowerCase();
  return modules.filter((m) => (trust === "all" || m.trust === trust)
    && (!needle || [m.key, m.name, m.description, m.publisher?.displayName ?? (m.official ? "Runly" : "")].some((value) => String(value ?? "").toLowerCase().includes(needle))));
}

export const SCOPE_TEXT = "Se instala una vez para toda la instancia y queda habilitado para todas las empresas. Cada empresa puede deshabilitarlo después desde Módulos.";

// Freshness of the verified catalog copy that backs an entry (per trust domain).
export const domainOf = (entry) => (entry.source === "official" ? "official" : "community");
export function freshnessOf(data, entry) {
  return data?.catalogs?.[domainOf(entry)]?.freshness ?? "fresh";
}
export const FRESHNESS_TEXT = {
  fresh: null,
  stale: "El catálogo no responde: se usa la última copia verificada, que puede estar desactualizada. Instalar o actualizar requiere tu confirmación.",
  expired: "El catálogo no responde y la última copia verificada es demasiado antigua: se puede consultar, pero no instalar ni actualizar.",
};
export const SOURCE_MODES = [
  { id: "runly", label: "Catálogo de Runly" },
  { id: "custom", label: "Personalizado" },
  { id: "disabled", label: "Desactivado" },
];
export const ERROR_TEXT = {
  catalog_unreachable: "No se pudo conectar con el catálogo. Si el catálogo de Runly aún no está publicado o no responde, inténtalo más tarde; los módulos instalados siguen funcionando.",
  catalog_url_rejected: "La URL del catálogo no es HTTPS ni un archivo local permitido.",
};
