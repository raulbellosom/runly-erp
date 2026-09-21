import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseEnv } from 'node:util'

// Read just the public Android build input. Never export the root .env to Gradle.
export function prepareAndroidFirebase(repository, androidApp, environment = process.env) {
  const envFile = resolve(repository, '.env')
  const local = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {}
  const configPath = (environment.RUNLY_ANDROID_GOOGLE_SERVICES_JSON ?? environment.ATLAS_ANDROID_GOOGLE_SERVICES_JSON) ?? (local.RUNLY_ANDROID_GOOGLE_SERVICES_JSON ?? local.ATLAS_ANDROID_GOOGLE_SERVICES_JSON)
  const projectId = environment.FIREBASE_PROJECT_ID ?? local.FIREBASE_PROJECT_ID
  const destination = resolve(androidApp, 'google-services.json')
  if (!configPath) {
    // This is a managed build input; do not reuse a previous environment's config.
    if (existsSync(destination)) unlinkSync(destination)
    return false
  }
  let config
  try {
    config = JSON.parse(readFileSync(resolve(repository, configPath), 'utf8'))
  } catch {
    throw new Error('Cannot read Android Firebase configuration; check RUNLY_ANDROID_GOOGLE_SERVICES_JSON')
  }
  const containsPrivateKey = (value) => value && typeof value === 'object'
    && Object.entries(value).some(([key, child]) => key === 'private_key' || key === 'private_key_id' || containsPrivateKey(child))
  if (config?.type === 'service_account' || containsPrivateKey(config)) {
    throw new Error('Server credentials must never be used as Android Firebase configuration')
  }
  if (!config?.project_info?.project_id || !config.project_info.project_number
    || !config.client?.some((client) => client.client_info?.android_client_info?.package_name === 'com.racoondevs.runlyerp'
      && client.client_info?.mobilesdk_app_id && client.api_key?.some((key) => key.current_key))) {
    throw new Error('Firebase Android configuration must contain the app com.racoondevs.runlyerp')
  }
  if (projectId && config.project_info.project_id !== projectId) {
    throw new Error('Android Firebase configuration does not match FIREBASE_PROJECT_ID')
  }
  writeFileSync(destination, `${JSON.stringify(config, null, 2)}\n`)
  return true
}
