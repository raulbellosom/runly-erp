// Runs a core record write and, when given, afterWrite(tx, record) in ONE
// transaction (connection sections saved with the core record, spec
// 2026-10-03-rme3-module-platform-v2 D3). Without afterWrite it is exactly
// op(prisma) — no transaction added, no behavior change.
export async function withAfterWrite(prisma, afterWrite, op) {
  if (!afterWrite) return op(prisma)
  return prisma.$transaction(async (tx) => {
    const record = await op(tx)
    await afterWrite(tx, record)
    return record
  }, { timeout: 30_000 })
}
