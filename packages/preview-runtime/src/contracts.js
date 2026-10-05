export const PREVIEW_RUNTIME_CONTRACT = Object.freeze({
  schemaVersion: 3,
  implementation: 'rme3-preview-contract3',
  scope: 'trusted-declarative-and-isolated-custom',
  transportContract: 'fetch-response-v1',
  views: Object.freeze(['TABLE', 'FORM', 'DETAIL', 'PAGE', 'DASHBOARD', 'KANBAN']),
  adapters: Object.freeze(['transport.fetch', 'preferences', 'resources']),
  // CUSTOM bundles are loaded through custom-bundles.js only by a host that
  // provides its own isolation; the declarative renderer never executes them.
  customExecution: 'isolated-host-required',
  custom: Object.freeze({ kind: 'CUSTOM', bundleContract: 1, registry: 'per-session', loader: 'digest-cache', sdk: 'injected-transport', boundary: 'per-view' }),
  backendExecution: false,
  simulation: Object.freeze({ relations: 'declarative', connections: 'fields-related', services: 'official-simulator', events: 'deterministic', automations: 'pure-declarative' }),
  unsupported: Object.freeze(['audit', 'attachments', 'files', 'backend-handlers', 'SQL-transactions']),
});
export function unsupported(capability) {
  return Object.assign(new Error(`Capacidad no soportada: ${capability}`), { code: 'PREVIEW_UNSUPPORTED', capability });
}

// Advanced sections still contain ERP-specific I/O. Refuse them before mounting.
export function diagnoseBlueprints(blueprints) {
  const diagnostics = [];
  const advanced = new Set(['attachments', 'audit', 'audit-trail', 'parts', 'costs', 'custom-fields', 'component', 'relation-card', 'relation-list']);
  const inspect = (value, path) => {
    if (!value || typeof value !== 'object') return;
    if (advanced.has(value.type) || ['file', 'file-asset', 'image-asset'].includes(value.type)) diagnostics.push({ code: 'PREVIEW_UNSUPPORTED', path, capability: value.type });
    for (const [key, child] of Object.entries(value)) {
      if (['component', 'imageDocsPath', 'signedUrlPath', 'filesPath', 'imageField', 'cardMedia', 'avatarField', 'createPath', 'endpoint', 'hrefTemplate'].includes(key) && child) diagnostics.push({ code: 'PREVIEW_UNSUPPORTED', path: `${path}.${key}`, capability: key });
      inspect(child, `${path}.${key}`);
    }
  };
  for (const row of blueprints) {
    const kind = String(row.kind ?? row.type).toUpperCase();
    if (!PREVIEW_RUNTIME_CONTRACT.views.includes(kind)) diagnostics.push({ code: 'PREVIEW_UNSUPPORTED', path: row.key, capability: kind });
    // Built-in component names are descriptions, never executable registry keys.
    const schema = { ...row.schema };
    if (['RunlyTable', 'RunlyForm', 'RunlyDetail', 'AtlasTable', 'AtlasForm', 'AtlasDetail'].includes(schema.component)) delete schema.component;
    inspect(schema, row.key);
    inspect(row.fields, `${row.key}.fields`);
  }
  return diagnostics;
}
