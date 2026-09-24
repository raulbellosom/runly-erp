#!/usr/bin/env node
import { canonicalizeRunlyEnvText } from "./lib/env-compat.mjs";
import { resolveDevKitDir } from './lib/devkit-installer.mjs';
import { configureOffice, checkOfficeRuntime } from "./lib/office-config.mjs";
import { configureFirebase } from "./lib/firebase-config.mjs";
import { resolveInstanceIdentity, renderInstanceIdentityEnv } from "./lib/instance-identity.mjs";
// setup-external.mjs
//
// Production setup: Runly ERP against an external (self-hosted or cloud) Supabase.
// Does NOT require npx or a local Supabase installation.
//
// Usage:
//   node setup-external.mjs                    # full setup
//   node setup-external.mjs --skip-pull        # skip docker pull (images already local)
//   node setup-external.mjs --skip-migrate     # skip db:migrate + db:seed
//   node setup-external.mjs --skip-dev-kit     # skip AME3 dev kit download
//   node setup-external.mjs --up-only          # only docker compose up, nothing else

import fs from "node:fs/promises";
import fsSync from "node:fs";
import { lookup } from "node:dns/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  buildLiveKitFirewallHint,
  getLiveKitComposeProfiles,
  normalizeLiveKitDomain,
  renderEgressConfig,
  renderLiveKitConfig,
  renderManagedCaddyfile,
  resolveLiveKitConfig,
  toLiveKitHttpUrl,
} from "./lib/livekit-config.mjs";
import { buildTranscriberDatabaseUrl, generateTranscriberPassword } from "./lib/transcriber-db.mjs";

const argv = new Set(process.argv.slice(2));
const skipPull    = argv.has("--skip-pull");
const skipMigrate = argv.has("--skip-migrate");
const skipDevKit  = argv.has("--skip-dev-kit");
const upOnly      = argv.has("--up-only");
const docsOnly    = argv.has("--docs-only");
const isWindows   = process.platform === "win32";

const __filename    = fileURLToPath(import.meta.url);
const __dirname     = path.dirname(__filename);
const installerDir  = __dirname;
const composeFile   = path.resolve(__dirname, "docker-compose.yml");
const linuxComposeOverride = path.resolve(__dirname, "docker-compose.linux.yml");
const envFile       = path.resolve(__dirname, ".env.external");
const envExampleFile = path.resolve(__dirname, ".env.external.example");
const devKitDir     = resolveDevKitDir(path.resolve(__dirname, "custom-modules"));
const liveKitConfigFile = path.resolve(__dirname, "livekit", "livekit.yaml");
const liveKitEgressConfigFile = path.resolve(__dirname, "livekit", "egress.yaml");
const liveKitCaddyFile = path.resolve(__dirname, "livekit", "Caddyfile");
const legacyLiveKitExternalProxyFile = path.resolve(__dirname, "livekit", "reverse-proxy.nginx.conf");
const isLinux = process.platform === "linux";
const composeFiles = isLinux && fsSync.existsSync(linuxComposeOverride)
  ? ["-f", composeFile, "-f", linuxComposeOverride]
  : ["-f", composeFile];

const docsRepoOwner = (process.env.RUNLY_DOCS_REPO_OWNER ?? process.env.ATLAS_DOCS_REPO_OWNER) ?? "raulbellosom";
const docsRepoName  = (process.env.RUNLY_DOCS_REPO_NAME ?? process.env.ATLAS_DOCS_REPO_NAME)  ?? "runly-erp";
const docsRepoRef   = (process.env.RUNLY_DOCS_REPO_REF ?? process.env.ATLAS_DOCS_REPO_REF)   ?? "main";
const docsRawBase   = (process.env.RUNLY_DOCS_RAW_BASE ?? process.env.ATLAS_DOCS_RAW_BASE)   ??
  `https://raw.githubusercontent.com/${docsRepoOwner}/${docsRepoName}/${docsRepoRef}`;
const DEVKIT_EXPORT_REPO_PATH = "infra/installer/devkit-export";

const apiImage    = (process.env.RUNLY_API_IMAGE ?? process.env.ATLAS_API_IMAGE)           ?? "raulbellosom/runlyerp:api-latest";
const workerImage = (process.env.RUNLY_WORKER_IMAGE ?? process.env.ATLAS_WORKER_IMAGE)        ?? "raulbellosom/runlyerp:worker-latest";
const webImage    = (process.env.RUNLY_WEB_EXTERNAL_IMAGE ?? process.env.ATLAS_WEB_EXTERNAL_IMAGE)  ?? "raulbellosom/runlyerp:web-latest";
const liveKitImage = process.env.LIVEKIT_IMAGE ?? "livekit/livekit-server:v1.12.0";
const liveKitRedisImage = process.env.LIVEKIT_REDIS_IMAGE ?? "redis:7-alpine";
const liveKitCaddyImage = process.env.LIVEKIT_CADDY_IMAGE ?? "caddy:2-alpine";
const liveKitEgressImage = process.env.LIVEKIT_EGRESS_IMAGE ?? "livekit/egress:v1.9.0";
const transcriberImage = process.env.RUNLY_TRANSCRIBER_IMAGE ?? "raulbellosom/runlyerp:transcriber-latest";
const ttsImage = process.env.RUNLY_TTS_IMAGE ?? "raulbellosom/runlyerp:tts-latest";

// ── helpers ──────────────────────────────────────────────────────────────────

