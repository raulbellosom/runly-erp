import { z } from "zod";

export const moduleInstallSchema = z.object({
  manifest: z
    .object({
      key: z
        .string()
        .min(3)
        .regex(
          /^[\w.-]+$/,
          "La clave del modulo solo puede contener letras, numeros, puntos y guiones.",
        ),
      name: z.string().min(2),
      version: z.string().min(1),
      core: z.boolean().optional(),
      uninstallable: z.boolean().optional(),
      dependencies: z
        .array(
          z.object({
            key: z.string(),
            optional: z.boolean().optional(),
            versionRange: z.string().optional(),
          }),
        )
        .optional(),
      navigation: z
        .array(
          z
            .object({
              label: z.string(),
              path: z.string(),
              icon: z.string().optional(),
              layout: z.string().optional(),
              permissionKey: z.string().optional(),
            })
            .passthrough(),
        )
        .optional(),
      permissions: z
        .array(
          z.object({
            key: z.string(),
            name: z.string(),
            description: z.string().optional(),
          }),
        )
        .optional(),
      acl: z
        .object({
          module: z.string().optional().nullable(),
          actions: z.record(z.string()).optional(),
          models: z
            .record(
              z.object({
                read: z.string().optional(),
                create: z.string().optional(),
                update: z.string().optional(),
                delete: z.string().optional(),
              }),
            )
            .optional(),
        })
        .optional(),
      blueprints: z.array(z.any()).optional(),
    })
    .passthrough(),
});

export const contactCreateSchema = z.object({
  type: z.enum(["customer", "supplier", "person", "company"]),
  name: z.string().min(2),
  legalName: z.string().optional(),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  taxId: z.string().optional(),
  notesMarkdown: z.string().max(5000).optional().or(z.literal("")),
  metadata: z.record(z.any()).optional(),
});

const hrEmployeeBaseSchema = z.object({
  employeeCode: z.string().trim().max(40).optional().or(z.literal("")),
  userProfileId: z.string().uuid().optional().nullable(),
  supervisorEmployeeId: z.string().uuid().optional().nullable(),
  departmentId: z.string().uuid().optional().nullable(),
  jobTitleId: z.string().uuid().optional().nullable(),
  firstName: z.string().trim().min(1, "El nombre es obligatorio."),
  lastName: z.string().trim().min(1, "Los apellidos son obligatorios."),
  workEmail: z.string().email().optional().or(z.literal("")),
  personalEmail: z.string().email().optional().or(z.literal("")),
  phone: z.string().trim().max(40).optional().or(z.literal("")),
  emergencyContactName: z.string().trim().max(140).optional().or(z.literal("")),
  emergencyContactPhone: z.string().trim().max(40).optional().or(z.literal("")),
  employmentType: z
    .enum(["full_time", "part_time", "contractor", "intern"])
    .optional(),
  workLocation: z.string().trim().max(120).optional().or(z.literal("")),
  // hr_employee.hire_date/termination_date are @db.Date columns rendered by
  // the generic blueprint 'date' field (DatePickerField), which sends plain
  // YYYY-MM-DD — not a full ISO datetime.
  hireDate: z.string().date().optional().or(z.literal("")),
  terminationDate: z.string().date().optional().or(z.literal("")),
  status: z
    .enum(["active", "inactive", "vacation", "terminated"])
    .default("active"),
  notesMarkdown: z.string().max(10000).optional().or(z.literal("")),
  metadata: z.record(z.any()).optional(),
});

function validateEmployeeDates(value, ctx) {
  if (!value.hireDate || !value.terminationDate) return;
  const hireDate = new Date(value.hireDate);
  const terminationDate = new Date(value.terminationDate);
  if (terminationDate < hireDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["terminationDate"],
      message: "La fecha de baja no puede ser anterior al ingreso.",
    });
  }
}

function validateEmployeeRelations(value, ctx) {
  if (
    value.supervisorEmployeeId &&
    value.supervisorEmployeeId === value.userProfileId
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["supervisorEmployeeId"],
      message: "El supervisor no puede ser la misma cuenta vinculada.",
    });
  }
}

export const hrEmployeeCreateSchema = hrEmployeeBaseSchema.superRefine(
  (value, ctx) => {
    validateEmployeeDates(value, ctx);
    validateEmployeeRelations(value, ctx);
  },
);

export const hrEmployeeUpdateSchema = hrEmployeeBaseSchema
  .partial()
  .superRefine((value, ctx) => {
    validateEmployeeDates(value, ctx);
    validateEmployeeRelations(value, ctx);
  });

export const hrEmployeeEnabledSchema = z.object({
  enabled: z.boolean(),
});

