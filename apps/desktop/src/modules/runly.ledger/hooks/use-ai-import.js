import { companyFetch } from '../../../lib/companyFetch.js'
// apps/desktop/src/modules/runly.ledger/hooks/use-ai-import.js
import { useMutation } from '@tanstack/react-query'
import { useAuth } from '../../../auth/AuthProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'

const API_BASE = getApiUrl()

export function useAiImportMutations() {
  const { session } = useAuth()
  const token = session?.access_token ?? null

  const recognize = useMutation({
    mutationFn: async (file) => {
      const formData = new FormData()
      formData.append('file', file)
      const res = await companyFetch(`${API_BASE}/ledger/imports/recognize`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'No se pudo analizar el archivo.')
      return body.data
    },
  })

  const commit = useMutation({
    mutationFn: async (payload) => {
      const res = await companyFetch(`${API_BASE}/ledger/imports/commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? 'No se pudo importar el archivo.')
      return body.data
    },
  })

  return { recognize, commit }
}
