// Module Builder API (No-Code Module Builder MVP). Thin Hono router over
// module-builder-service.js — every operation re-validates the
// ModuleDefinition server-side (never trusts the frontend draft) and
// delegates compiling/packaging/installing to @runly/module-compiler +
// the shared ModulePackageService wiring, never a parallel pipeline. See
// docs/superpowers/specs/2026-09-27-rme3-no-code-module-builder-architecture.md
// and CLAUDE.md's UI-first/mountWithAuth conventions (module route files
// follow the same createXxxRouter pattern as company-routes.js).
import { Hono } from 'hono'
import { FIELD_TYPES, KANBAN_GROUP_FIELD_TYPES, KANBAN_MAX_COLUMNS, MODULE_ICON_NAMES } from '@runly/module-engine'
import { createModuleBuilderService, ModuleBuilderError } from '../services/module-builder-service.js'
import { publishActivityFromContext, getActivityContext } from '../services/activity-publisher.js'

function handleBuilderError(c, error, fallbackMessage) {
  if (error instanceof ModuleBuilderError) {
    return c.json({ error: error.code, message: error.message, details: error.details }, error.statusCode)
  }
  console.error('[builder-routes]', error?.message, error?.stack)
  return c.json({ error: 'MODULE_BUILDER_UNEXPECTED_ERROR', message: fallbackMessage }, 500)
}

