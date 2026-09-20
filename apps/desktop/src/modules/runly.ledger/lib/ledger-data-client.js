import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { getActiveCompanyId } from '../../../lib/runly.js'
import { createCompanyFetch } from '@runly/sdk'

function createHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function readJson(response, fallbackMessage) {
  if (!response.ok) {
    throw new Error(fallbackMessage)
  }
  return response.json()
}

export function createLedgerDataClient({ apiBaseUrl = getApiUrl(), fetchImpl, getCompanyId = getActiveCompanyId } = {}) {
  const request = createCompanyFetch({ getBaseUrl: () => apiBaseUrl, getCompanyId, fetchImpl })
  const baseUrl = String(apiBaseUrl ?? '').replace(/\/$/, '')

  return {
    async listAccounts({ token, ledgerStore }) {
      if (ledgerStore) {
        return { data: await ledgerStore.getAccountList() }
      }

      const response = await request(`${baseUrl}/ledger/accounts`, {
        headers: createHeaders(token),
      })
      return readJson(response, 'No se pudieron cargar las cuentas.')
    },

    async getAccount({ accountId, token, ledgerStore }) {
      if (ledgerStore) {
        return { data: await ledgerStore.getAccount(accountId) }
      }

      const response = await request(`${baseUrl}/ledger/accounts/${accountId}`, {
        headers: createHeaders(token),
      })
      return readJson(response, 'No se pudo cargar la cuenta.')
    },

    async listTransactionTypes({ token, ledgerStore }) {
      if (ledgerStore) {
        return { data: await ledgerStore.getTransactionTypes() }
      }

      const response = await request(`${baseUrl}/ledger/types`, {
        headers: createHeaders(token),
      })
      return readJson(response, 'No se pudieron cargar los tipos.')
    },

    async listCategories({ token, ledgerStore }) {
      if (ledgerStore) {
        return { data: await ledgerStore.getCategories() }
      }

      const response = await request(`${baseUrl}/ledger/categories`, {
        headers: createHeaders(token),
      })
      return readJson(response, 'No se pudieron cargar las categorias.')
    },

    async listTransactions({ accountId, token, ledgerStore, dateFrom, dateTo, pageSize = 200, order = 'desc' }) {
      if (ledgerStore) {
        return {
          data: await ledgerStore.queryTransactions(accountId, {
            start: dateFrom,
            end: dateTo,
            limit: pageSize,
            offset: 0,
          }),
        }
      }

      const params = new URLSearchParams({ pageSize: String(pageSize), order })
      if (dateFrom) params.set('from', dateFrom)
      if (dateTo) params.set('to', dateTo)

      const response = await request(`${baseUrl}/ledger/accounts/${accountId}/transactions?${params}`, {
        headers: createHeaders(token),
      })
      // Server returns the page already sorted ascending for display; `pagination.total`
      // carries the full row count so callers can offer "load older".
      return readJson(response, 'No se pudieron cargar los movimientos.')
    },

    async getAccountSummary({ accountId, token, ledgerStore, dateFrom, dateTo }) {
      if (ledgerStore) {
        return ledgerStore.getAccountSummary(accountId, {
          start: dateFrom,
          end: dateTo,
        })
      }

      const params = new URLSearchParams()
      if (dateFrom) params.set('from', dateFrom)
      if (dateTo) params.set('to', dateTo)

      const response = await request(`${baseUrl}/ledger/accounts/${accountId}/summary?${params}`, {
        headers: createHeaders(token),
      })
      return readJson(response, 'No se pudo cargar el resumen.')
    },

    async getRunningBalance({ accountId, ledgerStore, upToDate }) {
      if (!ledgerStore) return null
      return ledgerStore.getRunningBalance(accountId, upToDate)
    },

    async getMonthlyCashFlow({ accountId, ledgerStore, year }) {
      if (!ledgerStore) return []
      return ledgerStore.getMonthlySummary(accountId, year)
    },

    async getCategoryBreakdown({ accountId, ledgerStore, dateFrom, dateTo }) {
      if (!ledgerStore) return []
      return ledgerStore.getCategoryBreakdown(accountId, {
        start: dateFrom,
        end: dateTo,
      })
    },
  }
}
