// Core-module side of Connections (spec 2026-10-03-rme3-module-platform-v2
// §12.2), shared by every connectable core module (inventory, contacts, hr,
// projects...). A core route uses it in three places:
//   - save: prepare() splits `connections` off the body, validates every
//     section BEFORE anything is written and returns the afterWrite(tx, record)
//     hook the core service runs inside its own transaction (atomic save, D3);
//   - list search: searchIds() -> record ids matched by connected fields;
//   - hard delete: restrictResponse() turns the FK error of a `restrict`
//     related connection into a 409 naming the blocking module.
import { createConnectionReadService } from "./connection-read-service.js";
import { ConnectionWriteError, createConnectionWriteService, mapRestrictViolation } from "./connection-write-service.js";

export function createCoreTargetConnections({ prisma, targetType }) {
  const writes = createConnectionWriteService({ prisma });
  const reads = createConnectionReadService({ prisma });

  // Returns { data, afterWrite }; afterWrite is null when the body carries no
  // connection sections (the core save then runs exactly as before).
  async function prepare(c, body, targetId = null) {
    const { connections, ...data } = body ?? {};
    if (!connections || typeof connections !== "object" || !Object.keys(connections).length) return { data, afterWrite: null };
    const companyId = c.get("companyId");
    const user = c.get("userContext");
    const { writes: pending } = await writes.validateConnectionWrites({ companyId, targetType, targetId, payload: connections, user });
    if (!pending.length) return { data, afterWrite: null };
    const afterWrite = (tx, record) => writes.applyConnectionWrites(tx, {
      companyId, targetId: record.id, writes: pending, actorId: c.get("userId") ?? null,
    });
    return { data, afterWrite };
  }

  // Record ids whose connected searchable fields match the list search.
  function searchIds(c, search) {
    if (!search) return Promise.resolve([]);
    return reads.searchTargetIds({ companyId: c.get("companyId"), targetType, term: search, user: c.get("userContext") })
      .catch((error) => {
        console.error(`[connections:${targetType}] search failed:`, error?.message);
        return [];
      });
  }

  function errorResponse(c, error) {
    if (!(error instanceof ConnectionWriteError)) return null;
    return c.json({ error: error.message, code: error.code, fields: error.fields ?? null, connectionId: error.connectionId ?? null }, error.status);
  }

  // 409 when a hard delete hit a `restrict` connection; null otherwise.
  async function restrictResponse(c, error, targetIds) {
    const mapped = await mapRestrictViolation(prisma, error, { companyId: c.get("companyId"), targetIds }).catch(() => null);
    if (!mapped) return null;
    const detail = mapped.connections.map((entry) => `${entry.count} en ${entry.label}`).join(", ");
    return c.json({
      error: detail ? `No se puede eliminar: tiene registros relacionados (${detail}).` : "No se puede eliminar: tiene registros relacionados en otro módulo.",
      code: mapped.code,
      connections: mapped.connections,
    }, 409);
  }

  return { prepare, searchIds, errorResponse, restrictResponse };
}