export const hrCatalogCreateSchema = z.object({
  name: z.string().trim().min(2, "El nombre es obligatorio.").max(120),
  description: z.string().trim().max(300).optional().or(z.literal("")),
});

export const hrCatalogUpdateSchema = hrCatalogCreateSchema.partial();

export const hrCatalogEnabledSchema = z.object({
  enabled: z.boolean(),
});

export const setupInitializeSchema = z.object({
  adminFirstName: z.string().min(1),
  adminLastName: z.string().min(1),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
  companyName: z.string().min(2),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  legalName: z.string().optional(),
  rfc: z.string().optional(),
  companyType: z.string().optional(),
  companyTypeName: z.string().optional(),
  companyIndustryKey: z.string().optional(),
  companyIndustryName: z.string().optional(),
  companySize: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  website: z.string().optional(),
  country: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  colony: z.string().optional(),
  street: z.string().optional(),
  extNumber: z.string().optional(),
  intNumber: z.string().optional(),
  postalCode: z.string().optional(),
});

export const companyProfileSchema = z.object({
  name: z.string().min(2),
  legalName: z.string().optional(),
  rfc: z.string().optional(),
  companyType: z.string().optional(),
  companyTypeName: z.string().optional(),
  industryKey: z.string().optional(),
  industryName: z.string().optional(),
  companySize: z.string().optional(),
  contactEmail: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  website: z.string().optional(),
});

export const companyAddressSchema = z.object({
  country: z.string().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  colony: z.string().optional(),
  street: z.string().optional(),
  extNumber: z.string().optional(),
  intNumber: z.string().optional(),
  postalCode: z.string().optional(),
});

export const companyBrandingSchema = z.object({
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  logoFileId: z.string().uuid().nullable().optional(),
});

export const notificationCreateSchema = z.object({
  userId: z.string().uuid(),
  companyId: z.string().uuid().optional(),
  kind: z.enum(["info", "warning", "error", "success"]).default("info"),
  title: z.string().min(1),
  body: z.string().optional(),
  link: z.string().optional(),
});

const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Moneda invalida. Usa codigo ISO de 3 letras.");

export const financeAccountCreateSchema = z.object({
  code: z.string().trim().min(1, "El codigo de cuenta es obligatorio.").max(24),
  name: z
    .string()
    .trim()
    .min(2, "El nombre de cuenta es obligatorio.")
    .max(140),
  type: z.string().trim().min(1, "El tipo de cuenta es obligatorio.").max(60),
  currency: currencySchema.default("MXN"),
  initialBalance: z.coerce.number().finite().default(0),
});

export const financeAccountUpdateSchema = financeAccountCreateSchema.partial();

export const financeEntryLineSchema = z.object({
  accountId: z.string().uuid("La cuenta debe ser UUID valido."),
  contactId: z.string().uuid().optional(),
  debit: z.coerce.number().finite().min(0).default(0),
  credit: z.coerce.number().finite().min(0).default(0),
  currency: currencySchema.optional(),
  note: z.string().trim().max(280).optional(),
});

export const financeEntryCreateSchema = z.object({
  occurredAt: z.string().datetime().optional(),
  concept: z.string().trim().min(1, "El concepto es obligatorio.").max(280),
  reference: z.string().trim().max(140).optional(),
  currency: currencySchema.default("MXN"),
  sourceType: z
    .enum(["manual", "income", "expense", "transfer"])
    .default("manual"),
  lines: z
    .array(financeEntryLineSchema)
    .min(2, "La poliza debe tener al menos dos lineas."),
});

export const financeEntryEnabledSchema = z.object({
  enabled: z.boolean(),
});

export const financeAccountEnabledSchema = z.object({
  enabled: z.boolean(),
});

export const financeFxRateCreateSchema = z
  .object({
    baseCurrency: currencySchema,
    quoteCurrency: currencySchema,
    rateDate: z
      .string()
      .trim()
      .min(1, "La fecha de tipo de cambio es obligatoria."),
    rate: z.coerce.number().finite().positive("La tasa debe ser mayor a cero."),
    source: z.string().trim().min(1).max(40).optional().default("manual"),
  })
  .superRefine((value, ctx) => {
    if (value.baseCurrency === value.quoteCurrency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["quoteCurrency"],
        message: "La moneda base y la moneda destino deben ser distintas.",
      });
    }
  });

export const financeFxRateEnabledSchema = z.object({
  enabled: z.boolean(),
});

