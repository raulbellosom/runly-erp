import { defineModel } from '@runly/module-engine'

export default defineModel({
  key: 'station_assignment',
  name: 'dispatch.station_assignment',
  label: 'Asignación de estación',
  tableName: 'dispatch_station_assignment',
  companyScoped: true,
  softDelete: true,
  fields: [
    {
      name: 'station_id',
      type: 'relation',
      label: 'Estación',
      required: true,
      relatedModel: 'dispatch.station',
    },
    { name: 'user_id', type: 'relation', label: 'Usuario', required: true },
    {
      name: 'assignment_type',
      type: 'select',
      label: 'Responsabilidad',
      required: true,
      options: ['OPERATOR', 'SUPERVISOR', 'GUARD'],
    },
    {
      name: 'receives_exit_alerts',
      type: 'boolean',
      label: 'Recibe alertas de salida',
      required: true,
      default: false,
    },
  ],
  indexes: [
    { fields: ['company_id', 'station_id', 'user_id', 'assignment_type'], unique: true },
    { fields: ['company_id', 'station_id', 'receives_exit_alerts', 'enabled'] },
  ],
  foreignKeys: [
    {
      name: 'dispatch_station_assignment_station_fkey',
      field: 'station_id',
      references: { table: 'dispatch_station', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
  ],
})

