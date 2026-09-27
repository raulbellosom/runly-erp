import { defineBlock } from '@raulbellosom/atlas-web-builder'

import ProductsGridRenderer from './ProductsGridRenderer.jsx'

// "Agregar al carrito" was removed from this block's fields: there is no
// cart/checkout system in runly.catalog yet (CartBlock is still a static
// placeholder), so a working toggle would promise something the storefront
// can't do. This block only browses the real, published catalog.
export const ProductsGridBlock = defineBlock({
  type:     'ProductsGridBlock',
  label:    'Grid de productos',
  category: 'atlas-ecommerce',
  defaultProps: { categorySlug: '', limit: 8, columns: '4', showPrice: true },
  fields: {
    categorySlug: { type: 'text',   label: 'Slug de categoria (opcional)' },
    limit:        { type: 'number', label: 'Maximo de productos' },
    columns:      { type: 'select', label: 'Columnas', options: [{ value: '2', label: '2' }, { value: '3', label: '3' }, { value: '4', label: '4' }] },
    showPrice:    { type: 'toggle', label: 'Mostrar precio' },
  },
  render: ProductsGridRenderer,
})
