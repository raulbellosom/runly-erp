import { ITEM_STATUSES, ACQUISITION_ORIGIN_OPTIONS } from '../lib/inventory-constants.js'

export const LEGACY_PURCHASE_SECTION_ID = 'legacy-purchase'

const STATUS_OPTIONS = ITEM_STATUSES.map((s) => ({ value: s.value, label: s.label }))
// On create an item can only start available or in maintenance.
const CREATE_STATUS_OPTIONS = STATUS_OPTIONS.filter((s) => s.value !== 'assigned')
const ADMIN_START_OPTIONS = [
  { value: 'registered', label: 'Alta' },
  { value: 'registration_pending', label: 'Pendiente de alta' },
]

export const INVENTORY_ITEM_FORM = {
  key: 'inventory.item.form',
  kind: 'FORM',
  schema: {
    entity: 'invItem',
    component: 'RunlyForm',
    apiPath: '/inventory/items',
    formMode: 'page',
    // Renders inside RunlyForm's own consolidated sidebar, above the Ver/Eliminar
    // buttons InventoryItemForm.jsx passes via `asideActions` and the preview
    // panel below — see RunlyForm.jsx's aside column.
    showCompletion: true,
    preview: {
      titleField: 'name',
      subtitleFields: ['model'],
      imageDocsPath: '/inventory/items/:id/files',
      fallbackIcon: 'Package',
      rows: [
        { field: 'status', label: 'Disponibilidad' },
        { field: 'serialNumber', label: 'Serie' },
      ],
    },
    sections: [
      {
        // Model picker that fills Tipo and Marca — InventoryItemClassification.jsx,
        // resolved through the componentRegistry the inventory screens pass.
        id: 'classification',
        type: 'component',
        component: 'inventory.item-classification',
        label: 'Modelo, tipo y marca',
        icon: 'Boxes',
        collapsible: true,
        fields: [
          { field: 'modelId', label: 'Modelo', type: 'relation' },
          { field: 'model', label: 'Nombre del modelo', type: 'text' },
          { field: 'categoryId', label: 'Tipo', type: 'relation' },
          { field: 'brandId', label: 'Marca', type: 'relation' },
        ],
      },
      {
        label: 'Identificación',
        icon: 'IdCard',
        collapsible: true,
        fields: [
          { field: 'name', label: 'Nombre', type: 'text', hint: 'Opcional. Si lo dejas vacío se genera con la marca y el modelo (p. ej. «Dell XPS 15»).' },
          { field: 'assetTag', label: 'Etiqueta de activo', type: 'text', hint: 'Dejar vacío para auto-generar', hiddenWhen: { field: '__multi', truthy: true } },
          { field: 'serialNumber', label: 'Número de serie', type: 'text', hiddenWhen: { field: '__multi', truthy: true } },
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
            relation: {
              apiPath: '/inventory/locations',
              labelField: 'name',
              preload: true,
              clearable: true,
              create: {
                enabled: true,
                mode: 'quick',
                apiPath: '/inventory/locations',
                label: 'Crear ubicación',
                permissionKey: 'inventory.catalog.manage',
              },
            },
          },
          { field: 'status', label: 'Disponibilidad', type: 'select', required: true, options: STATUS_OPTIONS },
          {
            field: 'conditionId',
            label: 'Condición',
            type: 'relation',
            relation: {
              apiPath: '/inventory/conditions',
              labelField: 'name',
              preload: true,
              clearable: true,
              create: {
                enabled: true,
                mode: 'quick',
                apiPath: '/inventory/conditions',
                label: 'Crear condición',
                permissionKey: 'inventory.catalog.manage',
              },
            },
          },
          // Create only (removed by buildItemFormBlueprint on edit): later
          // changes go through the alta/baja actions in the item detail.
          { field: 'adminStatus', label: 'Estado inicial', type: 'select', options: ADMIN_START_OPTIONS, hint: 'Pendiente de alta: el activo no se puede asignar hasta que alguien con permiso confirme su alta.' },
        ],
      },
      {
        label: 'Origen de adquisición',
        icon: 'Receipt',
        collapsible: true,
        defaultCollapsed: true,
        fields: [
          {
            field: 'acquisitionOrigin',
            label: 'Origen',
            type: 'select',
            options: ACQUISITION_ORIGIN_OPTIONS,
            hint: 'Las órdenes, facturas y montos de compra se registran en Compras y se relacionan desde la ficha del activo.',
          },
        ],
      },
      {
        // Kept only by buildItemFormBlueprint when the item already carries
        // pre-Compras purchase data, so it can still be corrected.
        id: LEGACY_PURCHASE_SECTION_ID,
        label: 'Datos de compra heredados',
        icon: 'History',
        collapsible: true,
        defaultCollapsed: true,
        description: 'Datos capturados antes de Compras. Los nuevos datos comerciales se administran desde Compras.',
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

// Edit drops the create-only "Estado inicial" field and keeps "Asignado"
// in the status options so an assigned item still shows its status.
// Legacy purchase fields only appear when `showLegacyPurchase` (edit of an
// item that already has them).
// connectionsComponent: registry key of the connected-modules section (only
// added when the company has active connections with form fields).
export function buildItemFormBlueprint(isEdit, { showLegacyPurchase = false, connectionsComponent = null } = {}) {
  const sections = INVENTORY_ITEM_FORM.schema.sections
    .filter((section) => showLegacyPurchase || section.id !== LEGACY_PURCHASE_SECTION_ID)
    .map((section) => {
      if (!section.fields) return section
      const fields = section.fields
        .filter((f) => !(isEdit && f.field === 'adminStatus'))
        .map((f) => (f.field === 'status' && !isEdit ? { ...f, options: CREATE_STATUS_OPTIONS } : f))
      return { ...section, fields }
    })
  if (connectionsComponent) {
    sections.push({ id: 'connections', type: 'component', component: connectionsComponent, label: 'Módulos conectados', icon: 'Plug', collapsible: true, fields: [] })
  }
  return { ...INVENTORY_ITEM_FORM, schema: { ...INVENTORY_ITEM_FORM.schema, sections } }
}

export default INVENTORY_ITEM_FORM
