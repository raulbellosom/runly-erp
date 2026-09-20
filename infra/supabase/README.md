# Supabase Self-hosted para Runly ERP

> **Deprecado para el modo `local`.** Este directorio es un stub manual y
> desconectado del instalador — nunca lo invoca `setup-local.mjs`. Para una
> instalacion real de Supabase self-hosted gestionada por Runly (secretos por
> instancia, puertos administrativos no publicos, healthchecks, migrate/seed
> automatico), usa `RUNLY_SUPABASE_MODE=selfhosted` en
> `infra/installer/setup-local.mjs` — ver `infra/installer/README.md` y
> `infra/installer/supabase/VENDORED_FROM.md`. Este README se conserva solo
> como referencia para quien administre un Supabase self-hosted totalmente
> independiente (modo `external`, en otra maquina).

Este bundle no copia el `docker-compose.yml` oficial completo de Supabase porque cambia con frecuencia. La forma recomendada es mantenerlo como infraestructura externa versionada dentro de `infra/supabase/runtime`.

## Opción recomendada

```bash
cd infra/supabase
./bootstrap-supabase.sh
```

El script descarga/clona el repositorio oficial de Supabase y copia la carpeta `docker` a `runtime`.

Después debes configurar el archivo `.env` de Supabase según el README oficial.

## Variables que Runly necesita

En el `.env` raíz de Runly:

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:54322/postgres?schema=public"
SUPABASE_URL="http://localhost:8000"
SUPABASE_ANON_KEY="..."
SUPABASE_SERVICE_ROLE_KEY="..."
RUNLY_STORAGE_DRIVER="supabase"
```

## Rol de Supabase en Runly

- PostgreSQL: datos estructurados del ERP.
- Auth: identidad y sesiones base.
- Storage: archivos físicos.
- Realtime: actualizaciones en vivo.
- Studio: panel técnico.
- PostgREST: APIs automáticas para casos controlados.

## Rol de Runly API

Runly API mantiene las reglas de negocio:

- permisos empresariales
- instalación de módulos
- validaciones de dominio
- auditoría
- workflows
- integraciones

No conectes toda la app desktop directamente a Supabase para operaciones críticas.
