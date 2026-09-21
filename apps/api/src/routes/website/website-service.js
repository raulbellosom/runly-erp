import { WebsiteServiceError, notFound, conflict } from './service-helpers.js'
import { encryptPassword } from '../../services/smtp-service.js'
import { invalidateCache, invalidatePrimaryCache } from '../../services/dist-serve-service.js'

export { WebsiteServiceError }

export function createWebsiteService({ prisma }) {
  function publicSite(site) {
    if (!site) return null
    const { stripeSecretKey, turnstileSecretKey, ...rest } = site
    return {
      ...rest,
      stripeSecretKeySet: Boolean(stripeSecretKey),
      turnstileSecretKeySet: Boolean(turnstileSecretKey),
    }
  }

  function encryptedSecret(value) {
    if (value === null || value === '') return null
    return encryptPassword(value)
  }


  async function getSite({ companyId }) {
    const site = await prisma.websiteSite.findFirst({
      where: { companyId, enabled: true },
      orderBy: { createdAt: 'asc' },
    })
    if (!site) return null
    // Never expose the encrypted secret key — return a boolean flag instead
    return publicSite(site)
  }

  async function createSite({ companyId, data, actorId }) {
    const created = await prisma.websiteSite.create({
      data: {
        companyId,
        name:          data.name,
        domain:        data.domain ?? null,
        defaultLocale: data.defaultLocale ?? 'es',
        siteType:      data.siteType ?? 'website',
        analyticsMode: data.analyticsMode ?? 'off',
        turnstileSiteKey: data.turnstileSiteKey ?? null,
        turnstileSecretKey: data.turnstileSecretKey
          ? encryptedSecret(data.turnstileSecretKey)
          : null,
        status:        'draft',
        enabled:       true,
      },
    })
    await prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        moduleKey: 'runly.website',
        entityType: 'website.site',
        entityId: created.id,
        action: 'site.create',
        before: null,
        after: JSON.stringify(publicSite(created)),
      },
    })
    return publicSite(created)
  }

  async function updateSite({ companyId, siteId, data, actorId }) {
    const before = await prisma.websiteSite.findFirst({
      where: { id: siteId, companyId },
    })
    if (!before) throw notFound('Sitio')

    const after = await prisma.websiteSite.update({
      where: { id: siteId },
      data: {
        ...(data.name                !== undefined && { name:                 data.name }),
        ...(data.domain              !== undefined && { domain:               data.domain }),
        ...(data.status              !== undefined && { status:               data.status }),
        ...(data.siteType            !== undefined && { siteType:             data.siteType }),
        ...(data.homepagePageId      !== undefined && { homepagePageId:       data.homepagePageId }),
        ...(data.themeId             !== undefined && { themeId:              data.themeId }),
        ...(data.settings            !== undefined && { settings:             data.settings }),
        ...(data.seoDefaults         !== undefined && { seoDefaults:          data.seoDefaults }),
        ...(data.stripePublishableKey  !== undefined && { stripePublishableKey:  data.stripePublishableKey }),
        ...(data.stripeSecretKey      !== undefined && { stripeSecretKey:       encryptedSecret(data.stripeSecretKey) }),
        ...(data.stripeSuccessMessage !== undefined && { stripeSuccessMessage:  data.stripeSuccessMessage }),
        ...(data.analyticsMode        !== undefined && { analyticsMode:         data.analyticsMode }),
        ...(data.turnstileSiteKey     !== undefined && { turnstileSiteKey:      data.turnstileSiteKey }),
        ...(data.turnstileSecretKey   !== undefined && { turnstileSecretKey:    encryptedSecret(data.turnstileSecretKey) }),
      },
    })
    const beforePublic = publicSite(before)
    const afterPublic = publicSite(after)
    await prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        moduleKey: 'runly.website',
        entityType: 'website.site',
        entityId: siteId,
        action: 'site.update',
        before: JSON.stringify(beforePublic),
        after: JSON.stringify(afterPublic),
      },
    })
    invalidateCache(companyId)
    invalidatePrimaryCache()
    return afterPublic
  }

  async function deleteSite({ companyId, siteId, actorId }) {
    const site = await prisma.websiteSite.findFirst({
      where: { id: siteId, companyId },
      select: { id: true, name: true },
    })
    if (!site) throw notFound('Sitio')

    await prisma.auditLog.create({
      data: {
        actorId:    actorId ?? null,
        moduleKey:  'runly.website',
        entityType: 'website.site',
        entityId:   siteId,
        action:     'site.delete',
        before:     JSON.stringify(site),
        after:      null,
      },
    })

    await prisma.$transaction(async (tx) => {
      const menuIds = (await tx.websiteMenu.findMany({
        where: { siteId }, select: { id: true },
      })).map((m) => m.id)

      const pageIds = (await tx.websitePage.findMany({
        where: { siteId }, select: { id: true },
      })).map((p) => p.id)

      // WebsiteFormField and WebsiteFormSubmission cascade from WebsiteForm (onDelete: Cascade)
      await tx.websiteForm.deleteMany({ where: { siteId } })

      if (menuIds.length) {
        await tx.websiteMenuItem.deleteMany({ where: { menuId: { in: menuIds } } })
      }
      await tx.websiteMenu.deleteMany({ where: { siteId } })
      await tx.websitePublishedRender.deleteMany({ where: { siteId } })

      if (pageIds.length) {
        await tx.websitePageVersion.deleteMany({ where: { pageId: { in: pageIds } } })
      }
      await tx.websitePage.deleteMany({ where: { siteId } })
      await tx.websiteBlogPost.deleteMany({ where: { siteId } })
      await tx.websiteBlogCategory.deleteMany({ where: { siteId } })
      await tx.websiteTheme.deleteMany({ where: { siteId } })
      await tx.websiteSite.delete({ where: { id: siteId } })
    })
  }

  async function listPages({ companyId, siteId, page = 1, pageSize = 30, pageType = null, status = null }) {
    const skip = (page - 1) * pageSize
    const where = { companyId, siteId, enabled: true }
    if (pageType) where.pageType = pageType
    if (status) where.status = status
    const [data, total] = await Promise.all([
      prisma.websitePage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          title: true,
          slug: true,
          routePath: true,
          status: true,
          pageType: true,
          visibility: true,
          publishedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.websitePage.count({ where }),
    ])
    return { data, total, page, pageSize }
  }

  async function getPage({ companyId, pageId }) {
    const page = await prisma.websitePage.findFirst({
      where: { id: pageId, companyId, enabled: true },
    })
    if (!page) throw notFound('Pagina')
    return page
  }

  async function createPage({ companyId, siteId, data, actorId }) {
    const existing = await prisma.websitePage.findFirst({
      where: { companyId, siteId, routePath: data.routePath },
    })

    if (existing) {
      if (existing.enabled) throw conflict(`La ruta "${data.routePath}" ya esta en uso.`)

      // Soft-deleted page with same route — reactivate and reset instead of inserting
      const restored = await prisma.websitePage.update({
        where: { id: existing.id },
        data: {
          title:            data.title,
          slug:             data.slug,
          status:           'draft',
          pageType:         data.pageType ?? 'page',
          visibility:       data.visibility ?? 'public',
          draftBuilderData: {},
          publishedBuilderData: null,
          seo:              data.seo ?? {},
          updatedById:      actorId ?? null,
          enabled:          true,
        },
      })
      await prisma.auditLog.create({
        data: {
          actorId: actorId ?? null,
          moduleKey: 'runly.website',
          entityType: 'website.page',
          entityId: restored.id,
          action: 'page.restore',
          before: JSON.stringify(existing),
          after: JSON.stringify(restored),
        },
      })
      return restored
    }

    const created = await prisma.websitePage.create({
      data: {
        companyId,
        siteId,
        title: data.title,
        slug: data.slug,
        routePath: data.routePath,
        status: 'draft',
        pageType: data.pageType ?? 'page',
        visibility: data.visibility ?? 'public',
        draftBuilderData: {},
        seo: data.seo ?? {},
        createdById: actorId ?? null,
        updatedById: actorId ?? null,
        enabled: true,
      },
    })
    await prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        moduleKey: 'runly.website',
        entityType: 'website.page',
        entityId: created.id,
        action: 'page.create',
        before: null,
        after: JSON.stringify(created),
      },
    })
    return created
  }

  async function updatePage({ companyId, pageId, data, actorId }) {
    const before = await getPage({ companyId, pageId })
    const after = await prisma.websitePage.update({
      where: { id: pageId },
      data: {
        ...(data.title      !== undefined && { title:      data.title }),
        ...(data.slug       !== undefined && { slug:       data.slug }),
        ...(data.routePath  !== undefined && { routePath:  data.routePath }),
        ...(data.visibility !== undefined && { visibility: data.visibility }),
        ...(data.status     !== undefined && { status:     data.status }),
        ...(data.seo        !== undefined && { seo:        data.seo }),
        updatedById: actorId ?? null,
      },
    })
    await prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        moduleKey: 'runly.website',
        entityType: 'website.page',
        entityId: pageId,
        action: 'page.update',
        before: JSON.stringify(before),
        after: JSON.stringify(after),
      },
    })
    return after
  }

  async function saveDraft({ companyId, pageId, builderData, seo, actorId }) {
    const before = await getPage({ companyId, pageId })
    const after = await prisma.websitePage.update({
      where: { id: pageId },
      data: {
        draftBuilderData: builderData,
        ...(seo !== undefined && { seo }),
        updatedById: actorId ?? null,
      },
    })
    await prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        moduleKey: 'runly.website',
        entityType: 'website.page',
        entityId: pageId,
        action: 'page.save_draft',
        before: JSON.stringify({ draftBuilderData: before.draftBuilderData }),
        after:  JSON.stringify({ draftBuilderData: after.draftBuilderData }),
      },
    })
    return after
  }

  async function publishPage({ companyId, pageId, actorId }) {
    const before = await getPage({ companyId, pageId })

    const maxVersion = await prisma.websitePageVersion.aggregate({
      where: { pageId, companyId },
      _max: { versionNumber: true },
    })
    const nextVersion = (maxVersion._max.versionNumber ?? 0) + 1

    await prisma.websitePageVersion.create({
      data: {
        companyId,
        pageId,
        versionNumber: nextVersion,
        builderData: before.draftBuilderData ?? {},
        seo: before.seo ?? {},
        status: 'published',
        createdById: actorId ?? null,
      },
    })

    const after = await prisma.websitePage.update({
      where: { id: pageId },
      data: {
        publishedBuilderData: before.draftBuilderData,
        status: 'published',
        publishedAt: new Date(),
        updatedById: actorId ?? null,
      },
    })

    await prisma.websitePublishedRender.upsert({
      where: { siteId_path: { siteId: after.siteId, path: after.routePath } },
      create: {
        companyId,
        siteId: after.siteId,
        sourceType: 'page',
        sourceId: pageId,
        path: after.routePath,
        statusCode: 200,
        publishedAt: new Date(),
      },
      update: {
        sourceId: pageId,
        sourceType: 'page',
        statusCode: 200,
        publishedAt: new Date(),
      },
    })

    await prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        moduleKey: 'runly.website',
        entityType: 'website.page',
        entityId: pageId,
        action: 'page.publish',
        before: JSON.stringify({ status: before.status }),
        after:  JSON.stringify({ status: 'published', publishedAt: after.publishedAt }),
      },
    })
    return after
  }

  async function softDeletePage({ companyId, pageId, actorId }) {
    const before = await getPage({ companyId, pageId })
    await prisma.websitePage.update({
      where: { id: pageId },
      data: { enabled: false },
    })
    await prisma.auditLog.create({
      data: {
        actorId: actorId ?? null,
        moduleKey: 'runly.website',
        entityType: 'website.page',
        entityId: pageId,
        action: 'page.delete',
        before: JSON.stringify(before),
        after: null,
      },
    })
  }

  async function listThemes({ companyId, siteId }) {
    return prisma.websiteTheme.findMany({
      where: { companyId, siteId, enabled: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, isDefault: true, tokens: true, typography: true, layout: true, customCss: true },
    })
  }

  async function listMenus({ companyId, siteId }) {
    return prisma.$queryRaw`
      SELECT m.id, m.name, m.location,
        COALESCE(
          json_agg(
            json_build_object(
              'id', mi.id, 'label', mi.label, 'url', mi.url,
              'page_id', mi.page_id, 'target', mi.target,
              'sort_order', mi.sort_order, 'parent_id', mi.parent_id,
              'icon', mi.icon
            ) ORDER BY mi.sort_order
          ) FILTER (WHERE mi.id IS NOT NULL),
          '[]'::json
        ) AS items
      FROM website_menu m
      LEFT JOIN website_menu_item mi ON mi.menu_id = m.id AND mi.enabled = true
      WHERE m.company_id = ${companyId} AND m.site_id = ${siteId} AND m.enabled = true
      GROUP BY m.id, m.name, m.location
    `
  }

  async function createMenu({ companyId, siteId, data }) {
    return prisma.websiteMenu.create({
      data: { companyId, siteId, name: data.name, location: data.location ?? 'header' },
    })
  }

  async function updateMenu({ companyId, menuId, data }) {
    const menu = await prisma.websiteMenu.findFirst({ where: { id: menuId, companyId } })
    if (!menu) throw notFound('Menu')
    return prisma.websiteMenu.update({ where: { id: menuId }, data })
  }

  async function softDeleteMenu({ companyId, menuId }) {
    const menu = await prisma.websiteMenu.findFirst({ where: { id: menuId, companyId } })
    if (!menu) throw notFound('Menu')
    return prisma.websiteMenu.update({ where: { id: menuId }, data: { enabled: false } })
  }

  async function createMenuItem({ companyId, menuId, data }) {
    const menu = await prisma.websiteMenu.findFirst({ where: { id: menuId, companyId } })
    if (!menu) throw notFound('Menu')
    return prisma.websiteMenuItem.create({
      data: {
        companyId,
        menuId,
        label:     data.label,
        url:       data.url ?? null,
        pageId:    data.pageId ?? null,
        parentId:  data.parentId ?? null,
        target:    data.target ?? '_self',
        icon:      data.icon ?? null,
        sortOrder: data.sortOrder ?? 0,
      },
    })
  }

  async function updateMenuItem({ companyId, itemId, data }) {
    const item = await prisma.websiteMenuItem.findFirst({ where: { id: itemId, companyId } })
    if (!item) throw notFound('Elemento de menu')
    return prisma.websiteMenuItem.update({ where: { id: itemId }, data })
  }

  async function softDeleteMenuItem({ companyId, itemId }) {
    const item = await prisma.websiteMenuItem.findFirst({ where: { id: itemId, companyId } })
    if (!item) throw notFound('Elemento de menu')
    return prisma.websiteMenuItem.update({ where: { id: itemId }, data: { enabled: false } })
  }

  async function reorderMenuItems({ companyId, items }) {
    return prisma.$transaction(
      items.map(({ id, sortOrder }) =>
        prisma.websiteMenuItem.update({ where: { id, companyId }, data: { sortOrder } })
      )
    )
  }

  async function getTheme({ companyId, themeId }) {
    return prisma.websiteTheme.findFirst({ where: { id: themeId, companyId, enabled: true } })
  }

  async function createTheme({ companyId, siteId, data }) {
    if (data.isDefault) {
      await prisma.websiteTheme.updateMany({
        where: { companyId, siteId },
        data: { isDefault: false },
      })
    }
    return prisma.websiteTheme.create({
      data: {
        companyId,
        siteId,
        name:      data.name,
        tokens:    data.tokens    ?? {},
        typography:data.typography ?? {},
        layout:    data.layout    ?? {},
        customCss: data.customCss ?? null,
        isDefault: data.isDefault ?? false,
      },
    })
  }

  async function updateTheme({ companyId, themeId, data }) {
    const theme = await prisma.websiteTheme.findFirst({ where: { id: themeId, companyId } })
    if (!theme) throw notFound('Tema')
    if (data.isDefault) {
      await prisma.websiteTheme.updateMany({
        where: { companyId, siteId: theme.siteId, id: { not: themeId } },
        data: { isDefault: false },
      })
    }
    return prisma.websiteTheme.update({ where: { id: themeId }, data })
  }

  async function getActiveTheme({ companyId }) {
    return prisma.websiteTheme.findFirst({
      where: { companyId, enabled: true },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    })
  }

  async function upsertTheme({ companyId, siteId, tokens, typography }) {
    const existing = await prisma.websiteTheme.findFirst({
      where: { companyId, siteId, enabled: true },
      select: { id: true },
    })
    if (existing) {
      return prisma.websiteTheme.update({
        where: { id: existing.id },
        data: {
          ...(tokens     !== undefined && { tokens }),
          ...(typography !== undefined && { typography }),
        },
      })
    }
    return prisma.websiteTheme.create({
      data: {
        companyId,
        siteId,
        name: 'Default',
        tokens:     tokens     ?? {},
        typography: typography ?? {},
        layout:     {},
        isDefault:  true,
      },
    })
  }

  async function getPageByPath({ companyId, siteId, routePath }) {
    return prisma.websitePage.findFirst({
      where: { companyId, siteId, routePath, enabled: true },
    })
  }

  async function listBlogCategories({ companyId, siteId }) {
    return prisma.websiteBlogCategory.findMany({
      where: { companyId, siteId, enabled: true },
      orderBy: { name: 'asc' },
    })
  }

  async function createBlogCategory({ companyId, siteId, data }) {
    return prisma.websiteBlogCategory.create({
      data: { companyId, siteId, name: data.name, slug: data.slug, description: data.description ?? null },
    })
  }

  async function updateBlogCategory({ companyId, categoryId, data }) {
    const cat = await prisma.websiteBlogCategory.findFirst({ where: { id: categoryId, companyId } })
    if (!cat) throw notFound('Categoria')
    return prisma.websiteBlogCategory.update({ where: { id: categoryId }, data })
  }

  async function softDeleteBlogCategory({ companyId, categoryId }) {
    const cat = await prisma.websiteBlogCategory.findFirst({ where: { id: categoryId, companyId } })
    if (!cat) throw notFound('Categoria')
    return prisma.websiteBlogCategory.update({ where: { id: categoryId }, data: { enabled: false } })
  }

  async function listBlogPosts({ companyId, siteId, status, categoryId, page = 1, pageSize = 20 }) {
    const skip = (page - 1) * pageSize
    const where = {
      companyId,
      siteId,
      enabled: true,
      ...(status     && { status }),
      ...(categoryId && { categoryId }),
    }
    const [data, total] = await Promise.all([
      prisma.websiteBlogPost.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        include: { category: { select: { id: true, name: true } } },
      }),
      prisma.websiteBlogPost.count({ where }),
    ])
    return { data, total, page, pageSize }
  }

  async function getBlogPost({ companyId, postId }) {
    const post = await prisma.websiteBlogPost.findFirst({
      where: { id: postId, companyId, enabled: true },
      include: { category: true },
    })
    if (!post) throw notFound('Entrada de blog')
    return post
  }

  async function createBlogPost({ companyId, siteId, data, actorId }) {
    return prisma.websiteBlogPost.create({
      data: {
        companyId, siteId,
        title:        data.title,
        slug:         data.slug,
        categoryId:   data.categoryId ?? null,
        excerpt:      data.excerpt ?? null,
        featuredImage:data.featuredImage ?? null,
        seo:          data.seo ?? null,
        createdById:  actorId ?? null,
      },
    })
  }

  async function updateBlogPost({ companyId, postId, data, actorId }) {
    const post = await prisma.websiteBlogPost.findFirst({ where: { id: postId, companyId } })
    if (!post) throw notFound('Entrada de blog')
    return prisma.websiteBlogPost.update({
      where: { id: postId },
      data: { ...data, updatedById: actorId ?? null },
    })
  }

  async function saveBlogDraft({ companyId, postId, builderData, seo }) {
    const post = await prisma.websiteBlogPost.findFirst({ where: { id: postId, companyId } })
    if (!post) throw notFound('Entrada de blog')
    return prisma.websiteBlogPost.update({
      where: { id: postId },
      data: { draftBuilderData: builderData, ...(seo && { seo }) },
    })
  }

  async function publishBlogPost({ companyId, postId, actorId }) {
    const post = await prisma.websiteBlogPost.findFirst({ where: { id: postId, companyId } })
    if (!post) throw notFound('Entrada de blog')
    const updated = await prisma.websiteBlogPost.update({
      where: { id: postId },
      data: {
        status:              'published',
        publishedBuilderData: post.draftBuilderData,
        publishedAt:         new Date(),
        updatedById:         actorId ?? null,
      },
    })
    const site = await prisma.websiteSite.findFirst({ where: { id: post.siteId } })
    if (site) {
      await prisma.websitePublishedRender.upsert({
        where:  { siteId_path: { siteId: site.id, path: `/blog/${post.slug}` } },
        update: { updatedAt: new Date() },
        create: { companyId, siteId: site.id, sourceType: 'blog_post', sourceId: postId, path: `/blog/${post.slug}` },
      })
    }
    return updated
  }

  async function softDeleteBlogPost({ companyId, postId }) {
    const post = await prisma.websiteBlogPost.findFirst({ where: { id: postId, companyId } })
    if (!post) throw notFound('Entrada de blog')
    return prisma.websiteBlogPost.update({ where: { id: postId }, data: { enabled: false } })
  }

  return {
    getSite,
    createSite,
    updateSite,
    deleteSite,
    listPages,
    getPage,
    getPageByPath,
    createPage,
    updatePage,
    saveDraft,
    publishPage,
    softDeletePage,
    listThemes,
    listMenus,
    createMenu,
    updateMenu,
    softDeleteMenu,
    createMenuItem,
    updateMenuItem,
    softDeleteMenuItem,
    reorderMenuItems,
    getTheme,
    getActiveTheme,
    createTheme,
    updateTheme,
    upsertTheme,
    listBlogCategories,
    createBlogCategory,
    updateBlogCategory,
    softDeleteBlogCategory,
    listBlogPosts,
    getBlogPost,
    createBlogPost,
    updateBlogPost,
    saveBlogDraft,
    publishBlogPost,
    softDeleteBlogPost,
  }
}
