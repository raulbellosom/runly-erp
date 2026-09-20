import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'dispatch.stations',
  kind: 'CUSTOM',
  version: '0.5.0',
  schema: {
    path: '/app/m/custom.dispatch/estaciones',
    component: 'custom.dispatch:StationsPage',
    title: 'Estaciones operativas',
  },
})
