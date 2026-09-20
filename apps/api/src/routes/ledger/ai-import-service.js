import crypto from 'node:crypto'
import { markDbDuplicates, findAccountCandidates } from './ai-import-dedup.js'
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

  async function recognize({ companyId, documentText }) {
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
    return { detectedAccount: detected, candidateAccounts: candidates, existingTransactions }
  }

  async function commit({ companyId, actorId, accountId, batchKey, rows, __testFingerprint }) {
    const fingerprint = __testFingerprint ?? fingerprintRows(rows)
    // Filtered by metadata.key at the query level (not just fetched-then-compared
    // in JS): an actor who has committed other import batches before would
    // otherwise get an unrelated audit-log row back from a plain findFirst,
    // making this idempotency check silently miss the real duplicate-commit
    // case — see review note on this task.
    const previous = await prisma.auditLog.findFirst({
      where: {
        companyId, actorId, moduleKey: 'runly.ledger', action: 'ledger.import.committed',
        metadata: { path: ['key'], equals: batchKey },
      },
    })
    if (previous) {
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

  return {
    recognize,
    commit,
    markDbDuplicates,
    signImportProof: (payload) => signImportProof(payload, env),
    verifyImportProof: (token) => verifyImportProof(token, env),
    vision,
  }
}
