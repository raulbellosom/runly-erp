import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import {
  createFormSchema, updateFormSchema,
  createFormFieldSchema, updateFormFieldSchema, reorderFieldsSchema,
} from './validators.js'
import { FormsServiceError } from '../../services/forms-service.js'

export function createFormsRouter({ formsService, requirePermission }) {
  const app = new Hono()

  app.get('/forms', requirePermission('website.pages.read'), async (c) => {
    const companyId = c.get('companyId')
    const siteId    = c.req.query('siteId')
    if (!siteId) return c.json({ data: [] })
    const forms = await formsService.listForms({ companyId, siteId })
    return c.json({ data: forms })
  })

  app.get('/form-assignees', requirePermission('website.site.update'), async (c) => {
    const companyId = c.get('companyId')
    const assignees = await formsService.listFormAssignees({ companyId })
    return c.json({ data: assignees })
  })

  app.post(
    '/forms',
    requirePermission('website.pages.create'),
    zValidator('json', createFormSchema),
    async (c) => {
      const companyId = c.get('companyId')
      const data      = c.req.valid('json')
      try {
        const form = await formsService.createForm({ companyId, siteId: data.siteId, data })
        return c.json(form, 201)
      } catch (err) {
        if (err instanceof FormsServiceError) return c.json({ error: err.message }, err.status)
        throw err
      }
    },
  )

  app.get('/forms/:id', requirePermission('website.pages.read'), async (c) => {
    const companyId = c.get('companyId')
    try {
      const form = await formsService.getForm({ companyId, formId: c.req.param('id') })
      return c.json(form)
    } catch (err) {
      if (err instanceof FormsServiceError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  app.patch(
    '/forms/:id',
    requirePermission('website.pages.update'),
    zValidator('json', updateFormSchema),
    async (c) => {
      const companyId = c.get('companyId')
      const data      = c.req.valid('json')
      try {
        const form = await formsService.updateForm({ companyId, formId: c.req.param('id'), data })
        return c.json(form)
      } catch (err) {
        if (err instanceof FormsServiceError) return c.json({ error: err.message }, err.status)
        throw err
      }
    },
  )

  app.delete('/forms/:id', requirePermission('website.pages.delete'), async (c) => {
    const companyId = c.get('companyId')
    try {
      await formsService.softDeleteForm({ companyId, formId: c.req.param('id') })
      return c.json({ success: true })
    } catch (err) {
      if (err instanceof FormsServiceError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  // ─── Fields ─────────────────────────────────────────────────────────────────

  app.post(
    '/forms/:id/fields',
    requirePermission('website.pages.update'),
    zValidator('json', createFormFieldSchema),
    async (c) => {
      const companyId = c.get('companyId')
      const data      = c.req.valid('json')
      try {
        const field = await formsService.createFormField({ companyId, formId: c.req.param('id'), data })
        return c.json(field, 201)
      } catch (err) {
        if (err instanceof FormsServiceError) return c.json({ error: err.message }, err.status)
        throw err
      }
    },
  )

  app.post(
    '/forms/:id/fields/reorder',
    requirePermission('website.pages.update'),
    zValidator('json', reorderFieldsSchema),
    async (c) => {
      const companyId = c.get('companyId')
      const { items } = c.req.valid('json')
      await formsService.reorderFormFields({ companyId, items })
      return c.json({ success: true })
    },
  )

  app.patch(
    '/form-fields/:fieldId',
    requirePermission('website.pages.update'),
    zValidator('json', updateFormFieldSchema),
    async (c) => {
      const companyId = c.get('companyId')
      const data      = c.req.valid('json')
      try {
        const field = await formsService.updateFormField({ companyId, fieldId: c.req.param('fieldId'), data })
        return c.json(field)
      } catch (err) {
        if (err instanceof FormsServiceError) return c.json({ error: err.message }, err.status)
        throw err
      }
    },
  )

  app.delete('/form-fields/:fieldId', requirePermission('website.pages.update'), async (c) => {
    const companyId = c.get('companyId')
    try {
      await formsService.softDeleteFormField({ companyId, fieldId: c.req.param('fieldId') })
      return c.json({ success: true })
    } catch (err) {
      if (err instanceof FormsServiceError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  // ─── Submissions ─────────────────────────────────────────────────────────────

  app.get('/forms/:id/submissions', requirePermission('website.pages.read'), async (c) => {
    const companyId = c.get('companyId')
    const { page, pageSize } = c.req.query()
    try {
      const result = await formsService.listSubmissions({
        companyId,
        formId:   c.req.param('id'),
        page:     parseInt(page     ?? '1',  10),
        pageSize: parseInt(pageSize ?? '20', 10),
      })
      return c.json(result)
    } catch (err) {
      if (err instanceof FormsServiceError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  app.delete('/forms/:id/submissions/:subId', requirePermission('website.pages.delete'), async (c) => {
    const companyId = c.get('companyId')
    try {
      await formsService.deleteSubmission({ companyId, submissionId: c.req.param('subId') })
      return c.json({ success: true })
    } catch (err) {
      if (err instanceof FormsServiceError) return c.json({ error: err.message }, err.status)
      throw err
    }
  })

  return app
}
