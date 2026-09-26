import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createHelpAssistantService } from '../help-assistant-service.js'

function groqStub(queue) {
  const q = [...queue]
  return async () => ({
    ok: true,
    status: 200,
    json: async () => q.shift() ?? { choices: [{ message: { content: '(sin respuesta)' } }] },
    text: async () => '',
  })
}
const finalMsg = (content) => ({ choices: [{ message: { role: 'assistant', content } }] })

function makeHelpServiceStub({ search = [], resolved = { moduleKey: null, moduleName: null, overview: null, view: null } } = {}) {
  return {
    searchHelp: async () => search,
    resolveHelp: async () => resolved,
  }
}

describe('help-assistant-service', () => {
  it('isConfigured reflects GROQ_API_KEY presence', () => {
    const configured = createHelpAssistantService({ helpService: makeHelpServiceStub(), env: { GROQ_API_KEY: 'x' } })
    const unconfigured = createHelpAssistantService({ helpService: makeHelpServiceStub(), env: {} })
    assert.equal(configured.isConfigured(), true)
    assert.equal(unconfigured.isConfigured(), false)
  })

  it('ask() returns mode:"fallback" with search results when GROQ_API_KEY is missing', async () => {
    const search = [{ moduleKey: 'custom.fleet', moduleName: 'Flotas', viewKey: '/fleet/vehicles', title: 'Vehiculos', snippet: 'Aqui...', score: 2 }]
    const service = createHelpAssistantService({ helpService: makeHelpServiceStub({ search }), env: {} })
    const result = await service.ask({ actorId: 'a1', path: '/fleet/vehicles', question: 'como registro un vehiculo' })
    assert.equal(result.mode, 'fallback')
    assert.deepEqual(result.results, search)
  })

  it('ask() returns mode:"ai" with an answer + sources when configured and context exists', async () => {
    const search = [{ moduleKey: 'custom.fleet', moduleName: 'Flotas', viewKey: '/fleet/vehicles', title: 'Vehiculos', snippet: 'Da de alta un vehiculo desde el boton Nuevo.', score: 2 }]
    const fetchImpl = groqStub([finalMsg('Ve a Vehiculos y usa el boton Nuevo.')])
    const service = createHelpAssistantService({
      helpService: makeHelpServiceStub({ search }),
      env: { GROQ_API_KEY: 'x' },
      fetchImpl,
    })
    const result = await service.ask({ actorId: 'a1', path: '/fleet/vehicles', question: 'como registro un vehiculo' })
    assert.equal(result.mode, 'ai')
    assert.equal(result.answer, 'Ve a Vehiculos y usa el boton Nuevo.')
    assert.equal(result.sources.length, 1)
    assert.equal(result.sources[0].moduleKey, 'custom.fleet')
  })

  it('ask() short-circuits to a "no encontre informacion" answer without calling Groq when there is no context', async () => {
    let called = false
    const fetchImpl = async () => { called = true; return groqStub([])() }
    const service = createHelpAssistantService({
      helpService: makeHelpServiceStub({ search: [] }),
      env: { GROQ_API_KEY: 'x' },
      fetchImpl,
    })
    const result = await service.ask({ actorId: 'a1', path: '/unknown', question: 'algo que no existe' })
    assert.equal(result.mode, 'ai')
    assert.match(result.answer, /no encontre/i)
    assert.equal(called, false)
  })

  it('ask() enforces the rate limit (20/60s) per actor', async () => {
    const fetchImpl = groqStub([])
    const service = createHelpAssistantService({
      helpService: makeHelpServiceStub({ search: [{ moduleKey: 'm', moduleName: 'M', viewKey: null, title: 'T', snippet: 'S', score: 1 }] }),
      env: { GROQ_API_KEY: 'x' },
      fetchImpl,
    })
    for (let i = 0; i < 20; i += 1) {
      await service.ask({ actorId: 'rate-actor', path: '/x', question: `pregunta ${i}` })
    }
    await assert.rejects(
      () => service.ask({ actorId: 'rate-actor', path: '/x', question: 'una mas' }),
      (err) => err.status === 429,
    )
  })

  it('ask() maps a persistent Groq 500 to a 502 HelpAssistantServiceError', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'boom' })
    const service = createHelpAssistantService({
      helpService: makeHelpServiceStub({ search: [{ moduleKey: 'm', moduleName: 'M', viewKey: null, title: 'T', snippet: 'S', score: 1 }] }),
      env: { GROQ_API_KEY: 'x' },
      fetchImpl,
    })
    await assert.rejects(
      () => service.ask({ actorId: 'a2', path: '/x', question: 'algo' }),
      (err) => err.status === 502,
    )
  })
})
