# Runly - identificadores nativos (Tauri/Cargo/Android)

Date: 2026-09-13
Spec: `docs/superpowers/specs/2026-09-13-runly-native-identifiers-design.md`
Status: Tasks 1, 2, 3, 4 complete. `cargo check` verified green (Rust toolchain was available in this environment). Android side is a verified textual change only — no Android SDK/Gradle build was run, per explicit scope.
Mode: IMPLEMENTATION
Authorization: usuario eligió el alcance máximo el 2026-09-13, incluyendo cambiar los identificadores nativos ya porque no hay continuidad de datos que proteger.

## Goal

`tauri.conf.json identifier`, paquetes Cargo y `applicationId`/`namespace` de Android pasan de Atlas a Runly.

## Architecture summary

Cambios textuales directos en archivos de configuración nativa, seguidos de una compilación de verificación (`cargo check`) para detectar cualquier referencia cruzada de nombre de paquete olvidada.

## File Structure Map

Modify:

- `apps/desktop/src-tauri/tauri.conf.json:5` (`identifier`)
- `apps/desktop/src-tauri/Cargo.toml:2,9` (nombres de paquete `atlas_erp`/`atlas_erp_lib`)
- `apps/desktop/src-tauri/src/lib.rs` y cualquier archivo Rust con `use atlas_erp_lib::` o `extern crate atlas_erp_lib`
- `apps/desktop/src-tauri/src/mobile_host.rs` (si referencia el nombre de paquete)
- `apps/desktop/src-tauri/gen/android/app/build.gradle.kts:25,28` (`namespace`, `applicationId`)
- `apps/desktop/src-tauri/gen/android/app/src/main/java/com/racoondevs/atlaserp/ScreenSharePlugin.kt` (declaración `package` y ruta de carpeta si Gradle exige que coincidan; mover el archivo a `com/racoondevs/runlyerp/` si aplica)
- `apps/desktop/src-tauri/Info.plist` (si declara `CFBundleIdentifier` equivalente)

## Task 1 - Tauri e identificador raíz

- [x] Cambiar `identifier` en `tauri.conf.json` a `com.racoondevs.runlyerp`. Verified 2026-09-13 (editado, JSON re-parseado con `node -e "JSON.parse(...)"` sin error).
- [x] Revisar `Info.plist` por un `CFBundleIdentifier` equivalente y actualizarlo si existe. Verified 2026-09-13 (`Info.plist` solo declara `NSCameraUsageDescription`/`NSMicrophoneUsageDescription`; no hay clave `CFBundleIdentifier` — nada que cambiar en este archivo).

Validation: `tauri.conf.json` parsea como JSON válido; grep de `com.racoondevs.atlaserp` en el árbol `src-tauri` tras el cambio para confirmar que no queden referencias huérfanas fuera de las ya planeadas en Task 2/3.

## Task 2 - Cargo

- [x] Renombrar los paquetes `atlas_erp`→`runly_erp` y `atlas_erp_lib`→`runly_erp_lib` en `Cargo.toml`. Verified 2026-09-13.
- [x] Actualizar cada `use`/`extern crate` que referencie el nombre viejo en `lib.rs`/`mobile_host.rs`/otros archivos Rust. Verified 2026-09-13 — el único uso real era `src/main.rs` (`atlas_erp_lib::run()` → `runly_erp_lib::run()`) y `src/mobile_media.rs` (string literal de package Android pasado a `register_android_plugin`, ver Task 3). `lib.rs` y `mobile_host.rs` no contenían ninguna referencia al nombre del paquete Cargo (confirmado por grep dirigido); `mobile_host.rs` solo contiene constantes de branding/dominio (`ATLAS_NATIVE_ORIGIN`, `atlas.example.com`, deep-link scheme `atlas://`) que están fuera del alcance de este incremento (no son identificadores nativos de empaquetado) y no se tocaron.

Validation: `cargo check` dentro de `apps/desktop/src-tauri` — **ejecutado y verde**. Rust toolchain SÍ estaba disponible en este entorno (`cargo 1.95.0`, `rustc 1.95.0`, en `~/.cargo/bin`). Salida: `Compiling runly_erp v0.2.0 (...)` → `Finished \`dev\` profile [unoptimized + debuginfo] target(s) in 11.35s`, sin errores ni warnings de nombre de paquete no encontrado. `Cargo.lock` se actualizó automáticamente (solo renombra la entrada `atlas_erp`→`runly_erp`, mismas dependencias y versiones — diff revisado línea por línea).

## Task 3 - Android

