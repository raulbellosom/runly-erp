import { createCompanyFetch } from '@runly/sdk'
import { getActiveCompanyId } from './runly.js'
import { getApiUrl } from './runtimeConfig.js'

export const companyFetch = createCompanyFetch({
  getBaseUrl: getApiUrl,
  getCompanyId: getActiveCompanyId,
})