const financeDirectionSchema = z.enum(["AR", "AP"]);
const financeDocTypeSchema = z.enum([
  "INVOICE",
  "CREDIT_NOTE",
  "DEBIT_NOTE",
  "ADVANCE",
  "PAYMENT",
]);
const financeDocStatusSchema = z.enum(["OPEN", "PARTIAL", "PAID", "VOID"]);
const financeTaxKindSchema = z.enum(["TRANSFER", "WITHHOLDING"]);
const financeApplicationStatusSchema = z.enum(["APPLIED", "REVERSED"]);

const dateLikeSchema = z.union([
  z.string().datetime(),
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
]);

export const financeDocumentCreateSchema = z.object({
  direction: financeDirectionSchema,
  docType: financeDocTypeSchema,
  contactId: z.string().uuid().optional().nullable(),
  currency: currencySchema.default("MXN"),
  issueDate: dateLikeSchema,
  dueDate: dateLikeSchema.optional().nullable(),
  reference: z.string().trim().max(120).optional().nullable(),
  notesMarkdown: z.string().max(5000).optional().nullable(),
  subtotalAmount: z.coerce.number().finite().positive().optional(),
  totalAmount: z.coerce.number().finite().positive(),
  taxLines: z
    .array(
      z.object({
        taxRateId: z.string().uuid(),
        baseAmount: z.coerce.number().finite().positive().optional(),
      }),
    )
    .max(20)
    .optional(),
  metadata: z.record(z.any()).optional(),
});

export const financeDocumentUpdateSchema = z.object({
  dueDate: dateLikeSchema.optional().nullable(),
  reference: z.string().trim().max(120).optional().nullable(),
  notesMarkdown: z.string().max(5000).optional().nullable(),
  metadata: z.record(z.any()).optional(),
  status: financeDocStatusSchema.optional(),
});

export const financeDocumentEnabledSchema = z.object({
  enabled: z.boolean(),
});

export const financeDocumentReminderSchema = z.object({
  message: z.string().trim().max(280).optional().nullable(),
});

export const financeDocumentBulkReminderSchema = z.object({
  documentIds: z.array(z.string().uuid()).min(1).max(200),
  message: z.string().trim().max(280).optional().nullable(),
});

export const financeApplicationLineSchema = z.object({
  targetDocumentId: z.string().uuid(),
  amount: z.coerce.number().finite().positive(),
});

export const financeApplicationPreviewSchema = z.object({
  targetDocumentIds: z.array(z.string().uuid()).min(1).max(300).optional(),
  lines: z.array(financeApplicationLineSchema).min(1).max(300).optional(),
  allocationMode: z.enum(["fifo", "manual"]).default("fifo"),
  applyDate: dateLikeSchema.optional(),
});

export const financeApplicationApplySchema = z.object({
  lines: z.array(financeApplicationLineSchema).min(1).max(300),
  note: z.string().max(500).optional().nullable(),
  applyDate: dateLikeSchema.optional(),
});

export const financeApplicationListQuerySchema = z.object({
  direction: financeDirectionSchema.optional(),
  status: financeApplicationStatusSchema.optional(),
  sourceDocumentId: z.string().uuid().optional(),
  targetDocumentId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional(),
  from: dateLikeSchema.optional(),
  to: dateLikeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(300).optional(),
});

export const financeApplicationReverseSchema = z.object({
  reason: z.string().trim().max(500).optional().nullable(),
});

export const financeDocumentListQuerySchema = z.object({
  direction: financeDirectionSchema.optional(),
  docType: financeDocTypeSchema.optional(),
  status: financeDocStatusSchema.optional(),
  contactId: z.string().uuid().optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(300).optional(),
});

export const financeAgingQuerySchema = z.object({
  direction: financeDirectionSchema.optional(),
  contactId: z.string().uuid().optional(),
  asOf: dateLikeSchema.optional(),
  currency: currencySchema.optional(),
});

export const financeTaxRateCreateSchema = z.object({
  key: z
    .string()
    .trim()
    .min(2, "La clave del impuesto es obligatoria.")
    .max(40),
  name: z
    .string()
    .trim()
    .min(2, "El nombre del impuesto es obligatorio.")
    .max(120),
  kind: financeTaxKindSchema,
  rate: z.coerce.number().finite().min(0, "La tasa no puede ser negativa."),
  direction: financeDirectionSchema.optional().nullable(),
  metadata: z.record(z.any()).optional(),
});

export const financeTaxRateEnabledSchema = z.object({
  enabled: z.boolean(),
});

export const financeTaxRateListQuerySchema = z.object({
  kind: financeTaxKindSchema.optional(),
  direction: financeDirectionSchema.optional(),
  enabled: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) =>
      typeof value === "boolean" ? value : value === "true",
    )
    .optional(),
  q: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(300).optional(),
});

