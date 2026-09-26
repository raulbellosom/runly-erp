// Picks the footer tip text from a GET /help/resolve response: the current
// view's summary if one is documented, else the module overview's summary,
// else null (footer renders with no tip at all).
export function pickTipText(resolved) {
  return resolved?.view?.summary || resolved?.overview?.summary || null;
}
