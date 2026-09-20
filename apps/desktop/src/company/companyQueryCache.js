// These queries resolve the application/tenant boundary itself. Removing them
// while choosing a company unmounts that provider and starts the same cycle again.
const CONTEXT_QUERY_KEYS = new Set(['instance-status', 'memberships-me'])

export function clearCompanyQueryCache(queryClient) {
  const filters = { predicate: (query) => !CONTEXT_QUERY_KEYS.has(query.queryKey[0]) }
  queryClient.cancelQueries(filters)
  queryClient.removeQueries(filters)
}