export const fileRenameSchema = z.object({
  originalName: z
    .string()
    .trim()
    .min(1, "El nombre del archivo es obligatorio.")
    .max(180, "El nombre del archivo no puede exceder 180 caracteres.")
    .regex(
      /^[^\x00-\x1F\x7F\x80-\x9F\\/:*?"<>|]+$/,
      "El nombre del archivo contiene caracteres no permitidos.",
    ),
});

export const createUserSchema = z.object({
  firstName: z.string().min(1, "El nombre es obligatorio."),
  lastName: z.string().min(1, "Los apellidos son obligatorios."),
  email: z.string().email("Correo electrónico inválido."),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres."),
  roleId: z.string().uuid().optional(),
  // Off by default: the admin creates the user active and shares the
  // credentials directly; this only opts into a "your account is ready" email.
  notifyByEmail: z.boolean().optional().default(false),
});

export const createMembershipSchema = z.object({
  companyId: z.string().uuid("Empresa inválida."),
  roleId: z.string().uuid("Rol inválido.").nullable().optional(),
});

export const updateMembershipSchema = z
  .object({
    roleId: z.string().uuid("Rol inválido.").nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((data) => data.roleId !== undefined || data.enabled !== undefined, {
    message: "Debes enviar roleId o enabled.",
  });

// For POST /company/members — unlike createMembershipSchema, companyId is
// never accepted from the client; the server always uses the caller's active
// company (tenant.companyId).
export const createCompanyMemberSchema = z.object({
  userId: z.string().uuid("Usuario inválido."),
  roleId: z.string().uuid("Rol inválido.").nullable().optional(),
});

export const fileBulkDownloadSchema = z.object({
  fileIds: z
    .array(
      z.string().uuid("Cada identificador de archivo debe ser UUID valido."),
    )
    .min(1, "Debes seleccionar al menos un archivo.")
    .max(50, "No puedes seleccionar más de 50 archivos."),
  mode: z.enum(["direct", "zip"]),
});

export const createLedgerAccountSchema = z.object({
  name: z.string().trim().min(2, "El nombre es obligatorio.").max(120),
  type: z.enum(["banco", "caja", "cliente", "proveedor", "otro"]),
  currency: z.string().trim().length(3).default("MXN"),
  initialBalance: z.coerce.number().min(0).default(0),
  description: z.string().trim().max(500).optional().or(z.literal("")),
});

export const updateLedgerAccountSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  type: z.enum(["banco", "caja", "cliente", "proveedor", "otro"]).optional(),
  description: z.string().trim().max(500).optional().or(z.literal("")),
});

export const createLedgerMovementSchema = z.object({
  occurredAt: z.string().datetime(),
  direction: z.enum(["INCOME", "EXPENSE"]),
  movementType: z.string().trim().max(60).optional().or(z.literal("")),
  number: z.string().trim().max(60).optional().or(z.literal("")),
  name: z.string().trim().max(140).optional().or(z.literal("")),
  reference: z.string().trim().max(120).optional().or(z.literal("")),
  concept: z.string().trim().min(1, "El concepto es obligatorio.").max(500),
  amount: z.coerce.number().positive("El monto debe ser mayor a cero."),
});

export const cancelLedgerMovementSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, "El motivo debe tener al menos 5 caracteres.")
    .max(500),
});

export const ledgerMovementQuerySchema = z.object({
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  direction: z.enum(["INCOME", "EXPENSE"]).optional(),
  status: z.enum(["ACTIVE", "CANCELLED"]).optional(),
  name: z.string().optional(),
  reference: z.string().optional(),
  concept: z.string().optional(),
  amountMin: z.coerce.number().min(0).optional(),
  amountMax: z.coerce.number().min(0).optional(),
  accountId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
  orderBy: z.enum(["occurredAt", "sequenceNumber"]).default("occurredAt"),
  orderDir: z.enum(["asc", "desc"]).default("asc"),
});

export const moduleDryRunSchema = z.object({
  mode: z
    .enum(["preserve-data", "purge-data", "purge-owned-tables"])
    .optional(),
});

export const moduleClearErrorSchema = z.object({
  mode: z.enum(["metadata-only", "preserve-data"]).default("preserve-data"),
});

export const moduleCleanupDryRunSchema = z.object({
  mode: z.enum(["purge-empty-tables"]).default("purge-empty-tables"),
});

export const moduleCleanupSchema = z
  .object({
    mode: z.enum(["purge-empty-tables"]).default("purge-empty-tables"),
    confirmation: z.string().trim(),
  })
  .refine((data) => data.confirmation === "ACEPTO", {
    message: 'Debes escribir "ACEPTO" para confirmar la limpieza.',
    path: ["confirmation"],
  });

