# Importación de estados de cuenta con IA en runly.ledger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user upload a bank statement (PDF with text, scanned PDF/photo, or CSV/XLSX) and get it turned into reviewable `ledger_transaction` rows — with the target account auto-suggested and duplicates flagged — before anything is inserted.

**Architecture:** A synchronous "recognize → review → commit" pipeline (same shape as `inventory-intake-service.js`). `recognize` dispatches by file type: PDF text extraction (worker thread, `pdfjs-dist`) feeds a text-only Groq call; pages with no extractable text fall back to the existing vision adapter (`vision-service.js`); CSV/XLSX reuse the existing `import-service.js` parser and get a lightweight AI column-mapping pass. All paths converge on one row shape, get merged, deduplicated (intra-file + against existing DB rows), and matched to a candidate account, then signed into a proof token. `commit` verifies the token, re-checks permissions, and inserts transactionally with `AuditLog`-based idempotency (same pattern as inventory).

**Tech Stack:** Node/Hono API, `pdfjs-dist` (already a dependency), Groq OpenAI-compatible chat completions (already used by `vision-service.js`), `prisma.$queryRaw` against `ledger_account`/`ledger_transaction`, `prisma.auditLog`, React/Vite frontend with `@runly/ui`.

**Reference:** Spec at `docs/superpowers/specs/2026-09-19-ledger-ai-statement-import-design.md`. Read it before starting — this plan does not repeat the "why", only the "how".

---

## File Structure Map

Backend (new):
- `apps/api/src/services/ledger-import-pdf-worker.js` — worker_thread, extracts text per PDF page (adapted from `apps/api/src/services/inventory-chat-pdf-worker.js`, no 12k-char truncation, up to 20 pages).
- `apps/api/src/routes/ledger/ai-import-extraction.js` — orchestrates extraction: PDF/CSV/XLSX dispatch, Groq text call, vision fallback per page, chunk+merge for large documents.
- `apps/api/src/routes/ledger/ai-import-dedup.js` — pure functions: intra-file fingerprint dedup, DB duplicate lookup, account auto-detection matching.
- `apps/api/src/routes/ledger/ai-import-token.js` — HMAC proof token sign/verify (mirrors `inventory-intake-service.js`'s `encodeProof`/`decodeProof`).
- `apps/api/src/routes/ledger/ai-import-service.js` — glues the above together for `recognize`; handles `commit` (AuditLog idempotency + transactional insert).
- `apps/api/src/routes/ledger/ai-import-routes.js` — the two HTTP endpoints.
- `apps/api/src/routes/ledger/__tests__/ai-import-dedup.test.js`, `__tests__/ai-import-token.test.js`, `__tests__/ai-import-service.test.js` — unit tests, Groq/prisma mocked.

Backend (modified):
- `apps/api/src/services/vision-service.js` — add `extractLedgerStatementPage` method (mirrors `extractInventory`).
- `apps/api/src/routes/ledger/validators.js` — add `aiImportCommitSchema`.
- `apps/api/src/routes/ledger/index.js` — mount the new router.

Frontend (new):
- `apps/desktop/src/modules/runly.ledger/screens/AiImportScreen.jsx` — 3-step flow (subir → revisar → confirmar).
- `apps/desktop/src/modules/runly.ledger/hooks/use-ai-import.js` — `recognize`/`commit` mutations (raw `fetch`, matching every other screen in this module — this module does not use `@runly/sdk`).

Frontend (modified):
- `apps/desktop/src/modules/runly.ledger/screens/AccountsScreen.jsx` — add "Importar con IA" button.
- `apps/desktop/src/app/module-screen-resolver.js` — route `/import-ai` subPath for `runly.ledger`.
- `apps/desktop/src/app/ModuleOutlet.jsx` — register the lazy screen in `screenMap`.

No Prisma schema changes, no new migration, no new permission (reuses `ledger.import`).

---

## Task 1: PDF text-extraction worker

**Files:**
- Create: `apps/api/src/services/ledger-import-pdf-worker.js`
- Create: `apps/api/src/routes/ledger/ai-import-extraction.js` (only the `extractPdfPages` part in this task)
- Test: `apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js`

- [ ] **Step 1: Create the worker**

```javascript
// apps/api/src/services/ledger-import-pdf-worker.js
import { parentPort, workerData } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

// Parse untrusted PDFs away from the API event loop. Unlike
// inventory-chat-pdf-worker.js (which truncates aggressively for chat
// context), a bank statement needs every row, so this only caps page COUNT
// (20) as a hard safety limit — it does not truncate total text length.
const MAX_PAGES = 20

const task = getDocument({
  data: new Uint8Array(workerData), isEvalSupported: false, useSystemFonts: false,
  disableFontFace: true, useWasm: false,
  standardFontDataUrl: fileURLToPath(new URL('./standard_fonts/', import.meta.resolve('pdfjs-dist/package.json'))).replaceAll('\\', '/'),
})

try {
  const pdf = await task.promise
  const truncated = pdf.numPages > MAX_PAGES
  const pages = []
  for (let page = 1; page <= Math.min(pdf.numPages, MAX_PAGES); page += 1) {
    const content = await (await pdf.getPage(page)).getTextContent()
    const text = content.items.map((item) => item.str ?? '').join(' ').trim()
    pages.push({ page, text, empty: text.length < 10 })
  }
  parentPort.postMessage({ pages, truncated, totalPages: pdf.numPages })
} catch {
  parentPort.postMessage({ error: true })
} finally {
  await task.destroy()
}
```

- [ ] **Step 2: Create the wrapper + test file, write the failing test first**

```javascript
// apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mergeChunkedRows } from '../ai-import-extraction.js'

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
```

Run: `node --test apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js`
Expected: FAIL — `ai-import-extraction.js` does not exist yet.

- [ ] **Step 3: Create `ai-import-extraction.js` with the worker wrapper and `mergeChunkedRows`**

```javascript
// apps/api/src/routes/ledger/ai-import-extraction.js
import { Worker } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'

const WORKER_PATH = fileURLToPath(new URL('../../services/ledger-import-pdf-worker.js', import.meta.url))
const WORKER_TIMEOUT_MS = 15000

export class ExtractionError extends Error {
  constructor(message, status = 422) {
    super(message)
    this.name = 'ExtractionError'
    this.status = status
  }
}

// Runs the PDF text-extraction worker and resolves with per-page text.
export function extractPdfPages(buffer) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, { workerData: buffer })
    const timer = setTimeout(() => {
      worker.terminate()
      reject(new ExtractionError('El PDF tardo demasiado en procesarse.'))
    }, WORKER_TIMEOUT_MS)
    worker.once('message', (msg) => {
      clearTimeout(timer)
      worker.terminate()
      if (msg.error) return reject(new ExtractionError('No se pudo leer el PDF.'))
      resolve(msg)
    })
    worker.once('error', (err) => {
      clearTimeout(timer)
      reject(new ExtractionError(`No se pudo leer el PDF: ${err.message}`))
    })
  })
}

// Combines rows extracted from multiple text chunks (or multiple vision
// pages) into one ordered list, dropping rows the model returned with no
// usable identity (no date and no name — extraction noise, not a real row).
export function mergeChunkedRows(chunks) {
  const merged = []
  for (const chunk of chunks) {
    for (const row of chunk) {
      if (!row.fecha && !row.nombre) continue
      merged.push(row)
    }
  }
  return merged
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/ledger-import-pdf-worker.js apps/api/src/routes/ledger/ai-import-extraction.js apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js
git commit -m "feat(ledger): add PDF text-extraction worker and chunk merge"
```

---

## Task 2: Groq text extraction (PDF-with-text and CSV/XLSX column mapping)

**Files:**
- Modify: `apps/api/src/routes/ledger/ai-import-extraction.js`
- Test: `apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js` (add cases)

- [ ] **Step 1: Add a failing test for the text-completion call shape and JSON parsing**

Append to `ai-import-extraction.test.js`:

```javascript
import { extractRowsFromText } from '../ai-import-extraction.js'

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
```

Run: `node --test apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js`
Expected: FAIL — `extractRowsFromText` not exported yet.

- [ ] **Step 2: Add `extractRowsFromText` to `ai-import-extraction.js`**

```javascript
import { isReasoningModel } from '../../services/groq-model-helpers.js'

const STATEMENT_SYSTEM_PROMPT = [
  'Eres un extractor de movimientos bancarios en español (México). Recibes el texto plano de un estado de cuenta (puede venir de varias paginas y de mas de un formato de reporte del mismo banco).',
  'Devuelve UNICAMENTE un objeto JSON: {"rows": [{"fecha": "YYYY-MM-DD", "nombre": string, "referencia": string|null, "concepto": string|null, "numero": string|null, "deposito": number|null, "retiro": number|null}]}.',
  'El texto extraido de PDF pierde la alineacion de columnas: cuando no sea obvio si un monto fue deposito o retiro, usa el SALDO (columna de saldo corriente) para inferirlo — si el saldo sube, es deposito; si baja, es retiro.',
  'Un mismo movimiento puede aparecer representado dos veces en el documento (p. ej. una tabla oficial y despues un detalle o captura de la misma cuenta). Si detectas con alta confianza que dos filas son el mismo movimiento (misma fecha, mismo monto, mismo tercero), devuelve una sola fila.',
  'exactamente un valor de deposito o retiro debe ser no-nulo por fila (nunca ambos, nunca ninguno si el monto es legible). fecha siempre en formato ISO. Si no puedes leer un campo, usa null. No inventes movimientos que no esten en el texto.',
].join(' ')

function extractJsonObject(text) {
  if (typeof text !== 'string') return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null
  try { return JSON.parse(candidate.slice(start, end + 1)) } catch { return null }
}

// Text-only sibling of vision-service.js's Groq adapter — same transport,
// retries and reasoning-model handling, but no image content block.
export async function extractRowsFromText({ text, env = process.env, fetchImpl }) {
  const apiKey = env.GROQ_API_KEY
  if (!apiKey) {
    const err = new ExtractionError('Importacion con IA no configurada (falta GROQ_API_KEY).', 503)
    throw err
  }
  const baseUrl = (env.LEDGER_IMPORT_BASE_URL || env.GROQ_BASE_URL || 'https://api.groq.com').replace(/\/$/, '')
  const model = env.LEDGER_IMPORT_MODEL || 'openai/gpt-oss-120b'
  const fetchFn = fetchImpl ?? globalThis.fetch
  const body = {
    model,
    temperature: 0,
    response_format: { type: 'json_object' },
    max_completion_tokens: 8000,
    ...(isReasoningModel(model) ? { reasoning_format: 'hidden', reasoning_effort: 'low' } : {}),
    messages: [
      { role: 'system', content: STATEMENT_SYSTEM_PROMPT },
      { role: 'user', content: text.slice(0, 60000) },
    ],
  }

  let lastErr
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1500))
    let res
    try {
      res = await fetchFn(`${baseUrl}/openai/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      })
    } catch (err) {
      lastErr = new ExtractionError(`No se pudo contactar al servicio de IA: ${err.message}`, 502)
      continue
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = new ExtractionError(`El servicio de IA respondio ${res.status}.`, 502)
      continue
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new ExtractionError(`El servicio de IA rechazo la peticion (${res.status}): ${detail.slice(0, 300)}`)
    }
    const payload = await res.json()
    const content = payload?.choices?.[0]?.message?.content
    const obj = extractJsonObject(content)
    if (!obj?.rows) throw new ExtractionError('El servicio de IA no devolvio un JSON legible.')
    return { rows: obj.rows, model: payload.model ?? model }
  }
  throw lastErr
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `node --test apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js`
Expected: PASS (4 tests)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/ledger/ai-import-extraction.js apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js
git commit -m "feat(ledger): add Groq text extraction for statement rows"
```

---

## Task 3: Vision fallback for scanned pages + chunking orchestration

**Files:**
- Modify: `apps/api/src/services/vision-service.js`
- Modify: `apps/api/src/routes/ledger/ai-import-extraction.js`
- Test: `apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js` (add case)

- [ ] **Step 1: Add `extractLedgerStatementPage` to `vision-service.js`**

Modify `apps/api/src/services/vision-service.js` — inside the object returned by `createVisionService` (after the existing `extractInventory` method, before the closing `};` at the end of the file, i.e. right after line 274's closing `},`):

```javascript
    async extractLedgerStatementPage({ imageBase64, mimeType }) {
      return adapter.call({
        imageBase64, mimeType, maxTokens: 3500, allowTextFallback: false,
        question: 'Lee esta pagina de un estado de cuenta bancario o una captura de movimientos.',
        systemPrompt: [
          'Eres un extractor de movimientos bancarios en español (México), leyendo una imagen de una pagina de estado de cuenta o una captura de una app bancaria.',
          'Devuelve UNICAMENTE: {"rows": [{"fecha": "YYYY-MM-DD", "nombre": string, "referencia": string|null, "concepto": string|null, "numero": string|null, "deposito": number|null, "retiro": number|null}]}.',
          'Usa el saldo corriente visible para inferir si un monto es deposito (saldo sube) o retiro (saldo baja) cuando la columna no sea clara.',
          'exactamente un valor de deposito o retiro no-nulo por fila. fecha en ISO. Si algo no es legible, usa null y no inventes.',
        ].join(' '),
        normalize: (value) => value,
      })
    },
