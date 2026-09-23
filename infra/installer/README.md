# Runly ERP Docker Installer

Los comandos `runly:*` son los nombres principales; los atajos `atlas:*` siguen disponibles.
Las instalaciones nuevas usan `custom-modules/_runly-devkit/`. Si ya existe `_atlas-devkit/`, el instalador lo reutiliza; si existen ambas carpetas, prefiere `_runly-devkit/`.

Migración Atlas → Runly: las imágenes predeterminadas y las fuentes de descarga usan Runly.
Los paquetes internos usan `@runly/*` con alias `@atlas/*`. Se conservan los overrides anteriores como respaldo y los nombres del proyecto, servicios y volúmenes Compose.
Publicar las tres imágenes Runly antes de desplegar estos cambios del instalador.
Las instalaciones con overrides explícitos de imágenes conservan su selección;
actualizarlos al cambiar a las imágenes publicadas de Runly.

Variables nuevas: `RUNLY_*` y `VITE_RUNLY_*`. Las equivalentes `ATLAS_*` y
`VITE_ATLAS_*` siguen funcionando cuando no se define el nombre Runly. Dentro de
una misma fuente, Runly tiene prioridad; en la preparacion del instalador, el entorno
del proceso prevalece sobre el archivo guardado incluso si usa el nombre anterior.
Los valores vacios son explicitos y pasan por las validaciones/defaults existentes.

Ejemplos: `RUNLY_API_URL`, `RUNLY_API_IMAGE`, `RUNLY_API_LOCAL_IMAGE`,
`RUNLY_WORKER_IMAGE`, `RUNLY_WEB_EXTERNAL_IMAGE`, `RUNLY_DOCS_REPO_REF`,
`RUNLY_SUPABASE_PUBLIC_URL`, `RUNLY_OFFICE_ENABLED` y `RUNLY_WOPI_SECRET`.
Los servicios/volumenes Compose mantienen sus identidades actuales. Instala las
imagenes Runly compatibles antes de usar configuracion con los nombres nuevos.

Repositorio oficial:
- GitHub: `https://github.com/raulbellosom/runly-erp`
- Docker Hub: `https://hub.docker.com/r/raulbellosom/runlyerp`

Imágenes de distribución (requieren publicación):
- API: `raulbellosom/runlyerp:api-latest`
- Worker: `raulbellosom/runlyerp:worker-latest`
- Web: `raulbellosom/runlyerp:web-latest`