export const moduleUninstallSchema = z
  .object({
    mode: z
      .enum(["preserve-data", "purge-data", "purge-owned-tables"])
      .optional(),
    confirmation: z.string().trim().optional(),
  })
  .refine(
    (data) =>
      (data.mode !== "purge-data" && data.mode !== "purge-owned-tables") ||
      data.confirmation === "ACEPTO",
    {
      message:
        'Para purgar datos debes escribir "ACEPTO" en el campo de confirmación.',
      path: ["confirmation"],
    },
  );

export const moduleResetSchema = z
  .object({
    confirmation: z.string().trim(),
  })
  .refine((data) => data.confirmation === "ACEPTO", {
    message: 'Debes escribir "ACEPTO" para confirmar el reinicio.',
    path: ["confirmation"],
  });

// ---------------------------------------------------------------------------
// runly.activity
// ---------------------------------------------------------------------------

const ACTIVITY_SEVERITIES = ["info", "success", "warning", "critical"];
const ACTIVITY_PAYLOAD_MAX_BYTES = 4096;

export const activityPublishSchema = z
  .object({
    type: z.string().trim().min(1).max(100),
    summary: z.string().trim().min(1).max(500),
    entityType: z.string().trim().min(1).max(100).optional(),
    entityId: z.string().uuid().optional(),
    severity: z.enum(ACTIVITY_SEVERITIES).optional(),
    payload: z.record(z.any()).optional(),
    link: z.string().trim().max(500).optional(),
    companyId: z.string().uuid().optional(),
    actorId: z.string().uuid().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.payload === undefined) return;
    let size = 0;
    try {
      size = Buffer.byteLength(JSON.stringify(data.payload), "utf8");
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload"],
        message: "Payload no serializable.",
      });
      return;
    }
    if (size > ACTIVITY_PAYLOAD_MAX_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["payload"],
        message: `Payload demasiado grande (${size}B > ${ACTIVITY_PAYLOAD_MAX_BYTES}B). Usa el campo "link".`,
      });
    }
  });

export const activityListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
  entityType: z.string().trim().min(1).max(100).optional(),
  entityId: z.string().uuid().optional(),
  type: z.string().trim().min(1).max(100).optional(),
  actorId: z.string().uuid().optional(),
  severity: z.enum(ACTIVITY_SEVERITIES).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(200).optional(),
  search: z.string().trim().max(200).optional(),
  sortBy: z
    .enum(["createdAt", "type", "severity", "entityType", "source"])
    .optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
  ids: z.array(z.string().uuid()).optional(),
});

export const ACTIVITY_CONSTANTS = {
  severities: ACTIVITY_SEVERITIES,
  payloadMaxBytes: ACTIVITY_PAYLOAD_MAX_BYTES,
};

// ---------------------------------------------------------------------------
// runly.notifications
// ---------------------------------------------------------------------------

const NOTIFICATION_CHANNELS = ["in_app", "email", "web_push"];
const NOTIFICATION_PRIORITIES = ["low", "medium", "high", "critical"];

export const notificationPublishSchema = z.object({
  eventType: z.string().trim().min(1).max(100),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().max(1000).optional(),
  link: z.string().trim().max(500).optional(),
  recipients: z.object({
    userIds: z.array(z.string().uuid()).min(1).max(300),
  }),
  channels: z
    .array(z.enum(NOTIFICATION_CHANNELS))
    .min(1)
    .max(3)
    .optional()
    .default(["in_app"]),
  priority: z.enum(NOTIFICATION_PRIORITIES).optional().default("medium"),
  sourceType: z.string().trim().max(100).optional(),
  sourceId: z.string().trim().max(200).optional(),
  sourceActivityId: z.string().uuid().optional(),
  metadata: z.record(z.any()).optional(),
  dedupeKey: z.string().trim().max(200).optional(),
  expiresAt: z.coerce.date().optional(),
});

export const notificationListQuerySchema = z.object({
  unreadOnly: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) =>
      typeof value === "boolean" ? value : value === "true",
    )
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().uuid().optional(),
  priority: z.enum(NOTIFICATION_PRIORITIES).optional(),
  eventType: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().trim().max(200).optional(),
});

export const webPushSubscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  keys: z.object({
    p256dh: z.string().min(1).max(500),
    auth: z.string().min(1).max(200),
  }),
  deviceLabel: z.string().trim().max(120).optional(),
});

export const fcmSubscriptionSchema = z.object({
  token: z.string().trim().min(1).max(500),
  deviceLabel: z.string().trim().max(120).optional(),
});

