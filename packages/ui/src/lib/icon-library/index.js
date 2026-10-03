// JSX-free entry (`@runly/ui/icons`) so engines and node tests can use the
// icon registry and catalog without loading the component barrel.
export { allIconNames, isKnownIcon, getIconNode } from './registry.js'
export { ICON_CATEGORIES, CURATED_ICONS, iconLabel, searchCurated } from './catalog.js'
