import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLiveKitFirewallHint,
  getLiveKitComposeProfiles,
  renderEgressConfig,
  renderManagedCaddyfile,
  resolveLiveKitConfig,
} from "../lib/livekit-config.mjs";

const installerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(installerDir, "../..");
const deterministicRandom = (size) => Buffer.alloc(size, 0xab);

async function read(relativePath) {
  return fs.readFile(path.join(installerDir, relativePath), "utf8");
}

describe("LiveKit installer contract", () => {
  it("defaults production to embedded and derives URLs and secrets", () => {
    const config = resolveLiveKitConfig({
      deployment: "external",
      isLinux: true,
      randomBytes: deterministicRandom,
      values: { domain: "rtc.example.com" },
    });

    assert.equal(config.mode, "embedded");
    assert.equal(config.tlsMode, "managed");
    assert.equal(config.publicUrl, "wss://rtc.example.com");
    assert.equal(config.internalUrl, "http://host.docker.internal:7880");
    assert.match(config.apiKey, /^API[0-9a-f]{24}$/);
    assert.ok(config.apiSecret.length >= 40);
    assert.deepEqual(getLiveKitComposeProfiles(config), ["livekit", "livekit-tls"]);
  });

  it("allows embedded localhost development without a domain", () => {
    const config = resolveLiveKitConfig({
      deployment: "local",
      isLinux: false,
      randomBytes: deterministicRandom,
      values: {},
    });
    assert.equal(config.publicUrl, "ws://localhost:7880");
    assert.equal(config.internalUrl, "http://livekit:7880");
    assert.equal(config.managedTls, false);
  });

  it("replaces the incompatible Compose hostname on Linux", () => {
    const config = resolveLiveKitConfig({
      deployment: "external",
      isLinux: true,
      randomBytes: deterministicRandom,
      values: {
        domain: "rtc.example.com",
        internalUrl: "http://livekit:7880",
      },
    });
    assert.equal(config.internalUrl, "http://host.docker.internal:7880");
  });

  it("preserves explicitly configured URLs and credentials", () => {
    const config = resolveLiveKitConfig({
      deployment: "external",
      isLinux: true,
      randomBytes: () => { throw new Error("must not generate"); },
      values: {
        mode: "embedded",
        domain: "rtc.example.com",
        tlsMode: "external",
        publicUrl: "wss://rtc.example.com",
        internalUrl: "http://host.docker.internal:7880",
        apiKey: "existing-key",
        apiSecret: "existing-secret",
      },
    });
    assert.equal(config.apiKey, "existing-key");
    assert.equal(config.apiSecret, "existing-secret");
    assert.equal(config.tlsMode, "external");
    assert.deepEqual(getLiveKitComposeProfiles(config), ["livekit"]);
  });

  it("rejects unattended production embedded configuration without a domain", () => {
    assert.throws(
      () => resolveLiveKitConfig({ deployment: "external", isLinux: true, values: {} }),
      /requires LIVEKIT_DOMAIN in \.env\.external/,
    );
  });

  it("requires external TLS when the LiveKit server itself is external", () => {
    assert.throws(
      () => resolveLiveKitConfig({
        deployment: "external",
        isLinux: true,
        values: {
          mode: "external",
          publicUrl: "wss://rtc.vendor.example",
          internalUrl: "https://rtc.vendor.example",
          apiKey: "vendor-key",
          apiSecret: "vendor-secret",
        },
      }),
      /requires LIVEKIT_TLS_MODE=external/,
    );
  });

  it("declares LiveKit, private Redis, and managed Caddy profiles", async () => {
    const compose = await read("docker-compose.yml");
    assert.match(compose, /livekit-redis:/);
    assert.match(compose, /livekit\/livekit-server:v1\.12\.0/);
    assert.match(compose, /livekit-caddy:/);
    assert.match(compose, /profiles: \["livekit-tls"\]/);
    assert.match(compose, /LIVEKIT_RTC_TCP_PORT:-7881.*7881\/tcp/);
    assert.match(compose, /LIVEKIT_RTC_UDP_PORT:-7882.*7882\/udp/);
    assert.doesNotMatch(compose, /127\.0\.0\.1:6380:6379/);
    assert.doesNotMatch(compose, /LIVEKIT_API_SECRET/);
  });

  it("uses host networking on Linux without incompatible ports", async () => {
    const linux = await read("docker-compose.linux.yml");
    assert.match(linux, /livekit:\s+network_mode: host\s+ports: !reset \[\]/s);
    assert.match(linux, /livekit-caddy:\s+network_mode: host\s+ports: !reset \[\]/s);
    assert.match(linux, /livekit-redis:\s+network_mode: host/s);
    assert.match(linux, /--bind", "127\.0\.0\.1"/);
    assert.match(linux, /runly-api-external:[\s\S]*host\.docker\.internal:host-gateway/);
    // egress must also be host-networked on Linux — livekit/livekit-redis are
    // host-networked above, so their Compose service names ("livekit",
    // "livekit-redis") don't resolve from a container still on the bridge
    // network. Regression coverage for the 2026-09-22 recording outage.
    assert.match(linux, /egress:\s+network_mode: host/s);
  });

  it("keeps egress opt-in via a separate Compose profile with its own docker.sock trust boundary note", async () => {
    const compose = await read("docker-compose.yml");
    assert.match(compose, /egress:[\s\S]*?profiles: \["livekit-egress"\]/);
    assert.match(compose, /docker\.sock/);
  });

  it("grants egress SYS_ADMIN and writes its config world-readable (regression: 2026-09-22 recording outage)", async () => {
    // Confirmed against the live outage log: without cap_add SYS_ADMIN, every
    // egress request fails with "chrome failed to start" (LiveKit's own
    // self-hosting docs say this is required for ALL deployments, including
    // local ones). And because livekit/egress runs its process as a non-root
    // user — unlike livekit-server, which runs as root — a 0600 root-owned
    // egress.yaml bind mount reads back as EACCES inside the container: this
    // is exactly what "open /etc/egress/egress.yaml: permission denied" in a
    // crash-restart loop turned out to be, which meant no egress worker ever
    // registered and every StartRoomCompositeEgress call just timed out.
    const compose = await read("docker-compose.yml");
    assert.match(compose, /egress:[\s\S]*?cap_add:\s*\n\s*-\s*SYS_ADMIN/);

    for (const file of ["setup-local.mjs", "setup-external.mjs"]) {
      const setup = await read(file);
      const egressWrite = setup.match(/renderEgressConfig\(\{[\s\S]*?\}\),\s*\n([\s\S]*?)\);/);
      assert.ok(egressWrite, `${file}: could not locate the egress.yaml writeFile call`);
      assert.match(egressWrite[1], /mode:\s*0o644/, `${file}: egress.yaml must be written 0644, not 0600 like livekit.yaml`);
      assert.match(setup, /fs\.chmod\(liveKitEgressConfigFile,\s*0o644\)/, `${file}: egress.yaml chmod must also be 0644`);
    }
  });

  it("wires storage-api's S3 protocol credentials for self-hosted recording uploads", async () => {
    // Self-hosted Supabase Storage has no Studio UI to generate these (that
    // flow only exists on Supabase Cloud) — the installer must generate and
    // wire S3_PROTOCOL_ACCESS_KEY_ID/SECRET itself, the same as every other
    // secret in resolveSupabaseSecrets, or SUPABASE_S3_* in .env.local has
    // nothing valid to point at.
    const supabaseCompose = await read("supabase/docker-compose.supabase.yml");
    assert.match(supabaseCompose, /S3_PROTOCOL_ACCESS_KEY_ID:\s*\$\{S3_PROTOCOL_ACCESS_KEY_ID\}/);
    assert.match(supabaseCompose, /S3_PROTOCOL_ACCESS_KEY_SECRET:\s*\$\{S3_PROTOCOL_ACCESS_KEY_SECRET\}/);
    assert.doesNotMatch(supabaseCompose, /REGION:\s*stub/);

    const setupLocal = await read("setup-local.mjs");
    assert.match(setupLocal, /S3_PROTOCOL_ACCESS_KEY_ID=\$\{supabase\.secrets\.S3_PROTOCOL_ACCESS_KEY_ID\}/);
    assert.match(setupLocal, /S3_PROTOCOL_ACCESS_KEY_SECRET=\$\{supabase\.secrets\.S3_PROTOCOL_ACCESS_KEY_SECRET\}/);
    // The public gateway (Kong) already routes /storage/v1/, S3 protocol
    // included — SUPABASE_S3_ENDPOINT must default through it, never
    // straight to the storage-api container or to Studio (which Kong does
    // not expose at all — see kong.yml's route table).
    assert.match(setupLocal, /\$\{browserSupabaseUrl\}\/storage\/v1\/s3/);

    const kong = await read("supabase/volumes/api/kong.yml");
    assert.match(kong, /paths:\s*\n\s*-\s*\/storage\/v1\//);
  });

  it("never lets a stale SUPABASE_S3_* survive an update in selfhosted mode", async () => {
    // Regression (2026-09-22): a .env.local written before this pairing
    // existed had SUPABASE_S3_REGION=us-east-1 (an old unrelated default)
    // while storage-api's own REGION was "local" — SigV4 signing disagreed
    // and every recording 500'd with no useful client-side error. The fix is
    // that in selfhosted mode these four are ALWAYS recomputed from
    // supabase.secrets/browserSupabaseUrl, never gated behind
    // `fromLocalEnv(...) ||`, so an old value self-heals on the next update
    // instead of silently winning. External mode keeps the fromLocalEnv
    // fallback since Runly doesn't own that Supabase's storage-api config.
    const setupLocal = await read("setup-local.mjs");
    const selfhostedBranch = /supabase\.mode === "selfhosted"\s*\?\s*([^:]+):\s*\(?fromLocalEnv\("SUPABASE_S3_(?:ENDPOINT|ACCESS_KEY_ID|SECRET_ACCESS_KEY|REGION)"\)/g;
    const matches = [...setupLocal.matchAll(selfhostedBranch)];
    assert.equal(matches.length, 4, "expected all 4 SUPABASE_S3_* vars to branch on supabase.mode");
    for (const [, selfhostedValue] of matches) {
      assert.doesNotMatch(
        selfhostedValue,
        /fromLocalEnv/,
        `selfhosted branch must not fall back to a possibly-stale fromLocalEnv value: ${selfhostedValue}`,
      );
    }
  });

  it("renders literal (non-interpolated) credentials and host-appropriate addresses for egress", () => {
    const linux = renderEgressConfig({
      apiKey: "APIabc123",
      apiSecret: "s3cr3t",
      isLinux: true,
      httpPort: "7880",
      redisPort: "6380",
    });
    assert.match(linux, /api_key: "APIabc123"/);
    assert.match(linux, /api_secret: "s3cr3t"/);
    assert.match(linux, /ws_url: ws:\/\/127\.0\.0\.1:7880/);
    assert.match(linux, /address: 127\.0\.0\.1:6380/);
    assert.doesNotMatch(linux, /\$\{LIVEKIT_API_KEY\}/);
    assert.doesNotMatch(linux, /livekit-redis:/);
    assert.doesNotMatch(linux, /ws:\/\/livekit:/);

    const bridged = renderEgressConfig({ apiKey: "APIabc123", apiSecret: "s3cr3t", isLinux: false });
    assert.match(bridged, /ws_url: ws:\/\/livekit:7880/);
    assert.match(bridged, /address: livekit-redis:6379/);
  });

  it("adds the livekit-egress profile only when recording is enabled", () => {
    const config = resolveLiveKitConfig({
      deployment: "external",
      isLinux: true,
      randomBytes: deterministicRandom,
      values: { domain: "rtc.example.com" },
    });
    assert.deepEqual(getLiveKitComposeProfiles(config), ["livekit", "livekit-tls"]);
    assert.deepEqual(
      getLiveKitComposeProfiles(config, { recordingEnabled: true }),
      ["livekit", "livekit-tls", "livekit-egress"],
    );
  });

  it("documents all variables and enables embedded by default", async () => {
    for (const file of [".env.local.example", ".env.external.example"]) {
      const env = await read(file);
      for (const key of [
        "LIVEKIT_MODE",
        "LIVEKIT_DOMAIN",
        "LIVEKIT_TLS_MODE",
        "LIVEKIT_URL",
        "LIVEKIT_INTERNAL_URL",
        "LIVEKIT_API_KEY",
        "LIVEKIT_API_SECRET",
      ]) {
        assert.match(env, new RegExp(`^${key}=`, "m"), `${key} missing from ${file}`);
      }
      assert.match(env, /^LIVEKIT_MODE=embedded$/m);
      assert.match(env, /^LIVEKIT_TLS_MODE=managed$/m);
    }
  });

  it("starts TLS profiles, validates runtime, and runs room smoke test", async () => {
    for (const file of ["setup-local.mjs", "setup-external.mjs"]) {
      const setup = await read(file);
      assert.match(setup, /getLiveKitComposeProfiles/);
      assert.match(setup, /validateLiveKitRuntime/);
      assert.match(setup, /livekit-smoke\.js/);
      assert.match(setup, /LIVEKIT_CADDY_IMAGE/);
      assert.match(setup, /removeInactiveLiveKitServices/);
      assert.match(setup, /fs\.chmod\(liveKitConfigFile, 0o600\)/);
      assert.match(setup, /will not modify/);
      assert.doesNotMatch(setup, /renderExternalProxyGuide/);
      // Recording opts in via the S3 vars themselves, mirroring the
      // ".env comment says 'leave empty to disable'" contract — no separate
      // flag to forget, no manual `docker compose --profile` step required.
      assert.match(setup, /recordingEnabled/);
      assert.match(setup, /renderEgressConfig/);
      // Regression: a prior manual `docker compose --profile livekit-egress
      // up` (before this repo knew how to render egress.yaml) makes Docker
      // auto-create an empty DIRECTORY at the bind-mount source path when
      // the file doesn't exist yet. Every rm of liveKitEgressConfigFile must
      // pass recursive: true or it dies with EISDIR on exactly that VPS.
      const egressRmCalls = [...setup.matchAll(/rm\(liveKitEgressConfigFile,\s*\{([^}]*)\}/g)];
      assert.ok(egressRmCalls.length > 0, `${file}: expected at least one liveKitEgressConfigFile rm() call`);
      for (const [, opts] of egressRmCalls) {
        assert.match(opts, /recursive:\s*true/, `${file}: liveKitEgressConfigFile rm() missing recursive: true`);
      }
    }
    for (const file of ["stop-local.mjs", "stop-external.mjs"]) {
      const stop = await read(file);
      assert.match(stop, /"--profile", "livekit-tls"/);
      assert.match(stop, /"--profile", "livekit-egress"/);
      assert.match(stop, /reverse-proxy\.nginx\.conf/);
    }

    const smoke = await fs.readFile(
      path.join(repoRoot, "apps/api/src/scripts/livekit-smoke.js"),
      "utf8",
    );
    assert.match(smoke, /createRoom/);
    assert.match(smoke, /deleteRoom/);
  });

  it("bootstraps the shared configuration library", async () => {
    for (const file of [
      "bootstrap-local.sh",
      "bootstrap-local.ps1",
      "bootstrap-external.sh",
      "bootstrap-external.ps1",
    ]) {
      assert.match(await read(file), /livekit-config\.mjs/);
    }
  });

  it("renders managed TLS against the correct platform upstream", () => {
    assert.match(
      renderManagedCaddyfile({ domain: "rtc.example.com", isLinux: true }),
      /reverse_proxy 127\.0\.0\.1:7880/,
    );
    assert.match(
      renderManagedCaddyfile({ domain: "rtc.example.com", isLinux: false }),
      /reverse_proxy livekit:7880/,
    );
  });
});

describe("LiveKit firewall hint", () => {
  function fakeRunCommand({ ufwActive = true, networkName = "runly_default", subnet = "192.0.2.0/24", gateway = "192.0.2.1" } = {}) {
    return (command, args) => {
      if (command === "ufw" && args[0] === "status") {
        return { ok: true, output: ufwActive ? "Status: active" : "Status: inactive" };
      }
      if (command === "docker" && args[0] === "inspect") {
        return { ok: true, output: `${networkName} ` };
      }
      if (command === "docker" && args[0] === "network" && args[2] === "bridge") {
        return { ok: true, output: gateway };
      }
      if (command === "docker" && args[0] === "network") {
        return { ok: true, output: subnet };
      }
      return { ok: false, output: "" };
    };
  }

  it("suggests the exact ufw rule when ufw is active and the smoke test timed out", () => {
    const hint = buildLiveKitFirewallHint({
      isLinux: true,
      mode: "embedded",
      smokeOutput: "TimeoutError: The operation was aborted due to timeout",
      apiContainer: "runly-abc-api-local",
      internalUrl: "http://host.docker.internal:7880",
      runCommand: fakeRunCommand(),
    });

    assert.match(hint, /sudo ufw allow proto tcp from 192\.0\.2\.0\/24 to 192\.0\.2\.1 port 7880/);
  });

  it("returns null when ufw is not active", () => {
    const hint = buildLiveKitFirewallHint({
      isLinux: true,
      mode: "embedded",
      smokeOutput: "TimeoutError",
      apiContainer: "runly-abc-api-local",
      internalUrl: "http://host.docker.internal:7880",
      runCommand: fakeRunCommand({ ufwActive: false }),
    });

    assert.equal(hint, null);
  });

  it("returns null on non-Linux or non-embedded installs", () => {
    assert.equal(
      buildLiveKitFirewallHint({
        isLinux: false,
        mode: "embedded",
        smokeOutput: "TimeoutError",
        apiContainer: "runly-abc-api-local",
        internalUrl: "http://host.docker.internal:7880",
        runCommand: fakeRunCommand(),
      }),
      null,
    );
    assert.equal(
      buildLiveKitFirewallHint({
        isLinux: true,
        mode: "external",
        smokeOutput: "TimeoutError",
        apiContainer: "runly-abc-api-local",
        internalUrl: "http://host.docker.internal:7880",
        runCommand: fakeRunCommand(),
      }),
      null,
    );
  });

  it("returns null when the failure is unrelated to connectivity", () => {
    const hint = buildLiveKitFirewallHint({
      isLinux: true,
      mode: "embedded",
      smokeOutput: "LIVEKIT_API_KEY is required.",
      apiContainer: "runly-abc-api-local",
      internalUrl: "http://host.docker.internal:7880",
      runCommand: fakeRunCommand(),
    });

    assert.equal(hint, null);
  });
});
