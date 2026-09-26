// Strips the "/app" prefix the desktop router always adds so the path
// matches the navigation.path values stored in each module's manifest
// (e.g. "/app/help" -> "/help").
export function toApiPath(pathname) {
  return pathname.startsWith("/app") ? pathname.slice(4) || "/" : pathname;
}
