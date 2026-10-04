# @runly/module-compiler

Compilador de definiciones declarativas ModuleDefinition v1 a paquetes RME3.
No usa prompts, HTTP ni base de datos. Carga snapshots de documentación internos
por filesystem; los archivos del paquete de usuario se generan como texto.

```js
import { compileModule, normalizeModuleDefinition, validateModuleDefinition } from '@runly/module-compiler'
const normalized = normalizeModuleDefinition(definition)
const diagnostics = validateModuleDefinition(normalized)
const compiled = compileModule(definition)
```

`compiled.files` contiene `{ path, content }` en orden léxico y
`compiled.packageHash` identifica ese contenido. La escritura a disco pertenece
al adapter CLI. Véase [la referencia completa](../../docs/ai-context/rme3-module-compiler.md).

## Contratos y compilación RME3

El entry principal mantiene la API histórica del ERP. Subpaths explícitos:

| Import | Responsabilidad |
|---|---|
| `@runly/module-engine/browser` | Declaradores/validadores/esquemas puros y aliases de declaraciones Atlas |
| `@runly/module-engine/server` | API histórica completa, SQL, crypto, registries y filesystem |
| `@runly/module-engine/contracts` | Contrato engine v1; catálogo compartido de servicios/eventos |
| `@runly/module-compiler/browser` | Validación, normalización, IDs y capacidades, sin Node/shims |
| `@runly/module-compiler/server` | API histórica de generación y helpers |
| `@runly/module-compiler/compile` | Compilador existente, sin duplicación |
| `@runly/module-compiler/archive` | ZIP determinista existente |
| `@runly/module-compiler/contracts` | Compiler/runtime/capacidades v1 e inventario ERP |
| `@runly/module-compiler/inspection` | `inspectModuleZip(bytes, options)`; solo Node |

```js
import { inspectModuleZip } from '@runly/module-compiler/inspection'
const report = inspectModuleZip(bytes, {
  expectedKey: 'custom.example', expectedVersion: '1.0.0',
  limits: { zipBytes: 10 * 1024 * 1024 },
})
```

Los límites solo pueden reducirse. El lector no extrae a disco ni importa
JavaScript del paquete. Acepta imports nombrados de declaradores/enums RME3
Runly/Atlas y `export default defineX({...})` con literales, arrays, objetos,
enums aprobados y números negativos. No admite variables, spread, funciones,
getters, claves computadas, llamadas arbitrarias ni imports de otros archivos.
Diagnósticos `{code,path,severity,message,details}` incluyen línea/columna para
expresiones dinámicas. AST usa Acorn 8.16.0 y ECMAScript 2022.

ZIP: STORE/DEFLATE, disco único, paths canónicos, sin cifrado/ZIP64/symlinks;
directorio central original, headers locales, descriptors, CRC y tamaños
reales comprobados antes de devolver metadata. Máximos: 25 MiB comprimidos,
100 MiB expandidos, 2000 entradas, 5 MiB por entrada, ratio 100 por entrada
desde 1 MiB, profundidad 64 y 100000 tokens/nodos por declaración. La política
del Hub añade namespace `custom.*`; el contrato compartido no reclama ownership
de publicador ni consulta módulos instalados.

Una definición embebida se recompila con `compileModule` y se compara con
fuentes canónicas (EOL normalizado, documentación editable excluida). Diferencias
son errores; JSON embebido no prueba equivalencia. Las extensiones React siguen
siendo código no certificado aunque coincidan con la definición. Manifests
manuales no necesitan `.module-definition.json`.

`valid` representa evidencia estática, sin ejecución de modelos/vistas/API/SQL.
Servicios/eventos/conexiones se contrastan con capacidades conocidas. El
runtime describe el ERP; `previewAvailable:false` evita prometer un Playground.
`consumes`/`events` manuales siguen admitidos, pero ModuleDefinition v1 devuelve
`BUILDER_INTEGRATION_UNSUPPORTED`: el compiler no los preserva. Defaults legacy
se conservan mediante los mismos declaradores, sin cambiarlos.

El reader síncrono debe correr en un proceso supervisado para tiempo/heap, y
en contenedor con límites/red/secretos adecuados antes de uploads públicos.
No sustituye todavía discovery/staging del ERP. El firmador usa este reader
antes de leer claves y conserva el payload v1; rechaza declaraciones dinámicas.

Paquetes internos `UNLICENSED`; compiler `private:true` conservado. `pnpm pack`
incluye snapshots de docs/runtime y reescribe dependencias workspace; la
distribución externa requiere licencia, registro y nuevas versiones inmutables.
No publicar automáticamente. Documentación del parser:
[Acorn](https://github.com/acornjs/acorn/blob/master/acorn/README.md),
[límites de descompresión Node](https://nodejs.org/api/zlib.html).
