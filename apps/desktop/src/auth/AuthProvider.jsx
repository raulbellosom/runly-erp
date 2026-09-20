import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { runly } from '../lib/runly'
import { getApiUrl } from '../lib/runtimeConfig.js'
import { RunlyOfflineDatabase, SessionVault } from '@runly/offline'
import { isSessionFresh } from './sessionFreshness.js'
import { useQueryClient } from '@tanstack/react-query'
import { useChatFloatStore } from '../modules/runly.chat/store/chatFloatStore.js'
import { setActiveCompanyId } from '../lib/runly'

const _vaultDb = new RunlyOfflineDatabase()
const _sessionVault = new SessionVault(_vaultDb)

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const queryClient = useQueryClient()
  const [session, setSession] = useState(null)
  const [userProfile, setUserProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let mounted = true
    let profileLoadedForAuthUserId = null
    let currentAuthId = null

    function changeIdentity(nextId) {
      if (currentAuthId === nextId) return
      currentAuthId = nextId
      queryClient.cancelQueries()
      queryClient.clear()
      setUserProfile(null)
      setActiveCompanyId(null)
      useChatFloatStore.setState({ openChats: [], isOpen: false })
      supabase.removeAllChannels().catch(() => {})
      if (!nextId) _sessionVault.clear().catch(() => {})
    }

    async function forceLogout() {
      // Re-check the shared session BEFORE attempting our own refresh —
      // another module window may have already rotated the (single-use)
      // refresh token and written a fresh session into shared storage.
      // Attempting our own refreshSession() first would be destructive
      // here: Supabase treats a reused/stale refresh token as an
      // unambiguous "invalid_grant" failure and signs the session out
      // globally, including a cross-tab broadcast that logs out every
      // other window — exactly the outcome this function exists to avoid.
      // Checking first means we never make that call in the case we're
      // trying to protect against.
      const { data: freshData } = await supabase.auth.getSession().catch(() => ({ data: null }))
      const freshSession = freshData?.session ?? null
      if (isSessionFresh(freshSession)) {
        if (!mounted) return
        setSession(freshSession)
        await refreshProfile(freshSession)
        return
      }

      // No fresh session already available — try refreshing ourselves.
      // A 401 from the API can be transient (network blip, token rotation
      // race). Only sign out if the refresh token itself is also dead.
      const { error: refreshError } = await supabase.auth.refreshSession().catch(() => ({
        error: new Error('refresh_unavailable'),
      }))
      if (!refreshError) {
        // Refresh succeeded — TOKEN_REFRESHED fires, session is alive.
        return
      }

      try {
        await supabase.auth.signOut()
      } catch {}
      _sessionVault.clear().catch(() => {})
      if (!mounted) return
      setSession(null)
      setUserProfile(null)
      profileLoadedForAuthUserId = null
    }

    function shouldForceLogout(error) {
      // Never force logout on a plain 401 — that's often a transient issue
      // or a token rotation race that the Supabase client will self-heal.
      // Only trigger on errors that unambiguously mean the session is dead.
      const message = String(error?.message ?? '').toLowerCase()
      return (
        message.includes('jwt expired') ||
        message.includes('invalid jwt') ||
        message.includes('token invalido') ||
        message.includes('token inválido') ||
        message.includes('profile not found')
      )
    }

    async function hydrateSession() {
      try {
        const { data } = await supabase.auth.getSession()
        if (!mounted) return
        const currentSession = data?.session ?? null
        changeIdentity(currentSession?.user?.id ?? null)
        setSession(currentSession)
        if (currentSession) {
          _sessionVault.store({
            accessToken: currentSession.access_token,
            refreshToken: currentSession.refresh_token,
            expiresAt: new Date(currentSession.expires_at * 1000).toISOString(),
            userProfile: null,
            companyId: null,
            apiBaseUrl: getApiUrl(),
          }).catch(() => {})

          runly.auth.me(currentSession.access_token)
            .then(profile => {
              if (!mounted || currentAuthId !== currentSession?.user?.id) return
              setUserProfile(profile)
              profileLoadedForAuthUserId = currentSession?.user?.id ?? null
              _sessionVault.update({
                userProfile: profile,
                companyId: profile?.companyId ?? null,
              }).catch(() => {})
            })
            .catch(async (error) => {
              if (shouldForceLogout(error)) {
                await forceLogout()
              }
            })
        } else {
          setUserProfile(null)
        }
      } catch {
        if (mounted) {
          setSession(null)
          setUserProfile(null)
        }
      } finally {
        if (mounted) setLoading(false)
      }
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      changeIdentity(session?.user?.id ?? null)
      setSession(session)
      setLoading(false)
      if (session) {
        _sessionVault.store({
          accessToken: session.access_token,
          refreshToken: session.refresh_token,
          expiresAt: new Date(session.expires_at * 1000).toISOString(),
          userProfile: null,
          companyId: null,
          apiBaseUrl: getApiUrl(),
        }).catch(() => {})

        const eventName = String(event ?? '').toUpperCase()
        const authUserId = session?.user?.id ?? null
        // On token rotation we keep current profile to avoid noisy /me requests
        // and prevent view churn while users are editing forms.
        if (eventName === 'TOKEN_REFRESHED' && authUserId && profileLoadedForAuthUserId === authUserId) {
          return
        }
        runly.auth.me(session.access_token)
          .then(profile => {
            if (!mounted || currentAuthId !== authUserId) return
            setUserProfile(profile)
            profileLoadedForAuthUserId = authUserId
          })
          .catch(async (error) => {
            if (shouldForceLogout(error)) {
              await forceLogout()
            }
          })
      } else {
        setUserProfile(null)
        profileLoadedForAuthUserId = null
      }
    })

    hydrateSession()

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, [queryClient])

  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return
      if (!session) return
      if (isSessionFresh(session)) return
      // Window regained focus and the session we last knew about is at/near
      // expiry — refresh proactively instead of waiting for the next API
      // call to fail first.
      supabase.auth.refreshSession().catch(() => {})
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [session])

  async function refreshProfile(activeSession = session) {
    if (!activeSession?.access_token) return null
    try {
      const profile = await runly.auth.me(activeSession.access_token)
      setUserProfile(profile)
      return profile
    } catch {
      return null
    }
  }

  return (
    <AuthContext.Provider value={{
      session,
      userProfile,
      loading,
      refreshProfile,
      logout: () => supabase.auth.signOut()
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
