# Android runtime server connection — diseño

Fecha: 2026-09-22
Estado: aprobado por el usuario, pendiente de plan de implementación

## Contexto

El shell nativo Android (`apps/desktop/src-tauri/`, documentado en `docs/mobile/RUNLY_NATIVE_HOST.md`) fija el origen del servidor Runly **en tiempo de compilación**: una constante Rust `ORIGIN` (`apps/desktop/src-tauri/src/mobile_host.rs`) leída vía `option_env!("ATLAS_NATIVE_ORIGIN")`, más el mismo valor embebido en la capability `native-remote` de Tauri (generada por `apps/desktop/scripts/native-host.mjs`). Esto es explícitamente una propiedad de seguridad documentada: en Android, el WebView privilegiado (con acceso al bridge nativo — notificaciones, haptics, captura de pantalla) no distingue frame principal de iframes, así que cualquier origen que cargue ese WebView obtiene el bridge. Por eso el origen nunca se lee de un formulario, deep link o localStorage hoy — `docs/mobile/RUNLY_NATIVE_HOST.md` línea 63: "Mobile usa configuración web y nunca ofrece elegir servidor."

El build de escritorio (Windows) sí resuelve el servidor en runtime: `apps/desktop/src/app/ServerSetup.jsx` + `apps/desktop/src/lib/serverStore.js` dejan que el usuario escriba la URL de su propia instancia self-hosted después de instalar, validándola contra `/health` y persistiéndola vía `@tauri-apps/plugin-store`. Esto es posible porque el escritorio no usa el modelo de "WebView remoto con capabilities" — carga un build local y hace `fetch()` normal a la URL que sea.

El usuario quiere un **APK universal**: un solo build distribuible (Google Play o descarga directa) que cualquier cliente con su propia instancia Runly self-hosted pueda instalar y luego conectar a su servidor, igual que ya funciona en Windows. Esto sí requiere tocar el modelo de confianza del WebView móvil, con las mitigaciones descritas abajo.

## Alcance

Incluido:
- Un origen de servidor configurable en runtime en Android, persistido localmente, con el mismo preflight de seguridad (HTTPS, sin redirects, CSP `frame-src 'none'; object-src 'none'`) que ya protege el flujo actual de origen fijo.
- Confirmación explícita obligatoria del usuario ("vas a conectar a `<dominio>` — esta app confiará en él") antes de persistir/navegar a un origen nuevo, decisión ya tomada por el usuario (equivalente a "trust this host" de un cliente SSH o Element/Matrix con homeserver personalizado).
- Un modo de build "universal" (sin origen fijo) para el APK de distribución pública, preservando el modo actual de origen fijo por variable de entorno para builds internos de QA (`staging`/`development`).
- Un flujo para cambiar de servidor después de la primera conexión.

Explícitamente fuera de alcance:
- iOS (esta pieza es Android-only; el mismo problema aplicaría a iOS pero no se aborda aquí).
- Cualquier registro/directorio curado de servidores conocidos — es conexión libre a cualquier HTTPS que pase el preflight, igual que Element/Matrix con homeserver personalizado.
- Cambios al modelo de capabilities de Tauri más allá de lo necesario (no se añade filesystem, SQL, shell genérico ni nuevas capacidades — las mismas ya auditadas en `native-remote` se mantienen).
- Persistencia cifrada del origen — es un dominio, no una credencial; mismo criterio que ya se aplicó al token FCM (SharedPreferences simple, no `EncryptedSharedPreferences`).

## Arquitectura

### 1. `HostState` — origen en runtime, no en compilación

En `apps/desktop/src-tauri/src/mobile_host.rs`:

```rust
#[derive(Default)]
pub struct HostState {
    events: Mutex<VecDeque<NativeEvent>>,
    next_id: AtomicU64,
    generation: AtomicU64,
    fallback: Mutex<Option<Url>>,
    origin: Mutex<Option<String>>,
    pending_origin: Mutex<Option<String>>,
}
```

`origin`: el servidor actualmente confiado (persistido). `pending_origin`: un candidato que pasó el preflight pero aún no fue confirmado por el usuario — vive solo en memoria, se descarta si la app se cierra sin confirmar.

Todo lo que hoy lee la constante `ORIGIN` pasa a leer `state.origin.lock().unwrap()`, devolviendo error (`NO_ORIGIN_CONFIGURED`) donde antes asumía un valor siempre presente:
- `allowed_remote(url, origin)` — ya toma `origin` como parámetro (`&str`), no cambia de firma; el llamador ahora le pasa el valor de `HostState` en vez de la constante.
- `check_remote(window)` — necesita acceso a `HostState` (hoy no lo tiene, solo mira `window.url()`); gana un parámetro `state: &HostState`.
- `host_info` — `frontendUrl` se vuelve `Option<String>` (`null` si no hay origen confiado todavía).
- `setup()`'s `on_navigation`/`on_page_load` — leen `state.origin` en vez de la constante `ORIGIN`.