```

- [ ] **Step 2: Add a failing test for the orchestration function `extractStatementRows`**

Append to `ai-import-extraction.test.js`:

```javascript
import { extractStatementRows } from '../ai-import-extraction.js'

describe('extractStatementRows', () => {
  it('runs empty-text pages through vision and text pages through the text extractor, then merges', async () => {
    const pages = [
      { page: 1, text: 'FECHA NOMBRE SALDO\n260327 ACEITE 21,342.67 79,094.35', empty: false },
      { page: 2, text: '', empty: true },
    ]
    const textCalls = []
    const visionCalls = []
    const result = await extractStatementRows({
      pages,
      extractText: async (args) => { textCalls.push(args); return { rows: [{ fecha: '2026-03-27', nombre: 'ACEITE', deposito: null, retiro: 21342.67 }] } },
      extractVisionPage: async (args) => { visionCalls.push(args); return { parsed: { rows: [{ fecha: '2026-03-26', nombre: 'CAPTURA', deposito: 100, retiro: null }] } } },
      renderPageImage: async () => ({ imageBase64: 'ZmFrZQ==', mimeType: 'image/png' }),
    })
    assert.equal(textCalls.length, 1)
    assert.equal(visionCalls.length, 1)
    assert.equal(result.rows.length, 2)
  })
})
```

Run: `node --test apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js`
Expected: FAIL — `extractStatementRows` not exported yet.

- [ ] **Step 3: Add `extractStatementRows` to `ai-import-extraction.js`**

```javascript
// Orchestrates extraction across all pages of a document: text pages go
// through the cheap text extractor, pages with no extractable text (scanned
// or photographed) go through vision, page by page. Dependencies are
// injected so this stays unit-testable without a real Groq call or a real
// PDF renderer.
export async function extractStatementRows({ pages, extractText, extractVisionPage, renderPageImage }) {
  const textPages = pages.filter((p) => !p.empty)
  const imagePages = pages.filter((p) => p.empty)

  const chunks = []
  if (textPages.length > 0) {
    const combinedText = textPages.map((p) => `\nPagina ${p.page}:\n${p.text}`).join('\n')
    const { rows } = await extractText({ text: combinedText })
    chunks.push(rows)
  }
  for (const page of imagePages) {
    const { imageBase64, mimeType } = await renderPageImage(page.page)
    const { parsed } = await extractVisionPage({ imageBase64, mimeType })
    chunks.push(parsed.rows ?? [])
  }

  return { rows: mergeChunkedRows(chunks) }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/vision-service.js apps/api/src/routes/ledger/ai-import-extraction.js apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js
git commit -m "feat(ledger): add vision fallback and per-document extraction orchestration"
```

---

## Task 3b: Scanned-page images (no new native dependency) + direct photo uploads

Rendering a PDF page to a full raster image server-side normally needs `pdfjs-dist`'s canvas API, which needs `node-canvas` (a native binary dependency — not installed in `apps/api`, and fragile to add cross-platform). We avoid that: most scanned bank statements are a PDF with exactly one embedded raster image per page (the scan itself), so instead of rendering, we pull that embedded image straight out of the page's operator list. A direct photo upload (JPG/PNG/WEBP) needs no PDF handling at all — the uploaded buffer already is the image.

**Files:**
- Modify: `apps/api/src/services/ledger-import-pdf-worker.js`
- Modify: `apps/api/src/routes/ledger/ai-import-extraction.js`
- Modify: `apps/api/src/routes/ledger/ai-import-routes.js`
- Test: `apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js` (add case)

- [ ] **Step 1: Extend the worker to also return the embedded image for empty (scanned) pages**

In `ledger-import-pdf-worker.js`, inside the page loop, after computing `empty`:

```javascript
    let imageBase64 = null
    if (text.length < 10) {
      const pdfPage = await pdf.getPage(page)
      const opList = await pdfPage.getOperatorList()
      const imgIndex = opList.fnArray.findIndex((fn) => fn === (await import('pdfjs-dist/legacy/build/pdf.mjs')).OPS.paintImageXObject)
      if (imgIndex !== -1) {
        const objId = opList.argsArray[imgIndex][0]
        const img = await new Promise((resolve) => pdfPage.objs.get(objId, resolve))
        if (img?.data && img.width && img.height) {
          // img.data is raw RGB(A); re-encode as JPEG so it's a normal image
          // buffer the same vision call path (which expects a mime type +
          // base64) can use without special-casing raw pixel buffers.
          const { default: sharp } = await import('sharp')
          const channels = img.data.length / (img.width * img.height)
          const jpeg = await sharp(Buffer.from(img.data), {
            raw: { width: img.width, height: img.height, channels: Math.round(channels) },
          }).jpeg({ quality: 80 }).toBuffer()
          imageBase64 = jpeg.toString('base64')
        }
      }
    }
```

And change the `pages.push(...)` line to: `pages.push({ page, text, empty: text.length < 10, imageBase64 })`.

- [ ] **Step 2: Add a failing test for `renderPageImage` wired from worker output**

Append to `ai-import-extraction.test.js`:

```javascript
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
```

Run: `node --test apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js`
Expected: FAIL — `extractStatementRows` still requires a `renderPageImage` callback and doesn't read `page.imageBase64`.

- [ ] **Step 3: Simplify `extractStatementRows` to use the worker's embedded image directly (drop `renderPageImage`)**

Replace the `imagePages` loop in `extractStatementRows` (in `ai-import-extraction.js`) with:

```javascript
  for (const page of imagePages) {
    if (!page.imageBase64) continue // no embedded image found — surfaced as a warning by the caller
    const { parsed } = await extractVisionPage({ imageBase64: page.imageBase64, mimeType: 'image/jpeg' })
    chunks.push(parsed.rows ?? [])
  }
```

And drop `renderPageImage` from the function's parameter list and JSDoc-style destructure.

- [ ] **Step 4: Run tests, fix the Task 3 test that still passes `renderPageImage`**

Update the Task 3 test (`'runs empty-text pages through vision and text pages through the text extractor, then merges'`) to give its empty page an `imageBase64: 'ZmFrZQ=='` field and drop the `renderPageImage` argument from the `extractStatementRows` call.

Run: `node --test apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Wire real vision extraction into the route (replace the Task 7 placeholder) and support direct image uploads**

In `ai-import-routes.js`, replace the `extractVisionPage: async () => ({ parsed: { rows: [] } })` placeholder with `extractVisionPage: vision.extractLedgerStatementPage` (import `createVisionService` and construct `vision` once per request, same as `ai-import-service.js` does).

Also, before the `isPdf` check, add a branch for direct photo uploads:

```javascript
      const isImage = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
      if (isImage) {
        const imageBase64 = buffer.toString('base64')
        const { parsed } = await vision.extractLedgerStatementPage({ imageBase64, mimeType: file.type })
        const dedupedRows = dedupeIntraFile(parsed.rows ?? [])
        // ... same detectedAccount/existingTransactions/markDbDuplicates flow as the PDF branch below
        // (the implementer should factor the shared "rows -> account match -> dedup -> sign token"
        // tail into one local function called from both the PDF and image branches, since it's now
        // identical in three places — do this as part of this step, not left duplicated.)
      }
```

- [ ] **Step 6: Lint and commit**

Run: `npx eslint apps/api/src/routes/ledger apps/api/src/services/ledger-import-pdf-worker.js --no-warn-ignored`
Expected: no errors.

```bash
git add apps/api/src/services/ledger-import-pdf-worker.js apps/api/src/routes/ledger/ai-import-extraction.js apps/api/src/routes/ledger/ai-import-routes.js apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js
git commit -m "feat(ledger): support scanned PDF pages and direct photo uploads via embedded images"
```

---

## Task 4: Intra-file dedup, DB duplicate lookup, account auto-detection

**Files:**
- Create: `apps/api/src/routes/ledger/ai-import-dedup.js`
- Test: `apps/api/src/routes/ledger/__tests__/ai-import-dedup.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// apps/api/src/routes/ledger/__tests__/ai-import-dedup.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { rowFingerprint, dedupeIntraFile, findAccountCandidates } from '../ai-import-dedup.js'

describe('rowFingerprint', () => {
  it('produces the same fingerprint for the same date+amount+name regardless of casing/whitespace', () => {
    const a = rowFingerprint({ fecha: '2026-03-27', nombre: '  Autopartes Salav  ', deposito: null, retiro: 15768.96 })
    const b = rowFingerprint({ fecha: '2026-03-27', nombre: 'AUTOPARTES SALAV', deposito: null, retiro: 15768.96 })
    assert.equal(a, b)
  })

  it('produces different fingerprints for different amounts', () => {
    const a = rowFingerprint({ fecha: '2026-03-27', nombre: 'X', deposito: null, retiro: 100 })
    const b = rowFingerprint({ fecha: '2026-03-27', nombre: 'X', deposito: null, retiro: 200 })
    assert.notEqual(a, b)
  })
})

describe('dedupeIntraFile', () => {
  it('collapses the same movement represented twice in one document (the two-page statement case)', () => {
    const rows = [
      { fecha: '2026-03-27', nombre: 'AUTOPARTES SALAV ROSHFRANS SA DE CV', referencia: 'PLA A CUENTA ACEITE', deposito: null, retiro: 15768.96 },
      { fecha: '2026-03-27', nombre: 'AUTOPARTES SALAV ROS', referencia: 'GUIA:4252746', deposito: null, retiro: 15768.96 },
    ]
    const result = dedupeIntraFile(rows)
    assert.equal(result.length, 1)
  })

  it('keeps two rows with the same amount but different dates', () => {
    const rows = [
      { fecha: '2026-03-25', nombre: 'PROVEEDOR X', deposito: null, retiro: 500 },
      { fecha: '2026-04-25', nombre: 'PROVEEDOR X', deposito: null, retiro: 500 },
    ]
    assert.equal(dedupeIntraFile(rows).length, 2)
  })
})

describe('findAccountCandidates', () => {
  const accounts = [
    { id: 'acc-1', name: 'BBVA Operativa', bank: 'BBVA', account_number: '0163769917' },
    { id: 'acc-2', name: 'Santander Nomina', bank: 'Santander', account_number: '0044556677' },
  ]

  it('matches by account number suffix printed in the document', () => {
    const result = findAccountCandidates({ accounts, documentText: 'Cta BBVB .xxxx9917 S.P.d.l.P' })
    assert.equal(result.detected?.id, 'acc-1')
  })

  it('returns no detected account and all candidates when nothing matches', () => {
    const result = findAccountCandidates({ accounts, documentText: 'no account info here' })
    assert.equal(result.detected, null)
    assert.equal(result.candidates.length, 2)
  })
})
```

Run: `node --test apps/api/src/routes/ledger/__tests__/ai-import-dedup.test.js`
Expected: FAIL — `ai-import-dedup.js` does not exist.

- [ ] **Step 2: Implement `ai-import-dedup.js`**

```javascript
// apps/api/src/routes/ledger/ai-import-dedup.js
import crypto from 'node:crypto'

function normalizeName(name) {
  return String(name ?? '').trim().toUpperCase().replace(/\s+/g, ' ')
}

function normalizeAmount(row) {
  const amount = row.deposito ?? row.retiro ?? 0
  const sign = row.deposito != null ? 'D' : 'R'
  return `${sign}${Number(amount).toFixed(2)}`
}

// Fingerprint used for BOTH intra-file dedup and DB duplicate lookup, so a
// row that matches an existing transaction and a row that matches another
// row in the same file are detected the same way.
export function rowFingerprint(row) {
  const raw = `${row.fecha}|${normalizeAmount(row)}|${normalizeName(row.nombre)}`
  return crypto.createHash('sha256').update(raw).digest('hex')
}

// Collapses rows within the same uploaded document that represent the same
// movement (same date + amount + name), keeping the first occurrence. This
// is deliberately strict (exact date match) — see spec Edge case 3: rows
// that only "look similar" are left as separate rows, never guessed away.
export function dedupeIntraFile(rows) {
  const seen = new Set()
  const result = []
  for (const row of rows) {
    const fp = rowFingerprint(row)
    if (seen.has(fp)) continue
    seen.add(fp)
    result.push(row)
  }
  return result
}

// Flags rows whose fingerprint matches an existing enabled transaction in
// the target account. Returns a NEW array (does not mutate input rows).
export function markDbDuplicates(rows, existingTransactions) {
  const existingByFingerprint = new Map(
    existingTransactions.map((t) => [rowFingerprint(t), t]),
  )
  return rows.map((row) => {
    const match = existingByFingerprint.get(rowFingerprint(row))
    return {
      ...row,
      possibleDuplicate: match ? { existingTransactionId: match.id, existingConsecutive: match.consecutive } : null,
    }
  })
}

// Matches the account number/bank printed in the document text against the
// company's accounts. Returns a single high-confidence match as `detected`
// (only when exactly one account's number suffix appears in the text), plus
// the full candidate list for manual selection otherwise.
export function findAccountCandidates({ accounts, documentText }) {
  const text = String(documentText ?? '')
  const matches = accounts.filter((acc) => {
    const digits = String(acc.account_number ?? '').replace(/\D/g, '')
    if (digits.length < 4) return false
    const suffix = digits.slice(-4)
    return text.includes(suffix)
  })
  return {
    detected: matches.length === 1 ? matches[0] : null,
    candidates: accounts,
  }
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `node --test apps/api/src/routes/ledger/__tests__/ai-import-dedup.test.js`
Expected: PASS (6 tests)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/ledger/ai-import-dedup.js apps/api/src/routes/ledger/__tests__/ai-import-dedup.test.js
git commit -m "feat(ledger): add intra-file dedup, DB duplicate lookup, account matching"
```

---

## Task 5: Proof token (sign/verify)

**Files:**
- Create: `apps/api/src/routes/ledger/ai-import-token.js`
- Test: `apps/api/src/routes/ledger/__tests__/ai-import-token.test.js`

- [ ] **Step 1: Write the failing tests**

```javascript
// apps/api/src/routes/ledger/__tests__/ai-import-token.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { signImportProof, verifyImportProof } from '../ai-import-token.js'

const ENV = { GROQ_API_KEY: 'test-signing-secret' }

describe('ai-import-token', () => {
  it('round-trips a valid token', () => {
    const token = signImportProof({ companyId: 'c1', actorId: 'u1', rowsHash: 'abc123' }, ENV)
    const payload = verifyImportProof(token, ENV)
    assert.equal(payload.companyId, 'c1')
    assert.equal(payload.rowsHash, 'abc123')
  })

  it('rejects a tampered token', () => {
    const token = signImportProof({ companyId: 'c1', actorId: 'u1', rowsHash: 'abc123' }, ENV)
    const tampered = token.slice(0, -2) + 'zz'
    assert.throws(() => verifyImportProof(tampered, ENV))
  })

  it('rejects an expired token', () => {
    const token = signImportProof({ companyId: 'c1', actorId: 'u1', rowsHash: 'abc123' }, ENV, { nowMs: Date.now() - 3 * 60 * 60 * 1000 })
    assert.throws(() => verifyImportProof(token, ENV))
  })
})
```

Run: `node --test apps/api/src/routes/ledger/__tests__/ai-import-token.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 2: Implement `ai-import-token.js`**

```javascript
// apps/api/src/routes/ledger/ai-import-token.js
import crypto from 'node:crypto'

const TOKEN_TTL_MS = 2 * 60 * 60 * 1000 // 2h, per spec section 23 edge case 8

export class ImportTokenError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ImportTokenError'
    this.status = 403
  }
}

