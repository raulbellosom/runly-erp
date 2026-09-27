# @runly/module-compiler

Compilador puro de definiciones declarativas `ModuleDefinition` v1 a paquetes
RME3. No usa prompts, HTTP, base de datos ni filesystem.

```js
import { compileModule, normalizeModuleDefinition, validateModuleDefinition } from '@runly/module-compiler'

const normalized = normalizeModuleDefinition(definition)
const diagnostics = validateModuleDefinition(normalized)
const compiled = compileModule(definition)
```

`compiled.files` contiene `{ path, content }` en orden léxico y
`compiled.packageHash` identifica exactamente ese contenido. La escritura a
disco pertenece al adapter CLI, no a este package.

Véase [la referencia completa](../../docs/ai-context/rme3-module-compiler.md).
