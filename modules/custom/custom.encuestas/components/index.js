export async function register(registry) {
  if (typeof window === 'undefined') return
  const [
    { default: EncuestasDashboard },
    { default: EncuestasStudio },
    { default: ResponderEncuesta },
    { default: ResultadosEncuestas },
  ] = await Promise.all([
    import('./EncuestasDashboard.jsx'),
    import('./EncuestasStudio.jsx'),
    import('./ResponderEncuesta.jsx'),
    import('./ResultadosEncuestas.jsx'),
  ])

  registry.register('custom.encuestas:EncuestasDashboard', EncuestasDashboard)
  registry.register('custom.encuestas:EncuestasStudio', EncuestasStudio)
  registry.register('custom.encuestas:ResponderEncuesta', ResponderEncuesta)
  registry.register('custom.encuestas:ResultadosEncuestas', ResultadosEncuestas)
}
