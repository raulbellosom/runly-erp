import { ITEM_STATUSES, ITEM_TYPES } from '../lib/inventory-constants.js'

const STATUS_OPTIONS = ITEM_STATUSES.map((s) => ({ value: s.value, label: s.label }))
const ITEM_TYPE_OPTIONS = ITEM_TYPES.map((t) => ({ value: t.value, label: t.label }))

export const INVENTORY_ITEM_FORM = {
  key: 'inventory.item.form',
  kind: 'FORM',
  schema: {
    entity: 'invItem',
    component: 'RunlyForm',
    apiPath: '/inventory/items',
    formMode: 'page',
    // The completion ring renders inside InventoryItemForm.jsx's own PageHeader
    // (via RunlyForm's onCompletionChange callback) instead of RunlyForm's
    // default placement, so it sits next to the title instead of as its own
    // isolated full-width block.
    showCompletion: false,
    preview: {
      titleField: 'name',
      subtitleFields: ['model'],
      rows: [
        { field: 'itemType', label: 'Tipo' },
        { field: 'status', label: 'Estado' },
        { field: 'serialNumber', label: 'Serie' },
      ],
    },
    sections: [
      {
        label: 'Identificación',
        icon: 'IdCard',
        collapsible: true,
        fields: [
          { field: 'name', label: 'Nombre', type: 'text', required: true, hint: 'Laptop Dell XPS 15' },
          { field: 'assetTag', label: 'Etiqueta de activo', type: 'text', hint: 'Dejar vacío para auto-generar' },
          { field: 'itemType', label: 'Tipo', type: 'select', options: ITEM_TYPE_OPTIONS },
          { field: 'serialNumber', label: 'Número de serie', type: 'text' },
          {
            field: 'categoryId',
            label: 'Categoría',
            type: 'relation',
            hint: 'Para crear una categoría nueva, ve primero a Inventario > Catálogos.',
            relation: {
              apiPath: '/inventory/categories',
              labelField: 'name',
              preload: true,
              clearable: true,
            },
          },
          {
            field: 'brandId',
            label: 'Marca',
            type: 'relation',
            hint: 'Para crear una marca nueva, ve primero a Inventario > Catálogos.',
            relation: {
              apiPath: '/inventory/brands',
              labelField: 'name',
              preload: true,
              clearable: true,
            },
          },
          { field: 'model', label: 'Modelo', type: 'text' },
          { field: 'partNumber', label: 'Número de parte', type: 'text' },
        ],
      },
      {
        label: 'Ubicación y estado',
        icon: 'MapPin',
        collapsible: true,
        fields: [
          {
            field: 'locationId',
            label: 'Ubicación',
            type: 'relation',
            hint: 'Para crear una ubicación nueva, ve primero a Inventario > Catálogos.',
            relation: {
              apiPath: '/inventory/locations',
              labelField: 'name',
              preload: true,
              clearable: true,
            },
          },
          { field: 'status', label: 'Estado', type: 'select', required: true, options: STATUS_OPTIONS },
        ],
      },
      {
        label: 'Compra',
        icon: 'Receipt',
        collapsible: true,
        defaultCollapsed: true,
        fields: [
          { field: 'purchaseDate', label: 'Fecha de compra', type: 'date' },
          { field: 'purchasePrice', label: 'Precio de compra', type: 'currency', currency: 'USD', locale: 'es-PE' },
          { field: 'vendorName', label: 'Proveedor', type: 'text' },
          { field: 'invoiceNumber', label: 'Número de factura', type: 'text' },
        ],
      },
      {
        label: 'Garantía',
        icon: 'ShieldCheck',
        collapsible: true,
        defaultCollapsed: true,
        fields: [
          { field: 'warrantyExpiry', label: 'Vencimiento de garantía', type: 'date' },
          { field: 'warrantyNotes', label: 'Notas de garantía', type: 'markdown' },
        ],
      },
      {
        id: 'custom-fields',
        type: 'custom-fields',
        label: 'Campos personalizados',
        icon: 'SlidersHorizontal',
        collapsible: true,
        customFields: {
          apiPath: '/inventory/custom-fields',
          categoryField: 'categoryId',
          valuePrefix: 'customValues',
          manageUrl: '/app/m/runly.inventory/inventory/catalogs?tab=custom-fields',
        },
      },
      {
        label: 'Notas',
        icon: 'StickyNote',
        collapsible: true,
        defaultCollapsed: true,
        fields: [{ field: 'notes', label: 'Notas adicionales', type: 'markdown' }],
      },
      {
        id: 'attachments',
        type: 'attachments',
        label: 'Archivos',
        icon: 'Paperclip',
        collapsible: true,
        attachments: {
          createMode: 'stage-until-parent-create',
          editMode: 'upload-immediately',
          listPath: '/inventory/items/:id/files',
          addPath: '/inventory/items/:id/files',
          removePath: '/inventory/items/:id/files/:docId',
          coverPath: '/inventory/items/:id/files/:docId/cover',
          reorderPath: '/inventory/items/:id/files/reorder',
          upload: { endpoint: '/files/upload', moduleKey: 'runly.inventory', entityType: 'InvItem' },
          signedUrl: { endpointTemplate: '/files/:fileId/signed-url' },
          fields: { fileAssetId: 'fileAssetId' },
          permissions: {
            read: 'inventory.item.read',
            create: 'inventory.item.update',
            remove: 'inventory.item.update',
            fileUpload: 'files.assets.create',
            fileRead: 'files.assets.read',
          },
          limits: { maxFiles: 20, maxSizeMB: 10, allowMultiple: true },
        },
      },
    ],
    submitLabel: 'Guardar activo',
    cancelLabel: 'Cancelar',
  },
}

export default INVENTORY_ITEM_FORM
