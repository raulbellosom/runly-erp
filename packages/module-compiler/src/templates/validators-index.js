export function generateValidatorsIndex(config) {
  const lines = config.entities.map((e) => `export * from './${e.name}.validators.js'`)
  return lines.join('\n') + '\n'
}