function run(command, args, { cwd = installerDir, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: isWindows,
  });
  if (result.error) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function tryRun(command, args, { cwd = installerDir, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "inherit",
    shell: isWindows,
  });
  if (result.error) return false;
  return result.status === 0;
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function pullWithRetry(image, label, retries = 3, delayMs = 5000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`[setup-external] Pulling ${label} (attempt ${attempt}/${retries})...`);
    if (tryRun("docker", ["pull", image])) return image;
    if (attempt < retries) {
      console.warn(`[setup-external] Pull failed — retrying in ${delayMs / 1000}s...`);
      sleep(delayMs);
    }
  }
  throw new Error(
    `Could not pull ${label} image (${image}) after ${retries} attempts.\n` +
    `Pull it manually and re-run with --skip-pull.`
  );
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

function parseEnvValue(content, key) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 1) continue;
    if (trimmed.slice(0, eqIdx).trim() !== key) continue;
    const raw = trimmed.slice(eqIdx + 1);
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1);
    }
    return raw;
  }
  return undefined;
}

// See the matching comment in setup-local.mjs: Compose only interpolates
// docker-compose.yml from the shell environment or the auto-loaded ".env"
// file, never from .env.external's env_file: values — so these must be
// mirrored into ".env" to actually change published ports/names.
const COMPOSE_INTERPOLATION_KEYS = [
  "RUNLY_COMPOSE_PROJECT_NAME", "RUNLY_CONTAINER_PREFIX",
  "RUNLY_API_HOST_PORT", "RUNLY_WEB_HOST_PORT", "RUNLY_COLLABORA_HOST_PORT", "RUNLY_PUBLIC_BIND_ADDR",
  "LIVEKIT_HTTP_HOST_PORT", "LIVEKIT_RTC_TCP_PORT", "LIVEKIT_RTC_UDP_PORT", "LIVEKIT_REDIS_PORT",
  "LIVEKIT_TLS_HTTP_PORT", "LIVEKIT_TLS_HTTPS_PORT",
];

function composeInterpolationEnvLines(existingEnvContent) {
  return COMPOSE_INTERPOLATION_KEYS
    .map((key) => [key, process.env[key] ?? parseEnvValue(existingEnvContent, key)])
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

// Generates (once) and persists this installation's identity into
// .env.external, and exports it so every `docker compose` call in this
// process targets the right project/container names. Pre-existing installs
// (RUNLY_INSTANCE_ID already stored, or the file predates this feature) keep
// their resolved legacy project/container names — see resolveInstanceIdentity.
async function ensureInstanceIdentity(envFilePath) {
  const content = await fs.readFile(envFilePath, "utf8");
  const identity = resolveInstanceIdentity(content);
  if (!hasEnvKey(content, "RUNLY_INSTANCE_ID")) {
    await fs.appendFile(envFilePath, `\n${renderInstanceIdentityEnv(identity)}`, "utf8");
  }
  process.env.RUNLY_COMPOSE_PROJECT_NAME = identity.projectName;
  process.env.RUNLY_CONTAINER_PREFIX = identity.containerPrefix;
  console.log(`  Instance identity: ${identity.instanceId} (project: ${identity.projectName}, containers: ${identity.containerPrefix}-*)`);
  return identity;
}

function hasEnvKey(content, key) {
  return content.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return false;
    const eqIdx = trimmed.indexOf("=");
    return eqIdx > 0 && trimmed.slice(0, eqIdx).trim() === key;
  });
}

