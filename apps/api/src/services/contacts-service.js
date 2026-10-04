import { contactUpsertSchema, GENERIC_RFCS, normalizeRfc } from "@runly/validators";
import {
  replaceContactCollections,
  withLegacyChannels,
  ContactChildrenError,
} from "./contacts/contact-children-service.js";
import { buildAvatarUrlMapByFileIds } from "../lib/avatar-url-map.js";
import { getSignedUrlByFileId } from "../lib/signed-url-by-file-id.js";
import { publishDomainEvent } from "./domain-events/events.js";

class ContactsServiceError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = "ContactsServiceError";
    this.status = status;
  }
}

function buildSearchWhere(search) {
  const query = String(search ?? "").trim();
  if (!query) return {};
  return {
    OR: [
      { name: { contains: query, mode: "insensitive" } },
      { legalName: { contains: query, mode: "insensitive" } },
      { email: { contains: query, mode: "insensitive" } },
      { phone: { contains: query, mode: "insensitive" } },
      { taxId: { contains: query, mode: "insensitive" } },
      { notesMarkdown: { contains: query, mode: "insensitive" } },
      { industry: { contains: query, mode: "insensitive" } },
      { tags: { has: query } },
      { channels: { some: { value: { contains: query, mode: "insensitive" } } } },
      { persons: { some: { name: { contains: query, mode: "insensitive" } } } },
    ],
  };
}

const LIST_SORT_FIELDS = {
  name: "name", type: "type", email: "email", phone: "phone", taxId: "taxId",
  legalName: "legalName", industry: "industry", website: "website", taxRegime: "taxRegime",
  enabled: "enabled", createdAt: "createdAt", updatedAt: "updatedAt",
};

// Only what the list columns show: the default address' city/state and the
// primary contact person, plus how many people/addresses the contact has.
const LIST_INCLUDE = {
  addresses: {
    orderBy: [{ isDefault: "desc" }, { sortOrder: "asc" }],
    take: 1,
    select: { city: true, state: true },
  },
  persons: {
    orderBy: [{ isPrimary: "desc" }, { sortOrder: "asc" }],
    take: 1,
    select: { name: true, role: true },
  },
  _count: { select: { persons: true, addresses: true } },
};

