import { authorizeRealtimeClient } from './authorizedRealtime.js'
import { createClient } from '@supabase/supabase-js'
import { RUNLY_PUBLIC_DESKTOP_CONFIG_PATH } from './appConfig.js'
import { getApiUrl, runtimeConfig } from './runtimeConfig.js'
import { isNativeDesktop } from '@runly/core/native-runtime'

let currentSupabaseClient = null
let currentSupabaseKey = null

function getFallbackSupabaseConfig() {
  const url = runtimeConfig.SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL
  const anonKey =
    runtimeConfig.SUPABASE_ANON_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY

  if (!url || !anonKey) return null
  return { url, anonKey }
}

async function fetchSupabaseConfigFromServer(baseUrl = getApiUrl()) {
  const response = await fetch(`${baseUrl}${RUNLY_PUBLIC_DESKTOP_CONFIG_PATH}`)
  if (!response.ok) {
    throw new Error('SUPABASE_CONFIG_FETCH_FAILED')
  }

  const payload = await response.json().catch(() => null)
  const url = payload?.data?.supabaseUrl
  const anonKey = payload?.data?.supabaseAnonKey

  if (!url || !anonKey) {
    throw new Error('SUPABASE_CONFIG_MISSING')
  }

  return { url, anonKey }
}

export async function initSupabaseClient({
  baseUrl = getApiUrl(),
  forceReload = false,
  config = null,
} = {}) {
  const isTauriRuntime = isNativeDesktop()

  let resolvedConfig = config
  if (!resolvedConfig && isTauriRuntime) {
    resolvedConfig = await fetchSupabaseConfigFromServer(baseUrl)
  }
  if (!resolvedConfig) {
    resolvedConfig = getFallbackSupabaseConfig()
  }
  if (!resolvedConfig) {
    resolvedConfig = await fetchSupabaseConfigFromServer(baseUrl)
  }

  const nextKey = `${resolvedConfig.url}::${resolvedConfig.anonKey}`
  if (!forceReload && currentSupabaseClient && currentSupabaseKey === nextKey) {
    return authorizeRealtimeClient(currentSupabaseClient)
  }

  currentSupabaseClient = createClient(resolvedConfig.url, resolvedConfig.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  })
  currentSupabaseKey = nextKey
  return authorizeRealtimeClient(currentSupabaseClient)
}

export function getSupabaseClient() {
  if (!currentSupabaseClient) {
    const fallbackConfig = getFallbackSupabaseConfig()
    if (!fallbackConfig) {
      throw new Error(
        'Missing Supabase config. In dev: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env. In Docker: set SUPABASE_URL and SUPABASE_ANON_KEY env vars on the container.',
      )
    }

    currentSupabaseClient = createClient(fallbackConfig.url, fallbackConfig.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
    currentSupabaseKey = `${fallbackConfig.url}::${fallbackConfig.anonKey}`
  }

  return authorizeRealtimeClient(currentSupabaseClient)
}

export const supabase = new Proxy(
  {},
  {
    get(_target, prop) {
      return Reflect.get(getSupabaseClient(), prop)
    },
  },
)
