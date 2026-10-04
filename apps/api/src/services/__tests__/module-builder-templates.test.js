import test from 'node:test'
import assert from 'node:assert/strict'
import { compileModule, normalizeModuleDefinition, validateModuleDefinition } from '@runly/module-compiler'
import { BUILDER_TEMPLATE_CATALOG, buildDefinitionFromTemplate } from '../module-builder-templates.js'
import { isModuleIconName } from '@runly/module-engine'

for (const { key, icon } of BUILDER_TEMPLATE_CATALOG) {
  test(`template "${key}" is valid and compiles`, () => {
    assert.ok(isModuleIconName(icon), `catalog icon ${icon}`)
    const definition = buildDefinitionFromTemplate(key, { moduleKey: 'custom.prueba', name: 'Prueba de plantilla' })
    if (key === 'blank') {
      assert.deepEqual(definition.entities, [])
      return
    }
    const normalized = normalizeModuleDefinition(definition)
    const { errors } = validateModuleDefinition(normalized)
    assert.deepEqual(errors, [])
    assert.ok(compileModule(definition).files.some((file) => file.path === 'module.manifest.js'))
  })
}