La imagen web no lleva credenciales. Al arrancar el container, `web-entrypoint.sh`
inyecta `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `ATLAS_API_URL` desde las variables
de entorno del container en `/runtime-config.js`.

---

## Modos de instalacion

| Modo | Para que | Script |
|------|----------|--------|
| `local` | Runly + Supabase, ambos en esta misma maquina (sirve para desarrollo **y** para una instalacion de produccion en un solo VPS) | `setup-local.mjs` |
| `external` | Produccion contra Supabase externo/self-hosted en otra maquina | `setup-external.mjs` |

Dentro del modo `local`, `RUNLY_SUPABASE_MODE` decide como se levanta Supabase:

| `RUNLY_SUPABASE_MODE` | Que es | Para que sirve |
|---|---|---|
| `selfhosted` (**por defecto en instalaciones nuevas**) | Stack Supabase self-hosted real via Docker Compose (`infra/installer/supabase/docker-compose.supabase.yml`): Postgres, Auth, REST, Realtime, Storage, Meta y Studio, con secretos unicos por instancia y sin puertos administrativos publicos. | Instalacion de produccion en una sola maquina (VPS o equipo de desarrollo). |
| `cli-dev` | El flujo antiguo basado en Supabase CLI (`supabase start`). Publica Postgres y Studio en el host sin autenticacion — pensado solo para conveniencia de desarrollo. | Desarrollo local rapido cuando no importa la postura de seguridad. Actívalo con `--dev-supabase-cli` en una instalacion nueva. |

Una vez que una instalacion queda en un modo, las re-ejecuciones de
`setup-local.mjs` se quedan en ese mismo modo aunque cambies la bandera —
cambiar de modo en una instalacion existente es una migracion deliberada,
ver [Migrar de `cli-dev` a `selfhosted`](#migrar-de-cli-dev-a-selfhosted) mas abajo.

---

## Modo `local` — Supabase self-hosted (produccion en una sola maquina)

Requiere: Docker Desktop (o Docker Engine + Compose v2), Node.js 20+, npx.

### Windows (PowerShell)

```powershell
# Desde la carpeta donde quieras instalar Runly ERP:
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/raulbellosom/runly-erp/main/infra/installer/bootstrap-local.ps1" -OutFile ".\bootstrap-local.ps1"
powershell -ExecutionPolicy Bypass -File .\bootstrap-local.ps1
```

### Linux / macOS / Git Bash

```bash
# Desde la carpeta donde quieras instalar Runly ERP:
curl -fsSLo bootstrap-local.sh https://raw.githubusercontent.com/raulbellosom/runly-erp/main/infra/installer/bootstrap-local.sh
chmod +x bootstrap-local.sh
./bootstrap-local.sh
```

> `docker-compose.linux.yml` es requerido en Linux: Docker Engine no inyecta
> `host.docker.internal` automaticamente y este override lo resuelve via `host-gateway`.
> En Windows y macOS Docker Desktop lo inyecta solo y este archivo se ignora.

### Que hace `setup-local.mjs` (modo `selfhosted`, por defecto)

1. Genera (o reutiliza, si ya existen) los secretos de Supabase — password de
   Postgres, JWT secret, `SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`
   firmados localmente, claves de Realtime/Meta — y elige los puertos de
   Kong/Studio una sola vez por instancia. Nunca se regeneran en
   reejecuciones.
2. Levanta `supabase-db`, `supabase-auth`, `supabase-rest`, `supabase-realtime`,
   `supabase-storage` y `supabase-kong` (mas `supabase-meta`/`supabase-studio`,
   sin bloquear el resto si tardan) y espera a que pasen su healthcheck.
   Postgres nunca se publica al host; Studio solo en `127.0.0.1`.
3. Ejecuta `pnpm db:migrate` y `pnpm db:seed` dentro de un container
   `docker run --network <proyecto>_default`, contra `supabase-db` por su
   nombre de servicio Docker.
4. Descarga el Dev Kit RME3 exportado a `custom-modules/_runly-devkit/` (siempre actualizado
   desde main) usando un `manifest.json` versionado. Incluye `AGENTS.md`,
   guias RME3, `capabilities.runtime.json`, `prompt-starter.txt`,
   `troubleshooting.md` y `golden-path-module/`.
5. Hace `docker pull` de API, worker, web y de las imagenes de Supabase (y de
   LiveKit + Redis cuando `LIVEKIT_MODE=embedded`). Luego ejecuta
   `docker image prune -f` para eliminar layers huerfanos.
6. Levanta `docker compose --profile local up -d` (agrega el perfil `livekit`
   automaticamente cuando se usa el modo integrado).
7. Imprime un reporte de "production readiness": si detecta una
   configuracion critica insegura (por ejemplo, modo `cli-dev`, secretos
   invalidos), **no** imprime el mensaje de "listo para produccion".

### Modo `cli-dev` (desarrollo, Supabase CLI — no usar en produccion)

```bash
node ./setup-local.mjs --dev-supabase-cli   # solo en una instalacion NUEVA
```

Mismo flujo que antes: `supabase init`/`supabase start -x logflare -x vector`
en `.supabase-local/`, credenciales leidas de `supabase status -o env`.
Publica Postgres (`54322`) y Studio (`54323`) en el host sin autenticacion —
por eso el reporte final siempre marca esta instalacion como no apta para
produccion.

### Opciones utiles

```bash
npm run runly:local       # instalacion / actualizacion completa (modo actual de la instalacion)
npm run runly:local:docs  # solo descarga/refresca el Dev Kit
npm run runly:local:quick # salta docker pull y reutiliza imagenes locales
node ./setup-local.mjs --skip-compose-up  # solo prepara secretos/env, no levanta contenedores
```

### Migrar de `cli-dev` a `selfhosted`

No hay migracion automatica de datos (son dos Postgres distintos). Para
sustituir una instalacion `cli-dev` existente por una `selfhosted` nueva:

```bash
# 1. Respalda tus datos si los necesitas (pg_dump contra el Postgres del CLI).
# 2. Detiene y borra la instalacion cli-dev por completo:
node ./stop-local.mjs --reset
# 3. Instala en modo selfhosted (el default):
node ./setup-local.mjs
# 4. Si tenias datos, restaura el dump contra el nuevo Postgres:
#    docker exec -i <prefijo>-supabase-db psql -U postgres -d postgres < backup.sql
```

En PowerShell, si `npm` falla por `ExecutionPolicy`, usa `npm.cmd`:

```powershell
npm.cmd run runly:local
npm.cmd run runly:local:docs
npm.cmd run runly:stop:local
```

### Comandos simples recomendados

```bash
npm run runly:local
npm run runly:local:docs
npm run runly:stop:local
```

### Actualizar todo en un solo comando

```bash
bash ./update-local.sh
# o: npm run runly:update:local
```

Encadena los dos pasos de arriba: refresca los scripts del instalador
(equivalente a re-correr `bootstrap-local.sh`, que nunca toca `.env.local` ni
`custom-modules/`) y luego corre `npm run runly:local` (pull + migrate + recreate).
Es seguro re-ejecutarlo. Este archivo se distribuye via `bootstrap-local.sh`
igual que el resto del instalador, asi que una instalacion existente lo recibe
sola en el siguiente refresco.

---

## Modo `external` — Produccion (servidor Linux)

Para un servidor Linux con Supabase self-hosted o Supabase Cloud ya configurado.
**No requiere npx ni Supabase CLI** — solo Docker y Node.js 20+.

### Instalacion en servidor nuevo (Linux)

```bash
curl -fsSLo bootstrap-external.sh https://raw.githubusercontent.com/raulbellosom/runly-erp/main/infra/installer/bootstrap-external.sh
chmod +x bootstrap-external.sh
./bootstrap-external.sh

