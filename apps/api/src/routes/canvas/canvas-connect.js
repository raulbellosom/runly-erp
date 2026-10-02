const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const end = (value) => value === null || value === undefined || (typeof value === 'string' && UUID.test(value))
// properties.connect on lines/arrows: { start, end } object ids or null.
export function isValidConnect(connect) {
  return connect == null || (typeof connect === 'object' && !Array.isArray(connect) && end(connect.start) && end(connect.end))
}
