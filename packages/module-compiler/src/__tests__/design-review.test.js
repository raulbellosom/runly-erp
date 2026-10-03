import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { reviewComponentSources } from '../design-review.js'

describe('reviewComponentSources', () => {
  it('reports native controls, window dialogs, missing PageHeader, fixed colors and emojis with lines', () => {
    const findings = reviewComponentSources([
      { path: 'components/Panel.jsx', content: [
        'export default function Panel() {',
        '  if (window.confirm("¿Seguro?")) return null',
        '  return <div className="bg-white">',
        '    <select><option>A</option></select>',
        '    <p>Listo ✅</p>',
        '  </div>',
        '}',
      ].join('\n') },
      { path: 'components/index.js', content: 'export async function register() {}' },
    ])
    const rules = findings.map((f) => `${f.rule}@${f.line}`)
    assert.deepEqual(rules.sort(), ['emoji@5', 'fixed-color@3', 'native-select@4', 'no-page-header@1', 'window-dialog@2'].sort())
    assert.ok(findings.every((f) => f.file === 'components/Panel.jsx' && f.message && f.severity))
  })

  it('accepts a screen that follows the rules', () => {
    const findings = reviewComponentSources([{ path: 'components/Ok.jsx', content: [
      "import { PageHeader, SelectField } from '@runly/ui'",
      'export default function Ok() { return <><PageHeader title="Ok" /><SelectField options={[]} /></> }',
    ].join('\n') }])
    assert.deepEqual(findings, [])
  })

  it('only checks registered screens for a header, following one level of delegation', () => {
    const findings = reviewComponentSources([
      { path: 'components/index.js', content: "export async function register(r) { await import('./pages/A.jsx'); await import('./pages/B.jsx') }" },
      { path: 'components/pages/A.jsx', content: "import Shell from './Shell.jsx'\nexport default function A() { return <Shell /> }" },
      { path: 'components/pages/Shell.jsx', content: "import { PageHeader } from '@runly/ui'\nexport default function Shell() { return <PageHeader title='x' /> }" },
      { path: 'components/pages/B.jsx', content: 'export default function B() { return <div /> }' },
      { path: 'components/pages/Dialog.jsx', content: 'export default function Dialog() { return <div /> }' },
    ])
    assert.deepEqual(findings.map((f) => `${f.rule}:${f.file}`), ['no-page-header:components/pages/B.jsx'])
  })

  it('ignores comments and non-source files', () => {
    const findings = reviewComponentSources([
      { path: 'components/Notes.jsx', content: '// no uses <select> ni window.confirm()\nexport const x = 1' },
      { path: 'components/readme.md', content: '<select>' },
    ])
    assert.deepEqual(findings, [])
  })
})
