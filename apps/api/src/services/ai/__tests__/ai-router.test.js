// apps/api/src/services/ai/__tests__/ai-router.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createAiRouter } from '../ai-router.js'

const groqOk = (content) => async (url) => ({
  ok: true, status: 200,
  json: async () => ({ model: 'openai/gpt-oss-120b', choices: [{ message: { content } }] }),
})

describe('ai-router resolution rules', () => {
  it('AI_LOCAL_ENABLED unset -> always Groq, with the task groqDefaultModel', async () => {
    let seenUrl
    const fetchImpl = async (url) => { seenUrl = url; return groqOk('ok')(url) }
    const router = createAiRouter({ env: { GROQ_API_KEY: 'gk' }, fetchImpl })
    const result = await router.runTask({ task: 'mirai_classify', messages: [{ role: 'user', content: 'hola' }] })
    assert.match(seenUrl, /api\.groq\.com/)
    assert.equal(result.provider, 'groq')
  })

  it('AI_LOCAL_ENABLED=true + light task -> Ollama with OLLAMA_MODEL_LIGHT', async () => {
    let seenUrl, seenBody
    const fetchImpl = async (url, opts) => { seenUrl = url; seenBody = JSON.parse(opts.body); return groqOk('ok')(url) }
    const router = createAiRouter({ env: { AI_LOCAL_ENABLED: 'true' }, fetchImpl })
    const result = await router.runTask({ task: 'mirai_classify', messages: [{ role: 'user', content: 'hola' }] })
    assert.match(seenUrl, /localhost:11434/)
    assert.equal(seenBody.model, 'qwen3:4b')
    assert.equal(result.provider, 'ollama')
  })

  it('AI_LOCAL_ENABLED=true + heavy task -> Ollama with OLLAMA_MODEL_HEAVY', async () => {
    let seenBody
    const fetchImpl = async (url, opts) => { seenBody = JSON.parse(opts.body); return groqOk('ok')(url) }
    const router = createAiRouter({ env: { AI_LOCAL_ENABLED: 'true' }, fetchImpl })
    await router.runTask({ task: 'mirai_chat', messages: [{ role: 'user', content: 'hola' }] })
    assert.equal(seenBody.model, 'qwen3:8b')
  })

  it('a vision task (localCapable:false) always resolves to Groq even with AI_LOCAL_ENABLED=true', async () => {
    let seenUrl
    const fetchImpl = async (url) => { seenUrl = url; return groqOk('ok')(url) }
    const router = createAiRouter({ env: { AI_LOCAL_ENABLED: 'true', GROQ_API_KEY: 'gk' }, fetchImpl })
    await router.runTask({ task: 'pfm_vision', messages: [{ role: 'user', content: 'hola' }] })
    assert.match(seenUrl, /api\.groq\.com/)
  })

  it('an explicit per-task env override forces Groq with that model even when local is enabled', async () => {
    let seenUrl, seenBody
    const fetchImpl = async (url, opts) => { seenUrl = url; seenBody = JSON.parse(opts.body); return groqOk('ok')(url) }
    const router = createAiRouter({ env: { AI_LOCAL_ENABLED: 'true', CHAT_MIRAI_MODEL: 'llama-3.3-70b-versatile' }, fetchImpl })
    await router.runTask({ task: 'mirai_chat', messages: [{ role: 'user', content: 'hola' }] })
    assert.match(seenUrl, /api\.groq\.com/)
    assert.equal(seenBody.model, 'llama-3.3-70b-versatile')
  })

  it('ledger_import_text honors LEDGER_IMPORT_BASE_URL when routed to Groq', async () => {
    let seenUrl
    const fetchImpl = async (url) => { seenUrl = url; return groqOk('{}')(url) }
    const router = createAiRouter({ env: { LEDGER_IMPORT_BASE_URL: 'https://proxy.internal/' }, fetchImpl })
    await router.runTask({ task: 'ledger_import_text', messages: [{ role: 'user', content: 'x' }] })
    assert.match(seenUrl, /^https:\/\/proxy\.internal\/openai\/v1\/chat\/completions$/)
  })

  it('forwards reasoningEffort through to chatComplete unchanged', async () => {
    let seenBody
    const fetchImpl = async (url, opts) => { seenBody = JSON.parse(opts.body); return groqOk('ok')(url) }
    const router = createAiRouter({ env: { GROQ_API_KEY: 'gk' }, fetchImpl })
    await router.runTask({ task: 'ledger_import_text', messages: [{ role: 'user', content: 'x' }], reasoningEffort: 'low' })
    assert.equal(seenBody.reasoning_effort, 'low')
  })

  it('forwards useMaxCompletionTokens through to chatComplete unchanged', async () => {
    let seenBody
    const fetchImpl = async (url, opts) => { seenBody = JSON.parse(opts.body); return groqOk('ok')(url) }
    const router = createAiRouter({ env: { GROQ_API_KEY: 'gk' }, fetchImpl })
    await router.runTask({ task: 'ledger_import_text', messages: [{ role: 'user', content: 'x' }], maxTokens: 900, useMaxCompletionTokens: true })
    assert.equal(seenBody.max_completion_tokens, 900)
  })

  it('unknown task throws synchronously', async () => {
    const router = createAiRouter({ env: {} })
    await assert.rejects(() => router.runTask({ task: 'not_a_real_task', messages: [] }), /Tarea de IA desconocida/)
  })
})

