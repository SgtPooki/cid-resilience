// Group endpoints by resolved IP and ASN. DoH + RIPEstat both send ACAO *, so this runs in browsers.
// Heuristic CDN/edge ASNs: an edge with a warm cache passes the latency check but is not durable storage (threat-model.md "CDN caches").
export const CDN_ASNS = new Map([[13335, 'Cloudflare'], [209242, 'Cloudflare'], [54113, 'Fastly'], [20940, 'Akamai'], [16625, 'Akamai'], [15133, 'Edgecast']])

const isIp = (h) => /^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')

export async function resolveIp(host, { fetchFn = fetch } = {}) {
  if (isIp(host)) return host
  const r = await fetchFn(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=A`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(8000) })
  const j = await r.json()
  return j.Answer?.find((a) => a.type === 1)?.data ?? null
}

const asnCache = new Map()
const store = typeof document !== 'undefined' ? globalThis.localStorage : null // browser: remember ip -> asn across runs, since RIPEstat is slow and rate-limited
export async function asnOf(ip, { fetchFn = fetch } = {}) {
  if (asnCache.has(ip)) return asnCache.get(ip)
  try { const hit = store?.getItem(`asn:${ip}`); if (hit) { const v = JSON.parse(hit); asnCache.set(ip, Promise.resolve(v)); return v } } catch {}
  const p = (async () => {
    const r = await fetchFn(`https://stat.ripe.net/data/network-info/data.json?resource=${ip}`, { signal: AbortSignal.timeout(15000) })
    const j = await r.json()
    const asn = Number(j.data?.asns?.[0]) || null
    let holder = asn && CDN_ASNS.get(asn)
    if (asn && !holder) {
      holder = await fetchFn(`https://stat.ripe.net/data/as-overview/data.json?resource=AS${asn}`, { signal: AbortSignal.timeout(15000) }).then((r) => r.json()).then((j) => j.data?.holder).catch(() => null)
    }
    const v = { asn, prefix: j.data?.prefix ?? null, holder: holder ?? null, cdn: CDN_ASNS.has(asn) }
    if (asn) try { store?.setItem(`asn:${ip}`, JSON.stringify(v)) } catch {}
    return v
  })().catch(() => ({ asn: null, prefix: null, holder: null, cdn: false }))
  asnCache.set(ip, p)
  return p
}

// Annotate providers in place with ip/asn. Providers: [{ url, ... }]
export async function annotate(providers, opts) {
  await Promise.all(providers.map(async (p) => {
    const host = p.url ? new URL(p.url).hostname : p.ip
    p.ip = host ? await resolveIp(host, opts).catch(() => null) : null
    Object.assign(p, p.ip ? await asnOf(p.ip, opts) : { asn: null, prefix: null, holder: null, cdn: false })
  }))
  return providers
}

// Cluster key: same IP -> same box; else same ASN -> same operator (conservative); else the endpoint itself.
export const clusterKey = (p) => p.ip ? `ip:${p.ip}` : p.url ?? `peer:${p.peers?.[0]}`
export const operatorKey = (p) => p.asn ? `asn:${p.asn}` : clusterKey(p)

// -> [{ key, label, cdn, providers:[...] }]. Default groups by IP (one box); pass operatorKey to group by ASN.
export function clusters(providers, keyFn = clusterKey) {
  const m = new Map()
  for (const p of providers) {
    const k = keyFn(p)
    const label = keyFn === operatorKey ? (p.holder ?? p.ip ?? p.url) : [p.ip ?? p.url, p.holder].filter(Boolean).join(' / ')
    const c = m.get(k) ?? m.set(k, { key: k, label, cdn: !!p.cdn, providers: [] }).get(k)
    c.providers.push(p)
  }
  return [...m.values()]
}
