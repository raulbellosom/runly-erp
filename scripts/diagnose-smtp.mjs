// SMTP diagnostics for the platform/identity mail slot (password reset, etc.)
// — the one createSmtpService({ prisma }) resolves with no companyId, which
// falls back to SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM_*/SMTP_TLS
// from the environment when nothing is saved in Ajustes -> SMTP.
//
// Read-only by default: shows which SMTP_* env vars were actually loaded
// into the process (booleans only, never values) and what createSmtpService
// resolves as the effective config source. Never prints the password.
//
// Pass an email as the first argument to also send a real test message to it
// (uses your real SMTP credentials) — this is the only way to see the actual
// connection/auth error nodemailer gets, since the app swallows it for the
// public forgot-password endpoint by design (no account enumeration).
//
// Run (check only):   node --env-file=.env scripts/diagnose-smtp.mjs
// Run (send a test):  node --env-file=.env scripts/diagnose-smtp.mjs you@example.com
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createSmtpService } from '../apps/api/src/services/smtp-service.js';

const testRecipient = process.argv[2] ?? null;

const envPresence = {
  SMTP_HOST: Boolean(process.env.SMTP_HOST),
  SMTP_PORT: process.env.SMTP_PORT ?? '(default 587)',
  SMTP_USER: Boolean(process.env.SMTP_USER),
  SMTP_PASS: Boolean(process.env.SMTP_PASS),
  SMTP_FROM_NAME: process.env.SMTP_FROM_NAME || '(empty)',
  SMTP_FROM_EMAIL: Boolean(process.env.SMTP_FROM_EMAIL) || '(falls back to SMTP_USER)',
  SMTP_TLS: process.env.SMTP_TLS ?? 'false',
};

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const timeout = setTimeout(() => {
  console.error('SMTP diagnostics timed out connecting to the database.');
  process.exit(1);
}, 20000);

try {
  const smtp = createSmtpService({ prisma });
  const status = await smtp.getStatus();
  const config = await smtp.getConfig().catch((err) => {
    console.error('getConfig() threw:', err.message);
    return null;
  });

  console.log(JSON.stringify({
    envVarsLoadedIntoProcess: envPresence,
    resolvedStatus: status,
    resolvedSource: config
      ? `host=${config.host} port=${config.port} user=${config.user} fromEmail=${config.fromEmail}`
      : 'nothing resolved — neither Ajustes -> SMTP nor SMTP_* env vars produced a usable config',
  }, null, 2));

  if (!config) {
    console.log('\nNothing to test — fix the above first (most likely: forgot to restart the API process after editing .env, since it only reads env vars at startup).');
  } else if (testRecipient) {
    console.log(`\nSending a real test email to ${testRecipient} using the config above...`);
    try {
      await smtp.sendEmail({
        to: testRecipient,
        subject: 'Runly ERP — diagnóstico SMTP',
        text: 'Si ves este correo, tu configuración SMTP (Ajustes -> SMTP o variables SMTP_*) funciona correctamente.',
        html: '<p>Si ves este correo, tu configuración SMTP (Ajustes -&gt; SMTP o variables <code>SMTP_*</code>) funciona correctamente.</p>',
      });
      console.log('Sent — check the inbox (and spam) for', testRecipient);
    } catch (err) {
      console.error('Send failed — this is the real nodemailer error the app normally swallows:');
      console.error(err.message);
    }
  } else {
    console.log('\nConfig resolves OK. Pass an email as an argument to actually send a test message and confirm delivery end to end.');
  }
} catch (error) {
  console.error('SMTP diagnostics failed:', error.message);
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  await prisma.$disconnect();
}
