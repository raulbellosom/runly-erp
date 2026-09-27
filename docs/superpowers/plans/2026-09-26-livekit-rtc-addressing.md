# Dirección RTC de LiveKit — Implementation Plan

Date: 2026-09-26
Spec: docs/superpowers/specs/2026-09-26-livekit-rtc-addressing-design.md
Status: In Progress

Spec y plan aprobados por el usuario el 2026-09-26. Modo: IMPLEMENTATION.
Marcar cada tarea como `in_progress` antes de trabajarla.

## Goal

Permitir que cualquier instalación configure la IP anunciada por su LiveKit
integrado, conservando descubrimiento automático por defecto, credenciales y
URLs existentes. El contrato no contiene direcciones reales ni casos por cliente.

## Architecture summary

Extender `livekit-config.mjs`, reutilizado por los dos instaladores, con una
normalización común de `nodeIp`. Los scripts seleccionan la fuente del valor y
lo persisten; el resolver valida y el renderer genera el YAML. No hay cambios
de Compose, API, frontend, modelos, módulos ni versión de LiveKit.

La clave presente en el archivo gana incluso vacía. Solo una clave ausente
utiliza el fallback del proceso. Este contrato se aplica exclusivamente a la
nueva variable y permite revertir a automático sin valores residuales.

## File Structure Map

### Create

- `infra/installer/__tests__/livekit-node-ip-env.test.js` — pruebas de los flujos
  reales de entorno con filesystem temporal y dependencias externas simuladas.
- `docs/superpowers/specs/2026-09-26-livekit-rtc-addressing-design.md` — diseño.
- `docs/superpowers/plans/2026-09-26-livekit-rtc-addressing.md` — este plan y evidencia.

### Modify

- `infra/installer/lib/livekit-config.mjs` — normalización, validación y YAML.
- `infra/installer/setup-local.mjs` — lectura/persistencia de la clave.
- `infra/installer/setup-external.mjs` — lectura/persistencia de la clave.
- `infra/installer/__tests__/livekit-installer.test.js` — matriz de configuración.
- `infra/installer/.env.local.example` — variable vacía y explicación.
- `infra/installer/.env.external.example` — variable vacía y explicación.
- `infra/installer/README.md` — contrato y alcance de la comprobación RTC.
- `docs/TASKS.md` — seguimiento y resultados reales de implementación.

No modificar archivos de entorno reales ni el YAML generado de la instalación.
Preservar los cambios ajenos del workspace, incluido el ajuste previo de URL API
en `setup-local.mjs`. Mantener nuevo comportamiento en la biblioteca: los scripts
ya están cerca o por encima del umbral de 1000 líneas; ninguno debe llegar a 1500.

## Task 1 — Política común y generación de YAML

Status: completed. Pruebas de LiveKit y `node --check` correctos el 2026-09-26.

**Files:** biblioteca de configuración y pruebas existentes de LiveKit.

- [x] Añadir normalizador compartido que recorte espacios, acepte vacío o una IP
  literal, use `net.isIP`, rechace `%` y produzca `LIVEKIT_NODE_IP_INVALID`.
- [x] Resolver `values.nodeIp` antes del retorno de modo desactivado; devolver
  `nodeIp` normalizado en todos los modos.
- [x] Normalizar también en el renderer. Vacío conserva el YAML automático
  exactamente; valor válido genera `use_external_ip: false` y `node_ip`
  serializado como cadena con `JSON.stringify`.
- [x] Cubrir IPv4 de documentación, IPv6 de documentación, entrada privada
  sintética, espacios, vacío, omisión y formas inválidas, incluidas zonas IPv6.
- [x] Cubrir Linux/Desktop, deployment local/external y TLS managed/external.
  Probar que los overrides de puertos siguen la política previa por plataforma.
- [x] Comparar YAML completo de ambas ramas, y mantener los campos y valores
  ajenos a RTC, incluidos credenciales literales, Redis y tiempos de sala.
- [x] Cubrir modo LiveKit external/disabled y rechazo de valor inválido en ambos.

**Validation:**

```bash
node --test infra/installer/__tests__/livekit-installer.test.js
node --check infra/installer/lib/livekit-config.mjs
```

Resultado requerido: salida 0; el YAML automático no cambia y no aparecen campos
no soportados como `skip_external_ip_validation`, `require_ipv4` o
`advertise_internal_ip`.

## Task 2 — Integración y persistencia en los dos instaladores