- [x] Cambiar `namespace`/`applicationId` en `build.gradle.kts` a `com.racoondevs.runlyerp`. Verified 2026-09-13 (revisión textual).
- [x] Mover `ScreenSharePlugin.kt` a la carpeta de paquete `com/racoondevs/runlyerp/` y actualizar su declaración `package`. Verified 2026-09-13 (revisión textual, `git mv` + edición de la línea `package`).
- [x] (Extensión de alcance, ver Evidence) `MainActivity.kt` y `HostNotifications.kt` — los otros dos archivos Kotlin **trackeados en git** bajo el mismo directorio `com/racoondevs/atlaserp/` — también se movieron y su declaración `package` se actualizó, porque quedaban en el mismo caso que `ScreenSharePlugin.kt` y dejarlos atrás rompía la resolución de `.MainActivity` en `AndroidManifest.xml` contra el nuevo `namespace`. Ver sección Evidence para el razonamiento completo y por qué esto no era una elección opcional.
- [x] `proguard-rules.pro` (dos reglas `-keep class com.racoondevs.atlaserp.ScreenSharePlugin/ScreenShareArgs`) actualizado a `com.racoondevs.runlyerp` — no estaba en el File Structure Map original pero es consecuencia directa del `git mv` de `ScreenSharePlugin.kt`; dejarlo desactualizado habría sido un fallo silencioso de ProGuard en builds de release (la clase se habría eliminado por ofuscación al no encontrar el keep-rule).

Validation: revisión textual completa (ver Evidence); no se ejecutó ningún build de Android/Gradle en este entorno (no hay Android SDK) — confirmado como limitación esperada, no como omisión.

## Task 4 - Verificación y registro

- [x] Ejecutar la compilación disponible (`cargo check` como mínimo). Done — ver Task 2, verde.
- [x] Registrar qué se pudo verificar realmente (toolchain disponible o no) y qué queda pendiente para un entorno con Rust/Android SDK, en este plan. Done — ver Evidence. (No se tocó `docs/TASKS.md`: esta etapa es un sub-incremento de rebranding nativo dentro de un esfuerzo de renombrado Atlas→Runly más amplio que ya está en curso en el repo — el checkbox correspondiente en `docs/TASKS.md`, si existe, debe marcarlo quien integre el conjunto completo de incrementos paralelos, para evitar una condición de carrera de edición contra los otros agentes trabajando en el mismo archivo en paralelo.)

## Rollback Notes

Revertir el diff de esta etapa restaura los identificadores de Atlas. Sin build nativo publicado, no hay usuarios afectados por el rollback.

## Evidence

Entorno: Windows 11, `cargo 1.95.0`/`rustc 1.95.0` disponibles en `~/.cargo/bin` (SÍ había toolchain Rust). No hay Android SDK/Gradle wrapper invocable en este entorno — no se intentó ningún build de Android, según instrucción explícita.

### Cambios de texto (Tasks 1-3)

- `apps/desktop/src-tauri/tauri.conf.json:5` — `identifier`: `com.racoondevs.atlaserp` → `com.racoondevs.runlyerp`. Re-parseado con `node -e "JSON.parse(...)"` sin error.
- `apps/desktop/src-tauri/Info.plist` — revisado completo (9 líneas): solo `NSCameraUsageDescription`/`NSMicrophoneUsageDescription`, ya en español/Runly de un incremento previo. Sin `CFBundleIdentifier`. Nada que cambiar.
- `apps/desktop/src-tauri/Cargo.toml` — `name = "atlas_erp"` → `"runly_erp"` (paquete binario); `[lib] name = "atlas_erp_lib"` → `"runly_erp_lib"`.
- `apps/desktop/src-tauri/src/main.rs` — `atlas_erp_lib::run()` → `runly_erp_lib::run()` (única referencia cruzada de nombre de paquete Cargo en todo el árbol `src/`, confirmado por grep dirigido a `atlas_erp` sobre `src-tauri/src/*.rs`).
- `apps/desktop/src-tauri/src/lib.rs` — grep dirigido: cero coincidencias de `atlas_erp`/`atlaserp`. No requería cambios (el crate no se referencia a sí mismo por nombre; usa `mod`/`crate::`).
- `apps/desktop/src-tauri/src/mobile_host.rs` — grep dirigido: cero coincidencias de `atlas_erp`/`atlaserp`. Contiene `ATLAS_NATIVE_ORIGIN`/`ATLAS_NATIVE_VERSION` (nombres de env var) y el dominio `atlas.example.com` — son branding/negocio, no identificadores de empaquetado nativo, fuera del alcance de este plan; no se tocaron.
- `apps/desktop/src-tauri/src/mobile_media.rs` — el string literal pasado a `register_android_plugin("com.racoondevs.atlaserp", "ScreenSharePlugin")` → `"com.racoondevs.runlyerp"`. Este era el único otro archivo `.rs` con la referencia de package Android hardcodeada (encontrado por el grep de barrido completo de Task 1, no estaba en la lista original de `mobile_host.rs`/`lib.rs` del File Structure Map, pero cae directamente en "cualquier otro archivo Rust en `src-tauri/src/`" de las instrucciones).
- `apps/desktop/src-tauri/gen/android/app/build.gradle.kts:25,28` — `namespace` y `applicationId` `com.racoondevs.atlaserp` → `com.racoondevs.runlyerp`.

