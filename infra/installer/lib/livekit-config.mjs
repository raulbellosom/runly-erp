import crypto from "node:crypto";

export const LIVEKIT_MODES = ["embedded", "external", "disabled"];
export const LIVEKIT_TLS_MODES = ["managed", "external"];

function clean(value) {
  return String(value ?? "").trim();
}

export function normalizeLiveKitDomain(value) {
  const domain = clean(value).replace(/\.$/, "").toLowerCase();
  if (!domain) return "";
  if (domain.includes("://") || domain.includes("/") || domain.includes(":")) {
    throw new Error(
      "LIVEKIT_DOMAIN must contain only a hostname, for example rtc.example.com.",
    );
  }
  if (
    domain.length > 253
    || !domain.split(".").every((label) => (
      label.length >= 1
      && label.length <= 63
      && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    ))
  ) {
    throw new Error(`LIVEKIT_DOMAIN is not a valid hostname: ${domain}`);
  }
  return domain;
}

export function toLiveKitHttpUrl(websocketUrl) {
  const url = new URL(websocketUrl);
  if (url.protocol === "wss:") url.protocol = "https:";
  else if (url.protocol === "ws:") url.protocol = "http:";
  else throw new Error("LIVEKIT_URL must start with ws:// or wss://.");
  return url.toString().replace(/\/$/, "");
}

export function resolveLiveKitConfig({
  deployment,
  isLinux,
  values = {},
  randomBytes = crypto.randomBytes,
}) {
  if (!["local", "external"].includes(deployment)) {
    throw new Error("deployment must be local or external.");
  }

  const mode = clean(values.mode || "embedded").toLowerCase();
  const tlsMode = clean(values.tlsMode || "managed").toLowerCase();
  if (!LIVEKIT_MODES.includes(mode)) {
    throw new Error("LIVEKIT_MODE must be embedded, external, or disabled.");
  }
  if (!LIVEKIT_TLS_MODES.includes(tlsMode)) {
    throw new Error("LIVEKIT_TLS_MODE must be managed or external.");
  }

  const domain = normalizeLiveKitDomain(values.domain);
  let publicUrl = clean(values.publicUrl);
  let internalUrl = clean(values.internalUrl);
  let apiKey = clean(values.apiKey);
  let apiSecret = clean(values.apiSecret);

  if (mode === "disabled") {
    return {
      mode,
      domain,
      tlsMode,
      publicUrl,
      internalUrl,
      apiKey,
      apiSecret,
      managedTls: false,
    };
  }

  if (!publicUrl && domain) publicUrl = `wss://${domain}`;

  if (mode === "embedded") {
    if (deployment === "external" && !domain) {
      const error = new Error(
        "LIVEKIT_MODE=embedded requires LIVEKIT_DOMAIN in .env.external "
        + "(for example LIVEKIT_DOMAIN=rtc.example.com).",
      );
      error.code = "LIVEKIT_DOMAIN_REQUIRED";
      throw error;
    }
    if (!publicUrl && deployment === "local") publicUrl = "ws://localhost:7880";
    if (isLinux && /^http:\/\/livekit(?::7880)?\/?$/i.test(internalUrl)) {
      internalUrl = "http://host.docker.internal:7880";
    }
    if (!internalUrl) {
      internalUrl = isLinux
        ? "http://host.docker.internal:7880"
        : "http://livekit:7880";
    }
    apiKey ||= `API${randomBytes(12).toString("hex")}`;
    apiSecret ||= randomBytes(32).toString("base64url");
  } else {
    if (!internalUrl && publicUrl) internalUrl = toLiveKitHttpUrl(publicUrl);
  }

  if (!publicUrl || !internalUrl || !apiKey || !apiSecret) {
    throw new Error(
      `LIVEKIT_MODE=${mode} requires LIVEKIT_URL, LIVEKIT_INTERNAL_URL, `
      + "LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.",
    );
  }
  if (!/^wss?:\/\//i.test(publicUrl)) {
    throw new Error("LIVEKIT_URL must start with ws:// or wss://.");
  }
  if (!/^https?:\/\//i.test(internalUrl)) {
    throw new Error("LIVEKIT_INTERNAL_URL must start with http:// or https://.");
  }
  if (mode === "embedded" && isLinux && new URL(internalUrl).hostname === "livekit") {
    throw new Error(
      "Linux embedded LiveKit cannot use the Compose hostname in LIVEKIT_INTERNAL_URL; "
      + "use http://host.docker.internal:7880.",
    );
  }
  if (deployment === "external" && !/^wss:\/\//i.test(publicUrl)) {
    throw new Error("Production LiveKit requires LIVEKIT_URL to start with wss://.");
  }
  const publicHostname = new URL(publicUrl).hostname.toLowerCase();
  if (mode === "embedded" && domain && publicHostname !== domain) {
    throw new Error("LIVEKIT_URL hostname must match LIVEKIT_DOMAIN in embedded mode.");
  }
  if (mode === "external" && tlsMode === "managed") {
    throw new Error(
      "LIVEKIT_MODE=external requires LIVEKIT_TLS_MODE=external because Atlas does not manage the remote proxy.",
    );
  }

  return {
    mode,
    domain,
    tlsMode,
    publicUrl,
    internalUrl,
    apiKey,
    apiSecret,
    managedTls: mode === "embedded" && tlsMode === "managed" && Boolean(domain),
  };
}

