export function ensureModuleStylesheet(id, href) {
  const existing = document.head.querySelector(`link[data-module-css="${CSS.escape(id)}"]`)
  if (existing?.getAttribute('href') === href) return existing
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  link.dataset.moduleCss = id
  if (existing) existing.replaceWith(link)
  else document.head.appendChild(link)
  return link
}

