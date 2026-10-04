export function scopeUtilities(css, scope) {
  const start = css.indexOf('@layer utilities {')
  if (start === -1) return css
  const open = css.indexOf('{', start)
  let depth = 0
  let end = -1
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  if (end === -1) return css
  const inner = css.slice(open + 1, end)
  return `${css.slice(0, open + 1)}\n:where([data-runly-module="${scope}"]) {${inner}}\n${css.slice(end)}`
}

