const HEALTH_PROBE_INTERVAL_MS = 30_000

export class OnlineDetector {
  constructor({ getNavigatorOnline = () => (typeof navigator !== 'undefined' ? navigator.onLine : true), probeUrl = null } = {}) {
    this._getNavigatorOnline = getNavigatorOnline
    this._probeUrl = probeUrl
    this._callbacks = []
    this._currentState = getNavigatorOnline()
    this._probeTimer = null
    this._probing = false

    this._handleOnline = this._handleOnline.bind(this)
    this._handleOffline = this._handleOffline.bind(this)

    if (typeof window !== 'undefined') {
      window.addEventListener('online', this._handleOnline)
      window.addEventListener('offline', this._handleOffline)
    }

    if (probeUrl) {
      this._probeTimer = setInterval(() => this._probe(), HEALTH_PROBE_INTERVAL_MS)
    }
  }

  isOnline() {
    return this._currentState
  }

  onChange(callback) {
    this._callbacks.push(callback)
  }

  destroy() {
    this._callbacks = []
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this._handleOnline)
      window.removeEventListener('offline', this._handleOffline)
    }
    if (this._probeTimer) {
      clearInterval(this._probeTimer)
      this._probeTimer = null
    }
  }

  _handleOnline() {
    if (this._currentState === true) return
    this._currentState = true
    this._notify(true)
  }

  _handleOffline() {
    if (this._currentState === false) return
    this._currentState = false
    this._notify(false)
  }

  _notify(isOnline) {
    for (const cb of this._callbacks) {
      try { cb(isOnline) } catch {}
    }
  }

  // Manual reconnect: probes right away instead of waiting for the next
  // interval tick. Resolves to the resulting online state.
  async checkNow() {
    if (!this._probeUrl) {
      if (this._getNavigatorOnline()) this._handleOnline()
      else this._handleOffline()
      return this._currentState
    }
    while (this._probing) await new Promise((resolve) => setTimeout(resolve, 100))
    await this._probe()
    return this._currentState
  }

  async _probe() {
    if (!this._probeUrl || this._probing) return
    this._probing = true
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10_000)
    try {
      await fetch(this._probeUrl, { method: 'HEAD', cache: 'no-store', signal: controller.signal })
      this._handleOnline()
    } catch {
      this._handleOffline()
    } finally {
      clearTimeout(timer)
      this._probing = false
    }
  }
}
