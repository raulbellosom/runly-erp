// apps/api/src/routes/pfm/mirai-actions.js
//
// runly.pfm actions MirAI can propose (spec 2026-09-30-mirai-pfm-capability §2).
// prepare() validates and resolves wallet/category names -> ids without
// writing; execute() goes through movements-service, exactly like the HTTP
// routes. Movements registered against bank-linked wallets are rejected: those
// mirror a ledger account and must go through Libro de cuentas instead.
import { z } from "zod";
import { toLocalIso } from "@runly/core";
import { createMovementSchema, updateMovementSchema } from "./validators.js";

const LINK = "/app/m/runly.pfm";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BANK_LINKED_MSG = "Esta cartera refleja una cuenta bancaria; registra el movimiento en Libro de cuentas.";

const createArgs = z.object({
  wallet: z.string().trim().min(1).max(120).optional(),
  direction: z.enum(["EXPENSE", "INCOME"]),
  amount: z.number().positive(),
  occurredOn: z.string().optional(),
  category: z.string().trim().min(1).max(80).optional(),
  merchant: z.string().trim().max(160).optional(),
  note: z.string().trim().max(500).optional(),
});
const updateArgs = z.object({
  movementId: z.string().min(1),
  direction: z.enum(["EXPENSE", "INCOME"]).optional(),
  amount: z.number().positive().optional(),
  occurredOn: z.string().optional(),
  category: z.string().trim().max(80).optional(),
  merchant: z.string().trim().max(160).optional(),
  note: z.string().trim().max(500).optional(),
});
const deleteArgs = z.object({ movementId: z.string().min(1) });