### Extensión de alcance en Android (justificación)

El File Structure Map del plan solo nombraba `ScreenSharePlugin.kt`. Al inspeccionar el directorio `gen/android/app/src/main/java/com/racoondevs/atlaserp/` se encontró que contiene **tres** archivos `.kt` trackeados en git (no generados, no gitignored): `MainActivity.kt`, `HostNotifications.kt`, `ScreenSharePlugin.kt` — los tres con `package com.racoondevs.atlaserp`. Un cuarto subdirectorio, `generated/`, sí está gitignored (`gen/android/app/.gitignore:1: /src/main/**/generated`) y contiene código que Tauri regenera automáticamente en cada build Android (Ipc.kt, TauriActivity.kt, etc.) — ese no se tocó, se regenerará solo bajo el nuevo namespace.

`AndroidManifest.xml` declara `android:name=".MainActivity"` (ruta relativa) y **no tiene** atributo `package` (estilo AGP moderno) — esa referencia relativa se resuelve contra `namespace` en `build.gradle.kts`. Si solo se movía `ScreenSharePlugin.kt` y `namespace` pasaba a `runlyerp` mientras `MainActivity.kt`/`HostNotifications.kt` seguían declarando `package com.racoondevs.atlaserp`, el manifest merger de un build real de Android fallaría al no poder resolver `com.racoondevs.runlyerp.MainActivity` (la clase física seguiría en el paquete viejo). Esto no era una mejora opcional sino necesario para que la Task 3 cumpliera su propio criterio de aceptación ("Android namespace/applicationId reflejan Runly"; un cambio parcial habría dejado el módulo Android en un estado roto conocido, no solo "sin build todavía verificado").

Por eso se movieron los tres archivos con `git mv` a `gen/android/app/src/main/java/com/racoondevs/runlyerp/` y se actualizó su línea `package` a `com.racoondevs.runlyerp`. Esto se mantiene dentro del alcance autorizado (identificadores nativos Android), no toca nada de backend/frontend/branding/CSS.

Como consecuencia directa de mover `ScreenSharePlugin.kt`, también se actualizó `gen/android/app/proguard-rules.pro` (dos reglas `-keep class com.racoondevs.atlaserp.ScreenSharePlugin/ScreenShareArgs` → `com.racoondevs.runlyerp....`), ya que de lo contrario un build de release con minify habría eliminado esa clase silenciosamente (Tauri la carga por reflexión — comentario ya presente en el propio archivo).

### Cosas encontradas pero deliberadamente NO tocadas (fuera de alcance)

- `gen/android/app/google-services.json` — contiene `"package_name": "com.racoondevs.atlaserp"`. Archivo gitignored (`**/google-services.json`), config de Firebase suministrada por el desarrollador/entorno, no versionada. No se tocó; si se usa push notifications de Firebase en Android, este archivo deberá regenerarse desde la consola de Firebase con el nuevo `applicationId` en un incremento aparte.
- `gen/android/app/proguard-tauri.pro` — contiene `-keep class com.racoondevs.atlaserp.TauriActivity`. Encabezado explícito: "THIS IS AN AUTOGENERATED FILE. DO NOT EDIT THIS FILE DIRECTLY." Gitignored (`gen/android/app/.gitignore:5`). Se regenerará solo en el próximo build Android bajo el nuevo namespace.
- `gen/android/app/src/main/res/values/themes.xml`, `values-night/themes.xml`, y la referencia `android:theme="@style/Theme.atlas_erp"` en `AndroidManifest.xml` — nombre de recurso de estilo Android (`Theme.atlas_erp`), no un identificador de empaquetado/store. Definición y uso siguen siendo consistentes entre sí (ambos dicen `atlas_erp`), así que no hay build roto por dejarlo así. Es cosmético/de branding interno de recursos, fuera del alcance explícito de este plan (identificador Tauri/Cargo/Android applicationId-namespace) y de la instrucción de no tocar archivos de branding. Se deja registrado aquí por transparencia, sin cambiarlo.
- `docs/TASKS.md` — no editado. Este incremento es uno de varios sub-incrementos paralelos del rebranding Atlas→Runly (el `git status` inicial ya mostraba decenas de archivos modificados en el repo por ese esfuerzo mayor); evitar tocar `TASKS.md` aquí previene una condición de carrera de edición con los otros agentes trabajando en paralelo, según instrucción explícita de no tocar catálogos/manifiestos/archivos compartidos fuera del alcance asignado.

