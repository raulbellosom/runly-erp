import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'dispatch.weighing-capture',
  kind: 'CUSTOM',
  version: '0.6.0',
  schema: {
    path: '/app/m/custom.dispatch/pesajes',
    component: 'custom.dispatch:WeighingCapturePage',
    title: 'Captura de pesajes',
  },
})
