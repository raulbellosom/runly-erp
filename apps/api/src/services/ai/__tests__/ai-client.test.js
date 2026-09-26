import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { chatComplete, AiClientError } from '../ai-client.js'

const OK = (body) => async () => ({ ok: true, status: 200, json: async () => body, text: async () => '', headers: new Map() })

function baseArgs(overrides = {}) {
  return {
    provider: 'groq',
    baseUrl: 'https://api.groq.com',
    apiPath: '/openai/v1/chat/completions',
    apiKey: 'gk',
    model: 'openai/gpt-oss-120b',
    messages: [{ role: 'user', content: 'hola' }],
    ...overrides,
  }
}

describe('ai-client chatComplete', () => {
  it('posts to baseUrl+apiPath with Authorization when apiKey is set, returns the message', async () => {
    let seenUrl, seenHeaders, seenBody
    const fetchImpl = async (url, opts) => {
      seenUrl = url; seenHeaders = opts.headers; seenBody = JSON.parse(opts.body)
      return { ok: true, status: 200, json: async () => ({ model: 'openai/gpt-oss-120b', choices: [{ message: { role: 'assistant', content: 'hola de vuelta' } }] }) }
    }
    const result = await chatComplete(baseArgs({ fetchImpl }))
    assert.equal(seenUrl, 'https://api.groq.com/openai/v1/chat/completions')
    assert.equal(seenHeaders.Authorization, 'Bearer gk')
    assert.equal(seenBody.model, 'openai/gpt-oss-120b')
    assert.equal(result.message.content, 'hola de vuelta')
    assert.equal(result.provider, 'groq')
    assert.equal(result.model, 'openai/gpt-oss-120b')
  })

  it('omits Authorization header when apiKey is null (ollama)', async () => {
    let seenHeaders
    const fetchImpl = async (url, opts) => { seenHeaders = opts.headers; return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) } }
    await chatComplete(baseArgs({ provider: 'ollama', apiKey: null, apiPath: '/v1/chat/completions', baseUrl: 'http://localhost:11434', fetchImpl }))
    assert.equal('Authorization' in seenHeaders, false)
  })

  it('sets reasoning_format hidden for a reasoning model', async () => {
    let seenBody
    const fetchImpl = async (url, opts) => { seenBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) } }
    await chatComplete(baseArgs({ model: 'qwen/qwen3.8-27b', fetchImpl }))
    assert.equal(seenBody.reasoning_format, 'hidden')
  })

  it('does not set reasoning_effort unless explicitly requested, even for a reasoning model', async () => {
    let seenBody
    const fetchImpl = async (url, opts) => { seenBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) } }
    await chatComplete(baseArgs({ model: 'qwen/qwen3.8-27b', fetchImpl }))
    assert.equal('reasoning_effort' in seenBody, false)
  })

  it('sets reasoning_effort when explicitly requested for a reasoning model', async () => {
    let seenBody
    const fetchImpl = async (url, opts) => { seenBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) } }
    await chatComplete(baseArgs({ model: 'qwen/qwen3.8-27b', reasoningEffort: 'low', fetchImpl }))
    assert.equal(seenBody.reasoning_effort, 'low')
  })

  it('sets response_format json_object when jsonMode is true', async () => {
    let seenBody
    const fetchImpl = async (url, opts) => { seenBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{}' } }] }) } }
    await chatComplete(baseArgs({ jsonMode: true, fetchImpl }))
    assert.deepEqual(seenBody.response_format, { type: 'json_object' })
  })

  it('sends max_tokens by default (useMaxCompletionTokens not set)', async () => {
    let seenBody
    const fetchImpl = async (url, opts) => { seenBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) } }
    await chatComplete(baseArgs({ maxTokens: 900, fetchImpl }))
    assert.equal(seenBody.max_tokens, 900)
    assert.equal('max_completion_tokens' in seenBody, false)
  })

  it('sends max_completion_tokens instead when useMaxCompletionTokens is true', async () => {
    let seenBody
    const fetchImpl = async (url, opts) => { seenBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) } }
    await chatComplete(baseArgs({ maxTokens: 900, useMaxCompletionTokens: true, fetchImpl }))
    assert.equal(seenBody.max_completion_tokens, 900)
    assert.equal('max_tokens' in seenBody, false)
  })

  it('retries once on a network error, then succeeds', async () => {
    let attempts = 0
    const fetchImpl = async () => {
      attempts += 1
      if (attempts === 1) throw new Error('ECONNREFUSED')
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) }
    }
    const result = await chatComplete(baseArgs({ fetchImpl, retryDelayMs: 1 }))
    assert.equal(attempts, 2)
    assert.equal(result.message.content, 'ok')
  })

  it('throws AiClientError after exhausting retries on a persistent 500', async () => {
    const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'boom' })
    await assert.rejects(
      () => chatComplete(baseArgs({ fetchImpl, retryDelayMs: 1 })),
      (err) => err instanceof AiClientError && err.status === 502,
    )
  })

  it('throws AiClientError immediately on a non-retryable 4xx (no retry attempted)', async () => {
    let attempts = 0
    const fetchImpl = async () => { attempts += 1; return { ok: false, status: 400, json: async () => ({}), text: async () => 'bad request' } }
    await assert.rejects(() => chatComplete(baseArgs({ fetchImpl })), AiClientError)
    assert.equal(attempts, 1)
  })

  it('respectRateLimit widens the retry delay from Retry-After on a 429, still retries', async () => {
    let attempts = 0
    const fetchImpl = async () => {
      attempts += 1
      if (attempts === 1) return { ok: false, status: 429, json: async () => ({}), text: async () => '', headers: { get: (k) => (k === 'retry-after' ? '20' : null) } }
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) }
    }
    const result = await chatComplete(baseArgs({ fetchImpl, respectRateLimit: true, retryDelayMs: 1 }))
    assert.equal(result.message.content, 'ok')
    assert.equal(attempts, 2)
  })
})
