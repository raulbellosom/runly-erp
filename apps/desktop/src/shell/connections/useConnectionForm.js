import { useCallback, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthProvider'
import { useActiveCompany } from '../../company/ActiveCompanyProvider'
import { runly } from '../../lib/runly'

const blank = (value) => value === null || value === undefined || value === ''
// Dates come back as ISO timestamps but are edited as YYYY-MM-DD.
function sameValue(a, b) {
  if (blank(a) && blank(b)) return true
  if (blank(a) || blank(b)) return false
  const left = String(a)
  const right = String(b)
  return left === right || (/^\d{4}-\d{2}-\d{2}$/.test(left) && right.startsWith(`${left}T`)) || (/^\d{4}-\d{2}-\d{2}$/.test(right) && left.startsWith(`${right}T`))
}

// Connection sections of a core form (spec 2026-10-03-rme3-module-platform-v2
// §8.2, D3). The core form keeps this state and sends payload() with its own
// save request, so the core record and its sections commit together.
export function useConnectionForm({ targetType, targetId = null }) {
  const { session } = useAuth()
  const { activeCompanyId } = useActiveCompany()
  const token = session?.access_token
  const [values, setValues] = useState({}) // { [connectionId]: { [field]: value } }
  const [errors, setErrors] = useState({}) // { '<connectionId>.<field>': message }
  const [conflict, setConflict] = useState(null)
  const touched = useRef(new Set())

  const query = useQuery({
    queryKey: ['connections', 'records', targetType, targetId ?? 'new', 'form', activeCompanyId],
    queryFn: async () => (await runly.connections.records(targetType, targetId ?? '00000000-0000-7000-8000-000000000000', 'form', token))?.data ?? [],
    enabled: Boolean(token && targetType),
    // Connected data changes from other modules, which cannot invalidate
    // this cache: always refetch when the screen opens.
    staleTime: 0,
    refetchOnMount: 'always',
  })
  // A new record has no connected rows: every section starts empty.
  const sections = useMemo(
    () => (query.data ?? []).filter((section) => section.kind === 'fields').map((section) => (targetId ? section : { ...section, record: null })),
    [query.data, targetId],
  )

  const valueOf = useCallback((section, field) => {
    const local = values[section.connectionId]
    if (local && field in local) return local[field]
    return section.record?.values?.[field] ?? null
  }, [values])

  const setFieldValue = useCallback((connectionId, field, value) => {
    touched.current.add(connectionId)
    setValues((current) => ({ ...current, [connectionId]: { ...current[connectionId], [field]: value } }))
    setErrors((current) => {
      const key = `${connectionId}.${field}`
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }, [])

  // Only editable sections the user changed.
  const payload = useCallback(() => {
    const out = {}
    for (const section of sections) {
      if (!section.editable || !touched.current.has(section.connectionId)) continue
      out[section.connectionId] = { values: values[section.connectionId] ?? {}, expectedUpdatedAt: section.record?.updatedAt ?? null }
    }
    return Object.keys(out).length ? out : null
  }, [sections, values])

  // Error body from the core save (422/403/409 connection_*): keeps the
  // messages next to the fields. Returns true when it was a connection error.
  const applyErrorResponse = useCallback((body) => {
    if (!body?.code?.startsWith?.('connection_')) return false
    if (body.code === 'connection_validation') setErrors(body.fields ?? {})
    if (body.code === 'connection_conflict') setConflict(body.connectionId ?? true)
    return true
  }, [])

  const reset = useCallback(() => {
    touched.current = new Set()
    setValues({})
    setErrors({})
    setConflict(null)
    return query.refetch()
  }, [query])

  // A field edited back to its saved value is not a change.
  const dirty = useMemo(() => sections.some((section) => {
    const local = values[section.connectionId]
    return section.editable && local && Object.entries(local).some(([field, value]) => !sameValue(value, section.record?.values?.[field]))
  }), [sections, values])

  return { sections, isLoading: query.isLoading, valueOf, setFieldValue, errors, conflict, dirty, payload, applyErrorResponse, reset }
}
