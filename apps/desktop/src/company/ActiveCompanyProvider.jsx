import { useChatFloatStore } from '../modules/runly.chat/store/chatFloatStore.js'
import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthProvider'
import { runly, setActiveCompanyId as setSdkActiveCompanyId } from '../lib/runly'
import { pickActiveCompany } from './pickActiveCompany.js'
import { useBootLoader } from '../stores/bootLoader'
import { clearCompanyQueryCache } from './companyQueryCache.js'

const STORAGE_KEY = 'runly-active-company'

function readStoredCompanyId() {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function writeStoredCompanyId(id) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, String(id))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

const ActiveCompanyContext = createContext(null)

export function ActiveCompanyProvider({ children }) {
  const { session, refreshProfile } = useAuth()
  const token = session?.access_token
  const authUserId = session?.user?.id
  const queryClient = useQueryClient()

  const [activeCompanyId, setActiveCompanyIdState] = useState(null)
  // Ref, not just state: getActiveCompanyId (passed to the SDK, see
  // apps/desktop/src/lib/runly.js) must read the CURRENT value even from
  // code paths that fire between renders — state alone would risk a stale
  // closure. Kept in sync with activeCompanyId on every change below.
  const activeCompanyIdRef = useRef(null)

  const { data, isLoading: membershipsLoading, error: membershipsError } = useQuery({
    queryKey: ['memberships-me', authUserId],
    queryFn: () => runly.memberships.me(token),
    enabled: Boolean(token),
    staleTime: 10_000,
    refetchInterval: 15_000,
  })

  // A failed background request does not revoke an existing membership. Explicit
  // auth rejection or a successful response removing it does revoke access.
  const accessDenied = [401, 403].includes(membershipsError?.status)
  const memberships = accessDenied ? [] : Array.isArray(data) ? data : (data?.data ?? [])
  const revisionRef = useRef(null)
  const revision = memberships.find((m) => String(m.companyId ?? m.company?.id) === activeCompanyId)?.authorizationRevision
  useEffect(() => {
    if (!activeCompanyId) return
    const previous = revisionRef.current
    revisionRef.current = { companyId: activeCompanyId, revision }
    if (previous?.companyId === activeCompanyId && previous.revision !== revision) {
      clearCompanyQueryCache(queryClient)
      useChatFloatStore.setState({ openChats: [], isOpen: false })
    }
    if (previous?.companyId !== activeCompanyId || previous?.revision !== revision) refreshProfile(session)
  }, [revision, activeCompanyId, queryClient, refreshProfile, session])
  const companies = useMemo(
    () => memberships.map((m) => m.company ?? m).filter((c) => c && c.name),
    [memberships],
  )

  const applyActiveCompany = useCallback((id) => {
    if (activeCompanyIdRef.current !== id) {
      clearCompanyQueryCache(queryClient)
      useChatFloatStore.setState({ openChats: [], isOpen: false })
    }
    activeCompanyIdRef.current = id
    setActiveCompanyIdState(id)
    setSdkActiveCompanyId(id)
  }, [queryClient])

  // Resolve on load / whenever the membership list changes (a membership was
  // added/removed elsewhere). Never silently reuses a persisted id that no
  // longer names a company this user belongs to — pickActiveCompany enforces
  // that by only ever returning an id present in `companies`.
  useEffect(() => {
    if (membershipsLoading) return
    const next = pickActiveCompany({ companies, storedId: readStoredCompanyId() })
    if (next !== activeCompanyIdRef.current) {
      applyActiveCompany(next)
    }
  }, [membershipsLoading, companies, applyActiveCompany])

  const setActiveCompany = useCallback((companyId) => {
    const id = String(companyId)
    if (!companies.some((c) => String(c.id) === id)) return
    if (id === activeCompanyIdRef.current) return
    applyActiveCompany(id)
    writeStoredCompanyId(id)
    // applyActiveCompany already clears resource data while preserving the
    // instance and membership queries needed to keep the shell mounted.
  }, [companies, applyActiveCompany])

  const getActiveCompanyId = useCallback(() => activeCompanyIdRef.current, [])

  const isLoading = membershipsLoading || (companies.length > 0 && activeCompanyId == null)

  const value = useMemo(() => ({
    activeCompanyId,
    activeCompany: companies.find((c) => String(c.id) === String(activeCompanyId)) ?? null,
    companies,
    isLoading,
    setActiveCompany,
    getActiveCompanyId,
  }), [activeCompanyId, companies, isLoading, setActiveCompany, getActiveCompanyId])

  return (
    <ActiveCompanyContext.Provider value={value}>
      {children}
    </ActiveCompanyContext.Provider>
  )
}

export function useActiveCompany() {
  const ctx = useContext(ActiveCompanyContext)
  if (!ctx) throw new Error('useActiveCompany must be used inside ActiveCompanyProvider')
  return ctx
}

// Blocks rendering of the authenticated shell until the active company is
// resolved — mirrors the existing brandReady gate in AppEntry.jsx. Prevents
// module screens from firing tenant-scoped queries with no
// X-Runly-Company-Id header during the brief window before resolution.
export function ActiveCompanyGate({ children }) {
  const { isLoading, activeCompanyId } = useActiveCompany()
  useBootLoader('company', isLoading)
  if (isLoading) return null
  return <Fragment key={activeCompanyId}>{children}</Fragment>
}