// httpPort/rtcTcpPort/rtcUdpPort/redisPort only take effect on Linux, where
// network_mode: host means these config values ARE the host-bound ports
// (Compose's own port mapping is unused there). On Docker Desktop (bridge
// networking) the container-internal ports must stay fixed at their
// defaults — only the host-side mapping in docker-compose.yml varies, via
// RUNLY_*_HOST_PORT / LIVEKIT_*_PORT env vars.
export function renderLiveKitConfig({
  apiKey, apiSecret, isLinux,
  httpPort, rtcTcpPort, rtcUdpPort, redisPort,
}) {
  const port = isLinux ? (Number(httpPort) || 7880) : 7880;
  const tcpPort = isLinux ? (Number(rtcTcpPort) || 7881) : 7881;
  const udpPort = isLinux ? (Number(rtcUdpPort) || 7882) : 7882;
  const resolvedRedisPort = isLinux ? (Number(redisPort) || 6380) : 6379;
  const redisAddress = isLinux ? `127.0.0.1:${resolvedRedisPort}` : `livekit-redis:${resolvedRedisPort}`;
  return [
    `port: ${port}`,
    "log_level: info",
    "",
    "rtc:",
    `  tcp_port: ${tcpPort}`,
    `  udp_port: ${udpPort}`,
    "  use_external_ip: true",
    "  enable_loopback_candidate: true",
    "",
    "redis:",
    `  address: ${redisAddress}`,
    "",
    "room:",
    "  empty_timeout: 60",
    "  departure_timeout: 20",
    "",
    "keys:",
    `  ${JSON.stringify(apiKey)}: ${JSON.stringify(apiSecret)}`,
    "",
  ].join("\n");
}

export function renderManagedCaddyfile({ domain, isLinux }) {
  const upstream = isLinux ? "127.0.0.1:7880" : "livekit:7880";
  return [
    "{",
    "  admin off",
    "}",
    "",
    `${domain} {`,
    `  reverse_proxy ${upstream}`,
    "}",
    "",
  ].join("\n");
}

