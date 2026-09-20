import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'dispatch.tickets',
  kind: 'CUSTOM',
  version: '0.5.0',
  schema: {
    path: '/app/m/custom.dispatch/vales',
    component: 'custom.dispatch:TicketsListPage',
    title: 'Vales',
  },
})
