import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { compileModuleCss } from '../module-css-service.js'

async function fixture(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'runly-css-'))
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true })
    await fs.writeFile(path.join(dir, name), content)
  }
  return dir
}

describe('compileModuleCss', () => {
  it('emits utilities the app does not use, with the Runly theme, and no preflight', async () => {
    const dir = await fixture({
      'Panel.jsx': 'export default () => <div className="p-7 lg:col-span-3 size-14 bg-primary dark:bg-card" />',
    })
    const css = await compileModuleCss(dir)
    assert.match(css, /\.p-7\b/)
    assert.match(css, /\.lg\\:col-span-3/)
    assert.match(css, /\.size-14/)
    assert.match(css, /\.bg-primary/)
    assert.match(css, /\.dark\\:bg-card/)
    assert.match(css, /:where\(\.dark/)
    assert.doesNotMatch(css, /::backdrop|\*, ::after/) // no preflight/base layer
  })

  it('returns an empty string when there are no component sources', async () => {
    const dir = await fixture({ 'README.md': 'nada' })
    assert.equal(await compileModuleCss(dir), '')
  })
})
