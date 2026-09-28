import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'encuestas.dashboard',
  kind: 'CUSTOM',
  version: '1.1.0',
  schema: {
    path: '/app/m/custom.encuestas/dashboard',
    component: 'custom.encuestas:EncuestasDashboard',
    title: 'Encuestas',
  },
})
