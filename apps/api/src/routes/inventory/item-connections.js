// Inventory side of Connections (spec 2026-10-03-rme3-module-platform-v2 §12.2):
// the item form sends `connections` with the item; this validates every
// section before anything is written and returns the afterWrite hook that
// inventory-service runs inside the item's own transaction (atomic save, D3).
import { createConnectionReadService } from "../../services/connections/connection-read-service.js";
import { ConnectionWriteError, createConnectionWriteService } from "../../services/connections/connection-write-service.js";

const TARGET_TYPE = "inventory_item";

export function createItemConnections({ prisma }) {
  const writes = createConnectionWriteService({ prisma });
  const reads = createConnectionReadService({ prisma });

  // Splits `connections` off the body. Returns { data, afterWrite } where
  // afterWrite is null when the body carries no connection sections.
  async function prepare(c, body, targetId = null) {
    const { connections, ...data } = body ?? {};
    if (!connections || typeof connections !== "object" || !Object.keys(connections).length) return { data, afterWrite: null };
    const companyId = c.get("companyId");
    const user = c.get("userContext");
    const { writes: pending } = await writes.validateConnectionWrites({ companyId, targetType: TARGET_TYPE, targetId, payload: connections, user });
    if (!pending.length) return { data, afterWrite: null };
    const afterWrite = (tx, item) => writes.applyConnectionWrites(tx, {
      companyId, targetId: item.id, writes: pending, actorId: c.get("userId") ?? null,
    });
    return { data, afterWrite };
  }

  // Item ids whose connected searchable fields match the list search.
  function searchIds(c, search) {
    if (!search) return Promise.resolve([]);
    return reads.searchTargetIds({ companyId: c.get("companyId"), targetType: TARGET_TYPE, term: search, user: c.get("userContext") })
      .catch((error) => {
        console.error("[inventory] connection search failed:", error?.message);
        return [];
      });
  }

  function errorResponse(c, error) {
    if (!(error instanceof ConnectionWriteError)) return null;
    return c.json({ error: error.message, code: error.code, fields: error.fields ?? null, connectionId: error.connectionId ?? null }, error.status);
  }

  return { prepare, searchIds, errorResponse };
}