### Verificación ejecutada

- `cargo check` dentro de `apps/desktop/src-tauri` → **verde**: `Compiling runly_erp v0.2.0 (D:\path\to\runly\apps\desktop\src-tauri)` seguido de `Finished \`dev\` profile [unoptimized + debuginfo] target(s) in 11.35s`. Cero errores, cero warnings de nombre de paquete no resuelto. Esto compila el crate completo para el target desktop de Windows (no cross-compila a Android/iOS en este entorno, así que los bloques `#[cfg(target_os = "android")]`/`#[cfg(mobile)]` de `lib.rs`/`mobile_media.rs` no pasaron por el compilador en esta corrida — se revisaron manualmente en su lugar, ver arriba).
- `Cargo.lock` se regeneró automáticamente por `cargo check`; diff revisado línea por línea (`git diff apps/desktop/src-tauri/Cargo.lock`): solo renombra la entrada del paquete `atlas_erp`→`runly_erp` con las mismas dependencias y versiones exactas — ningún bump de versión de dependencia como efecto secundario.
- `node -e "JSON.parse(...)"` sobre `tauri.conf.json` → válido.
- Grep de barrido final (`atlas_erp|atlaserp`) sobre todo `src-tauri/` excluyendo `target/` (cache de build, gitignored) y `gen/android/app/build/` (salida de build Android, gitignored) y `generated/` (autogenerado): sin coincidencias fuera de las tres ya documentadas como deliberadamente no tocadas arriba (`google-services.json`, `proguard-tauri.pro`, `themes.xml`/manifest theme resource).
- Build de Android/Gradle: **no ejecutado** — no hay Android SDK en este entorno; instrucción explícita de no intentarlo. Queda pendiente para quien tenga el SDK: correr `pnpm tauri android build` (o al menos `./gradlew assembleDebug` dentro de `gen/android`) — se recomienda primero limpiar `gen/android/app/build/` y el `generated/` viejo bajo `com/racoondevs/atlaserp/` para evitar cualquier clase duplicada/obsoleta del namespace anterior antes de compilar.
- Build de iOS: no aplica (no hay proyecto iOS generado en este repo todavía, solo `Info.plist` de plantilla) — nada más que verificar ahí.

### Addendum — esquema de deep-link y canales nativos restantes (2026-09-13, continuación de sesión)

Al retomar "Stage 5: native identities, deep links and offline storage migration" de `docs/TASKS.md` se encontró que la parte de **deep links** seguía sin tocar: el esquema de URL personalizado `atlas://` (usado para abrir `chat`/`call` desde una notificación) y dos canales de notificación nativos adicionales que el incremento de rename de carpetas (sesión anterior) no cubrió porque viven fuera de `apps/desktop/src/native/notification-policy.js`.

Cambios:

