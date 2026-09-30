import { useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { ROOT } from '../lib/purchases-constants.js'

// /purchases/<section>/<id|new>/<edit> -> { section, id, isNew, isEdit }.
export function parsePurchasePath(pathname) {
  const rest = pathname.startsWith(ROOT) ? pathname.slice(ROOT.length) : ''
  const [section = '', second = '', third = ''] = rest.split('/').filter(Boolean)
  return {
    section,
    id: second && second !== 'new' ? decodeURIComponent(second) : null,
    isNew: second === 'new',
    isEdit: third === 'edit',
  }
}

export function usePurchaseRoute() {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  return useMemo(() => ({ ...parsePurchasePath(location.pathname), searchParams }), [location.pathname, searchParams])
}
