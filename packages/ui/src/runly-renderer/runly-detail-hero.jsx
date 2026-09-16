// Hero glue for RunlyDetail's opt-in presentation layer: resolves the hero image
// signed URL client-side and composes DetailHero + StatStrip. Kept out of
// RunlyDetail.jsx to keep that file under the repo file-size budget.
import { useEffect, useState } from "react";
import { Badge } from "../components/Badge.jsx";
import { Card } from "../components/Card.jsx";
import { DetailHero } from "../components/DetailHero.jsx";
import { StatStrip } from "../components/StatStrip.jsx";
import { replacePathTokens } from "./detail-presentation.js";
import { buildApiHeaders } from "../lib/apiHeaders.js";

function joinUrl(baseUrl, apiPath) {
  const base = String(baseUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  const path = String(apiPath ?? "").trim();
  if (!path) return base;
  if (!path.startsWith("/")) return `${base}/${path}`;
  return `${base}${path}`;
}

function parseJsonSafe(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractArrayPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && typeof payload.data === "object") {
    return extractArrayPayload(payload.data);
  }
  return [];
}

export async function fetchSignedUrl(apiBaseUrl, token, fileAssetId, companyId = null) {
  if (!fileAssetId) return null;
  try {
    const res = await fetch(
      joinUrl(apiBaseUrl, `/files/${encodeURIComponent(fileAssetId)}/signed-url`),
      { headers: buildApiHeaders(token, companyId) },
    );
    if (!res.ok) return null;
    const payload = parseJsonSafe(await res.text());
    return payload?.data?.signedUrl ?? payload?.data?.url ?? null;
  } catch {
    return null;
  }
}

// A user account's avatar is not a company-scoped file entity (see
// files-service.js's ALLOWED_FILE_ENTITY_TYPES), so it can't be resolved
// through fetchSignedUrl even when you know its FileAsset id — it needs
// this dedicated, permission-gated-by-user-id route instead.
export async function fetchUserAvatarSignedUrl(apiBaseUrl, token, userId, companyId = null) {
  if (!userId) return null;
  try {
    const res = await fetch(
      joinUrl(apiBaseUrl, `/identity/users/${encodeURIComponent(userId)}/avatar/signed-url`),
      { headers: buildApiHeaders(token, companyId) },
    );
    if (!res.ok) return null;
    const payload = parseJsonSafe(await res.text());
    return payload?.data?.signedUrl ?? null;
  } catch {
    return null;
  }
}

async function fetchFirstImageAssetId(apiBaseUrl, token, docsPath, recordId, companyId = null) {
  if (!docsPath || !recordId) return null;
  try {
    const path = replacePathTokens(docsPath, { id: recordId });
    const res = await fetch(joinUrl(apiBaseUrl, path), {
      headers: buildApiHeaders(token, companyId),
    });
    if (!res.ok) return null;
    const rows = extractArrayPayload(parseJsonSafe(await res.text()));
    const images = rows.filter((row) =>
      String(row?.fileAsset?.mimeType ?? row?.file_asset?.mimeType ?? row?.mimeType ?? "")
        .toLowerCase()
        .startsWith("image/"),
    );
    // Prefer the attachment explicitly marked as cover (AttachmentsPanel's
    // star action); fall back to the first image if none is marked yet.
    const image = images.find((row) => row?.isCover === true || row?.is_cover === true) ?? images[0];
    return image?.fileAssetId ?? image?.file_asset_id ?? null;
  } catch {
    return null;
  }
}

export function initialsFromName(name) {
  const full = String(name ?? "").trim();
  if (!full) return "--";
  const words = full.split(/\s+/).filter(Boolean);
  const a = words[0]?.charAt(0) ?? "";
  const b = words.length > 1 ? (words[1]?.charAt(0) ?? "") : "";
  return `${a}${b}`.toUpperCase() || "--";
}

function HeroStatus({ heroModel, data, renderValue }) {
  const { statusValue, statusMap } = heroModel;
  if (statusValue === null || statusValue === undefined || statusValue === "") {
    return null;
  }
  if (statusMap) {
    const key = String(statusValue);
    const label = statusMap[key] ?? key;
    const positive = key === "true" || key === "active";
    return <Badge variant={positive ? "success" : "destructive"}>{label}</Badge>;
  }
  return renderValue({ type: "text" }, statusValue, data);
}

// `renderValue` is injected by RunlyDetail so the two files share one formatter.
export function HeroContainer({
  heroModel,
  kpiItems,
  data,
  apiBaseUrl,
  token,
  companyId = null,
  actions,
  renderValue,
}) {
  const [imageUrl, setImageUrl] = useState(null);
  const [imageLoading, setImageLoading] = useState(
    Boolean(heroModel.imageAssetId || heroModel.imageDocsPath),
  );

  useEffect(() => {
    let cancelled = false;
    async function load() {
      let assetId = heroModel.imageAssetId;
      if (!assetId && heroModel.imageDocsPath) {
        assetId = await fetchFirstImageAssetId(
          apiBaseUrl,
          token,
          heroModel.imageDocsPath,
          data?.id,
          companyId,
        );
      }
      if (!assetId) {
        if (heroModel.avatarUserId) {
          const avatarUrl = await fetchUserAvatarSignedUrl(
            apiBaseUrl,
            token,
            heroModel.avatarUserId,
            companyId,
          );
          if (!cancelled) {
            setImageUrl(avatarUrl);
            setImageLoading(false);
          }
          return;
        }
        if (!cancelled) {
          setImageUrl(null);
          setImageLoading(false);
        }
        return;
      }
      const url = await fetchSignedUrl(apiBaseUrl, token, assetId, companyId);
      if (!cancelled) {
        setImageUrl(url);
        setImageLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [
    apiBaseUrl,
    token,
    companyId,
    heroModel.imageAssetId,
    heroModel.imageDocsPath,
    heroModel.avatarUserId,
    data?.id,
  ]);

  const kpiRenderItems = kpiItems.map((item) => ({
    key: item.key,
    label: item.label,
    icon: item.icon,
    href: item.href,
    value: renderValue({ type: item.type }, item.rawValue, data),
  }));

  return (
    <Card
      variant="shell"
      className="overflow-hidden"
      style={
        heroModel.accentHex
          ? {
              backgroundImage: `radial-gradient(circle at 15% 20%, color-mix(in srgb, ${heroModel.accentHex} 12%, transparent), transparent 60%)`,
            }
          : undefined
      }
    >
      <DetailHero
        bare
        title={heroModel.title}
        subtitle={heroModel.subtitle}
        statusNode={
          <HeroStatus heroModel={heroModel} data={data} renderValue={renderValue} />
        }
        imageUrl={imageUrl}
        imageLoading={imageLoading}
        fallbackIcon={heroModel.fallbackIcon}
        accentHex={heroModel.accentHex}
        chips={heroModel.chips}
        actions={actions}
      />
      {kpiRenderItems.length > 0 ? <StatStrip bare items={kpiRenderItems} /> : null}
    </Card>
  );
}
