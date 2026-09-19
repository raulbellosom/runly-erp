export function stripMarkdown(text) {
  if (text === undefined || text === null || text === "") return "—";
  return String(text)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^>\s*/gm, "")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^-{3,}$/gm, "")
    .replace(/\n+/g, " ")
    .trim() || "—";
}

const ACCENT_MAP = {
  vehiculo: "vehículo", vehiculos: "vehículos",
  matricula: "matrícula", matriculas: "matrículas",
  anio: "año", anios: "años",
  gestion: "gestión", gestiones: "gestiones",
  administracion: "administración", administraciones: "administraciones",
  asignacion: "asignación", asignaciones: "asignaciones",
  creacion: "creación", actualizacion: "actualización", eliminacion: "eliminación",
  autorizacion: "autorización", autorizaciones: "autorizaciones",
  aprobacion: "aprobación", aprobaciones: "aprobaciones",
  notificacion: "notificación", notificaciones: "notificaciones",
  configuracion: "configuración", informacion: "información",
  comunicacion: "comunicación", conexion: "conexión", sesion: "sesión",
  seleccion: "selección", edicion: "edición",
  accion: "acción", acciones: "acciones",
  aplicacion: "aplicación", operacion: "operación", operaciones: "operaciones",
  funcion: "función", funciones: "funciones",
  relacion: "relación", relaciones: "relaciones",
  condicion: "condición", condiciones: "condiciones",
  situacion: "situación", direccion: "dirección", direcciones: "direcciones",
  revision: "revisión",
  modulo: "módulo", modulos: "módulos",
  numero: "número", numeros: "números",
  codigo: "código", codigos: "códigos",
  telefono: "teléfono", telefonos: "teléfonos",
  categoria: "categoría", categorias: "categorías",
  area: "área", areas: "áreas",
  periodo: "período", periodos: "períodos",
  titulo: "título", titulos: "títulos",
  credito: "crédito", creditos: "créditos",
  debito: "débito", debitos: "débitos",
  indice: "índice", indices: "índices",
  genero: "género", generos: "géneros",
  publico: "público", publicos: "públicos",
};

export function normalizeSpanishLabel(text) {
  if (!text || typeof text !== "string") return text;
  return text.replace(/\b[A-Za-z]+\b/g, (word) => {
    const lower = word.toLowerCase();
    const accented = ACCENT_MAP[lower];
    if (!accented) return word;
    if (word.length > 1 && word === word.toUpperCase()) return accented.toUpperCase();
    if (word.charAt(0) !== word.charAt(0).toLowerCase()) {
      return accented.charAt(0).toUpperCase() + accented.slice(1);
    }
    return accented;
  });
}

/**
 * Detects whether a form should render as a full page instead of a Sheet overlay.
 * `page` and `sheet` are explicit overrides. `auto` (or invalid values)
 * falls back to the heuristic: > 6 visible fields, or > 2 sections.
 */
export function resolveFormMode(schema) {
  const mode = String(schema?.formMode ?? "")
    .trim()
    .toLowerCase();
  if (mode === "page") return "page";
  if (mode === "sheet") return "sheet";
  if (mode === "auto") return "auto";
  return "auto";
}

export function shouldUsePageMode(schema, fields) {
  const formMode = resolveFormMode(schema);
  if (formMode === "page") return true;
  if (formMode === "sheet") return false;

  const sections = Array.isArray(schema?.sections) ? schema.sections : [];
  if (sections.length > 2) return true;

  const allFields = Array.isArray(fields) ? fields : [];
  const visibleFields = allFields.filter((f) => f && !f.readonly && (f.name ?? f.key ?? f.field));
  if (visibleFields.length > 6) return true;

  return false;
}

export function resolveAccentColor(module, blueprint) {
  return (
    module?.accentColor ??
    module?.color ??
    blueprint?.schema?.accentColor ??
    null
  );
}

/**
 * Normalizes the `relation` metadata from a blueprint field descriptor into a
 * canonical shape with all defaults applied.  Returns null when the config is
 * invalid (e.g. source="remote" with no apiPath) so callers can degrade safely.
 */
