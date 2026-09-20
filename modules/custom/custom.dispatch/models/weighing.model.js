import { defineModel } from '@runly/module-engine'

export default defineModel({
  key: 'weighing',
  name: 'dispatch.weighing',
  label: 'Pesaje',
  tableName: 'dispatch_weighing',
  companyScoped: true,
  softDelete: false,
  fields: [
    { name: 'ticket_id', type: 'relation', label: 'Vale', required: true, relatedModel: 'dispatch.ticket' },
    { name: 'station_id', type: 'relation', label: 'Estación de báscula', required: true, relatedModel: 'dispatch.station' },
    {
      name: 'reading_type',
      type: 'select',
      label: 'Tipo de lectura',
      required: true,
      options: ['TARE', 'GROSS', 'AUXILIARY_EXIT_GROSS'],
    },
    { name: 'weight_kg', type: 'decimal', label: 'Peso (kg)', required: true },
    { name: 'source', type: 'select', label: 'Origen', required: true, default: 'MANUAL', options: ['MANUAL', 'DEVICE'] },
    { name: 'captured_by', type: 'relation', label: 'Capturado por', required: true },
    { name: 'captured_at', type: 'datetime', label: 'Capturado el', required: true },
    { name: 'supersedes_id', type: 'relation', label: 'Corrige a', relatedModel: 'dispatch.weighing' },
    { name: 'correction_reason', type: 'textarea', label: 'Motivo de corrección' },
    { name: 'device_reference', type: 'text', label: 'Referencia de dispositivo', maxLength: 120 },
  ],
  indexes: [
    { fields: ['company_id', 'ticket_id', 'reading_type', 'captured_at'] },
    { fields: ['company_id', 'station_id', 'captured_at'] },
  ],
  checks: [
    { name: 'dispatch_weighing_weight_positive', expression: 'weight_kg > 0' },
    {
      name: 'dispatch_weighing_correction_reason_required',
      expression: 'supersedes_id IS NULL OR correction_reason IS NOT NULL',
    },
  ],
  foreignKeys: [
    {
      name: 'dispatch_weighing_ticket_fkey',
      field: 'ticket_id',
      references: { table: 'dispatch_ticket', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
    {
      name: 'dispatch_weighing_station_fkey',
      field: 'station_id',
      references: { table: 'dispatch_station', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
    {
      name: 'dispatch_weighing_supersedes_fkey',
      field: 'supersedes_id',
      references: { table: 'dispatch_weighing', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
  ],
})
