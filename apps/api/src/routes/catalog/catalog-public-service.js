// apps/api/src/routes/catalog/catalog-public-service.js

export function createCatalogPublicService({ prisma }) {

  async function listPublicProducts({ companyId, categorySlug, search, limit = 20, offset = 0 }) {
    const safeLimit  = Math.min(Math.max(Number.parseInt(String(limit  ?? 20),  10) || 20,  1), 200)
    const safeOffset = Math.max(Number.parseInt(String(offset ?? 0), 10) || 0, 0)
    const likeSearch = search ? `%${String(search).trim()}%` : null
    const catSlug    = categorySlug ?? null

    const rows = await prisma.$queryRawUnsafe(
      `SELECT p.id, p.name, p.slug, p.description, p.product_type,
              p.price, p.compare_price, p.currency,
              p.stock, p.track_stock, p.cover_asset_id, p.images,
              p.category_id, c.name AS category_name, c.slug AS category_slug
       FROM catalog_product p
       LEFT JOIN catalog_category c ON c.id = p.category_id
       WHERE p.company_id = $1::uuid
         AND p.enabled = true
         AND p.published = true
         AND ($2::text IS NULL OR c.slug = $2)
         AND ($3::text IS NULL OR p.name ILIKE $3)
       ORDER BY p.created_at DESC
       LIMIT $4 OFFSET $5`,
      companyId, catSlug, likeSearch, safeLimit, safeOffset,
    )

    const [{ total }] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS total
       FROM catalog_product p
       LEFT JOIN catalog_category c ON c.id = p.category_id
       WHERE p.company_id = $1::uuid
         AND p.enabled = true
         AND p.published = true
         AND ($2::text IS NULL OR c.slug = $2)
         AND ($3::text IS NULL OR p.name ILIKE $3)`,
      companyId, catSlug, likeSearch,
    )

    return { data: rows, total }
  }

  async function getPublicProductBySlug({ companyId, slug }) {
    // Public storefront endpoint (no auth): expose only shopper-facing columns,
    // never company_id / internal SEO / stock-tracking flags.
    // Accepts either the product slug or its id, since the SDK's getProduct(id)
    // and slug-based storefront links both resolve through this one lookup.
    const rows = await prisma.$queryRaw`
      SELECT p.id, p.name, p.slug, p.description, p.product_type,
             p.price, p.compare_price, p.currency, p.weight,
             p.stock, p.track_stock, p.attributes, p.cover_asset_id, p.images,
             p.category_id, p.created_at,
             c.name AS category_name, c.slug AS category_slug
      FROM catalog_product p
      LEFT JOIN catalog_category c ON c.id = p.category_id
      WHERE p.company_id = ${companyId}::uuid
        AND (p.slug = ${slug} OR p.id::text = ${slug})
        AND p.enabled = true
        AND p.published = true
      LIMIT 1
    `
    if (!rows[0]) return null

    const product = rows[0]
    if (product.product_type === 'VARIABLE') {
      product.variants = await prisma.$queryRaw`
        SELECT id, option_values, price, compare_price, stock, cover_asset_id, sku
        FROM catalog_product_variant
        WHERE product_id = ${product.id}::uuid
          AND company_id = ${companyId}::uuid
          AND enabled = true
        ORDER BY created_at ASC
      `
    }
    return product
  }

  async function listPublicCategories({ companyId }) {
    const rows = await prisma.$queryRaw`
      SELECT c.id, c.name, c.slug, c.description, c.parent_id,
             c.cover_asset_id, c.position,
             COUNT(p.id)::int AS product_count
      FROM catalog_category c
      LEFT JOIN catalog_product p
        ON p.category_id = c.id AND p.enabled = true AND p.published = true
      WHERE c.company_id = ${companyId}::uuid AND c.enabled = true
      GROUP BY c.id, c.name, c.slug, c.description, c.parent_id, c.cover_asset_id, c.position
      ORDER BY c.position ASC, c.name ASC
    `
    const roots = rows.filter(r => r.parent_id === null)
    return roots.map(r => ({
      ...r,
      children: rows.filter(c => String(c.parent_id) === String(r.id)),
    }))
  }

  return {
    listPublicProducts,
    getPublicProductBySlug,
    listPublicCategories,
  }
}
