import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'dispatch.ticket-detail',
  kind: 'CUSTOM',
  version: '0.5.0',
  schema: {
    path: '/app/m/custom.dispatch/vales/:id',
    component: 'custom.dispatch:TicketDetailPage',
    title: 'Detalle de vale',
  },
})
