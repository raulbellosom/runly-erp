import { createHash } from "node:crypto";

import {
  publicFormSubmissionSchema,
  storefrontEventBatchSchema,
} from "../routes/storefront/storefront-capture-validators.js";
import { createGrowthPropertyService } from "../routes/growth/growth-property-service.js";

const CLIENT_CLOCK_TOLERANCE_MS = 24 * 60 * 60 * 1000;
const OPEN_LEAD_STATUSES = ["new", "follow_up", "qualified"];
const CONVERSION_EVENTS = new Set([
  "form_submit",
  "lead_created",
  "qualified",
  "converted",
]);

export class StorefrontCaptureError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message);
    this.name = "StorefrontCaptureError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function parseDomainOrigin(domain) {
  if (!domain) return null;
  try {
    const value = String(domain).trim();
    return new URL(
      value.includes("://") ? value : `https://${value}`,
    ).origin.toLowerCase();
  } catch {
    return null;
  }
}

function normalizePhone(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const hasPlus = raw.startsWith("+");
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  return `${hasPlus ? "+" : ""}${digits}`;
}

function normalizeEmail(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || null;
}

function normalizeText(value, maxLength = 5000) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim().slice(0, maxLength);
  return normalized || null;
}

function isPrismaUniqueError(error) {
  return error?.code === "P2002";
}

