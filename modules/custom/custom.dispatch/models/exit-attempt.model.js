import { defineModel } from '@runly/module-engine'

export default defineModel({
  key: 'exit_attempt',
  name: 'dispatch.exit_attempt',
  label: 'Intento de salida',
  tableName: 'dispatch_exit_attempt',
  companyScoped: true,
  softDelete: false,
  fields: [
    { name: 'ticket_id', type: 'relation', label: 'Vale', required: true, relatedModel: 'dispatch.ticket' },
    { name: 'gate_station_id', type: 'relation', label: 'Estación de pluma', required: true, relatedModel: 'dispatch.station' },
    { name: 'attempt_number', type: 'number', label: 'Número de intento', required: true },
    {
      name: 'status',
      type: 'select',
      label: 'Estado',
      required: true,
      default: 'PENDING_APPROVAL',
      options: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SUPERSEDED'],
    },
    { name: 'scanned_by', type: 'relation', label: 'Escaneado por', required: true },
    { name: 'scanned_at', type: 'datetime', label: 'Escaneado el', required: true },
    { name: 'scan_idempotency_key', type: 'text', label: 'Llave de idempotencia', required: true, maxLength: 64 },
    { name: 'decided_by', type: 'relation', label: 'Decidido por' },
    { name: 'decided_at', type: 'datetime', label: 'Decidido el' },
    { name: 'rejection_reason', type: 'textarea', label: 'Motivo de rechazo' },
    { name: 'communication_method', type: 'select', label: 'Medio de comunicación', options: ['RADIO', 'PHONE', 'IN_PERSON', 'OTHER'] },
    { name: 'guard_notified_at', type: 'datetime', label: 'Guardia notificado el' },
    { name: 'notes', type: 'textarea', label: 'Notas' },
  ],
  indexes: [
    { fields: ['company_id', 'ticket_id', 'attempt_number'], unique: true },
    { fields: ['company_id', 'scan_idempotency_key'], unique: true },
    { fields: ['company_id', 'status', 'scanned_at'] },
    { fields: ['company_id', 'gate_station_id', 'scanned_at'] },
  ],
  checks: [
    {
      name: 'dispatch_exit_attempt_rejection_reason_required',
      expression: "status <> 'REJECTED' OR rejection_reason IS NOT NULL",
    },
  ],
  foreignKeys: [
    {
      name: 'dispatch_exit_attempt_ticket_fkey',
      field: 'ticket_id',
      references: { table: 'dispatch_ticket', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
    {
      name: 'dispatch_exit_attempt_gate_station_fkey',
      field: 'gate_station_id',
      references: { table: 'dispatch_station', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
  ],
})
