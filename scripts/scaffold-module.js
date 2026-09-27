#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

import { validateConfig, validateModuleDirectory } from './scaffold/validate.js'
import { writeModule, applyDefaults } from './scaffold/writer.js'
import { runInteractivePrompts } from './scaffold/prompts.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const SCAFFOLD_OUTPUT = resolve(__dirname, 'scaffold-output')

async function main() {
  const args = process.argv.slice(2)
  const definitionFlag = args.indexOf('--definition')
  const configPath = definitionFlag >= 0 ? args[definitionFlag + 1] : args[0]
  let config

  if (configPath) {
    const abs = resolve(process.cwd(), configPath)
    let raw
    try {
      raw = readFileSync(abs, 'utf8')
    } catch {
      console.error(`Error: no se pudo leer el archivo "${abs}"`)
      process.exit(1)
    }
    try {
      config = JSON.parse(raw)
    } catch {
      console.error(`Error: el archivo "${abs}" no contiene JSON valido.`)
      process.exit(1)
    }
  } else {
    config = await runInteractivePrompts()
    // Save config for reproducibility
    mkdirSync(SCAFFOLD_OUTPUT, { recursive: true })
    const outPath = resolve(SCAFFOLD_OUTPUT, `${config.key}.config.json`)
    writeFileSync(outPath, JSON.stringify(config, null, 2), 'utf8')
    console.log(`\nConfig guardada en: scripts/scaffold-output/${config.key}.config.json`)
  }

  config = applyDefaults(config)

  // Validate
  const errors = validateConfig(config)
  if (errors.length > 0) {
    console.error('\nErrores de validacion:')
    for (const e of errors) console.error(`  - ${e}`)
    process.exit(1)
  }

  // Check for existing module directory
  const existing = validateModuleDirectory(config.key, REPO_ROOT)
  if (existing) {
    const overwrite = await askOverwrite(existing)
    if (!overwrite) {
      console.log('Cancelado.')
      process.exit(0)
    }
  }

  // Generate files
  console.log(`\nGenerando modulo en modules/custom/${config.key}/...\n`)
  const { written } = writeModule(config, REPO_ROOT)

  for (const f of written) {
    console.log(`  [OK] ${f}`)
  }

  console.log(`\n${written.length} archivos generados.`)
  console.log('\nVerificacion recomendada:')
  console.log(`  node --check modules/custom/${config.key}/module.manifest.js`)
  console.log(`  node --check modules/custom/${config.key}/api/index.js`)
  console.log(`  curl -X POST http://localhost:4010/modules/sync -H "Authorization: Bearer $RUNLY_TOKEN"`)
  console.log(`  curl -X POST http://localhost:4010/modules/${config.key}/install -H "Authorization: Bearer $RUNLY_TOKEN"`)
  if (config.preset === 'crud-custom') {
    console.log(`  curl http://localhost:4010/modules/${config.key}/bundle.js`)
    console.log(`  # Abrir: http://localhost:5173/app/m/${config.key}/dashboard`)
  }
  console.log('')
}

async function askOverwrite(modulePath) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    rl.question(`El directorio "${modulePath}" ya existe. Sobreescribir? [y/N]: `, (answer) => {
      rl.close()
      resolve(answer.trim().toLowerCase() === 'y')
    })
  })
}

main().catch((err) => {
  console.error('Error inesperado:', err)
  process.exit(1)
})