export function createStorefrontCaptureService({
  prisma,
  verifyTurnstile = async () => false,
  notificationService = null,
  now = () => new Date(),
  growthPropertyService = createGrowthPropertyService({ prisma, now }),
}) {
  function hashOpaqueId(siteId, value) {
    return createHash("sha256")
      .update(`${siteId}:${String(value)}`)
      .digest("hex");
  }

  function normalizeClientDate(value) {
    const serverNow = now();
    const clientDate = new Date(value);
    if (
      Number.isNaN(clientDate.getTime()) ||
      Math.abs(serverNow.getTime() - clientDate.getTime()) >
        CLIENT_CLOCK_TOLERANCE_MS
    ) {
      return serverNow;
    }
    return clientDate;
  }

  function assertAllowedOrigin(site, origin) {
    if (!origin) return;
    let requestOrigin;
    try {
      requestOrigin = new URL(origin).origin.toLowerCase();
    } catch {
      throw new StorefrontCaptureError(
        "origin_forbidden",
        "Origen no permitido.",
        403,
      );
    }

    const configuredOrigin = parseDomainOrigin(site.domain);
    if (!configuredOrigin) return;
    if (configuredOrigin === requestOrigin) return;

    // Also allow submissions from the ERP host itself — the ERP serves
    // the storefront site at ATLAS_APP_URL, so its origin is always trusted.
    const erpOrigin = parseDomainOrigin(process.env.RUNLY_APP_URL);
    if (erpOrigin && erpOrigin === requestOrigin) return;

    throw new StorefrontCaptureError(
      "origin_forbidden",
      "Origen no permitido.",
      403,
    );
  }

  function assertAnalyticsPolicy(site, { dnt, consent }) {
    if (dnt === true || dnt === "1") {
      throw new StorefrontCaptureError(
        "tracking_disabled",
        "El seguimiento esta deshabilitado.",
        403,
      );
    }
    if (site.analyticsMode === "off") {
      throw new StorefrontCaptureError(
        "tracking_disabled",
        "El seguimiento esta deshabilitado.",
        403,
      );
    }
    if (
      site.analyticsMode === "consent_required" &&
      consent !== "granted"
    ) {
      throw new StorefrontCaptureError(
        "consent_required",
        "Se requiere consentimiento para registrar analitica.",
        403,
      );
    }
  }

  async function resolveSite({ companySlug, siteId, origin }) {
    const normalizedCompanySlug = String(companySlug ?? "").trim();
    if (!normalizedCompanySlug) {
      throw new StorefrontCaptureError(
        "company_required",
        "La empresa es requerida.",
        400,
      );
    }

    const company = await prisma.company.findFirst({
      where: { slug: normalizedCompanySlug, enabled: true },
      select: { id: true, slug: true },
    });
    if (!company) {
      throw new StorefrontCaptureError(
        "company_not_found",
        "Empresa no encontrada.",
        404,
      );
    }

    const site = await growthPropertyService.resolveProperty({
      companyId: company.id,
      propertyId: siteId,
    });
    if (!site) {
      throw new StorefrontCaptureError(
        "site_not_found",
        "Sitio no encontrado.",
        404,
      );
    }

    assertAllowedOrigin(site, origin);
    return { company, site };
  }

  async function getPublicConfig(input) {
    // Skip origin check — this is read-only config (analytics policy, capabilities).
    // Origin enforcement applies only to write operations (events, form submissions).
    const { site } = await resolveSite({ ...input, origin: undefined });
    return {
      siteId: site.id,
      analyticsMode: site.analyticsMode,
      respectDoNotTrack: true,
      turnstileSiteKey: site.turnstileSiteKey ?? null,
      capabilities: {
        analytics: site.analyticsMode !== "off",
        forms: true,
      },
    };
  }

  async function captureEvents({
    companySlug,
    siteId,
    origin,
    dnt,
    authenticatedProfileId = null,
    payload,
  }) {
    const parsed = storefrontEventBatchSchema.safeParse(payload);
    if (!parsed.success) {
      throw new StorefrontCaptureError(
        "invalid_event_batch",
        "El lote de eventos no es valido.",
        422,
        parsed.error.flatten(),
      );
    }

    const { company, site } = await resolveSite({
      companySlug,
      siteId,
      origin,
    });
    assertAnalyticsPolicy(site, {
      dnt,
      consent: parsed.data.consent,
    });

    const visitorKeyHash = hashOpaqueId(site.id, parsed.data.visitorId);
    const sessionKeyHash = hashOpaqueId(site.id, parsed.data.sessionId);
    const serverNow = now();
    const firstEvent = parsed.data.events[0];

    return prisma.$transaction(async (tx) => {
      const visitor = await tx.growthVisitor.upsert({
        where: {
          siteId_visitorKeyHash: {
            siteId: site.id,
            visitorKeyHash,
          },
        },
        create: {
          companyId: company.id,
          siteId: site.id,
          visitorKeyHash,
          consentState: parsed.data.consent,
          authenticatedProfileId,
          firstSource: null,
          lastSource: null,
          firstSeenAt: serverNow,
          lastSeenAt: serverNow,
        },
        update: {
          consentState: parsed.data.consent,
          ...(authenticatedProfileId ? { authenticatedProfileId } : {}),
          lastSeenAt: serverNow,
        },
      });

      const existingEvents = await tx.growthEvent.findMany({
        where: {
          siteId: site.id,
          idempotencyKey: {
            in: parsed.data.events.map((event) => event.id),
          },
        },
        select: { idempotencyKey: true },
      });
      const existingKeys = new Set(
        existingEvents.map((event) => event.idempotencyKey),
      );
      const pendingEvents = parsed.data.events.filter(
        (event) => !existingKeys.has(event.id),
      );

      const session = await tx.growthSession.upsert({
        where: {
          siteId_sessionKeyHash: {
            siteId: site.id,
            sessionKeyHash,
          },
        },
        create: {
          companyId: company.id,
          siteId: site.id,
          visitorId: visitor.id,
          sessionKeyHash,
          startedAt: serverNow,
          lastSeenAt: serverNow,
          landingPath: firstEvent.path ?? null,
          exitPath: firstEvent.path ?? null,
          eventCount: 0,
          pageviewCount: 0,
          visibleSeconds: 0,
          hasConversion: false,
          engaged: false,
        },
        update: {
          lastSeenAt: serverNow,
          exitPath:
            parsed.data.events.at(-1)?.path ?? firstEvent.path ?? null,
        },
      });

      const result = pendingEvents.length
        ? await tx.growthEvent.createMany({
            data: pendingEvents.map((event) => {
              const {
                formId: _formId,
                submissionId: _submissionId,
                ...properties
              } = event.properties ?? {};
              return {
                companyId: company.id,
                siteId: site.id,
                visitorId: visitor.id,
                sessionId: session.id,
                eventName: event.name,
                idempotencyKey: event.id,
                clientOccurredAt: normalizeClientDate(event.occurredAt),
                serverReceivedAt: serverNow,
                path: event.path ?? null,
                referrer: event.referrer ?? null,
                properties,
                sourceType: site.sourceType ?? null,
                formId: event.formId ?? null,
                submissionId: event.submissionId ?? null,
                consentState: parsed.data.consent,
              };
            }),
            skipDuplicates: true,
          })
        : { count: 0 };

      const acceptedEvents = pendingEvents.slice(0, result.count);
      if (acceptedEvents.length) {
        const pageviewCount = acceptedEvents.filter(
          (event) => event.name === "page_view",
        ).length;
        const visibleSeconds = acceptedEvents.reduce((total, event) => {
          if (event.name !== "visible_time") return total;
          const seconds = Number(event.properties?.seconds ?? 0);
          return total + (Number.isFinite(seconds) ? Math.max(0, seconds) : 0);
        }, 0);
        const hasConversion = acceptedEvents.some((event) =>
          CONVERSION_EVENTS.has(event.name),
        );
        const roundedVisibleSeconds = Math.round(visibleSeconds);
        const engaged =
          session.engaged ||
          hasConversion ||
          (session.pageviewCount ?? 0) + pageviewCount >= 2 ||
          (session.visibleSeconds ?? 0) + roundedVisibleSeconds >= 10;
        await tx.growthSession.update({
          where: { id: session.id },
          data: {
            eventCount: { increment: acceptedEvents.length },
            pageviewCount: { increment: pageviewCount },
            visibleSeconds: { increment: roundedVisibleSeconds },
            ...(hasConversion ? { hasConversion: true } : {}),
            ...(engaged ? { engaged: true } : {}),
          },
        });
      }

      return {
        accepted: result.count,
        rejected: [],
      };
    });
  }

  async function getPublicForm({ companySlug, siteId, formId, origin }) {
    const { company, site } = await resolveSite({
      companySlug,
      siteId,
      origin,
    });
    const form = await prisma.websiteForm.findFirst({
      where: {
        id: formId,
        companyId: company.id,
        siteId: site.id,
        enabled: true,
      },
      include: {
        fields: {
          where: { enabled: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });
    if (!form) {
      throw new StorefrontCaptureError(
        "form_not_found",
        "Formulario no encontrado.",
        404,
      );
    }
    return form;
  }

  function validateFormValues(form, values) {
    const errors = {};
    const cleanValues = {};
    const enabledFields = form.fields.filter((field) => field.enabled !== false);
    const allowedNames = new Set(enabledFields.map((field) => field.name));

    for (const field of enabledFields) {
      const value = values[field.name];
      const empty =
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim() === "");

      if (field.required && empty) {
        errors[field.name] = "Este campo es obligatorio.";
        continue;
      }
      if (empty) continue;

      if (field.fieldType === "email") {
        const email = normalizeEmail(value);
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          errors[field.name] = "Ingresa un correo valido.";
          continue;
        }
        cleanValues[field.name] = email;
        continue;
      }

      if (field.fieldType === "number") {
        const numberValue = Number(value);
        if (!Number.isFinite(numberValue)) {
          errors[field.name] = "Ingresa un numero valido.";
          continue;
        }
        cleanValues[field.name] = numberValue;
        continue;
      }

      if (["select", "radio"].includes(field.fieldType)) {
        const options = Array.isArray(field.options) ? field.options : [];
        if (options.length && !options.includes(value)) {
          errors[field.name] = "Selecciona una opcion valida.";
          continue;
        }
      }

      if (typeof value === "boolean") {
        cleanValues[field.name] = value;
        continue;
      }

      cleanValues[field.name] = String(value).slice(0, 5000);
    }

    for (const key of Object.keys(values)) {
      if (!allowedNames.has(key)) {
        errors[key] = "Campo no permitido.";
      }
    }

    if (Object.keys(errors).length) {
      throw new StorefrontCaptureError(
        "form_validation_failed",
        "Revisa los campos del formulario.",
        422,
        { fields: errors },
      );
    }
    return cleanValues;
  }

  function extractLeadFields(form, values) {
    const lead = {
      name: null,
      email: null,
      emailNormalized: null,
      phone: null,
      phoneNormalized: null,
      companyName: null,
      message: null,
    };

    for (const field of form.fields) {
      const value = values[field.name];
      if (value === undefined || value === null) continue;
      switch (field.semanticKey) {
        case "name":
          lead.name = normalizeText(value, 500);
          break;
        case "email":
          lead.email = normalizeText(value, 500);
          lead.emailNormalized = normalizeEmail(value);
          break;
        case "phone":
          lead.phone = normalizeText(value, 100);
          lead.phoneNormalized = normalizePhone(value);
          break;
        case "company":
          lead.companyName = normalizeText(value, 500);
          break;
        case "message":
          lead.message = normalizeText(value);
          break;
        default:
          break;
      }
    }
    return lead;
  }

  async function submitForm({
    companySlug,
    siteId,
    formId,
    origin,
    idempotencyKey,
    payload,
  }) {
    const normalizedIdempotencyKey = String(idempotencyKey ?? "").trim();
    if (!normalizedIdempotencyKey) {
      throw new StorefrontCaptureError(
        "idempotency_key_required",
        "Idempotency-Key es requerido.",
        400,
      );
    }

    const parsed = publicFormSubmissionSchema.safeParse(payload);
    if (!parsed.success) {
      throw new StorefrontCaptureError(
        "invalid_form_submission",
        "El envio no es valido.",
        422,
        parsed.error.flatten(),
      );
    }

    const { company, site } = await resolveSite({
      companySlug,
      siteId,
      origin,
    });
    const form = await getPublicForm({
      companySlug,
      siteId: site.id,
      formId,
      origin,
    });

    const existing = await prisma.websiteFormSubmission.findUnique({
      where: {
        formId_idempotencyKey: {
          formId: form.id,
          idempotencyKey: normalizedIdempotencyKey,
        },
      },
    });
    if (existing) {
      return {
        submissionId: existing.id,
        leadId: existing.leadId ?? null,
        message: form.successMessage ?? "Formulario enviado.",
        replayed: true,
      };
    }

    if (form.honeypotEnabled && parsed.data.honeypot.trim()) {
      throw new StorefrontCaptureError(
        "spam_detected",
        "El envio fue rechazado.",
        422,
      );
    }

    if (form.turnstileRequired) {
      const verified =
        Boolean(parsed.data.turnstileToken) &&
        (await verifyTurnstile({
          token: parsed.data.turnstileToken,
          encryptedSecretKey: site.turnstileSecretKey,
          site,
        }));
      if (!verified) {
        throw new StorefrontCaptureError(
          "turnstile_failed",
          "No fue posible validar el CAPTCHA.",
          422,
        );
      }
    }

    const cleanValues = validateFormValues(form, parsed.data.values);
    const leadFields = extractLeadFields(form, cleanValues);
    const visitorKeyHash = parsed.data.visitorId
      ? hashOpaqueId(site.id, parsed.data.visitorId)
      : null;
    const sessionKeyHash = parsed.data.sessionId
      ? hashOpaqueId(site.id, parsed.data.sessionId)
      : null;

    try {
      const transactionResult = await prisma.$transaction(async (tx) => {
        const visitor = visitorKeyHash
          ? await tx.growthVisitor.findUnique?.({
              where: {
                siteId_visitorKeyHash: {
                  siteId: site.id,
                  visitorKeyHash,
                },
              },
              select: { id: true },
            })
          : null;
        const session = sessionKeyHash
          ? await tx.growthSession.findUnique?.({
              where: {
                siteId_sessionKeyHash: {
                  siteId: site.id,
                  sessionKeyHash,
                },
              },
              select: { id: true },
            })
          : null;

        const submission = await tx.websiteFormSubmission.create({
          data: {
            companyId: company.id,
            formId: form.id,
            data: cleanValues,
            idempotencyKey: normalizedIdempotencyKey,
            visitorId: visitor?.id ?? null,
            sessionId: session?.id ?? null,
          },
        });

        let lead = null;
        let createdLead = false;
        if (form.createsLead) {
          const identities = [
            ...(leadFields.emailNormalized
              ? [{ emailNormalized: leadFields.emailNormalized }]
              : []),
            ...(leadFields.phoneNormalized
              ? [{ phoneNormalized: leadFields.phoneNormalized }]
              : []),
          ];

          if (identities.length) {
            lead = await tx.growthLead.findFirst({
              where: {
                companyId: company.id,
                enabled: true,
                convertedAt: null,
                status: { in: OPEN_LEAD_STATUSES },
                OR: identities,
              },
            });
          }

          const leadData = {
            ...leadFields,
            source: "website_form",
            attribution: null,
            assigneeUserId: form.defaultAssigneeUserId ?? null,
            lastSubmissionAt: now(),
            lastSeenAt: now(),
          };
          if (lead) {
            lead = await tx.growthLead.update({
              where: { id: lead.id },
              data: leadData,
            });
          } else {
            lead = await tx.growthLead.create({
              data: {
                companyId: company.id,
                siteId: site.id,
                formId: form.id,
                status: "new",
                priority: "normal",
                ...leadData,
                firstSubmissionAt: now(),
                firstSeenAt: now(),
              },
            });
            createdLead = true;
          }

          await tx.websiteFormSubmission.update({
            where: { id: submission.id },
            data: { leadId: lead.id },
          });
          if (createdLead) {
            await tx.auditLog.create({
              data: {
                actorId: null,
                moduleKey: "runly.growth",
                entityType: "growth.lead",
                entityId: lead.id,
                action: "growth.lead.create",
                before: null,
                after: {
                  status: lead.status,
                  priority: lead.priority,
                  source: lead.source,
                  assigneeUserId: lead.assigneeUserId ?? null,
                },
                metadata: {
                  companyId: company.id,
                  siteId: site.id,
                  formId: form.id,
                  submissionId: submission.id,
                },
              },
            });
          }
          await tx.growthLeadActivity.create({
            data: {
              companyId: company.id,
              siteId: site.id,
              leadId: lead.id,
              activityType: "form_submission",
              sourceType: "website_form_submission",
              sourceId: submission.id,
              payload: { formId: form.id },
              occurredAt: now(),
            },
          });
        }

        return {
          submissionId: submission.id,
          leadId: lead?.id ?? null,
          message: form.successMessage ?? "Formulario enviado.",
          replayed: false,
          notifyAssignee:
            createdLead && lead?.assigneeUserId
              ? {
                  userId: lead.assigneeUserId,
                  leadId: lead.id,
                  title: lead.name || lead.email || "Lead web",
                  priority: lead.priority,
                }
              : null,
        };
      });
      if (transactionResult.notifyAssignee && notificationService?.publish) {
        const notification = transactionResult.notifyAssignee;
        try {
          await notificationService.publish({
            companyId: company.id,
            actorId: null,
            input: {
              eventType: "growth.lead.created",
              title: "Nuevo lead asignado",
              body: notification.title,
              link: `/app/m/runly.growth/leads/${notification.leadId}`,
              recipients: { userIds: [notification.userId] },
              channels: ["in_app", "email", "web_push"],
              priority:
                notification.priority === "high" ? "high" : "medium",
              sourceType: "GrowthLead",
              sourceId: notification.leadId,
              metadata: { leadId: notification.leadId },
            },
          });
        } catch (error) {
          console.error(
            "[growth.lead.created]",
            error?.message ?? error,
          );
        }
      }
      const { notifyAssignee: _notifyAssignee, ...result } =
        transactionResult;
      return result;
    } catch (error) {
      if (isPrismaUniqueError(error)) {
        const replay = await prisma.websiteFormSubmission.findUnique({
          where: {
            formId_idempotencyKey: {
              formId: form.id,
              idempotencyKey: normalizedIdempotencyKey,
            },
          },
        });
        if (replay) {
          return {
            submissionId: replay.id,
            leadId: replay.leadId ?? null,
            message: form.successMessage ?? "Formulario enviado.",
            replayed: true,
          };
        }
      }
      throw error;
    }
  }

  return {
    resolveSite,
    getPublicConfig,
    captureEvents,
    getPublicForm,
    submitForm,
  };
}
