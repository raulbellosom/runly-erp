#!/usr/bin/env node
// infra/docker/build-push.mjs
//
// Builds multi-platform images (linux/amd64 + linux/arm64) via docker buildx.
//
// Usage (from repo root):
//   node infra/docker/build-push.mjs              # build + push only images whose inputs changed
//                                                 # since their last successful release
//   node infra/docker/build-push.mjs --all        # build + push every image regardless of changes
//   node infra/docker/build-push.mjs --dry-run    # print which images would be released and why
//   node infra/docker/build-push.mjs --build      # local single-platform build only (no push)
//   node infra/docker/build-push.mjs --push       # multi-platform build + push (same as default)
//   node infra/docker/build-push.mjs --web        # build + push web image only
//   node infra/docker/build-push.mjs --api        # build + push api image only
//   node infra/docker/build-push.mjs --worker     # build + push worker image only
//   node infra/docker/build-push.mjs --web --build   # local build web only (no push)
//   node infra/docker/build-push.mjs --web --push    # multi-platform build + push web only
//
// Via pnpm:
//   pnpm docker:build          # local build all (single-platform, for testing)
//   pnpm docker:push           # multi-platform build + push all
//   pnpm docker:release        # multi-platform build + push changed images only
//   pnpm docker:release:all    # multi-platform build + push all
//   pnpm docker:release:check  # dry run: list images that need a release
//   pnpm docker:release:web   # multi-platform build + push web only
//   pnpm docker:release:api    # multi-platform build + push api only
//   pnpm docker:release:worker # multi-platform build + push worker only
//   pnpm docker:release:transcriber # multi-platform build + push transcriber only
//   pnpm docker:release:tts    # multi-platform build + push tts only
//   pnpm docker:release:backup # multi-platform build + push backup only
//
// NOTE: Multi-platform builds (--push / default) use docker buildx and require
// you to be logged in to Docker Hub (`docker login`). Building for linux/arm64
// from an amd64 host uses QEMU emulation and takes significantly longer.
//
// Change detection: after each image is pushed, the current commit SHA is
// recorded in infra/docker/.release-state.json (git-ignored, per machine).
// The next run diffs that SHA against the working tree (committed + staged +
// unstaged + untracked files) and matches the changed paths against each
// image's `inputs`. An image with no recorded SHA is always released.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");
const isWindows = process.platform === "win32";

const argv = new Set(process.argv.slice(2));
// --build → local single-platform build only (loads to local Docker, no push)
// default or --push → docker buildx multi-platform build + push to registry
const localBuildMode = argv.has("--build");

const REGISTRY  = "raulbellosom/runlyerp";
const PLATFORMS = "linux/amd64,linux/arm64";
const BUILDER   = "runly-multiplatform";

const STATE_FILE = path.join(__dirname, ".release-state.json");

// Files every Node image's `pnpm install` layer depends on.
const NODE_WORKSPACE_INPUTS = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  ".npmrc",
  ".dockerignore",
  "apps/api/package.json",
  "apps/desktop/package.json",
  "apps/worker/package.json",
  "packages/",
  "modules/",
];

// `inputs` are path prefixes (repo-relative, forward slashes) that end up in
// the image. Keep them in sync with the COPY lines of each Dockerfile.
const ALL_IMAGES = [
  {
    key:        "api",
    tag:        `${REGISTRY}:api-latest`,
    dockerfile: "infra/docker/api.Dockerfile",
    label:      "API",
    inputs: [
      ...NODE_WORKSPACE_INPUTS,
      "prisma.config.ts",
      "prisma/",
      "apps/api/",
      "apps/desktop/public/module-logos/",
      "infra/docker/api.Dockerfile",
      "infra/docker/api-entrypoint.sh",
    ],
  },
  {
    key:        "worker",
    tag:        `${REGISTRY}:worker-latest`,
    dockerfile: "infra/docker/worker.Dockerfile",
    label:      "Worker",
    inputs: [
      ...NODE_WORKSPACE_INPUTS,
      "prisma.config.ts",
      "prisma/",
      "apps/api/",
      "apps/worker/",
      "infra/docker/worker.Dockerfile",
    ],
  },
  {
    key:        "web",
    tag:        `${REGISTRY}:web-latest`,
    dockerfile: "infra/docker/web.Dockerfile",
    label:      "Web",
    inputs: [
      ...NODE_WORKSPACE_INPUTS,
      "apps/desktop/",
      "infra/nginx/",
      "infra/docker/web.Dockerfile",
    ],
  },
  {
    key:        "transcriber",
    tag:        `${REGISTRY}:transcriber-latest`,
    dockerfile: "infra/docker/transcriber.Dockerfile",
    label:      "Transcriber",
    inputs: [".dockerignore", "apps/transcriber/", "infra/docker/transcriber.Dockerfile"],
  },
  {
    key:        "tts",
    tag:        `${REGISTRY}:tts-latest`,
    dockerfile: "infra/docker/tts.Dockerfile",
    label:      "TTS",
    inputs: [".dockerignore", "apps/tts/", "infra/docker/tts.Dockerfile"],
  },
  {
    key:        "backup",
    tag:        `${REGISTRY}:backup-latest`,
    dockerfile: "infra/docker/backup.Dockerfile",
    label:      "Backup",
    inputs: [".dockerignore", "apps/backup/", "infra/docker/backup.Dockerfile"],
  },
];

