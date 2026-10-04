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
  const rows = operation.failingRows;
  switch (operation.type) {
    case "CREATE_TABLE": return `Se creará la tabla ${table}.`;
    case "ADD_COLUMN":
      if (operation.reason === "name_reused") return `La columna ${column} de ${table} ya existe con otro campo: usa otro nombre.`;
      return operation.safety === "NEEDS_BACKFILL"
        ? `La columna nueva ${column} en ${table} es obligatoria y la tabla ya tiene ${operation.rowCount} registro(s): indica el valor para los registros existentes.`
        : `Se agregará la columna ${column} en ${table}.`;
    case "ADD_INDEX":
      if (operation.safety === "NEEDS_CHECK") return `No se puede exigir valores únicos en ${table}: hay ${rows} valor(es) repetido(s). Corrígelos antes de actualizar.`;
      return `Se agregará un índice${operation.index?.unique ? " único" : ""} en ${table}.`;
    case "RENAME_COLUMN": return operation.safety === "SAFE"
      ? `Se renombrará la columna ${operation.from} a ${column} en ${table} (conserva sus datos).`
      : `No se puede renombrar ${operation.from} a ${column} en ${table}: ya existe una columna con ese nombre.`;
    case "ARCHIVE_COLUMN": return operation.safety === "SAFE"
      ? `El campo ${column} de ${table} se archivará: deja de mostrarse, pero sus datos se conservan y puedes restaurarlo.`
      : `La columna ${column} de ${table} no se puede quitar.`;
    case "RESTORE_COLUMN": return `Se restaurará el campo archivado ${column} en ${table}, con sus datos.`;
    case "ALTER_COLUMN_TYPE":
      if (operation.safety === "UNSUPPORTED") return `No se puede convertir la columna ${column} de ${table} de ${operation.from} a ${operation.to}.`;
      return operation.safety === "NEEDS_CONVERSION"
        ? `La columna ${column} de ${table} cambiará de tipo y ${rows} registro(s) no se pueden convertir: elige dejarlos vacíos o cancela.`
        : `La columna ${column} de ${table} cambiará de ${operation.from} a ${operation.to}; todos los registros se convierten.`;
    case "SET_NOT_NULL": return operation.safety === "NEEDS_BACKFILL"
      ? `El campo ${column} de ${table} será obligatorio y ${rows} registro(s) están vacíos: indica el valor para llenarlos.`
      : `El campo ${column} de ${table} será obligatorio.`;
    case "DROP_NOT_NULL": return `El campo ${column} de ${table} dejará de ser obligatorio.`;
    case "ALTER_COLUMN_DEFAULT": return `Cambiará el valor predeterminado de ${column} en ${table}.`;
    case "DROP_COLUMN": return `Se eliminaría la columna ${column} de ${table} (perdería sus datos).`;
    case "DROP_INDEX": return `Se eliminará un índice de ${table} (no se pierden datos).`;
    case "DROP_TABLE": return `Se eliminaría la tabla ${table} (perdería sus datos).`;
    default: return `${operation.type} en ${table}${column ? `.${column}` : ""}.`;
  }
}

// One row per structural operation for the "Cambios de estructura" table:
// what it does, how safe it is and which decision it still needs.
export function describeStructure(schema) {
  const blockers = new Map((schema?.blockers ?? []).map((entry) => [entry.id, entry.reason]));
  return (schema?.operations ?? []).map((operation) => ({
    id: operation.id,
    type: operation.type,
    table: operation.table,
    column: nameOf(operation.column) || null,
    safety: operation.safety,
    needs: operation.safety === "NEEDS_BACKFILL" ? "backfill" : operation.safety === "NEEDS_CONVERSION" ? "conversion" : null,
    nullable: operation.nullable ?? operation.column?.nullable ?? null,
    sqlType: operation.sqlType ?? operation.column?.sqlType ?? operation.to ?? null,
    suggestedValue: operation.default ?? operation.column?.default ?? null,
    failingRows: operation.failingRows ?? null,
    blocker: blockers.get(operation.id) ?? null,
    description: describeOperation(operation),
  }));
}

export function buildUpdateReport({ staged, moduleRow, preflight, noChanges, preview, designReview = [] }) {
  const blockers = [];
  const changes = [];
  const warnings = [];
  const schema = preflight?.schemaMigration ?? null;

  // Operations waiting for a decision are not blockers: the report's
  // "Cambios de estructura" table asks for them (describeStructure).
  const pendingDecision = new Set(["backfill_required", "conversion_failing_rows"]);
  // Plans without `blockers` (older callers): anything not auto-applicable blocks.
  const blockerReasons = new Map((schema?.blockers ?? (schema?.operations ?? [])
    .filter((operation) => !schema.canAutoApply && !["SAFE", "CONDITIONAL"].includes(operation.safety))
    .map((operation) => ({ id: operation.id ?? operation, reason: operation.safety })))
    .map((entry) => [entry.id, entry.reason]));
  for (const operation of schema?.operations ?? []) {
    const text = describeOperation(operation);
    const reason = blockerReasons.get(operation.id ?? operation);
    if (!reason) (["SAFE", "CONDITIONAL"].includes(operation.safety) ? changes : warnings).push(text);
    else if (!pendingDecision.has(reason)) blockers.push(text);
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
    structure: describeStructure(schema),
    decisionsPending: (schema?.blockers ?? []).some((entry) => pendingDecision.has(entry.reason)),
    preview: preview?.id ? { id: preview.id } : null,
    // Static design findings for components/ (module-compiler design-review);
    // informative only, never blockers.
    designReview,
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