const OPTIONAL_VAR_GROUPS = [
  {
    header: [
      "# ── Deployment (CORS + public URLs) ─────────────────────────────────────────",
      "# Set these when exposing Runly on a public domain (VPS + Nginx).",
      "# CORS_ORIGIN: public URL of the Runly web app (e.g. https://runly.yourdomain.com).",
      "# ATLAS_API_URL: public URL of the Runly API (e.g. https://api.yourdomain.com).",
      "#   The web container reads ATLAS_API_URL at startup to reach the API from the browser.",
    ],
    vars: [
      { key: "CORS_ORIGIN",    placeholder: "http://localhost:5173",  comment: null },
      { key: "ATLAS_API_URL",  placeholder: "http://localhost:4010",  comment: null },
      {
        key: "RUNLY_SUPABASE_PUBLIC_URL",
        placeholder: "",
        comment: "# Leave unset for managed Supabase Cloud (SUPABASE_URL is already public). Set only if SUPABASE_URL is an internal address the browser cannot resolve.",
      },
    ],
  },
  {
    header: [
      "# ── Identity-level SMTP (password reset, cross-company mail) ─────────────────",
      "# Ajustes -> SMTP configures a SPECIFIC COMPANY's outgoing mail and always wins",
      "# for that company. These vars are for mail that isn't any one company's",
      "# business (password reset above all) — used outright before the database is",
      "# even checked. Point them at your own mail provider. Leave empty and this",
      "# mail simply won't send until you set them (there is no UI for this slot).",
    ],
    vars: [
      { key: "SMTP_HOST",      placeholder: "",            comment: null },
      { key: "SMTP_PORT",      placeholder: "587",         comment: null },
      { key: "SMTP_USER",      placeholder: "",            comment: null },
      { key: "SMTP_PASS",      placeholder: "",            comment: null },
      { key: "SMTP_FROM_NAME", placeholder: "Runly ERP",   comment: null },
      { key: "SMTP_FROM_EMAIL", placeholder: "",           comment: null },
      { key: "SMTP_TLS",       placeholder: "false",       comment: null },
    ],
  },
  {
    header: [
      "# ── Custom module ZIP upload ─────────────────────────────────────────────────",
      "# Container-side path where custom-modules/ is mounted (matches docker-compose volume).",
      "# Required for POST /modules/:key/upload and DELETE /modules/:key/purge.",
    ],
    vars: [
      { key: "ATLAS_MODULES_DIR", placeholder: "/app/modules/custom", comment: null },
    ],
  },
  {
    header: [
      "# ── Google Calendar integration (optional) ───────────────────────────────────",
      "# Register OAuth credentials at: https://console.cloud.google.com → APIs & Services → Credentials",
      "# Leave placeholders to disable Google Calendar sync.",
    ],
    vars: [
      { key: "GOOGLE_OAUTH_CLIENT_ID",     placeholder: "<YOUR_GOOGLE_OAUTH_CLIENT_ID>",     comment: null },
      { key: "GOOGLE_OAUTH_CLIENT_SECRET", placeholder: "<YOUR_GOOGLE_OAUTH_CLIENT_SECRET>", comment: null },
      { key: "GOOGLE_OAUTH_REDIRECT_URI",  placeholder: "https://your-atlas-domain.com/app/google/calendar/callback", comment: null },
      {
        key: "GOOGLE_OAUTH_ENCRYPTION_KEY",
        placeholder: "<YOUR_GOOGLE_OAUTH_ENCRYPTION_KEY>",
        comment: "# Generate: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"",
      },
    ],
  },
  {
    header: [
      "# ── atlas.pfm — lectura de tickets con IA (opcional) ─────────────────────────",
      "# Sin GROQ_API_KEY el modulo funciona igual y la subida de tickets responde 503",
      "# (la UI cae a captura manual). Consigue una clave gratis en https://console.groq.com",
    ],
    vars: [
      { key: "PFM_VISION_PROVIDER",  placeholder: "groq", comment: null },
      { key: "GROQ_API_KEY",         placeholder: "",     comment: null },
      { key: "GROQ_BASE_URL",        placeholder: "https://api.groq.com", comment: null },
      { key: "PFM_VISION_MODEL",     placeholder: "qwen/qwen3.6-27b", comment: null },
      { key: "PFM_VISION_TIMEOUT_MS", placeholder: "20000", comment: null },
    ],
  },
  {
    header: [
      "# ── Runly Calls / LiveKit ──────────────────────────────────────────────────",
      "# embedded starts LiveKit + Redis; external uses an existing RTC server; disabled hides calls.",
    ],
    vars: [
      { key: "LIVEKIT_MODE", placeholder: "embedded", comment: null },
      { key: "LIVEKIT_DOMAIN", placeholder: "", comment: "# Public hostname, for example rtc.example.com" },
      { key: "LIVEKIT_TLS_MODE", placeholder: "managed", comment: "# managed or external" },
      { key: "LIVEKIT_URL", placeholder: "", comment: "# Public browser URL, for example wss://rtc.yourdomain.com" },
      { key: "LIVEKIT_INTERNAL_URL", placeholder: "", comment: "# Derived automatically in embedded mode" },
      { key: "LIVEKIT_API_KEY", placeholder: "", comment: null },
      { key: "LIVEKIT_API_SECRET", placeholder: "", comment: null },
    ],
  },
  {
    header: [
      "# ── LiveKit Egress → Supabase Storage (call recordings, optional) ───────────",
      "# Get these from the self-hosted Supabase Storage container's own S3-compatible",
      "# config — NOT the same as SUPABASE_SERVICE_ROLE_KEY. Leave empty to disable.",
    ],
    vars: [
      { key: "SUPABASE_S3_ENDPOINT",          placeholder: "", comment: null },
      { key: "SUPABASE_S3_ACCESS_KEY_ID",     placeholder: "", comment: null },
      { key: "SUPABASE_S3_SECRET_ACCESS_KEY", placeholder: "", comment: null },
      { key: "SUPABASE_S3_REGION",            placeholder: "us-east-1", comment: null },
    ],
  },
  {
    header: [
      "# ── Runly Transcription (faster-whisper, optional) ──────────────────────────",
      "# local: instala y ejecuta faster-whisper en un contenedor propio en esta VPS.",
      "# disabled: no se instala ni activa ningun contenedor ni UI de transcripcion.",
    ],
    vars: [
      { key: "TRANSCRIPTION_MODE",    placeholder: "disabled", comment: null },
      { key: "WHISPER_MODEL",         placeholder: "small",    comment: null },
      { key: "WHISPER_COMPUTE_TYPE",  placeholder: "int8",     comment: null },
      { key: "WHISPER_CPU_THREADS",   placeholder: "2",        comment: "# Fijar explicitamente segun el limite real de CPU del contenedor" },
      { key: "TRANSCRIBER_DB_PASSWORD", placeholder: "", comment: "# Autogenerada — no editar a mano" },
      { key: "TRANSCRIBER_DATABASE_URL", placeholder: "", comment: "# Derivada automaticamente de DATABASE_URL" },
    ],
  },
  {
    header: [
      "# ── MirAI text-to-speech (Piper, optional) ───────────────────────────────────",
      "# local: instala y ejecuta runly-tts en un contenedor propio en esta VPS.",
      "# disabled: no se instala ni activa ningun contenedor ni boton en la UI.",
    ],
    vars: [
      { key: "MIRAI_TTS_MODE",   placeholder: "disabled", comment: null },
      { key: "TTS_CPU_THREADS",  placeholder: "2",        comment: null },
      { key: "MIRAI_TTS_URL",    placeholder: "", comment: "# Derivada automaticamente — no editar a mano" },
    ],
  },
  {
    header: [
      "# ── runly.chat MirAI assistant + runly.pfm/inventory AI extras (optional) ───",
      "# All reuse GROQ_API_KEY. Without it, the model overrides below are unused.",
    ],
    vars: [
      { key: "INVENTORY_AI_SIGNING_SECRET", placeholder: "", comment: "# Falls back to GROQ_API_KEY" },
      { key: "PFM_ASSISTANT_MODEL",         placeholder: "", comment: "# Default: openai/gpt-oss-120b" },
      { key: "CHAT_MIRAI_MODEL",            placeholder: "", comment: "# Default: openai/gpt-oss-120b" },
      { key: "CHAT_MIRAI_ROUTER_MODEL",     placeholder: "", comment: "# Default: openai/gpt-oss-120b" },
      { key: "CHAT_MIRAI_WEB",              placeholder: "true", comment: null },
      { key: "TAVILY_API_KEY",              placeholder: "", comment: "# Needed for MirAI live/internet answers" },
      { key: "CHAT_MIRAI_WEB_MODEL",        placeholder: "", comment: "# Groq compound fallback, paid plan; only used without TAVILY_API_KEY" },
    ],
  },
];

