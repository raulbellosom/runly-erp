// apps/desktop/src/website/runlyBlocks/ProductsGridRenderer.jsx
import { useEffect, useState } from 'react'
import { fetchPublicCatalog, formatCatalogPrice, readAtlasConfig } from './catalogPublicClient.js'

const CARD_STYLE = {
  border: '1px solid #e2e8f0',
  borderRadius: '12px',
  overflow: 'hidden',
  background: '#ffffff',
  display: 'flex',
  flexDirection: 'column',
}

export default function ProductsGridRenderer({ categorySlug, limit = 8, columns = '4', showPrice = true }) {
  const [state, setState] = useState({ status: 'loading', products: [] })

  useEffect(() => {
    const cfg = readAtlasConfig()
    if (!cfg?.apiUrl || !cfg?.company) {
      setState({ status: 'unconfigured', products: [] })
      return undefined
    }
    let cancelled = false
    setState(s => ({ ...s, status: 'loading' }))
    fetchPublicCatalog('products', { categorySlug, limit })
      .then(json => { if (!cancelled) setState({ status: 'ready', products: json?.data ?? [] }) })
      .catch(() => { if (!cancelled) setState({ status: 'error', products: [] }) })
    return () => { cancelled = true }
  }, [categorySlug, limit])

  if (state.status === 'unconfigured') {
    return (
      <div style={{ padding: '24px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px', textAlign: 'center' }}>
        <p style={{ color: '#94a3b8', fontSize: '14px' }}>
          Grid de productos — configura el sitio para ver el catalogo en vivo
        </p>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div style={{ padding: '24px', background: '#fef2f2', border: '1px dashed #fca5a5', borderRadius: '8px', textAlign: 'center' }}>
        <p style={{ color: '#b91c1c', fontSize: '14px' }}>No se pudo cargar el catalogo.</p>
      </div>
    )
  }

  if (state.status === 'ready' && state.products.length === 0) {
    return (
      <div style={{ padding: '24px', background: '#f8fafc', border: '1px dashed #cbd5e1', borderRadius: '8px', textAlign: 'center' }}>
        <p style={{ color: '#94a3b8', fontSize: '14px' }}>Sin productos publicados{categorySlug ? ' en esta categoria' : ''}.</p>
      </div>
    )
  }

  const cols = Math.max(1, Number(columns) || 4)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: '16px' }}>
      {state.status === 'loading'
        ? Array.from({ length: Math.min(limit, cols * 2) }).map((_, i) => (
            <div key={i} style={{ ...CARD_STYLE, aspectRatio: '3 / 4', background: '#f1f5f9' }} />
          ))
        : state.products.map(product => (
            <div key={product.id} style={CARD_STYLE}>
              <div style={{ aspectRatio: '1 / 1', background: '#f1f5f9', overflow: 'hidden' }}>
                {product.image_url && (
                  <img
                    src={product.image_url}
                    alt={product.name}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                )}
              </div>
              <div style={{ padding: '12px' }}>
                <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#0f172a' }}>{product.name}</p>
                {showPrice && (
                  <p style={{ margin: '4px 0 0', fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                    {formatCatalogPrice(product.price, product.currency)}
                  </p>
                )}
              </div>
            </div>
          ))}
    </div>
  )
}