Status: completed. 32/32 pruebas de entorno y sintaxis de ambos scripts correctas.

**Files:** ambos scripts y `livekit-node-ip-env.test.js` nuevo.

- [x] En `writeLocalEnv`, leer mediante `parseEnvValue(existingEnvContent,
  "LIVEKIT_NODE_IP") ?? process.env.LIVEKIT_NODE_IP ?? ""`; pasar `nodeIp`
  al resolver y persistir `liveKit.nodeIp` junto a las demás variables LiveKit.
- [x] En `configureLiveKit`, usar la misma precedencia sobre su contenido env y
  persistir `config.nodeIp` con la actualización de claves existente.
- [x] La ampliación del entorno externo se realiza al persistir configuración
  validada en `configureLiveKit`. No insertar antes una clave vacía mediante
  `OPTIONAL_VAR_GROUPS`: ocultaría el fallback del proceso en instalaciones antiguas.
- [x] Confirmar que `writeLiveKitArtifacts` recibe `nodeIp` por el spread de
  configuración existente y conserva la exclusión de modos no integrados.
- [x] Construir un harness aislado que evalúe las funciones reales necesarias de
  cada script con `node:vm`, sin imports ni ejecución de `main`. Inyectar filesystem
  temporal, entorno controlado y funciones auxiliares/dependencias. No copiar
  la lógica de selección/persistencia en la prueba ni lanzar Docker.
- [x] Ejecutar escritura y lectura de ambos flujos dos veces con las mismas
  credenciales; comprobar IP, credenciales y YAML recibido por el escritor simulado.
- [x] Probar archivo con IP y proceso distinto; archivo vacío y proceso con IP;
  clave ausente con proceso definido; ambos ausentes; y valor env entre comillas.
- [x] Probar la secuencia externa de ampliación de variables opcionales seguida
  de configuración, para detectar que un placeholder suprima el fallback.
- [x] Probar que error de IP impide escritura de artefactos LiveKit, y que
  external/disabled no producen YAML local ni pierden la opción persistida.

**Validation:**

```bash
node --test infra/installer/__tests__/livekit-installer.test.js infra/installer/__tests__/livekit-node-ip-env.test.js
node --check infra/installer/setup-local.mjs
node --check infra/installer/setup-external.mjs
```

Resultado requerido: salida 0 y ninguna operación sobre archivos/env del usuario,
contenedores, red o base de datos. Las pruebas deben ejercitar las funciones de
escritura; repetir únicamente el resolver no satisface esta tarea.

## Task 3 — Documentar el contrato de despliegue

Status: implemented. Pruebas y diff correctos; privacidad global pendiente por dos hallazgos preexistentes.

**Files:** ambos ejemplos env y README del instalador.

- [x] Añadir `LIVEKIT_NODE_IP=` con comentario: vacío = automático; IP literal
  = explícito; efecto únicamente sobre LiveKit integrado.
- [x] Explicar precedencia, actualización del valor y retorno a automático.
- [x] Incluir ejemplo opcional `203.0.113.10` y separar IP RTC de URLs internas,
  dominio, TLS y DNS. No inferir dirección RTC a partir del proxy.
- [x] Describir port forwarding y firewall sobre los puertos efectivos, límites
  de LAN sin hairpin/CGNAT, IP dinámica y ausencia de actualización por DDNS.
- [x] Aclarar que Desktop mantiene puertos internos y que una traducción de
  puertos incompatible no se corrige cambiando solo la IP.
- [x] Distinguir health/control de una prueba de audio/video y documentar
  comprobación manual del par ICE y medios en cada red cliente requerida.

**Validation:**

```bash
node --test infra/installer/__tests__/livekit-installer.test.js
pnpm check:privacy
git diff --check
```

Resultado requerido: ejemplos cubiertos por pruebas, privacidad sin hallazgos
nuevos y revisión manual contra spec §§8, 20, 23 y 25.

## Task 4 — Verificación final y registro de evidencia

Status: local verification complete; global privacy gate pending on unrelated findings.

**Files:** TASKS, spec y este plan.

- [x] Ejecutar las validaciones anteriores sobre el cambio final. No repetir
  pruebas ya vigentes si no hubo cambios posteriores relevantes.
- [x] Revisar el diff propio y confirmar que no contiene configuración real.
- [x] Completar abajo la checklist aplicable de
  `docs/superpowers/templates/verification-checklist-template.md` con resultados.
