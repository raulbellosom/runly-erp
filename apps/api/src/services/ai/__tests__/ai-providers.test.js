import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveProviders, isLocalEnabled } from '../ai-providers.js'

describe('ai-providers', () => {
  it('defaults: Groq from GROQ_API_KEY/GROQ_BASE_URL, local disabled', () => {
    const p = resolveProviders({ GROQ_API_KEY: 'gk', GROQ_BASE_URL: 'https://api.groq.com/' })
    assert.equal(p.groq.apiKey, 'gk')
    assert.equal(p.groq.baseUrl, 'https://api.groq.com')
    assert.equal(p.groq.apiPath, '/openai/v1/chat/completions')
    assert.equal(p.ollama.enabled, false)
  })

  it('GROQ_BASE_URL missing falls back to https://api.groq.com', () => {
    const p = resolveProviders({ GROQ_API_KEY: 'gk' })
    assert.equal(p.groq.baseUrl, 'https://api.groq.com')
  })

  it('AI_LOCAL_ENABLED=true turns on ollama with defaults', () => {
    const p = resolveProviders({ AI_LOCAL_ENABLED: 'true' })
    assert.equal(p.ollama.enabled, true)
    assert.equal(p.ollama.baseUrl, 'http://localhost:11434')
    assert.equal(p.ollama.apiPath, '/v1/chat/completions')
    assert.equal(p.ollama.modelLight, 'qwen3:4b')
    assert.equal(p.ollama.modelHeavy, 'qwen3:8b')
    assert.equal(p.ollama.apiKey, null)
  })

  it('OLLAMA_* overrides replace the defaults', () => {
    const p = resolveProviders({
      AI_LOCAL_ENABLED: 'true',
      OLLAMA_BASE_URL: 'http://gpu-box:11434/',
      OLLAMA_MODEL_LIGHT: 'qwen3:1.7b',
      OLLAMA_MODEL_HEAVY: 'qwen3:14b',
    })
    assert.equal(p.ollama.baseUrl, 'http://gpu-box:11434')
    assert.equal(p.ollama.modelLight, 'qwen3:1.7b')
    assert.equal(p.ollama.modelHeavy, 'qwen3:14b')
  })

  it('isLocalEnabled reflects AI_LOCAL_ENABLED case-insensitively, default false', () => {
    assert.equal(isLocalEnabled({}), false)
    assert.equal(isLocalEnabled({ AI_LOCAL_ENABLED: 'false' }), false)
    assert.equal(isLocalEnabled({ AI_LOCAL_ENABLED: 'TRUE' }), true)
  })
})
