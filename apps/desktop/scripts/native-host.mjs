import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
import { spawnSync } from 'node:child_process'
import { buildNativeBrandAssets } from '../../../scripts/build-native-brand-assets.mjs'
import { prepareAndroidFirebase } from './native-firebase.mjs'

const desktop = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const environments = JSON.parse(readFileSync(resolve(desktop, 'native-host/environments.json'), 'utf8'))

function isDevelopmentHost(host) {
  if (host === 'localhost' || host === '[::1]' || host.endsWith('.localhost') || host.endsWith('.local')) return true
  if (/^\[f[cd][0-9a-f]*:/i.test(host)) return true
  const parts = host.split('.').map(Number)
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    && (parts[0] === 127 || parts[0] === 10 || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31))
}

// Production/staging origins come from the deployer's own environment
// variables, never from a value checked into this starter template — the
// repo only ships a placeholder in environments.json as a non-real fallback
// so an unconfigured build fails loudly against app.example.com instead of
// silently pointing at someone else's instance. This does NOT reopen the
// "pinned build-time trust manifest" security property environments.json
// exists for: the origin is still resolved once, at build time, into the
// generated tauri.native.generated.json — never re-read at runtime from a
// form, deep link, or localStorage — so sourcing it from an env var the
// deployer controls at build time is exactly as safe as a JSON literal.
function resolvePinnedOrigin(name) {
  if (name === 'production') return process.env.RUNLY_NATIVE_PRODUCTION_URL || environments.production
  if (name === 'staging') return process.env.RUNLY_NATIVE_STAGING_URL || environments.staging
  throw new Error('Unknown native environment')
}

export function resolveEnvironment(name, devOrigin, action, debug = false) {
  if (!['production', 'staging', 'development'].includes(name)) throw new Error('Unknown native environment')
  if (name === 'development' && action === 'build' && !debug) throw new Error('Development origins are debug-only; use dev or --debug')
  const url = new URL(name === 'development' ? (devOrigin || 'http://10.0.2.2:5173') : resolvePinnedOrigin(name))
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Expected an origin without credentials/path/query')
  if (name !== 'development' && url.protocol !== 'https:') throw new Error('HTTPS required')
  if (name === 'development' && !['https:', 'http:'].includes(url.protocol)) throw new Error('HTTP(S) required')
  if (name === 'development' && !isDevelopmentHost(url.hostname)) throw new Error('Development requires loopback or a private LAN host')
  return url.origin
}

export function makeConfig(origin) {
  return {
    version: environments.nativeHostVersion,
    build: { beforeDevCommand: '', beforeBuildCommand: '', devUrl: null, frontendDist: '../native-host/shell' },
    app: {
      windows: [],
      security: {
        csp: "default-src 'self'; script-src 'self'; style-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'",
        capabilities: [
          { identifier: 'native-shell', windows: ['main'], platforms: ['android', 'iOS'], local: true,
            permissions: ['allow-host-info', 'allow-host-connect', 'allow-host-confirm-origin', 'allow-host-forget-origin'] },
          { identifier: 'native-remote', windows: ['main'], platforms: ['android', 'iOS'], local: false,
            remote: { urls: [`${origin}/app/*`] },
            permissions: ['allow-host-info', 'allow-host-ready', 'allow-host-events', 'allow-host-ack-events',
              'notification:allow-is-permission-granted', 'notification:allow-request-permission', 'notification:allow-notify',
              'notification:allow-create-channel', 'notification:allow-remove-active', 'allow-host-notification-show',
              'allow-host-screen-start', 'allow-host-screen-stop', 'allow-host-screen-status',
              'haptics:allow-impact-feedback', 'allow-host-open-external', 'allow-host-fcm-token'] },
        ],
      },
    },
    plugins: { 'deep-link': { mobile: [{ scheme: ['runly'], appLink: false }] } },
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [platform = 'android', action = 'dev', environment = process.env.RUNLY_NATIVE_ENV || 'staging'] = process.argv.slice(2)
  if (!['android', 'ios'].includes(platform) || !['init', 'dev', 'build', 'config'].includes(action)) throw new Error('Usage: native-host.mjs android|ios init|dev|build|config development|staging|production')
  const origin = resolveEnvironment(environment, process.env.RUNLY_NATIVE_DEV_ORIGIN, action, process.argv.slice(5).includes('--debug'))
  if (platform === 'android' && action !== 'init') {
    prepareAndroidFirebase(resolve(desktop, '../..'), resolve(desktop, 'src-tauri/gen/android/app'))
  }
  const configPath = resolve(desktop, 'src-tauri/tauri.native.generated.json')
  writeFileSync(configPath, `${JSON.stringify(makeConfig(origin), null, 2)}\n`)
  if (action === 'config') console.log(configPath)
  else {
    const extra = process.argv.slice(5)
    if (extra.some((arg) => !['--debug', '--apk', '--aab'].includes(arg))) throw new Error('Only --debug/--apk/--aab supported; use RUNLY_NATIVE_TARGET for ABI')
    const target = process.env.RUNLY_NATIVE_TARGET || 'aarch64'
    if (!['aarch64', 'armv7', 'i686', 'x86_64'].includes(target)) throw new Error('Invalid Android target')
    const cli = resolve(desktop, 'node_modules/@tauri-apps/cli/tauri.js')
    // A stable remote host must bootstrap from bundled assets even during development.
    // `tauri dev` can replace App URLs with its development asset server, so dev here
    // builds a debug host. Web edits still appear remotely without rebuilding it.
    const tauriAction = action === 'dev' ? 'build' : action
    if (tauriAction === 'build') buildNativeBrandAssets()
    const args = [cli, platform, tauriAction, '--config', configPath, ...(action === 'init' ? ['--ci'] : [])]
    if (action === 'dev') args.push('--debug')
    if (platform === 'android' && tauriAction === 'build') args.push('--target', target)
    if (platform === 'ios' && extra.some((arg) => ['--apk', '--aab'].includes(arg))) throw new Error('APK/AAB apply only to Android')
    if (tauriAction === 'build') args.push(...extra)
    const result = spawnSync(process.execPath, args, {
      cwd: desktop, stdio: 'inherit', env: { ...process.env, RUNLY_NATIVE_ENV: environment, RUNLY_NATIVE_ORIGIN: origin },
    })
    if (result.error) throw result.error
    if (action === 'init' && result.status === 0) buildNativeBrandAssets()
    process.exitCode = result.status ?? 1
  }
}
