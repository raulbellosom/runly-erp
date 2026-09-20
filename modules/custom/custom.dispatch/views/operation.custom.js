import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'dispatch.operation',
  kind: 'CUSTOM',
  version: '0.5.0',
  schema: {
    path: '/app/m/custom.dispatch/operacion',
    component: 'custom.dispatch:OperationDashboard',
    title: 'Configuración operativa',
  },
})