export const notificationPreferenceUpsertSchema = z.object({
  eventType: z.string().trim().min(1).max(100),
  inAppEnabled: z.boolean().optional().default(true),
  emailEnabled: z.boolean().optional().default(false),
  pushEnabled: z.boolean().optional().default(false),
  muteUntil: z.coerce.date().optional().nullable(),
});

export const NOTIFICATION_CONSTANTS = {
  channels: NOTIFICATION_CHANNELS,
  priorities: NOTIFICATION_PRIORITIES,
};

// ---------------------------------------------------------------------------
// runly.growth
// ---------------------------------------------------------------------------

export const GROWTH_LEAD_STATUSES = [
  "new",
  "follow_up",
  "qualified",
  "discarded",
  "converted",
];

export const GROWTH_LEAD_PRIORITIES = ["low", "normal", "high"];

const growthOptionalText = (max) =>
  z.string().trim().max(max).optional().nullable();

export const growthLeadCreateSchema = z.object({
  siteId: z.string().uuid().optional(),
  formId: z.string().uuid().optional().nullable(),
  name: z.string().trim().min(1).max(500),
  email: growthOptionalText(500),
  phone: growthOptionalText(100),
  companyName: growthOptionalText(500),
  message: growthOptionalText(5000),
  priority: z.enum(GROWTH_LEAD_PRIORITIES).default("normal"),
  assigneeUserId: z.string().uuid().optional().nullable(),
  attribution: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const growthLeadUpdateSchema = z
  .object({
    updatedAt: z.string().datetime({ offset: true }),
    status: z.enum(GROWTH_LEAD_STATUSES).optional(),
    priority: z.enum(GROWTH_LEAD_PRIORITIES).optional(),
    assigneeUserId: z.string().uuid().optional().nullable(),
    discardReason: growthOptionalText(1000),
    name: z.string().trim().min(1).max(500).optional(),
    email: growthOptionalText(500),
    phone: growthOptionalText(100),
    companyName: growthOptionalText(500),
    message: growthOptionalText(5000),
  })
  .refine(
    (value) => Object.keys(value).some((key) => key !== "updatedAt"),
    "Incluye al menos un cambio.",
  );

export const growthLeadNoteSchema = z.object({
  note: z.string().trim().min(1).max(5000),
  updatedAt: z.string().datetime({ offset: true }),
});

export const growthLeadEnabledSchema = z.object({
  enabled: z.boolean(),
  updatedAt: z.string().datetime({ offset: true }),
});

export const growthLeadConvertSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("existing"),
    contactId: z.string().uuid(),
    updatedAt: z.string().datetime({ offset: true }),
  }),
  z.object({
    mode: z.literal("create"),
    updatedAt: z.string().datetime({ offset: true }),
    contact: z.object({
      type: z.string().trim().min(1).max(100),
      name: z.string().trim().min(1).max(500),
      email: growthOptionalText(500),
      phone: growthOptionalText(100),
    }),
  }),
]);

export const growthLeadQuerySchema = z.object({
  status: z.enum(GROWTH_LEAD_STATUSES).optional(),
  priority: z.enum(GROWTH_LEAD_PRIORITIES).optional(),
  assigneeId: z.string().uuid().optional(),
  formId: z.string().uuid().optional(),
  campaign: z.string().trim().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().max(200).optional(),
  enabled: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) =>
      typeof value === "boolean" ? value : value === "true",
    )
    .default(true),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});

const GROWTH_ANALYTICS_MAX_DAYS = 762;
const GROWTH_ANALYTICS_REPORTS = [
  "overview",
  "acquisition",
  "content",
  "conversions",
  "retention",
];

const growthAnalyticsDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Usa el formato AAAA-MM-DD.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.getTime()) &&
      // eslint-disable-next-line no-restricted-syntax -- deliberate UTC: round-trips a UTC-constructed date against the input string
      date.toISOString().slice(0, 10) === value
    );
  }, "Fecha invalida.");

const growthAnalyticsCompareSchema = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) =>
    typeof value === "boolean" ? value : value === "true",
  )
  .default(false);

const growthAnalyticsQueryBaseSchema = z.object({
  from: growthAnalyticsDateSchema.optional(),
  to: growthAnalyticsDateSchema.optional(),
  compare: growthAnalyticsCompareSchema,
  siteId: z.string().uuid().optional(),
});

function validateGrowthAnalyticsRange(value, context) {
  if (!value.from || !value.to) return;
  const from = Date.parse(`${value.from}T00:00:00.000Z`);
  const to = Date.parse(`${value.to}T00:00:00.000Z`);
  const days = Math.floor((to - from) / (24 * 60 * 60 * 1000)) + 1;
  if (days < 1 || days > GROWTH_ANALYTICS_MAX_DAYS) {
    context.addIssue({
      code: "custom",
      path: ["to"],
      message: "El rango debe contener entre 1 dia y 25 meses.",
    });
  }
}

