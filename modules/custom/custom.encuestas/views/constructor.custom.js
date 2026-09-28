import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'encuestas.constructor',
  kind: 'CUSTOM',
  version: '1.1.0',
  schema: {
    path: '/app/m/custom.encuestas/constructor',
    component: 'custom.encuestas:EncuestasStudio',
    title: 'Constructor',
  },
})