describe('ai-router fallback + circuit breaker', () => {
  it('falls back to Groq for this request when the Ollama call fails at transport level', async () => {
    const calls = []
    const fetchImpl = async (url, opts) => {
      calls.push(url)
      if (url.includes('11434')) throw new Error('ECONNREFUSED')
      return groqOk('respuesta de groq')(url)
    }
    const router = createAiRouter({ env: { AI_LOCAL_ENABLED: 'true', GROQ_API_KEY: 'gk' }, fetchImpl })
    const result = await router.runTask({ task: 'mirai_classify', messages: [{ role: 'user', content: 'hola' }], timeoutMs: 500, retryDelayMs: 1 })
    assert.equal(result.provider, 'groq')
    assert.equal(result.message.content, 'respuesta de groq')
    assert.ok(calls.some((u) => u.includes('11434')))
    assert.ok(calls.some((u) => u.includes('api.groq.com')))
  })

  it('opens the circuit after 3 consecutive Ollama failures and skips straight to Groq afterward', async () => {
    const calls = []
    const fetchImpl = async (url) => {
      calls.push(url)
      if (url.includes('11434')) throw new Error('ECONNREFUSED')
      return groqOk('respuesta de groq')(url)
    }
    const router = createAiRouter({ env: { AI_LOCAL_ENABLED: 'true', GROQ_API_KEY: 'gk' }, fetchImpl })
    for (let i = 0; i < 3; i += 1) {
      await router.runTask({ task: 'mirai_classify', messages: [{ role: 'user', content: 'hola' }], timeoutMs: 500, retryDelayMs: 1, maxAttempts: 1 })
    }
    calls.length = 0
    const result = await router.runTask({ task: 'mirai_classify', messages: [{ role: 'user', content: 'hola' }], timeoutMs: 500, retryDelayMs: 1 })
    assert.equal(result.provider, 'groq')
    assert.equal(calls.some((u) => u.includes('11434')), false)
  })

  it('a validateResponse rejection on a local reply also triggers the Groq fallback', async () => {
    const calls = []
    const fetchImpl = async (url) => {
      calls.push(url)
      if (url.includes('11434')) return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'not json' } }] }) }
      return groqOk('{"rows":[]}')(url)
    }
    const router = createAiRouter({ env: { AI_LOCAL_ENABLED: 'true', GROQ_API_KEY: 'gk' }, fetchImpl })
    const result = await router.runTask({
      task: 'ledger_import_text',
      messages: [{ role: 'user', content: 'x' }],
      validateResponse: (msg) => { try { JSON.parse(msg?.content ?? ''); return true } catch { return false } },
    })
    assert.equal(result.provider, 'groq')
    assert.equal(result.message.content, '{"rows":[]}')
  })
})
