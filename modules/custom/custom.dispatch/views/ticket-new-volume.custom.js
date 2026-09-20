import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'dispatch.ticket-new-volume',
  kind: 'CUSTOM',
  version: '0.5.0',
  schema: {
    path: '/app/m/custom.dispatch/vales/nueva-volumen',
    component: 'custom.dispatch:NewVolumeTicketPage',
    title: 'Nuevo vale por volumen',
  },
})
