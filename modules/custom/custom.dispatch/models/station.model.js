import { defineModel } from '@runly/module-engine'

export default defineModel({
  key: 'station',
  name: 'dispatch.station',
  label: 'Estación operativa',
  tableName: 'dispatch_station',
  companyScoped: true,
  softDelete: true,
  fields: [
    { name: 'site_id', type: 'relation', label: 'Sitio', required: true, relatedModel: 'dispatch.site' },
    { name: 'code', type: 'text', label: 'Código', required: true, maxLength: 32 },
    { name: 'name', type: 'text', label: 'Nombre', required: true, maxLength: 160 },
    {
      name: 'station_type',
      type: 'select',
      label: 'Tipo',
      required: true,
      options: ['SALES', 'SCALE', 'GATE'],
    },
    { name: 'location_note', type: 'textarea', label: 'Ubicación física' },
  ],
  indexes: [
    { fields: ['company_id', 'site_id', 'code'], unique: true },
    { fields: ['company_id', 'site_id', 'station_type', 'enabled'] },
  ],
  foreignKeys: [
    {
      name: 'dispatch_station_site_fkey',
      field: 'site_id',
      references: { table: 'dispatch_site', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
  ],
})

