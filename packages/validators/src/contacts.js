import { z } from "zod";
import { REGIMEN_FISCAL, USO_CFDI, RFC_REGEX, normalizeRfc } from "./sat-catalogs.js";

export * from "./sat-catalogs.js";

export const CONTACT_TYPES = ["customer", "supplier", "person", "company"];
export const CONTACT_CHANNEL_KINDS = ["phone", "email"];
export const CONTACT_CHANNEL_LABELS = ["office", "mobile", "billing", "other"];
export const CONTACT_ADDRESS_KINDS = ["fiscal", "shipping", "other"];

const optionalText = (max) =>
  z.string().trim().max(max).optional().nullable().or(z.literal(""));

const uuidOptional = z.string().uuid().optional().nullable();

const REGIMEN_CODES = new Set(REGIMEN_FISCAL.map((entry) => entry.code));
const USO_CFDI_CODES = new Set(USO_CFDI.map((entry) => entry.code));

export const contactChannelSchema = z
  .object({
    id: uuidOptional,
    kind: z.enum(CONTACT_CHANNEL_KINDS),
    label: z.enum(CONTACT_CHANNEL_LABELS).default("other"),
    value: z.string().trim().min(1, "Captura el valor.").max(160),
    countryCode: optionalText(6),
    isPrimary: z.boolean().default(false),
  })
  .superRefine((row, ctx) => {
    if (row.kind === "email" && !z.string().email().safeParse(row.value).success) {
      ctx.addIssue({ code: "custom", path: ["value"], message: "Correo no válido." });
    }
  });

export const contactAddressSchema = z.object({
  id: uuidOptional,
  kind: z.enum(CONTACT_ADDRESS_KINDS).default("other"),
  label: optionalText(80),
  street: z.string().trim().min(1, "Captura la calle.").max(200),
  extNumber: optionalText(20),
  intNumber: optionalText(20),
  neighborhood: optionalText(120),
  postalCode: optionalText(10),
  city: optionalText(120),
  state: optionalText(120),
  country: z.string().trim().max(3).default("MX"),
  isDefault: z.boolean().default(false),
});

export const contactPersonSchema = z.object({
  id: uuidOptional,
  name: z.string().trim().min(1, "Captura el nombre.").max(140),
  role: optionalText(100),
  phone: optionalText(40),
  email: z.string().trim().email("Correo no válido.").optional().nullable().or(z.literal("")),
  isPrimary: z.boolean().default(false),
  notes: optionalText(500),
});

// Server side accepts any tax id (foreign ids, legacy callers); the form
// schema below enforces the Mexican RFC format.
const taxIdField = z
  .string()
  .max(20)
  .optional()
  .nullable()
  .transform((value) => (value == null ? value : normalizeRfc(value)));

const rfcField = taxIdField.refine((value) => !value || RFC_REGEX.test(value), { message: "RFC no válido." });

export const contactUpsertSchema = z.object({
  type: z.enum(CONTACT_TYPES),
  name: z.string().trim().min(2, "El nombre es obligatorio."),
  legalName: optionalText(200),
  email: z.string().trim().email().optional().nullable().or(z.literal("")),
  phone: optionalText(40),
  taxId: taxIdField,
  notesMarkdown: optionalText(5000),
  metadata: z.record(z.string(), z.any()).optional(),
  website: z.string().trim().url("URL no válida.").optional().nullable().or(z.literal("")),
  industry: optionalText(120),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  taxRegime: z
    .string()
    .optional()
    .nullable()
    .or(z.literal(""))
    .refine((value) => !value || REGIMEN_CODES.has(value), { message: "Régimen fiscal no válido." }),
  fiscalPostalCode: z
    .string()
    .trim()
    .optional()
    .nullable()
    .or(z.literal(""))
    .refine((value) => !value || /^\d{5}$/.test(value), { message: "El CP debe tener 5 dígitos." }),
  cfdiUse: z
    .string()
    .optional()
    .nullable()
    .or(z.literal(""))
    .refine((value) => !value || USO_CFDI_CODES.has(value), { message: "Uso de CFDI no válido." }),
  channels: z.array(contactChannelSchema).max(20).optional(),
  addresses: z.array(contactAddressSchema).max(10).optional(),
  persons: z.array(contactPersonSchema).max(30).optional(),
});

// Stricter variant used by the contact form: RFC must match the SAT format.
export const contactFormSchema = contactUpsertSchema.extend({ taxId: rfcField });
