#!/usr/bin/env node
// infra/docker/build-push.mjs
//
// Builds multi-platform images (linux/amd64 + linux/arm64) via docker buildx.
//
// Usage (from repo root):
//   node infra/docker/build-push.mjs              # build + push all 3 images (multi-platform)
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
//   pnpm docker:release        # multi-platform build + push all
//   pnpm docker:release:web    # multi-platform build + push web only
//   pnpm docker:release:api    # multi-platform build + push api only
//   pnpm docker:release:worker # multi-platform build + push worker only
//
// NOTE: Multi-platform builds (--push / default) use docker buildx and require
// you to be logged in to Docker Hub (`docker login`). Building for linux/arm64
// from an amd64 host uses QEMU emulation and takes significantly longer.

import { spawnSync } from "node:child_process";
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

const ALL_IMAGES = [
  {
    key:        "api",
    tag:        `${REGISTRY}:api-latest`,
    dockerfile: "infra/docker/api.Dockerfile",
    label:      "API",
  },
  {
    key:        "worker",
    tag:        `${REGISTRY}:worker-latest`,
    dockerfile: "infra/docker/worker.Dockerfile",
    label:      "Worker",
  },
  {
    key:        "web",
    tag:        `${REGISTRY}:web-latest`,
    dockerfile: "infra/docker/web.Dockerfile",
    label:      "Web",
  },
  {
    key:        "transcriber",
    tag:        `${REGISTRY}:transcriber-latest`,
    dockerfile: "infra/docker/transcriber.Dockerfile",
    label:      "Transcriber",
  },
];

// Filter by --web / --api / --worker flags; default to all.
const explicitKeys = ALL_IMAGES.map((i) => i.key).filter((k) => argv.has(`--${k}`));
const images = explicitKeys.length > 0
  ? ALL_IMAGES.filter((i) => explicitKeys.includes(i.key))
  : ALL_IMAGES;

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

  for (const { tag, dockerfile, label } of images) {
    console.log(`\n--- Building + pushing ${label} (${tag}) for ${PLATFORMS} ---`);
    run("docker", [
      "buildx", "build",
      "--platform", PLATFORMS,
      "-f", dockerfile,
      "-t", tag,
      "--push",
      ".",
    ]);
  }
  console.log("\nMulti-platform build + push done.");
  console.log(`Images are available on Docker Hub for both linux/amd64 and linux/arm64.`);
}
