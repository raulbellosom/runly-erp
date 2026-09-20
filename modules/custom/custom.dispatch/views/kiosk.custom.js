import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'dispatch.kiosk',
  kind: 'CUSTOM',
  version: '0.4.0',
  schema: {
    path: '/app/m/custom.dispatch/kiosco',
    component: 'custom.dispatch:DispatchKiosk',
    title: 'Kiosco de salida',
  },
})
