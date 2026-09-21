// apps/api/src/lib/supabase-public-url.js
//
// Self-hosted installs point the API/worker at SUPABASE_URL, the internal
// Docker hostname Kong is reached on inside the compose network (e.g.
// http://supabase-kong:8000). That address is correct for every server-to-
// server call (upload, download, remove, sign) but is never resolvable from
// the browser. RUNLY_SUPABASE_PUBLIC_URL is the HTTPS domain Nginx exposes
// for that same Kong instance (e.g. https://supabase.example.com) — anything
// handed to the browser (a signed/public storage URL, or the Supabase config
// used to build a browser-side supabase-js client) must use it instead.
//
// This module never touches SUPABASE_URL itself or how the API talks to
// Kong — it only rewrites the origin of values that are about to leave the
// server toward a browser.

// Base URL the browser should use to reach Supabase (Storage/Auth/Realtime).
// Falls back to the internal URL when no public URL is configured, which
// keeps local dev (no public domain) and "external" managed-Supabase
// deployments (where SUPABASE_URL is already publicly reachable) working
// unchanged.
export function resolvePublicSupabaseUrl(env = process.env) {
  const publicUrl = String(env.RUNLY_SUPABASE_PUBLIC_URL ?? "").trim();
  const internalUrl = String(env.SUPABASE_URL ?? "").trim();
  return (publicUrl || internalUrl).replace(/\/$/, "");
}

// Rewrites only the origin (protocol + host) of a Supabase Storage URL —
// the path, query string, signed token and any imgproxy transform params
// pass through untouched. Only rewrites a URL that actually points at the
// internal Supabase host, so it never mangles an unrelated URL that happens
// to flow through the same code path, and never does indiscriminate string
// replacement.
export function toPublicSupabaseUrl(url, env = process.env) {
  const internalUrl = String(env.SUPABASE_URL ?? "").trim();
  const publicUrl = String(env.RUNLY_SUPABASE_PUBLIC_URL ?? "").trim();
  if (!url || !publicUrl || !internalUrl || publicUrl === internalUrl) return url;

  let parsedInternal;
  let parsedPublic;
  let parsedUrl;
  try {
    parsedInternal = new URL(internalUrl);
    parsedPublic = new URL(publicUrl);
    parsedUrl = new URL(url);
  } catch {
    return url;
  }
  if (parsedUrl.host !== parsedInternal.host) return url;

  // Set hostname/port separately (not `.host`) — the WHATWG URL setter for
  // `.host` does not reliably clear a previously-set port when the new host
  // string carries none, which would leak the internal port (e.g. :8000)
  // onto the public origin.
  parsedUrl.protocol = parsedPublic.protocol;
  parsedUrl.hostname = parsedPublic.hostname;
  parsedUrl.port = parsedPublic.port;
  return parsedUrl.toString();
}

// Wraps a supabase-js client's Storage API so every signed/public URL it
// mints is transparently rewritten for the browser via toPublicSupabaseUrl.
// Upload/download/remove/list and every other storage operation are left
// untouched, so the client still talks to Kong over SUPABASE_URL internally.
//
// Centralizing this on the client instance — instead of patching every call
// site that mints a signed or public URL — is what makes the fix auditable:
// any route or service that reuses this same supabaseAdmin instance is
// covered automatically, including URLs read back out of the in-process
// signed-URL cache (lib/signed-url-cache.js), which stores whatever this
// wrapped client already returned.
export function wrapStorageForPublicUrls(client, env = process.env) {
  if (!client?.storage?.from) return client;
  const publicUrl = String(env.RUNLY_SUPABASE_PUBLIC_URL ?? "").trim();
  const internalUrl = String(env.SUPABASE_URL ?? "").trim();
  // No public domain configured (local dev, or "external" mode where
  // SUPABASE_URL is already browser-reachable) — nothing to rewrite.
  if (!publicUrl || !internalUrl || publicUrl === internalUrl) return client;

  const rewrite = (url) => toPublicSupabaseUrl(url, env);
  const originalFrom = client.storage.from.bind(client.storage);

  client.storage.from = (bucket) => {
    const bucketApi = originalFrom(bucket);

    if (typeof bucketApi.getPublicUrl === "function") {
      const originalGetPublicUrl = bucketApi.getPublicUrl.bind(bucketApi);
      bucketApi.getPublicUrl = (...args) => {
        const result = originalGetPublicUrl(...args);
        if (result?.data?.publicUrl) result.data.publicUrl = rewrite(result.data.publicUrl);
        return result;
      };
    }

    if (typeof bucketApi.createSignedUrl === "function") {
      const originalCreateSignedUrl = bucketApi.createSignedUrl.bind(bucketApi);
      bucketApi.createSignedUrl = async (...args) => {
        const result = await originalCreateSignedUrl(...args);
        if (result?.data?.signedUrl) result.data.signedUrl = rewrite(result.data.signedUrl);
        return result;
      };
    }

    if (typeof bucketApi.createSignedUrls === "function") {
      const originalCreateSignedUrls = bucketApi.createSignedUrls.bind(bucketApi);
      bucketApi.createSignedUrls = async (...args) => {
        const result = await originalCreateSignedUrls(...args);
        if (Array.isArray(result?.data)) {
          for (const entry of result.data) {
            if (entry?.signedUrl) entry.signedUrl = rewrite(entry.signedUrl);
          }
        }
        return result;
      };
    }

    return bucketApi;
  };

  return client;
}
