#!/usr/bin/env node
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { execSync } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { buildNativeBrandAssets } from './build-native-brand-assets.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const desktopDir = path.join(root, 'apps', 'desktop')
const publicDir = path.join(desktopDir, 'public')
const brandDir = path.join(publicDir, 'brand')
const identityDir = path.join(root, 'identity')
const tauriIconsDir = path.join(desktopDir, 'src-tauri', 'icons')

const requiredSources = {
  appIcon: path.join(identityDir, 'runly-erp_app_icon.png'),
  primary: path.join(identityDir, 'runly-erp_primary_logo.png'),
  horizontal: path.join(identityDir, 'runly-erp_horizontal_logo.png'),
  vertical: path.join(identityDir, 'runly-erp_vertical_logo.png'),
  isotype: path.join(identityDir, 'runly-erp_isotype_only.png'),
  monoLight: path.join(identityDir, 'runly-erp_monochrome_light.png'),
  monoDark: path.join(identityDir, 'runly-erp_monochrome_dark.png'),
}

for (const [name, filePath] of Object.entries(requiredSources)) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing required branding source (${name}): ${filePath}`)
  }
}

mkdirSync(publicDir, { recursive: true })
mkdirSync(brandDir, { recursive: true })

console.log('Generating desktop app icons with tauri icon...')
execSync(`pnpm tauri icon \"${requiredSources.appIcon}\"`, {
  cwd: desktopDir,
  stdio: 'inherit',
})

console.log('Generating transparent brand PNG assets...')
execSync('python scripts/generate-transparent-brand-assets.py', {
  cwd: root,
  stdio: 'inherit',
})

const copyPairs = [
  [path.join(tauriIconsDir, 'icon.ico'), path.join(publicDir, 'favicon.ico')],
  [path.join(tauriIconsDir, '32x32.png'), path.join(publicDir, 'favicon-32x32.png')],
  [path.join(tauriIconsDir, 'icon.png'), path.join(publicDir, 'apple-touch-icon.png')],
  [path.join(tauriIconsDir, 'icon.png'), path.join(publicDir, 'icon-512.png')],
  [path.join(tauriIconsDir, 'android', 'mipmap-xxxhdpi', 'ic_launcher.png'), path.join(publicDir, 'icon-192.png')],
  [requiredSources.horizontal, path.join(publicDir, 'og-image.png')],
]

for (const [from, to] of copyPairs) {
  if (!existsSync(from)) {
    throw new Error(`Missing generated file: ${from}`)
  }
  copyFileSync(from, to)
}

const webManifest = {
  name: 'Runly ERP',
  short_name: 'Runly',
  description: 'Tu negocio en movimiento.',
  // The ERP SPA is served under /app/ (VITE_BASE_PATH). The origin root serves
  // the public marketing website, so the installed PWA must open the launcher.
  id: '/app/',
  scope: '/app/',
  start_url: '/app/',
  display: 'standalone',
  background_color: '#0C172D',
  theme_color: '#132646',
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
}

writeFileSync(
  path.join(publicDir, 'site.webmanifest'),
  `${JSON.stringify(webManifest, null, 2)}\n`,
)

console.log('Brand assets generated in apps/desktop/public and apps/desktop/src-tauri/icons')
// The legacy command above also touches initialized mobile projects. Apply the
// adaptive native brand last so mobile never falls back to the legacy raster.
buildNativeBrandAssets()
