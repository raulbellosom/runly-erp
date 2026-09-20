import { defineModel } from '@runly/module-engine'

export default defineModel({
  key: 'material_profile',
  name: 'dispatch.material_profile',
  label: 'Material de despacho',
  tableName: 'dispatch_material_profile',
  companyScoped: true,
  softDelete: true,
  fields: [
    { name: 'site_id', type: 'relation', label: 'Sitio', required: true, relatedModel: 'dispatch.site' },
    { name: 'catalog_product_id', type: 'relation', label: 'Producto de catálogo' },
    { name: 'code', type: 'text', label: 'Código', required: true, maxLength: 48 },
    { name: 'name', type: 'text', label: 'Nombre', required: true, maxLength: 160 },
    {
      name: 'allowed_modes',
      type: 'multiselect',
      label: 'Formas de medición',
      required: true,
      options: ['M3', 'TONS'],
    },
    { name: 'density_kg_m3', type: 'decimal', label: 'Densidad informativa kg/m³' },
  ],
  indexes: [
    { fields: ['company_id', 'site_id', 'code'], unique: true },
    { fields: ['company_id', 'site_id', 'enabled'] },
    { fields: ['company_id', 'catalog_product_id'] },
  ],
  checks: [
    {
      name: 'dispatch_material_density_positive',
      expression: 'density_kg_m3 IS NULL OR density_kg_m3 > 0',
    },
  ],
  foreignKeys: [
    {
      name: 'dispatch_material_profile_site_fkey',
      field: 'site_id',
      references: { table: 'dispatch_site', field: 'id' },
      onDelete: 'RESTRICT',
      onUpdate: 'CASCADE',
    },
  ],
})

