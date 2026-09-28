import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'encuestas.responder',
  kind: 'CUSTOM',
  version: '1.1.0',
  schema: {
    path: '/app/m/custom.encuestas/responder',
    component: 'custom.encuestas:ResponderEncuesta',
    title: 'Responder',
  },
})