nano .env.external
npm run runly:external
```

### Windows (PowerShell)

```powershell
# Desde la carpeta donde quieras instalar Runly ERP:
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/raulbellosom/runly-erp/main/infra/installer/bootstrap-external.ps1" -OutFile ".\bootstrap-external.ps1"
powershell -ExecutionPolicy Bypass -File .\bootstrap-external.ps1

notepad .\.env.external
npm.cmd run runly:external
```

### Que hace `setup-external.mjs`

1. Valida que `.env.external` existe y tiene las credenciales.
2. Valida que Docker Compose esta disponible.
3. Descarga el Dev Kit RME3 exportado a `custom-modules/_runly-devkit/` (siempre actualizado
   desde main) usando un `manifest.json` versionado. Incluye `AGENTS.md`,
   guias RME3, `capabilities.runtime.json`, `prompt-starter.txt`,
   `troubleshooting.md` y `golden-path-module/`.
4. Hace `docker pull` de API, worker y web (y de LiveKit + Redis cuando
   `LIVEKIT_MODE=embedded`). Luego ejecuta `docker image prune -f`
   para eliminar layers huerfanos de versiones anteriores y liberar espacio en disco.
5. Ejecuta `pnpm db:migrate` y `pnpm db:seed` dentro del container API.
6. Levanta `docker compose --profile external up -d`; agrega el perfil `livekit`
   automaticamente cuando se usa el modo integrado.

### Opciones utiles

```bash
npm run runly:external        # instalacion / actualizacion completa
npm run runly:external:docs   # solo descarga/refresca el Dev Kit
npm run runly:external:quick  # reinicio rapido sin pull ni migraciones
node ./setup-external.mjs --skip-dev-kit       # omite descarga del Dev Kit RME3
```

### Comandos simples recomendados

```bash
npm run runly:external
npm run runly:external:docs
npm run runly:stop:external
```

### Actualizar todo en un solo comando

```bash
bash ./update-external.sh
# o: npm run runly:update:external
```

Encadena los dos pasos de una actualizacion: refresca los scripts del
instalador (equivalente a re-correr `bootstrap-external.sh`, que nunca toca
`.env.external` ni `custom-modules/`) y luego corre `npm run runly:external`
(pull + migrate + recreate). Se niega a correr si `.env.external` todavia no
existe (eso es una instalacion nueva, no una actualizacion) — usa
`bootstrap-external.sh` directamente para ese caso, porque necesita tus
credenciales de Supabase antes de poder arrancar nada. Este archivo se
distribuye via `bootstrap-external.sh` igual que el resto del instalador, asi
que una instalacion existente lo recibe sola en el siguiente refresco.

### Variables en `.env.external`

```bash
# Ejemplo con Supabase self-hosted
SUPABASE_URL=https://supabase.tudominio.com
SUPABASE_ANON_KEY=<anon_key>
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
SUPABASE_JWT_SECRET=<jwt_secret>
JWT_SECRET=<jwt_secret>                          # mismo valor que SUPABASE_JWT_SECRET
DATABASE_URL=postgresql://postgres:<pass>@<host>:5432/postgres
DIRECT_URL=postgresql://postgres:<pass>@<host>:5432/postgres
VITE_SUPABASE_URL=https://supabase.tudominio.com
VITE_SUPABASE_ANON_KEY=<anon_key>
VITE_ATLAS_API_URL=http://localhost:4010
CORS_ORIGIN=http://localhost:5173
```

> Si la base de datos esta en el mismo servidor Linux, usa `host.docker.internal`
> en lugar de `localhost` en `DATABASE_URL` y `DIRECT_URL`.

---

## Runly Calls / LiveKit

> Checklist completo de subdominios (RTC, Office, Supabase, app principal) en
> [docs/deployment/dns-subdomains.md](../../docs/deployment/dns-subdomains.md).

La configuración principal vive en `.env.local` o `.env.external`. Los scripts no
solicitan datos que ya estén definidos ahí y persisten las claves generadas para
que una actualización no invalide instalaciones existentes:

```bash
LIVEKIT_MODE=embedded
LIVEKIT_DOMAIN=
LIVEKIT_TLS_MODE=managed
LIVEKIT_URL=
LIVEKIT_INTERNAL_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
```

| Modo | Comportamiento |
|------|----------------|
| `embedded` | Valor predeterminado. Genera credenciales, configuración y levanta LiveKit + Redis. |
| `external` | Runly usa un servidor LiveKit existente; URL interna y credenciales deben corresponder a ese servidor. |
| `disabled` | Opción explícita que oculta los controles y desactiva la API de llamadas. |

En desarrollo local no se requiere dominio: `setup-local.mjs` genera
`LIVEKIT_URL=ws://localhost:7880`. En Linux la URL interna se deriva como
`http://host.docker.internal:7880`; en Docker Desktop se usa la red privada de
Compose. Hono siempre usa `LIVEKIT_INTERNAL_URL`, mientras el navegador recibe
únicamente `LIVEKIT_URL` y un token temporal.