const pctx = (actx) => ({ companyId: actx.companyId, actorId: actx.actorProfileId });
const money = (amount, currency) =>
  `$${Number(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

function dayKey(value) {
  // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: @db.Date occurredOn
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

export function createPfmMiraiActions({ wallets, movements, categories }) {
  async function resolveWallet(actx, query) {
    const list = (await wallets.listWallets(pctx(actx))).data ?? [];
    if (!list.length) return { error: "No tienes carteras. Abre Finanzas personales para crear una." };
    if (query) {
      const byId = UUID_RE.test(query) ? list.find((w) => w.id === query) : null;
      if (byId) return { wallet: byId };
      const q = query.toLowerCase();
      const exact = list.filter((w) => w.name.toLowerCase() === q);
      const partial = exact.length ? exact : list.filter((w) => w.name.toLowerCase().includes(q));
      if (partial.length === 1) return { wallet: partial[0] };
      if (partial.length > 1) return { error: `Hay varias carteras que coinciden: ${partial.map((w) => w.name).join(", ")}.` };
      return { error: `No encontre la cartera "${query}". Tus carteras: ${list.map((w) => w.name).join(", ")}.` };
    }
    const writable = await Promise.all(list.map((w) => wallets.canWriteWallet({ ...pctx(actx), walletId: w.id })));
    const candidates = list.filter((w, i) => writable[i] && !w.ledgerAccountId);
    if (candidates.length === 1) return { wallet: candidates[0] };
    if (!candidates.length) return { error: "No tienes una cartera donde registrar movimientos (sin contar las que reflejan una cuenta bancaria)." };
    return { error: `Indica en que cartera: ${candidates.map((w) => w.name).join(", ")}.` };
  }

  async function resolveCategory(actx, query, kind) {
    if (!query) return { categoryId: null, categoryName: null };
    const list = (await categories.listCategories({ ...pctx(actx), kind })).data ?? [];
    const byId = UUID_RE.test(query) ? list.find((c) => c.id === query) : null;
    if (byId) return { categoryId: byId.id, categoryName: byId.name };
    const q = query.toLowerCase();
    const exact = list.filter((c) => c.name.toLowerCase() === q);
    const partial = exact.length ? exact : list.filter((c) => c.name.toLowerCase().includes(q));
    if (partial.length === 1) return { categoryId: partial[0].id, categoryName: partial[0].name };
    if (partial.length > 1) return { error: `Hay varias categorias que coinciden: ${partial.map((c) => c.name).join(", ")}.` };
    return { error: `No encontre la categoria "${query}".` };
  }

  async function categoryNameById(actx, id) {
    if (!id) return null;
    const list = (await categories.listCategories(pctx(actx))).data ?? [];
    return list.find((c) => c.id === id)?.name ?? null;
  }

  async function loadMovement(actx, movementId) {
    let row;
    try {
      row = await movements.getOwnedMovement({ companyId: actx.companyId, movementId });
    } catch {
      return { error: "No encontre ese movimiento. Usa pfm_search_movements para obtener su movementId." };
    }
    if (!(await wallets.canWriteWallet({ ...pctx(actx), walletId: row.walletId }))) {
      return { error: "No tienes permiso de escritura en esa cartera." };
    }
    const wallet = await wallets.getWallet({ ...pctx(actx), walletId: row.walletId });
    return { row, wallet };
  }

  const create = {
    key: "pfm.movement.create",
    moduleKey: "runly.pfm",
    operation: "create",
    label: "Registrar movimiento",
    permission: "pfm.movements.create",
    description: "Registra un gasto o ingreso en una cartera. Si no dice cartera y el usuario solo tiene una cartera propia (no vinculada a un banco), usa esa.",
    parameters: {
      type: "object",
      properties: {
        wallet: { type: "string", description: "Nombre de la cartera (opcional si solo hay una)." },
        direction: { type: "string", enum: ["EXPENSE", "INCOME"] },
        amount: { type: "number" },
        occurredOn: { type: "string", description: "YYYY-MM-DD. Por defecto hoy." },
        category: { type: "string", description: "Nombre de la categoria (opcional)." },
        merchant: { type: "string" },
        note: { type: "string" },
      },
      required: ["direction", "amount"],
    },
    async prepare(args, actx) {
      const parsed = createArgs.safeParse(args);
      if (!parsed.success) return { error: "Datos del movimiento invalidos: faltan tipo o monto." };
      const a = parsed.data;
      const resolved = await resolveWallet(actx, a.wallet);
      if (resolved.error) return { error: resolved.error };
      const { wallet } = resolved;
      if (wallet.ledgerAccountId) return { error: BANK_LINKED_MSG };
      if (!(await wallets.canWriteWallet({ ...pctx(actx), walletId: wallet.id }))) {
        return { error: "No tienes permiso de escritura en esa cartera." };
      }
      const cat = await resolveCategory(actx, a.category, a.direction);
      if (cat.error) return { error: cat.error };
      const occurredOn = DAY_RE.test(a.occurredOn ?? "") ? a.occurredOn : toLocalIso();
      const validated = createMovementSchema.safeParse({
        direction: a.direction,
        amount: a.amount,
        occurredOn,
        categoryId: cat.categoryId,
        merchant: a.merchant ?? null,
        note: a.note ?? null,
        status: "POSTED",
      });
      if (!validated.success) return { error: "Datos del movimiento invalidos (revisa monto, tipo y fecha)." };
      return {
        input: { walletId: wallet.id, data: validated.data, walletName: wallet.name, currency: wallet.currency },
        preview: {
          title: "Registrar movimiento",
          fields: [
            { label: "Cartera", value: wallet.name },
            { label: "Tipo", value: a.direction === "EXPENSE" ? "Gasto" : "Ingreso" },
            { label: "Monto", value: money(validated.data.amount, wallet.currency) },
            { label: "Fecha", value: occurredOn },
            cat.categoryName ? { label: "Categoria", value: cat.categoryName } : null,
            a.merchant ? { label: "Comercio", value: a.merchant } : null,
            a.note ? { label: "Nota", value: a.note } : null,
          ].filter(Boolean),
        },
      };
    },
    async execute(input, actx) {
      const movement = await movements.createMovement({ ...pctx(actx), walletId: input.walletId, data: input.data });
      return {
        id: movement.id,
        summary: `Movimiento registrado: ${money(movement.amount, input.currency)} en ${input.walletName}${movement.merchant ? ` (${movement.merchant})` : ""}`,
        link: LINK,
      };
    },
  };

  const update = {
    key: "pfm.movement.update",
    moduleKey: "runly.pfm",
    operation: "update",
    label: "Editar movimiento",
    permission: "pfm.movements.update",
    description: "Cambia un movimiento existente (monto, fecha, categoria, comercio, nota, tipo). Requiere el movementId de pfm_search_movements; envia solo los campos que cambian.",
    parameters: {
      type: "object",
      properties: {
        movementId: { type: "string" },
        direction: { type: "string", enum: ["EXPENSE", "INCOME"] },
        amount: { type: "number" },
        occurredOn: { type: "string" },
        category: { type: "string" },
        merchant: { type: "string" },
        note: { type: "string" },
      },
      required: ["movementId"],
    },
    async prepare(args, actx) {
      const parsed = updateArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica el movementId (de pfm_search_movements) y los campos a cambiar." };
      const a = parsed.data;
      const found = await loadMovement(actx, a.movementId);
      if (found.error) return { error: found.error };
      const { row, wallet } = found;
      const direction = a.direction ?? row.direction;
      const data = {};
      const fields = [{ label: "Movimiento", value: row.merchant || row.note || "(sin descripcion)" }];

      if (a.direction !== undefined && a.direction !== row.direction) {
        data.direction = a.direction;
        fields.push({ label: "Tipo", before: row.direction === "EXPENSE" ? "Gasto" : "Ingreso", value: a.direction === "EXPENSE" ? "Gasto" : "Ingreso" });
      }
      if (a.amount !== undefined && a.amount !== Number(row.amount)) {
        data.amount = a.amount;
        fields.push({ label: "Monto", before: money(row.amount, wallet.currency), value: money(a.amount, wallet.currency) });
      }
      if (a.occurredOn !== undefined) {
        if (!DAY_RE.test(a.occurredOn)) return { error: "Fecha invalida; usa YYYY-MM-DD." };
        if (a.occurredOn !== dayKey(row.occurredOn)) {
          data.occurredOn = a.occurredOn;
          fields.push({ label: "Fecha", before: dayKey(row.occurredOn), value: a.occurredOn });
        }
      }
      if (a.merchant !== undefined && a.merchant !== (row.merchant ?? "")) {
        data.merchant = a.merchant || null;
        fields.push({ label: "Comercio", before: row.merchant ?? "(vacio)", value: a.merchant || "(vacio)" });
      }
      if (a.note !== undefined && a.note !== (row.note ?? "")) {
        data.note = a.note || null;
        fields.push({ label: "Nota", before: row.note ?? "(vacio)", value: a.note || "(vacio)" });
      }
      if (a.category !== undefined) {
        const cat = await resolveCategory(actx, a.category, direction);
        if (cat.error) return { error: cat.error };
        if (cat.categoryId !== (row.categoryId ?? null)) {
          data.categoryId = cat.categoryId;
          fields.push({ label: "Categoria", before: (await categoryNameById(actx, row.categoryId)) ?? "(sin categoria)", value: cat.categoryName ?? "(sin categoria)" });
        }
      }
      if (!Object.keys(data).length) return { error: "No indicaste ningun cambio respecto al movimiento actual." };
      const validated = updateMovementSchema.safeParse(data);
      if (!validated.success) return { error: "Datos invalidos." };
      return { input: { movementId: row.id, data: validated.data, currency: wallet.currency }, targetId: row.id, preview: { title: "Editar movimiento", fields } };
    },
    async execute(input, actx) {
      const movement = await movements.updateMovement({ ...pctx(actx), movementId: input.movementId, data: input.data });
      return { id: movement.id, summary: `Movimiento actualizado: ${money(movement.amount, input.currency)}`, link: LINK };
    },
  };

  const remove = {
    key: "pfm.movement.delete",
    moduleKey: "runly.pfm",
    operation: "delete",
    label: "Eliminar movimiento",
    permission: "pfm.movements.delete",
    description: "Elimina un movimiento existente. Requiere el movementId de pfm_search_movements.",
    parameters: { type: "object", properties: { movementId: { type: "string" } }, required: ["movementId"] },
    async prepare(args, actx) {
      const parsed = deleteArgs.safeParse(args);
      if (!parsed.success) return { error: "Indica el movementId (de pfm_search_movements)." };
      const found = await loadMovement(actx, parsed.data.movementId);
      if (found.error) return { error: found.error };
      const { row, wallet } = found;
      return {
        input: { movementId: row.id },
        targetId: row.id,
        preview: {
          title: "Eliminar movimiento",
          fields: [
            { label: "Movimiento", value: row.merchant || row.note || "(sin descripcion)" },
            { label: "Monto", value: money(row.amount, wallet.currency) },
            { label: "Fecha", value: dayKey(row.occurredOn) },
          ],
        },
      };
    },
    async execute(input, actx) {
      await movements.setMovementEnabled({ ...pctx(actx), movementId: input.movementId, enabled: false });
      return { id: input.movementId, summary: "Movimiento eliminado." };
    },
  };

  return [create, update, remove];
}