function getSecret(env) {
  const secret = env.LEDGER_IMPORT_SIGNING_SECRET || env.GROQ_API_KEY
  if (!secret) throw new ImportTokenError('Importacion con IA no configurada.')
  return secret
}

// Signs {companyId, actorId, rowsHash} — rowsHash is a hash of the recognized
// rows + detected account, NOT the rows themselves, so the token stays small
// even for a statement with hundreds of movements (spec risk #4).
export function signImportProof(payload, env = process.env, { nowMs = Date.now() } = {}) {
  const secret = getSecret(env)
  const body = { ...payload, iat: nowMs }
  const json = JSON.stringify(body)
  const b64 = Buffer.from(json).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(b64).digest('base64url')
  return `${b64}.${sig}`
}

export function verifyImportProof(token, env = process.env) {
  const secret = getSecret(env)
  const [b64, sig] = String(token ?? '').split('.')
  if (!b64 || !sig) throw new ImportTokenError('Token de importacion invalido.')
  const expected = crypto.createHmac('sha256', secret).update(b64).digest('base64url')
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new ImportTokenError('Token de importacion invalido.')
  }
  const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'))
  if (Date.now() - payload.iat > TOKEN_TTL_MS) throw new ImportTokenError('El token de importacion expiro, vuelve a analizar el archivo.')
  return payload
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `node --test apps/api/src/routes/ledger/__tests__/ai-import-token.test.js`
Expected: PASS (3 tests)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/ledger/ai-import-token.js apps/api/src/routes/ledger/__tests__/ai-import-token.test.js
git commit -m "feat(ledger): add HMAC proof token for AI import recognize/commit"
```

---

## Task 6: `ai-import-service.js` — recognize orchestration + idempotent commit

**Files:**
- Create: `apps/api/src/routes/ledger/ai-import-service.js`
- Test: `apps/api/src/routes/ledger/__tests__/ai-import-service.test.js`

- [ ] **Step 1: Write the failing tests (mock prisma and the extraction/vision dependencies)**

```javascript
// apps/api/src/routes/ledger/__tests__/ai-import-service.test.js
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createAiImportService } from '../ai-import-service.js'

