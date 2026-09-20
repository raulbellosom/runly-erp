import { defineModel } from '@runly/module-engine'

export default defineModel({
  key: 'site',
  name: 'dispatch.site',
  label: 'Sitio operativo',
  tableName: 'dispatch_site',
  companyScoped: true,
  softDelete: true,
  fields: [
    { name: 'code', type: 'text', label: 'Código', required: true, maxLength: 32 },
    { name: 'name', type: 'text', label: 'Nombre', required: true, maxLength: 160 },
    {
      name: 'timezone',
      type: 'text',
      label: 'Zona horaria',
      required: true,
      maxLength: 80,
      default: 'America/Mexico_City',
    },
    { name: 'address_text', type: 'textarea', label: 'Dirección o referencia' },
  ],
  indexes: [
    { fields: ['company_id', 'code'], unique: true },
    { fields: ['company_id', 'enabled'] },
  ],
})