export function normalizeRelationDescriptor(fieldLike) {
  if (!fieldLike || typeof fieldLike !== 'object') return null;
  const raw = fieldLike.relation;
  if (!raw || typeof raw !== 'object') return null;

  const apiPath = typeof raw.apiPath === 'string' && raw.apiPath.trim() ? raw.apiPath.trim() : null;
  const rawOptions = Array.isArray(raw.options) ? raw.options : [];

  let source = raw.source;
  if (source !== 'static' && source !== 'remote') {
    source = apiPath ? 'remote' : rawOptions.length > 0 ? 'static' : 'remote';
  }

  if (source === 'remote' && !apiPath) return null;

  const required = Boolean(fieldLike.required);

  const staticOptions = rawOptions
    .filter((o) => o && typeof o === 'object' && o.value != null)
    .map((o) => ({ value: String(o.value), label: String(o.label ?? o.value) }));

  const rawLabelField = raw.labelField;
  const labelField = Array.isArray(rawLabelField)
    ? rawLabelField
    : typeof rawLabelField === 'string' && rawLabelField
    ? rawLabelField
    : 'name';

  let create = null;
  const rawCreate = raw.create;
  if (rawCreate && typeof rawCreate === 'object' && rawCreate.enabled === true) {
    const mode = typeof rawCreate.mode === 'string' && rawCreate.mode.trim()
      ? rawCreate.mode.trim().toLowerCase()
      : 'modal';
    const viewKey = typeof rawCreate.viewKey === 'string' && rawCreate.viewKey.trim()
      ? rawCreate.viewKey.trim()
      : null;
    const createApiPath =
      typeof rawCreate.apiPath === 'string' && rawCreate.apiPath.trim()
        ? rawCreate.apiPath.trim()
        : apiPath;
    const allowedWhen =
      typeof rawCreate.allowedWhen === 'string' && rawCreate.allowedWhen.trim()
        ? rawCreate.allowedWhen.trim().toLowerCase()
        : 'always';
    const allowedWhenNormalized =
      allowedWhen === 'empty-search' || allowedWhen === 'has-search' || allowedWhen === 'always'
        ? allowedWhen
        : 'always';

    if (mode === 'modal' && viewKey && createApiPath) {
      create = {
        enabled: true,
        label:
          typeof rawCreate.label === 'string' && rawCreate.label.trim()
            ? rawCreate.label.trim()
            : null,
        mode,
        title:
          typeof rawCreate.title === 'string' && rawCreate.title.trim()
            ? rawCreate.title.trim()
            : null,
        apiPath: createApiPath,
        viewKey,
        selectCreated: rawCreate.selectCreated !== false,
        refreshOptions: rawCreate.refreshOptions !== false,
        prefillFromSearch: rawCreate.prefillFromSearch === true,
        allowedWhen: allowedWhenNormalized,
        permissionKey:
          typeof rawCreate.permissionKey === 'string' && rawCreate.permissionKey.trim()
            ? rawCreate.permissionKey.trim()
            : null,
      };
    } else if (mode === 'quick' && createApiPath) {
      // Lightweight create: POST { [nameField]: searchText } directly, no
      // nested form/modal — for simple name-only catalogs (job titles,
      // departments, categories, brands, locations).
      create = {
        enabled: true,
        label:
          typeof rawCreate.label === 'string' && rawCreate.label.trim()
            ? rawCreate.label.trim()
            : null,
        mode,
        apiPath: createApiPath,
        nameField:
          typeof rawCreate.nameField === 'string' && rawCreate.nameField.trim()
            ? rawCreate.nameField.trim()
            : 'name',
        selectCreated: rawCreate.selectCreated !== false,
        refreshOptions: rawCreate.refreshOptions !== false,
        allowedWhen: allowedWhenNormalized,
        permissionKey:
          typeof rawCreate.permissionKey === 'string' && rawCreate.permissionKey.trim()
            ? rawCreate.permissionKey.trim()
            : null,
      };
    }
  }

  return {
    source,
    apiPath,
    options: staticOptions,
    valueField: typeof raw.valueField === 'string' && raw.valueField ? raw.valueField : 'id',
    labelField,
    labelSeparator: typeof raw.labelSeparator === 'string' ? raw.labelSeparator : ' ',
    searchParam: typeof raw.searchParam === 'string' && raw.searchParam ? raw.searchParam : 'search',
    pageParam: typeof raw.pageParam === 'string' && raw.pageParam ? raw.pageParam : 'page',
    pageSizeParam: typeof raw.pageSizeParam === 'string' && raw.pageSizeParam ? raw.pageSizeParam : 'pageSize',
    pageSize: typeof raw.pageSize === 'number' && raw.pageSize > 0 ? raw.pageSize : 20,
    preload: raw.preload !== false,
    clearable: typeof raw.clearable === 'boolean' ? raw.clearable : !required,
    disabledField: typeof raw.disabledField === 'string' && raw.disabledField ? raw.disabledField : null,
    displayFields: raw.displayFields != null && typeof raw.displayFields === 'object' && !Array.isArray(raw.displayFields)
      ? raw.displayFields
      : null,
    create,
  };
}

/**
 * Converts the normalized filter array used by RunlyTable to the FilterBar-compatible
 * format. Only select-type filters with at least one option are included.
 */
export function normalizeToFilterBarFilters(normalizedFilters) {
  return normalizedFilters
    .filter((f) => f.type === "select" && Array.isArray(f.options) && f.options.length > 0)
    .map((f) => ({
      key: f.key,
      label: f.label,
      options: f.options.map((o) => {
        if (o && typeof o === "object") {
          const value = o.value ?? o.key ?? o.id ?? "";
          return { value: String(value), label: String(o.label ?? o.name ?? value) };
        }
        return { value: String(o), label: String(o) };
      }),
    }));
}
