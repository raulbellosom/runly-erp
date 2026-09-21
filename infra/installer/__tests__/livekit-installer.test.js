import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildLiveKitFirewallHint,
  getLiveKitComposeProfiles,
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
    }
    for (const file of ["stop-local.mjs", "stop-external.mjs"]) {
      const stop = await read(file);
      assert.match(stop, /"--profile", "livekit-tls"/);
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
