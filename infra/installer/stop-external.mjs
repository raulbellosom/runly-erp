#!/usr/bin/env node
// stop-external.mjs
//
// Stop (or reset) the Runly external profile.
//
// Usage:
//   node stop-external.mjs           # stop containers, keep .env.external
//   node stop-external.mjs --reset   # stop + remove .env.external and .env

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { resolveInstanceIdentity } from "./lib/instance-identity.mjs";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const isWindows  = process.platform === "win32";
const isReset    = process.argv.includes("--reset");
const composeFile = path.resolve(__dirname, "docker-compose.yml");
const linuxComposeOverride = path.resolve(__dirname, "docker-compose.linux.yml");
const externalEnvFile = path.resolve(__dirname, ".env.external");
const composeFiles = process.platform === "linux" && fs.existsSync(linuxComposeOverride)
  ? ["-f", composeFile, "-f", linuxComposeOverride]
  : ["-f", composeFile];

// Resolve this installation's identity so we only ever stop/remove ITS
// containers and Compose project — never another instance's on the same host.
let existingEnvContent = "";
try { existingEnvContent = fs.readFileSync(externalEnvFile, "utf8"); } catch { /* nothing installed yet */ }
const identity = resolveInstanceIdentity(existingEnvContent);
process.env.RUNLY_COMPOSE_PROJECT_NAME = identity.projectName;
process.env.RUNLY_CONTAINER_PREFIX = identity.containerPrefix;

function run(command, args, { cwd = __dirname, failOk = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: isWindows,
  });
  if (!failOk && result.error) throw new Error(`${command}: ${result.error.message}`);
  return result.status === 0;
}

function removeIfExists(filePath) {
  try {
    fs.rmSync(filePath, { recursive: true, force: true });
    console.log(`  Removed ${path.relative(__dirname, filePath)}`);
  } catch {
    // ignore
  }
}

function tryRun(command, args, { cwd = __dirname } = {}) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: isWindows });
  return !result.error && result.status === 0;
}

console.log(
  isReset
    ? "[stop-external] Stopping and resetting Runly external..."
    : "[stop-external] Stopping Runly external..."
);

if (fs.existsSync(composeFile)) {
  console.log("\n[1] Stopping Runly external containers...");
  run(
    "docker",
    [
      "compose", ...composeFiles,
      "--profile", "external",
      "--profile", "office",
      "--profile", "livekit",
      "--profile", "livekit-tls",
      "--profile", "livekit-egress",
      "down", "--remove-orphans",
      ...(isReset ? ["--volumes"] : []),
    ],
    { failOk: true },
  );
} else {
  console.log("[1] docker-compose.yml not found — skipping compose down.");
}

// Always prune dangling images after stopping — safe, only removes untagged layers.
console.log("\n[2] Pruning dangling images...");
tryRun("docker", ["image", "prune", "-f"]);

if (isReset) {
  console.log("\n[3] Removing generated files...");
  removeIfExists(path.resolve(__dirname, ".env.external"));
  removeIfExists(path.resolve(__dirname, ".env"));
  removeIfExists(path.resolve(__dirname, "livekit", "livekit.yaml"));
  removeIfExists(path.resolve(__dirname, "livekit", "Caddyfile"));
  removeIfExists(path.resolve(__dirname, "livekit", "reverse-proxy.nginx.conf"));
  console.log("\nReset complete. Run `node setup-external.mjs` to start fresh.");
} else {
  console.log(
    "\nStopped. Run `node setup-external.mjs --skip-pull --skip-migrate` to restart."
  );
}
