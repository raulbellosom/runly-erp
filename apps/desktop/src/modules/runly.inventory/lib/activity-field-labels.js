import { ITEM_STATUSES, ITEM_TYPES } from './inventory-constants.js'

const STATUS_OPTIONS = ITEM_STATUSES.map((s) => ({ value: s.value, label: s.label }))
const ITEM_TYPE_OPTIONS = ITEM_TYPES.map((t) => ({ value: t.value, label: t.label }))

// Maps the flat field keys inventory-service.js's updateItem() puts in its
// before/after audit snapshots (see toFlatSnapshot there) to a display label
// and value type, so ActivityTimeline's expandable diff rows read like the
// rest of the UI instead of raw field keys/values. Kept as its own small,
// deliberately-curated map rather than derived from the FORM/DETAIL
// blueprints automatically: those blueprints use categoryId/brandId/
// locationId (relation fields), while the audit snapshot uses the resolved
// categoryName/brandName/locationName — the key names don't line up, so a
// generic extraction would need as much code as this map does directly.
export const INVENTORY_ACTIVITY_FIELD_LABELS = {
  name: { label: 'Nombre', type: 'text' },
  assetTag: { label: 'Etiqueta de activo', type: 'text' },
  itemType: { label: 'Tipo', type: 'select', options: ITEM_TYPE_OPTIONS },
  categoryName: { label: 'Categoría', type: 'text' },
  brandName: { label: 'Marca', type: 'text' },
  locationName: { label: 'Ubicación', type: 'text' },
  model: { label: 'Modelo', type: 'text' },
  serialNumber: { label: 'Número de serie', type: 'text' },
  partNumber: { label: 'Número de parte', type: 'text' },
  status: { label: 'Estado', type: 'select', options: STATUS_OPTIONS },
  purchaseDate: { label: 'Fecha de compra', type: 'date' },
  purchasePrice: { label: 'Precio de compra', type: 'currency' },
  vendorName: { label: 'Proveedor', type: 'text' },
  invoiceNumber: { label: 'Número de factura', type: 'text' },
  warrantyExpiry: { label: 'Vencimiento de garantía', type: 'date' },
  warrantyNotes: { label: 'Notas de garantía', type: 'markdown' },
  notes: { label: 'Notas', type: 'markdown' },
}
