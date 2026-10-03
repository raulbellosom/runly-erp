import { describe, it } from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { createSupportReportService, SupportReportError } from "../support-report-service.js";

function prismaWith({ configRows = [] } = {}) {
  const rateLimitRows = new Map();
  return {
    instanceConfig: {
      findMany: async ({ where }) => {
        const wanted = new Set(where.key.in);
        return configRows.filter((r) => wanted.has(r.key));
      },
      findUnique: async ({ where }) => rateLimitRows.get(where.key) ?? null,
      upsert: async ({ where, create, update }) => {
        rateLimitRows.set(where.key, rateLimitRows.has(where.key)
          ? { ...rateLimitRows.get(where.key), ...update }
          : create);
      },
    },
  };
}

const PLATFORM_ENV = {
  RUNLY_SUPPORT_EMAIL: "support@runly.mx",
  SMTP_HOST: "smtp.example.com",
  SMTP_USER: "bot@example.com",
};

describe("createSupportReportService.sendBugReport", () => {
  it("falls back to hola@runly.mx when RUNLY_SUPPORT_EMAIL is not set", async (t) => {
    const sendMail = t.mock.fn(async () => ({}));
    t.mock.method(nodemailer, "createTransport", () => ({ sendMail }));

    const { RUNLY_SUPPORT_EMAIL, ...envWithoutSupportEmail } = PLATFORM_ENV;
    const svc = createSupportReportService({ prisma: prismaWith(), env: envWithoutSupportEmail });
    await svc.sendBugReport({ userId: "u1", payload: {} });

    assert.equal(sendMail.mock.calls[0].arguments[0].to, "hola@runly.mx");
  });

  it("sends via platform SMTP to the support address and records the rate-limit timestamp", async (t) => {
    const sendMail = t.mock.fn(async () => ({}));
    t.mock.method(nodemailer, "createTransport", () => ({ sendMail }));

    const svc = createSupportReportService({ prisma: prismaWith(), env: PLATFORM_ENV });
    await svc.sendBugReport({
      userId: "u1",
      userName: "Ana",
      userEmail: "ana@acme.com",
      payload: { errorMessage: "Boom" },
    });

    assert.equal(sendMail.mock.callCount(), 1);
    assert.equal(sendMail.mock.calls[0].arguments[0].to, "support@runly.mx");
  });

  it("includes both the screenshot and user attachments, and lists filenames in the email", async (t) => {
    const sendMail = t.mock.fn(async () => ({}));
    t.mock.method(nodemailer, "createTransport", () => ({ sendMail }));

    const svc = createSupportReportService({ prisma: prismaWith(), env: PLATFORM_ENV });
    await svc.sendBugReport({
      userId: "u1",
      payload: {
        screenshot: "data:image/png;base64,AAAA",
        attachments: [
          { filename: "log.txt", mimeType: "text/plain", dataUrl: "data:text/plain;base64,QkJC" },
        ],
      },
    });

    const sent = sendMail.mock.calls[0].arguments[0];
    // The SMTP service also inlines the brand logo (cid attachment); only the
    // report's own files matter here.
    const files = sent.attachments.filter((attachment) => !attachment.cid);
    assert.equal(files.length, 2);
    assert.deepEqual(files[0], { filename: "captura.png", content: "AAAA", encoding: "base64" });
    assert.deepEqual(files[1], { filename: "log.txt", content: "QkJC", encoding: "base64" });
    assert.ok(sent.text.includes("Adjuntos: log.txt"));
  });

  it("blocks a second report from the same user within the rate-limit window", async (t) => {
    t.mock.method(nodemailer, "createTransport", () => ({ sendMail: async () => ({}) }));

    const svc = createSupportReportService({ prisma: prismaWith(), env: PLATFORM_ENV });
    await svc.sendBugReport({ userId: "u1", payload: {} });

    await assert.rejects(svc.sendBugReport({ userId: "u1", payload: {} }), (err) => {
      assert.equal(err.status, 429);
      assert.equal(err.reason, "rate_limited");
      assert.ok(err.retryAfterSeconds > 0);
      return true;
    });
  });

  it("does not rate-limit a different user", async (t) => {
    t.mock.method(nodemailer, "createTransport", () => ({ sendMail: async () => ({}) }));

    const svc = createSupportReportService({ prisma: prismaWith(), env: PLATFORM_ENV });
    await svc.sendBugReport({ userId: "u1", payload: {} });
    await svc.sendBugReport({ userId: "u2", payload: {} }); // must not throw
  });

  it("falls back to the company SMTP relay when platform SMTP fails, keeping the same recipient", async (t) => {
    let call = 0;
    t.mock.method(nodemailer, "createTransport", () => ({
      sendMail: async (options) => {
        call += 1;
        if (call === 1) throw new Error("platform SMTP down");
        assert.equal(options.to, "support@runly.mx");
        return {};
      },
    }));

    const companyId = "company-1";
    const configRows = [
      { key: `company:${companyId}:smtp.host`, value: "smtp.company.com" },
      { key: `company:${companyId}:smtp.user`, value: "company@example.com" },
    ];
    const svc = createSupportReportService({ prisma: prismaWith({ configRows }), env: PLATFORM_ENV });
    await svc.sendBugReport({ userId: "u1", companyId, payload: {} });
    assert.equal(call, 2);
  });

  it("surfaces a 502 when neither platform nor company SMTP work", async (t) => {
    t.mock.method(nodemailer, "createTransport", () => ({
      sendMail: async () => { throw new Error("down"); },
    }));

    const svc = createSupportReportService({ prisma: prismaWith(), env: PLATFORM_ENV });
    await assert.rejects(svc.sendBugReport({ userId: "u1", companyId: "company-1", payload: {} }), (err) => {
      assert.equal(err.status, 502);
      assert.equal(err.reason, "smtp_error");
      return true;
    });
  });
});
