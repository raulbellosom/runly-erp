import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { compileModuleCss, scopeUtilities } from '../module-css-service.js'

async function fixture(files) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'runly-css-'))
  for (const [name, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, name)), { recursive: true })
    await fs.writeFile(path.join(dir, name), content)
  }
  return dir
}

// A class no Runly screen uses, so it is not in the app stylesheet.
const RARE = 'size-[123px]'

describe('compileModuleCss', () => {
  it('emits only classes the app lacks, scoped to the module, with the theme and no preflight', async () => {
    const dir = await fixture({
      'Panel.jsx': `export default () => <div className="hidden flex md:flex lg:flex ${RARE} lg:mt-[37px]" />`,
    })
    const css = await compileModuleCss(dir, { scope: 'custom.demo' })
    // The minifier drops the attribute quotes ([data-runly-module=custom\.demo]).
    assert.match(css, /:where\(\[data-runly-module="?custom\\\.demo"?\]\) \.size-\\\[123px\\\]/)
    assert.match(css, /@media \(min-width:64rem\)\{:where\(\[data-runly-module="?custom\\\.demo"?\]\) \.lg\\:mt-\\\[37px\\\]/)
    // Regression (2026-10-03): re-emitting app classes from a later
    // stylesheet broke the shell (`.hidden` beating `lg:flex`).
    for (const appClass of ['hidden', 'flex', 'md\\\\:flex', 'lg\\\\:flex']) {
      assert.doesNotMatch(css, new RegExp(`\\.${appClass}\\{`), `${appClass} must come from the app stylesheet only`)
    }
    // No preflight/base layer (only utilities + Tailwind's @property fallbacks).
    assert.doesNotMatch(css, /@layer base|box-sizing:border-box/)
  })

  it('every emitted utility rule is inside the module scope', async () => {
    const dir = await fixture({ 'A.jsx': `<div className="${RARE} shadow-[0_2px_9px_red] hover:size-[77px]" />` })
    const css = await compileModuleCss(dir, { scope: 'custom.demo' })
    // The @layer properties fallback and @property rules are Tailwind's
    // shared registrations (identical to the app's); the utilities are ours.
    const start = css.indexOf('@layer utilities{') + '@layer utilities{'.length
    const end = css.indexOf('}@property')
    const body = css.slice(start, end === -1 ? undefined : end)
    const rules = body.replace(/@media[^{]+\{/g, '').match(/[^{}]+\{[^{}]*\}/g) ?? []
    assert.ok(rules.length >= 3)
    assert.deepEqual(rules.filter((rule) => !/data-runly-module="?custom\\\.demo/.test(rule)), [])
  })

  it('returns an empty string when there is nothing new to emit', async () => {
    assert.equal(await compileModuleCss(await fixture({ 'README.md': 'nada' }), { scope: 'custom.demo' }), '')
    assert.equal(await compileModuleCss(await fixture({ 'A.jsx': '<div className="hidden flex" />' }), { scope: 'custom.demo' }), '')
  })

  it('rejects unsafe scopes', async () => {
    await assert.rejects(compileModuleCss(os.tmpdir(), { scope: 'x"]{}' }), /Invalid module scope/)
  })
})

describe('scopeUtilities', () => {
  it('wraps only the utilities layer body', () => {
    const out = scopeUtilities('@layer properties;\n@layer utilities {\n  .a { color: red; }\n}\n@property --x { syntax: "*"; }', 'custom.x')
    assert.match(out, /@layer utilities \{\n:where\(\[data-runly-module="custom\.x"\]\) \{\n  \.a \{ color: red; \}\n\}\n\}/)
    assert.match(out, /\}\n@property --x/)
  })
})
