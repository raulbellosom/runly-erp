// apps/api/src/services/supabase-admin.js
//
// Shared factory for a service-role Supabase client. Lives here (not in the
// worker) so `apps/worker` can import it and have `@supabase/supabase-js`
// resolve against `apps/api/node_modules` — the worker package intentionally
// has a minimal dependency set.
import { createClient } from "@supabase/supabase-js";
import { wrapStorageForPublicUrls } from "../lib/supabase-public-url.js";

export function createSupabaseAdminClient(env = process.env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  return wrapStorageForPublicUrls(client, env);
}
