import { StorefrontError } from './storefront-error.js'

export function createAuthNamespace({ supabase, request, session }) {
  async function register({ email, password, name, role = 'storefront_client' }) {
    const res = await request('POST', '/public/storefront/auth/register', { email, password, name, role })
    return res?.data ?? res
  }

  async function login({ email, password }) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error || !data.session) {
      throw Object.assign(
        new StorefrontError('Credenciales incorrectas', 'UNAUTHORIZED', 401),
        { code: 'UNAUTHORIZED', status: 401 }
      )
    }
    // Fetch Runly role/profile — best-effort, ERP users may get 403 which is fine
    let user = null
    try {
      const profileRes = await request('GET', '/public/storefront/auth/me')
      user = profileRes?.data ?? null
    } catch {
      // Session is still valid even without profile
    }
    session.setUser(user)
    return { ...session.get(), user }
  }

  async function logout() {
    // Supabase fires SIGNED_OUT → onAuthStateChange → session adapter clears _cached
    await supabase.auth.signOut()
  }

  async function refresh() {
    const current = session.get()
    if (!current?.refreshToken) {
      throw new Error('No hay sesión activa para refrescar')
    }
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: current.refreshToken })
    if (error || !data.session) {
      // Force sign-out so the SIGNED_OUT event clears the adapter
      await supabase.auth.signOut()
      throw Object.assign(
        new StorefrontError('Token expirado, inicia sesión de nuevo', 'UNAUTHORIZED', 401),
        { code: 'UNAUTHORIZED', status: 401 }
      )
    }
    return {
      token: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresAt: data.session.expires_at,
    }
  }

  async function me() {
    const res = await request('GET', '/public/storefront/auth/me')
    return res?.data ?? null
  }

  function getSession() {
    return session.get()
  }

  function onAuthStateChange(fn) {
    return session.subscribe(fn)
  }

  return { register, login, logout, refresh, me, getSession, onAuthStateChange }
}