En producción embedded el único dato RTC público obligatorio es el dominio:

```bash
LIVEKIT_MODE=embedded
LIVEKIT_DOMAIN=rtc.example.com
LIVEKIT_TLS_MODE=managed
```

El instalador deriva `LIVEKIT_URL=wss://rtc.example.com`, genera y persiste las
claves, configura `host-gateway`, inicia Caddy y espera un certificado público
válido antes de continuar. El DNS debe apuntar previamente a la VPS y los puertos
`80/tcp`, `443/tcp`, `443/udp`, `7881/tcp` y `7882/udp` deben estar permitidos.

Con `LIVEKIT_TLS_MODE=external` Runly no inicia Caddy, no modifica Nginx, no emite
certificados y no asume rutas de archivos TLS. El administrador conserva por
completo la configuración del proxy existente y debe dirigir el dominio de
LiveKit a `http://127.0.0.1:7880` con soporte WebSocket. El instalador únicamente
exige que `wss://LIVEKIT_DOMAIN` tenga TLS válido antes de declarar la instalación
lista.

En Linux, LiveKit usa `network_mode: host`; Redis escucha exclusivamente en
`127.0.0.1:6380` y no se expone públicamente. Antes de imprimir `ready`, el
instalador valida DNS, TLS, Redis, el endpoint de LiveKit y la conexión desde Hono,
y crea y elimina una sala temporal. Redes muy restrictivas pueden requerir TURN.

Si un firewall del host (por ejemplo `ufw`) bloquea el tráfico del contenedor de
la API hacia `host.docker.internal:7880`, la prueba de conexión falla con un
timeout. El instalador **no ejecuta cambios de firewall por sí mismo** (requeriría
root y asume `ufw`, que no todas las VPS usan); en su lugar, cuando detecta ese
patrón de fallo con `ufw` activo, inspecciona las redes de Docker e imprime la
regla exacta a copiar y ejecutar, por ejemplo:

```bash
sudo ufw allow proto tcp from 192.0.2.0/24 to 192.0.2.1 port 7880 comment 'Runly API to LiveKit'
```

