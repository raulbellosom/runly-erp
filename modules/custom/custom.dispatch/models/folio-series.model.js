import { defineModel } from '@runly/module-engine'

export default defineModel({
  key: 'folio_series',
  name: 'dispatch.folio_series',
  label: 'Serie de folios',
  tableName: 'dispatch_folio_series',
  companyScoped: true,
  softDelete: true,
  fields: [
    { name: 'site_id', type: 'relation', label: 'Sitio', required: true, relatedModel: 'dispatch.site' },
    {
      name: 'voucher_type',
      type: 'select',
      label: 'Tipo de vale',
      required: true,
      options: ['SCALE', 'VOLUME'],
    },
    { name: 'prefix', type: 'text', label: 'Prefijo', required: true, maxLength: 12 },
    { name: 'next_number', type: 'number', label: 'Siguiente número', required: true, default: 1 },
    { name: 'padding', type: 'number', label: 'Dígitos', required: true, default: 6 },
  ],
  indexes: [
    { fields: ['company_id', 'site_id', 'voucher_type'], unique: true },
    { fields: ['company_id', 'site_id', 'prefix'], unique: true },
    { fields: ['company_id', 'enabled'] },
  ],
  checks: [
    {
      name: 'dispatch_folio_series_numbers_valid',
      expression: 'next_number > 0 AND padding BETWEEN 1 AND 12',
    },
  ],
  foreignKeys: [
    {
      name: 'dispatch_folio_series_site_fkey',
      field: 'site_id',
      references: { table: 'dispatch_site', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
  ],
})

