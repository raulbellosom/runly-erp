export class BackgroundAdapter {
  async load() { throw new Error('load() debe implementarse') }
  getBounds() { return null }
  getMetadata() { return {} }
  getNativeUnits() { return null }
  getLogicalPages() { return [] }
  render() {}
  dispose() {}
}

export class EmptyBackgroundAdapter extends BackgroundAdapter {
  async load(source) { this.source = source; return this }
}

export function createBackgroundAdapter(descriptor) {
  if (!descriptor?.type || descriptor.type === 'blank') return new EmptyBackgroundAdapter()
  throw new Error(`Adapter de fondo todavía no instalado: ${descriptor.type}`)
}

