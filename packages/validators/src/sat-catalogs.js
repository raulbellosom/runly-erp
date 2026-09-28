// SAT CFDI 4.0 catalogs used by runly.contacts fiscal data.
// Source: SAT Anexo 20 catalogs c_RegimenFiscal and c_UsoCFDI (CFDI 4.0).
// Codes are what gets stored; labels are display-only. `fisica`/`moral`
// flag which RFC person type each entry applies to.

export const REGIMEN_FISCAL = [
  { code: "601", label: "General de Ley Personas Morales", fisica: false, moral: true },
  { code: "603", label: "Personas Morales con Fines no Lucrativos", fisica: false, moral: true },
  { code: "605", label: "Sueldos y Salarios e Ingresos Asimilados a Salarios", fisica: true, moral: false },
  { code: "606", label: "Arrendamiento", fisica: true, moral: false },
  { code: "607", label: "Régimen de Enajenación o Adquisición de Bienes", fisica: true, moral: false },
  { code: "608", label: "Demás ingresos", fisica: true, moral: false },
  { code: "610", label: "Residentes en el Extranjero sin Establecimiento Permanente en México", fisica: true, moral: true },
  { code: "611", label: "Ingresos por Dividendos (socios y accionistas)", fisica: true, moral: false },
  { code: "612", label: "Personas Físicas con Actividades Empresariales y Profesionales", fisica: true, moral: false },
  { code: "614", label: "Ingresos por intereses", fisica: true, moral: false },
  { code: "615", label: "Régimen de los ingresos por obtención de premios", fisica: true, moral: false },
  { code: "616", label: "Sin obligaciones fiscales", fisica: true, moral: false },
  { code: "620", label: "Sociedades Cooperativas de Producción que optan por diferir sus ingresos", fisica: false, moral: true },
  { code: "621", label: "Incorporación Fiscal", fisica: true, moral: false },
  { code: "622", label: "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras", fisica: false, moral: true },
  { code: "623", label: "Opcional para Grupos de Sociedades", fisica: false, moral: true },
  { code: "624", label: "Coordinados", fisica: false, moral: true },
  { code: "625", label: "Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas", fisica: true, moral: false },
  { code: "626", label: "Régimen Simplificado de Confianza", fisica: true, moral: true },
];

const both = { fisica: true, moral: true };
const fisicaOnly = { fisica: true, moral: false };

export const USO_CFDI = [
  { code: "G01", label: "Adquisición de mercancías", ...both },
  { code: "G02", label: "Devoluciones, descuentos o bonificaciones", ...both },
  { code: "G03", label: "Gastos en general", ...both },
  { code: "I01", label: "Construcciones", ...both },
  { code: "I02", label: "Mobiliario y equipo de oficina por inversiones", ...both },
  { code: "I03", label: "Equipo de transporte", ...both },
  { code: "I04", label: "Equipo de cómputo y accesorios", ...both },
  { code: "I05", label: "Dados, troqueles, moldes, matrices y herramental", ...both },
  { code: "I06", label: "Comunicaciones telefónicas", ...both },
  { code: "I07", label: "Comunicaciones satelitales", ...both },
  { code: "I08", label: "Otra maquinaria y equipo", ...both },
  { code: "D01", label: "Honorarios médicos, dentales y gastos hospitalarios", ...fisicaOnly },
  { code: "D02", label: "Gastos médicos por incapacidad o discapacidad", ...fisicaOnly },
  { code: "D03", label: "Gastos funerales", ...fisicaOnly },
  { code: "D04", label: "Donativos", ...fisicaOnly },
  { code: "D05", label: "Intereses reales pagados por créditos hipotecarios (casa habitación)", ...fisicaOnly },
  { code: "D06", label: "Aportaciones voluntarias al SAR", ...fisicaOnly },
  { code: "D07", label: "Primas por seguros de gastos médicos", ...fisicaOnly },
  { code: "D08", label: "Gastos de transportación escolar obligatoria", ...fisicaOnly },
  { code: "D09", label: "Depósitos en cuentas para el ahorro, primas con base en planes de pensiones", ...fisicaOnly },
  { code: "D10", label: "Pagos por servicios educativos (colegiaturas)", ...fisicaOnly },
  { code: "S01", label: "Sin efectos fiscales", ...both },
  { code: "CP01", label: "Pagos", ...both },
  { code: "CN01", label: "Nómina", ...fisicaOnly },
];

// 3 letters (moral) or 4 letters (fisica) + YYMMDD + 3-char homoclave.
export const RFC_REGEX = /^[A-ZÑ&]{3,4}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[A-Z\d]{3}$/;

// Generic RFCs (público en general / extranjero) are shared by many contacts
// and must never trigger duplicate warnings.
export const GENERIC_RFCS = ["XAXX010101000", "XEXX010101000"];

export function normalizeRfc(value) {
  return String(value ?? "").toUpperCase().replace(/\s+/g, "");
}

export function rfcPersonType(value) {
  const rfc = normalizeRfc(value);
  if (!RFC_REGEX.test(rfc)) return null;
  return rfc.length === 12 ? "moral" : "fisica";
}

export function catalogForPersonType(catalog, personType) {
  if (!personType) return catalog;
  return catalog.filter((entry) => entry[personType]);
}

export function formatCatalogEntry(catalog, code) {
  const entry = catalog.find((item) => item.code === code);
  return entry ? `${entry.code} - ${entry.label}` : code ?? "";
}
