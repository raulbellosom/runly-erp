import { defineModel } from '@runly/module-engine'

export default defineModel({
  key: 'ticket_event',
  name: 'dispatch.ticket_event',
  label: 'Evento de vale',
  tableName: 'dispatch_ticket_event',
  companyScoped: true,
  softDelete: false,
  fields: [
    { name: 'ticket_id', type: 'relation', label: 'Vale', required: true, relatedModel: 'dispatch.ticket' },
    { name: 'event_type', type: 'text', label: 'Tipo de evento', required: true, maxLength: 48 },
    { name: 'actor_id', type: 'relation', label: 'Actor' },
    { name: 'station_id', type: 'relation', label: 'Estación', relatedModel: 'dispatch.station' },
    { name: 'attempt_id', type: 'relation', label: 'Intento de salida', relatedModel: 'dispatch.exit_attempt' },
    { name: 'metadata', type: 'json', label: 'Metadatos' },
    { name: 'occurred_at', type: 'datetime', label: 'Ocurrió el', required: true },
  ],
  indexes: [
    { fields: ['company_id', 'ticket_id', 'occurred_at'] },
  ],
  foreignKeys: [
    {
      name: 'dispatch_ticket_event_ticket_fkey',
      field: 'ticket_id',
      references: { table: 'dispatch_ticket', field: 'id' },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    },
    {
      name: 'dispatch_ticket_event_station_fkey',
      field: 'station_id',
      references: { table: 'dispatch_station', field: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
    {
      name: 'dispatch_ticket_event_attempt_fkey',
      field: 'attempt_id',
      references: { table: 'dispatch_exit_attempt', field: 'id' },
      onDelete: 'SET NULL',
      onUpdate: 'CASCADE',
    },
  ],
})
