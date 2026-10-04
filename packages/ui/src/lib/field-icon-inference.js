// Infers a representative lucide icon for a form/detail field from its
// name and label (English keys, Spanish labels), so every input in the app
// shows what it holds without each screen choosing one. Shared by the
// blueprint renderer (field-icons.js) and the base field components
// (TextField, Combobox, ...), which use it when no `icon` prop is passed.
import * as Lucide from "lucide-react";

// Ordered most-specific first. Matched against space-separated lowercase
// tokens without accents (name "jobTitleId" -> "job title", label
// "Teléfono de emergencia" -> "telefono de emergencia").
const NAME_RULES = [
  [/\b(e ?mail|correo)\b/, Lucide.Mail],
  [/\b(phone|telefono|celular|mobile|movil|whatsapp|tel)\b/, Lucide.Phone],
  [/\b(password|contrasena|pin)\b/, Lucide.KeyRound],
  [/\b(website|web|sitio|url|link|enlace)\b/, Lucide.Globe],
  [/\b(rfc|curp|nss|tax id|taxid|imss|ine|passport|pasaporte|license|licencia)\b/, Lucide.IdCard],
  [/\b(sku|barcode|codigo de barras|upc|ean)\b/, Lucide.ScanBarcode],
  [/\b(code|codigo|folio|clave|reference|referencia|serial|serie|number|numero|plate|placa|placas|vin)\b/, Lucide.Hash],
  [/\b(job title|puesto|position|cargo|occupation|ocupacion)\b/, Lucide.BriefcaseBusiness],
  [/\b(department|departamento|area|team|equipo)\b/, Lucide.Network],
  [/\b(emergency|emergencia)\b/, Lucide.LifeBuoy],
  [/\b(birth|birthday|nacimiento|cumpleanos)\b/, Lucide.Cake],
  [/\b(gender|genero|sexo)\b/, Lucide.Users],
  [/\b(first name|last name|full name|middle name|apellido|apellidos|nombre completo|nombres)\b/, Lucide.UserRound],
  [/\b(user|usuario|user profile|supervisor|manager|jefe|owner|responsable|assignee|assigned|asignado|employee|colaborador|empleado|seller|vendedor|driver|conductor|chofer)\b/, Lucide.UserRound],
  [/\b(customer|cliente|contact|contacto|lead|prospecto)\b/, Lucide.Contact],
  [/\b(company|empresa|razon social|business|negocio|organization|organizacion)\b/, Lucide.Building2],
  [/\b(supplier|proveedor|vendor)\b/, Lucide.Truck],
  [/\b(status|estatus|estado|stage|etapa|fase)\b/, Lucide.CircleDot],
  [/\b(country|pais)\b/, Lucide.Globe],
  [/\b(state|province|provincia|city|ciudad|municipality|municipio|colonia|neighborhood)\b/, Lucide.MapPinned],
  [/\b(zip|postal|cp)\b/, Lucide.Mailbox],
  [/\b(address|direccion|domicilio|street|calle|location|ubicacion|lugar|place|site|sede|sucursal|branch)\b/, Lucide.MapPin],
  [/\b(warehouse|almacen|bodega)\b/, Lucide.Warehouse],
  [/\b(vehicle|vehiculo|car|auto)\b/, Lucide.Car],
  [/\b(contract|contrato)\b/, Lucide.FileSignature],
  [/\b(bank|banco|clabe|account|cuenta)\b/, Lucide.Landmark],
  [/\b(payment|pago|method|metodo|card|tarjeta)\b/, Lucide.CreditCard],
  [/\b(invoice|factura|receipt|recibo|ticket)\b/, Lucide.Receipt],
  [/\b(percent|percentage|porcentaje|discount|descuento|rate|tasa|iva|margin|margen)\b/, Lucide.Percent],
  [/\b(currency|moneda|divisa)\b/, Lucide.Coins],
  [/\b(price|precio|cost|costo|amount|monto|importe|total|subtotal|salary|salario|sueldo|budget|presupuesto|balance|saldo|value|valor)\b/, Lucide.DollarSign],
  [/\b(quantity|cantidad|qty|stock|existencia|existencias|units|unidades)\b/, Lucide.Boxes],
  [/\b(unit|unidad|uom|size|tamano|dimension|dimensions|dimensiones|length|largo|width|ancho|height|alto)\b/, Lucide.Ruler],
  [/\b(weight|peso)\b/, Lucide.Weight],
  [/\b(date|fecha|day|dia|at|deadline|vencimiento|due)\b/, Lucide.CalendarDays],
  [/\b(time|hora|duration|duracion|shift|turno|timezone|horario|schedule)\b/, Lucide.Clock],
  [/\b(brand|marca)\b/, Lucide.Award],
  [/\b(model|modelo|product|producto|item|articulo)\b/, Lucide.Package],
  [/\b(project|proyecto)\b/, Lucide.FolderKanban],
  [/\b(priority|prioridad)\b/, Lucide.Flag],
  [/\b(source|fuente|origin|origen|channel|canal|medio)\b/, Lucide.Share2],
  [/\b(language|idioma|lenguaje)\b/, Lucide.Languages],
  [/\b(color|colour)\b/, Lucide.Palette],
  [/\b(image|imagen|photo|foto|logo|avatar|picture|cover|portada)\b/, Lucide.Image],
  [/\b(file|archivo|document|documento|attachment|adjunto)\b/, Lucide.FileText],
  [/\b(tags|etiquetas)\b/, Lucide.Tags],
  [/\b(category|categoria|type|tipo|kind|class|clase|clasificacion|group|grupo|segment|segmento)\b/, Lucide.Tag],
  [/\b(notes|notas|note|nota|description|descripcion|comment|comentario|comentarios|observaciones|observacion|details|detalles|summary|resumen|bio)\b/, Lucide.AlignLeft],
  [/\b(name|nombre|title|titulo|label|etiqueta|alias)\b/, Lucide.Type],
];

function toTokens(text) {
  if (typeof text !== "string" || !text.trim()) return "";
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(id|ids)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchRules(text) {
  if (!text) return null;
  for (const [pattern, icon] of NAME_RULES) {
    if (pattern.test(text)) return icon;
  }
  return null;
}

export function inferFieldIcon(field) {
  const name = field?.name ?? field?.key ?? field?.field;
  return matchRules(toTokens(name)) ?? matchRules(toTokens(field?.label));
}

// For base field components: an explicit `icon` (including `null`, the
// opt-out) wins; otherwise infer from name/label only for labeled fields —
// unlabeled inputs are inline/compact controls (table cells, toolbars).
export function autoFieldIcon(icon, { label, name, id } = {}, fallback = null) {
  if (icon !== undefined) return icon;
  if (typeof label !== "string" || !label.trim()) return null;
  return inferFieldIcon({ name: name ?? id, label }) ?? fallback;
}
