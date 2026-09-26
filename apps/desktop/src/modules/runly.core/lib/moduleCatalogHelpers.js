// apps/desktop/src/modules/runly.core/lib/moduleCatalogHelpers.js
//
// Pure helpers and lookup tables for the module catalog screen. Extracted
// from ModuleCatalog.jsx on 2026-09-25 to keep that file under the
// CLAUDE.md 1000-line limit — no React, no side effects, safe to import
// from any of the screen's split-out sub-components.
import { CATEGORY_LABELS } from "../../../lib/runtimeModules";

export const STATUS_DOT = {
  INSTALLED: "#22c55e",
  DISABLED: "#f59e0b",
  UNINSTALLED: "#94a3b8",
  ERROR: "#ef4444",
};

export const STATUS_VARIANT = {
  INSTALLED: "success",
  DISABLED: "warning",
  UNINSTALLED: "secondary",
  ERROR: "destructive",
};

export const KIND_LABEL = {
  CORE: "Sistema",
  FEATURE: "Módulo",
  INTEGRATION: "Integración",
  WEBSITE: "Sitio web",
};

export const ERROR_STAGE_LABEL = {
  validation: "Validación",
  dependency_sync: "Dependencias",
  orm_migration: "Migración ORM",
  manifest_migration: "Migración manifiesto",
  install: "Instalación",
  route_loader: "Carga de rutas",
  unknown: "Desconocido",
};

export function getFirstFiniteNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function statusLabel(module) {
  if (module.core) return "Core";
  if (module.updateAvailable) return "Actualización disponible";
  if (module.status === "INSTALLED" && module.enabled) return "Instalado";
  if (module.status === "DISABLED") return "Deshabilitado";
  if (module.status === "UNINSTALLED") return "Sin instalar";
  if (module.status === "ERROR") return "Error";
  return module.status;
}

export function getPublisher(module) {
  if (module.core || module.kind === "CORE") return "Runly ERP";
  return module.publisher ?? "Comunidad";
}

export function getCategoryLabel(module) {
  return CATEGORY_LABELS[module.category] ?? module.category ?? "General";
}

export function isLocked(module) {
  return module.core || module.uninstallable === false;
}

export function getModuleErrorSummary(module) {
  if (module?.status !== "ERROR") return null;
  const lastError =
    module.lastError ?? module.lifecycleConfig?.lastError ?? null;
  if (!lastError) {
    return {
      message: "No hay detalle de error disponible para este módulo.",
      stageLabel: null,
      code: null,
    };
  }
  const message = String(lastError.message ?? "").trim();
  return {
    message:
      message.length > 220
        ? `${message.slice(0, 220)}...`
        : message || "No hay detalle de error disponible para este módulo.",
    stageLabel: lastError.stage
      ? (ERROR_STAGE_LABEL[lastError.stage] ?? String(lastError.stage))
      : null,
    code: lastError.code ? String(lastError.code) : null,
  };
}

export function buildModuleErrorDetail(module, lastError) {
  if (!lastError || typeof lastError !== "object") {
    return {
      title: module?.name ?? module?.key ?? "Módulo",
      summary: "No hay diagnóstico detallado de error disponible.",
      copyText: `Módulo: ${module?.name ?? "-"}\nClave: ${module?.key ?? "-"}\n\nNo hay diagnóstico detallado de error disponible.`,
      raw: null,
    };
  }

  const stage = lastError?.stage ? String(lastError.stage) : null;
  const stageLabel = stage ? (ERROR_STAGE_LABEL[stage] ?? stage) : null;
  const code = lastError?.code ? String(lastError.code) : null;
  const requestId = lastError?.requestId ? String(lastError.requestId) : null;
  const failedAt = lastError?.failedAt ? String(lastError.failedAt) : null;
  const retryable =
    typeof lastError?.retryable === "boolean"
      ? lastError.retryable
        ? "Sí"
        : "No"
      : null;
  const affectedTables = Array.isArray(lastError?.affectedTables)
    ? lastError.affectedTables.filter(Boolean).map(String)
    : [];
  const affectedMigrations = Array.isArray(lastError?.affectedMigrations)
    ? lastError.affectedMigrations.filter(Boolean).map(String)
    : [];
  const message =
    String(lastError?.message ?? "").trim() || "Sin mensaje de error.";
  const cause = String(lastError?.cause ?? "").trim() || null;

  const lines = [
    `Módulo: ${module?.name ?? "-"}`,
    `Clave: ${module?.key ?? "-"}`,
    stageLabel ? `Etapa: ${stageLabel}` : null,
    code ? `Código: ${code}` : null,
    requestId ? `RequestId: ${requestId}` : null,
    failedAt ? `Fecha: ${failedAt}` : null,
    retryable ? `Reintentable: ${retryable}` : null,
    "",
    `Mensaje: ${message}`,
    cause ? `Causa: ${cause}` : null,
    affectedTables.length > 0
      ? `Tablas afectadas: ${affectedTables.join(", ")}`
      : null,
    affectedMigrations.length > 0
      ? `Migraciones afectadas: ${affectedMigrations.join(", ")}`
      : null,
    "",
    "Payload JSON:",
    JSON.stringify(lastError, null, 2),
  ].filter(Boolean);

  return {
    title: module?.name ?? module?.key ?? "Módulo",
    summary: message,
    copyText: lines.join("\n"),
    raw: lastError,
  };
}
