import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  StorefrontCaptureError,
  createStorefrontCaptureService,
} from "../storefront-capture-service.js";
import {
  filterSafeEventProperties,
  storefrontEventBatchSchema,
} from "../../routes/storefront/storefront-capture-validators.js";

const COMPANY_ID = "01900000-0000-7000-8000-000000000001";
const SITE_ID = "01900000-0000-7000-8000-000000000002";
const FORM_ID = "01900000-0000-7000-8000-000000000003";
const VISITOR_DB_ID = "01900000-0000-7000-8000-000000000004";
const SESSION_DB_ID = "01900000-0000-7000-8000-000000000005";
const SUBMISSION_ID = "01900000-0000-7000-8000-000000000006";
const LEAD_ID = "01900000-0000-7000-8000-000000000007";
const NOW = new Date("2026-06-14T18:00:00.000Z");

function buildPrisma({ formOverrides = {}, ...overrides } = {}) {
  const state = {
    visitors: [],
    sessions: [],
    events: [],
    submissions: [],
    leads: [],
    activities: [],
    audits: [],
  };

  const form = {
    id: FORM_ID,
    companyId: COMPANY_ID,
    siteId: SITE_ID,
    name: "Contacto",
    description: null,
    submitLabel: "Enviar",
    successMessage: "Gracias",
    createsLead: true,
    defaultAssigneeUserId: null,
    honeypotEnabled: true,
    turnstileRequired: false,
    enabled: true,
    fields: [
      {
        id: "field-name",
        name: "full_name",
        label: "Nombre",
        fieldType: "text",
        semanticKey: "name",
        required: true,
        options: null,
        sortOrder: 0,
        enabled: true,
      },
      {
        id: "field-email",
        name: "email",
        label: "Correo",
        fieldType: "email",
        semanticKey: "email",
        required: true,
        options: null,
        sortOrder: 1,
        enabled: true,
      },
      {
        id: "field-phone",
        name: "phone",
        label: "Telefono",
        fieldType: "phone",
        semanticKey: "phone",
        required: false,
        options: null,
        sortOrder: 2,
        enabled: true,
      },
      {
        id: "field-message",
        name: "message",
        label: "Mensaje",
        fieldType: "textarea",
        semanticKey: "message",
        required: false,
        options: null,
        sortOrder: 3,
        enabled: true,
      },
    ],
    ...formOverrides,
  };

  function applyData(row, data) {
    for (const [key, value] of Object.entries(data)) {
      if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.hasOwn(value, "increment")
      ) {
        row[key] = (row[key] ?? 0) + value.increment;
      } else {
        row[key] = value;
      }
    }
  }

  const prisma = {
    _state: state,
    company: {
      findFirst: async ({ where }) =>
        where.slug === "acme" ? { id: COMPANY_ID, slug: "acme" } : null,
    },
    websiteSite: {
      findFirst: async ({ where }) =>
        (!where.id || where.id === SITE_ID) && where.companyId === COMPANY_ID
          ? {
              id: SITE_ID,
              companyId: COMPANY_ID,
              name: "Tienda",
              domain: "https://shop.example.com",
              analyticsMode: "anonymous",
              turnstileSiteKey: "public-key",
              turnstileSecretKey: "encrypted-secret",
              sourceType: "dist",
              enabled: true,
            }
          : null,
      findMany: async ({ where }) =>
        where.companyId === COMPANY_ID
          ? [
              {
                id: SITE_ID,
                companyId: COMPANY_ID,
                name: "Tienda",
                domain: "https://shop.example.com",
                analyticsMode: "anonymous",
                turnstileSiteKey: "public-key",
                turnstileSecretKey: "encrypted-secret",
                enabled: true,
              },
            ]
          : [],
    },
    growthProperty: {
      findFirst: async ({ where }) =>
        (!where.id || where.id === SITE_ID) && where.companyId === COMPANY_ID
          ? {
              id: SITE_ID,
              companyId: COMPANY_ID,
              kind: "website_module",
              websiteSiteId: SITE_ID,
              name: "Tienda",
              domain: "https://shop.example.com",
              status: "active",
              analyticsMode: "anonymous",
              turnstileSiteKey: "public-key",
              turnstileSecretKey: "encrypted-secret",
              enabled: true,
            }
          : null,
      findMany: async ({ where }) =>
        where.companyId === COMPANY_ID
          ? [
              {
                id: SITE_ID,
                companyId: COMPANY_ID,
                kind: "website_module",
                websiteSiteId: SITE_ID,
                name: "Tienda",
                domain: "https://shop.example.com",
                status: "active",
                analyticsMode: "anonymous",
                turnstileSiteKey: "public-key",
                turnstileSecretKey: "encrypted-secret",
                enabled: true,
              },
            ]
          : [],
      upsert: async ({ where }) => {
        const key = where.companyId_websiteSiteId;
        return {
          id: key.websiteSiteId,
          companyId: key.companyId,
          kind: "website_module",
          websiteSiteId: key.websiteSiteId,
          name: "Tienda",
          domain: "https://shop.example.com",
          status: "active",
          analyticsMode: "anonymous",
          turnstileSiteKey: "public-key",
          turnstileSecretKey: "encrypted-secret",
          enabled: true,
        };
      },
    },
    growthVisitor: {
      upsert: async ({ where, create, update }) => {
        const key = where.siteId_visitorKeyHash.visitorKeyHash;
        let row = state.visitors.find((item) => item.visitorKeyHash === key);
        if (row) applyData(row, update);
        else {
          row = { id: VISITOR_DB_ID, ...create };
          state.visitors.push(row);
        }
        return row;
      },
    },
    growthSession: {
      upsert: async ({ where, create, update }) => {
        const key = where.siteId_sessionKeyHash.sessionKeyHash;
        let row = state.sessions.find((item) => item.sessionKeyHash === key);
        if (row) applyData(row, update);
        else {
          row = { id: SESSION_DB_ID, ...create };
          state.sessions.push(row);
        }
        return row;
      },
      update: async ({ where, data }) => {
        const row = state.sessions.find((item) => item.id === where.id);
        applyData(row, data);
        return row;
      },
    },
    growthEvent: {
      findMany: async ({ where }) =>
        state.events
          .filter(
            (item) =>
              item.siteId === where.siteId &&
              where.idempotencyKey.in.includes(item.idempotencyKey),
          )
          .map((item) => ({ idempotencyKey: item.idempotencyKey })),
      createMany: async ({ data }) => {
        let count = 0;
        for (const event of data) {
          if (
            state.events.some(
              (item) =>
                item.siteId === event.siteId &&
                item.idempotencyKey === event.idempotencyKey,
            )
          ) {
            continue;
          }
          state.events.push(event);
          count += 1;
        }
        return { count };
      },
    },
    websiteForm: {
      findFirst: async ({ where }) =>
        where.id === FORM_ID &&
        where.companyId === COMPANY_ID &&
        where.siteId === SITE_ID
          ? form
          : null,
    },
    websiteFormSubmission: {
      findUnique: async ({ where }) =>
        state.submissions.find(
          (item) =>
            item.formId === where.formId_idempotencyKey.formId &&
            item.idempotencyKey ===
              where.formId_idempotencyKey.idempotencyKey,
        ) ?? null,
      create: async ({ data }) => {
        const row = { id: SUBMISSION_ID, ...data };
        state.submissions.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = state.submissions.find((item) => item.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    growthLead: {
      findFirst: async ({ where }) => {
        const candidates = where.OR ?? [];
        return (
          state.leads.find(
            (lead) =>
              lead.enabled &&
              lead.convertedAt == null &&
              candidates.some((candidate) =>
                candidate.emailNormalized
                  ? candidate.emailNormalized === lead.emailNormalized
                  : candidate.phoneNormalized === lead.phoneNormalized,
              ),
          ) ?? null
        );
      },
      create: async ({ data }) => {
        const row = { id: LEAD_ID, convertedAt: null, ...data };
        state.leads.push(row);
        return row;
      },
      update: async ({ where, data }) => {
        const row = state.leads.find((item) => item.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    growthLeadActivity: {
      create: async ({ data }) => {
        const row = { id: `activity-${state.activities.length + 1}`, ...data };
        state.activities.push(row);
        return row;
      },
    },
    auditLog: {
      create: async ({ data }) => {
        const row = { id: `audit-${state.audits.length + 1}`, ...data };
        state.audits.push(row);
        return row;
      },
    },
    $transaction: async (callback) => callback(prisma),
  };

  Object.assign(prisma, overrides);
  return prisma;
}

function createService(prisma, options = {}) {
  return createStorefrontCaptureService({
    prisma,
    now: () => NOW,
    verifyTurnstile: options.verifyTurnstile ?? (async () => true),
    notificationService: options.notificationService,
    smtpService: options.smtpService,
  });
}

const requestScope = {
  companySlug: "acme",
  siteId: SITE_ID,
  origin: "https://shop.example.com",
};

describe("storefront capture validators", () => {
  it("accepts at most 50 events and rejects unsafe batch shapes", () => {
    const valid = storefrontEventBatchSchema.safeParse({
      visitorId: "visitor-opaque",
      sessionId: "session-opaque",
      consent: "granted",
      events: Array.from({ length: 50 }, (_, index) => ({
        id: `evt-${index}`,
        name: "page_view",
        occurredAt: NOW.toISOString(),
        path: "/",
        properties: {},
      })),
    });
    assert.equal(valid.success, true);

    const invalid = storefrontEventBatchSchema.safeParse({
      visitorId: "visitor-opaque",
      sessionId: "session-opaque",
      consent: "granted",
      events: Array.from({ length: 51 }, (_, index) => ({
        id: `evt-${index}`,
        name: "page_view",
        occurredAt: NOW.toISOString(),
      })),
    });
    assert.equal(invalid.success, false);
  });

  it("filters PII keys, nested values, and excessive properties", () => {
    const safe = filterSafeEventProperties({
      cta: "hero",
      count: 2,
      active: true,
      formId: FORM_ID,
      submissionId: SUBMISSION_ID,
      formValues: { email: "client@example.com" },
      values: "not allowed",
      email: "client@example.com",
      authorization: "Bearer secret",
      nested: { value: "not allowed" },
      ...Object.fromEntries(
        Array.from({ length: 25 }, (_, index) => [`key${index}`, index]),
      ),
    });

    assert.equal(safe.email, undefined);
    assert.equal(safe.authorization, undefined);
    assert.equal(safe.nested, undefined);
    assert.equal(safe.formValues, undefined);
    assert.equal(safe.values, undefined);
    assert.ok(Object.keys(safe).length <= 20);
    assert.equal(safe.cta, "hero");
    assert.equal(safe.formId, FORM_ID);
    assert.equal(safe.submissionId, SUBMISSION_ID);
  });
});

describe("createStorefrontCaptureService", () => {
  it("resolves the company/site scope and rejects mismatched sites", async () => {
    const service = createService(buildPrisma());
    const scope = await service.resolveSite(requestScope);
    assert.equal(scope.company.id, COMPANY_ID);
    assert.equal(scope.site.id, SITE_ID);

    await assert.rejects(
      () => service.resolveSite({ ...requestScope, siteId: "other-site" }),
      (error) =>
        error instanceof StorefrontCaptureError &&
        error.code === "site_not_found" &&
        error.status === 404,
    );
  });

  it("rejects requests from an origin outside the configured domain", async () => {
    const service = createService(buildPrisma());
    await assert.rejects(
      () =>
        service.captureEvents({
          ...requestScope,
          origin: "https://attacker.example",
          dnt: false,
          payload: {
            visitorId: "visitor",
            sessionId: "session",
            consent: "granted",
            events: [
              {
                id: "event-1",
                name: "page_view",
                occurredAt: NOW.toISOString(),
              },
            ],
          },
        }),
      (error) =>
        error instanceof StorefrontCaptureError &&
        error.code === "origin_forbidden" &&
        error.status === 403,
    );
  });

  it("enforces DNT and consent policy before writing analytics", async () => {
    const prisma = buildPrisma();
    const service = createService(prisma);

    await assert.rejects(
      () =>
        service.captureEvents({
          ...requestScope,
          dnt: true,
          payload: {
            visitorId: "visitor",
            sessionId: "session",
            consent: "granted",
            events: [
              {
                id: "event-1",
                name: "page_view",
                occurredAt: NOW.toISOString(),
              },
            ],
          },
        }),
      (error) => error.code === "tracking_disabled",
    );
    assert.equal(prisma._state.events.length, 0);

    prisma.growthProperty.findFirst = async () => ({
      id: SITE_ID,
      companyId: COMPANY_ID,
      kind: "website_module",
      websiteSiteId: SITE_ID,
      domain: "https://shop.example.com",
      analyticsMode: "consent_required",
      enabled: true,
    });
    await assert.rejects(
      () =>
        service.captureEvents({
          ...requestScope,
          dnt: false,
          payload: {
            visitorId: "visitor",
            sessionId: "session",
            consent: "denied",
            events: [
              {
                id: "event-2",
                name: "page_view",
                occurredAt: NOW.toISOString(),
              },
            ],
          },
        }),
      (error) => error.code === "consent_required",
    );
  });

  it("hashes opaque IDs, normalizes client clocks, filters properties, and deduplicates events", async () => {
    const prisma = buildPrisma();
    const service = createService(prisma);
    const payload = {
      visitorId: "visitor-raw-id",
      sessionId: "session-raw-id",
      consent: "granted",
      events: [
        {
          id: "event-1",
          name: "page_view",
          occurredAt: "2020-01-01T00:00:00.000Z",
          path: "/productos",
          formId: FORM_ID,
          submissionId: SUBMISSION_ID,
          properties: {
            cta: "hero",
            formId: FORM_ID,
            email: "client@example.com",
            nested: { secret: true },
          },
        },
      ],
    };

    const first = await service.captureEvents({
      ...requestScope,
      dnt: false,
      payload,
    });
    const replay = await service.captureEvents({
      ...requestScope,
      dnt: false,
      payload,
    });

    assert.equal(first.accepted, 1);
    assert.equal(replay.accepted, 0);
    assert.equal(prisma._state.sessions[0].eventCount, 1);
    assert.equal(prisma._state.sessions[0].pageviewCount, 1);
    assert.notEqual(
      prisma._state.visitors[0].visitorKeyHash,
      payload.visitorId,
    );
    assert.notEqual(
      prisma._state.sessions[0].sessionKeyHash,
      payload.sessionId,
    );
    assert.equal(
      prisma._state.events[0].clientOccurredAt.toISOString(),
      NOW.toISOString(),
    );
    assert.deepEqual(prisma._state.events[0].properties, { cta: "hero" });
    assert.equal(prisma._state.events[0].formId, FORM_ID);
    assert.equal(prisma._state.events[0].submissionId, SUBMISSION_ID);
  });

  it("marks sessions engaged after two pageviews or ten visible seconds", async () => {
    const prisma = buildPrisma();
    const service = createService(prisma);
    await service.captureEvents({
      ...requestScope,
      dnt: false,
      payload: {
        visitorId: "visitor-engaged",
        sessionId: "session-engaged",
        consent: "granted",
        events: [
          {
            id: "event-page-1",
            name: "page_view",
            occurredAt: NOW.toISOString(),
          },
          {
            id: "event-page-2",
            name: "page_view",
            occurredAt: NOW.toISOString(),
          },
        ],
      },
    });

    assert.equal(prisma._state.sessions[0].engaged, true);
  });

  it("validates configured form fields before creating a submission", async () => {
    const prisma = buildPrisma();
    const service = createService(prisma);

    await assert.rejects(
      () =>
        service.submitForm({
          ...requestScope,
          formId: FORM_ID,
          idempotencyKey: "submission-1",
          payload: {
            values: { full_name: "", email: "not-an-email" },
            honeypot: "",
          },
        }),
      (error) =>
        error.code === "form_validation_failed" &&
        error.status === 422 &&
        Boolean(error.details.fields.email),
    );
    assert.equal(prisma._state.submissions.length, 0);
  });

  it("blocks honeypot hits and required Turnstile failures", async () => {
    const prisma = buildPrisma();
    const service = createService(prisma, {
      verifyTurnstile: async () => false,
    });

    await assert.rejects(
      () =>
        service.submitForm({
          ...requestScope,
          formId: FORM_ID,
          idempotencyKey: "submission-honeypot",
          payload: {
            values: { full_name: "Bot", email: "bot@example.com" },
            honeypot: "filled",
          },
        }),
      (error) => error.code === "spam_detected",
    );

    const originalFindFirst = prisma.websiteForm.findFirst;
    prisma.websiteForm.findFirst = async (args) => ({
      ...(await originalFindFirst(args)),
      turnstileRequired: true,
    });
    await assert.rejects(
      () =>
        service.submitForm({
          ...requestScope,
          formId: FORM_ID,
          idempotencyKey: "submission-turnstile",
          payload: {
            values: { full_name: "Ana", email: "ana@example.com" },
            honeypot: "",
            turnstileToken: "bad-token",
          },
        }),
      (error) =>
        error.code === "turnstile_failed" && error.status === 422,
    );
  });

  it("returns the original result for an idempotent submission replay", async () => {
    const prisma = buildPrisma();
    prisma._state.submissions.push({
      id: SUBMISSION_ID,
      formId: FORM_ID,
      idempotencyKey: "submission-replay",
      leadId: LEAD_ID,
    });
    const service = createService(prisma);

    const result = await service.submitForm({
      ...requestScope,
      formId: FORM_ID,
      idempotencyKey: "submission-replay",
      payload: {
        values: { full_name: "Ana", email: "ana@example.com" },
        honeypot: "",
      },
    });

    assert.equal(result.replayed, true);
    assert.equal(result.submissionId, SUBMISSION_ID);
    assert.equal(result.leadId, LEAD_ID);
    assert.equal(prisma._state.activities.length, 0);
  });

  it("reuses an open lead by normalized email or phone and keeps each activity", async () => {
    const prisma = buildPrisma();
    prisma._state.leads.push({
      id: LEAD_ID,
      companyId: COMPANY_ID,
      emailNormalized: "ana@example.com",
      phoneNormalized: "+525512345678",
      enabled: true,
      status: "follow_up",
      convertedAt: null,
    });
    const service = createService(prisma);

    const result = await service.submitForm({
      ...requestScope,
      formId: FORM_ID,
      idempotencyKey: "submission-new",
      payload: {
        values: {
          full_name: "Ana",
          email: " ANA@EXAMPLE.COM ",
          phone: "+52 (55) 1234-5678",
          message: "Necesito informacion",
        },
        honeypot: "",
      },
    });

    assert.equal(result.leadId, LEAD_ID);
    assert.equal(prisma._state.leads.length, 1);
    assert.equal(prisma._state.submissions.length, 1);
    assert.equal(prisma._state.activities.length, 1);
    assert.equal(prisma._state.activities[0].sourceId, SUBMISSION_ID);
    assert.deepEqual(prisma._state.activities[0].payload, { formId: FORM_ID });
    assert.equal(
      JSON.stringify(prisma._state.activities[0]).includes(
        "Necesito informacion",
      ),
      false,
    );
  });

  it("creates submission, lead, and activity through one transaction", async () => {
    const prisma = buildPrisma();
    let transactionCalls = 0;
    prisma.$transaction = async (callback) => {
      transactionCalls += 1;
      return callback(prisma);
    };
    const service = createService(prisma);

    const result = await service.submitForm({
      ...requestScope,
      formId: FORM_ID,
      idempotencyKey: "submission-atomic",
      payload: {
        values: { full_name: "Luis", email: "luis@example.com" },
        visitorId: "visitor",
        sessionId: "session",
        honeypot: "",
      },
    });

    assert.equal(transactionCalls, 1);
    assert.equal(result.submissionId, SUBMISSION_ID);
    assert.equal(result.leadId, LEAD_ID);
    assert.equal(prisma._state.submissions[0].leadId, LEAD_ID);
    assert.deepEqual(prisma._state.audits, [
      {
        id: "audit-1",
        actorId: null,
        moduleKey: "runly.growth",
        entityType: "growth.lead",
        entityId: LEAD_ID,
        action: "growth.lead.create",
        before: null,
        after: {
          status: "new",
          priority: "normal",
          source: "website_form",
          assigneeUserId: null,
        },
        metadata: {
          companyId: COMPANY_ID,
          siteId: SITE_ID,
          formId: FORM_ID,
          submissionId: SUBMISSION_ID,
        },
      },
    ]);
  });

  it("notifies the default assignee only when a new web lead is created", async () => {
    const prisma = buildPrisma();
    const published = [];
    const originalFindFirst = prisma.websiteForm.findFirst;
    prisma.websiteForm.findFirst = async (args) => ({
      ...(await originalFindFirst(args)),
      defaultAssigneeUserId: "01900000-0000-7000-8000-000000000009",
    });
    const service = createService(prisma, {
      notificationService: {
        publish: async (input) => {
          published.push(input);
        },
      },
    });

    await service.submitForm({
      ...requestScope,
      formId: FORM_ID,
      idempotencyKey: "submission-notification",
      payload: {
        values: { full_name: "Ana", email: "ana@example.com" },
        honeypot: "",
      },
    });

    assert.equal(published.length, 1);
    assert.equal(published[0].input.eventType, "growth.lead.created");
    assert.deepEqual(published[0].input.recipients.userIds, [
      "01900000-0000-7000-8000-000000000009",
    ]);
    assert.equal(published[0].input.sourceId, LEAD_ID);
  });

  it("sends an SMTP notification when the form has notifyEmail set", async () => {
    const sentEmails = [];
    const service = createService(
      buildPrisma({ formOverrides: { notifyEmail: "owner@example.com" } }),
      { smtpService: { sendEmail: async (args) => { sentEmails.push(args); } } },
    );

    await service.submitForm({
      ...requestScope,
      formId: FORM_ID,
      idempotencyKey: "submission-notify-1",
      payload: {
        values: { full_name: "Ana", email: "ana@example.com" },
        honeypot: "",
      },
    });

    assert.equal(sentEmails.length, 1);
    assert.equal(sentEmails[0].to, "owner@example.com");
    assert.equal(sentEmails[0].companyId, COMPANY_ID);
  });

  it("does not fail the submission when SMTP is unconfigured", async () => {
    const service = createService(
      buildPrisma({ formOverrides: { notifyEmail: "owner@example.com" } }),
      { smtpService: { sendEmail: async () => { throw new Error("SMTP no configurado"); } } },
    );

    const result = await service.submitForm({
      ...requestScope,
      formId: FORM_ID,
      idempotencyKey: "submission-notify-2",
      payload: {
        values: { full_name: "Ana", email: "ana@example.com" },
        honeypot: "",
      },
    });

    assert.ok(result.submissionId);
  });
});
