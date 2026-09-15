import { ITEM_TYPES } from '../lib/inventory-constants.js'

const ITEM_TYPE_OPTIONS = ITEM_TYPES.map((t) => ({ value: t.value, label: t.label }))

export const INVENTORY_ITEM_DETAIL = {
  key: 'inventory.item.detail',
  kind: 'DETAIL',
  schema: {
    entity: 'invItem',
    component: 'RunlyDetail',
    apiPath: '/inventory/items',
    layout: 'two-column',
    hero: {
      titleField: 'name',
      subtitleFields: ['itemType', 'model'],
      statusField: 'status',
      fallbackIcon: 'Package',
      metaChips: [
        { field: 'assetTag', label: 'Etiqueta', icon: 'Hash' },
        { field: 'categoryName', label: 'Categoría', icon: 'Layers' },
        { field: 'brandName', label: 'Marca', icon: 'Tag' },
      ],
    },
    kpis: [
      { label: 'Asignado a', field: 'assignedToName', icon: 'UserCheck' },
      { label: 'Fecha de asignación', field: 'assignedAt', type: 'date', icon: 'CalendarDays' },
      { label: 'Vencimiento de garantía', field: 'warrantyExpiry', type: 'date', icon: 'ShieldCheck' },
      { label: 'Valor de compra', field: 'purchasePrice', type: 'currency', icon: 'Tag' },
    ],
    sections: [
      {
        label: 'Identificación',
        icon: 'IdCard',
        column: 'main',
        columns: 2,
        fields: [
          { field: 'assetTag', label: 'Etiqueta de activo', icon: 'Hash' },
          { field: 'itemType', label: 'Tipo', icon: 'Layers', type: 'select', options: ITEM_TYPE_OPTIONS },
          { field: 'categoryName', label: 'Categoría', icon: 'Layers' },
          { field: 'brandName', label: 'Marca', icon: 'Tag' },
          { field: 'model', label: 'Modelo', icon: 'Package' },
          { field: 'serialNumber', label: 'Número de serie', icon: 'Hash' },
          { field: 'partNumber', label: 'Número de parte', icon: 'Hash' },
        ],
      },
      {
        label: 'Ubicación y compra',
        icon: 'MapPin',
        column: 'main',
        columns: 2,
        fields: [
          { field: 'locationName', label: 'Ubicación', icon: 'MapPin' },
          { field: 'purchaseDate', label: 'Fecha de compra', type: 'date', icon: 'CalendarDays' },
          { field: 'purchasePrice', label: 'Precio de compra', type: 'currency', icon: 'Tag' },
          { field: 'vendorName', label: 'Proveedor', icon: 'Building2' },
          { field: 'invoiceNumber', label: 'Número de factura', icon: 'Hash' },
        ],
      },
      {
        label: 'Garantía',
        icon: 'ShieldCheck',
        column: 'main',
        columns: 2,
        fields: [
          { field: 'warrantyExpiry', label: 'Vencimiento de garantía', type: 'date', icon: 'CalendarDays' },
          { field: 'warrantyNotes', label: 'Notas de garantía', type: 'markdown', icon: 'FileText' },
        ],
      },
      {
        label: 'Notas',
        icon: 'StickyNote',
        column: 'main',
        fields: [{ field: 'notes', label: 'Notas', type: 'markdown', icon: 'FileText' }],
      },
      {
        id: 'attachments',
        type: 'attachments',
        label: 'Archivos',
        icon: 'Paperclip',
        column: 'aside',
        attachments: {
          listPath: '/inventory/items/:id/files',
          addPath: '/inventory/items/:id/files',
          removePath: '/inventory/items/:id/files/:docId',
          coverPath: '/inventory/items/:id/files/:docId/cover',
          reorderPath: '/inventory/items/:id/files/reorder',
          upload: { endpoint: '/files/upload', moduleKey: 'runly.inventory', entityType: 'InvItem' },
          signedUrl: { endpointTemplate: '/files/:fileId/signed-url' },
          fields: { fileAssetId: 'fileAssetId' },
        },
      },
      {
        id: 'assignment',
        type: 'component',
        label: 'Asignación',
        icon: 'UserCheck',
        column: 'aside',
        component: 'runly.inventory:AssignmentSection',
      },
      {
        id: 'comments',
        type: 'component',
        label: 'Comentarios',
        icon: 'MessageSquare',
        column: 'aside',
        component: 'runly.inventory:CommentsSection',
      },
      {
        id: 'history',
        type: 'component',
        label: 'Historial de auditoría',
        icon: 'History',
        column: 'aside',
        component: 'runly.inventory:HistorySection',
      },
    ],
  },
}

export default INVENTORY_ITEM_DETAIL
