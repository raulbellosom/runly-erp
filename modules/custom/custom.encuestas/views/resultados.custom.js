import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'encuestas.resultados',
  kind: 'CUSTOM',
  version: '1.1.0',
  schema: {
    path: '/app/m/custom.encuestas/resultados',
    component: 'custom.encuestas:ResultadosEncuestas',
    title: 'Resultados',
  },
})