function git(args) {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
  return result.stdout;
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

// Changed paths between `sha` and the current working tree, including
// uncommitted and untracked files. Returns null when `sha` is unusable.
function changedPathsSince(sha) {
  if (git(["cat-file", "-e", `${sha}^{commit}`]) === null) return null;
  const diff = git(["diff", "--name-only", sha]);
  const untracked = git(["ls-files", "--others", "--exclude-standard"]);
  if (diff === null || untracked === null) return null;
  return [...diff.split("\n"), ...untracked.split("\n")].filter(Boolean);
}

// Returns { reason } when the image must be released, or null when unchanged.
function releaseReason(image, state) {
  const sha = state[image.key]?.sha;
  if (!sha) return { reason: "sin release previo registrado" };
  const changed = changedPathsSince(sha);
  if (changed === null) return { reason: `commit ${sha.slice(0, 8)} no encontrado` };
  const hits = changed.filter((file) => image.inputs.some((input) => file === input || file.startsWith(input)));
  if (hits.length === 0) return null;
  const sample = hits.slice(0, 3).join(", ");
  return { reason: `${hits.length} archivo(s) cambiado(s): ${sample}${hits.length > 3 ? ", ..." : ""}` };
}

// Explicit --web / --api / ... flags or --all bypass change detection.
const explicitKeys = ALL_IMAGES.map((i) => i.key).filter((k) => argv.has(`--${k}`));
const forceAll = argv.has("--all");
const dryRun = argv.has("--dry-run");
const releaseState = readState();

let images;
if (explicitKeys.length > 0) {
  images = ALL_IMAGES.filter((i) => explicitKeys.includes(i.key));
} else if (forceAll || localBuildMode || argv.has("--mark-released")) {
  images = ALL_IMAGES;
} else {
  images = [];
  console.log("Detectando cambios desde el ultimo release de cada imagen:");
  for (const image of ALL_IMAGES) {
    const decision = releaseReason(image, releaseState);
    console.log(`  ${decision ? "RELEASE" : "skip   "} ${image.label.padEnd(12)} ${decision ? decision.reason : "sin cambios"}`);
    if (decision) images.push(image);
  }
  if (images.length === 0) {
    console.log("\nNada que publicar: ninguna imagen tiene cambios. Usa --all para forzar.");
    process.exit(0);
  }
}

// --mark-released: record HEAD as released for the selected images without
// building (e.g. to seed the state after a release made outside this script).
if (argv.has("--mark-released")) {
  const headSha = git(["rev-parse", "HEAD"])?.trim();
  const targets = images;
  for (const { key } of targets) releaseState[key] = { sha: headSha, releasedAt: new Date().toISOString() };
  writeState(releaseState);
  console.log(`Marcadas como publicadas en ${headSha?.slice(0, 8)}: ${targets.map((i) => i.label).join(", ")}`);
  process.exit(0);
}

if (dryRun) {
  console.log(`\n[dry-run] Se publicarian: ${images.map((i) => i.label).join(", ")}`);
  process.exit(0);
}

function run(command, args) {
  console.log(`\n$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: isWindows,
  });
  if (result.error) throw new Error(`${command}: ${result.error.message}`);
  if (result.status !== 0) process.exit(result.status);
}

function tryRun(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "pipe",
    shell: isWindows,
  });
  return !result.error && result.status === 0;
}

function ensureBuildxBuilder() {
  // Check if the named builder already exists.
  const exists = tryRun("docker", ["buildx", "inspect", BUILDER]);
  if (!exists) {
    console.log(`\n[buildx] Creating multi-platform builder "${BUILDER}"...`);
    run("docker", ["buildx", "create", "--name", BUILDER, "--driver", "docker-container"]);
  }
  // Switch to it.
  run("docker", ["buildx", "use", BUILDER]);
  // An existing docker-container builder may be stopped after Docker Desktop
  // restarts. `use` only selects it; `inspect --bootstrap` starts BuildKit and
  // waits until its worker is ready.
  run("docker", ["buildx", "inspect", BUILDER, "--bootstrap"]);
}

if (localBuildMode) {
  // --build only: single-platform local build for quick testing/inspection.
  // Loads the image into the local Docker daemon (current host platform only).
  console.log(`=== Local build (single-platform): ${images.map((i) => i.label).join(", ")} ===`);
  console.log("NOTE: Local builds are single-platform (current host arch). Use the default");
  console.log("      command without --build to produce multi-platform images for release.\n");
  for (const { tag, dockerfile, label } of images) {
    console.log(`\n--- Building ${label} (${tag}) ---`);
    run("docker", ["build", "-f", dockerfile, "-t", tag, "."]);
  }
  // Re-tagging `latest` leaves the previous image dangling. Prune to keep
  // the local daemon clean after every build cycle.
  console.log("\nPruning dangling images from previous builds...");
  tryRun("docker", ["image", "prune", "-f"]);
  console.log("\nLocal build done. Images are loaded into your local Docker daemon.");
} else {
  // Default / --push: multi-platform build + push via buildx.
  console.log(`=== Multi-platform build + push (${PLATFORMS}): ${images.map((i) => i.label).join(", ")} ===`);
  console.log("NOTE: This uses docker buildx. Building linux/arm64 from an amd64 host");
  console.log("      uses QEMU emulation and may take 10-30 min per image.\n");

  ensureBuildxBuilder();

  const headSha = git(["rev-parse", "HEAD"])?.trim();
  for (const { key, tag, dockerfile, label } of images) {
    console.log(`\n--- Building + pushing ${label} (${tag}) for ${PLATFORMS} ---`);
    run("docker", [
      "buildx", "build",
      "--platform", PLATFORMS,
      "-f", dockerfile,
      "-t", tag,
      "--push",
      ".",
    ]);
    // Record per image right after its push so a later failure does not
    // force already-published images to be rebuilt on the next run.
    if (headSha) {
      releaseState[key] = { sha: headSha, releasedAt: new Date().toISOString() };
      writeState(releaseState);
    }
  }
  console.log("\nMulti-platform build + push done.");
  console.log(`Images are available on Docker Hub for both linux/amd64 and linux/arm64.`);
}
