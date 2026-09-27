// apps/api/src/routes/catalog/catalog-product-service.js

import { publicUrlWithVariant, signedUrlsWithVariant } from '../../lib/image-variants.js'

const PUBLIC_BUCKET  = 'runly-website'
const SIGNED_URL_TTL = 3600
const IMAGE_VARIANT  = 'product'

// Shared with the "Stock" filter and the KPI strip on CatalogProductsScreen —
// keep both in sync with this value.
const LOW_STOCK_THRESHOLD = 10

export class CatalogRefError extends Error {
  constructor(message) {
    super(message)
    this.name = 'CatalogRefError'
    this.status = 400
  }
}

export function createCatalogProductService({ prisma, supabaseAdmin }) {

  // Rejects a category/product FK reference that belongs to another company.
  async function assertRowInCompany(table, id, companyId, label) {
    if (id === undefined || id === null || id === '') return
    const rows = await prisma.$queryRawUnsafe(
      `SELECT 1 FROM ${table} WHERE id = $1::uuid AND company_id = $2::uuid LIMIT 1`,
      id, companyId,
    )
    if (!rows.length) {
      throw new CatalogRefError(`${label} no pertenece a la empresa actual.`)
    }
  }

  async function resolveImageUrls(rows) {
    if (!supabaseAdmin) return rows
    const ids = [...new Set(rows.map((r) => r.cover_asset_id).filter(Boolean))]
    if (!ids.length) return rows

    const placeholders = ids.map((_, i) => `$${i + 1}::uuid`).join(', ')
    const assets = await prisma.$queryRawUnsafe(
      `SELECT id, object_key, bucket, visibility FROM file_asset WHERE id IN (${placeholders})`,
      ...ids,
    )
    if (!assets.length) return rows

    const urlMap = new Map()

    const publicAssets  = assets.filter((a) => a.bucket === PUBLIC_BUCKET)
    const privateAssets = assets.filter((a) => a.bucket !== PUBLIC_BUCKET)

    for (const a of publicAssets) {
      const publicUrl = publicUrlWithVariant(supabaseAdmin, a.bucket, a.object_key, IMAGE_VARIANT)
      urlMap.set(String(a.id), publicUrl)
    }

    if (privateAssets.length) {
      const byBucket = new Map()
      for (const a of privateAssets) {
        if (!byBucket.has(a.bucket)) byBucket.set(a.bucket, [])
        byBucket.get(a.bucket).push(a)
      }
      await Promise.all([...byBucket.entries()].map(async ([bucket, batch]) => {
        const paths = batch.map((a) => a.object_key)
        const signedUrls = await signedUrlsWithVariant(supabaseAdmin, bucket, paths, IMAGE_VARIANT, SIGNED_URL_TTL)
        batch.forEach((asset, index) => {
          urlMap.set(String(asset.id), signedUrls[index] ?? null)
        })
      }))
    }

    return rows.map((r) => ({
      ...r,
      image_url: r.cover_asset_id ? (urlMap.get(String(r.cover_asset_id)) ?? null) : null,
    }))
  }

  async function listCategoriesTree({ companyId }) {
    const rows = await prisma.$queryRaw`
      SELECT id, name, slug, description, parent_id, cover_asset_id,
             position, enabled, created_at, updated_at
      FROM catalog_category
      WHERE company_id = ${companyId}::uuid AND enabled = true
      ORDER BY position ASC, name ASC
    `
    const roots = rows.filter(r => r.parent_id === null)
    return roots.map(r => ({
      ...r,
      children: rows.filter(c => String(c.parent_id) === String(r.id)),
    }))
  }

  async function listCategories({ companyId }) {
    return prisma.$queryRaw`
      SELECT c.id, c.name, c.slug, c.description, c.parent_id, c.cover_asset_id,
             c.position, c.enabled, c.created_at, c.updated_at,
             COUNT(p.id)::int AS product_count
      FROM catalog_category c
      LEFT JOIN catalog_product p ON p.category_id = c.id AND p.enabled = true
      WHERE c.company_id = ${companyId}::uuid AND c.enabled = true
      GROUP BY c.id
      ORDER BY c.position ASC, c.name ASC
    `
  }

  async function listCategoriesPaginated({ companyId, search, sort, order, limit = 20, offset = 0 }) {
    const likeSearch = search ? `%${String(search).trim()}%` : null
    const safeLimit  = Math.min(Math.max(Number.parseInt(String(limit),  10) || 20, 1), 200)
    const safeOffset = Math.max(Number.parseInt(String(offset), 10) || 0, 0)
    const ALLOWED_SORT = ['name', 'slug', 'position', 'created_at']
    const safeSort  = ALLOWED_SORT.includes(sort) ? sort : 'position'
    const safeOrder = order === 'desc' ? 'DESC' : 'ASC'

    const rows = await prisma.$queryRawUnsafe(
      `SELECT c.id, c.name, c.slug, c.description, c.parent_id,
              c.position, c.enabled, c.created_at,
              p.name AS parent_name
       FROM catalog_category c
       LEFT JOIN catalog_category p ON p.id = c.parent_id
       WHERE c.company_id = $1::uuid AND c.enabled = true
         AND ($2::text IS NULL OR c.name ILIKE $2 OR c.slug ILIKE $2)
       ORDER BY c.${safeSort} ${safeOrder}
       LIMIT $3 OFFSET $4`,
      companyId, likeSearch, safeLimit, safeOffset,
    )

    const [{ total }] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total
       FROM catalog_category c
       WHERE c.company_id = $1::uuid AND c.enabled = true
         AND ($2::text IS NULL OR c.name ILIKE $2 OR c.slug ILIKE $2)`,
      companyId, likeSearch,
    )

    return { data: rows, total }
  }

  async function getCategoryById({ companyId, id }) {
    const rows = await prisma.$queryRaw`
      SELECT * FROM catalog_category
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
      LIMIT 1
    `
    return rows[0] ?? null
  }

  async function createCategory({ companyId, data }) {
    await assertRowInCompany('catalog_category', data.parent_id, companyId, 'La categoria padre')
    const rows = await prisma.$queryRaw`
      INSERT INTO catalog_category
        (company_id, name, slug, description, parent_id, cover_asset_id, position, created_at, updated_at)
      VALUES (
        ${companyId}::uuid,
        ${data.name},
        ${data.slug},
        ${data.description ?? null},
        ${data.parent_id ?? null}::uuid,
        ${data.cover_asset_id ?? null}::uuid,
        ${data.position ?? 0},
        now(),
        now()
      )
      RETURNING *
    `
    return rows[0]
  }

  async function updateCategory({ companyId, id, data }) {
    if (data.parent_id !== undefined && data.parent_id !== null && String(data.parent_id) === String(id)) {
      throw new CatalogRefError('Una categoria no puede ser su propia padre.')
    }
    await assertRowInCompany('catalog_category', data.parent_id, companyId, 'La categoria padre')
    const map = {
      name:           data.name,
      slug:           data.slug,
      description:    data.description,
      parent_id:      data.parent_id,
      cover_asset_id: data.cover_asset_id,
      position:       data.position,
    }
    const entries = Object.entries(map).filter(([, v]) => v !== undefined)
    if (!entries.length) return getCategoryById({ companyId, id })
    const setParts = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ')
    const values   = entries.map(([, v]) => v)
    const sql = `UPDATE catalog_category SET ${setParts}, updated_at = now()
                 WHERE id = $1::uuid AND company_id = $${values.length + 2}::uuid
                 RETURNING *`
    const rows = await prisma.$queryRawUnsafe(sql, id, ...values, companyId)
    return rows[0] ?? null
  }

  async function deleteCategory({ companyId, id }) {
    await prisma.$queryRaw`
      UPDATE catalog_category SET enabled = false, updated_at = now()
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
    `
  }

  async function reorderCategories({ companyId, items }) {
    await Promise.all(
      items.map(({ id, position }) =>
        prisma.$queryRaw`
          UPDATE catalog_category
          SET position = ${position}, updated_at = now()
          WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
        `
      )
    )
  }

  // stockStatus: 'out' (tracked, stock = 0) | 'low' (tracked, 0 < stock <= threshold) | 'ok' (untracked, or tracked above threshold)
  function stockStatusClause(paramIndex) {
    return `(
      $${paramIndex}::text IS NULL OR (
        ($${paramIndex} = 'out' AND p.track_stock = true AND p.stock = 0) OR
        ($${paramIndex} = 'low' AND p.track_stock = true AND p.stock > 0 AND p.stock <= ${LOW_STOCK_THRESHOLD}) OR
        ($${paramIndex} = 'ok'  AND (p.track_stock = false OR p.stock > ${LOW_STOCK_THRESHOLD}))
      )
    )`
  }

  async function listProducts({ companyId, categoryId, type, published, stockStatus, search, limit = 50, offset = 0 }) {
    const safeLimit  = Math.min(Math.max(Number.parseInt(String(limit  ?? 50),  10) || 50,  1), 500)
    const safeOffset = Math.max(Number.parseInt(String(offset ?? 0),   10) || 0,  0)
    const likeSearch = search ? `%${String(search).trim()}%` : null
    const catId      = categoryId ?? null
    const prodType   = type ?? null
    const pubFilter  = published === undefined ? null : (published === 'true' || published === true)
    const stockParam = ['out', 'low', 'ok'].includes(stockStatus) ? stockStatus : null

    const rows = await prisma.$queryRawUnsafe(
      `SELECT p.id, p.name, p.slug, p.sku, p.product_type, p.price, p.compare_price, p.currency,
              p.stock, p.track_stock, p.cover_asset_id, p.published,
              p.created_at, c.name AS category_name,
              CASE
                WHEN p.track_stock = false THEN 'ok'
                WHEN p.stock = 0 THEN 'out'
                WHEN p.stock <= ${LOW_STOCK_THRESHOLD} THEN 'low'
                ELSE 'ok'
              END AS stock_status
       FROM catalog_product p
       LEFT JOIN catalog_category c ON c.id = p.category_id
       WHERE p.company_id = $1::uuid
         AND p.enabled = true
         AND ($2::uuid IS NULL OR p.category_id = $2::uuid)
         AND ($3::text IS NULL OR p.product_type = $3)
         AND ($4::boolean IS NULL OR p.published = $4)
         AND ($5::text IS NULL OR p.name ILIKE $5)
         AND ${stockStatusClause(6)}
       ORDER BY p.created_at DESC
       LIMIT $7 OFFSET $8`,
      companyId, catId, prodType, pubFilter, likeSearch, stockParam, safeLimit, safeOffset,
    )

    const [{ total }] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total
       FROM catalog_product p
       WHERE p.company_id = $1::uuid
         AND p.enabled = true
         AND ($2::uuid IS NULL OR p.category_id = $2::uuid)
         AND ($3::text IS NULL OR p.product_type = $3)
         AND ($4::boolean IS NULL OR p.published = $4)
         AND ($5::text IS NULL OR p.name ILIKE $5)
         AND ${stockStatusClause(6)}`,
      companyId, catId, prodType, pubFilter, likeSearch, stockParam,
    )

    const enriched = await resolveImageUrls(rows)
    return { data: enriched, total }
  }

  async function getProductStats({ companyId }) {
    const rows = await prisma.$queryRaw`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE published = true)::int AS published,
        COUNT(*) FILTER (WHERE published = false)::int AS draft,
        COUNT(*) FILTER (WHERE track_stock = true AND stock = 0)::int AS out_of_stock,
        COUNT(*) FILTER (WHERE track_stock = true AND stock > 0 AND stock <= ${LOW_STOCK_THRESHOLD})::int AS low_stock
      FROM catalog_product
      WHERE company_id = ${companyId}::uuid AND enabled = true
    `
    const row = rows[0] ?? { total: 0, published: 0, draft: 0, out_of_stock: 0, low_stock: 0 }
    return {
      total: row.total,
      published: row.published,
      draft: row.draft,
      outOfStock: row.out_of_stock,
      lowStock: row.low_stock,
      lowStockThreshold: LOW_STOCK_THRESHOLD,
    }
  }

  async function getProductById({ companyId, id }) {
    const rows = await prisma.$queryRaw`
      SELECT p.*, c.name AS category_name
      FROM catalog_product p
      LEFT JOIN catalog_category c ON c.id = p.category_id
      WHERE p.id = ${id}::uuid AND p.company_id = ${companyId}::uuid
      LIMIT 1
    `
    return rows[0] ?? null
  }

  async function getFullProductById({ companyId, id }) {
    const rows = await prisma.$queryRaw`
      SELECT p.*, c.name AS category_name
      FROM catalog_product p
      LEFT JOIN catalog_category c ON c.id = p.category_id
      WHERE p.id = ${id}::uuid AND p.company_id = ${companyId}::uuid
      LIMIT 1
    `
    if (!rows[0]) return null
    const product = rows[0]

    if (product.product_type === 'VARIABLE') {
      const options = await prisma.$queryRaw`
        SELECT o.id, o.name, o.position
        FROM catalog_product_option o
        WHERE o.product_id = ${id}::uuid AND o.company_id = ${companyId}::uuid
        ORDER BY o.position ASC
      `
      const vals = await prisma.$queryRaw`
        SELECT v.id, v.option_id, v.value, v.position
        FROM catalog_product_option_value v
        JOIN catalog_product_option o ON o.id = v.option_id
        WHERE o.product_id = ${id}::uuid
        ORDER BY v.position ASC
      `
      product.options = options.map(o => ({
        ...o,
        values: vals.filter(v => String(v.option_id) === String(o.id)),
      }))
      product.variants = await prisma.$queryRaw`
        SELECT * FROM catalog_product_variant
        WHERE product_id = ${id}::uuid AND company_id = ${companyId}::uuid AND enabled = true
        ORDER BY created_at ASC
      `
    }

    return product
  }

  async function createProduct({ companyId, data }) {
    await assertRowInCompany('catalog_category', data.category_id, companyId, 'La categoria')
    const rows = await prisma.$queryRaw`
      INSERT INTO catalog_product
        (company_id, category_id, product_type, name, slug, description,
         sku, barcode, price, compare_price, currency, weight,
         stock, track_stock, attributes, cover_asset_id, images,
         meta_title, meta_description, published)
      VALUES (
        ${companyId}::uuid,
        ${data.category_id ?? null}::uuid,
        ${data.product_type ?? 'SIMPLE'},
        ${data.name},
        ${data.slug},
        ${data.description ?? null},
        ${data.sku ?? null},
        ${data.barcode ?? null},
        ${data.price ?? 0},
        ${data.compare_price ?? null},
        ${data.currency ?? 'USD'},
        ${data.weight ?? null},
        ${data.stock ?? 0},
        ${data.track_stock ?? false},
        ${JSON.stringify(data.attributes ?? [])}::jsonb,
        ${data.cover_asset_id ?? null}::uuid,
        ${JSON.stringify(data.images ?? [])}::jsonb,
        ${data.meta_title ?? null},
        ${data.meta_description ?? null},
        ${data.published ?? false}
      )
      RETURNING *
    `
    return rows[0]
  }

  async function updateProduct({ companyId, id, data }) {
    await assertRowInCompany('catalog_category', data.category_id, companyId, 'La categoria')
    const map = {
      category_id:      data.category_id,
      product_type:     data.product_type,
      name:             data.name,
      slug:             data.slug,
      description:      data.description,
      sku:              data.sku,
      barcode:          data.barcode,
      price:            data.price,
      compare_price:    data.compare_price,
      currency:         data.currency,
      weight:           data.weight,
      stock:            data.stock,
      track_stock:      data.track_stock,
      attributes:       data.attributes !== undefined ? JSON.stringify(data.attributes) : undefined,
      cover_asset_id:   data.cover_asset_id,
      images:           data.images !== undefined ? JSON.stringify(data.images) : undefined,
      meta_title:       data.meta_title,
      meta_description: data.meta_description,
      published:        data.published,
    }
    const entries = Object.entries(map).filter(([, v]) => v !== undefined)
    if (!entries.length) return getProductById({ companyId, id })
    const setParts = entries.map(([k], i) => `${k} = $${i + 2}`).join(', ')
    const values   = entries.map(([, v]) => v)
    const sql = `UPDATE catalog_product SET ${setParts}, updated_at = now()
                 WHERE id = $1::uuid AND company_id = $${values.length + 2}::uuid AND enabled = true
                 RETURNING *`
    const rows = await prisma.$queryRawUnsafe(sql, id, ...values, companyId)
    return rows[0] ?? null
  }

  async function publishProduct({ companyId, id, published }) {
    const rows = await prisma.$queryRaw`
      UPDATE catalog_product SET published = ${published}, updated_at = now()
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid AND enabled = true
      RETURNING *
    `
    return rows[0] ?? null
  }

  async function deleteProduct({ companyId, id }) {
    await prisma.$queryRaw`
      UPDATE catalog_product SET enabled = false, updated_at = now()
      WHERE id = ${id}::uuid AND company_id = ${companyId}::uuid
    `
  }

  return {
    listCategoriesTree,
    listCategories,
    listCategoriesPaginated,
    getCategoryById,
    createCategory,
    updateCategory,
    deleteCategory,
    reorderCategories,
    listProducts,
    getProductStats,
    getProductById,
    getFullProductById,
    createProduct,
    updateProduct,
    publishProduct,
    deleteProduct,
  }
}
