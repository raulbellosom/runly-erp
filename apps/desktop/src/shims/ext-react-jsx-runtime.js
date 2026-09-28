// Module bundles import "ext-react-jsx-runtime"; delegate to React's real
// runtime so jsxs (static children) does not trigger missing-key warnings.
export { Fragment, jsx, jsxs } from 'react/jsx-runtime'
