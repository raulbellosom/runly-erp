import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mergeChunkedRows, extractRowsFromText, extractStatementRows, suggestColumnMapping } from '../ai-import-extraction.js'

describe('ai-import-extraction', () => {
  it('mergeChunkedRows concatenates rows from multiple chunks in order', () => {
    const chunkA = [{ fecha: '2026-03-25', nombre: 'A', deposito: null, retiro: 100 }]
    const chunkB = [{ fecha: '2026-03-27', nombre: 'B', deposito: 50, retiro: null }]
    const merged = mergeChunkedRows([chunkA, chunkB])
    assert.equal(merged.length, 2)
    assert.equal(merged[0].nombre, 'A')
    assert.equal(merged[1].nombre, 'B')
  })

  it('mergeChunkedRows drops rows with neither fecha nor nombre (unusable extraction noise)', () => {
    const merged = mergeChunkedRows([[{ fecha: null, nombre: null, deposito: null, retiro: null }]])
    assert.equal(merged.length, 0)
  })
})

describe('extractRowsFromText', () => {
  it('sends the statement text to Groq and parses the JSON row list', async () => {
    const fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body)
      assert.ok(url.includes('/openai/v1/chat/completions'))
      assert.ok(body.messages[1].content.includes('SALDO'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'test-model',
          choices: [{ message: { content: JSON.stringify({ rows: [{ fecha: '2026-03-27', nombre: 'ACEITES SUPERFINOS', deposito: null, retiro: 21342.67, referencia: null, concepto: null, numero: null }] }) } }],
        }),
      }
    }
    const result = await extractRowsFromText({
      text: 'FECHA NOMBRE SALDO\n260327 ACEITES SUPERFINOS 21,342.67 79,094.35',
      env: { GROQ_API_KEY: 'test-key' },
      fetchImpl,
    })
    assert.equal(result.rows.length, 1)
    assert.equal(result.rows[0].nombre, 'ACEITES SUPERFINOS')
  })

  it('throws a 503 ExtractionError when GROQ_API_KEY is missing', async () => {
    await assert.rejects(
      () => extractRowsFromText({ text: 'x', env: {}, fetchImpl: async () => { throw new Error('should not be called') } }),
      (err) => { assert.equal(err.status, 503); return true },
    )
  })
})

describe('suggestColumnMapping', () => {
  it('sends the CSV/XLSX headers to Groq and parses the mapping JSON', async () => {
    const fetchImpl = async (url, opts) => {
      const body = JSON.parse(opts.body)
      assert.ok(url.includes('/openai/v1/chat/completions'))
      assert.ok(body.messages[1].content.includes('Fecha'))
      assert.ok(body.messages[1].content.includes('Deposito'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          model: 'test-model',
          choices: [{ message: { content: JSON.stringify({
            fecha: 'Fecha', nombre: 'Descripcion', deposito: 'Deposito', retiro: 'Retiro',
            referencia: null, concepto: null, numero: null,
          }) } }],
        }),
      }
    }
    const mapping = await suggestColumnMapping({
      headers: ['Fecha', 'Descripcion', 'Deposito', 'Retiro'],
      env: { GROQ_API_KEY: 'test-key' },
      fetchImpl,
    })
    assert.equal(mapping.fecha, 'Fecha')
    assert.equal(mapping.nombre, 'Descripcion')
    assert.equal(mapping.deposito, 'Deposito')
    assert.equal(mapping.retiro, 'Retiro')
  })
})

describe('extractStatementRows', () => {
  it('runs empty-text pages through vision and text pages through the text extractor, then merges', async () => {
    const pages = [
      { page: 1, text: 'FECHA NOMBRE SALDO\n260327 ACEITE 21,342.67 79,094.35', empty: false, imageBase64: null },
      { page: 2, text: '', empty: true, imageBase64: 'ZmFrZQ==' },
    ]
    const textCalls = []
    const visionCalls = []
    const result = await extractStatementRows({
      pages,
      extractText: async (args) => { textCalls.push(args); return { rows: [{ fecha: '2026-03-27', nombre: 'ACEITE', deposito: null, retiro: 21342.67 }] } },
      extractVisionPage: async (args) => { visionCalls.push(args); return { parsed: { rows: [{ fecha: '2026-03-26', nombre: 'CAPTURA', deposito: 100, retiro: null }] } } },
    })
    assert.equal(textCalls.length, 1)
    assert.equal(visionCalls.length, 1)
    assert.equal(result.rows.length, 2)
  })

  describe('extractStatementRows with embedded page images', () => {
    it('uses the page.imageBase64 already extracted by the worker, no separate render step', async () => {
      const pages = [{ page: 1, text: '', empty: true, imageBase64: 'ZmFrZQ==' }]
      const visionCalls = []
      const result = await extractStatementRows({
        pages,
        extractText: async () => ({ rows: [] }),
        extractVisionPage: async (args) => { visionCalls.push(args); return { parsed: { rows: [{ fecha: '2026-03-26', nombre: 'FOTO', deposito: 10, retiro: null }] } } },
      })
      assert.equal(visionCalls[0].imageBase64, 'ZmFrZQ==')
      assert.equal(result.rows.length, 1)
    })
  })
})
