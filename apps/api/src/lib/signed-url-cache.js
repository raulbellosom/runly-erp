// In-memory signed-URL cache, process-local. Supabase's createSignedUrls()
// mints a brand-new signature (and therefore a brand-new string) on every
// call even when nothing about the file changed. Callers that poll an
// endpoint embedding a signed URL (e.g. GET /memberships/me, refetched every
// 15s by ActiveCompanyProvider) were getting a new logoUrl on every poll,
// which defeats TanStack Query's structural sharing and forces a full
// re-render of every consumer of that query's data on each interval — see
// the "glassic flicker" bug report (cards flashing across nearly every
// screen, correlated with background request bursts). Caching the signed
// URL for most of its validity window keeps the string stable across polls.
const cache = new Map();
const REFRESH_MARGIN = 0.9; // reissue at 90% of the requested TTL, not 100%

export async function getCachedSignedUrls(supabaseAdmin, bucket, objectKeys, expiresIn = 3600) {
  const now = Date.now();
  const ttlMs = expiresIn * 1000 * REFRESH_MARGIN;
  const result = new Map();
  const toFetch = [];

  for (const objectKey of objectKeys) {
    const cacheKey = `${bucket}:${objectKey}`;
    const entry = cache.get(cacheKey);
    if (entry && entry.expiresAt > now) {
      result.set(objectKey, entry.url);
    } else {
      toFetch.push(objectKey);
    }
  }

  if (toFetch.length > 0) {
    const { data } = await supabaseAdmin.storage.from(bucket).createSignedUrls(toFetch, expiresIn);
    for (let i = 0; i < toFetch.length; i++) {
      const url = data?.[i]?.signedUrl ?? null;
      if (url) cache.set(`${bucket}:${toFetch[i]}`, { url, expiresAt: now + ttlMs });
      result.set(toFetch[i], url);
    }
  }

  return result;
}
