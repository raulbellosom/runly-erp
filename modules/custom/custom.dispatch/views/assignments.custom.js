import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'dispatch.assignments',
  kind: 'CUSTOM',
  version: '0.5.0',
  schema: {
    path: '/app/m/custom.dispatch/responsables',
    component: 'custom.dispatch:AssignmentsPage',
    title: 'Responsables por estación',
  },
})
