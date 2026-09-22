#!/usr/bin/env node
import { withRunlyEnvAliases, canonicalizeRunlyEnvText, mergeRunlyEnvText } from "./lib/env-compat.mjs";
import { resolveDevKitDir } from './lib/devkit-installer.mjs';
import { configureOffice, checkOfficeRuntime, OFFICE_ENV_KEYS, parseOfficeEnv } from "./lib/office-config.mjs";
import { configureFirebase, preserveFirebaseEnv } from "./lib/firebase-config.mjs";
import { resolveInstanceIdentity, renderInstanceIdentityEnv } from "./lib/instance-identity.mjs";
import { resolveSupabaseSecrets, resolveSupabasePorts, assessSupabaseSecurityPosture } from "./lib/supabase-selfhosted-config.mjs";

import crypto from "node:crypto";
import { lookup } from "node:dns/promises";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  buildLiveKitFirewallHint,
  getLiveKitComposeProfiles,
  renderEgressConfig,
  renderLiveKitConfig,
  renderManagedCaddyfile,
  resolveLiveKitConfig,
  toLiveKitHttpUrl,
} from "./lib/livekit-config.mjs";

const argv = new Set(process.argv.slice(2));
const skipComposeUp = argv.has("--skip-compose-up");
const skipDevKit = argv.has("--skip-dev-kit");
const skipPull = argv.has("--skip-pull");
const docsOnly = argv.has("--docs-only");
const devSupabaseCli = argv.has("--dev-supabase-cli");
const isWindows = process.platform === "win32";
const npxCommand = "npx";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const installerDir = __dirname;
const composeFile = path.resolve(__dirname, "docker-compose.yml");
const linuxComposeOverride = path.resolve(__dirname, "docker-compose.linux.yml");
const supabaseComposeFile = path.resolve(__dirname, "supabase", "docker-compose.supabase.yml");
const localEnvFile = path.resolve(__dirname, ".env.local");
const supabaseWorkdir = path.resolve(__dirname, ".supabase-local");
const supabaseConfig = path.resolve(supabaseWorkdir, "supabase", "config.toml");
const devKitDir = resolveDevKitDir(path.resolve(__dirname, "custom-modules"));
const liveKitConfigFile = path.resolve(__dirname, "livekit", "livekit.yaml");
const liveKitEgressConfigFile = path.resolve(__dirname, "livekit", "egress.yaml");
const liveKitCaddyFile = path.resolve(__dirname, "livekit", "Caddyfile");
const legacyLiveKitExternalProxyFile = path.resolve(__dirname, "livekit", "reverse-proxy.nginx.conf");

// Docker Desktop (Windows/macOS) injects host.docker.internal automatically.
// Linux Docker Engine does not — we handle it via --add-host for docker run and
// via docker-compose.linux.yml override for compose services.
const isLinux = process.platform === "linux";
const addHostArgs = isLinux ? ["--add-host", "host.docker.internal:host-gateway"] : [];
// Reassigned once in main() after the Supabase mode is known — see
// resolveSupabaseMode(). Every docker-compose invocation happens after that
// point, so this stays a single source of truth for the rest of the run.
let composeFiles = isLinux && fsSync.existsSync(linuxComposeOverride)
  ? ["-f", composeFile, "-f", linuxComposeOverride]
  : ["-f", composeFile];

// Decides which Supabase stack this run manages. Once RUNLY_SUPABASE_MODE is
// recorded in .env.local, that stored value always wins over the
// --dev-supabase-cli flag — switching modes on an EXISTING install is a
// deliberate, documented migration (see README.md), never a side effect of
// forgetting/adding a flag on a routine re-run.
function resolveSupabaseMode(existingEnvContent) {
  const stored = parseEnvValue(existingEnvContent, "RUNLY_SUPABASE_MODE");
  if (stored) return stored;
  if (devSupabaseCli) return "cli-dev";
  // Upgrade-safety: an install created before this feature existed has a
  // CLI-managed Supabase workdir and no recorded mode — keep it on cli-dev
  // rather than silently standing up a second, self-hosted Supabase stack
  // alongside the one it already has.
  if (fsSync.existsSync(supabaseConfig)) return "cli-dev";
  return "selfhosted";
}

const docsRepoOwner = (process.env.RUNLY_DOCS_REPO_OWNER ?? process.env.ATLAS_DOCS_REPO_OWNER) ?? "raulbellosom";
const docsRepoName = (process.env.RUNLY_DOCS_REPO_NAME ?? process.env.ATLAS_DOCS_REPO_NAME) ?? "runly-erp";
const docsRepoRef = (process.env.RUNLY_DOCS_REPO_REF ?? process.env.ATLAS_DOCS_REPO_REF) ?? "main";
const docsRawBase =
  (process.env.RUNLY_DOCS_RAW_BASE ?? process.env.ATLAS_DOCS_RAW_BASE) ??
  `https://raw.githubusercontent.com/${docsRepoOwner}/${docsRepoName}/${docsRepoRef}`;
const DEVKIT_EXPORT_REPO_PATH = "infra/installer/devkit-export";

const apiImage =
  (process.env.RUNLY_API_LOCAL_IMAGE ?? process.env.ATLAS_API_LOCAL_IMAGE) ?? "raulbellosom/runlyerp:api-latest";
const workerImage =
  (process.env.RUNLY_WORKER_LOCAL_IMAGE ?? process.env.ATLAS_WORKER_LOCAL_IMAGE) ??
  "raulbellosom/runlyerp:worker-latest";
const webImage =
  (process.env.RUNLY_WEB_LOCAL_IMAGE ?? process.env.ATLAS_WEB_LOCAL_IMAGE) ?? "raulbellosom/runlyerp:web-latest";
const liveKitImage = process.env.LIVEKIT_IMAGE ?? "livekit/livekit-server:v1.12.0";
const liveKitRedisImage = process.env.LIVEKIT_REDIS_IMAGE ?? "redis:7-alpine";
const liveKitCaddyImage = process.env.LIVEKIT_CADDY_IMAGE ?? "caddy:2-alpine";
const liveKitEgressImage = process.env.LIVEKIT_EGRESS_IMAGE ?? "livekit/egress:v1.9.0";