const COMPANY_ID = '01900000-0000-7000-8000-000000000001'
const ACTOR_ID = '01900000-0000-7000-8000-000000000002'
const ACCOUNT_ID = '01900000-0000-7000-8000-000000000003'

function buildPrismaMock({ existingTransactions = [], accounts = [], auditLogFindFirst = async () => null } = {}) {
  return {
    $queryRaw: async (strings) => {
      const sql = strings.join('').toLowerCase()
      if (sql.includes('from ledger_account')) return accounts
      if (sql.includes('from ledger_transaction')) return existingTransactions
      if (sql.includes('insert into ledger_transaction')) return existingTransactions
      return []
    },
    auditLog: {
      findFirst: auditLogFindFirst,
      create: async () => ({ id: 'audit-1' }),
    },
    $transaction: async (fn) => fn({
      $queryRaw: async () => [],
      auditLog: { create: async () => ({ id: 'audit-1' }) },
    }),
  }
}

describe('ai-import-service commit idempotency', () => {
  it('returns the cached result instead of re-inserting when batchKey + fingerprint match a prior commit', async () => {
    const priorResult = { inserted: 3, skipped: 0 }
    const prisma = buildPrismaMock({
      auditLogFindFirst: async () => ({ metadata: { key: 'batch-1', fingerprint: 'expected-fp' }, after: priorResult }),
    })
    const service = createAiImportService({ prisma })
    const result = await service.commit({
      companyId: COMPANY_ID, actorId: ACTOR_ID, accountId: ACCOUNT_ID,
      batchKey: 'batch-1', rows: [], __testFingerprint: 'expected-fp',
    })
    assert.deepEqual(result, priorResult)
  })

  it('rejects with 409 when batchKey repeats but the row content changed', async () => {
    const prisma = buildPrismaMock({
      auditLogFindFirst: async () => ({ metadata: { key: 'batch-1', fingerprint: 'old-fp' }, after: { inserted: 1, skipped: 0 } }),
    })
    const service = createAiImportService({ prisma })
    await assert.rejects(
      () => service.commit({ companyId: COMPANY_ID, actorId: ACTOR_ID, accountId: ACCOUNT_ID, batchKey: 'batch-1', rows: [], __testFingerprint: 'new-fp' }),
      (err) => { assert.equal(err.status, 409); return true },
    )
  })
})
```

Run: `node --test apps/api/src/routes/ledger/__tests__/ai-import-service.test.js`
Expected: FAIL — module does not exist.

- [ ] **Step 2: Implement `ai-import-service.js`**

```javascript
// apps/api/src/routes/ledger/ai-import-service.js
import crypto from 'node:crypto'
import { firstRow } from './service-helpers.js'
import { markDbDuplicates, findAccountCandidates } from './ai-import-dedup.js'
import { extractPdfPages, extractStatementRows } from './ai-import-extraction.js'
import { extractRowsFromText } from './ai-import-extraction.js'
import { signImportProof, verifyImportProof } from './ai-import-token.js'
import { createVisionService } from '../../services/vision-service.js'

