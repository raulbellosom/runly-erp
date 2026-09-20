// Resolves the per-installation identity used to keep this Runly instance's
// Docker Compose project, container names, and published ports from
// colliding with any other Runly instance (or unrelated Docker project) on
// the same host. Each installer directory (local or external) is one
// instance's own data/config location, so identity only needs to be unique
// within a single host, not globally.
import crypto from "node:crypto";

const LEGACY_PROJECT_NAME = "runlyerp";
const LEGACY_CONTAINER_PREFIX = "runly";

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

export function generateInstanceId(randomBytes = crypto.randomBytes) {
  return randomBytes(4).toString("hex");
}

// - Brand-new installs (no prior env file) get a fresh instance id and a
//   project name/container prefix derived from it, so a second instance
//   started from a separate installer directory does not collide with the
//   first by default.
// - Existing installs (env file already present, no RUNLY_INSTANCE_ID stored
//   yet) keep the legacy fixed project name/container prefix, so upgrading
//   the installer never renames — and thus never orphans — their existing
//   containers, networks, or volumes.
// - An explicit RUNLY_INSTANCE_ID / RUNLY_COMPOSE_PROJECT_NAME /
//   RUNLY_CONTAINER_PREFIX env var always wins, for deliberate adoption or
//   migration of an installation onto a new identity.
export function resolveInstanceIdentity(existingEnvContent, { randomBytes = crypto.randomBytes } = {}) {
  const content = existingEnvContent ?? "";
  const isExistingInstall = Boolean(content.trim());

  const instanceId =
    process.env.RUNLY_INSTANCE_ID ||
    parseEnvValue(content, "RUNLY_INSTANCE_ID") ||
    generateInstanceId(randomBytes);

  const projectName =
    process.env.RUNLY_COMPOSE_PROJECT_NAME ||
    parseEnvValue(content, "RUNLY_COMPOSE_PROJECT_NAME") ||
    (isExistingInstall ? LEGACY_PROJECT_NAME : `runly-${instanceId}`);

  const containerPrefix =
    process.env.RUNLY_CONTAINER_PREFIX ||
    parseEnvValue(content, "RUNLY_CONTAINER_PREFIX") ||
    (isExistingInstall ? LEGACY_CONTAINER_PREFIX : `runly-${instanceId}`);

  return { instanceId, projectName, containerPrefix, isExistingInstall };
}

export function renderInstanceIdentityEnv({ instanceId, projectName, containerPrefix }) {
  return [
    "# ── Instance identity (installer-managed) ────────────────────────────────────",
    "# Isolates this installation's Docker Compose project, container names, and",
    "# published ports from any other Runly instance on this host. Generated once on",
    "# first install and preserved on every re-run. Do not hand-edit unless you are",
    "# deliberately adopting/migrating this installation onto a new identity — see",
    "# docs/deployment for the adoption procedure.",
    `RUNLY_INSTANCE_ID=${instanceId}`,
    `RUNLY_COMPOSE_PROJECT_NAME=${projectName}`,
    `RUNLY_CONTAINER_PREFIX=${containerPrefix}`,
    "",
  ].join("\n");
}

export function containerName(containerPrefix, suffix) {
  return `${containerPrefix}-${suffix}`;
}