function parseDateBound(value, endOfDay = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildListWhere({ companyId, enabled = true, search, tag, type, createdFrom, createdTo }) {
  const from = parseDateBound(createdFrom);
  const to = parseDateBound(createdTo, true);
  return {
    companyId,
    enabled: Boolean(enabled),
    ...buildSearchWhere(search),
    ...(tag ? { tags: { has: String(tag) } } : {}),
    ...(type ? { type: String(type) } : {}),
    ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
  };
}

export function toListRow(row, avatarUrl) {
  const { addresses = [], persons = [], _count, ...contact } = row;
  const address = addresses[0] ?? null;
  const person = persons[0] ?? null;
  return {
    ...contact,
    avatarUrl,
    city: address?.city ?? null,
    state: address?.state ?? null,
    location: [address?.city, address?.state].filter(Boolean).join(", ") || null,
    primaryPersonName: person?.name ?? null,
    primaryPersonRole: person?.role ?? null,
    personsCount: _count?.persons ?? 0,
    addressesCount: _count?.addresses ?? 0,
  };
}

function normalizeLimit(limit, fallback = 50, max = 100) {
  const parsed = Number.parseInt(String(limit ?? fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function nullableString(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

const NULLABLE_TEXT_FIELDS = [
  "legalName", "email", "phone", "taxId", "notesMarkdown",
  "website", "industry", "taxRegime", "fiscalPostalCode", "cfdiUse",
];

function dedupeTags(tags) {
  const seen = new Set();
  const out = [];
  for (const raw of tags) {
    const tag = String(raw).trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

// Only keys present in the payload are written, so partial updates never
// null out fields the caller did not send.
function normalizeContactPayload(data) {
  const out = {};
  if ("type" in data) out.type = data.type;
  if ("name" in data) out.name = data.name;
  if ("metadata" in data) out.metadata = data.metadata;
  for (const key of NULLABLE_TEXT_FIELDS) {
    if (key in data) out[key] = nullableString(data[key]);
  }
  if (Array.isArray(data.tags)) out.tags = dedupeTags(data.tags);
  return out;
}

const PROFILE_INCLUDE = {
  channels: { orderBy: { sortOrder: "asc" } },
  addresses: { orderBy: { sortOrder: "asc" } },
  persons: { orderBy: { sortOrder: "asc" } },
};

// Legacy callers (Growth convert, calls proposals) send only email/phone.
// Keep the primary channel of that kind in sync so the profile agrees.
async function syncLegacyChannel(tx, { companyId, contactId, kind, value }) {
  const primary = await tx.contactChannel.findFirst({ where: { contactId, kind, isPrimary: true } });
  if (!value) {
    if (primary) await tx.contactChannel.delete({ where: { id: primary.id } });
    return;
  }
  if (primary) await tx.contactChannel.update({ where: { id: primary.id }, data: { value } });
  else await tx.contactChannel.create({ data: { companyId, contactId, kind, value, isPrimary: true } });
}

function rethrowChildrenError(err) {
  if (err instanceof ContactChildrenError) throw new ContactsServiceError(err.message, err.status);
  throw err;
}

export function createContactsService({ prisma, supabaseAdmin = null, storageBucket = "runly-files" }) {
  // activeCompanyId: the caller's validated active company, resolved by the
  // API's tenant middleware (c.get("companyId"), see
  // docs/superpowers/specs/2026-09-10-multi-tenant-architecture-design.md
  // §5) and threaded down from each route handler. When provided, this is
  // the company every contacts operation runs against — never re-derived.
  async function getCompanyContext(activeCompanyId) {
    if (activeCompanyId) return activeCompanyId;
    throw new ContactsServiceError("Selecciona una empresa activa para gestionar contactos.", 400);
  }

  async function assertContactOwnership({ id, companyId }) {
    const existing = await prisma.contact.findFirst({
      where: { id, companyId },
      select: { id: true, avatarFileId: true },
    });
    if (!existing) {
      throw new ContactsServiceError("Contacto no encontrado.", 404);
    }
    return existing;
  }

  async function signedAvatar(fileId, variant) {
    if (!supabaseAdmin || !fileId) return null;
    return getSignedUrlByFileId(fileId, variant, { prisma, supabaseAdmin }).catch(() => null);
  }

  async function disableFileAsset(fileId) {
    if (!fileId) return;
    await prisma.fileAsset.updateMany({ where: { id: fileId }, data: { enabled: false } });
  }

  return {
    // connectionMatchIds: contacts matched by connected fields (Connections
    // search), OR-ed with the own search while every other filter applies.
    async list({ authUserId, companyId: activeCompanyId, search, connectionMatchIds = [], page, pageSize, sortBy, sortDir, enabled = true, tag, type, createdFrom, createdTo }) {
      const companyId = await getCompanyContext(activeCompanyId);
      const parsedPage = Math.max(1, Number.parseInt(String(page ?? 1), 10) || 1);
      const parsedPageSize = Math.min(200, Math.max(1, Number.parseInt(String(pageSize ?? 20), 10) || 20));
      let where = buildListWhere({ companyId, enabled, search, tag, type, createdFrom, createdTo });
      if (search && connectionMatchIds.length) {
        where = { OR: [where, { ...buildListWhere({ companyId, enabled, tag, type, createdFrom, createdTo }), id: { in: connectionMatchIds } }] };
      }
      const dir = sortDir === "desc" ? "desc" : "asc";
      const orderBy = sortBy && LIST_SORT_FIELDS[sortBy]
        ? { [LIST_SORT_FIELDS[sortBy]]: dir }
        : { createdAt: "desc" };
      const [contacts, total] = await Promise.all([
        prisma.contact.findMany({
          where,
          orderBy,
          take: parsedPageSize,
          skip: (parsedPage - 1) * parsedPageSize,
          include: LIST_INCLUDE,
        }),
        prisma.contact.count({ where }),
      ]);
      const avatarIds = contacts.map((row) => row.avatarFileId).filter(Boolean);
      const avatarMap = supabaseAdmin && avatarIds.length
        ? await buildAvatarUrlMapByFileIds(avatarIds, "thumb", { prisma, supabaseAdmin }).catch(() => new Map())
        : new Map();
      const rows = contacts.map((row) => toListRow(row, avatarMap.get(row.avatarFileId) ?? null));
      return { rows, total, page: parsedPage, pageSize: parsedPageSize };
    },

    // Full-resolution photo for the list's avatar viewer; the list itself only
    // embeds the small "thumb" URL.
    async getAvatarSignedUrl({ companyId: activeCompanyId, id, variant = "full" }) {
      const companyId = await getCompanyContext(activeCompanyId);
      const existing = await assertContactOwnership({ id, companyId });
      return { signedUrl: await signedAvatar(existing.avatarFileId, variant === "thumb" ? "thumb" : "full") };
    },

    // KPI strip for the list: active contacts by type plus inactive count.
    async summary({ companyId: activeCompanyId }) {
      const companyId = await getCompanyContext(activeCompanyId);
      const [byType, inactive] = await Promise.all([
        prisma.contact.groupBy({ by: ["type"], where: { companyId, enabled: true }, _count: { _all: true } }),
        prisma.contact.count({ where: { companyId, enabled: false } }),
      ]);
      const counts = Object.fromEntries(byType.map((row) => [row.type, row._count._all]));
      const total = byType.reduce((sum, row) => sum + row._count._all, 0);
      return { total, inactive, byType: counts };
    },

    async getById({ authUserId, companyId: activeCompanyId, id }) {
      const companyId = await getCompanyContext(activeCompanyId);
      const contact = await prisma.contact.findFirst({ where: { id, companyId } });
      if (!contact) {
        throw new ContactsServiceError("Contacto no encontrado.", 404);
      }
      return contact;
    },

    async getProfile({ authUserId, companyId: activeCompanyId, id }) {
      const companyId = await getCompanyContext(activeCompanyId);
      const contact = await prisma.contact.findFirst({ where: { id, companyId }, include: PROFILE_INCLUDE });
      if (!contact) throw new ContactsServiceError("Contacto no encontrado.", 404);
      return {
        ...contact,
        channels: withLegacyChannels(contact, contact.channels),
        avatarUrl: await signedAvatar(contact.avatarFileId, "full"),
      };
    },

    // afterWrite(tx, contact): connection sections saved in the same transaction.
    async create({ authUserId, companyId: activeCompanyId, payload, afterWrite = null }) {
      const companyId = await getCompanyContext(activeCompanyId);
      const data = contactUpsertSchema.parse(payload);
      const id = await prisma.$transaction(async (tx) => {
        const contact = await tx.contact.create({
          data: { ...normalizeContactPayload(data), companyId },
        });
        const mirror = await replaceContactCollections(tx, { companyId, contactId: contact.id, payload: data });
        if (Array.isArray(data.channels)) {
          await tx.contact.update({ where: { id: contact.id }, data: mirror });
        } else {
          for (const kind of ["email", "phone"]) {
            if (contact[kind]) await syncLegacyChannel(tx, { companyId, contactId: contact.id, kind, value: contact[kind] });
          }
        }
        if (afterWrite) await afterWrite(tx, contact);
        return contact.id;
      }).catch(rethrowChildrenError);
      await publishDomainEvent(prisma, { companyId, event: "contacts.contact.created", payload: { id } });
      return prisma.contact.findUnique({ where: { id } });
    },

    async update({ authUserId, companyId: activeCompanyId, id, payload, afterWrite = null }) {
      const companyId = await getCompanyContext(activeCompanyId);
      await assertContactOwnership({ id, companyId });
      const data = contactUpsertSchema.partial().parse(payload);
      await prisma.$transaction(async (tx) => {
        const scalar = normalizeContactPayload(data);
        const mirror = await replaceContactCollections(tx, { companyId, contactId: id, payload: data });
        await tx.contact.update({ where: { id }, data: { ...scalar, ...mirror } });
        if (!Array.isArray(data.channels)) {
          for (const kind of ["email", "phone"]) {
            if (kind in scalar) await syncLegacyChannel(tx, { companyId, contactId: id, kind, value: scalar[kind] });
          }
        }
        if (afterWrite) await afterWrite(tx, { id });
      }).catch(rethrowChildrenError);
      return prisma.contact.findUnique({ where: { id } });
    },

    async findDuplicates({ authUserId, companyId: activeCompanyId, taxId, email, phone, excludeId }) {
      const companyId = await getCompanyContext(activeCompanyId);
      const rfc = normalizeRfc(taxId);
      const mail = String(email ?? "").trim();
      const digits = String(phone ?? "").replace(/\D/g, "");
      const checks = [];
      if (rfc.length >= 12 && !GENERIC_RFCS.includes(rfc)) {
        checks.push(["taxId", { taxId: { equals: rfc, mode: "insensitive" } }]);
      }
      if (mail.includes("@")) {
        checks.push(["email", { OR: [
          { email: { equals: mail, mode: "insensitive" } },
          { channels: { some: { kind: "email", value: { equals: mail, mode: "insensitive" } } } },
        ] }]);
      }
      if (digits.length >= 8) {
        const tail = digits.slice(-10);
        checks.push(["phone", { OR: [
          { phone: { contains: tail } },
          { channels: { some: { kind: "phone", value: { contains: tail } } } },
        ] }]);
      }
      const results = new Map();
      for (const [matchedOn, where] of checks) {
        const rows = await prisma.contact.findMany({
          where: { companyId, ...(excludeId ? { id: { not: excludeId } } : {}), ...where },
          select: { id: true, name: true },
          take: 5,
        });
        for (const row of rows) if (!results.has(row.id)) results.set(row.id, { ...row, matchedOn });
      }
      return [...results.values()];
    },

    async listTags({ authUserId, companyId: activeCompanyId, query }) {
      const companyId = await getCompanyContext(activeCompanyId);
      const needle = `%${String(query ?? "").trim()}%`;
      const rows = await prisma.$queryRaw`
        SELECT DISTINCT tag FROM contact, unnest(tags) AS tag
        WHERE company_id = ${companyId}::uuid AND tag ILIKE ${needle}
        ORDER BY tag LIMIT 50`;
      return rows.map((row) => row.tag);
    },

    async setAvatar({ authUserId, companyId: activeCompanyId, id, file }) {
      const companyId = await getCompanyContext(activeCompanyId);
      const existing = await assertContactOwnership({ id, companyId });
      if (!supabaseAdmin) throw new ContactsServiceError("Almacenamiento no disponible.", 503);
      if (!file?.type?.startsWith("image/")) throw new ContactsServiceError("El archivo debe ser una imagen.", 400);
      if (file.size > 5 * 1024 * 1024) throw new ContactsServiceError("La imagen no debe superar 5 MB.", 400);
      const ext = (file.name?.split(".").pop() || "png").toLowerCase();
      const objectKey = `modules/runly-contacts/contact/${id}/avatar-${Date.now()}.${ext}`;
      const { error } = await supabaseAdmin.storage
        .from(storageBucket)
        .upload(objectKey, await file.arrayBuffer(), { contentType: file.type, upsert: true });
      if (error) throw new ContactsServiceError("No se pudo subir la imagen.", 502);
      const asset = await prisma.fileAsset.create({
        data: {
          bucket: storageBucket,
          objectKey,
          originalName: file.name || `avatar.${ext}`,
          mimeType: file.type,
          sizeBytes: file.size,
          moduleKey: "runly.contacts",
          entityType: "contact_avatar",
          entityId: id,
        },
      });
      await prisma.contact.update({ where: { id }, data: { avatarFileId: asset.id } });
      await disableFileAsset(existing.avatarFileId);
      return { avatarFileId: asset.id, avatarUrl: await signedAvatar(asset.id, "full") };
    },

    async removeAvatar({ authUserId, companyId: activeCompanyId, id }) {
      const companyId = await getCompanyContext(activeCompanyId);
      const existing = await assertContactOwnership({ id, companyId });
      await prisma.contact.update({ where: { id }, data: { avatarFileId: null } });
      await disableFileAsset(existing.avatarFileId);
      return { avatarFileId: null };
    },

    async setEnabled({ authUserId, companyId: activeCompanyId, id, enabled }) {
      const companyId = await getCompanyContext(activeCompanyId);
      await assertContactOwnership({ id, companyId });
      return prisma.contact.update({
        where: { id },
        data: { enabled: Boolean(enabled) },
      });
    },

    async delete({ authUserId, companyId: activeCompanyId, id }) {
      const companyId = await getCompanyContext(activeCompanyId);
      await assertContactOwnership({ id, companyId });
      await prisma.contact.delete({ where: { id } });
    },

    async bulkSetEnabled({ authUserId, companyId: activeCompanyId, ids, enabled }) {
      if (!Array.isArray(ids) || !ids.length) {
        throw new ContactsServiceError("IDs requeridos.", 400);
      }
      const companyId = await getCompanyContext(activeCompanyId);
      await prisma.contact.updateMany({
        where: { id: { in: ids }, companyId },
        data: { enabled: Boolean(enabled) },
      });
    },

    async bulkDelete({ authUserId, companyId: activeCompanyId, ids }) {
      if (!Array.isArray(ids) || !ids.length) {
        throw new ContactsServiceError("IDs requeridos.", 400);
      }
      const companyId = await getCompanyContext(activeCompanyId);
      await prisma.contact.deleteMany({
        where: { id: { in: ids }, companyId },
      });
    },

    async getContactsForExport({ authUserId, companyId: activeCompanyId, ids }) {
      const companyId = await getCompanyContext(activeCompanyId);
      const where = { companyId };
      if (Array.isArray(ids) && ids.length) {
        where.id = { in: ids };
      }
      return prisma.contact.findMany({
        where,
        orderBy: { name: "asc" },
        include: { addresses: { where: { kind: "fiscal" }, orderBy: { sortOrder: "asc" }, take: 1 } },
      });
    },

    async picker({ authUserId, companyId: activeCompanyId, query, limit }) {
      const companyId = await getCompanyContext(activeCompanyId);
      const take = normalizeLimit(limit, 12, 30);
      const contacts = await prisma.contact.findMany({
        where: {
          companyId,
          enabled: true,
          ...buildSearchWhere(query),
        },
        orderBy: [{ name: "asc" }, { createdAt: "desc" }],
        take,
        select: {
          id: true,
          type: true,
          name: true,
          legalName: true,
          email: true,
          phone: true,
          taxId: true,
        },
      });

      return contacts.map((contact) => ({
        id: contact.id,
        type: contact.type,
        name: contact.name,
        legalName: contact.legalName,
        email: contact.email,
        phone: contact.phone,
        taxId: contact.taxId,
      }));
    },
  };
}

export { ContactsServiceError };
