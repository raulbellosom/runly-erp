// Module Builder — Spanish, user-facing wording for the diagnostics returned
// by @runly/module-compiler's validateModuleDefinition() ({ path, code,
// message }). The compiler messages are English and technical; this maps each
// code to a sentence, locates it with the labels the user sees (entity,
// field, view, public link) and names the editor tab where it is fixed.
// Unknown codes fall back to the compiler message.

const TAB_BY_ROOT = {
  entities: "data",
  views: "views",
  navigation: "navigation",
  permissions: "permissions",
  publicLinks: "public",
  extensions: "views",
};

export const TAB_LABELS = {
  general: "General",
  data: "Datos",
  views: "Vistas",
  navigation: "Navegación",
  permissions: "Permisos",
  public: "Enlaces",
};

// Quoted value in the compiler message, e.g. Duplicate field key "nombre".
function quoted(message) {
  return /"([^"]+)"/.exec(message ?? "")?.[1] ?? null;
}

const q = (value) => (value ? ` «${value}»` : "");

const REQUIRED_BY_PATH = [
  [/^entities$/, "El módulo necesita al menos una entidad."],
  [/^name$/, "El módulo necesita un nombre."],
  [/\.fields$/, "La entidad necesita al menos un campo."],
  [/\.label$/, "Falta el nombre visible."],
  [/\.title$/, "Falta el título."],
];

