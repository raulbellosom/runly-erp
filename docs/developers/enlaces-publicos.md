---
title: Enlaces y páginas públicas
summary: Compartir una ficha o un formulario de tu módulo con personas sin cuenta en Runly mediante un enlace revocable, con vigencia, límite de usos y protección contra abuso.
order: 4.5
---
Un módulo puede dejar que alguien **sin sesión en Runly** abra un enlace para ver un registro o llenar un formulario: un cliente consulta su pedido, un proveedor confirma una entrega, un empleado responde una encuesta.

**Runly es dueño del enlace y de su seguridad**: token aleatorio de 256 bits, vigencia, revocación, máximo de usos, límite de solicitudes por IP, cuerpo JSON de máximo 64 KB y campo trampa contra bots. Tu módulo solo declara qué se puede exponer e implementa las rutas públicas.

## Sin código: pestaña Enlaces del Constructor

En el Constructor, pestaña **Enlaces > Nueva página pública**:

- **Ficha pública (solo lectura)**: muestra los campos que marques de un registro.
- **Formulario público**: cada envío crea un registro de otra entidad del módulo, opcionalmente **ligado** al registro compartido (por ejemplo, cada Respuesta ligada a su Encuesta; requiere una relación de la entidad del formulario hacia la compartida).

Solo se expone lo que marcas. No se pueden mostrar campos de Archivo ni JSON; las relaciones se muestran con su nombre. En el formulario se llenan textos, números, fechas, opciones, correo y teléfono, y deben estar todos los campos obligatorios de la entidad.

Al publicar, el Constructor genera:

| Archivo | Qué contiene |
|---|---|
| `module.manifest.js` → `publicResources` | Un recurso por enlace; lo administra quien tenga el permiso de editar la entidad compartida (`<modulo>.<entidad>.update`). |
| `views/<clave>.public.js` | Vista pública `CUSTOM` en `/p/<modulo>/<clave>`, dibujada por el componente integrado `runly.public:RecordPage`. |
| `api/public.js` | `GET /record` (los campos marcados del registro) y `POST /submit` (valida y crea el registro del formulario). |

El detalle de cada registro muestra la acción **Compartir** para crear enlaces (con vigencia y usos opcionales), copiarlos, ver su QR y revocarlos.

Si tu módulo pasa a **modo desarrollador**, estos archivos son tuyos: puedes editarlos siguiendo la receta de abajo.

## Con código

### 1. Declara el recurso en `module.manifest.js`

```js
publicResources: [
  {
    key: 'encuesta.responder',           // único en el módulo: /^[a-z][a-z0-9_.-]{1,63}$/
    entity: 'encuesta',                  // opcional: el enlace apunta a un registro de este modelo
    mode: 'submit',                      // 'view' (solo lectura) | 'submit' (puede enviar datos)
    view: 'encuestas.responder-publica', // clave de una vista CUSTOM pública de este módulo
    title: 'Responder encuesta',
    managePermission: 'encuestas.encuestas.update', // debe estar declarado en `permissions`
  },
],
```

### 2. Agrega la vista pública

```js
import { defineView } from '@runly/module-engine'

export default defineView({
  key: 'encuestas.responder-publica',
  kind: 'CUSTOM',
  schema: {
    path: '/p/encuestas/responder',      // debe empezar con /p/
    public: true,
    component: 'custom.encuestas:ResponderPublica',
    title: 'Responder encuesta',
  },
})
```

La URL del enlace es `<schema.path>/<token>`. El componente recibe `{ linkToken, apiBaseUrl, publicLink, moduleKey, navigate }`:

- `apiBaseUrl` ya es `<api>/public/m/<moduleKey>/<token>`: llama `fetch(`${apiBaseUrl}/encuesta`)` **sin** encabezado de autorización.
- `publicLink = { resource: { key, title, mode }, recordId, expiresAt, company: { name, logoUrl } }`.
- Envuelve la página en `PublicLinkFrame` (`@runly/ui`) para mostrar el nombre y logo de la empresa.
- Campo trampa: agrega un input oculto ligado a `_hp` e inclúyelo en cada cuerpo JSON (`{ ...datos, _hp }`). Las personas reales lo dejan vacío.

### 3. Implementa `api/public.js`

Va separado de `api/index.js`, así las rutas normales nunca quedan expuestas.

```js
import { Hono } from 'hono'

export default function createPublicRouter({ prisma }) {
  const app = new Hono()

  app.get('/encuesta', async (c) => {
    const { companyId, recordId } = c.get('publicLink')
    const rows = await prisma.$queryRaw`
      SELECT id, titulo, descripcion FROM custom_encuestas_encuesta
       WHERE company_id = ${companyId}::uuid AND id = ${recordId}::uuid AND enabled = true`
    if (!rows.length) return c.json({ error: 'No encontrado.' }, 404)
    return c.json({ data: rows[0] })
  })

  app.post('/respuestas', async (c) => {
    const { companyId, recordId } = c.get('publicLink')
    const body = c.get('publicBody')   // ya parseado, sin _hp
    // valida con Zod y haz INSERT ... RETURNING id
    return c.json({ ok: true }, 201)
  })

  return app
}
```

`c.get('publicLink') = { id, companyId, moduleKey, resource, recordId, mode }`.

### 4. Comparte desde una pantalla del módulo

```jsx
<PublicLinksPanel apiBaseUrl={apiBaseUrl} token={token} companyId={companyId}
  moduleKey="custom.encuestas" resource="encuesta.responder" recordId={encuesta.id} />
```

El panel lista los enlaces (estado, usos, vigencia), los crea, copia la URL, muestra el QR y revoca con confirmación.

## Reglas de seguridad para `api/public.js`

- Filtra siempre por `publicLink.companyId`, nunca por algo que venga en la solicitud.
- Si `publicLink.recordId` existe, lee y escribe solo datos de ese registro.
- Si el módulo declara varios recursos, distingue por `publicLink.resource`.
- Devuelve una lista explícita de campos: nunca `SELECT *`, notas internas, ids de usuarios ni llaves de archivos.
- Valida `publicBody` con Zod: es información anónima.
- Una escritura que responde distinto de 2xx devuelve el uso al enlace; responde 2xx solo si tuvo éxito.

## Qué responde Runly antes de llegar a tu módulo

| Caso | Estado |
|---|---|
| Token desconocido, módulo desactivado o recurso eliminado | 404 `Enlace no disponible` |
| Revocado, vencido o sin usos | 410 con `reason`: `revocado`, `vencido` o `agotado` |
| Escritura en un enlace de solo lectura | 405 |
| Cuerpo de más de 64 KB | 413 |
| Escritura que no es JSON | 415 |
| Demasiadas solicitudes (por IP y enlace) | 429 con `Retry-After` |
| Campo trampa lleno | 200 `{ ok: true }` sin llamar al módulo |

Desinstalar el módulo revoca sus enlaces; reiniciarlo borra los enlaces de la empresa.

## Problemas frecuentes

- **"Vista pública no encontrada"**: a la vista le falta `public: true`, su `path` no empieza con `/p/` o el módulo no se sincronizó.
- **Crear el enlace responde 409**: `publicResources[].view` no coincide con la clave de una vista CUSTOM pública.
- **Crear el enlace responde 422 "Este enlace necesita un registro"**: el recurso declara `entity`; manda `recordId`.
- **Las rutas públicas responden 404**: falta `api/public.js` o no cargó (revisa el registro de la API).
- **No aparece Compartir** en un módulo del Constructor: publica después de agregar la página pública y revisa que tengas permiso de editar la entidad.
