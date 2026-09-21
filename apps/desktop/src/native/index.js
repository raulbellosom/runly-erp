import { detectRuntime, isNative, isNativeMobile, isNativeDesktop } from '@runly/core/native-runtime'
import { supportsCapability, createEventPump } from './policy.js'
import { notificationId, nativeNotificationOptions, prepareAndroidNotificationChannels } from './notification-policy.js'

let hostInfo = null
let initializing = null
let channelsReady = null
const invoke = async (command, args) => {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke(command, args)
}
const notifications = () => import('@tauri-apps/plugin-notification')

async function getHostInfo() {
  if (!isNative()) return null
  if (hostInfo) return hostInfo
  if (!initializing) initializing = (async () => {
    if (isNativeMobile()) hostInfo = await invoke('host_info')
    else {
      const { getVersion } = await import('@tauri-apps/api/app')
      hostInfo = { platform: 'desktop', nativeHostVersion: await getVersion(), osVersion: null,
        bridgeVersion: 1, capabilities: ['local-notifications', 'desktop-attention'] }
    }
    return hostInfo
  })().finally(() => { initializing = null })
  return initializing
}

export const native = {
  runtime: detectRuntime,
  isAvailable: isNative,
  isMobile: isNativeMobile,
  isDesktop: isNativeDesktop,
  getHostInfo,
  supports: (capability, minimumVersion) => supportsCapability(hostInfo, capability, minimumVersion),
  async requireCapability(capability, minimumVersion) {
    await getHostInfo()
    if (!native.supports(capability, minimumVersion)) throw new Error('Necesitas actualizar Runly desde App Store / Google Play para utilizar esta función.')
  },
  async ready() { if (isNativeMobile()) await invoke('host_ready') },
  async openExternal(value) {
    const url = new URL(value, globalThis.location?.href)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('INVALID_EXTERNAL_URL')
    if (isNativeMobile()) await invoke('host_open_external', { url: url.href })
    else globalThis.open(url.href, '_blank', 'noopener,noreferrer')
  },
  notifications: {
    async permission() {
      if (!isNative()) return globalThis.Notification?.permission ?? 'unsupported'
      return await (await notifications()).isPermissionGranted() ? 'granted' : 'default'
    },
    async requestPermission() {
      if (!isNative()) return globalThis.Notification?.requestPermission() ?? 'unsupported'
      const plugin = await notifications()
      return await plugin.isPermissionGranted() ? 'granted' : plugin.requestPermission()
    },
    async show(options) {
      if (!isNative() || await native.notifications.permission() !== 'granted') return false
      const plugin = await notifications()
      await getHostInfo()
      if (native.supports('notification-actions')) {
        if (detectRuntime() === 'tauri-android') {
          if (!channelsReady) channelsReady = prepareAndroidNotificationChannels(plugin).catch((error) => { channelsReady = null; throw error })
          await channelsReady
        }
        await invoke('host_notification_show', { options: nativeNotificationOptions(options) })
      } else await plugin.sendNotification({ title: options.title, body: options.body ?? '' })
      return true
    },
    async dismiss(tag) {
      if (!isNativeMobile()) return
      await getHostInfo()
      if (native.supports('notification-actions')) await (await notifications()).removeActive([{ id: notificationId(tag) }])
    },
    async getPushToken() {
      if (!isNativeMobile()) return null
      const response = await invoke('host_fcm_token')
      return response?.token ?? null
    },
  },
  screenShare: {
    async start(session) { await native.requireCapability('screen-share'); return invoke('host_screen_start', { session }) },
    async stop() { if (native.supports('screen-share')) await invoke('host_screen_stop') },
    async status() { return native.supports('screen-share') ? invoke('host_screen_status') : { active: false } },
  },
  haptics: {
    async impact(style = 'light') {
      await native.requireCapability('haptics')
      if (!['light', 'medium', 'heavy', 'soft', 'rigid'].includes(style)) throw new Error('INVALID_HAPTIC_STYLE')
      const result = await (await import('@tauri-apps/plugin-haptics')).impactFeedback(style)
      if (result?.status === 'error') throw new Error(String(result.error))
    },
  },
  async requestDesktopAttention() {
    if (!isNativeDesktop()) return false
    try {
      const { getCurrentWindow, UserAttentionType } = await import('@tauri-apps/api/window')
      await getCurrentWindow().requestUserAttention(UserAttentionType.Critical)
      return true
    } catch { return false }
  },
  events: {
    subscribe(handler) {
      if (!isNativeMobile()) return () => {}
      let disposed = false
      const pump = createEventPump({
        read: () => invoke('host_events'),
        acknowledge: (ids) => invoke('host_ack_events', { ids }),
      })
      const tick = () => pump((event) => disposed ? false : handler(event)).catch(() => {})
      const timer = setInterval(tick, 1000)
      globalThis.addEventListener('focus', tick)
      tick()
      return () => { disposed = true; clearInterval(timer); globalThis.removeEventListener('focus', tick) }
    },
  },
}

export async function initializeNativeHost() {
  if (!isNativeMobile()) return
  await getHostInfo()
  // Dedicated WebView storage: remove only the Atlas worker if an earlier host registered it.
  if (globalThis.navigator?.serviceWorker) {
    const registrations = await navigator.serviceWorker.getRegistrations()
    for (const registration of registrations) {
      const worker = registration.active ?? registration.waiting ?? registration.installing
      if (worker && new URL(worker.scriptURL).pathname === '/sw-notifications.js') await registration.unregister()
    }
  }
  // Mobile does not implement Tauri's on_new_window callback. Route popups explicitly.
  window.open = (url) => { if (url) native.openExternal(url).catch(() => {}); return null }
  document.addEventListener('click', (event) => {
    const link = event.target?.closest?.('a[href]')
    if (!link || link.hasAttribute('download')) return
    const url = new URL(link.href, location.href)
    if (url.origin !== location.origin || link.target === '_blank') {
      event.preventDefault()
      native.openExternal(url.href).catch(() => {})
    }
  }, true)
}
