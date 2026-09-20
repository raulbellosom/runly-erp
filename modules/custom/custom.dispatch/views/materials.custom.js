import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'dispatch.materials',
  kind: 'CUSTOM',
  version: '0.5.0',
  schema: {
    path: '/app/m/custom.dispatch/materiales',
    component: 'custom.dispatch:MaterialsPage',
    title: 'Materiales despachables',
  },
})
