import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'dispatch.exit-queue',
  kind: 'CUSTOM',
  version: '0.7.0',
  schema: {
    path: '/app/m/custom.dispatch/salidas',
    component: 'custom.dispatch:ExitApprovalQueuePage',
    title: 'Salidas pendientes',
  },
})