export const growthAnalyticsQuerySchema =
  growthAnalyticsQueryBaseSchema.superRefine(validateGrowthAnalyticsRange);

export const growthAnalyticsExportQuerySchema =
  growthAnalyticsQueryBaseSchema
    .extend({
      report: z.enum(GROWTH_ANALYTICS_REPORTS),
    })
    .superRefine(validateGrowthAnalyticsRange);

export const growthPropertyCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().min(1).max(300).optional(),
});

export const growthPropertyUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    domain: z.string().trim().min(1).max(300).nullable().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: "No hay cambios para aplicar.",
  });

const documentBlockIdSchema = z.string().trim().min(1).max(100);
const documentPathSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)*$/);
const documentColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const documentAlignSchema = z.enum(["left", "center", "right"]);

const documentBindingTextSchema = z
  .string()
  .max(10000)
  .superRefine((value, ctx) => {
    for (const match of value.matchAll(/\{\{([^{}]+)\}\}/g)) {
      if (!documentPathSchema.safeParse(match[1].trim()).success) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Los bindings solo admiten rutas simples.",
        });
      }
    }
    if (value.replace(/\{\{[^{}]+\}\}/g, "").includes("{{")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El binding no tiene un formato valido.",
      });
    }
  });

const documentExactBindingSchema = z
  .string()
  .trim()
  .max(204)
  .regex(
    /^\{\{[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)*\}\}$/,
    "Se requiere un binding simple.",
  );

const headingBlockSchema = z
  .object({
    id: documentBlockIdSchema,
    type: z.literal("heading"),
    text: documentBindingTextSchema.min(1).max(500),
    level: z.number().int().min(1).max(3).default(2),
    align: documentAlignSchema.default("left"),
  })
  .strict();

const paragraphBlockSchema = z
  .object({
    id: documentBlockIdSchema,
    type: z.literal("paragraph"),
    text: documentBindingTextSchema,
    align: documentAlignSchema.default("left"),
  })
  .strict();

const fieldItemSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    value: documentBindingTextSchema.max(500),
  })
  .strict();

const fieldsBlockSchema = z
  .object({
    id: documentBlockIdSchema,
    type: z.literal("fields"),
    title: documentBindingTextSchema.min(1).max(200).optional(),
    columns: z.number().int().min(1).max(3).default(2),
    fields: z.array(fieldItemSchema).min(1).max(40),
  })
  .strict();

const tableColumnSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    value: documentPathSchema,
    width: z.number().int().min(40).max(500).optional(),
  })
  .strict();

const tableBlockSchema = z
  .object({
    id: documentBlockIdSchema,
    type: z.literal("table"),
    title: documentBindingTextSchema.min(1).max(200).optional(),
    collection: documentPathSchema,
    columns: z.array(tableColumnSchema).min(1).max(12),
    maxRows: z.number().int().min(1).max(500).default(100),
  })
  .strict();

const totalRowSchema = z
  .object({
    label: z.string().trim().min(1).max(120),
    value: documentBindingTextSchema.max(500),
  })
  .strict();

const totalsBlockSchema = z
  .object({
    id: documentBlockIdSchema,
    type: z.literal("totals"),
    rows: z.array(totalRowSchema).min(1).max(20),
  })
  .strict();

const imageBlockSchema = z
  .object({
    id: documentBlockIdSchema,
    type: z.literal("image"),
    source: documentExactBindingSchema,
    width: z.number().int().min(16).max(500).default(160),
    height: z.number().int().min(16).max(700).optional(),
    align: documentAlignSchema.default("left"),
  })
  .strict();

const dividerBlockSchema = z
  .object({
    id: documentBlockIdSchema,
    type: z.literal("divider"),
    thickness: z.number().min(0.5).max(8).default(1),
    color: documentColorSchema.default("#D1D5DB"),
  })
  .strict();

const spacerBlockSchema = z
  .object({
    id: documentBlockIdSchema,
    type: z.literal("spacer"),
    height: z.number().int().min(4).max(200),
  })
  .strict();

const signatureBlockSchema = z
  .object({
    id: documentBlockIdSchema,
    type: z.literal("signature"),
    source: documentExactBindingSchema,
    label: documentBindingTextSchema.max(120).optional(),
    width: z.number().int().min(40).max(300).default(160),
    height: z.number().int().min(20).max(200).optional(),
  })
  .strict();

