import { companyFetch } from '../../../lib/companyFetch.js'
// apps/desktop/src/modules/runly.ledger/hooks/useTransactionMutations.js
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { buildTransactionPayload } from '../lib/spreadsheet-helpers.js'

const API_BASE = getApiUrl()

// Owns the save/delete mutations for the transaction register (desktop grid
// + mobile sheet share these) and the per-row draft state used by the
// desktop spreadsheet's inline editing.
export function useTransactionMutations({ accountId, token, queryKey, canEdit, onNewRowSaved }) {
  const queryClient = useQueryClient()
  const [editingRows, setEditingRows] = useState({})

  const saveMutation = useMutation({
    mutationFn: async ({ isNew, id, payload }) => {
      const url = isNew
        ? `${API_BASE}/ledger/accounts/${accountId}/transactions`
        : `${API_BASE}/ledger/accounts/${accountId}/transactions/${id}`
      const res = await companyFetch(url, {
        method: isNew ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? 'Error al guardar.')
      }
      return res.json()
    },
    onMutate: async ({ isNew, id, payload }) => {
      await queryClient.cancelQueries({ queryKey })
      const previousData = queryClient.getQueryData(queryKey)
      queryClient.setQueryData(queryKey, (old) => {
        if (!old?.data) return old
        if (isNew) {
          const tempRow = {
            ...payload,
            id: `__temp_${Date.now()}`,
            account_id: accountId,
            _pending: true,
            consecutive: '?',
            saldo_actual: null,
          }
          return { ...old, data: [...old.data, tempRow] }
        }
        return {
          ...old,
          data: old.data.map((row) => (
            row.id === id ? { ...row, ...payload, _pending: true } : row
          )),
        }
      })
      return { previousData }
    },
    onError: (error, _vars, context) => {
      if (context?.previousData) queryClient.setQueryData(queryKey, context.previousData)
      toast.error(error.message)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['ledger-transactions', accountId] })
      queryClient.invalidateQueries({ queryKey: ['ledger-account', accountId] })
      queryClient.invalidateQueries({ queryKey: ['ledger-summary', accountId] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async (txId) => {
      const res = await companyFetch(
        `${API_BASE}/ledger/accounts/${accountId}/transactions/${txId}/enabled`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ enabled: false }),
        },
      )
      if (!res.ok) throw new Error('No se pudo eliminar el movimiento.')
    },
    onSuccess: () => {
      toast.success('Movimiento eliminado.')
      queryClient.invalidateQueries({ queryKey: ['ledger-transactions', accountId] })
      queryClient.invalidateQueries({ queryKey: ['ledger-account', accountId] })
      queryClient.invalidateQueries({ queryKey: ['ledger-summary', accountId] })
    },
    onError: (error) => { toast.error(error.message) },
  })

  function getDraft(row, rowIdx) {
    const key = row.id ?? `new-${rowIdx}`
    return editingRows[key] ?? row
  }

  function setDraft(row, rowIdx, field, value) {
    if (!canEdit) return
    const key = row.id ?? `new-${rowIdx}`
    setEditingRows((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? row), [field]: value, _dirty: true },
    }))
  }

  function clearDraft(row, rowIdx) {
    const key = row.id ?? `new-${rowIdx}`
    setEditingRows((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  function saveRow(row, rowIdx) {
    if (!canEdit) return
    const draft = getDraft(row, rowIdx)
    if (!draft._dirty && !draft._isNew) return
    const payload = buildTransactionPayload(draft, { onError: (msg) => toast.error(msg) })
    if (!payload) return
    saveMutation.mutate({ isNew: !!draft._isNew, id: row.id, payload })
    clearDraft(row, rowIdx)
    if (draft._isNew) onNewRowSaved?.()
  }

  return { saveMutation, deleteMutation, getDraft, setDraft, clearDraft, saveRow }
}
