import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'dispatch.series',
  kind: 'CUSTOM',
  version: '0.5.0',
  schema: {
    path: '/app/m/custom.dispatch/folios',
    component: 'custom.dispatch:SeriesPage',
    title: 'Series de folios',
  },
})