export function createBuilderRouter({ prisma, requirePermission, bundlerSvc = null, routeLoader = null, cacheDel = () => {} }) {
  const app = new Hono()
  const svc = createModuleBuilderService({ prisma, bundlerSvc, routeLoader, cacheDel })

  function actor(c) {
    return c.get('userContext')?.profile?.id ?? null
  }

  app.get('/module-builder/capabilities', requirePermission('core.modules.builder'), (c) => {
    return c.json({
      data: {
        fieldTypes: Object.values(FIELD_TYPES),
        viewKinds: ['TABLE', 'FORM', 'DETAIL', 'DASHBOARD', 'KANBAN'],
        iconNames: MODULE_ICON_NAMES,
        kanbanGroupFieldTypes: KANBAN_GROUP_FIELD_TYPES,
        kanbanMaxColumns: KANBAN_MAX_COLUMNS,
        templates: svc.templates,
      },
    })
  })

  app.get('/module-builder/projects', requirePermission('core.modules.builder'), async (c) => {
    try {
      return c.json({ data: await svc.listProjects({ companyId: c.get('companyId') }) })
    } catch (error) {
      return handleBuilderError(c, error, 'No se pudieron cargar los proyectos del Builder.')
    }
  })

  app.post('/module-builder/projects', requirePermission('core.modules.builder'), async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}))
      const project = await svc.createProject({
        companyId: c.get('companyId'),
        actorId: actor(c),
        name: body.name,
        moduleKey: body.moduleKey,
        description: body.description,
        icon: body.icon,
        color: body.color,
        template: body.template,
        definition: body.definition,
      })
      return c.json({ data: project }, 201)
    } catch (error) {
      return handleBuilderError(c, error, 'No se pudo crear el proyecto del Builder.')
    }
  })

  app.get('/module-builder/projects/:id', requirePermission('core.modules.builder'), async (c) => {
    try {
      return c.json({ data: await svc.getProject({ companyId: c.get('companyId'), projectId: c.req.param('id') }) })
    } catch (error) {
      return handleBuilderError(c, error, 'No se pudo cargar el proyecto.')
    }
  })

  app.patch('/module-builder/projects/:id', requirePermission('core.modules.builder'), async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}))
      const project = await svc.updateDefinition({
        companyId: c.get('companyId'),
        actorId: actor(c),
        projectId: c.req.param('id'),
        definition: body.definition,
        name: body.name,
        description: body.description,
      })
      return c.json({ data: project })
    } catch (error) {
      return handleBuilderError(c, error, 'No se pudo guardar el borrador.')
    }
  })

  app.delete('/module-builder/projects/:id', requirePermission('core.modules.builder'), async (c) => {
    try {
      return c.json({ data: await svc.deleteDraft({ companyId: c.get('companyId'), projectId: c.req.param('id') }) })
    } catch (error) {
      return handleBuilderError(c, error, 'No se pudo eliminar el proyecto.')
    }
  })

  app.post('/module-builder/projects/:id/validate', requirePermission('core.modules.builder'), async (c) => {
    try {
      return c.json({ data: await svc.validateProject({ companyId: c.get('companyId'), projectId: c.req.param('id') }) })
    } catch (error) {
      return handleBuilderError(c, error, 'No se pudo validar el proyecto.')
    }
  })

  app.post('/module-builder/projects/:id/compile', requirePermission('core.modules.builder'), async (c) => {
    try {
      return c.json({ data: await svc.compileProject({ companyId: c.get('companyId'), projectId: c.req.param('id') }) })
    } catch (error) {
      return handleBuilderError(c, error, 'No se pudo compilar el proyecto.')
    }
  })

  app.get('/module-builder/projects/:id/preview', requirePermission('core.modules.builder'), async (c) => {
    try {
      const data = await svc.previewProject({ companyId: c.get('companyId'), projectId: c.req.param('id'), viewKey: c.req.query('view') || null })
      return c.json({ data })
    } catch (error) {
      return handleBuilderError(c, error, 'No se pudo generar la vista previa.')
    }
  })

  app.get('/module-builder/projects/:id/export', requirePermission('core.modules.builder'), async (c) => {
    try {
      const { buffer, filename } = await svc.exportPackage({ companyId: c.get('companyId'), projectId: c.req.param('id') })
      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': String(buffer.length),
        },
      })
    } catch (error) {
      return handleBuilderError(c, error, 'No se pudo exportar el paquete ZIP.')
    }
  })

  app.get('/module-builder/projects/:id/publish-impact', requirePermission('core.modules.builder'), async (c) => {
    try {
      return c.json({ data: await svc.getPublishImpact({ companyId: c.get('companyId'), projectId: c.req.param('id') }) })
    } catch (error) {
      return handleBuilderError(c, error, 'No se pudo calcular el impacto de publicación.')
    }
  })

  app.post(
    '/module-builder/projects/:id/publish',
    requirePermission('core.modules.builder'),
    requirePermission('core.modules.create'),
    async (c) => {
      try {
        const result = await svc.publishProject({ companyId: c.get('companyId'), actorId: actor(c), projectId: c.req.param('id') })
        const { actorName } = getActivityContext(c)
        await publishActivityFromContext(prisma, c, {
          type: 'core.module.builder.publish',
          severity: 'success',
          entityType: 'RunlyModule',
          entityId: result.project.moduleKey,
          summary: `${actorName} publicó el módulo ${result.project.moduleKey} desde el Module Builder`,
        }).catch(() => {})
        return c.json({ data: result })
      } catch (error) {
        return handleBuilderError(c, error, 'No se pudo publicar el módulo.')
      }
    },
  )

  app.get('/module-builder/projects/:id/revisions', requirePermission('core.modules.builder'), async (c) => {
    try {
      return c.json({ data: await svc.listRevisions({ companyId: c.get('companyId'), projectId: c.req.param('id') }) })
    } catch (error) {
      return handleBuilderError(c, error, 'No se pudieron cargar las revisiones.')
    }
  })

  app.post('/module-builder/projects/:id/detach', requirePermission('core.modules.builder'), async (c) => {
    try {
      return c.json({ data: await svc.detachProject({ companyId: c.get('companyId'), actorId: actor(c), projectId: c.req.param('id') }) })
    } catch (error) {
      return handleBuilderError(c, error, 'No se pudo desconectar el proyecto del Builder.')
    }
  })

  return app
}
