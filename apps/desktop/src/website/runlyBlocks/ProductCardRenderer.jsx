// apps/desktop/src/website/runlyBlocks/ProductCardRenderer.jsx
import { useEffect, useState } from 'react'
import { fetchPublicCatalog, formatCatalogPrice, readAtlasConfig } from './catalogPublicClient.js'

export default function ProductCardRenderer({ productId, showPrice = true, showDescription = true }) {
  const [state, setState] = useState({ status: 'loading', product: null })

  useEffect(() => {
    if (!productId) { setState({ status: 'empty', product: null }); return undefined }
    const cfg = readAtlasConfig()
    if (!cfg?.apiUrl || !cfg?.company) {
      setState({ status: 'unconfigured', product: null })
      return undefined
    }
    let cancelled = false
    setState(s => ({ ...s, status: 'loading' }))
    fetchPublicCatalog(`products/${encodeURIComponent(productId)}`)
      .then(json => { if (!cancelled) setState({ status: 'ready', product: json?.data ?? null }) })
      .catch(() => { if (!cancelled) setState({ status: 'error', product: null }) })
    return () => { cancelled = true }
  }, [productId])

  if (state.status === 'empty') {
    return (
      <div style={{ padding: '16px', border: '1px dashed #cbd5e1', borderRadius: '8px', textAlign: 'center' }}>
        <p style={{ color: '#94a3b8', fontSize: '14px' }}>Configura el ID o slug del producto en las propiedades</p>
      </div>
    )
  }

  if (state.status === 'unconfigured' || state.status === 'error' || (state.status === 'ready' && !state.product)) {
    return (
      <div style={{ padding: '16px', border: '1px dashed #fca5a5', background: '#fef2f2', borderRadius: '8px', textAlign: 'center' }}>
        <p style={{ color: '#b91c1c', fontSize: '14px' }}>Producto no encontrado o no publicado.</p>
      </div>
    )
  }

  if (state.status === 'loading') {
    return <div style={{ aspectRatio: '3 / 4', maxWidth: '320px', borderRadius: '12px', background: '#f1f5f9' }} />
  }

  const product = state.product
  return (
    <div style={{ maxWidth: '320px', border: '1px solid #e2e8f0', borderRadius: '12px', overflow: 'hidden', background: '#ffffff' }}>
      <div style={{ aspectRatio: '1 / 1', background: '#f1f5f9', overflow: 'hidden' }}>
        {product.image_url && (
          <img src={product.image_url} alt={product.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        )}
      </div>
      <div style={{ padding: '16px' }}>
        <p style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: '#0f172a' }}>{product.name}</p>
        {showDescription && product.description && (
          <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#64748b', lineHeight: 1.5 }}>
            {product.description}
          </p>
        )}
        {showPrice && (
          <p style={{ margin: '10px 0 0', fontSize: '18px', fontWeight: 700, color: '#0f172a' }}>
            {formatCatalogPrice(product.price, product.currency)}
          </p>
        )}
      </div>
    </div>
  )
}