const pageBreakBlockSchema = z
  .object({
    id: documentBlockIdSchema,
    type: z.literal("pageBreak"),
  })
  .strict();

export const documentBlockSchema = z.discriminatedUnion("type", [
  headingBlockSchema,
  paragraphBlockSchema,
  fieldsBlockSchema,
  tableBlockSchema,
  totalsBlockSchema,
  imageBlockSchema,
  dividerBlockSchema,
  spacerBlockSchema,
  signatureBlockSchema,
  pageBreakBlockSchema,
]);

export const documentBlocksSchema = z
  .array(documentBlockSchema)
  .min(1)
  .max(100)
  .superRefine((blocks, ctx) => {
    const ids = new Set();
    blocks.forEach((block, index) => {
      if (ids.has(block.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "id"],
          message: "Los identificadores de bloque deben ser unicos.",
        });
      }
      ids.add(block.id);
    });
  });

function documentBindingPaths(value) {
  if (typeof value === "string") {
    return [...value.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) =>
      match[1].trim(),
    );
  }
  if (Array.isArray(value)) return value.flatMap(documentBindingPaths);
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(documentBindingPaths);
  }
  return [];
}

export function validateDocumentBindings({ blocks, providerSchema }) {
  const fields = new Set(
    (providerSchema?.fields ?? []).map((field) => field.path),
  );
  const collections = new Map(
    (providerSchema?.collections ?? []).map((collection) => [
      collection.path,
      new Set((collection.fields ?? []).map((field) => field.path)),
    ]),
  );
  const issues = [];

  for (const block of blocks ?? []) {
    if (block.type === "table") {
      const collectionFields = collections.get(block.collection);
      if (!collectionFields) {
        issues.push({
          blockId: block.id,
          path: block.collection,
          code: "unknown_collection",
        });
      } else {
        for (const column of block.columns ?? []) {
          if (!collectionFields.has(column.value)) {
            issues.push({
              blockId: block.id,
              path: `${block.collection}.${column.value}`,
              code: "unknown_collection_field",
            });
          }
        }
      }
    }

    for (const path of new Set(documentBindingPaths(block))) {
      if (!fields.has(path)) {
        issues.push({
          blockId: block.id,
          path,
          code: "unknown_binding",
        });
      }
    }
  }

  return issues;
}

const documentTemplateKeySchema = z
  .string()
  .trim()
  .min(2)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const documentOptionalTextSchema = (max) =>
  z.string().trim().max(max).optional().nullable();

export const documentTemplateCreateSchema = z
  .object({
    key: documentTemplateKeySchema,
    name: z.string().trim().min(2).max(200),
    description: documentOptionalTextSchema(1000),
    sourceType: documentPathSchema,
  })
  .strict();

export const documentTemplateUpdateSchema = z
  .object({
    updatedAt: z.string().datetime({ offset: true }),
    key: documentTemplateKeySchema.optional(),
    name: z.string().trim().min(2).max(200).optional(),
    description: documentOptionalTextSchema(1000),
    sourceType: documentPathSchema.optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).some((key) => key !== "updatedAt"),
    "Incluye al menos un cambio.",
  );

export const documentTemplateEnabledSchema = z
  .object({
    enabled: z.boolean(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const documentTemplateQuerySchema = z
  .object({
    sourceType: documentPathSchema.optional(),
    search: z.string().trim().max(200).optional(),
    enabled: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((value) =>
        typeof value === "boolean" ? value : value === "true",
      )
      .default(true),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(25),
  })
  .strict();

export const documentVersionCreateSchema = z
  .object({
    blocks: documentBlocksSchema,
  })
  .strict();

export const documentVersionUpdateSchema = z
  .object({
    updatedAt: z.string().datetime({ offset: true }),
    blocks: documentBlocksSchema,
  })
  .strict();

export const documentVersionPublishSchema = z
  .object({
    updatedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const documentRenderSchema = z
  .object({
    sourceId: z.string().uuid(),
    versionId: z.string().uuid().optional(),
  })
  .strict();

export const documentGeneratedQuerySchema = z
  .object({
    templateId: z.string().uuid().optional(),
    sourceType: documentPathSchema.optional(),
    sourceId: z.string().uuid().optional(),
    status: z.enum(["pending", "ready", "failed"]).optional(),
    enabled: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((value) =>
        typeof value === "boolean" ? value : value === "true",
      )
      .default(true),
    page: z.coerce.number().int().positive().default(1),
    pageSize: z.coerce.number().int().positive().max(100).default(25),
  })
  .strict();

export const documentGeneratedEnabledSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export * from './chat.js';
export * from './calls.js';
export * from './notes.js';
