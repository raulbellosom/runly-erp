import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'dispatch.sites',
  kind: 'CUSTOM',
  version: '0.5.0',
  schema: {
    path: '/app/m/custom.dispatch/sitios',
    component: 'custom.dispatch:SitesPage',
    title: 'Sitios operativos',
  },
})