async function writeComposeEnv(envFilePath) {
  const content = await fs.readFile(envFilePath, "utf8");
  // Browser-facing: prefer RUNLY_SUPABASE_PUBLIC_URL when set (an internal
  // SUPABASE_URL the browser can't resolve), otherwise SUPABASE_URL is
  // already the public one (the default for a managed Supabase project).
  const supabaseUrl  = parseEnvValue(content, "RUNLY_SUPABASE_PUBLIC_URL") || parseEnvValue(content, "SUPABASE_URL") || "";
  const anonKey      = parseEnvValue(content, "SUPABASE_ANON_KEY") ?? "";
  const atlasApiUrl  = (process.env.RUNLY_API_URL ?? process.env.ATLAS_API_URL ?? parseEnvValue(content, "RUNLY_API_URL") ?? parseEnvValue(content, "ATLAS_API_URL"))   ?? "http://localhost:4010";

  // Docker Compose auto-loads ".env" (no extension) in the same directory for
  // ${VAR} interpolation. The web service uses ${ATLAS_API_URL}, ${SUPABASE_URL},
  // and ${SUPABASE_ANON_KEY} so the browser can reach them at runtime.
  const composeEnvFile = path.resolve(installerDir, ".env");
  const composeEnvContent = [
    "# Auto-generated by setup-external.mjs — do not edit manually.",
    "# Docker Compose reads this file to resolve ${SUPABASE_URL}, ${SUPABASE_ANON_KEY},",
    "# and ${ATLAS_API_URL} for the web service so the browser can reach them.",
    `SUPABASE_URL=${supabaseUrl}`,
    `SUPABASE_ANON_KEY=${anonKey}`,
    `ATLAS_API_URL=${atlasApiUrl}`,
    "# Isolation/ports mirrored from .env.external — see the comment above COMPOSE_INTERPOLATION_KEYS.",
    composeInterpolationEnvLines(content),
    "",
  ].join("\n");
  await fs.writeFile(composeEnvFile, canonicalizeRunlyEnvText(composeEnvContent), "utf8");
}

async function appendMissingOptionalVars(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  const addedKeys = [];
  const lines = [];

  for (const group of OPTIONAL_VAR_GROUPS) {
    const missingVars = group.vars.filter((v) => !hasEnvKey(content, v.key) && !hasEnvKey(content, v.key.replace(/^ATLAS_/, "RUNLY_")));
    if (missingVars.length === 0) continue;
    lines.push("", ...group.header);
    for (const { key, placeholder, comment } of missingVars) {
      if (comment) lines.push(comment);
      lines.push(`${key}=${placeholder}`);
      addedKeys.push(key);
    }
  }

  if (addedKeys.length === 0) return;
  lines.push("");
  await fs.appendFile(filePath, canonicalizeRunlyEnvText(lines.join("\n")), "utf8");

  console.warn("");
  console.warn("[setup-external] New variables appended to .env.external:");
  for (const key of addedKeys) console.warn(`  ${key}`);
  console.warn("  Review and fill them in before starting containers.");
}

