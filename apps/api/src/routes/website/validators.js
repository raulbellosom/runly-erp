import { z } from 'zod'

export const createPageSchema = z.object({
  siteId:    z.string().uuid(),
  title:     z.string().min(1).max(255),
  slug:      z.string().min(1).max(255).regex(/^[a-z0-9-]+$/),
  routePath: z.string().min(1).max(512).startsWith('/'),
  pageType:  z.enum(['page', 'landing', 'system']).default('page'),
  visibility:z.enum(['public', 'authenticated', 'private']).default('public'),
  seo:       z.record(z.unknown()).optional(),
})

export const updatePageSchema = z.object({
  title:      z.string().min(1).max(255).optional(),
  slug:       z.string().min(1).max(255).regex(/^[a-z0-9-]+$/).optional(),
  routePath:  z.string().min(1).max(512).startsWith('/').optional(),
  visibility: z.enum(['public', 'authenticated', 'private']).optional(),
  status:     z.enum(['draft', 'published', 'archived']).optional(),
  seo:        z.record(z.unknown()).optional(),
})

export const saveDraftSchema = z.object({
  builderData: z.record(z.unknown()),
  seo:         z.record(z.unknown()).optional(),
})

export const createSiteSchema = z.object({
  name:          z.string().min(1).max(255),
  domain:        z.string().optional(),
  defaultLocale: z.string().default('es'),
  siteType:      z.enum(['website', 'ecommerce', 'blog', 'landing']).default('website'),
  analyticsMode: z.enum(['off', 'anonymous', 'consent_required']).default('off'),
  turnstileSiteKey: z.string().max(500).optional().nullable(),
  turnstileSecretKey: z.string().max(500).optional().nullable(),
})

export const updateSiteSchema = z.object({
  name:                  z.string().min(1).max(255).optional(),
  domain:                z.string().optional(),
  status:                z.enum(['draft', 'published', 'maintenance']).optional(),
  siteType:              z.enum(['website', 'ecommerce', 'blog', 'landing']).optional(),
  homepagePageId:        z.string().uuid().optional().nullable(),
  themeId:               z.string().uuid().optional().nullable(),
  settings:              z.record(z.unknown()).optional(),
  seoDefaults:           z.record(z.unknown()).optional(),
  stripePublishableKey:  z.string().optional().nullable(),
  stripeSecretKey:       z.string().optional().nullable(),
  stripeSuccessMessage:  z.string().optional().nullable(),
  analyticsMode:         z.enum(['off', 'anonymous', 'consent_required']).optional(),
  turnstileSiteKey:      z.string().max(500).optional().nullable(),
  turnstileSecretKey:    z.string().max(500).optional().nullable(),
})

export const createMenuSchema = z.object({
  siteId:   z.string().uuid(),
  name:     z.string().min(1).max(255),
  location: z.string().default('header'),
})

export const updateMenuSchema = z.object({
  name:     z.string().min(1).max(255).optional(),
  location: z.string().optional(),
})

export const createMenuItemSchema = z.object({
  label:     z.string().min(1).max(255),
  url:       z.string().optional().nullable(),
  pageId:    z.string().uuid().optional().nullable(),
  parentId:  z.string().uuid().optional().nullable(),
  target:    z.enum(['_self', '_blank']).default('_self'),
  icon:      z.string().optional().nullable(),
  sortOrder: z.number().int().default(0),
})

export const updateMenuItemSchema = z.object({
  label:     z.string().min(1).max(255).optional(),
  url:       z.string().optional().nullable(),
  pageId:    z.string().uuid().optional().nullable(),
  parentId:  z.string().uuid().optional().nullable(),
  target:    z.enum(['_self', '_blank']).optional(),
  icon:      z.string().optional().nullable(),
  sortOrder: z.number().int().optional(),
})

export const reorderItemsSchema = z.object({
  items: z.array(z.object({ id: z.string().uuid(), sortOrder: z.number().int() })),
})

export const createThemeSchema = z.object({
  siteId:     z.string().uuid(),
  name:       z.string().min(1).max(255),
  tokens:     z.record(z.unknown()).optional(),
  typography: z.record(z.unknown()).optional(),
  layout:     z.record(z.unknown()).optional(),
  customCss:  z.string().optional().nullable(),
  isDefault:  z.boolean().default(false),
})

export const updateThemeSchema = z.object({
  name:       z.string().min(1).max(255).optional(),
  tokens:     z.record(z.unknown()).optional(),
  typography: z.record(z.unknown()).optional(),
  layout:     z.record(z.unknown()).optional(),
  customCss:  z.string().optional().nullable(),
  isDefault:  z.boolean().optional(),
})

export const createBlogCategorySchema = z.object({
  siteId:      z.string().uuid(),
  name:        z.string().min(1).max(255),
  slug:        z.string().min(1).max(255).regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
})

export const createBlogPostSchema = z.object({
  siteId:        z.string().uuid(),
  categoryId:    z.string().uuid().optional().nullable(),
  title:         z.string().min(1).max(255),
  slug:          z.string().min(1).max(255).regex(/^[a-z0-9-]+$/),
  excerpt:       z.string().optional(),
  featuredImage: z.string().optional().nullable(),
  seo:           z.record(z.unknown()).optional(),
})

export const updateBlogPostSchema = z.object({
  categoryId:    z.string().uuid().optional().nullable(),
  title:         z.string().min(1).max(255).optional(),
  slug:          z.string().min(1).max(255).regex(/^[a-z0-9-]+$/).optional(),
  excerpt:       z.string().optional(),
  featuredImage: z.string().optional().nullable(),
  seo:           z.record(z.unknown()).optional(),
})

export const saveBlogDraftSchema = z.object({
  builderData: z.record(z.unknown()),
  seo:         z.record(z.unknown()).optional(),
})

export {
  createFormSchema,
  updateFormSchema,
  createFormFieldSchema,
  updateFormFieldSchema,
  reorderFieldsSchema,
} from "@runly/validators";
