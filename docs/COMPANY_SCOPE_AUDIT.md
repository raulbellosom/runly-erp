# Revisión de empresa activa

## Correcciones

- Las peticiones empresariales directas de Website, Ledger, Catálogo, Growth,
  Proyectos y Flota utilizan `companyFetch`. Exige empresa activa, limita el
  destino a la API configurada, conserva formularios multipart y señales de
  cancelación y descarta respuestas si cambia la empresa durante la petición
  o la lectura del cuerpo. No modifica `window.fetch`.
- El SDK incluye empresa al subir módulos ZIP y descarta respuestas empresariales
  tardías. La cola offline comprueba que la empresa de la petición coincida con
  la sesión del almacén.
- Los adjuntos de Growth y Proyectos reciben `companyId`. Las preferencias de
  tablas usan el encabezado empresarial. El inbox de chat toma la empresa del
  proveedor de empresa activa y separa sus consultas y suscripciones.
- Calendario transmite la empresa validada a las operaciones de calendarios,
  eventos, invitados y recordatorios. Tener acceso a otra empresa no permite
  operar sus eventos con los permisos de la empresa seleccionada.
- Subir o eliminar un sitio compilado verifica la empresa del sitio antes de
  tocar archivos. Las reservas públicas requieren `X-Site-Id`, un calendario de
  esa empresa y un bloque de reservas publicado con visibilidad pública; su
  duración sale de la configuración publicada.
- Website y Catálogo públicos resuelven el dominio o la empresa principal
  configurada; no eligen la primera empresa por antigüedad. Temas y menús conservan
  el filtro empresarial; las páginas privadas no aparecen en respuestas públicas.
- Actividad no infiere empresa desde la primera membresía. Recuperación de cuenta
  usa marca neutral cuando la identidad pertenece a varias empresas.
- Web Push mantiene claves por instalación/origen y solo la administración de
  plataforma puede consultarlas, rotarlas o eliminarlas. SMTP sigue separado por
  empresa. Son ámbitos diferentes deliberadamente.
- La guía RME3 y su copia del instalador usan `c.get('companyId')`, validado por
  el middleware, para que los módulos nuevos no copien una membresía arbitraria.

## Ámbitos revisados

El transporte compartido del SDK cubre los módulos que ya lo usaban, incluidos
Empresa, Identidad, Contactos, HR, Inventario, POS, Calendario, Documentos y
Actividad. Los renderizadores `RunlyTable`, `RunlyForm`, `RunlyDetail` y
`RunlyCrudView` reciben empresa explícita del host. Los servicios y rutas de estos
módulos mantienen su autorización y sus filtros; el encabezado por sí solo no
concede acceso.

Las rutas de inicio de sesión y bootstrap son globales. Los archivos con URL
firmada no reciben credenciales empresariales adicionales. Chat y notas permiten
acceso externo únicamente mediante ACL del recurso/invitación. Las conexiones
Google y los calendarios personales pertenecen al usuario. Las rutas públicas
resuelven su propio sitio/empresa, nunca confían en una membresía del navegador.
Estas excepciones no deben convertirse en una selección implícita de otra empresa.

## Verificación

### Segunda revisión: relaciones entre módulos

- POS valida las referencias a sucursal, terminal, sesión y mesa antes de crear
  órdenes o sentar reservas. También valida sucursales al abrir cajas y crear
  planos, zonas al crear/mover mesas y comensales al agregar/editar partidas.
  La pertenencia a la empresa no sustituye la pertenencia a la sucursal,
  plano u orden correspondiente.
- Proyectos limita dependencias al mismo proyecto, también al leer enlaces
  antiguos. Vincular/eliminar adjuntos exige acceso a la tarea y al archivo;
  no acepta archivos de otra empresa o tarea ni convierte archivos restringidos
  en adjuntos compartidos. Conserva `FileAsset.entityId` como empresa y usa
  `metadata.sourceEntityId` para la tarea. Listados, detalle y contadores leen
  ese formato, con compatibilidad de lectura para adjuntos antiguos.
- Chat resuelve referencias usando la empresa de la conversación y exige el
  permiso de lectura del módulo de origen. Las referencias a tareas y proyectos
  comprueban además el acceso al proyecto. Archivos y Calendario reciben el
  mismo contexto empresarial explícito.
- Contactos y RH rechazan operaciones sin empresa antes de consultar datos;
  ya no seleccionan la membresía más reciente como alternativa.
- Se revisaron también filtros y referencias de Inventario y Documentos. Esta
  ronda no modificó esos servicios ni añadió migraciones.

### Tercera revisión: Notas y Finanzas personales

- Carpetas de Notas exigían solo `owner_user_id`: una carpeta de otra empresa
  del mismo usuario podía listarse, servir de padre de una carpeta nueva o
  recibir una carpeta movida. `folders-service.js` ahora filtra listar/crear/
  actualizar/eliminar por empresa activa (o alcance personal `NULL`) y valida
  la carpeta padre con `assertFolder` antes de crear o mover.
