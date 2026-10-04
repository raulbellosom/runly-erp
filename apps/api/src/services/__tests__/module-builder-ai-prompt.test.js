import test from 'node:test'
import assert from 'node:assert/strict'
import { buildExternalAiPrompt } from '../module-builder-ai-prompt.js'
import { buildDefinitionFromTemplate } from '../module-builder-templates.js'

test('external AI prompt describes the module, reading list, rules and deliverable', () => {
  const definition = buildDefinitionFromTemplate('prestamo-herramientas', { moduleKey: 'custom.prestamosh', name: 'Préstamos' })
  const prompt = buildExternalAiPrompt(definition)
  assert.match(prompt, /clave `custom\.prestamosh`, versión 0\.1\.0/)
  assert.match(prompt, /`herramienta` \(relation\) · Herramienta · obligatorio · → Inventario · Artículo de inventario/)
  assert.match(prompt, /Conexión "Préstamos": registros relacionados en Inventario/)
  assert.match(prompt, /docs\/componentes\.md/)
  assert.match(prompt, /versión en `module\.manifest\.js` a 0\.2\.0/)
  assert.match(prompt, /<<Describe aquí el cambio/)
})
