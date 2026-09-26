import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { toChatHistory } from '../chat-history.js'

describe('toChatHistory', () => {
  it('maps user/assistant/error roles to user/assistant', () => {
    const conversation = [
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'como te ayudo' },
      { role: 'error', content: 'algo fallo' },
    ]
    const result = toChatHistory(conversation, 6)
    assert.deepEqual(result.map((h) => h.role), ['user', 'assistant', 'user'])
  })

  it('leaves short content untouched', () => {
    const result = toChatHistory([{ role: 'user', content: 'hola' }], 6)
    assert.equal(result[0].content, 'hola')
  })

  it('truncates content over 800 chars so it always fits the server\'s 1000-char history limit', () => {
    const longAnswer = 'a'.repeat(1500)
    const result = toChatHistory([{ role: 'assistant', content: longAnswer }], 6)
    assert.ok(result[0].content.length <= 801)
    assert.ok(result[0].content.length < longAnswer.length)
  })

  it('keeps only the last maxTurns entries', () => {
    const conversation = Array.from({ length: 10 }, (_, i) => ({ role: 'user', content: `msg${i}` }))
    const result = toChatHistory(conversation, 3)
    assert.deepEqual(result.map((h) => h.content), ['msg7', 'msg8', 'msg9'])
  })
})