// Kept in sync with infra/installer/supabase/docker-compose.supabase.yml —
// see VENDORED_FROM.md for the pinned upstream release these come from.
const SELF_HOSTED_SUPABASE_IMAGES = [
  "supabase/postgres:17.6.1.136",
  "supabase/gotrue:v2.189.0",
  "postgrest/postgrest:v14.12",
  "supabase/realtime:v2.102.3",
  "supabase/storage-api:v1.60.4",
  "supabase/postgres-meta:v0.96.6",
  "supabase/studio:2026.08.03-sha-022b374",
  "kong:3.9.3",
];
// Everything the app actually needs at runtime — migrate/seed and the
// Runly profile must wait for these before proceeding.
const SELF_HOSTED_SUPABASE_REQUIRED_SERVICES = [
  "supabase-db", "supabase-auth", "supabase-rest", "supabase-realtime", "supabase-storage", "supabase-kong",
];
// Admin-only (Studio needs Meta); slow to start and never blocks the app.
const SELF_HOSTED_SUPABASE_BEST_EFFORT_SERVICES = ["supabase-meta", "supabase-studio"];

const fallbackApiImage = "raulbellosom/runlyerp:api-latest";
const fallbackWorkerImage = "raulbellosom/runlyerp:worker-latest";
const fallbackWebImage = "raulbellosom/runlyerp:web-latest";

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

function capture(command, args, { cwd = installerDir, env = process.env } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    stdio: "pipe",
    encoding: "utf8",
    shell: isWindows,
  });
  if (result.error) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}${stderr ? `: ${stderr}` : ""}`
    );
  }
  return result.stdout ?? "";
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
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

// Host-port / bind / identity vars that Docker Compose needs for ${VAR}
// interpolation of docker-compose.yml itself. Compose only reads these from
// the shell environment or the auto-loaded ".env" file — never from
// .env.local (that file is only injected into containers via env_file:) — so
// any value stored in .env.local must be mirrored into ".env" to take effect.
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

// Resolves this installation's identity before any docker/supabase command
// runs, and exports it so every subsequent `docker compose` invocation in
// this process (they all default env: process.env) targets the right
// project and container names.
async function resolveIdentity() {
  let existingEnvContent = "";
  try { existingEnvContent = await fs.readFile(localEnvFile, "utf8"); } catch { /* first run */ }
  const identity = resolveInstanceIdentity(existingEnvContent);
  process.env.RUNLY_COMPOSE_PROJECT_NAME = identity.projectName;
  process.env.RUNLY_CONTAINER_PREFIX = identity.containerPrefix;
  return identity;
}

// The shipped .supabase-local/supabase/config.toml ships with a fixed
// project_id ("supabase-local"), which the Supabase CLI uses to name its own
// containers/volumes/network — a second local install (a separate copy of
// this installer directory) would otherwise collide on those Supabase
// resources even though Runly's own containers are isolated. Only rewrite it
// while it still holds the shipped default, so an admin's own customization
// is never clobbered, and so re-runs are idempotent.
async function adoptSupabaseProjectId(instanceId) {
  let content;
  try { content = await fs.readFile(supabaseConfig, "utf8"); } catch { return; }
  const current = /^project_id\s*=\s*"([^"]*)"/m.exec(content)?.[1];
  if (!current || current !== "supabase-local") return;
  const updated = content.replace(/^project_id\s*=\s*".*"$/m, `project_id = "supabase-${instanceId}"`);
  await fs.writeFile(supabaseConfig, updated, "utf8");
}

function pullWithRetry(image, label, retries = 3, delayMs = 5000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    console.log(`[setup-local] Pulling ${label} (attempt ${attempt}/${retries})...`);
    const ok = tryRun("docker", ["pull", image]);
    if (ok) return image;
    if (attempt < retries) {
      console.warn(`[setup-local] Pull failed, retrying in ${delayMs / 1000}s...`);
      sleep(delayMs);
    }
  }
  throw new Error(`Could not pull ${label} image (${image}) after ${retries} attempts. Check your network and try again, or run with --skip-pull if the image is already local.`);
}

function getDevKitManifestRepoPath() {
  return `${DEVKIT_EXPORT_REPO_PATH}/manifest.json`;
}

async function downloadTextFile(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "runlyerp-installer" },
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} fetching ${url}`);
  }
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
    console.log("[5/8] Skipping Dev Kit download (--skip-dev-kit).");
    return;
  }

  if (typeof fetch !== "function") {
    console.warn("[setup-local] Dev Kit skipped: this Node.js runtime does not provide global fetch().");
    return;
  }

  await fs.mkdir(devKitDir, { recursive: true });
  const { downloadedFiles, failedFiles } = await downloadDevKitSnapshot({
    devKitDir,
    docsRawBase,
  });

  if (failedFiles.length > 0) {
    console.warn(
      `[setup-local] Dev Kit downloaded with warnings (${downloadedFiles.length} ok, ${failedFiles.length} failed).`
    );
    for (const item of failedFiles) {
      console.warn(`  - ${item.relativePath}: ${item.error.message}`);
    }
    return;
  }

  console.log(
    `[5/8] Dev Kit ready at ${devKitDir} (${downloadedFiles.length} files).`
  );
}

function replaceUrlHost(urlValue, targetHost) {
  if (!urlValue) return urlValue;
  try {
    const url = new URL(urlValue);
    if (["127.0.0.1", "localhost", "host.docker.internal"].includes(url.hostname)) {
      url.hostname = targetHost;
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    return urlValue;
  }
  return urlValue;
}

function parseSupabaseStatusEnv(statusOutput) {
  const envMap = new Map();
  const lines = statusOutput.split(/\r?\n/).map((line) => line.trim());
  for (const line of lines) {
    const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line);
    if (match) {
      envMap.set(match[1], match[2]);
    }
  }
  return envMap;
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
      { encoding: "utf8", mode: 0o600 },
    );
    try { await fs.chmod(liveKitEgressConfigFile, 0o600); } catch { /* Windows does not apply POSIX modes. */ }
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
      `  External TLS: Runly will not modify the host reverse proxy; proxy ${config.domain} to 127.0.0.1:7880.`,
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

