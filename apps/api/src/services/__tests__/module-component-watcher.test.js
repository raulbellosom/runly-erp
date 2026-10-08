import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createModuleComponentWatcher } from '../module-component-watcher.js'

test('installed component edits are watched; transient upload trees are excluded and cleanup is safe', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'runly-watcher-')), changes = [], errors = []
  const component = path.join(root, 'custom.fixture', 'components')
  await mkdir(component, { recursive: true }); await writeFile(path.join(component, 'index.js'), 'first')
  const watcher = createModuleComponentWatcher({ root, onChange: key => changes.push(key), onError: error => errors.push(error) })
  try {
    await watcher.start()
    for (let i = 0; i < 30; i++) {
      const temporary = path.join(root, '.staging', String(i), 'package', 'components')
      await mkdir(temporary, { recursive: true }); await writeFile(path.join(temporary, 'index.js'), 'temporary')
      await rm(path.join(root, '.staging', String(i)), { recursive: true })
    }
    await writeFile(path.join(component, 'index.js'), 'second')
    for (let i = 0; i < 30 && !changes.length; i++) await delay(10)
    assert.ok(changes.length); assert.ok(changes.every(key => key === 'custom.fixture')); assert.deepEqual(errors, [])
    watcher.close(); const count = changes.length; await writeFile(path.join(component, 'index.js'), 'closed'); await delay(30)
    assert.equal(changes.length, count)
  } finally { watcher.close(); await rm(root, { recursive: true, force: true }) }
})