`const ORIGIN: &str = ...` se elimina. La constante `VERSION` no cambia.

### 2. Persistencia del origen (Android)

Mismo patrón que el token FCM (`RunlyMessagingService.kt`'s `SharedPreferences`, ver `docs/superpowers/plans/2026-09-21-fcm-android-push.md` Task 10): un nuevo archivo de preferencias `runly_server` con una clave `origin`, leído/escrito desde Kotlin, expuesto a Rust vía dos comandos nuevos en el plugin `ScreenSharePlugin.kt` (`getOrigin`/`setOrigin`), reenviados desde Rust como `host_connect`/`host_confirm_origin` (ver abajo). Al arrancar la app (`setup()`), Rust lee el origen persistido una vez y lo carga en `HostState.origin` antes de construir la ventana.

No se usa `tauri-plugin-store` para esto: ese plugin hoy solo está registrado para desktop (`#[cfg(desktop)]` en `lib.rs`); añadir persistencia nueva reutiliza el mecanismo SharedPreferences ya construido y probado para FCM en vez de introducir una dependencia nueva en mobile.

### 3. Comandos Rust nuevos/modificados

- `host_connect(origin: Option<String>)` — reemplaza al `host_connect()` actual (sin argumentos):
  - Si `origin` es `None`: usa `state.origin` (el persistido). Si tampoco hay uno persistido, devuelve `NO_ORIGIN_CONFIGURED` (el shell local interpreta esto como "mostrar formulario de conexión").
  - Si `origin` es `Some(candidato)`: valida formato (HTTPS, sin username/password/query/fragment/puerto — misma validación que ya hace `resolveEnvironment` en `native-host.mjs`, portada a Rust para no depender de que el candidato haya pasado por ese script) y corre el preflight ya existente (GET a `${candidato}/app/`, sin redirects, 15s timeout, exige CSP `frame-src 'none'; object-src 'none'`).
    - Si el candidato coincide con `state.origin` (reconexión al mismo servidor tras un fallo transitorio): preflight + navega directo, sin pedir confirmación de nuevo — ya fue confiado antes.
    - Si el candidato es nuevo o distinto al persistido: preflight, y si pasa, lo guarda en `state.pending_origin` (memoria, no persistido aún) y devuelve `{ status: "pending_confirmation", origin: candidato }` al shell local, **sin navegar**.
- `host_confirm_origin()` — nuevo comando, exclusivo del shell local (mismo chequeo `local_shell(&window)` que ya usa `host_connect`): toma `state.pending_origin`, si existe lo persiste (vía el comando Kotlin `setOrigin`), lo mueve a `state.origin`, limpia `pending_origin`, y navega — reutilizando la lógica de navegación que hoy vive al final de `host_connect`.
- `host_forget_origin()` — nuevo comando, exclusivo del shell local: limpia `state.origin` y el valor persistido (llama `setOrigin(null)`), fuerza al usuario de vuelta al flujo de conexión. Es el "cambiar de servidor".

Los comandos ya existentes que dependían de `check_remote`/`ORIGIN` (`host_ready`, `host_events`, `host_ack_events`) ya reciben `state: State<'_, Arc<HostState>>` y no cambian de firma, solo de dónde obtienen el origen esperado. `host_open_external(window, url)` es la excepción: hoy no recibe `state` porque `check_remote` no lo necesitaba; al cambiar `check_remote` a `check_remote(&window, &state)`, `host_open_external` gana el parámetro `state: State<'_, Arc<HostState>>` igual que sus hermanos, y esa nueva firma debe registrarse sin cambios en `lib.rs`'s `generate_handler!` (Tauri resuelve el parámetro `State` por tipo, no por posición, así que añadirlo no rompe la llamada desde JS).

### 4. Shell local (`native-host/shell/`)

`shell.js` cambia de "siempre auto-conecta" a un flujo de tres estados, controlado por el resultado de `host_connect(null)` al cargar:

1. **Sin origen configurado** (`NO_ORIGIN_CONFIGURED`): muestra un formulario con un campo de texto ("URL de tu servidor Runly", ej. `https://runly.tuempresa.com`) y un botón "Conectar". Al enviar, llama `host_connect(url)`.
2. **Pendiente de confirmación** (`pending_confirmation`): el formulario se reemplaza por un mensaje "Vas a conectar a `<dominio>`. Esta app confiará en este servidor y le dará acceso a notificaciones, vibración y captura de pantalla cuando lo uses. ¿Continuar?" con botones Confirmar/Cancelar. Confirmar llama `host_confirm_origin()`; Cancelar limpia el formulario para intentar otra URL.
3. **Origen ya confiado** (comportamiento actual): conecta automáticamente, con reintento en fallo, exactamente como hoy.

Un enlace "Cambiar de servidor" en la pantalla de fallback (la que ya existe para errores de conexión, `index.html#failed`) llama `host_forget_origin()` y vuelve al estado 1. Esto no requiere que el usuario esté autenticado ni tocar el árbol de React remoto — vive enteramente en el shell local ya existente.

### 5. Build: modo universal vs builds internos fijos

`apps/desktop/scripts/native-host.mjs`: `resolvePinnedOrigin('production')` hoy exige `RUNLY_NATIVE_PRODUCTION_URL` o cae al placeholder `app.example.com` de `environments.json`. Pasa a permitir un tercer resultado — **sin origen** — cuando se invoca con un nuevo flag `--universal`:

```powershell
pnpm native:android build production --apk --universal
```

Con `--universal`, `makeConfig(origin)` genera la capability `native-remote` con un patrón amplio (`https://*/app/*`, restringido a HTTPS, ya que la app no confía en ningún origen embebido — la verificación real la hace `check_remote`/`allowed_remote` en Rust contra `HostState.origin`, no la capability por sí sola) y el propio binario Rust no recibe `ATLAS_NATIVE_ORIGIN` — nace sin `HostState.origin` precargado.

Sin `--universal`, el comportamiento actual no cambia: `staging`/`development`/`production` sin ese flag siguen fijando el origen por variable de entorno en tiempo de compilación, para builds internos de QA que no necesitan repetir la conexión manual.

## Seguridad — qué cambia y qué no

- Las capacidades concedidas al WebView remoto (`native-remote`) no cambian: sin filesystem, sin SQL, sin shell genérico, mismas ya auditadas.
- El preflight (HTTPS + sin redirects + CSP exigida) se aplica igual a un origen fijo en compilación que a uno elegido en runtime — no se relaja ninguna validación existente.
- El riesgo nuevo real: un usuario (o alguien que engañe al usuario) puede apuntar la app a un servidor malicioso que *también* pase el preflight (cualquiera puede servir esa CSP). La mitigación es la confirmación explícita con el dominio visible — el usuario decide conscientemente en quién confía, igual que al añadir un homeserver Matrix o un servidor SSH nuevo. Esto no es prevenible del todo en un modelo de app self-hosted universal; es la misma superficie que acepta Element, Nextcloud u ownCloud.
- `host_confirm_origin`/`host_forget_origin` son exclusivos del shell local (misma guarda `local_shell(&window)` que ya protege `host_connect`) — el WebView remoto nunca puede invocarlos, así que una vez conectado a un servidor, ese servidor no puede auto-reconectar la app a otro dominio distinto sin pasar de nuevo por el shell local y la confirmación explícita.

## Manejo de errores y casos límite

- Preflight falla (HTTP no-200, TLS/timeout, CSP faltante): mismo código de error que ya existe hoy (`HTTP_xxx`, `NETWORK_TLS_OR_TIMEOUT`, `MISSING_NATIVE_FRAME_POLICY`), mostrado en el formulario para que el usuario corrija la URL.
- El usuario cierra la app entre el preflight y la confirmación: `pending_origin` vive solo en memoria del proceso, se pierde — al reabrir, vuelve al estado 1 (sin origen), el usuario debe volver a escribir la URL. Esto es intencional (no persistir nada hasta confirmación explícita).
- El usuario confirma un origen, luego ese servidor deja de responder (offline, cambia de dominio): el flujo de fallback ya existente (`index.html#failed`, watchdog de 30s) se activa igual que hoy; el enlace "Cambiar de servidor" permite recuperarse sin reinstalar.
- Build sin `--universal` y sin `RUNLY_NATIVE_PRODUCTION_URL`: sigue fallando como hoy (cae al placeholder `app.example.com`, detectable y ya documentado) — no cambia el comportamiento para quien no pide explícitamente el modo universal.

## Pruebas

Enfocadas en la lógica nueva (Rust, que sí tiene arnés de tests unitarios en este archivo, a diferencia de Kotlin):

- `allowed_remote`/`check_remote` con `HostState.origin` en `None`, `Some(x)` coincidente y `Some(x)` no coincidente.
- `host_connect` con: sin origen persistido ni candidato (→ `NO_ORIGIN_CONFIGURED`), candidato inválido (username/password/puerto/query → rechazado sin llamar red), candidato que reutiliza el origen ya persistido (→ conecta directo, sin pending), candidato nuevo con preflight exitoso (→ quedar en `pending_origin`, no navegar), candidato nuevo con preflight fallido (→ ningún estado persiste).
- `host_confirm_origin` sin `pending_origin` (→ error) y con uno presente (→ persiste, navega, limpia pending).
- `host_forget_origin` limpia tanto el estado en memoria como el valor persistido.

Sin pruebas end-to-end de instalación real de APK en dispositivo — igual que el resto del native host, eso requiere verificación manual documentada aparte (`docs/mobile/RUNLY_NATIVE_HOST.md`'s checklist de aceptación).

## Documentación

Al implementar, actualizar `docs/mobile/RUNLY_NATIVE_HOST.md`: la línea "Mobile usa configuración web y nunca ofrece elegir servidor" queda obsoleta y debe corregirse para describir el nuevo flujo de conexión en runtime, dejando claro que solo aplica a builds `--universal`.