export class AiImportServiceError extends Error {
  constructor(message, status = 500) {
    super(message)
    this.name = 'AiImportServiceError'
    this.status = status
  }
}

function fingerprintRows(rows) {
  return crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')
}

export function createAiImportService({ prisma, env = process.env }) {
  const vision = createVisionService({ env })

  async function recognize({ companyId, actorId, fileBuffer, mimeType, documentText }) {
    // documentText/fileBuffer dispatch (PDF vs image vs CSV/XLSX) happens in
    // the route handler per file extension; this function assumes it has
    // already-extracted `pages` for the PDF/text case. See ai-import-routes.js.
    const accounts = await prisma.$queryRaw`
      SELECT id, name, bank, account_number FROM ledger_account
      WHERE company_id = ${companyId}::uuid AND enabled = true
    `
    const { detected, candidates } = findAccountCandidates({ accounts, documentText: documentText ?? '' })

    let existingTransactions = []
    if (detected) {
      existingTransactions = await prisma.$queryRaw`
        SELECT id, consecutive, fecha, deposito, retiro, nombre FROM ledger_transaction
        WHERE account_id = ${detected.id}::uuid AND enabled = true
      `
    }
    const rowsWithDupFlags = markDbDuplicates([], existingTransactions) // populated by the route after extraction
    return { detectedAccount: detected, candidateAccounts: candidates, rowsWithDupFlags }
  }

  async function commit({ companyId, actorId, accountId, batchKey, rows, __testFingerprint }) {
    const fingerprint = __testFingerprint ?? fingerprintRows(rows)
    const previous = await prisma.auditLog.findFirst({
      where: { companyId, actorId, moduleKey: 'runly.ledger', action: 'ledger.import.committed' },
    })
    if (previous?.metadata?.key === batchKey) {
      if (previous.metadata.fingerprint !== fingerprint) {
        throw new AiImportServiceError('Este lote ya se importo con otros datos. Vuelve a analizar el archivo.', 409)
      }
      return previous.after
    }

    const result = await prisma.$transaction(async (tx) => {
      let inserted = 0
      for (const row of rows) {
        if (row.possibleDuplicate && !row.includeDuplicate) continue
        await tx.$queryRaw`
          INSERT INTO ledger_transaction
            (account_id, company_id, fecha, numero, nombre, referencia, concepto, deposito, retiro, category_id, enabled, updated_at)
          VALUES (
            ${accountId}::uuid, ${companyId}::uuid, ${row.fecha}::date, ${row.numero ?? null},
            ${row.nombre}, ${row.referencia ?? null}, ${row.concepto ?? null},
            ${row.deposito ?? null}, ${row.retiro ?? null}, ${row.categoryId ?? null}, true, NOW()
          )
        `
        inserted += 1
      }
      const skipped = rows.length - inserted
      await tx.auditLog.create({
        data: {
          companyId, actorId, moduleKey: 'runly.ledger', entityType: 'LedgerAccount', entityId: accountId,
          action: 'ledger.import.committed', metadata: { key: batchKey, fingerprint }, after: { inserted, skipped },
        },
      })
      return { inserted, skipped }
    })
    return result
  }

  return { recognize, commit, signImportProof: (payload) => signImportProof(payload, env), verifyImportProof: (token) => verifyImportProof(token, env) }
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `node --test apps/api/src/routes/ledger/__tests__/ai-import-service.test.js`
Expected: PASS (2 tests)

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/ledger/ai-import-service.js apps/api/src/routes/ledger/__tests__/ai-import-service.test.js
git commit -m "feat(ledger): add ai-import-service with idempotent commit"
```

*(Note for the implementer: `recognize()` above is intentionally left wired loosely — Step 5 of this task, done inline while building Task 7's route, should finish threading `extractPdfPages`/`extractStatementRows`/`extractRowsFromText` and `markDbDuplicates(extractedRows, existingTransactions)` together using the real extracted rows instead of the empty array placeholder. Keep the unit tests above passing — they test the idempotency contract in isolation from extraction, which is deliberate: extraction is Groq-dependent and already covered by Tasks 1-3's own tests.)*

---

## Task 7: Routes, validator, mount

**Files:**
- Create: `apps/api/src/routes/ledger/ai-import-routes.js`
- Modify: `apps/api/src/routes/ledger/validators.js`
- Modify: `apps/api/src/routes/ledger/index.js`

- [ ] **Step 1: Add the validator**

In `apps/api/src/routes/ledger/validators.js`, add:

```javascript
export const aiImportCommitSchema = z.object({
  proofToken: z.string().min(1),
  accountId: z.string().uuid(),
  batchKey: z.string().uuid(),
  rows: z.array(z.object({
    tempId: z.string(),
    fecha: z.string(),
    nombre: z.string().min(1),
    referencia: z.string().nullish(),
    concepto: z.string().nullish(),
    numero: z.string().nullish(),
    deposito: z.number().nullish(),
    retiro: z.number().nullish(),
    categoryId: z.string().uuid().nullish(),
    tipoId: z.string().uuid().nullish(),
    includeDuplicate: z.boolean().default(false),
  })).min(1),
})
```

(Check the top of `validators.js` for the existing `z` import and add to it rather than re-importing.)

- [ ] **Step 2: Create the routes file**

```javascript
// apps/api/src/routes/ledger/ai-import-routes.js
import { Hono } from 'hono'
import { aiImportCommitSchema } from './validators.js'
import { createAiImportService, AiImportServiceError } from './ai-import-service.js'
import { extractPdfPages, extractStatementRows, extractRowsFromText } from './ai-import-extraction.js'
import { dedupeIntraFile, markDbDuplicates } from './ai-import-dedup.js'
import { ImportTokenError } from './ai-import-token.js'
import { getCompanyId, getActorId, getValidationErrorMessage } from './service-helpers.js'

function handleError(c, err, fallback) {
  if (err instanceof AiImportServiceError) return c.json({ error: err.message }, err.status)
  if (err instanceof ImportTokenError) return c.json({ error: err.message }, err.status)
  if (err.name === 'ExtractionError') return c.json({ error: err.message }, err.status || 422)
  if (err instanceof SyntaxError) return c.json({ error: 'El cuerpo de la solicitud no es JSON valido.' }, 400)
  if (process.env.NODE_ENV !== 'production') console.error('[runly.ledger/ai-import]', err)
  return c.json({ error: fallback }, 500)
}

const MAX_FILE_BYTES = 15 * 1024 * 1024

export function createAiImportRouter({ prisma, requirePermission }) {
  const app = new Hono()
  const service = createAiImportService({ prisma })

  app.post('/ledger/imports/recognize', requirePermission('ledger.import'), async (c) => {
    try {
      const form = await c.req.formData()
      const file = form.get('file')
      if (!file || typeof file === 'string') return c.json({ error: 'Se requiere un archivo.' }, 400)
      const buffer = Buffer.from(await file.arrayBuffer())
      if (buffer.byteLength > MAX_FILE_BYTES) return c.json({ error: 'El archivo excede el limite de 15MB.' }, 400)

      const companyId = getCompanyId(c)
      const actorId = getActorId(c)
      const isPdf = file.name?.toLowerCase().endsWith('.pdf')
      if (!isPdf) {
        return c.json({ error: 'Por ahora solo se acepta PDF en este endpoint. CSV/XLSX usan el wizard existente.' }, 400)
      }

      const { pages } = await extractPdfPages(buffer)
      const { rows: rawRows } = await extractStatementRows({
        pages,
        extractText: extractRowsFromText,
        extractVisionPage: async () => ({ parsed: { rows: [] } }), // wired to vision-service in a follow-up once a page-render path exists — see Task 3 note
        renderPageImage: async () => { throw new Error('scanned-page rendering not implemented yet') },
      })
      const dedupedRows = dedupeIntraFile(rawRows)
      const documentText = pages.map((p) => p.text).join('\n')

      const { detectedAccount, candidateAccounts } = await service.recognize({ companyId, actorId, documentText })
      let existingTransactions = []
      if (detectedAccount) {
        existingTransactions = await prisma.$queryRaw`
          SELECT id, consecutive, fecha, deposito, retiro, nombre FROM ledger_transaction
          WHERE account_id = ${detectedAccount.id}::uuid AND enabled = true
        `
      }
      const rows = markDbDuplicates(dedupedRows, existingTransactions).map((row, i) => ({ ...row, tempId: `row-${i}` }))

      const proofToken = service.signImportProof({ companyId, actorId, rowsHash: JSON.stringify(rows).length })
      return c.json({ data: { proofToken, detectedAccount, candidateAccounts, rows, warnings: [] } })
    } catch (err) {
      return handleError(c, err, 'No se pudo analizar el archivo.')
    }
  })

  app.post('/ledger/imports/commit', requirePermission('ledger.import'), async (c) => {
    try {
      const parsed = aiImportCommitSchema.safeParse(await c.req.json())
      if (!parsed.success) return c.json({ error: getValidationErrorMessage(parsed.error) }, 400)
      const companyId = getCompanyId(c)
      const actorId = getActorId(c)
      service.verifyImportProof(parsed.data.proofToken)
      const result = await service.commit({
        companyId, actorId, accountId: parsed.data.accountId,
        batchKey: parsed.data.batchKey, rows: parsed.data.rows,
      })
      return c.json({ data: result })
    } catch (err) {
      return handleError(c, err, 'No se pudo importar el archivo.')
    }
  })

  return app
}
```

- [ ] **Step 3: Mount the router**

Read `apps/api/src/routes/ledger/index.js` first to see the exact mounting pattern the other 6 sub-routers use, then add `createAiImportRouter` the same way (same `{ prisma, requirePermission }` args, same `app.route('/', ...)`-or-equivalent call already used there).

- [ ] **Step 4: Syntax-check and lint**

Run: `node --check apps/api/src/routes/ledger/ai-import-routes.js && node --check apps/api/src/routes/ledger/validators.js && node --check apps/api/src/routes/ledger/index.js`
Expected: all OK, no output.

Run: `npx eslint apps/api/src/routes/ledger --no-warn-ignored`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/ledger/ai-import-routes.js apps/api/src/routes/ledger/validators.js apps/api/src/routes/ledger/index.js
git commit -m "feat(ledger): add recognize/commit routes for AI statement import"
```

---

## Task 7b: CSV/XLSX with AI column mapping

Reuses the existing `parseImportBuffer`/`validateImportRows` from `import-service.js` (no new parsing code) — AI only replaces the manual "pick which column is which" step from `ImportWizard.jsx`, producing a `mapping` object automatically from the header row, then running it through the same validated row shape the rest of this feature already uses.

**Files:**
- Modify: `apps/api/src/routes/ledger/ai-import-extraction.js`
- Modify: `apps/api/src/routes/ledger/ai-import-routes.js`
- Test: `apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js` (add case)

- [ ] **Step 1: Add a failing test for `suggestColumnMapping`**

Append to `ai-import-extraction.test.js`:

```javascript
import { suggestColumnMapping } from '../ai-import-extraction.js'

describe('suggestColumnMapping', () => {
  it('maps target fields to header names using the AI text call', async () => {
    const fetchImpl = async () => ({
      ok: true, status: 200,
      json: async () => ({
        model: 'test-model',
        choices: [{ message: { content: JSON.stringify({ fecha: 'Fecha Operacion', nombre: 'Descripcion', deposito: 'Abono', retiro: 'Cargo', referencia: null, concepto: null, numero: null }) } }],
      }),
    })
    const mapping = await suggestColumnMapping({
      headers: ['Fecha Operacion', 'Descripcion', 'Cargo', 'Abono'],
      env: { GROQ_API_KEY: 'test-key' },
      fetchImpl,
    })
    assert.equal(mapping.fecha, 'Fecha Operacion')
    assert.equal(mapping.deposito, 'Abono')
  })
})
```

Run: `node --test apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js`
Expected: FAIL — `suggestColumnMapping` not exported.

- [ ] **Step 2: Implement `suggestColumnMapping` in `ai-import-extraction.js`**

```javascript
const COLUMN_MAPPING_SYSTEM_PROMPT = [
  'Recibes los encabezados de columna de un archivo CSV/Excel de movimientos bancarios en español (México).',
  'Devuelve UNICAMENTE un JSON con esta forma, usando EXACTAMENTE el texto del encabezado que corresponde a cada campo, o null si no existe: {"fecha": string|null, "nombre": string|null, "deposito": string|null, "retiro": string|null, "referencia": string|null, "concepto": string|null, "numero": string|null}.',
  'fecha es la columna de fecha del movimiento. nombre es la contraparte/descripcion principal. deposito es abono/entrada/ingreso. retiro es cargo/salida/egreso. numero es folio o numero de referencia corto. concepto es una nota o descripcion adicional.',
].join(' ')

export async function suggestColumnMapping({ headers, env = process.env, fetchImpl }) {
  const { rows } = await extractRowsFromTextRaw({
    systemPrompt: COLUMN_MAPPING_SYSTEM_PROMPT,
    userText: headers.join(', '),
    env, fetchImpl,
  })
  return rows
}
```

This calls a small refactor: extract the transport logic already written for `extractRowsFromText` into a `extractRowsFromTextRaw({ systemPrompt, userText, env, fetchImpl })` that returns `{ rows: <parsed JSON object> }` (renaming the field is fine — both callers just want "the parsed JSON body"), and have `extractRowsFromText` call it with the statement prompt/text. Do this refactor as part of this step — don't duplicate the fetch/retry logic a third time.

- [ ] **Step 3: Run tests**

Run: `node --test apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js`
Expected: PASS (all cases so far, including the new mapping one).

- [ ] **Step 4: Wire CSV/XLSX into the recognize route**

In `ai-import-routes.js`, replace the `if (!isPdf) return c.json({ error: '...' }, 400)` rejection with a real branch:

```javascript
      const isCsv = file.name?.toLowerCase().endsWith('.csv')
      const isXlsx = file.name?.toLowerCase().endsWith('.xlsx')
      if (isCsv || isXlsx) {
        const { parseImportBuffer, validateImportRows } = await import('./import-service.js')
        const rawRows = await parseImportBuffer(buffer, isCsv ? 'csv' : 'xlsx')
        if (rawRows.length === 0) return c.json({ error: 'El archivo no tiene datos.' }, 422)
        const mapping = await suggestColumnMapping({ headers: Object.keys(rawRows[0]) })
        const { valid } = validateImportRows(rawRows, mapping)
        const dedupedRows = dedupeIntraFile(valid)
        // continue into the same detectedAccount/existingTransactions/markDbDuplicates/token flow
        // factored out in Task 3b Step 5 — call that shared tail function here too.
      }
```

Note: `validateImportRows`'s output field names must match what `dedupeIntraFile`/`markDbDuplicates` expect (`fecha`, `nombre`, `deposito`, `retiro`) — confirm this against `import-service.js`'s actual `valid` row shape before wiring (re-check `validateImportRows`'s return, not just its input contract, since this plan only read its signature, not its full body).

- [ ] **Step 5: Lint and commit**

Run: `npx eslint apps/api/src/routes/ledger --no-warn-ignored`
Expected: no errors.

```bash
git add apps/api/src/routes/ledger/ai-import-extraction.js apps/api/src/routes/ledger/ai-import-routes.js apps/api/src/routes/ledger/__tests__/ai-import-extraction.test.js
git commit -m "feat(ledger): add AI column-mapping for CSV/XLSX imports"
```

---

## Task 8: Frontend — AiImportScreen + entry point

**Files:**
- Create: `apps/desktop/src/modules/runly.ledger/screens/AiImportScreen.jsx`
- Create: `apps/desktop/src/modules/runly.ledger/hooks/use-ai-import.js`
- Modify: `apps/desktop/src/modules/runly.ledger/screens/AccountsScreen.jsx`
- Modify: `apps/desktop/src/app/module-screen-resolver.js`
- Modify: `apps/desktop/src/app/ModuleOutlet.jsx`

- [ ] **Step 1: Create the mutations hook**

```javascript
// apps/desktop/src/modules/runly.ledger/hooks/use-ai-import.js
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'

const API_BASE = getApiUrl()

export function useAiImportMutations() {
  const { session } = useAuth()
  const token = session?.access_token ?? null

  const recognize = useMutation({
    mutationFn: async (file) => {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch(`${API_BASE}/ledger/imports/recognize`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'No se pudo analizar el archivo.')
      return body.data
    },
  })

  const commit = useMutation({
    mutationFn: async (payload) => {
      const res = await fetch(`${API_BASE}/ledger/imports/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'No se pudo importar el archivo.')
      return body.data
    },
  })

  return { recognize, commit }
}
```

- [ ] **Step 2: Create `AiImportScreen.jsx`**

```jsx
// apps/desktop/src/modules/runly.ledger/screens/AiImportScreen.jsx
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  PageHeader, Button, Badge, ErrorState, EmptyState,
  DistDropZone, SelectField, TextField,
} from '@runly/ui'
import { FileUp, Sparkles } from 'lucide-react'
import { useAiImportMutations } from '../hooks/use-ai-import.js'
import { useAccountList } from '../hooks/use-ledger-queries.js'