Para llamadas desde fuera de la VPS, además hay que permitir el tráfico RTC:

```bash
sudo ufw allow 7881/tcp comment 'Runly LiveKit RTC TCP'
sudo ufw allow 7882/udp comment 'Runly LiveKit RTC UDP'
```

Nunca expongas `LIVEKIT_API_SECRET` al frontend. Runly solo entrega tokens de
sala de corta duracion desde la API.

---

## Multiples instancias de Runly en el mismo host

Cada carpeta de instalador (copia de `infra/installer`) es **una instancia**
independiente: su propio `docker-compose.yml`, `.env.local`/`.env.external`,
`custom-modules/`, y (en modo `local`) su propio `.supabase-local/`.

En la primera ejecucion, `setup-local.mjs`/`setup-external.mjs` generan y
persisten `RUNLY_INSTANCE_ID` en el archivo `.env.*` — un identificador
aleatorio estable que nunca se regenera en ejecuciones posteriores. A partir
de el se derivan:

- `RUNLY_COMPOSE_PROJECT_NAME` — nombre de proyecto de Docker Compose (aisla
  la red por defecto y todos los volumenes con nombre, que Compose prefija
  con el nombre del proyecto).
- `RUNLY_CONTAINER_PREFIX` — prefijo de `container_name` para cada servicio
  (los nombres de contenedor son literales y Compose no los aisla por si
  solo).
- En modo `local` con `RUNLY_SUPABASE_MODE=selfhosted`, los servicios
  `supabase-*` viven en el mismo proyecto Compose (mismo `RUNLY_COMPOSE_PROJECT_NAME`),
  asi que heredan el mismo aislamiento de red/volumenes; sus puertos propios
  (`RUNLY_SUPABASE_KONG_HOST_PORT`, `RUNLY_SUPABASE_STUDIO_HOST_PORT`) se
  eligen automaticamente la primera vez, evitando colisiones con otra
  instancia en el mismo host.
- En modo `local` con `RUNLY_SUPABASE_MODE=cli-dev`, el `project_id` de
  Supabase CLI en `.supabase-local/supabase/config.toml` (evita que dos
  instancias locales colisionen en los contenedores/volumenes que administra
  Supabase CLI) — pero sus puertos fijos (`54321-54329`) **no** se derivan de
  `RUNLY_INSTANCE_ID`, asi que dos instancias `cli-dev` en el mismo host si
  pueden colisionar entre si (una razon mas para preferir `selfhosted`).

Una instalacion **ya existente** (archivo `.env.*` presente sin
`RUNLY_INSTANCE_ID`) conserva el nombre de proyecto/prefijo heredado
(`runlyerp` / `runly-*`) al actualizar el instalador — nunca se renombra
automaticamente, para no huerfanar contenedores, redes o volumenes ya en uso.

Para instalar una **segunda instancia** en el mismo host: copia el
instalador a otra carpeta y ejecuta el setup normalmente — la identidad se
genera sola y ya queda aislada del resto. Los puertos publicados tambien son
configurables por instancia (ver `RUNLY_API_HOST_PORT`, `RUNLY_WEB_HOST_PORT`,
`RUNLY_COLLABORA_HOST_PORT`, `RUNLY_PUBLIC_BIND_ADDR`, y las variables
`LIVEKIT_*_PORT` en `.env.local.example`/`.env.external.example`) por si el
puerto por defecto ya esta en uso en ese host.

**Limitacion conocida — LiveKit embebido en Linux:** por requisitos de UDP,
LiveKit corre con `network_mode: host` en Linux (ver
`docker-compose.linux.yml`), lo que evita por completo el aislamiento de
proyecto de Compose para esos contenedores. Una segunda instancia con
LiveKit embebido en el mismo host Linux debe usar puertos distintos
(`LIVEKIT_HTTP_HOST_PORT`, `LIVEKIT_RTC_TCP_PORT`, `LIVEKIT_RTC_UDP_PORT`,
`LIVEKIT_REDIS_PORT`) explicitamente. El TLS gestionado de Caddy
(`LIVEKIT_TLS_MODE=managed`) usa los puertos 80/443 estandar de ACME y no es
practico remapear — para una segunda instancia con dominio propio, usa
`LIVEKIT_TLS_MODE=external` con un proxy inverso compartido delante.