- **Fuente canónica del esquema**: `apps/desktop/scripts/native-host.mjs:51` — `plugins['deep-link'].mobile[0].scheme` de `['atlas']` a `['runly']`. Este es el único lugar donde el esquema se declara para el plugin `tauri-plugin-deep-link`; todo lo demás lo deriva de aquí en cada build/dev nativo.
- `apps/desktop/src/native/policy.js` — `parseDeepLink()` ahora exige `url.protocol === 'runly:'` (antes `'atlas:'`); su propio round-trip interno en `createEventPump` reconstruye `runly://${kind}/${targetId}` para validar antes de entregar el evento al handler.
- `apps/desktop/src-tauri/src/mobile_host.rs` — `parse_deep_link()` exige `url.scheme() == "runly"` (antes `"atlas"`). Las líneas 17 y 317-330 de este mismo archivo (`https://atlas.example.com`, el origen HTTPS de respaldo/Universal-Links) **no se tocaron a propósito**: es un dominio real, decisión de Stage 6 (`runly.mx`, aún no ejecutada), no un identificador de paquete.
- Pruebas actualizadas para que seguir siendo pruebas del comportamiento nuevo, no solo pasar por casualidad: `apps/desktop/src/native/__tests__/native-host.test.js` (caso positivo `runly://chat/...` + todos los casos negativos que antes usaban `atlas://` para probar rechazo de tokens/redirects/formato — se mantuvo sin cambiar el único caso que prueba rechazo por *protocolo* HTTPS, `https://atlas.example.com/app/`, porque ese caso es sobre el dominio, no el esquema) y la función `events_survive_reads_and_deduplicate` en `mobile_host.rs`.
- **Bug real encontrado y corregido** (no solo un rename cosmético): `apps/desktop/src-tauri/gen/android/app/src/main/java/com/racoondevs/runlyerp/HostNotifications.kt:17` seguía validando `channel !in listOf("atlas-calls-v1", "atlas-alerts-v1")` — pero el lado JS (`notification-policy.js`, ya corregido en la sesión de rename de carpetas) emite `channelId: 'runly-calls-v1'`/`'runly-alerts-v1'` desde ese mismo incremento. Sin esta corrección, **toda notificación nativa real habría sido rechazada como `INVALID_NOTIFICATION`** en Android — un caso claro de un rename hecho en un lado (JS) sin propagarse al consumidor nativo correspondiente. Se corrigió el allowlist y también la línea 29 (`Uri.parse("atlas://$kind/$targetId")` → `"runly://$kind/$targetId"`, coherente con el esquema nuevo).
- `apps/desktop/src-tauri/gen/android/app/src/main/java/com/racoondevs/runlyerp/ScreenSharePlugin.kt` — canal `"atlas-screen-v1"` (usado para la notificación persistente de "compartiendo pantalla", un cuarto canal que tampoco estaba en el barrido original de canales calls/alerts) → `"runly-screen-v1"` (2 ocurrencias: `createNotificationChannel` y `NotificationCompat.Builder`).
- `apps/desktop/src-tauri/src/mobile_media.rs` — `Builder::new("atlas-media")` → `"runly-media"` (nombre interno del plugin Tauri registrado vía `register_android_plugin`; verificado por grep que ningún código JS lo invoca por ese string literal, así que renombrarlo en un solo lado es seguro).
- `apps/desktop/src-tauri/gen/android/app/src/main/AndroidManifest.xml` — el bloque `<!-- DEEP LINK PLUGIN. AUTO-GENERATED. DO NOT REMOVE. -->` todavía tenía `<data android:scheme="atlas" />` de una generación anterior (este archivo SÍ está trackeado en git, a diferencia de `generated/`). Se parcheó manualmente a `"runly"` como medida provisional consistente con la fuente ya corregida; se regenerará automáticamente (y de forma autoritativa) en el próximo build/init nativo de Android con el SDK real.

Deliberadamente no tocado (ya documentado como deuda conocida más arriba, sin cambios nuevos): `gen/android/app/src/main/java/com/racoondevs/atlaserp/generated/*.kt` (incluye `Rust.kt:18: System.loadLibrary("atlas_erp_lib")` — carpeta gitignored, "DO NOT EDIT", se regenera sola en el próximo build Android bajo el nombre de librería Cargo ya corregido `runly_erp_lib`).

**Migración de almacenamiento offline** (la otra mitad de "Stage 5") sigue sin empezar: no se auditó en este addendum. El paquete `@runly/offline` (caché Dexie/IndexedDB para queries persistidas, y el modo SQLite de `atlas.ledger` en Tauri) puede tener claves/nombres de base de datos con "atlas" en el navegador/dispositivo del usuario; queda como incremento separado.

Verificación de este addendum: `node --test apps/desktop/src/native/__tests__/native-host.test.js` → 9/9 passing. `cargo test` (paquete completo) → 3/3 passing, incluye `events_survive_reads_and_deduplicate`. `cargo check` y `cargo fmt --check` → limpios. `pnpm exec eslint` sobre los 3 archivos JS tocados → limpio. `pnpm --filter @runly/desktop build:web` → pasa. `pnpm lint` (repo completo) → limpio. No se ejecutó ningún build de Android/Gradle (sigue sin SDK disponible en este entorno).

### Estado final resumido

Verificado con evidencia real: JSON válido, `cargo check` verde, diffs de texto revisados uno por uno. Pendiente de verificación por falta de entorno (no por omisión): build real de Android vía Gradle/SDK, y build/empaquetado real de iOS. Ningún build nativo firmado se publicó ni se subió a ninguna store, consistente con los non-goals del spec.