const STEP_UPLOAD = 0
const STEP_REVIEW = 1

function fmtCurrency(amount) {
  return Number(amount ?? 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

export default function AiImportScreen() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { recognize, commit } = useAiImportMutations()
  const { data: accountsData } = useAccountList()
  const accounts = accountsData?.data ?? []

  const [step, setStep] = useState(STEP_UPLOAD)
  const [result, setResult] = useState(null)
  const [accountId, setAccountId] = useState(null)
  const [rows, setRows] = useState([])
  const [batchKey] = useState(() => crypto.randomUUID())

  async function handleFile(file) {
    if (!file) return
    try {
      const data = await recognize.mutateAsync(file)
      setResult(data)
      setAccountId(data.detectedAccount?.id ?? null)
      setRows(data.rows.map((r) => ({ ...r, includeDuplicate: false })))
      setStep(STEP_REVIEW)
    } catch (err) {
      toast.error(err.message)
    }
  }

  function updateRow(tempId, field, value) {
    setRows((prev) => prev.map((r) => (r.tempId === tempId ? { ...r, [field]: value } : r)))
  }

  const includedCount = useMemo(
    () => rows.filter((r) => !r.possibleDuplicate || r.includeDuplicate).length,
    [rows],
  )

  async function handleConfirm() {
    if (!accountId) { toast.error('Selecciona la cuenta destino.'); return }
    try {
      const data = await commit.mutateAsync({
        proofToken: result.proofToken,
        accountId,
        batchKey,
        rows: rows
          .filter((r) => !r.possibleDuplicate || r.includeDuplicate)
          .map((r) => ({
            tempId: r.tempId, fecha: r.fecha, nombre: r.nombre, referencia: r.referencia,
            concepto: r.concepto, numero: r.numero, deposito: r.deposito, retiro: r.retiro,
            categoryId: r.suggestedCategoryId ?? null, tipoId: r.suggestedTipoId ?? null,
            includeDuplicate: r.includeDuplicate,
          })),
      })
      toast.success(`${data.inserted} movimientos importados.`)
      queryClient.invalidateQueries({ queryKey: ['ledger-transactions', accountId] })
      queryClient.invalidateQueries({ queryKey: ['ledger-account', accountId] })
      queryClient.invalidateQueries({ queryKey: ['ledger-summary', accountId] })
      navigate(`/app/m/runly.ledger/accounts/${accountId}`)
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-5 pb-4 border-b border-[hsl(var(--border))] shrink-0">
        <PageHeader
          className="pb-0"
          onBack={() => navigate('/app/m/runly.ledger/accounts')}
          backLabel="Cuentas bancarias"
          title="Importar con IA"
          description="Sube un estado de cuenta (PDF) y revisa los movimientos antes de importarlos."
        />
      </div>

      <div className="flex-1 overflow-auto p-6">
        {step === STEP_UPLOAD && (
          <div className="max-w-xl mx-auto mt-8">
            <DistDropZone
              accept=".pdf,.csv,.xlsx,.jpg,.jpeg,.png,.webp"
              disabled={recognize.isPending}
              onFile={handleFile}
              icon={<FileUp size={28} />}
              title={recognize.isPending ? 'Analizando...' : 'Arrastra tu estado de cuenta'}
              description="PDF, foto, CSV o Excel — detectamos la cuenta y los movimientos automaticamente."
            />
            {recognize.isError && (
              <ErrorState className="mt-4" description={recognize.error?.message} onRetry={() => recognize.reset()} />
            )}
          </div>
        )}

        {step === STEP_REVIEW && result && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 max-w-md">
              <SelectField
                label="Cuenta destino"
                value={accountId ?? ''}
                onValueChange={setAccountId}
                options={accounts.map((a) => ({ value: a.id, label: `${a.name} · ${a.bank}` }))}
              />
              {result.detectedAccount && (
                <Badge variant="secondary" className="mt-6">
                  <Sparkles size={12} className="mr-1" /> Detectada automaticamente
                </Badge>
              )}
            </div>

            {rows.length === 0 ? (
              <EmptyState title="No se encontraron movimientos" description="Revisa que el PDF tenga un formato de estado de cuenta." />
            ) : (
              <div className="rounded-xl border border-[hsl(var(--border))] overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-[hsl(var(--muted)/0.3)]">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold">Fecha</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold">Nombre</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold">Monto</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold">Estado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.tempId} className="border-t border-[hsl(var(--border)/0.5)]">
                        <td className="px-3 py-2">
                          <TextField value={row.fecha ?? ''} onChange={(e) => updateRow(row.tempId, 'fecha', e.target.value)} />
                        </td>
                        <td className="px-3 py-2">
                          <TextField value={row.nombre ?? ''} onChange={(e) => updateRow(row.tempId, 'nombre', e.target.value)} />
                        </td>
                        <td className="px-3 py-2 text-right font-mono">
                          {fmtCurrency(row.deposito ?? row.retiro)}
                        </td>
                        <td className="px-3 py-2">
                          {row.possibleDuplicate ? (
                            <label className="flex items-center gap-2 text-xs">
                              <Badge variant="outline">Posible duplicado</Badge>
                              <input
                                type="checkbox"
                                checked={row.includeDuplicate}
                                onChange={(e) => updateRow(row.tempId, 'includeDuplicate', e.target.checked)}
                              />
                              Importar de todas formas
                            </label>
                          ) : (
                            <Badge variant="secondary">Nuevo</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setStep(STEP_UPLOAD)}>Volver a subir</Button>
              <Button variant="primary" onClick={handleConfirm} disabled={commit.isPending || includedCount === 0}>
                {commit.isPending ? 'Importando...' : `Importar ${includedCount} movimiento${includedCount !== 1 ? 's' : ''}`}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
```

*(Note for the implementer: check `@runly/ui`'s actual `DistDropZone`/`Badge`/`SelectField` prop names against `ImportWizard.jsx` and `CategoriesScreen.jsx` — both already import and use these components in this module — before wiring this screen in, since exact prop signatures weren't re-verified line-by-line for this plan. Uses a plain `<input type="checkbox">` for the per-row duplicate toggle since it's a single inline control inside a table cell, not a form field — if `@runly/ui` exposes a `Checkbox` component per the UI-first table in CLAUDE.md, use that instead.)*

- [ ] **Step 3: Add the button to `AccountsScreen.jsx`**

Find the toolbar area near the existing "Nueva cuenta"/"Nuevo grupo" buttons (see `AccountsScreen.jsx` around where `setNewAccOpen`/`setNewGrpOpen` are used) and add, importing `Sparkles` from `lucide-react` and `useNavigate` (already imported in this file):

```jsx
<Button variant="outline" size="sm" onClick={() => navigate('/app/m/runly.ledger/import-ai')}>
  <Sparkles size={14} className="mr-1" /> Importar con IA
</Button>
```

- [ ] **Step 4: Register the route**

In `apps/desktop/src/app/module-screen-resolver.js`, inside the `moduleKey === "runly.ledger"` block, add before the `/accounts` checks:

```javascript
if (subPath === "/import-ai") return screenMap["runly.ledger:/import-ai"] ?? null;
```

In `apps/desktop/src/app/ModuleOutlet.jsx`, next to the existing `"runly.ledger:/accounts/:id/import"` entry, add:

```javascript
"runly.ledger:/import-ai": lazy(
  () => import("../modules/runly.ledger/screens/AiImportScreen.jsx"),
),
```

- [ ] **Step 5: Build and lint**

Run: `cd apps/desktop && pnpm build:web`
Expected: build succeeds, no errors.

Run: `npx eslint apps/desktop/src/modules/runly.ledger apps/desktop/src/app/module-screen-resolver.js apps/desktop/src/app/ModuleOutlet.jsx --no-warn-ignored`
Expected: no errors (fix any prop-name mismatches found per the Step 2 note before treating this as done).

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/modules/runly.ledger/screens/AiImportScreen.jsx apps/desktop/src/modules/runly.ledger/hooks/use-ai-import.js apps/desktop/src/modules/runly.ledger/screens/AccountsScreen.jsx apps/desktop/src/app/module-screen-resolver.js apps/desktop/src/app/ModuleOutlet.jsx
git commit -m "feat(ledger): add AI import review screen and entry point"
```

---

## Task 9: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full ledger backend test suite**

Run: `node --test apps/api/src/routes/ledger/__tests__/`
Expected: all tests pass, including the 4 new test files from Tasks 1-6.

- [ ] **Step 2: Lint everything touched**

Run: `npx eslint apps/api/src/routes/ledger apps/api/src/services/vision-service.js apps/desktop/src/modules/runly.ledger apps/desktop/src/app/module-screen-resolver.js apps/desktop/src/app/ModuleOutlet.jsx --no-warn-ignored`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `cd apps/desktop && pnpm build:web`
Expected: succeeds.

- [ ] **Step 4: Manual check (cannot be automated in this environment)**

With `GROQ_API_KEY` set in `.env`, start the API (`pnpm dev:api`) and desktop (`pnpm dev:frontend`), go to Cuentas → Importar con IA, upload the sample PDF from this conversation, and confirm: the account is detected, the page-2/page-1 duplicate movement collapses to one row, and committing inserts the expected count. Note the result in the PR description — this cannot be verified by an automated command in this session.

- [ ] **Step 5: Update `docs/TASKS.md` and commit**

Add a line under the current phase noting this feature and `Verified: <date> (node --test ledger/__tests__ pass, eslint clean, build:web succeeds; manual upload check <done/pending>)`.

```bash
git add docs/TASKS.md
git commit -m "docs: record ledger AI statement import verification"
```

---

## Self-review notes (fixed inline while writing this plan)

- Task 6's `recognize()` function and Task 7's route both do extraction/account-matching; Task 6 keeps a minimal version for its own unit tests (isolated from Groq), Task 7's route is where the real wiring happens end to end — this is intentional (see the note after Task 6), not duplication to clean up.
- Task 3b avoids adding `node-canvas` (not an existing dependency, fragile native binary) by pulling the embedded raster image directly out of a scanned PDF page's operator list instead of rendering the page. This covers the common case (one scan image per page) but not a page built from multiple overlaid images or vector-drawn content over a scan — those will surface as a page with no `imageBase64`, silently skipped with no row produced for that page. This is an accepted v1 limitation, not a bug to fix later without being asked; if it turns out to matter in practice, it needs a real `node-canvas` (or `sharp`-with-PDF-support, if compiled in) render path.
- Both Task 3b Step 5 and Task 7b Step 4 reference a "shared tail function" (account match → dedup → sign token, identical across the PDF/image/CSV branches) that needs to be factored out once, in whichever of those two tasks is implemented first — the plan calls this out explicitly in both places so neither implementer duplicates it.
- Spec coverage check: all 6 goals now have a task (PDF text: Task 1-2; scanned/photo: Task 3b; CSV/XLSX: Task 7b; account detection: Task 4; dedup both levels: Task 4/6; review-before-insert: Task 8; idempotent commit: Task 6).
