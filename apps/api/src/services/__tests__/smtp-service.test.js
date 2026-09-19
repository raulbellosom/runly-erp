import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import { createSmtpService, createWebsiteSmtpService, encryptPassword, SmtpConfigError } from "../smtp-service.js";

// encryptPassword / decryptPassword derive their AES key from JWT_SECRET, so a
// value encrypted under one secret is unreadable once the secret changes.
const ORIGINAL_SECRET = process.env.JWT_SECRET;

function prismaWith(configRows) {
  return {
    instanceConfig: {
      findMany: async ({ where }) => {
        const wanted = new Set(where.key.in);
        return configRows.filter((r) => wanted.has(r.key));
      },
    },
  };
}

describe("createSmtpService.getStatus / isConfigured", () => {
  before(() => { process.env.JWT_SECRET = "secret-A-used-to-encrypt"; });
  after(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = ORIGINAL_SECRET;
  });

  it("reports not_configured when no SMTP rows exist", async () => {
    const svc = createSmtpService({ prisma: prismaWith([]) });
    assert.deepEqual(await svc.getStatus(), { configured: false, reason: "not_configured" });
    assert.equal(await svc.isConfigured(), false);
  });

  it("reports configured when host + user + a decryptable password are present", async () => {
    const rows = [
      { key: "smtp.host", value: "smtp.example.com" },
      { key: "smtp.user", value: "bot@example.com" },
      { key: "smtp.pass", value: encryptPassword("hunter2") },
    ];
    const svc = createSmtpService({ prisma: prismaWith(rows) });
    const status = await svc.getStatus();
    assert.equal(status.configured, true);
    assert.equal(status.reason, null);
    assert.equal(await svc.isConfigured(), true);
  });

  it("reports undecryptable_password (not a raw crypto throw) when JWT_SECRET rotated", async () => {
    const rows = [
      { key: "smtp.host", value: "smtp.example.com" },
      { key: "smtp.user", value: "bot@example.com" },
      { key: "smtp.pass", value: encryptPassword("hunter2") }, // encrypted under secret-A
    ];
    process.env.JWT_SECRET = "secret-B-rotated-in";

    const svc = createSmtpService({ prisma: prismaWith(rows) });
    const status = await svc.getStatus();
    assert.equal(status.configured, false);
    assert.equal(status.reason, "undecryptable_password");
    assert.match(status.message, /JWT_SECRET/);

    // isConfigured() must degrade to false, never throw.
    assert.equal(await svc.isConfigured(), false);

    // getConfig() surfaces the typed error for callers that want the detail.
    await assert.rejects(() => svc.getConfig(), (err) => {
      assert.ok(err instanceof SmtpConfigError);
      assert.equal(err.reason, "undecryptable_password");
      return true;
    });
  });
});

describe("SMTP transport encryption", () => {
  const services = [
    { name: "platform", create: createSmtpService, prefix: "smtp" },
    { name: "website", create: createWebsiteSmtpService, prefix: "website.smtp" },
    { name: "website platform fallback", create: createWebsiteSmtpService, prefix: "smtp" },
  ];
  const cases = [
    { port: 587, tls: true, secure: false },
    { port: 587, tls: false, secure: false },
    { port: 25, tls: true, secure: false },
    { port: 25, tls: false, secure: false },
    { port: 465, tls: true, secure: true },
    { port: 465, tls: false, secure: true },
    // Preserve explicit implicit-TLS settings for nonstandard ports.
    { port: 2465, tls: true, secure: true },
    { port: 2525, tls: false, secure: false },
  ];

  for (const service of services) {
    for (const scenario of cases) {
      it(`${service.name}: port ${scenario.port}, TLS ${scenario.tls}`, async (t) => {
        const sendMail = t.mock.fn(async () => ({}));
        const transport = t.mock.method(nodemailer, "createTransport", () => ({ sendMail }));
        const rows = Object.entries({
          host: "smtp.example.com", user: "bot@example.com",
          port: String(scenario.port), tls: String(scenario.tls),
        }).map(([key, value]) => ({ key: `${service.prefix}.${key}`, value }));
        const svc = service.create({ prisma: prismaWith(rows) });
        await svc.sendEmail({ to: "recipient@example.com", subject: "SMTP test", text: "Hello" });

        const options = transport.mock.calls[0].arguments[0];
        assert.equal(options.port, scenario.port);
        assert.equal(options.secure, scenario.secure);
        assert.equal(options.requireTLS, scenario.tls);
        assert.equal(options.ignoreTLS, undefined);
        assert.equal(options.tls?.rejectUnauthorized, undefined);
        assert.equal(sendMail.mock.calls[0].arguments[0].to, "recipient@example.com");
      });
    }

    it(`${service.name}: does not retry without TLS when sending fails`, async (t) => {
      const error = new Error("STARTTLS failed");
      const sendMail = t.mock.fn(async () => { throw error; });
      const transport = t.mock.method(nodemailer, "createTransport", () => ({ sendMail }));
      const rows = Object.entries({
        host: "smtp.example.com", user: "bot@example.com", port: "587", tls: "true",
      }).map(([key, value]) => ({ key: `${service.prefix}.${key}`, value }));
      const svc = service.create({ prisma: prismaWith(rows) });
      await assert.rejects(svc.sendEmail({ to: "recipient@example.com", text: "Hello" }), error);
      assert.equal(transport.mock.callCount(), 1);
      assert.equal(sendMail.mock.callCount(), 1);
    });
  }
});
