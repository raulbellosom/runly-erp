import { ACQUISITION_ORIGIN_OPTIONS, ITEM_STATUSES } from '../lib/inventory-constants.js'
import { ADMIN_STATUSES } from '../lib/admin-status.js'

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
      subtitleFields: ['categoryName', 'model'],
      // Disponibilidad next to the title; the administrative Estado is the
      // first, emphasized KPI below.
      statusField: 'status',
      statusOptions: ITEM_STATUSES,
      imageDocsPath: '/inventory/items/:id/files',
      fallbackIcon: 'Package',
      metaChips: [
        { field: 'assetTag', label: 'Etiqueta', icon: 'Hash' },
        { field: 'categoryName', label: 'Tipo', icon: 'Layers' },
        { field: 'brandName', label: 'Marca', icon: 'Tag' },
        { field: 'conditionName', label: 'Condición', icon: 'Activity' },
      ],
    },
    kpis: [
      { label: 'Estado', field: 'adminStatus', type: 'select', options: ADMIN_STATUSES, emphasis: true, icon: 'ClipboardList' },
      { label: 'Asignado a', field: 'assignedToName', icon: 'UserCheck' },
      { label: 'Fecha de asignación', field: 'assignedAt', type: 'date', icon: 'CalendarDays' },
      { label: 'Vencimiento de garantía', field: 'warrantyExpiry', type: 'date', icon: 'ShieldCheck' },
    ],
    sections: [
      {
        label: 'Modelo, tipo y marca',
        icon: 'Boxes',
        column: 'main',
        columns: 3,
        fields: [
          { field: 'model', label: 'Modelo', icon: 'Package' },
          { field: 'categoryName', label: 'Tipo', icon: 'Layers' },
          { field: 'brandName', label: 'Marca', icon: 'Tag' },
        ],
      },
      {
        label: 'Identificación',
        icon: 'IdCard',
        column: 'main',
        columns: 2,
        fields: [
          { field: 'assetTag', label: 'Etiqueta de activo', icon: 'Hash' },
          { field: 'serialNumber', label: 'Número de serie', icon: 'Hash' },
          { field: 'partNumber', label: 'Número de parte', icon: 'Hash' },
        ],
      },
      {
        label: 'Ubicación y origen',
        icon: 'MapPin',
        column: 'main',
        columns: 2,
        fields: [
          { field: 'locationName', label: 'Ubicación', icon: 'MapPin' },
          { field: 'conditionName', label: 'Condición', icon: 'Activity' },
          { field: 'acquisitionOrigin', label: 'Origen de adquisición', type: 'select', options: ACQUISITION_ORIGIN_OPTIONS, icon: 'Receipt' },
        ],
      },
      {
        // Main column: purchase documents read better wide, and keeping them
        // out of the aside balances both column heights.
        id: 'purchases',
        type: 'component',
        label: 'Compras relacionadas',
        icon: 'ShoppingCart',
        column: 'main',
        component: 'runly.purchases:InventoryPurchaseSection',
      },
      {
        // Read-only pre-Compras purchase data; hidden when the item has none
        // (the API computes hasLegacyPurchaseData).
        id: 'legacy-purchase',
        label: 'Datos de compra heredados',
        icon: 'History',
        column: 'main',
        columns: 2,
        visibleWhen: { field: 'hasLegacyPurchaseData', truthy: true },
        fields: [
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
        id: 'admin-status',
        type: 'component',
        label: 'Estado del activo',
        icon: 'ClipboardList',
        column: 'aside',
        component: 'runly.inventory:AdminSection',
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
        id: 'history',
        type: 'component',
        label: 'Actividad',
        icon: 'History',
        column: 'aside',
        component: 'runly.inventory:HistorySection',
      },
      {
        id: 'comments',
        type: 'component',
        label: 'Comentarios',
        icon: 'MessageSquare',
        column: 'aside',
        component: 'runly.inventory:CommentsSection',
      },
    ],
  },
}

export default INVENTORY_ITEM_DETAIL