const TEXTS = {
  NOT_JSON_COMPATIBLE: () => "La definición del módulo está dañada.",
  UNSUPPORTED_SCHEMA_VERSION: () => "La versión de la definición no es compatible.",
  INVALID_MODULE_KEY: () => "La clave del módulo debe tener el formato custom.nombre en minúsculas.",
  RESERVED_MODULE_NAMESPACE: () => "La clave del módulo usa un prefijo reservado.",
  INVALID_SEMVER: () => "La versión debe tener el formato 1.0.0.",
  INVALID_ICON: () => "El ícono elegido no está disponible.",
  INVALID_COLOR: () => "El color debe ser un valor hexadecimal de seis dígitos.",
  INVALID_PWA_SHORT_NAME: () => "El nombre corto de la app es obligatorio y admite hasta 14 caracteres.",
  INVALID_PRESET: () => "El tipo de módulo no es válido.",
  UNSAFE_ROUTE_PATH: () => "La ruta debe quedar dentro del módulo.",
  UNSAFE_SOURCE_TEXT: () => "El texto tiene caracteres que no se pueden usar.",
  INVALID_ENTITY_KEY: () => "La clave de la entidad debe ir en minúsculas, sin espacios ni acentos.",
  DUPLICATE_ENTITY_KEY: (m) => `Hay dos entidades con la clave${q(quoted(m))}.`,
  INVALID_FIELD_KEY: (m) => `La clave del campo${q(quoted(m))} no es válida o está reservada.`,
  DUPLICATE_FIELD_KEY: (m) => `Hay dos campos con la clave${q(quoted(m))}.`,
  INVALID_FIELD_TYPE: (m) => `El tipo de campo${q(quoted(m))} no es compatible.`,
  INVALID_SELECT_OPTIONS: () => "Un campo de selección necesita al menos una opción.",
  DUPLICATE_SELECT_OPTION_VALUE: (m) => `La opción${q(quoted(m))} está repetida.`,
  UNSAFE_DEFAULT: () => "El valor predeterminado debe ser texto, número o sí/no.",
  MISSING_RELATION_TARGET: () => "Elige con qué se relaciona el campo.",
  RELATION_TARGET_NOT_FOUND: (m) => `La relación apunta a${q(quoted(m))}, que ya no existe.`,
  RELATION_TARGET_CONFLICT: () => "Una relación apunta a una entidad del módulo o a una del sistema, no a ambas.",
  EXTERNAL_RELATION_TARGET_NOT_FOUND: (m) => `La entidad del sistema${q(quoted(m))} no existe.`,
  RELATION_SET_NULL_REQUIRED: () => "Un campo obligatorio no puede vaciarse al desactivar el registro relacionado.",
  RELATION_LABEL_FIELD_NOT_FOUND: () => "El campo a mostrar de la relación no existe.",
  RELATION_INVALID_ON_DISABLE: () => "La regla al desactivar el registro relacionado no es válida.",
  RELATION_CASCADE_CYCLE: () => "Las relaciones en cascada forman un ciclo.",
  FILE_MAX_SIZE_OUT_OF_RANGE: () => "El tamaño máximo del archivo está fuera del rango permitido.",
  FILE_INVALID_ACCEPT: () => "El tipo de archivo permitido no es válido.",
  FILE_CAMERA_REQUIRES_IMAGE: () => "La cámara solo se puede usar en campos de imagen.",
  DUPLICATE_VIEW_KEY: (m) => `Hay dos vistas con la clave${q(quoted(m))}.`,
  VIEW_ENTITY_NOT_FOUND: (m) => `La vista usa la entidad${q(quoted(m))}, que ya no existe.`,
  UNKNOWN_ENTITY: (m) => `La vista usa la entidad${q(quoted(m))}, que ya no existe.`,
  UNKNOWN_FIELD: (m) => `La vista usa el campo${q(quoted(m))}, que ya no existe.`,
  UNKNOWN_GROUP_FIELD: (m) => `El campo para agrupar${q(quoted(m))} no existe.`,
  INVALID_GROUP_FIELD_TYPE: () => "El tablero solo agrupa por un campo de selección o sí/no.",
  TOO_MANY_COLUMNS: () => "El campo para agrupar tiene demasiadas opciones para el tablero.",
  UNKNOWN_CARD_FIELD: (m) => `La tarjeta usa el campo${q(quoted(m))}, que ya no existe.`,
  UNSUPPORTED_CARD_FIELD: () => "La tarjeta del tablero no puede mostrar relaciones.",
  INVALID_CARD_FIELD_TYPE: () => "La imagen de la tarjeta debe ser un campo de archivo.",
  INVALID_ORDER_FIELD: (m) => `El orden usa el campo${q(quoted(m))}, que no existe.`,
  INVALID_FILTER: (m) => `El filtro usa el campo${q(quoted(m))}, que no existe.`,
  AGGREGATE_TYPE_MISMATCH: () => "Sumar o promediar requiere un campo numérico.",
  UNKNOWN_PERMISSION: (m) => `El permiso${q(quoted(m))} no existe en el módulo.`,
  PERMISSION_NAMESPACE_ESCAPE: () => "El permiso debe pertenecer a este módulo.",
  NAVIGATION_PAGE_NOT_FOUND: (m) => `El menú apunta a la vista${q(quoted(m))}, que ya no existe.`,
  NAVIGATION_PERMISSION_NOT_FOUND: (m) => `El menú usa el permiso${q(quoted(m))}, que no existe.`,
  LAYOUT_FIELD_NOT_FOUND: (m) => `El diseño usa el campo${q(quoted(m))}, que ya no existe.`,
  LAYOUT_DUPLICATE_FIELD: (m) => `El campo${q(quoted(m))} aparece dos veces en el diseño.`,
  LAYOUT_UNPLACED_FIELDS: () => "Hay campos que no están colocados en el diseño.",
  LAYOUT_RULE_FIELD_NOT_FOUND: (m) => `Una condición usa el campo${q(quoted(m))}, que ya no existe.`,
  LAYOUT_RULE_FIELD_NOT_PLACED: () => "Una condición depende de un campo que no está en el diseño.",
  LAYOUT_RULE_SELF_HIDING: () => "Un campo no puede ocultarse a sí mismo.",
  LAYOUT_RULE_FIELD_TYPE: () => "Una condición usa un tipo de campo que no se puede comparar.",
  LAYOUT_RULE_UNKNOWN_OPTION: () => "Una condición compara con una opción que ya no existe.",
  LAYOUT_RULE_INVALID: () => "Hay una condición incompleta en el diseño.",
  LAYOUT_TOO_MANY_KPIS: () => "El diseño tiene demasiados indicadores.",
  LAYOUT_KPI_INVALID_TYPE: () => "Un indicador usa un campo que no es numérico.",
  LAYOUT_MULTIPLE_ATTACHMENTS: () => "El diseño solo admite una sección de adjuntos.",
  LAYOUT_HERO_IMAGE_NOT_IMAGE: () => "La imagen de la portada debe ser un campo de imagen.",
  LAYOUT_HERO_STATUS_NOT_SELECT: () => "El estado de la portada debe ser un campo de selección.",
  LAYOUT_RELATED_INVALID_SOURCE: () => "Una sección de registros relacionados apunta a una relación que no existe.",
  EXTENSIONS_INVALID: () => "Las pantallas propias guardadas están dañadas.",
  EXTENSIONS_TOO_LARGE: () => "Las pantallas propias ocupan demasiado espacio.",
  EXTENSION_PATH_NOT_ALLOWED: () => "Una pantalla propia tiene un archivo en una ubicación no permitida.",
  EXTENSION_NOT_TEXT: () => "Una pantalla propia tiene un archivo que no es de texto.",
  EXTENSION_DUPLICATE_PATH: () => "Una pantalla propia tiene un archivo repetido.",
  EXTENSION_VIEW_NOT_FOUND: () => "Una pantalla propia apunta a una vista que no existe.",
  PUBLIC_LINKS_TOO_MANY: () => "Hay demasiadas páginas públicas.",
  PUBLIC_LINK_KEY_INVALID: () => "La clave de la página pública debe ir en minúsculas, sin espacios.",
  PUBLIC_LINK_DUPLICATE: (m) => `Hay dos páginas públicas con la clave${q(quoted(m))}.`,
  PUBLIC_LINK_MODE_INVALID: () => "Elige si la página pública es ficha o formulario.",
  PUBLIC_LINK_ENTITY_NOT_FOUND: (m) => `La página pública usa la entidad${q(quoted(m))}, que ya no existe.`,
  PUBLIC_LINK_NOT_COMPANY_SCOPED: () => "La entidad de la página pública debe pertenecer a la empresa.",
  PUBLIC_LINK_FIELDS_REQUIRED: () => "Marca al menos un campo para la página pública.",
  PUBLIC_LINK_TOO_MANY_FIELDS: () => "La página pública tiene demasiados campos.",
  PUBLIC_LINK_FIELD_NOT_FOUND: (m) => `La página pública usa el campo${q(quoted(m))}, que ya no existe.`,
  PUBLIC_LINK_FIELD_NOT_ALLOWED: (m) => `El campo${q(quoted(m))} no se puede usar en una página pública.`,
  PUBLIC_LINK_LINK_FIELD_INVALID: () => "El campo para ligar el formulario debe ser una relación hacia la entidad compartida.",
  PUBLIC_LINK_REQUIRED_FIELD_MISSING: (m) => `El formulario público debe incluir el campo obligatorio${q(quoted(m))}.`,
};

