// Module bundles import "ext-react-jsx-dev-runtime"; map jsxDEV onto React's
// real runtime (jsxDEV is undefined in production builds of jsx-dev-runtime)
// so static children do not trigger missing-key warnings.
import { Fragment, jsx, jsxs } from 'react/jsx-runtime'

export { Fragment }

export function jsxDEV(type, props, key, isStaticChildren) {
  return (isStaticChildren ? jsxs : jsx)(type, props, key)
}
