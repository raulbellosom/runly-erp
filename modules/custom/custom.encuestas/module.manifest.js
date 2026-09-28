import { defineRunlyModule } from '@runly/module-engine'

export default defineRunlyModule({
  key: 'custom.encuestas',
  name: 'Encuestas',
  version: '1.1.1',
  kind: 'FEATURE',
  description: 'Crea, publica, responde y analiza encuestas personalizadas.',
  icon: 'ClipboardList',
  color: '#8b5cf6',
  pwa: {
    shortName: 'Encuestas',
    startPath: '/dashboard',
  },
  dependencies: [{ key: 'runly.core' }, { key: 'runly.hr' }, { key: 'runly.inventory' }],
  models: [
    './models/encuestas.model.js',
    './models/preguntas.model.js',
    './models/respuestas.model.js',
  ],
  views: [
    './views/dashboard.custom.js',
    './views/constructor.custom.js',
    './views/responder.custom.js',
    './views/resultados.custom.js',
  ],
  lifecycle: {
    installable: true,
    uninstallable: true,
    resettable: true,
    supportsDataPurge: true,
    defaultUninstallPolicy: 'purge-owned-tables',
    ownedModels: [
      'encuestas.encuesta',
      'encuestas.pregunta',
      'encuestas.respuesta',
    ],
    ownedTables: [
      'encuestas_encuestas',
      'encuestas_preguntas',
      'encuestas_respuestas',
    ],
  },
  permissions: [
    { key: 'encuestas.encuestas.read', name: 'Ver encuestas' },
    { key: 'encuestas.encuestas.create', name: 'Crear encuestas' },
    { key: 'encuestas.encuestas.update', name: 'Editar encuestas' },
    { key: 'encuestas.encuestas.publish', name: 'Publicar o cerrar encuestas' },
    { key: 'encuestas.encuestas.delete', name: 'Eliminar encuestas' },
    { key: 'encuestas.respuestas.create', name: 'Responder encuestas' },
    { key: 'encuestas.respuestas.read', name: 'Ver resultados y respuestas' },
  ],
  navigation: [
    {
      label: 'Resumen',
      path: '/app/m/custom.encuestas/dashboard',
      icon: 'LayoutDashboard',
      layout: 'main',
      permissionKey: 'encuestas.encuestas.read',
    },
    {
      label: 'Constructor',
      path: '/app/m/custom.encuestas/constructor',
      icon: 'ClipboardList',
      layout: 'main',
      permissionKey: 'encuestas.encuestas.read',
    },
    {
      label: 'Responder',
      path: '/app/m/custom.encuestas/responder',
      icon: 'ListChecks',
      layout: 'main',
      permissionKey: 'encuestas.respuestas.create',
    },
    {
      label: 'Resultados',
      path: '/app/m/custom.encuestas/resultados',
      icon: 'BarChart3',
      layout: 'main',
      permissionKey: 'encuestas.respuestas.read',
    },
  ],
})
