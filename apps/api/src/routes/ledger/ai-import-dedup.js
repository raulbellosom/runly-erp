import crypto from 'node:crypto'

function normalizeAmount(row) {
  const amount = row.deposito ?? row.retiro ?? 0
  const sign = row.deposito != null ? 'D' : 'R'
  return `${sign}${Number(amount).toFixed(2)}`
}

// Freshly-extracted rows carry fecha as an ISO string ("2026-03-27"). Rows
// read back from the DB via $queryRaw (ledger_transaction.fecha is
// @db.Date) come back as a JS Date instead — without normalizing both to
// the same string shape, markDbDuplicates would compare an ISO string
// against a Date's default toString() and never match, silently defeating
// duplicate detection against existing transactions. Same pattern already
// used in summary-service.js for the same @db.Date column.
function normalizeFecha(fecha) {
  // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: @db.Date row value
  return fecha instanceof Date ? fecha.toISOString().slice(0, 10) : String(fecha).slice(0, 10)
}

// Fingerprint used for BOTH intra-file dedup and DB duplicate lookup, so a
// row that matches an existing transaction and a row that matches another
// row in the same file are detected the same way.
//
// Deliberately keyed on date+amount only, NOT the name/reference text. The
// motivating real-world case (see spec) is the same movement printed twice
// in one document under two different report formats — an official ledger
// table with the full legal name ("AUTOPARTES SALAV ROSHFRANS SA DE CV")
// and an app-style transaction detail with an abbreviated one ("AUTOPARTES
// SALAV ROS"). Those never match on exact (or even normalized) name text,
// so including the name in the fingerprint would silently miss the exact
// case this feature exists to catch. The tradeoff is accepted deliberately:
// two genuinely different movements that happen to share a date and an
// exact amount will also collide here — but per spec, a fingerprint match
// only sets a "possible duplicate" flag that always requires the user's
// explicit confirmation before being excluded, so a false positive costs a
// click, never a silently dropped or silently duplicated transaction.
export function rowFingerprint(row) {
  const raw = `${normalizeFecha(row.fecha)}|${normalizeAmount(row)}`
  return crypto.createHash('sha256').update(raw).digest('hex')
}

// A row is only usable if it has SOME identity (a date or a name — anything
// else is extraction noise, not a real movement) and exactly one of
// deposito/retiro set (the extraction prompts all ask for exactly one, but
// a model — or a CSV row that happens to map into both columns — can still
// violate that, so this is a defensive check applied uniformly to every
// ingestion path: PDF, direct image upload, and CSV/XLSX, since all three
// funnel through dedupeIntraFile as the first step of the shared recognize
// pipeline).
export function isValidRow(row) {
  if (!row.fecha && !row.nombre) return false
  const hasDeposito = row.deposito != null
  const hasRetiro = row.retiro != null
  return hasDeposito !== hasRetiro // exactly one set, never both, never neither
}

// Drops invalid rows (see isValidRow), then collapses rows within the same
// uploaded document that represent the same movement (same date + amount),
// keeping the first occurrence. This is deliberately strict on date (exact
// match) — rows that only "look similar" are left as separate rows, never
// guessed away.
export function dedupeIntraFile(rows) {
  const seen = new Set()
  const result = []
  for (const row of rows) {
    if (!isValidRow(row)) continue
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
