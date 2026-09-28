// Child collections of a contact (channels, addresses, key people).
//
// Collections use replace semantics: when a key is present in the payload the
// stored collection becomes exactly that array (rows with a known id are
// updated, rows without id are created, missing rows are deleted). When the
// key is absent the collection is left untouched.
//
// Contact.email / Contact.phone stay as denormalized mirrors of the primary
// channel of each kind so every legacy consumer (list, picker, search,
// exports, offline sync, Growth, chat, calls) keeps working unchanged.

export class ContactChildrenError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "ContactChildrenError";
    this.status = status;
  }
}

function emptyToNull(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

// Exactly one flagged row per group (the first flagged, else the first row).
export function enforceSingleFlag(rows, flag, groupOf = () => "all") {
  const seen = new Set();
  const groupsWithFlag = new Set(rows.filter((row) => row[flag]).map(groupOf));
  return rows.map((row) => {
    const group = groupOf(row);
    let value;
    if (groupsWithFlag.has(group)) value = Boolean(row[flag]) && !seen.has(group);
    else value = !seen.has(group);
    seen.add(group);
    return { ...row, [flag]: value };
  });
}

export function primaryMirror(channels) {
  const pick = (kind) => channels.find((row) => row.kind === kind && row.isPrimary)?.value ?? null;
  return { email: pick("email"), phone: pick("phone") };
}

const COLLECTIONS = {
  channels: {
    delegate: "contactChannel",
    prepare: (rows) => enforceSingleFlag(rows, "isPrimary", (row) => row.kind),
    toData: (row) => ({
      kind: row.kind,
      label: row.label ?? "other",
      value: String(row.value).trim(),
      countryCode: emptyToNull(row.countryCode),
      isPrimary: Boolean(row.isPrimary),
    }),
  },
  addresses: {
    delegate: "contactAddress",
    prepare: (rows) => enforceSingleFlag(rows, "isDefault", (row) => row.kind),
    toData: (row) => ({
      kind: row.kind ?? "other",
      label: emptyToNull(row.label),
      street: String(row.street).trim(),
      extNumber: emptyToNull(row.extNumber),
      intNumber: emptyToNull(row.intNumber),
      neighborhood: emptyToNull(row.neighborhood),
      postalCode: emptyToNull(row.postalCode),
      city: emptyToNull(row.city),
      state: emptyToNull(row.state),
      country: emptyToNull(row.country) ?? "MX",
      isDefault: Boolean(row.isDefault),
    }),
  },
  persons: {
    delegate: "contactPerson",
    prepare: (rows) => enforceSingleFlag(rows, "isPrimary"),
    toData: (row) => ({
      name: String(row.name).trim(),
      role: emptyToNull(row.role),
      phone: emptyToNull(row.phone),
      email: emptyToNull(row.email),
      notes: emptyToNull(row.notes),
      isPrimary: Boolean(row.isPrimary),
    }),
  },
};

async function replaceCollection(tx, key, { companyId, contactId, rows }) {
  const { delegate, prepare, toData } = COLLECTIONS[key];
  const model = tx[delegate];
  const existing = await model.findMany({ where: { contactId }, select: { id: true } });
  const existingIds = new Set(existing.map((row) => row.id));
  const prepared = prepare(rows);

  for (const row of prepared) {
    if (row.id && !existingIds.has(row.id)) {
      throw new ContactChildrenError("Un registro relacionado no pertenece a este contacto.");
    }
  }

  const keepIds = prepared.filter((row) => row.id).map((row) => row.id);
  await model.deleteMany({ where: { contactId, id: { notIn: keepIds } } });

  for (const [index, row] of prepared.entries()) {
    const data = { ...toData(row), sortOrder: index };
    if (row.id) await model.update({ where: { id: row.id }, data });
    else await model.create({ data: { ...data, companyId, contactId } });
  }
  return prepared;
}

// Returns the fields to write on Contact (email/phone mirrors) when channels
// were replaced, otherwise an empty object.
export async function replaceContactCollections(tx, { companyId, contactId, payload }) {
  const contactPatch = {};
  for (const key of Object.keys(COLLECTIONS)) {
    if (!Array.isArray(payload[key])) continue;
    const prepared = await replaceCollection(tx, key, { companyId, contactId, rows: payload[key] });
    if (key === "channels") Object.assign(contactPatch, primaryMirror(prepared));
  }
  return contactPatch;
}

// Legacy contacts (or ones created by older callers with only email/phone)
// get synthesized read-only channel rows so the profile is never empty.
export function withLegacyChannels(contact, channels) {
  if (channels.length) return channels;
  const synthesized = [];
  if (contact.phone) synthesized.push({ id: null, kind: "phone", label: "other", value: contact.phone, isPrimary: true });
  if (contact.email) synthesized.push({ id: null, kind: "email", label: "other", value: contact.email, isPrimary: true });
  return synthesized;
}
