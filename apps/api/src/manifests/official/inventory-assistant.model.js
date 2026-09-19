import { defineModel } from '@runly/module-engine';

export const inventoryReusableCatalog = defineModel({
  key: 'inventory_reusable_catalog', tableName: 'inventory_reusable_catalog',
  label: 'Modelos y tipos de inventario', companyScoped: true, serverOnly: true,
  fields: [
    { name: 'kind', type: 'text', maxLength: 20, required: true },
    { name: 'name', type: 'text', required: true },
    { name: 'name_key', type: 'text', required: true },
    { name: 'scope_key', type: 'text', required: true, default: '' },
    { name: 'details', type: 'json', required: true, default: '{}' },
  ],
  indexes: [{ fields: ['company_id', 'kind', 'name_key', 'scope_key'], unique: true }],
});

export const inventoryAssistantThread = defineModel({
  key: 'inventory_assistant_thread', tableName: 'inventory_assistant_thread',
  label: 'Conversación de inventario', companyScoped: true, serverOnly: true,
  fields: [
    { name: 'owner_id', type: 'relation', required: true },
    { name: 'title', type: 'text', required: true },
    { name: 'context', type: 'json', required: true },
    { name: 'messages', type: 'json', required: true, default: '[]' },
    { name: 'memory', type: 'json', required: true, default: '{}' },
    { name: 'version', type: 'number', required: true, default: 0 },
  ],
  indexes: [{ fields: ['company_id', 'owner_id', 'updated_at'] }],
});
