export function offlineDatabaseName({ apiBaseUrl, userId, companyId }) {
  if (!apiBaseUrl || !userId || !companyId) return null
  return `runly-offline-v2:${[apiBaseUrl.replace(/\/$/, ''), userId, companyId].map(encodeURIComponent).join(':')}`
}