// "entities[0].fields[2].key" -> "Entidad «Visita» › campo «Nombre»".
function describeLocation(path, definition) {
  const parts = [];
  const entityMatch = /^entities\[(\d+)\](?:\.fields\[(\d+)\])?/.exec(path);
  if (entityMatch) {
    const entity = definition?.entities?.[Number(entityMatch[1])];
    parts.push(`Entidad «${entity?.label || entity?.key || Number(entityMatch[1]) + 1}»`);
    if (entityMatch[2] !== undefined) {
      const field = entity?.fields?.[Number(entityMatch[2])];
      parts.push(`campo «${field?.label || field?.key || Number(entityMatch[2]) + 1}»`);
    }
    return parts.join(" › ");
  }
  const viewMatch = /^views\[(\d+)\]/.exec(path);
  if (viewMatch) {
    const view = definition?.views?.[Number(viewMatch[1])];
    return `Vista «${view?.label || view?.title || view?.key || Number(viewMatch[1]) + 1}»`;
  }
  const linkMatch = /^publicLinks\[(\d+)\]/.exec(path);
  if (linkMatch) {
    const link = definition?.publicLinks?.[Number(linkMatch[1])];
    return `Página pública «${link?.title || link?.key || Number(linkMatch[1]) + 1}»`;
  }
  if (/^navigation/.test(path)) return "Menú";
  if (/^permissions/.test(path)) return "Permisos";
  return null;
}

export function describeDiagnostic(diagnostic, definition) {
  const path = diagnostic?.path ?? "";
  const root = /^[a-zA-Z]+/.exec(path)?.[0] ?? "";
  const tab = TAB_BY_ROOT[root] ?? "general";
  let text = null;
  if (diagnostic?.code === "REQUIRED") text = REQUIRED_BY_PATH.find(([pattern]) => pattern.test(path))?.[1] ?? "Falta un dato obligatorio.";
  else text = TEXTS[diagnostic?.code]?.(diagnostic.message) ?? null;
  return {
    text: text ?? diagnostic?.message ?? "Problema de validación.",
    location: describeLocation(path, definition),
    tab,
    tabLabel: TAB_LABELS[tab],
  };
}
