import { defineBlock } from '@raulbellosom/atlas-web-builder'

import ProductCardRenderer from './ProductCardRenderer.jsx'

// See productsGridBlock.jsx for why there is no "add to cart" field here.
export const ProductCardBlock = defineBlock({
  type:     'ProductCardBlock',
  label:    'Tarjeta de producto',
  category: 'atlas-ecommerce',
  defaultProps: { productId: '', showPrice: true, showDescription: true },
  fields: {
    productId:       { type: 'text',   label: 'ID o slug del producto' },
    showPrice:       { type: 'toggle', label: 'Mostrar precio' },
    showDescription: { type: 'toggle', label: 'Mostrar descripcion' },
  },
  render: ProductCardRenderer,
})