**Cubierto desde esta version:** Supabase self-hosted vía Docker Compose
(`RUNLY_SUPABASE_MODE=selfhosted`) como alternativa de produccion a la
Supabase CLI en modo `local` — ver la seccion de arriba.

**No cubierto por esta version del instalador:** generacion automatica de
configuracion para Nginx/Caddy/Traefik existentes (el administrador sigue
configurando su propio proxy hacia `RUNLY_API_HOST_PORT` / `RUNLY_WEB_HOST_PORT`
/ `RUNLY_SUPABASE_KONG_HOST_PORT`, igual que hoy). Los puertos de Kong/Studio
de Supabase se escanean y asignan automaticamente **una sola vez** por
instancia nueva (ver `lib/supabase-selfhosted-config.mjs`); los puertos de
Runly/LiveKit/Collabora siguen sin escaneo automatico — el instalador valida
y usa los que le indiques, pero no escanea el host por ti para esos.

---

## Iniciar / detener / resetear

Los scripts de stop ejecutan `docker image prune -f` automaticamente al terminar
para eliminar layers huerfanos sin tocar imagenes de otros proyectos en el mismo host.

### Local

| Accion | Comando |
|--------|---------|
| Primera instalacion o tras reset | `node ./setup-local.mjs` (o `./setup-local.sh`) |
| Actualizar todo (instalador + app) | `bash ./update-local.sh` |
| Detener (conserva datos) | `node ./stop-local.mjs` (o `./stop-local.sh`) |
| Reiniciar sin reinstalar (`selfhosted`) | `docker compose -f docker-compose.yml -f supabase/docker-compose.supabase.yml --profile local --profile livekit --profile livekit-tls up -d` |
| Reiniciar sin reinstalar (`cli-dev`) | `docker compose --profile local --profile livekit --profile livekit-tls up -d` |
| Reset total (borra todo) | `node ./stop-local.mjs --reset` |

### External / Produccion

| Accion | Comando |
|--------|---------|
| Primera instalacion | `node ./setup-external.mjs` (o `./setup-external.sh`) |
| Actualizar solo la app (imagenes + migraciones) | `./setup-external.sh` (pull + prune + recreate automatico) |
| Actualizar todo (instalador + app) | `bash ./update-external.sh` |
| Detener (conserva datos) | `node ./stop-external.mjs` (o `./stop-external.sh`) |
| Reiniciar rapido | `node ./setup-external.mjs --skip-pull --skip-migrate --up-only` |
| Reset (borra .env.external) | `node ./stop-external.mjs --reset` |

---

## Custom modules

Carpeta host: `custom-modules/`
Ruta en API/worker: `/app/modules/custom`

### Workflow basico

```bash
# Obtener token de sesion primero desde la UI o via API

# Sincronizar manifests y blueprints
curl -X POST http://localhost:4010/modules/sync \
  -H "Authorization: Bearer $RUNLY_TOKEN"

# Instalar un modulo desde el catalogo
curl -X POST http://localhost:4010/modules/custom.mymodule/install \
  -H "Authorization: Bearer $RUNLY_TOKEN"
```

### Validacion rapida en la UI

Para validar que RME3 quedo bien actualizado en un workspace installer-mode:

1. Ejecuta `node .\setup-local.mjs` (o `node ./setup-external.mjs` en external mode).
2. Abre `http://localhost:5173`.
3. En la app, entra a Modulos y usa `Sincronizar modulos`.
4. Instala tu modulo custom desde el catalogo.
5. Si el modulo usa una vista `CUSTOM`, abre su ruta y confirma que no aparece `Componente de modulo no disponible`.
6. Si falla un import, revisa primero `custom-modules/_runly-devkit/troubleshooting.md` y `capabilities.runtime.json`.

### Componentes React en modulos (dynamic bundle)

Los modulos pueden incluir componentes React compilados en el momento de instalacion.
No se requiere reconstruir la imagen web cuando solo cambias archivos dentro de
`custom-modules/<moduleKey>/`.

Estructura:

```
custom-modules/
  custom.mymodule/
    components/
      index.js          <- entrada del bundle, exporta register()
      MyScreen.jsx
    views/
      my-screen.custom.js
    api/
      index.js
    module.manifest.js
```

Contrato de `components/index.js`:

```js
export async function register(registry) {
  if (typeof window === 'undefined') return
  const { default: MyScreen } = await import('./MyScreen.jsx')
  registry.register('custom.mymodule:MyScreen', MyScreen)
}
```

Reglas importantes:

- Usa el runtime JSX automatico normal del proyecto. No agregues
  `/** @jsxRuntime classic */`, `/** @jsx createElement */` ni
  `import { createElement } from 'react'` en componentes del modulo.
- Si cambias solo `custom-modules/<moduleKey>/components/*`, basta con sincronizar o
  reinstalar el modulo para regenerar el bundle.
- Si cambias el runtime compartido del host en `apps/desktop`
  (por ejemplo `src/shims/*`, importmap, externals) debes publicar una nueva imagen
  `web` y recrear `runly-web-local`.
- Si cambias CORS o autenticacion cross-origin en `apps/api`, debes publicar una nueva
  imagen `api` y recrear `runly-api-local`.

Forzar recompilacion del bundle tras editar componentes:

```bash
curl -X POST http://localhost:4010/modules/custom.mymodule/sync \
  -H "Authorization: Bearer $RUNLY_TOKEN"

# Verificar
curl http://localhost:4010/modules/custom.mymodule/bundle.js
```

### Troubleshooting rapido

- `The requested module 'react/jsx-runtime' does not provide an export named 'jsx'`
  - La imagen `web` publicada no trae el shim/runtime correcto.
  - Solucion: publicar nueva imagen `web`, hacer `docker compose pull runly-web-local`
    y recrear el contenedor.
- `Cannot read properties of null (reading 'useContext')`
  - El host esta resolviendo externals por rutas inconsistentes y termina cargando
    dos copias de React/React Query.
  - Solucion: publicar nueva imagen `web` con importmap/shims alineados al mismo
    base path del host y limpiar datos del sitio en el navegador.
- `blocked by CORS policy` con `credentials mode is 'include'`
  - La API responde sin `Access-Control-Allow-Credentials: true`.
  - Solucion: publicar nueva imagen `api`, hacer `docker compose pull runly-api-local`
    y recrear el contenedor.

Empieza aqui:
- `custom-modules/_runly-devkit/README.md`
- `custom-modules/_runly-devkit/docs/ai-context/rme3-modules.md`
- `custom-modules/_runly-devkit/docs/ai-context/rme3-runtime-capabilities.md`
- `custom-modules/_runly-devkit/capabilities.runtime.json`

---

## Publicar una nueva version

Desde la raiz del repositorio (requiere `docker login` y Rust/Buildx para arm64):

```bash
# Publicar las tres imagenes (multi-platform: linux/amd64 + linux/arm64)
pnpm docker:release

# Publicar solo la imagen que cambio
pnpm docker:release:api
pnpm docker:release:worker
pnpm docker:release:web

# Build local sin push (para pruebas en tu maquina)
pnpm docker:build
pnpm docker:build --api
```

Los Dockerfiles usan multi-stage build: el stage `builder` hace el install completo
y genera el cliente Prisma; el stage `runner` solo instala dependencias de produccion
(`--prod`), lo que reduce el tamano final de las imagenes.

Despues de un build local (`pnpm docker:build`), el script elimina automaticamente
los layers huerfanos del build anterior con `docker image prune -f`.

Si el cambio solo afecta al runtime web compartido, publica solo `web`. Si el cambio
solo afecta CORS/autenticacion/rutas del API, publica solo `api`. No hace falta subir
`worker` para fixes exclusivos del frontend del modulo.

Forzar tags personalizados en setup:

```bash
export ATLAS_API_IMAGE=raulbellosom/runlyerp:api-latest
export ATLAS_WORKER_IMAGE=raulbellosom/runlyerp:worker-latest
export ATLAS_WEB_EXTERNAL_IMAGE=raulbellosom/runlyerp:web-latest
node ./setup-external.mjs --skip-pull
```
## Editor Office opcional (Collabora CODE)

### Actualizar una copia antigua del bootstrap

Ejecutar `bash ./bootstrap-external.sh` usa el archivo que ya existe en el VPS.
Las versiones antiguas no se actualizaban a sí mismas y podían omitir librerías
nuevas aunque el código ya estuviera publicado en `main`. Para renovar esa copia
una vez, desde la carpeta del instalador:

```bash
curl -fsSLo bootstrap-external.sh.next https://raw.githubusercontent.com/raulbellosom/runly-erp/main/infra/installer/bootstrap-external.sh && bash -n bootstrap-external.sh.next && mv bootstrap-external.sh.next bootstrap-external.sh
bash ./bootstrap-external.sh
```

Las versiones nuevas de los bootstrap external/local (Bash y PowerShell) refrescan
su propio código antes de descargar la lista de archivos. Si la descarga falla,
se detienen sin sustituir el bootstrap. Conservan los archivos de entorno y las
credenciales de `.secrets/`. Una versión antigua necesita la renovación manual
anterior para incorporar esta capacidad.

El bootstrap descarga los scripts y Compose. El setup (`npm run runly:external`)
descarga las imágenes/Dev Kit y ejecuta la instalación. Para preparar únicamente
las variables y carpeta de Firebase después del bootstrap:

```bash
node lib/firebase-config.mjs .env.external
```

Ese comando no reinicia Runly ni genera la clave privada: el archivo Firebase
`service-account.json` debe provisionarse por separado.

Si un instalador anterior acumuló comentarios `# Optional Office` en el entorno,
la versión corregida los consolida automáticamente al configurar Office. Después
de publicar y descargar la corrección, también puedes reparar solo ese archivo,
sin iniciar servicios ni ejecutar migraciones:

```bash
node --input-type=module -e 'import { configureOffice } from "./lib/office-config.mjs"; await configureOffice({ envFile: ".env.external", environment: {} });'
```

Conserva los valores existentes de Office (incluida su clave) y las variables de
Firebase. Los comentarios personalizados se conservan; solo se retiran los
encabezados generados duplicados y se vuelve a escribir un único bloque Office.

Office viene desactivado. Para habilitarlo en el VPS, primero publica las nuevas
imagenes de Runly y los archivos del instalador. Desde la **carpeta existente del
instalador**, refresca los scripts y Compose con el bootstrap actualizado:

```bash
curl -fsSLo bootstrap-external.sh https://raw.githubusercontent.com/raulbellosom/runly-erp/main/infra/installer/bootstrap-external.sh
bash ./bootstrap-external.sh
```

Conserva `.env.external` y `custom-modules/`; sobrescribe los archivos distribuidos
del instalador, por lo que debes guardar/reaplicar cualquier personalizacion de
esos archivos. El comando `npm run runly:external` descarga imagenes y Dev Kit,
pero **no actualiza sus propios scripts ni Compose**.

Configura el DNS y proxy HTTPS/WebSocket de Office, y edita estas variables en
`.env.external` (sustituye los dominios por los reales):

```dotenv
RUNLY_OFFICE_ENABLED=true
COLLABORA_PUBLIC_URL=https://office.tudominio.com
RUNLY_OFFICE_HOST_ORIGIN=https://erp.tudominio.com
COLLABORA_INTERNAL_URL=http://collabora:9980
RUNLY_WOPI_URL=http://api:4010
```

Ejecuta `npm run runly:external`. La primera vez descarga la imagen fijada
`collabora/code:26.04.2.4.1`, crea el servicio `collabora` y genera/persiste la clave
WOPI. Requiere las nuevas imagenes de API y web y la migracion Office; no uses
`runly:external:quick` para esta primera activacion. El instalador no crea el DNS
ni configura el proxy/certificado de Office. El puerto 9980 escucha en loopback
para el proxy del host. Office no depende de LiveKit.

En actualizaciones posteriores usa el mismo comando, carpeta y proyecto Compose
(`runlyerp`). Hay **un editor compartido**, no un contenedor por archivo o usuario.
Collabora se conserva si no cambia su imagen/configuracion; Runly y los servicios
Calls integrados mantienen su recreacion habitual, reemplazando los contenedores
anteriores. Las tareas temporales de migracion/seed se eliminan con `--rm`.
Las imagenes antiguas pueden seguir ocupando disco aunque no haya contenedores
duplicados. Guarda y cierra los documentos antes de desplegar: la API se reinicia.

Para desarrollo local, configura `.env.local` y ejecuta `npm run runly:local`.
Para desactivar Office, cambia el indicador a `false` y ejecuta el setup; detiene
el editor y conserva los documentos y su clave para futuras activaciones.

Consulta la [guia completa de despliegue, actualizaciones, proxy y recuperacion](../../docs/deployment/office-collabora.md).
