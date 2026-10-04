import test from 'node:test'
import assert from 'node:assert/strict'
import { createBuilderAiDraftService } from '../builder-ai-draft-service.js'

const GOOD = {
  name: 'Visitas técnicas', description: 'Visitas a clientes', icon: 'MapPin',
  entities: [{ key: 'visita', label: 'Visita', pluralLabel: 'Visitas', fields: [
    { key: 'cliente', label: 'Cliente', type: 'relation', targetExternal: 'contact', required: true },
    { key: 'motivo', label: 'Motivo', type: 'text', required: true },
    { key: 'estado', label: 'Estado', type: 'select', options: [{ value: 'programada', label: 'Programada' }, { value: 'hecha', label: 'Hecha' }] },
  ] }],
  kanban: { entity: 'visita', groupBy: 'estado' },
}
const BAD = { ...GOOD, entities: [{ ...GOOD.entities[0], fields: [{ key: 'id', label: 'Id', type: 'text' }, { key: 'x', label: 'X', type: 'nope' }] }] }

function routerReturning(...answers) {
  const calls = []
  return {
    calls,
    runTask: async ({ messages, task, jsonMode }) => {
      calls.push({ messages, task, jsonMode })
      return { message: { content: JSON.stringify(answers[calls.length - 1]) } }
    },
  }
}

test('valid answer becomes a compilable definition with Kanban', async () => {
  const aiRouter = routerReturning(GOOD)
  const svc = createBuilderAiDraftService({ env: { GROQ_API_KEY: 'k' }, aiRouter })
  const { definition, errors, attempts } = await svc.draft({ description: 'Quiero registrar visitas técnicas a clientes con su estado' })
  assert.deepEqual(errors, [])
  assert.equal(attempts, 1)
  assert.equal(definition.key, 'custom.visitastecnicas')
  assert.equal(definition.views[0].kind, 'KANBAN')
  assert.equal(aiRouter.calls[0].task, 'builder_draft')
  assert.equal(aiRouter.calls[0].jsonMode, true)
})

test('compiler errors get one repair round with the diagnostics', async () => {
  const aiRouter = routerReturning(BAD, GOOD)
  const svc = createBuilderAiDraftService({ env: { GROQ_API_KEY: 'k' }, aiRouter })
  const { errors, attempts } = await svc.draft({ description: 'Quiero registrar visitas técnicas a clientes' })
  assert.equal(attempts, 2)
  assert.deepEqual(errors, [])
  assert.match(aiRouter.calls[1].messages.at(-1).content, /rejected/)
})

test('no AI configured → 503 ai_unavailable; short description → 422', async () => {
  const svc = createBuilderAiDraftService({ env: {}, aiRouter: routerReturning(GOOD) })
  await assert.rejects(svc.draft({ description: 'Algo suficientemente largo' }), (error) => error.status === 503 && error.code === 'ai_unavailable')
  const ok = createBuilderAiDraftService({ env: { GROQ_API_KEY: 'k' }, aiRouter: routerReturning(GOOD) })
  await assert.rejects(ok.draft({ description: 'corto' }), (error) => error.status === 422)
})

test('Kanban card title falls back to a readable field, or the Kanban is skipped', async () => {
  const { draftToDefinition } = await import('../builder-ai-draft-service.js')
  const noText = { ...GOOD, entities: [{ ...GOOD.entities[0], fields: [GOOD.entities[0].fields[0], { key: 'fecha', label: 'Fecha', type: 'datetime' }, GOOD.entities[0].fields[2]] }] }
  assert.equal(draftToDefinition(noText).views[0].card.titleField, 'fecha')
  const onlyRelation = { ...GOOD, entities: [{ ...GOOD.entities[0], fields: [GOOD.entities[0].fields[0], GOOD.entities[0].fields[2]] }] }
  assert.equal(draftToDefinition(onlyRelation).views, undefined)
})