- Etiquetas de Notas tenían la misma falta, más un `UNIQUE(owner_user_id, name)`
  que impedía nombres repetidos entre empresas. `tags-service.js` filtra listar/
  actualizar/eliminar por empresa; `setNoteTags` ya solo aceptaba etiquetas del
  usuario, ahora exige además que la etiqueta pertenezca a la empresa de la nota.
  El conteo de notas por etiqueta en el listado usa `runly_note_user_access` para
  no filtrar notas ajenas compartidas. La restricción única pasa a
  `(owner_user_id, company_id, name)` con `NULLS NOT DISTINCT`.
- Finanzas personales guardaba la anotación de un movimiento bancario
  (categoría/recibo/nota) por `ledgerTransactionId` únicamente: dos billeteras
  distintas enlazadas al mismo movimiento veían y sobrescribían la misma
  anotación, y el enlace no comprobaba que la billetera realmente perteneciera
  a esa cuenta bancaria ni a la empresa activa. `ledger-link-service.js` ahora
  valida la billetera contra la cuenta enlazada (`assertLinkedWallet`) antes de
  leer o escribir, exige empresa/actor/cuenta antes de tocar la base, valida
  categoría y recibo por empresa/propietario, y la anotación se guarda por
  `(company_id, owner_id, wallet_id, ledger_transaction_id)`. Requiere
  migración; conserva las anotaciones existentes (una fila por movimiento pasa
  a pertenecer a su única billetera/empresa de origen).

### Cuarta revisión: auto-selección de membresía residual

`activity-service.js`, `notification-service.js` y `sync-service.js` conservaban
el mismo patrón que ya se había retirado de Contactos y RH: si la ruta no traía
una empresa activa resuelta (`c.get('companyId')` en `null`, posible para un
system admin sin membresía de empresa o cuya resolución de tenant quede
ambigua), el servicio elegía la membresía más reciente del usuario en lugar de
rechazar. Las rutas HTTP actuales siempre pasan una empresa ya validada por
`requirePermission`, así que no había una fuga demostrable a través de ellas,
pero era el mismo patrón inseguro corregido en otros módulos y quedaba como
una trampa para cualquier llamada interna futura que omitiera la empresa. Las
tres funciones `resolveCompanyContext` ahora rechazan (403 `no_active_company`)
en vez de auto-seleccionar. Las pruebas unitarias de los tres servicios se
actualizaron para pasar la empresa explícitamente; las que sí verifican el
rechazo (`no_active_company`, `profile_not_found`) se dejaron sin empresa a
propósito.

### Quinta revisión: Inventario (comentarios heredados)

`inventory-service.js` conserva sus propias `createComment`/`updateComment`/
`deleteComment`/`toggleReaction`, pero la ruta de inventario ya no las usa:
`routes/inventory/index.js` llama al `comments-service.js` genérico (compartido
con Proyectos y Growth), que sí exige y valida `companyId`. Las funciones de
`inventory-service.js` quedaron como código muerto sin ninguna llamada real en
el repositorio. Aun así, `updateComment` no recibía `companyId` en absoluto
(a diferencia de sus hermanas) y solo comprobaba autoría, sin confirmar que el
comentario perteneciera al ítem de la empresa activa — el mismo patrón ya
corregido en otros módulos. Se corrigió para exigir y validar `companyId`
igual que `deleteComment`, y se añadió al test de guardia
`inventory-tenant-isolation.test.js`. No hay ruta HTTP que la invoque hoy, así
que no había fuga demostrable; queda documentado por si se reconecta en el
futuro. Pendiente de decisión aparte: si conviene eliminar del todo ese
código muerto en `inventory-service.js`.

Los escenarios H, I, J y K de PostgreSQL verifican estos cruces con un usuario que
pertenece a dos empresas, incluyendo operaciones válidas como control. Las
pruebas de Chat comprueban también la ausencia de permisos de lectura; las de
Contactos/RH recorren todos sus métodos públicos sin empresa y exigen rechazo
sin tocar la base de datos. El escenario K cubre carpetas/etiquetas de Notas y
la anotación de Finanzas personales descritas arriba.

```sh
pnpm check:company-scope
pnpm test:isolation:fresh
pnpm --filter @runly/desktop build:web
pnpm check:privacy
```

`check:company-scope` detecta `fetch` directo nuevo en módulos del cliente; las
excepciones revisadas están justificadas en el script. Es un control preventivo,
no una prueba de autorización completa de cada endpoint.

La suite PostgreSQL desechable aplica migraciones y seed desde cero y comprueba
usuarios, permisos, revocación, colaboración y el escenario G: Calendario,
reservas, resolución pública por dominio y rechazo de sitios ajenos. No toca la
base configurada del despliegue. Las pruebas de transporte cubren cambio de
empresa, respuestas tardías, multipart, encabezados y destinos externos.

Las pruebas unitarias de módulos y las regresiones de navegador complementan
estos escenarios. No sustituyen probar un despliegue real con sus proveedores
externos ni garantizan que futuros módulos personalizados respeten el contrato.