async function validateLiveKitDns(config) {
  if (!config.domain) return;
  const addresses = await lookup(config.domain, { all: true });
  if (!addresses.length) throw new Error(`LIVEKIT_DOMAIN did not resolve: ${config.domain}`);
  console.log(`  LiveKit DNS: ${config.domain} -> ${addresses.map((item) => item.address).join(", ")}`);
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

async function validateLiveKitRuntime(config) {
  if (config.mode === "disabled") return;
  const containerPrefix = process.env.RUNLY_CONTAINER_PREFIX || "runly";

  console.log("[LiveKit] Validating runtime...");
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

  const apiContainer = `${containerPrefix}-api-local`;
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

  if (/^wss:\/\//i.test(config.publicUrl)) {
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
}

// supabaseInput is either { mode: "cli-dev", envMap } (Supabase CLI's own
// `supabase status -o env` output) or { mode: "selfhosted" } (secrets/ports
// are generated/persisted here, the same way LiveKit/Office config is).
async function resolveSupabaseView(supabaseInput, existingEnvContent) {
  if (supabaseInput.mode === "cli-dev") {
    const envMap = supabaseInput.envMap;
    const requiredKeys = ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY", "JWT_SECRET", "DB_URL"];
    const missing = requiredKeys.filter((key) => !envMap.get(key));
    if (missing.length > 0) {
      throw new Error(`Could not read required Supabase variables from status output: ${missing.join(", ")}`);
    }
    return {
      mode: "cli-dev",
      anonKey: envMap.get("ANON_KEY"),
      serviceRoleKey: envMap.get("SERVICE_ROLE_KEY"),
      jwtSecret: envMap.get("JWT_SECRET"),
      internalUrl: replaceUrlHost(envMap.get("API_URL"), "host.docker.internal"),
      dbUrl: replaceUrlHost(envMap.get("DB_URL"), "host.docker.internal"),
      defaultPublicUrl: replaceUrlHost(envMap.get("API_URL"), "localhost"),
    };
  }

  const existingParsed = parseOfficeEnv(existingEnvContent);
  const secrets = resolveSupabaseSecrets(existingParsed);
  const ports = await resolveSupabasePorts(existingParsed);
  return {
    mode: "selfhosted",
    anonKey: secrets.SUPABASE_ANON_KEY,
    serviceRoleKey: secrets.SUPABASE_SERVICE_ROLE_KEY,
    jwtSecret: secrets.SUPABASE_JWT_SECRET,
    internalUrl: "http://supabase-kong:8000",
    dbUrl: `postgresql://postgres:${secrets.SUPABASE_POSTGRES_PASSWORD}@supabase-db:5432/postgres`,
    defaultPublicUrl: `http://localhost:${ports.kongPort}`,
    secrets,
    ports,
  };
}

// Renders the extra installer-managed vars docker-compose.supabase.yml needs
// for ${VAR} interpolation (POSTGRES_PASSWORD, Realtime/Meta keys, ports,
// SMTP passthrough...). Returned separately from the main .env.local template
// because these lines only exist in selfhosted mode.
// Without SMTP, account confirmation is forced on — GoTrue cannot send a
// confirmation email, so requiring one would make signup impossible.
function resolveMailerAutoconfirm(fromLocalEnv) {
  return fromLocalEnv("RUNLY_SUPABASE_SMTP_HOST")
    ? (fromLocalEnv("RUNLY_SUPABASE_MAILER_AUTOCONFIRM") || "false")
    : "true";
}

function renderSelfHostedSupabaseEnv(supabase, fromLocalEnv, mailerAutoconfirm) {
  if (supabase.mode !== "selfhosted") return "RUNLY_SUPABASE_MODE=cli-dev\n";
  return [
    "# ── Self-hosted Supabase (installer-managed; do not hand-edit) ──────────────",
    "RUNLY_SUPABASE_MODE=selfhosted",
    `SUPABASE_POSTGRES_PASSWORD=${supabase.secrets.SUPABASE_POSTGRES_PASSWORD}`,
    `RUNLY_SUPABASE_SECRET_KEY_BASE=${supabase.secrets.RUNLY_SUPABASE_SECRET_KEY_BASE}`,
    `RUNLY_SUPABASE_REALTIME_DB_ENC_KEY=${supabase.secrets.RUNLY_SUPABASE_REALTIME_DB_ENC_KEY}`,
    `RUNLY_SUPABASE_META_CRYPTO_KEY=${supabase.secrets.RUNLY_SUPABASE_META_CRYPTO_KEY}`,
    `RUNLY_SUPABASE_KONG_HOST_PORT=${supabase.ports.kongPort}`,
    `RUNLY_SUPABASE_STUDIO_HOST_PORT=${supabase.ports.studioPort}`,
    `RUNLY_SUPABASE_MAILER_AUTOCONFIRM=${mailerAutoconfirm}`,
    `RUNLY_SUPABASE_SMTP_ADMIN_EMAIL=${fromLocalEnv("RUNLY_SUPABASE_SMTP_ADMIN_EMAIL")}`,
    `RUNLY_SUPABASE_SMTP_HOST=${fromLocalEnv("RUNLY_SUPABASE_SMTP_HOST")}`,
    `RUNLY_SUPABASE_SMTP_PORT=${fromLocalEnv("RUNLY_SUPABASE_SMTP_PORT") || "587"}`,
    `RUNLY_SUPABASE_SMTP_USER=${fromLocalEnv("RUNLY_SUPABASE_SMTP_USER")}`,
    `RUNLY_SUPABASE_SMTP_PASS=${fromLocalEnv("RUNLY_SUPABASE_SMTP_PASS")}`,
    `RUNLY_SUPABASE_SMTP_SENDER_NAME=${fromLocalEnv("RUNLY_SUPABASE_SMTP_SENDER_NAME") || "Runly"}`,
    `RUNLY_SUPABASE_ADDITIONAL_REDIRECT_URLS=${fromLocalEnv("RUNLY_SUPABASE_ADDITIONAL_REDIRECT_URLS")}`,
    `RUNLY_SUPABASE_DISABLE_SIGNUP=${fromLocalEnv("RUNLY_SUPABASE_DISABLE_SIGNUP") || "false"}`,
    "",
  ].join("\n");
}

// Polls `docker inspect`'s health status for each self-hosted Supabase
// container in dependency order (db first). Required services block the
// install (migrate/seed cannot proceed without them); best-effort services
// (Studio/Meta, admin-only) only warn — a slow Studio image pull should
// never fail an otherwise-working install.
async function waitForSelfHostedSupabaseHealthy(containerPrefix) {
  async function waitForOne(serviceName, { required }) {
    const container = `${containerPrefix}-${serviceName}`;
    for (let attempt = 1; attempt <= 60; attempt += 1) {
      const result = tryCapture("docker", ["inspect", "-f", "{{.State.Health.Status}}", container]);
      const status = result.output.trim();
      if (result.ok && status === "healthy") {
        console.log(`  ${serviceName}: healthy`);
        return true;
      }
      if (result.ok && status === "unhealthy" && attempt > 5) {
        // Give it a few retries in case it is still applying DB init scripts,
        // but don't spin for the full 60 attempts on a genuinely broken start.
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 3_000));
    }
    const message = `Supabase service ${serviceName} did not become healthy in time. Check: docker logs ${container}`;
    if (required) throw new Error(message);
    console.warn(`  ${serviceName}: not healthy yet (non-blocking) — ${message}`);
    return false;
  }

  for (const serviceName of SELF_HOSTED_SUPABASE_REQUIRED_SERVICES) {
    // eslint-disable-next-line no-await-in-loop
    await waitForOne(serviceName, { required: true });
  }
  for (const serviceName of SELF_HOSTED_SUPABASE_BEST_EFFORT_SERVICES) {
    // eslint-disable-next-line no-await-in-loop
    await waitForOne(serviceName, { required: false });
  }
}

async function writeLocalEnv(supabaseInput, identity) {
  // On a VPS exposed via Nginx, set RUNLY_SUPABASE_PUBLIC_URL to the public Supabase URL
  // (e.g. https://supabase.yourdomain.com) so the browser can reach it from the internet.
  // Preserve user-configured vars across re-runs so re-generating Supabase credentials
  // does not wipe deployment-specific settings (CORS, Google OAuth, etc.).
  let existingEnvContent = "";
  try { existingEnvContent = await fs.readFile(localEnvFile, "utf8"); } catch { /* first run */ }
  let existingComposeContent = "";
  try { existingComposeContent = await fs.readFile(path.resolve(installerDir, ".env"), "utf8"); } catch { /* first run */ }
  const deploymentValues = withRunlyEnvAliases(parseOfficeEnv(existingComposeContent), parseOfficeEnv(existingEnvContent), process.env);
  const supabase = await resolveSupabaseView(supabaseInput, existingEnvContent);
  const browserSupabaseUrl = deploymentValues.RUNLY_SUPABASE_PUBLIC_URL
    ? deploymentValues.RUNLY_SUPABASE_PUBLIC_URL.replace(/\/$/, "")
    : supabase.defaultPublicUrl;
  const publicApiUrl = deploymentValues.RUNLY_API_URL ?? "";

  const corsOrigin         = parseEnvValue(existingEnvContent, "CORS_ORIGIN")                 || "http://localhost:5173";
  const googleClientId     = parseEnvValue(existingEnvContent, "GOOGLE_OAUTH_CLIENT_ID")     || "<YOUR_GOOGLE_OAUTH_CLIENT_ID>";
  const googleClientSecret = parseEnvValue(existingEnvContent, "GOOGLE_OAUTH_CLIENT_SECRET") || "<YOUR_GOOGLE_OAUTH_CLIENT_SECRET>";
  const googleRedirectUri  = parseEnvValue(existingEnvContent, "GOOGLE_OAUTH_REDIRECT_URI")  || "https://your-atlas-domain.com/app/google/calendar/callback";
  // Auto-generate a stable 32-byte key on first run; preserve on subsequent runs.
  const googleEncryptionKey = parseEnvValue(existingEnvContent, "GOOGLE_OAUTH_ENCRYPTION_KEY")
    || crypto.randomBytes(32).toString("base64");
  // atlas.pfm receipt OCR — optional; preserve any user-provided value across re-runs.
  const pfmVisionProvider = parseEnvValue(existingEnvContent, "PFM_VISION_PROVIDER") || "groq";
  const groqApiKey        = parseEnvValue(existingEnvContent, "GROQ_API_KEY") || "";
  const groqBaseUrl       = parseEnvValue(existingEnvContent, "GROQ_BASE_URL") || "https://api.groq.com";
  const pfmVisionModel    = parseEnvValue(existingEnvContent, "PFM_VISION_MODEL")
    || "qwen/qwen3.6-27b";
  const pfmVisionTimeout  = parseEnvValue(existingEnvContent, "PFM_VISION_TIMEOUT_MS") || "20000";
  const fromLocalEnv = (key) => parseEnvValue(existingEnvContent, key) || process.env[key] || "";
  // runly.chat MirAI + runly.pfm/inventory AI extras — all optional, reuse GROQ_API_KEY.
  const inventoryAiSigningSecret = fromLocalEnv("INVENTORY_AI_SIGNING_SECRET");
  const pfmAssistantModel        = fromLocalEnv("PFM_ASSISTANT_MODEL");
  const chatMiraiModel           = fromLocalEnv("CHAT_MIRAI_MODEL");
  const chatMiraiRouterModel     = fromLocalEnv("CHAT_MIRAI_ROUTER_MODEL");
  const chatMiraiWeb             = fromLocalEnv("CHAT_MIRAI_WEB") || "true";
  const tavilyApiKey             = fromLocalEnv("TAVILY_API_KEY");
  const chatMiraiWebModel        = fromLocalEnv("CHAT_MIRAI_WEB_MODEL");
  // LiveKit Egress → Supabase Storage (call recordings) — optional. For the
  // installer-managed self-hosted Supabase stack, defaults come from the same
  // S3_PROTOCOL_ACCESS_KEY_ID/SECRET generated above for storage-api — no
  // manual credential step. An externally-managed Supabase (RUNLY_SUPABASE_MODE
  // != selfhosted) has no such default; those vars must be filled in by hand
  // from wherever that instance's storage-api is configured.
  const supabaseS3Endpoint    = fromLocalEnv("SUPABASE_S3_ENDPOINT")
    || (supabase.mode === "selfhosted" ? `${browserSupabaseUrl}/storage/v1/s3` : "");
  const supabaseS3AccessKeyId = fromLocalEnv("SUPABASE_S3_ACCESS_KEY_ID")
    || (supabase.mode === "selfhosted" ? supabase.secrets.S3_PROTOCOL_ACCESS_KEY_ID : "");
  const supabaseS3SecretKey   = fromLocalEnv("SUPABASE_S3_SECRET_ACCESS_KEY")
    || (supabase.mode === "selfhosted" ? supabase.secrets.S3_PROTOCOL_ACCESS_KEY_SECRET : "");
  const supabaseS3Region      = fromLocalEnv("SUPABASE_S3_REGION") || "local";
  // Identity-level SMTP (password reset, cross-company mail) — optional; preserve
  // any user-provided value across re-runs, same as the Google OAuth vars above.
  const smtpHost      = fromLocalEnv("SMTP_HOST");
  const smtpPort      = fromLocalEnv("SMTP_PORT") || "587";
  const smtpUser      = fromLocalEnv("SMTP_USER");
  const smtpPass      = fromLocalEnv("SMTP_PASS");
  const smtpFromName  = fromLocalEnv("SMTP_FROM_NAME") || "Runly ERP";
  const smtpFromEmail = fromLocalEnv("SMTP_FROM_EMAIL");
  const smtpTls       = fromLocalEnv("SMTP_TLS") || "false";
  const mailerAutoconfirm = resolveMailerAutoconfirm(fromLocalEnv);
  const liveKit = resolveLiveKitConfig({
    deployment: "local",
    isLinux,
    values: {
      mode: fromLocalEnv("LIVEKIT_MODE"),
      domain: fromLocalEnv("LIVEKIT_DOMAIN"),
      tlsMode: fromLocalEnv("LIVEKIT_TLS_MODE"),
      publicUrl: fromLocalEnv("LIVEKIT_URL"),
      internalUrl: fromLocalEnv("LIVEKIT_INTERNAL_URL"),
      apiKey: fromLocalEnv("LIVEKIT_API_KEY"),
      apiSecret: fromLocalEnv("LIVEKIT_API_SECRET"),
    },
  });
  // Recording is opt-in via the S3 vars themselves ("leave empty to
  // disable") rather than a separate flag — filling them in is already the
  // explicit action that turns it on.
  liveKit.recordingEnabled = liveKit.mode === "embedded"
    && Boolean(supabaseS3Endpoint && supabaseS3AccessKeyId && supabaseS3SecretKey);
  await writeLiveKitArtifacts(liveKit);

  const officeValues = withRunlyEnvAliases(parseOfficeEnv(existingEnvContent), process.env);
  const officePreserved = OFFICE_ENV_KEYS.filter(key => officeValues[key] !== undefined).map(key => `${key}=${officeValues[key]}`).join("\n");
  const envContent = `${preserveFirebaseEnv(existingEnvContent)}\n${officePreserved}\n# Auto-generated by infra/installer/setup-local.mjs
# Re-run the script anytime to refresh local Supabase credentials.
# Deployment-specific vars (CORS_ORIGIN, Google OAuth) are preserved across re-runs.

${renderInstanceIdentityEnv(identity)}
NODE_ENV=production
ATLAS_API_PORT=4010
ATLAS_TIME_ZONE=America/Mexico_City
TZ=America/Mexico_City

SUPABASE_URL=${supabase.internalUrl}
SUPABASE_ANON_KEY=${supabase.anonKey}
SUPABASE_SERVICE_ROLE_KEY=${supabase.serviceRoleKey}
SUPABASE_JWT_SECRET=${supabase.jwtSecret}

# Keep Runly JWT aligned with Supabase local JWT secret.
JWT_SECRET=${supabase.jwtSecret}

DATABASE_URL=${supabase.dbUrl}
DIRECT_URL=${supabase.dbUrl}

VITE_SUPABASE_URL=${browserSupabaseUrl}
VITE_SUPABASE_ANON_KEY=${supabase.anonKey}
RUNLY_SUPABASE_PUBLIC_URL=${deploymentValues.RUNLY_SUPABASE_PUBLIC_URL ?? ""}
VITE_ATLAS_API_URL=http://localhost:4010
CORS_ORIGIN=${corsOrigin}

# ── Identity-level SMTP (password reset, cross-company mail) ─────────────────
# Ajustes -> SMTP configures a SPECIFIC COMPANY's outgoing mail and always wins
# for that company. These vars are for mail that isn't any one company's
# business (password reset above all) — used outright before the database is
# even checked. Point them at your own mail provider. Leave empty and this
# mail simply won't send until you set them (there is no UI for this slot).
SMTP_HOST=${smtpHost}
SMTP_PORT=${smtpPort}
SMTP_USER=${smtpUser}
SMTP_PASS=${smtpPass}
SMTP_FROM_NAME=${smtpFromName}
SMTP_FROM_EMAIL=${smtpFromEmail}
SMTP_TLS=${smtpTls}

${renderSelfHostedSupabaseEnv(supabase, fromLocalEnv, mailerAutoconfirm)}

# ── Custom module ZIP upload ──────────────────────────────────────────────────
# Container-side path where custom-modules/ is mounted (matches docker-compose volume).
# Required for POST /modules/:key/upload and DELETE /modules/:key/purge.
ATLAS_MODULES_DIR=/app/modules/custom

# ── Google Calendar integration (optional) ───────────────────────────────────
# Register OAuth credentials at: https://console.cloud.google.com → APIs & Services → Credentials
# Leave placeholders to disable Google Calendar sync.
GOOGLE_OAUTH_CLIENT_ID=${googleClientId}
GOOGLE_OAUTH_CLIENT_SECRET=${googleClientSecret}
GOOGLE_OAUTH_REDIRECT_URI=${googleRedirectUri}
# Stable 32-byte base64 key — auto-generated on first run. Changing it invalidates stored tokens.
GOOGLE_OAUTH_ENCRYPTION_KEY=${googleEncryptionKey}

# ── atlas.pfm — lectura de tickets con IA (opcional) ─────────────────────────
# Sin GROQ_API_KEY el modulo funciona igual y la subida de tickets responde 503
# (la UI cae a captura manual). Clave gratis en https://console.groq.com
PFM_VISION_PROVIDER=${pfmVisionProvider}
GROQ_API_KEY=${groqApiKey}
GROQ_BASE_URL=${groqBaseUrl}
PFM_VISION_MODEL=${pfmVisionModel}
PFM_VISION_TIMEOUT_MS=${pfmVisionTimeout}

# ── runly.chat MirAI assistant + runly.pfm/inventory AI extras (optional) ────
# All reuse GROQ_API_KEY. Without it, the model overrides below are unused.
INVENTORY_AI_SIGNING_SECRET=${inventoryAiSigningSecret}
PFM_ASSISTANT_MODEL=${pfmAssistantModel}
CHAT_MIRAI_MODEL=${chatMiraiModel}
CHAT_MIRAI_ROUTER_MODEL=${chatMiraiRouterModel}
CHAT_MIRAI_WEB=${chatMiraiWeb}
TAVILY_API_KEY=${tavilyApiKey}
CHAT_MIRAI_WEB_MODEL=${chatMiraiWebModel}

# ── LiveKit Egress → Supabase Storage (call recordings, optional) ───────────
# Get these from the self-hosted Supabase Storage container's own S3-compatible
# config — NOT the same as SUPABASE_SERVICE_ROLE_KEY. Leave empty to disable.
SUPABASE_S3_ENDPOINT=${supabaseS3Endpoint}
SUPABASE_S3_ACCESS_KEY_ID=${supabaseS3AccessKeyId}
SUPABASE_S3_SECRET_ACCESS_KEY=${supabaseS3SecretKey}
SUPABASE_S3_REGION=${supabaseS3Region}

# ── Runly Calls / LiveKit ──────────────────────────────────────────────────
LIVEKIT_MODE=${liveKit.mode}
LIVEKIT_DOMAIN=${liveKit.domain}
LIVEKIT_TLS_MODE=${liveKit.tlsMode}
LIVEKIT_URL=${liveKit.publicUrl}
LIVEKIT_INTERNAL_URL=${liveKit.internalUrl}
LIVEKIT_API_KEY=${liveKit.apiKey}
LIVEKIT_API_SECRET=${liveKit.apiSecret}
`;

  await fs.writeFile(localEnvFile, mergeRunlyEnvText(envContent, existingEnvContent, process.env), { encoding: "utf8", mode: 0o600 });
  try { await fs.chmod(localEnvFile, 0o600); } catch { /* Windows does not apply POSIX modes. */ }

  // Docker Compose auto-loads a file named exactly ".env" in the same directory
  // for ${VAR} interpolation. The web service reads ${SUPABASE_URL} and
  // ${SUPABASE_ANON_KEY} from here to pass them into runtime-config.js.
  // Must use the browser-accessible URL (localhost), not host.docker.internal.
  const composeEnvFile = path.resolve(installerDir, ".env");
  // Self-hosted Supabase's own compose file (docker-compose.supabase.yml)
  // interpolates ${SUPABASE_SERVICE_ROLE_KEY}, ${SUPABASE_POSTGRES_PASSWORD},
  // etc. directly — this file is where Compose gets them from, exactly like
  // upstream Supabase's own self-hosting .env. It carries real secrets, so
  // it gets the same 0600 permissions as .env.local (previously it did not,
  // back when it only ever held the public anon key).
  const supabaseComposeSecrets = supabase.mode === "selfhosted"
    ? [
      `SUPABASE_SERVICE_ROLE_KEY=${supabase.serviceRoleKey}`,
      `SUPABASE_JWT_SECRET=${supabase.jwtSecret}`,
      `SUPABASE_POSTGRES_PASSWORD=${supabase.secrets.SUPABASE_POSTGRES_PASSWORD}`,
      `RUNLY_SUPABASE_SECRET_KEY_BASE=${supabase.secrets.RUNLY_SUPABASE_SECRET_KEY_BASE}`,
      `RUNLY_SUPABASE_REALTIME_DB_ENC_KEY=${supabase.secrets.RUNLY_SUPABASE_REALTIME_DB_ENC_KEY}`,
      `RUNLY_SUPABASE_META_CRYPTO_KEY=${supabase.secrets.RUNLY_SUPABASE_META_CRYPTO_KEY}`,
      `REGION=local`,
      `S3_PROTOCOL_ACCESS_KEY_ID=${supabase.secrets.S3_PROTOCOL_ACCESS_KEY_ID}`,
      `S3_PROTOCOL_ACCESS_KEY_SECRET=${supabase.secrets.S3_PROTOCOL_ACCESS_KEY_SECRET}`,
      `RUNLY_SUPABASE_KONG_HOST_PORT=${supabase.ports.kongPort}`,
      `RUNLY_SUPABASE_STUDIO_HOST_PORT=${supabase.ports.studioPort}`,
      `RUNLY_SUPABASE_PUBLIC_URL=${browserSupabaseUrl}`,
      `CORS_ORIGIN=${corsOrigin}`,
      `RUNLY_SUPABASE_MAILER_AUTOCONFIRM=${mailerAutoconfirm}`,
      `RUNLY_SUPABASE_SMTP_ADMIN_EMAIL=${fromLocalEnv("RUNLY_SUPABASE_SMTP_ADMIN_EMAIL")}`,
      `RUNLY_SUPABASE_SMTP_HOST=${fromLocalEnv("RUNLY_SUPABASE_SMTP_HOST")}`,
      `RUNLY_SUPABASE_SMTP_PORT=${fromLocalEnv("RUNLY_SUPABASE_SMTP_PORT") || "587"}`,
      `RUNLY_SUPABASE_SMTP_USER=${fromLocalEnv("RUNLY_SUPABASE_SMTP_USER")}`,
      `RUNLY_SUPABASE_SMTP_PASS=${fromLocalEnv("RUNLY_SUPABASE_SMTP_PASS")}`,
      `RUNLY_SUPABASE_SMTP_SENDER_NAME=${fromLocalEnv("RUNLY_SUPABASE_SMTP_SENDER_NAME") || "Runly"}`,
      `RUNLY_SUPABASE_ADDITIONAL_REDIRECT_URLS=${fromLocalEnv("RUNLY_SUPABASE_ADDITIONAL_REDIRECT_URLS")}`,
      `RUNLY_SUPABASE_DISABLE_SIGNUP=${fromLocalEnv("RUNLY_SUPABASE_DISABLE_SIGNUP") || "false"}`,
    ].join("\n")
    : "";
  const composeEnvContent = `# Auto-generated by setup-local.mjs — do not edit manually.
# Docker Compose reads this file to resolve \${SUPABASE_URL}, \${SUPABASE_ANON_KEY}, and
# \${ATLAS_API_URL} in the web service so the browser can reach them.
# For VPS deployment, re-run with ATLAS_SUPABASE_PUBLIC_URL and ATLAS_API_URL set:
#   ATLAS_SUPABASE_PUBLIC_URL=https://supabase.yourdomain.com ATLAS_API_URL=https://api.yourdomain.com node setup-local.mjs
SUPABASE_URL=${browserSupabaseUrl}
SUPABASE_ANON_KEY=${supabase.anonKey}
${publicApiUrl ? `RUNLY_API_URL=${publicApiUrl}` : "# ATLAS_API_URL defaults to http://localhost:4010 — override for VPS/public deployments"}
# Isolation/ports: same values persisted in .env.local, mirrored here because
# only this file (or the shell environment) drives Compose's own \${VAR}
# interpolation of docker-compose.yml — env_file: values do not.
${composeInterpolationEnvLines(existingEnvContent)}
${supabaseComposeSecrets}
`;
  await fs.writeFile(composeEnvFile, canonicalizeRunlyEnvText(composeEnvContent), { encoding: "utf8", mode: 0o600 });
  try { await fs.chmod(composeEnvFile, 0o600); } catch { /* Windows does not apply POSIX modes. */ }
  const office = await configureOffice({ envFile: localEnvFile, composeEnvFile });
  await configureFirebase({ envFile: localEnvFile });
  return { liveKit, office, supabase };
}

async function main() {
  // ── docs-only shortcut ────────────────────────────────────────────────────
  if (docsOnly) {
    console.log("[setup-local] --docs-only: downloading Dev Kit files only.");
    await downloadDevKit();
    console.log("[setup-local] Done.");
    return;
  }

  const identity = await resolveIdentity();
  console.log(`[setup-local] Instance identity: ${identity.instanceId} (project: ${identity.projectName}, containers: ${identity.containerPrefix}-*)`);

  let existingEnvContentForMode = "";
  try { existingEnvContentForMode = await fs.readFile(localEnvFile, "utf8"); } catch { /* first run */ }
  const supabaseMode = resolveSupabaseMode(existingEnvContentForMode);
  if (supabaseMode === "selfhosted") composeFiles = [...composeFiles, "-f", supabaseComposeFile];
  console.log(
    supabaseMode === "selfhosted"
      ? "[setup-local] Supabase mode: selfhosted (production-grade Docker Compose stack)"
      : "[setup-local] Supabase mode: cli-dev (Supabase CLI — dev convenience only, NOT for production; see README.md)",
  );

  console.log("[1/8] Validating dependencies...");
  run("docker", ["compose", "version"]);

  let supabaseInput;
  if (supabaseMode === "cli-dev") {
    run(npxCommand, ["--version"]);
    if (!(await exists(supabaseWorkdir))) {
      await fs.mkdir(supabaseWorkdir, { recursive: true });
    }

    console.log("[2/8] Initializing Supabase project (if missing)...");
    if (!(await exists(supabaseConfig))) {
      run(npxCommand, ["--yes", "supabase", "init", "--yes", "--workdir", supabaseWorkdir]);
    }
    await adoptSupabaseProjectId(identity.instanceId);

    console.log("[3/8] Starting Supabase local stack (Supabase CLI)...");
    run(npxCommand, [
      "--yes",
      "supabase",
      "start",
      "--workdir",
      supabaseWorkdir,
      "-x",
      "logflare",
      "-x",
      "vector",
    ]);

    console.log("[4/8] Reading Supabase runtime credentials...");
    const statusOutput = capture(npxCommand, [
      "--yes",
      "supabase",
      "status",
      "--workdir",
      supabaseWorkdir,
      "-o",
      "env",
    ]);
    supabaseInput = { mode: "cli-dev", envMap: parseSupabaseStatusEnv(statusOutput) };
  } else {
    console.log("[2/8] Resolving self-hosted Supabase secrets and ports (generated once, then persisted)...");
    supabaseInput = { mode: "selfhosted" };
    console.log("[3/8] (self-hosted Supabase starts together with the Runly profile in step 8/8)");
    console.log("[4/8] (no external status call needed — secrets are generated locally)");
  }

  const { liveKit, office, supabase } = await writeLocalEnv(supabaseInput, identity);
  await validateLiveKitDns(liveKit);
  console.log(`Generated ${localEnvFile}`);
  if (supabase.mode === "selfhosted") {
    console.log(`  Supabase gateway (Kong): port ${supabase.ports.kongPort} (bind: ${process.env.RUNLY_PUBLIC_BIND_ADDR || "0.0.0.0"})`);
    console.log(`  Supabase Studio: 127.0.0.1:${supabase.ports.studioPort} (loopback only — use an SSH tunnel)`);
  }

  await downloadDevKit();

  if (skipComposeUp) {
    console.log("[6/8] Skipping image pull and compose up (--skip-compose-up).");
    return;
  }

  let resolvedApiImage = apiImage;
  let resolvedWorkerImage = workerImage;
  let resolvedWebImage = webImage;

  if (skipPull) {
    console.log("[6/8] Skipping image pull (--skip-pull). Using local images.");
  } else {
    console.log("[6/8] Pulling Runly local runtime images...");
    resolvedApiImage = pullWithRetry(apiImage, "API");
    resolvedWorkerImage = pullWithRetry(workerImage, "Worker");
    resolvedWebImage = pullWithRetry(webImage, "Web");
    if (liveKit.mode === "embedded") {
      pullWithRetry(liveKitImage, "LiveKit");
      pullWithRetry(liveKitRedisImage, "LiveKit Redis");
      if (liveKit.managedTls) pullWithRetry(liveKitCaddyImage, "LiveKit Caddy");
      if (liveKit.recordingEnabled) pullWithRetry(liveKitEgressImage, "LiveKit Egress");
    }
    if (supabaseMode === "selfhosted") {
      for (const image of SELF_HOSTED_SUPABASE_IMAGES) pullWithRetry(image, image);
    }
    // Remove dangling layers left behind when `latest` tags are re-pulled.
    console.log("     Pruning dangling images...");
    tryRun("docker", ["image", "prune", "-f"]);
  }

  let migrateNetworkArgs = [];
  if (supabaseMode === "selfhosted") {
    console.log("[6b/8] Starting self-hosted Supabase and waiting for it to become healthy...");
    run("docker", ["compose", ...composeFiles, "up", "-d", ...SELF_HOSTED_SUPABASE_REQUIRED_SERVICES, ...SELF_HOSTED_SUPABASE_BEST_EFFORT_SERVICES]);
    await waitForSelfHostedSupabaseHealthy(identity.containerPrefix);
    // migrate/seed run as one-shot `docker run` containers (not compose
    // services), so they must explicitly join this project's network to
    // reach supabase-db by service name — Compose's default network is
    // named "<project-name>_default" unless the project overrides it.
    migrateNetworkArgs = ["--network", `${identity.projectName}_default`];
  }

  console.log("[7/8] Running migrations and seed...");
  run("docker", [
    "run", "--rm",
    ...addHostArgs,
    ...migrateNetworkArgs,
    "--env-file", localEnvFile,
    resolvedApiImage, "pnpm", "db:migrate",
  ]);
  run("docker", [
    "run", "--rm",
    ...addHostArgs,
    ...migrateNetworkArgs,
    "--env-file", localEnvFile,
    resolvedApiImage, "pnpm", "db:seed",
  ]);

  console.log("[8/8] Starting Runly local profile...");
  if (!office.enabled) run("docker", ["compose", ...composeFiles, "--profile", "office", "stop", "collabora"]);
  removeInactiveLiveKitServices(liveKit);
  const liveKitProfiles = getLiveKitComposeProfiles(liveKit, { recordingEnabled: liveKit.recordingEnabled })
    .flatMap((profile) => ["--profile", profile]);
  // Limit forced restarts to Runly/Calls: an unchanged editor must keep its sessions.
  const services = ["runly-api-local", "runly-worker-local", "runly-web-local",
    ...(liveKit.mode === "embedded" ? ["livekit-redis", "livekit",
      ...(liveKit.managedTls ? ["livekit-caddy"] : []),
      ...(liveKit.recordingEnabled ? ["egress"] : [])] : [])];
  run(
    "docker",
    ["compose", ...composeFiles, "--profile", "local", ...liveKitProfiles, ...office.profiles, "up", "-d", "--force-recreate", ...services],
    {
      env: {
        ...process.env,
        RUNLY_API_LOCAL_IMAGE: resolvedApiImage,
        ATLAS_API_LOCAL_IMAGE: resolvedApiImage,
        RUNLY_WORKER_LOCAL_IMAGE: resolvedWorkerImage,
        ATLAS_WORKER_LOCAL_IMAGE: resolvedWorkerImage,
        RUNLY_WEB_LOCAL_IMAGE: resolvedWebImage,
        ATLAS_WEB_LOCAL_IMAGE: resolvedWebImage,
        LIVEKIT_IMAGE: liveKitImage,
        LIVEKIT_REDIS_IMAGE: liveKitRedisImage,
        LIVEKIT_CADDY_IMAGE: liveKitCaddyImage,
        LIVEKIT_EGRESS_IMAGE: liveKitEgressImage,
      },
    }
  );

  if (office.enabled) run("docker", ["compose", ...composeFiles, ...office.profiles, "up", "-d", "collabora"]);
  await validateLiveKitRuntime(liveKit);
  await checkOfficeRuntime(office);

  const finalEnvContent = await fs.readFile(localEnvFile, "utf8");
  const publicBindAddr = parseEnvValue(finalEnvContent, "RUNLY_PUBLIC_BIND_ADDR") || "0.0.0.0";
  const findings = assessSupabaseSecurityPosture({
    mode: supabase.mode,
    publicBindAddr,
    kongPort: supabase.ports?.kongPort,
    studioPort: supabase.ports?.studioPort,
    secrets: supabase.secrets,
    smtpConfigured: Boolean(parseEnvValue(finalEnvContent, "RUNLY_SUPABASE_SMTP_HOST")),
  });
  const critical = findings.filter((f) => f.level === "critical");
  const warnings = findings.filter((f) => f.level === "warning");

  console.log("");
  console.log("Endpoints:");
  console.log("- Runly web: http://localhost:5173");
  console.log("- Runly API: http://localhost:4010");
  if (supabase.mode === "selfhosted") {
    console.log(`- Supabase API gateway: http://localhost:${supabase.ports.kongPort}`);
    console.log(`- Supabase Studio (loopback only): 127.0.0.1:${supabase.ports.studioPort} — reach it via an SSH tunnel on a remote host`);
  } else {
    console.log("- Supabase API gateway (Supabase CLI, dev only): http://localhost:54321");
    console.log("- Supabase Studio (Supabase CLI, dev only): http://localhost:54323");
  }
  if (liveKit.mode !== "disabled") console.log(`- LiveKit: ${liveKit.publicUrl}`);
  console.log(`- AME3 Dev Kit: ${devKitDir}`);

  console.log("");
  if (warnings.length > 0) {
    console.log("Production readiness — warnings:");
    for (const finding of warnings) console.log(`  ! ${finding.message}`);
  }
  if (critical.length > 0) {
    console.log("Production readiness — CRITICAL (this install is NOT ready for production):");
    for (const finding of critical) console.log(`  x ${finding.message}`);
    console.log("");
    console.log("Local installation finished, but is NOT production-ready — see above.");
  } else {
    console.log("Local installation is ready for production." + (warnings.length ? " (see warnings above)" : ""));
  }
}

main().catch((error) => {
  console.error("");
  console.error("[setup-local] Error:");
  console.error(error.message);
  process.exit(1);
});
