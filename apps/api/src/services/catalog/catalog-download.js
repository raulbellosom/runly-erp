import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { lookup } from 'node:dns/promises'
import { BlockList, isIP } from 'node:net'
import { open, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve, sep } from 'node:path'

export class CatalogDownloadError extends Error {
  constructor(code) { super(code); this.code = code; this.status = 422 }
}
const privateIPs = new BlockList()
for (const [ip, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]]) privateIPs.addSubnet(ip, prefix)
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
privateIPs.addSubnet('2001::', 32, 'ipv6')
privateIPs.addSubnet('2002::', 16, 'ipv6')

export function publicAddress(address) {
  const family = isIP(address)
  return family === 4 ? !privateIPs.check(address, 'ipv4') : family === 6 && globalV6.check(address, 'ipv6') && !privateIPs.check(address, 'ipv6')
}
export async function resolveCatalogAddress(url, resolveHost = lookup) {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) throw new CatalogDownloadError('CATALOG_URL_REJECTED')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolveHost(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(value => !publicAddress(value.address))) throw new CatalogDownloadError('CATALOG_PRIVATE_ADDRESS')
  return addresses[0]
}

// Count bytes as they arrive, regardless of Content-Length. No arrayBuffer().
export async function collectBounded(stream, maxBytes) {
  const chunks = []; let bytes = 0
  try {
    for await (const chunk of stream) {
      bytes += chunk.length
      if (bytes > maxBytes) throw new CatalogDownloadError('CATALOG_RESPONSE_TOO_LARGE')
      chunks.push(Buffer.from(chunk))
    }
    return Buffer.concat(chunks, bytes)
  } catch (error) { stream.destroy?.(); throw error }
}

export async function readCatalogBytes(value, { maxBytes = 25 * 1024 * 1024, headers = {}, localRoot = null, resolveHost = lookup, requestImpl = null } = {}) {
  let url = new URL(value)
  if (url.protocol === 'file:') {
    if (!localRoot || url.hostname || url.search || url.hash) throw new CatalogDownloadError('CATALOG_LOCAL_NOT_CONFIGURED')
    const file = await realpath(resolve(fileURLToPath(url))), root = await realpath(resolve(localRoot))
    if (!file.startsWith(root + sep)) throw new CatalogDownloadError('CATALOG_LOCAL_PATH_REJECTED')
    const handle = await open(file, 'r')
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > maxBytes) throw new CatalogDownloadError('CATALOG_RESPONSE_TOO_LARGE')
      const buffer = await collectBounded(handle.createReadStream({ autoClose: false }), maxBytes)
      return { status: 200, buffer, etag: null }
    } finally { await handle.close() }
  }
  // Pin the validated DNS answer into the actual connection, including redirects.
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20_000)
  try {
    for (let redirects = 0; redirects <= 4; redirects++) {
      const address = await Promise.race([
        resolveCatalogAddress(url, resolveHost),
        new Promise((_, reject) => {
          if (controller.signal.aborted) reject(new CatalogDownloadError('CATALOG_UNREACHABLE'))
          else controller.signal.addEventListener('abort', () => reject(new CatalogDownloadError('CATALOG_UNREACHABLE')), { once: true })
        }),
      ])
      const response = await new Promise((done, fail) => {
        const request = (requestImpl ?? (url.protocol === 'https:' ? httpsRequest : httpRequest))(url, {
          headers, agent: false, signal: controller.signal,
          lookup: (_host, options, callback) => callback(null, options?.all ? [address] : address.address, address.family),
        }, done)
        request.on('error', fail); request.end()
      })
      const status = response.statusCode
      if ([301, 302, 303, 307, 308].includes(status)) {
        response.destroy()
        const next = new URL(response.headers.location ?? '', url)
        if (!response.headers.location || redirects === 4 || !['http:', 'https:'].includes(next.protocol) || (url.protocol === 'https:' && next.protocol !== 'https:')) throw new CatalogDownloadError('CATALOG_REDIRECT_REJECTED')
        url = next; continue
      }
      if (status === 304) { response.destroy(); return { status } }
      if (status !== 200) { response.destroy(); throw new CatalogDownloadError('CATALOG_UNREACHABLE') }
      const length = response.headers['content-length']
      if (length !== undefined && (!/^\d+$/.test(String(length)) || Number(length) > maxBytes)) { response.destroy(); throw new CatalogDownloadError('CATALOG_RESPONSE_TOO_LARGE') }
      const buffer = await collectBounded(response, maxBytes)
      return { status, buffer, etag: response.headers.etag ?? null }
    }
    throw new CatalogDownloadError('CATALOG_REDIRECT_REJECTED')
  } finally { clearTimeout(timer) }
}
