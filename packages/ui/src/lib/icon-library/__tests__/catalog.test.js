import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isKnownIcon, allIconNames } from '../registry.js'
import { CURATED_ICONS, ICON_CATEGORIES, searchCurated } from '../catalog.js'

describe('Shared lucide icon library', () => {
  it('only references icons that exist in the installed lucide-react', () => {
    const missing = ICON_CATEGORIES.flatMap((category) => category.items).filter((item) => !isKnownIcon(item.name))
    assert.deepEqual(missing.map((item) => item.name), [])
    assert.deepEqual(ICON_CATEGORIES.filter((category) => !isKnownIcon(category.icon)).map((category) => category.label), [])
    assert.ok(CURATED_ICONS.length >= 200)
    assert.ok(allIconNames().length > 1500)
  })

  it('searches Spanish labels and keywords ignoring accents', () => {
    assert.ok(searchCurated('extintor').some((item) => item.name === 'fire-extinguisher'))
    assert.ok(searchCurated('cámara').some((item) => item.name === 'cctv'))
    assert.ok(searchCurated('', 'Vehiculos y transporte').some((item) => item.name === 'truck'))
    assert.ok(searchCurated('idea').some((item) => item.name === 'lightbulb'))
  })
})
