import { defineModel } from '@runly/module-engine'

export default defineModel({
  key: 'ticket',
  name: 'dispatch.ticket',
  label: 'Vale de despacho',
  tableName: 'dispatch_ticket',
  companyScoped: true,
  softDelete: false,
  fields: [
    { name: 'site_id', type: 'relation', label: 'Sitio', required: true, relatedModel: 'dispatch.site' },
    { name: 'origin_station_id', type: 'relation', label: 'Estación de origen', required: true, relatedModel: 'dispatch.station' },
    { name: 'voucher_type', type: 'select', label: 'Tipo de vale', required: true, options: ['SCALE', 'VOLUME'] },
    { name: 'folio', type: 'text', label: 'Folio', required: true, maxLength: 32 },
    {
      name: 'status',
      type: 'select',
      label: 'Estado',
      required: true,
      default: 'CREATED',
      options: ['CREATED', 'READY_FOR_EXIT', 'PENDING_APPROVAL', 'CORRECTION_REQUIRED', 'USED', 'CANCELLED', 'EXPIRED'],
    },

    { name: 'sold_to_type', type: 'select', label: 'Vendido a', required: true, options: ['CUSTOMER', 'WALK_IN'] },
    { name: 'customer_contact_id', type: 'relation', label: 'Contacto' },
    { name: 'customer_name', type: 'text', label: 'Cliente', maxLength: 200 },
    { name: 'buyer_email', type: 'email', label: 'Correo del comprador' },
    { name: 'external_voucher_reference', type: 'text', label: 'Referencia de vale externo', maxLength: 80 },
    { name: 'vehicle_plate', type: 'text', label: 'Placa', required: true, maxLength: 20 },
    { name: 'driver_name', type: 'text', label: 'Chofer', maxLength: 160 },

    { name: 'material_profile_id', type: 'relation', label: 'Material', required: true, relatedModel: 'dispatch.material_profile' },
    { name: 'material_code', type: 'text', label: 'Código de material (snapshot)', required: true, maxLength: 48 },
    { name: 'material_name', type: 'text', label: 'Material (snapshot)', required: true, maxLength: 160 },
    { name: 'measurement_mode', type: 'select', label: 'Modo de medición', required: true, options: ['TONS', 'M3'] },
    { name: 'requested_quantity', type: 'decimal', label: 'Cantidad solicitada' },
    { name: 'sold_volume_m3', type: 'decimal', label: 'Volumen vendido (m3)' },

    { name: 'payment_method', type: 'select', label: 'Método de pago', options: ['CASH', 'DEPOSIT', 'OTHER'] },
    { name: 'payment_reference', type: 'text', label: 'Referencia de pago', maxLength: 120 },

    { name: 'qr_version', type: 'number', label: 'Versión de QR', required: true, default: 1 },
    { name: 'qr_token_hash', type: 'text', label: 'Hash del token QR', required: true, maxLength: 64 },

    { name: 'weighing_exception', type: 'boolean', label: 'Excepción de pesaje', required: true, default: false },
    { name: 'weighing_exception_reason', type: 'textarea', label: 'Motivo de la excepción de pesaje' },
    { name: 'weighing_exception_by', type: 'relation', label: 'Excepción autorizada por' },
    { name: 'weighing_exception_at', type: 'datetime', label: 'Excepción autorizada el' },

    { name: 'created_by', type: 'relation', label: 'Creado por', required: true },
    { name: 'used_at', type: 'datetime', label: 'Usado el' },
    { name: 'cancelled_at', type: 'datetime', label: 'Cancelado el' },
    { name: 'cancelled_by', type: 'relation', label: 'Cancelado por' },
    { name: 'cancel_reason', type: 'textarea', label: 'Motivo de cancelación' },
  ],
  indexes: [
    { fields: ['company_id', 'site_id', 'folio'], unique: true },
    { fields: ['company_id', 'qr_token_hash'], unique: true },
    { fields: ['company_id', 'site_id', 'status'] },
    { fields: ['company_id', 'vehicle_plate'] },
  ],
  checks: [
    {
      name: 'dispatch_ticket_volume_requires_m3',
      expression: "voucher_type <> 'VOLUME' OR sold_volume_m3 IS NOT NULL",
    },
    {
      name: 'dispatch_ticket_exception_requires_reason',
      expression: 'weighing_exception = false OR weighing_exception_reason IS NOT NULL',
    },
  ],
  foreignKeys: [
    {
      name: 'dispatch_ticket_site_fkey',
      field: 'site_id',
      references: { table: 'dispatch_site', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
    {
      name: 'dispatch_ticket_origin_station_fkey',
      field: 'origin_station_id',
      references: { table: 'dispatch_station', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
    {
      name: 'dispatch_ticket_material_profile_fkey',
      field: 'material_profile_id',
      references: { table: 'dispatch_material_profile', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
  ],
})