function setEnvValue(content, key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  return pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`;
}

async function writeLiveKitArtifacts(config) {
  await fs.mkdir(path.dirname(liveKitConfigFile), { recursive: true });
  if (config.mode !== "embedded") {
    await Promise.all([
      fs.rm(liveKitConfigFile, { force: true }),
      // recursive: true also cleans up the directory Docker auto-creates at
      // this bind-mount source path when the file didn't exist yet the
      // first time `docker compose --profile livekit-egress up` ran.
      fs.rm(liveKitEgressConfigFile, { force: true, recursive: true }),
      fs.rm(liveKitCaddyFile, { force: true }),
      fs.rm(legacyLiveKitExternalProxyFile, { force: true }),
    ]);
    return;
  }

  await fs.writeFile(
    liveKitConfigFile,
    renderLiveKitConfig({
      ...config,
      isLinux,
      httpPort: process.env.LIVEKIT_HTTP_HOST_PORT,
      rtcTcpPort: process.env.LIVEKIT_RTC_TCP_PORT,
      rtcUdpPort: process.env.LIVEKIT_RTC_UDP_PORT,
      redisPort: process.env.LIVEKIT_REDIS_PORT,
    }),
    { encoding: "utf8", mode: 0o600 },
  );
  try { await fs.chmod(liveKitConfigFile, 0o600); } catch { /* Windows does not apply POSIX modes. */ }

  if (config.recordingEnabled) {
    // A stray directory here (see the recursive:true comment below) would
    // make writeFile fail with EISDIR too, so clear it first.
    await fs.rm(liveKitEgressConfigFile, { force: true, recursive: true });
    await fs.writeFile(
      liveKitEgressConfigFile,
      renderEgressConfig({
        apiKey: config.apiKey,
        apiSecret: config.apiSecret,
        isLinux,
        httpPort: process.env.LIVEKIT_HTTP_HOST_PORT,
        redisPort: process.env.LIVEKIT_REDIS_PORT,
      }),
      // 0644, unlike livekit.yaml's 0600: the egress container runs its
      // process as a non-root user (livekit-server's does not), so a
      // root-owned 0600 bind mount reads as EACCES from inside it — see the
      // docker-compose.yml egress service comment.
      { encoding: "utf8", mode: 0o644 },
    );
    try { await fs.chmod(liveKitEgressConfigFile, 0o644); } catch { /* Windows does not apply POSIX modes. */ }
  } else {
    // recursive: true also cleans up the directory Docker auto-creates at
    // this bind-mount source path when the file didn't exist yet the first
    // time `docker compose --profile livekit-egress up` ran.
    await fs.rm(liveKitEgressConfigFile, { force: true, recursive: true });
  }

  if (config.managedTls) {
    await fs.writeFile(
      liveKitCaddyFile,
      renderManagedCaddyfile({ domain: config.domain, isLinux }),
      { encoding: "utf8", mode: 0o600 },
    );
    try { await fs.chmod(liveKitCaddyFile, 0o600); } catch { /* Windows does not apply POSIX modes. */ }
    await fs.rm(legacyLiveKitExternalProxyFile, { force: true });
  } else if (config.domain && config.tlsMode === "external") {
    await Promise.all([
      fs.rm(liveKitCaddyFile, { force: true }),
      fs.rm(legacyLiveKitExternalProxyFile, { force: true }),
    ]);
    console.log(
      `  External TLS: Runly will not modify Nginx or certificates; proxy ${config.domain} to 127.0.0.1:7880.`,
    );
  } else {
    await Promise.all([
      fs.rm(liveKitCaddyFile, { force: true }),
      fs.rm(legacyLiveKitExternalProxyFile, { force: true }),
    ]);
  }
}

function removeInactiveLiveKitServices(config) {
  const composeArgs = [
    "compose",
    ...composeFiles,
    "--profile", "livekit",
    "--profile", "livekit-tls",
    "--profile", "livekit-egress",
    "rm", "--stop", "--force",
  ];
  if (config.mode !== "embedded") {
    tryRun("docker", [...composeArgs, "livekit-caddy", "livekit", "livekit-redis", "egress"]);
  } else {
    if (!config.managedTls) tryRun("docker", [...composeArgs, "livekit-caddy"]);
    if (!config.recordingEnabled) tryRun("docker", [...composeArgs, "egress"]);
  }
}

function removeInactiveTranscriptionServices(mode) {
  if (mode === "local") return;
  tryRun("docker", [
    "compose", ...composeFiles,
    "--profile", "transcription-external",
    "rm", "--stop", "--force", "runly-transcriber-external",
  ]);
}

// Single shared service (no "-external" suffix) — runly-tts is stateless
// and identical regardless of deployment mode, see its comment in
// docker-compose.yml.
function removeInactiveMiraiTtsServices(mode) {
  if (mode === "local") return;
  tryRun("docker", [
    "compose", ...composeFiles,
    "--profile", "mirai-tts",
    "rm", "--stop", "--force", "runly-tts",
  ]);
}

async function promptForLiveKitDomain() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(
      "LIVEKIT_MODE=embedded requires LIVEKIT_DOMAIN in .env.external. "
      + "Add a value such as LIVEKIT_DOMAIN=rtc.example.com and re-run the installer.",
    );
  }
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await terminal.question("LiveKit public domain (for example rtc.example.com): ");
    const domain = normalizeLiveKitDomain(answer);
    if (!domain) throw new Error("LIVEKIT_DOMAIN cannot be empty in production embedded mode.");
    return domain;
  } finally {
    terminal.close();
  }
}

async function configureLiveKit(filePath) {
  let content = await fs.readFile(filePath, "utf8");
  const mode = String(parseEnvValue(content, "LIVEKIT_MODE") || "embedded").trim().toLowerCase();
  let domain = String(parseEnvValue(content, "LIVEKIT_DOMAIN") || "").trim();
  if (mode === "embedded" && !domain) {
    domain = await promptForLiveKitDomain();
    content = setEnvValue(content, "LIVEKIT_DOMAIN", domain);
  }

  const config = resolveLiveKitConfig({
    deployment: "external",
    isLinux,
    values: {
      mode,
      domain,
      tlsMode: parseEnvValue(content, "LIVEKIT_TLS_MODE"),
      publicUrl: parseEnvValue(content, "LIVEKIT_URL"),
      internalUrl: parseEnvValue(content, "LIVEKIT_INTERNAL_URL"),
      apiKey: parseEnvValue(content, "LIVEKIT_API_KEY"),
      apiSecret: parseEnvValue(content, "LIVEKIT_API_SECRET"),
    },
  });

  for (const [key, value] of [
    ["LIVEKIT_MODE", config.mode],
    ["LIVEKIT_DOMAIN", config.domain],
    ["LIVEKIT_TLS_MODE", config.tlsMode],
    ["LIVEKIT_URL", config.publicUrl],
    ["LIVEKIT_INTERNAL_URL", config.internalUrl],
    ["LIVEKIT_API_KEY", config.apiKey],
    ["LIVEKIT_API_SECRET", config.apiSecret],
  ]) {
    content = setEnvValue(content, key, value);
  }
  await fs.writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
  try { await fs.chmod(filePath, 0o600); } catch { /* Windows does not apply POSIX modes. */ }

  // Recording is opt-in via the S3 vars themselves ("leave empty to
  // disable", per .env.external's own comment) rather than a separate flag —
  // filling them in is already the explicit action that turns it on.
  config.recordingEnabled = config.mode === "embedded" && ["SUPABASE_S3_ENDPOINT", "SUPABASE_S3_ACCESS_KEY_ID", "SUPABASE_S3_SECRET_ACCESS_KEY"]
    .every((key) => String(parseEnvValue(content, key) || "").trim().length > 0);

  await writeLiveKitArtifacts(config);
  return config;
}

// Mismo patron read-modify-write-in-place que configureLiveKit — el operador
// edita .env.external a mano (incluyendo DATABASE_URL, ya presente para modo
// external), este helper solo completa/preserva los valores auto-generados
// (TRANSCRIBER_DB_PASSWORD) y deriva TRANSCRIBER_DATABASE_URL a partir de
// DATABASE_URL. docs/TRANSCRIPTION_SPEC.md §6 — enum de solo 2 valores.
async function configureTranscription(filePath) {
  let content = await fs.readFile(filePath, "utf8");
  const mode = String(parseEnvValue(content, "TRANSCRIPTION_MODE") || "disabled").trim().toLowerCase();
  if (!["local", "disabled"].includes(mode)) {
    throw new Error(`TRANSCRIPTION_MODE must be "local" or "disabled" (got "${mode}").`);
  }
  const whisperModel = parseEnvValue(content, "WHISPER_MODEL") || "small";
  const whisperComputeType = parseEnvValue(content, "WHISPER_COMPUTE_TYPE") || "int8";
  const whisperCpuThreads = parseEnvValue(content, "WHISPER_CPU_THREADS") || "2";
  let dbPassword = parseEnvValue(content, "TRANSCRIBER_DB_PASSWORD") || "";
  if (mode === "local") dbPassword ||= generateTranscriberPassword();
  const databaseUrl = parseEnvValue(content, "DATABASE_URL") || "";
  const transcriberDatabaseUrl = mode === "local" && dbPassword && databaseUrl
    ? buildTranscriberDatabaseUrl(databaseUrl, dbPassword)
    : "";

  for (const [key, value] of [
    ["TRANSCRIPTION_MODE", mode],
    ["WHISPER_MODEL", whisperModel],
    ["WHISPER_COMPUTE_TYPE", whisperComputeType],
    ["WHISPER_CPU_THREADS", whisperCpuThreads],
    ["TRANSCRIBER_DB_PASSWORD", dbPassword],
    ["TRANSCRIBER_DATABASE_URL", transcriberDatabaseUrl],
  ]) {
    content = setEnvValue(content, key, value);
  }
  await fs.writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
  try { await fs.chmod(filePath, 0o600); } catch { /* Windows does not apply POSIX modes. */ }

  return { mode };
}

// Same read-modify-write-in-place pattern as configureTranscription, but
// simpler: runly-tts is stateless, so there is no password to generate and
// no derived URL besides the fixed internal Compose service hostname.
async function configureMiraiTts(filePath) {
  let content = await fs.readFile(filePath, "utf8");
  const mode = String(parseEnvValue(content, "MIRAI_TTS_MODE") || "disabled").trim().toLowerCase();
  if (!["local", "disabled"].includes(mode)) {
    throw new Error(`MIRAI_TTS_MODE must be "local" or "disabled" (got "${mode}").`);
  }
  const cpuThreads = parseEnvValue(content, "TTS_CPU_THREADS") || "2";
  const ttsUrl = mode === "local" ? "http://runly-tts:8090" : "";

  for (const [key, value] of [
    ["MIRAI_TTS_MODE", mode],
    ["TTS_CPU_THREADS", cpuThreads],
    ["MIRAI_TTS_URL", ttsUrl],
  ]) {
    content = setEnvValue(content, key, value);
  }
  await fs.writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
  try { await fs.chmod(filePath, 0o600); } catch { /* Windows does not apply POSIX modes. */ }

  return { mode };
}

function tryCapture(command, args, { cwd = installerDir, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "pipe",
    encoding: "utf8",
    shell: isWindows,
  });
  return {
    ok: !result.error && result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
  };
}

async function validateLiveKitDns(config) {
  if (config.mode === "disabled") return;
  const hostname = config.domain || new URL(config.publicUrl).hostname;
  const addresses = await lookup(hostname, { all: true });
  if (!addresses.length) throw new Error(`LiveKit hostname did not resolve: ${hostname}`);
  console.log(`  LiveKit DNS: ${hostname} -> ${addresses.map((item) => item.address).join(", ")}`);
}

async function validateLiveKitRuntime(config) {
  if (config.mode === "disabled") return;
  const containerPrefix = process.env.RUNLY_CONTAINER_PREFIX || "runly";

  console.log("[LiveKit] Validating Redis, LiveKit, API connectivity, and public TLS...");
  if (config.mode === "embedded") {
    const redisPort = isLinux ? (process.env.LIVEKIT_REDIS_PORT || "6380") : "6379";
    let redis = { ok: false, output: "Redis is not ready." };
    for (let attempt = 1; attempt <= 24; attempt += 1) {
      redis = tryCapture("docker", [
        "exec", `${containerPrefix}-livekit-redis`, "redis-cli", "-p", redisPort, "ping",
      ]);
      if (redis.ok && /PONG/i.test(redis.output)) break;
      await new Promise((resolve) => setTimeout(resolve, 2_500));
    }
    if (!redis.ok || !/PONG/i.test(redis.output)) {
      throw new Error(`LiveKit Redis health check failed: ${redis.output || "no response"}`);
    }
    console.log("  Redis: PONG");
  }

  const apiContainer = `${containerPrefix}-api-external`;
  let smokeResult = { ok: false, output: "API container is not ready." };
  for (let attempt = 1; attempt <= 24; attempt += 1) {
    smokeResult = tryCapture("docker", [
      "exec",
      apiContainer,
      "node",
      "apps/api/src/scripts/livekit-smoke.js",
    ]);
    if (smokeResult.ok) break;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  if (!smokeResult.ok) {
    const firewallHint = buildLiveKitFirewallHint({
      isLinux,
      mode: config.mode,
      smokeOutput: smokeResult.output,
      apiContainer,
      internalUrl: config.internalUrl,
      runCommand: tryCapture,
    });
    throw new Error(
      `API-to-LiveKit smoke test failed: ${smokeResult.output}`
      + (firewallHint ? `\n\n${firewallHint}` : ""),
    );
  }
  console.log("  API -> LiveKit: temporary room created and deleted");

  const healthUrl = `${toLiveKitHttpUrl(config.publicUrl).replace(/\/$/, "")}/`;
  let lastError = "no response";
  for (let attempt = 1; attempt <= 24; attempt += 1) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(10_000) });
      if (response.ok) {
        console.log(`  Public TLS/WSS: ${config.publicUrl}`);
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error(`Public LiveKit TLS validation failed for ${config.publicUrl}: ${lastError}`);
}

function getDevKitManifestRepoPath() {
  return `${DEVKIT_EXPORT_REPO_PATH}/manifest.json`;
}

async function downloadTextFile(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "runlyerp-installer" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
  return response.text();
}

async function downloadDevKitSnapshot({ devKitDir, docsRawBase }) {
  const manifestUrl = `${docsRawBase}/${getDevKitManifestRepoPath()}`;
  const manifestSource = await downloadTextFile(manifestUrl);
  const manifest = JSON.parse(manifestSource);
  const files = Array.isArray(manifest?.files) ? manifest.files : [];

  if (!files.length) {
    throw new Error("Dev Kit manifest does not contain any files.");
  }

  await fs.mkdir(devKitDir, { recursive: true });
  const downloadedFiles = [];
  const failedFiles = [];

  for (const relativePath of files) {
    const url = `${docsRawBase}/${DEVKIT_EXPORT_REPO_PATH}/${relativePath}`;
    const destination = path.resolve(devKitDir, relativePath);
    try {
      const content = await downloadTextFile(url);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, content, "utf8");
      downloadedFiles.push(relativePath);
    } catch (error) {
      failedFiles.push({ relativePath, error });
    }
  }

  return { manifest, downloadedFiles, failedFiles };
}

async function downloadDevKit() {
  if (skipDevKit) {
    console.log("[3/5] Skipping Dev Kit download (--skip-dev-kit).");
    return;
  }
  if (typeof fetch !== "function") {
    console.warn("[setup-external] Dev Kit skipped: Node.js runtime has no global fetch().");
    return;
  }

  await fs.mkdir(devKitDir, { recursive: true });
  const { downloadedFiles: ok, failedFiles } = await downloadDevKitSnapshot({
    devKitDir,
    docsRawBase,
  });

  if (failedFiles.length > 0) {
    console.warn(`[setup-external] Dev Kit: ${ok.length} ok, ${failedFiles.length} failed.`);
    for (const { relativePath, error } of failedFiles) console.warn(`  - ${relativePath}: ${error.message}`);
  } else {
    console.log(`[3/5] Dev Kit ready at ${devKitDir} (${ok.length} files).`);
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main() {
  let liveKit = resolveLiveKitConfig({
    deployment: "external",
    isLinux,
    values: { mode: "disabled" },
  });
  // ── docs-only shortcut ────────────────────────────────────────────────────
  if (docsOnly) {
    console.log("[setup-external] --docs-only: downloading Dev Kit files only.");
    await downloadDevKit();
    console.log("[setup-external] Done.");
    return;
  }

  // ── 1. Validate environment file ──────────────────────────────────────────
  if (!upOnly) {
    console.log("[1/5] Checking .env.external...");
    if (!(await exists(envFile))) {
      if (await exists(envExampleFile)) {
        await fs.copyFile(envExampleFile, envFile);
        console.error("");
        console.error("  .env.external was not found — copied from .env.external.example.");
        console.error("  Edit .env.external with Supabase credentials and LIVEKIT_DOMAIN, then re-run:");
        console.error(`    ${isWindows ? "node .\\setup-external.mjs" : "node ./setup-external.mjs"}`);
        console.error("");
      } else {
        console.error("");
        console.error("  .env.external not found. Create it:");
        console.error("    cp .env.external.example .env.external");
        console.error("  then fill in your credentials and re-run.");
        console.error("");
      }
      process.exit(1);
    }
    console.log("  .env.external found.");
    await ensureInstanceIdentity(envFile);
    await appendMissingOptionalVars(envFile);
    liveKit = await configureLiveKit(envFile);
    await validateLiveKitDns(liveKit);
    await writeComposeEnv(envFile);
  }
  let transcription = { mode: "disabled" };
  let miraiTts = { mode: "disabled" };
  if (!upOnly) {
    transcription = await configureTranscription(envFile);
    miraiTts = await configureMiraiTts(envFile);
  }

  // When --up-only skips the env check above, still regenerate the compose .env
  // if .env.external already exists (ensures ATLAS_API_URL is always up to date).
  if (upOnly && (await exists(envFile))) {
    await ensureInstanceIdentity(envFile);
    liveKit = await configureLiveKit(envFile);
    await validateLiveKitDns(liveKit);
    await writeComposeEnv(envFile);
    transcription = await configureTranscription(envFile);
    miraiTts = await configureMiraiTts(envFile);
  }

  // ── 2. Validate Docker ─────────────────────────────────────────────────────
  const office = await configureOffice({ envFile, composeEnvFile: path.resolve(installerDir, ".env") });
  await configureFirebase({ envFile });
  console.log("[2/5] Validating Docker...");
  run("docker", ["compose", "version"]);

  // ── 3. Dev Kit ─────────────────────────────────────────────────────────────
  if (!upOnly) {
    await downloadDevKit();
  } else {
    console.log("[3/5] Skipping Dev Kit (--up-only).");
  }

  // ── 4. Pull images ─────────────────────────────────────────────────────────
  await fs.mkdir(path.resolve(installerDir, "custom-modules"), { recursive: true });

  let resolvedApiImage    = apiImage;
  let resolvedWorkerImage = workerImage;
  let resolvedWebImage    = webImage;

  if (skipPull || upOnly) {
    console.log("[4/5] Skipping image pull.");
  } else {
    console.log("[4/5] Pulling Runly images...");
    resolvedApiImage    = pullWithRetry(apiImage,    "API");
    resolvedWorkerImage = pullWithRetry(workerImage, "Worker");
    resolvedWebImage    = pullWithRetry(webImage,    "Web");
    if (liveKit.mode === "embedded") {
      pullWithRetry(liveKitImage, "LiveKit");
      pullWithRetry(liveKitRedisImage, "LiveKit Redis");
      if (liveKit.managedTls) pullWithRetry(liveKitCaddyImage, "LiveKit Caddy");
      if (liveKit.recordingEnabled) pullWithRetry(liveKitEgressImage, "LiveKit Egress");
    }
    if (transcription.mode === "local") pullWithRetry(transcriberImage, "Transcriber");
    if (miraiTts.mode === "local") pullWithRetry(ttsImage, "TTS");
    // Remove dangling layers left behind when `latest` tags are re-pulled.
    // This prevents disk accumulation on every deploy without touching other projects.
    console.log("     Pruning dangling images...");
    tryRun("docker", ["image", "prune", "-f"]);
  }

  // ── 5. Migrate + seed (first install or explicit reset) ───────────────────
  if (skipMigrate || upOnly) {
    console.log("[5/5] Skipping migrations.");
  } else {
    console.log("[5/5] Running migrations and seed...");
    // --add-host covers the case where DATABASE_URL points to localhost on the
    // same machine; harmless when pointing to a remote host.
    const dockerRunBase = [
      "run", "--rm",
      "--add-host", "host.docker.internal:host-gateway",
      "--env-file", envFile,
    ];
    run("docker", [...dockerRunBase, resolvedApiImage, "pnpm", "db:migrate"]);
    run("docker", [...dockerRunBase, resolvedApiImage, "pnpm", "db:seed"]);
    if (transcription.mode === "local") {
      run("docker", [...dockerRunBase, resolvedApiImage, "pnpm", "db:provision-transcriber-role"]);
    }
  }

  // ── 6. Start containers ────────────────────────────────────────────────────
  console.log("\nStarting Runly (external profile)...");
  if (!office.enabled) run("docker", ["compose", ...composeFiles, "--profile", "office", "stop", "collabora"]);
  removeInactiveLiveKitServices(liveKit);
  removeInactiveTranscriptionServices(transcription.mode);
  removeInactiveMiraiTtsServices(miraiTts.mode);
  const liveKitProfiles = getLiveKitComposeProfiles(liveKit, { recordingEnabled: liveKit.recordingEnabled })
    .flatMap((profile) => ["--profile", profile]);
  const transcriptionProfiles = transcription.mode === "local" ? ["--profile", "transcription-external"] : [];
  const miraiTtsProfiles = miraiTts.mode === "local" ? ["--profile", "mirai-tts"] : [];
  // Limit forced restarts to Runly/Calls: an unchanged editor must keep its sessions.
  const services = ["runly-api-external", "runly-worker-external", "runly-web-external",
    ...(liveKit.mode === "embedded" ? ["livekit-redis", "livekit",
      ...(liveKit.managedTls ? ["livekit-caddy"] : []),
      ...(liveKit.recordingEnabled ? ["egress"] : [])] : []),
    ...(transcription.mode === "local" ? ["runly-transcriber-external"] : []),
    ...(miraiTts.mode === "local" ? ["runly-tts"] : [])];
  run(
    "docker",
    ["compose", ...composeFiles, "--profile", "external", ...liveKitProfiles, ...transcriptionProfiles, ...miraiTtsProfiles, ...office.profiles, "up", "-d", "--force-recreate", ...services],
    {
      env: {
        ...process.env,
        RUNLY_API_IMAGE:          resolvedApiImage,
        ATLAS_API_IMAGE:          resolvedApiImage,
        RUNLY_WORKER_IMAGE:       resolvedWorkerImage,
        ATLAS_WORKER_IMAGE:       resolvedWorkerImage,
        RUNLY_WEB_EXTERNAL_IMAGE: resolvedWebImage,
        ATLAS_WEB_EXTERNAL_IMAGE: resolvedWebImage,
        LIVEKIT_IMAGE:            liveKitImage,
        LIVEKIT_REDIS_IMAGE:      liveKitRedisImage,
        LIVEKIT_CADDY_IMAGE:      liveKitCaddyImage,
        LIVEKIT_EGRESS_IMAGE:     liveKitEgressImage,
      },
    },
  );

  if (office.enabled) run("docker", ["compose", ...composeFiles, ...office.profiles, "up", "-d", "collabora"]);
  await validateLiveKitRuntime(liveKit);
  await checkOfficeRuntime(office);

  console.log("");
  console.log("Runly ERP is ready (external mode):");
  console.log("  Web:  http://localhost:5173");
  console.log("  API:  http://localhost:4010");
  if (liveKit.mode !== "disabled") console.log(`  LiveKit: ${liveKit.publicUrl}`);
  if (!upOnly) {
    console.log(`  Dev Kit: ${devKitDir}`);
  }
}

main().catch((err) => {
  console.error("");
  console.error("[setup-external] Error:", err.message);
  process.exit(1);
});
