// Turns an upload "check" (staged package + preflight, nothing installed)
// into a report the UI can show before applying: what blocks the update,
// what changes in the database structure and what to watch out for — in
// Spanish. Blockers mirror module-package-service.js#publishZip exactly so
// "Revisar" never approves something "Aplicar" would reject.
// See docs/superpowers/specs/2026-09-28-module-update-review-design.md.

const nameOf = (value) => (value && typeof value === "object" ? value.name : value) ?? "";

function compareVersions(left, right) {
  const parse = (value) => String(value ?? "0.0.0").split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [parse(left), parse(right)];
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

export function describeOperation(operation) {
  const table = operation.table;
  const column = nameOf(operation.column);
  switch (operation.type) {
    case "CREATE_TABLE": return `Se creará la tabla ${table}.`;
    case "ADD_COLUMN": return operation.safety === "SAFE"
      ? `Se agregará la columna ${column} en ${table}.`
      : `La columna nueva ${column} en ${table} es obligatoria y la tabla ya tiene registros: agrégala como opcional o con valor por defecto.`;
    case "ADD_INDEX": return `Se agregará un índice en ${table}.`;
    case "DROP_COLUMN": return `Se eliminaría la columna ${column} de ${table} (perdería sus datos).`;
    case "DROP_INDEX": return `Se eliminaría un índice de ${table}.`;
    case "ALTER_COLUMN_TYPE": return `Se cambiaría el tipo de la columna ${column} en ${table}.`;
    case "ALTER_COLUMN": return `Se cambiaría la definición de la columna ${column} en ${table}.`;
    default: return `${operation.type} en ${table}${column ? `.${column}` : ""}.`;
  }
}

export function buildUpdateReport({ staged, moduleRow, preflight, noChanges, preview }) {
  const blockers = [];
  const changes = [];
  const warnings = [];
  const schema = preflight?.schemaMigration ?? null;

  for (const operation of schema?.operations ?? []) {
    const text = describeOperation(operation);
    if (operation.safety === "SAFE") changes.push(text);
    else if (!schema.canAutoApply) blockers.push(text);
    else warnings.push(text);
  }
  if (schema?.drift?.length) {
    blockers.push(`La estructura instalada no coincide con la esperada en ${schema.drift.length} punto(s) (alguien la modificó fuera de Runly). Pide ayuda a un administrador.`);
  }
  // Upload itself does not require dependencies (installing does), so this
  // is a warning, like publishZip.
  for (const dependency of preflight?.missingRequired ?? []) {
    warnings.push(`Requiere el módulo ${dependency}; no se podrá instalar hasta que esté instalado.`);
  }

  const currentVersion = moduleRow?.version ?? null;
  const nextVersion = staged.manifest.version;
  const versionNotIncreased = Boolean(currentVersion) && !noChanges && compareVersions(nextVersion, currentVersion) <= 0;
  if (versionNotIncreased) warnings.push(`La versión no aumentó (instalada ${currentVersion}, nueva ${nextVersion}). Súbela en module.manifest.js para poder identificar esta actualización.`);
  if (preview?.error) warnings.push(`No se pudieron compilar tus componentes React: ${preview.error}`);

  const customViews = (staged.views ?? [])
    .filter((view) => view?.kind === "CUSTOM")
    .map((view) => ({ key: view.key, title: view.schema?.title ?? view.key, component: view.schema?.component ?? null, path: view.schema?.path ?? null }));

  return {
    valid: true,
    blocked: blockers.length > 0,
    blockers,
    changes,
    warnings,
    installed: moduleRow?.status === "INSTALLED",
    currentVersion,
    nextVersion,
    versionNotIncreased,
    noChanges: Boolean(noChanges),
    inspection: staged.inspection,
    customViews,
    preview: preview?.id ? { id: preview.id } : null,
  };
}

export function invalidPackageReport(error) {
  return {
    valid: false,
    blocked: true,
    blockers: [`El paquete no es válido: ${error?.message ?? "error desconocido"}${error?.details?.expected ? ` (se esperaba la clave ${error.details.expected}, el ZIP trae ${error.details.found})` : ""}.`],
    changes: [],
    warnings: [],
    customViews: [],
    preview: null,
  };
}