// Egress is a separate process from livekit-server and reads its own static
// YAML (bind-mounted, not run through Compose's ${VAR} substitution), so
// api_key/api_secret must be baked in literally here — same reason
// renderLiveKitConfig writes literal `keys:` values instead of a placeholder.
// ws_url/redis must resolve the same way renderLiveKitConfig's redis address
// does: on Linux, livekit/livekit-redis run with network_mode: host (see
// docker-compose.linux.yml), so Compose service-name DNS ("livekit",
// "livekit-redis") does not resolve from another container — everything
// must instead go over 127.0.0.1 on the shared host network, which is why
// the egress service also gets network_mode: host on Linux.
export function renderEgressConfig({ apiKey, apiSecret, isLinux, httpPort, redisPort }) {
  const port = isLinux ? (Number(httpPort) || 7880) : 7880;
  const resolvedRedisPort = isLinux ? (Number(redisPort) || 6380) : 6379;
  const redisAddress = isLinux ? `127.0.0.1:${resolvedRedisPort}` : `livekit-redis:${resolvedRedisPort}`;
  const wsUrl = isLinux ? `ws://127.0.0.1:${port}` : "ws://livekit:7880";
  return [
    "log_level: info",
    `api_key: ${JSON.stringify(apiKey)}`,
    `api_secret: ${JSON.stringify(apiSecret)}`,
    `ws_url: ${wsUrl}`,
    "redis:",
    `  address: ${redisAddress}`,
    "",
  ].join("\n");
}

export function getLiveKitComposeProfiles(config, { recordingEnabled = false } = {}) {
  if (config.mode !== "embedded") return [];
  const profiles = config.managedTls ? ["livekit", "livekit-tls"] : ["livekit"];
  if (recordingEnabled) profiles.push("livekit-egress");
  return profiles;
}

// Only applies to Linux embedded installs, where LiveKit runs with
// network_mode: host and the API container reaches it through
// host.docker.internal -> host-gateway. On a VPS with ufw enabled, traffic
// from the Compose network to that gateway IP is commonly dropped, which
// surfaces as a connect timeout in the smoke test. This never runs `ufw`
// itself (that would need root and assumes ufw over firewalld/nftables/none);
// it only inspects Docker networking to print the exact rule an admin can
// copy-paste, mirroring the manual fix in docs/DEPLOY_VPS_DEV.md.
export function buildLiveKitFirewallHint({
  isLinux, mode, smokeOutput, apiContainer, internalUrl, runCommand,
}) {
  if (!isLinux || mode !== "embedded") return null;
  if (!/timeout|econnrefused|etimedout|fetch failed/i.test(smokeOutput || "")) return null;

  const ufwStatus = runCommand("ufw", ["status"]);
  if (!ufwStatus.ok || !/status:\s*active/i.test(ufwStatus.output)) return null;

  let port = "7880";
  try { port = new URL(internalUrl).port || "7880"; } catch { /* keep default */ }

  const networkResult = runCommand("docker", [
    "inspect", apiContainer, "--format", "{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}",
  ]);
  const networkName = networkResult.ok ? networkResult.output.trim().split(/\s+/)[0] : "";

  const subnetResult = networkName
    ? runCommand("docker", ["network", "inspect", networkName, "--format", "{{(index .IPAM.Config 0).Subnet}}"])
    : { ok: false, output: "" };
  const subnet = subnetResult.ok ? subnetResult.output.trim() : "";

  const gatewayResult = runCommand("docker", [
    "network", "inspect", "bridge", "--format", "{{(index .IPAM.Config 0).Gateway}}",
  ]);
  const gateway = gatewayResult.ok ? gatewayResult.output.trim() : "";

  if (!subnet || !gateway) {
    return (
      "LiveKit internal connectivity looks blocked by ufw, but Runly could not detect the exact "
      + `Docker subnet/gateway to suggest a rule (inspect '${apiContainer}' and the 'bridge' network `
      + `manually). Try something like: sudo ufw allow proto tcp from <api-network-subnet> to `
      + `<docker-bridge-gateway> port ${port} comment 'Runly API to LiveKit', then re-run this step.`
    );
  }

  return (
    "LiveKit internal connectivity looks blocked by ufw. On the VPS, run:\n"
    + `  sudo ufw allow proto tcp from ${subnet} to ${gateway} port ${port} comment 'Runly API to LiveKit'\n`
    + "then re-run this installer step."
  );
}
