import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { bugReportSchema, ALLOWED_ATTACHMENT_MIME_TYPES } from '../index.js'

function validAttachment(overrides = {}) {
  return {
    filename: 'log.txt',
    mimeType: 'text/plain',
    dataUrl: `data:text/plain;base64,${'A'.repeat(100)}`,
    ...overrides,
  }
}

describe('bugReportSchema attachments', () => {
  it('accepts a report with no attachments', () => {
    const result = bugReportSchema.safeParse({ context: '/app/home' })
    assert.equal(result.success, true)
  })

  it('accepts up to 3 valid attachments', () => {
    const result = bugReportSchema.safeParse({
      attachments: [
        validAttachment(),
        validAttachment({ filename: 'b.txt' }),
        validAttachment({ filename: 'c.txt' }),
      ],
    })
    assert.equal(result.success, true)
  })

  it('rejects a 4th attachment', () => {
    const result = bugReportSchema.safeParse({
      attachments: [
        validAttachment(),
        validAttachment({ filename: 'b.txt' }),
        validAttachment({ filename: 'c.txt' }),
        validAttachment({ filename: 'd.txt' }),
      ],
    })
    assert.equal(result.success, false)
  })

  it('rejects a disallowed mime type', () => {
    const result = bugReportSchema.safeParse({
      attachments: [
        validAttachment({
          mimeType: 'application/x-msdownload',
          dataUrl: 'data:application/x-msdownload;base64,AA==',
        }),
      ],
    })
    assert.equal(result.success, false)
  })

  it('rejects a filename containing control characters', () => {
    const result = bugReportSchema.safeParse({
      attachments: [validAttachment({ filename: 'log\n.txt' })],
    })
    assert.equal(result.success, false)
  })

  it('rejects a dataUrl that does not match its declared mimeType', () => {
    const result = bugReportSchema.safeParse({
      attachments: [validAttachment({ mimeType: 'text/plain', dataUrl: 'data:image/png;base64,AA==' })],
    })
    assert.equal(result.success, false)
  })

  it('rejects an attachment over the per-file size cap', () => {
    const result = bugReportSchema.safeParse({
      attachments: [validAttachment({ dataUrl: `data:text/plain;base64,${'A'.repeat(7_000_001)}` })],
    })
    assert.equal(result.success, false)
  })

  it('accepts an attachment at exactly the per-file size cap', () => {
    const prefix = 'data:text/plain;base64,'
    const result = bugReportSchema.safeParse({
      attachments: [validAttachment({ dataUrl: prefix + 'A'.repeat(7_000_000 - prefix.length) })],
    })
    assert.equal(result.success, true)
  })

  it('rejects when combined screenshot + attachments exceed the total cap', () => {
    // Each attachment is exactly at the 7,000,000-char per-file cap (individually
    // compliant on its own — this is NOT what rejects the request). Three of them
    // sum to 21,000,000, which is under the 22,000,000 total cap by itself (that's
    // the whole point of the per-file/total cap relationship). Adding a 2,000,000-char
    // screenshot (also individually compliant, under the 3,000,000 screenshot cap)
    // pushes the combined total to 23,000,000 — only THAT crosses the
    // 22,000,000-char total cap, isolating the superRefine check from the
    // per-file checks.
    const prefix = 'data:text/plain;base64,'
    const maxAttachment = () => validAttachment({ dataUrl: prefix + 'A'.repeat(7_000_000 - prefix.length) })
    const result = bugReportSchema.safeParse({
      screenshot: `data:image/png;base64,${'A'.repeat(2_000_000)}`,
      attachments: [
        maxAttachment(),
        { ...maxAttachment(), filename: 'b.txt' },
        { ...maxAttachment(), filename: 'c.txt' },
      ],
    })
    assert.equal(result.success, false)
  })

  it('exports the allowlist for the frontend picker to mirror', () => {
    assert.ok(ALLOWED_ATTACHMENT_MIME_TYPES.has('application/pdf'))
    assert.ok(!ALLOWED_ATTACHMENT_MIME_TYPES.has('application/x-msdownload'))
  })
})
