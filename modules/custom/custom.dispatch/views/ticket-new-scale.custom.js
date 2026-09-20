import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'dispatch.ticket-new-scale',
  kind: 'CUSTOM',
  version: '0.5.0',
  schema: {
    path: '/app/m/custom.dispatch/vales/nueva-bascula',
    component: 'custom.dispatch:NewScaleTicketPage',
    title: 'Nuevo vale con báscula',
  },
})