- [x] Añadir entrada de TASKS: implementación y pruebas locales separadas de
  aceptación operativa. Registrar `Verified: YYYY-MM-DD (comandos y resultados)`.
- [x] Mantener pendiente la llamada real si no se ejecutó. No presentar logs,
  creación de salas o snapshots como evidencia de conectividad de medios.

**Validation:**

```bash
node --test infra/installer/__tests__/livekit-installer.test.js infra/installer/__tests__/livekit-node-ip-env.test.js
pnpm check:privacy
git diff --check
```

## Rollback Notes

Vaciar la clave en el archivo env devuelve la política automática tras regenerar
y reiniciar en una ventana operativa. Revertir únicamente los cambios propios de
código si hace falta. Sin migraciones ni rollback de datos de negocio.

## Verification Gate

- [x] Validaciones de implementación ejecutadas y resultados registrados.
- [x] Resolución/renderizado cubiertos en ambas plataformas y ambos modos TLS.
- [x] Persistencia, precedencia y vaciado comprobados con archivos temporales.
- [x] Revisión de privacidad y diff realizada sobre el resultado final.
- [x] TASKS actualizado con evidencia sin marcar aceptación operativa inexistente.
- [x] Prueba real de medios documentada o explícitamente pendiente.
- [ ] Comprobación global de privacidad sin hallazgos: pendiente por documentos ajenos.
- [ ] Aceptación operativa con llamada real entre redes: no ejecutada.

Build UI, migraciones, seed, endpoints y pruebas RBAC de la plantilla: N/A,
porque no cambian esas capas. No es necesario desplegar para validar el contrato.

## Evidence — Discovery only

2026-09-26: `node --test infra/installer/__tests__/livekit-installer.test.js`
terminó con salida 0: 22 pruebas correctas, 0 fallidas. Es el baseline previo a
implementar; no verifica la opción propuesta. No hubo despliegue ni llamada real.

Revisión documental: `git diff --check` terminó con salida 0.
`pnpm check:privacy` terminó con salida 1 tras revisar 3118 archivos: reportó dos
hallazgos en documentos ajenos a este cambio, ninguno en esta spec o plan:
`2026-09-23-ledger-ui-redesign-design.md:22` (ruta de estación personal) y
`2026-09-26-help-tips-footer-phase4-design.md:105` (dominio privado), ambos bajo
`docs/superpowers/specs/`. No se reproducen los valores detectados.

## Evidence — Implementation and local verification

Verified: 2026-09-26.

- `node --test --test-reporter=spec infra/installer/__tests__/livekit-installer.test.js infra/installer/__tests__/livekit-node-ip-env.test.js`: salida 0, **66/66**, 5 suites, 0 fallidas y 0 omitidas. Incluye 34 pruebas de contrato y 32 de entorno.
- `node --check` sobre `livekit-config.mjs`, `setup-local.mjs` y `setup-external.mjs`: salida 0.
- `pnpm exec eslint` sobre biblioteca, ambos instaladores y ambos archivos de pruebas: salida 0, sin diagnósticos.
- `git diff --check`: salida 0.
- `pnpm check:privacy`: salida 1; 3119 archivos revisados, los mismos dos hallazgos previos enumerados arriba. No hay hallazgos en los archivos de esta funcionalidad; el control global sigue pendiente.
- Revisión final con `inspectFile` del comprobador de privacidad sobre los 11 archivos de la funcionalidad: salida 0, ningún hallazgo.

El harness usa las funciones reales de lectura, escritura y generación de
artefactos de ambos scripts, evaluadas con `node:vm`; escribe los archivos env y
YAML en directorios temporales verificados antes de eliminarlos. Aísla los
servicios ajenos a LiveKit, el entorno del proceso y `main`; no inicia Docker,
no hace peticiones ni toca entornos de instalación. Comprueba dos pases de
persistencia, clave ausente/vacía/con valor, comillas, cambio de modo y rechazo
de una entrada inválida conservando YAML y credenciales anteriores.

La lógica nueva permanece en la biblioteca compartida. Ambos scripts solo
añaden lectura y persistencia; `writeLiveKitArtifacts` ya pasa la configuración
al renderer. El ajuste previo de URL API en el script local se conserva.

Implementación y verificación local terminadas. No se modificó ninguna
instalación real, no se desplegó y no se realizó una llamada de aceptación.
El estado global permanece `In Progress` por las dos verificaciones pendientes
indicadas arriba; no falta código de esta funcionalidad.
