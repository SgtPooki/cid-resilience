// Report shape, merge, and URL-fragment encoding (deflate-raw + base64url, no deps).
// report = { v:1, cid, vantage:{ id, label, lat, lon, ts }, providers:[{ url, peers, ip, asn, holder, cdn, status, baseline, probe, excess, verified, rounds, error }] }

export const newVantage = (label, loc) => ({ id: Math.random().toString(36).slice(2, 10), label: label || 'unnamed', lat: loc?.lat ?? null, lon: loc?.lon ?? null, ts: new Date().toISOString() })

const STATUSES = new Set(['advertised', 'untested', 'testing', 'local', 'on-demand', 'invalid', 'unreachable'])
const num = (x) => (typeof x === 'number' && isFinite(x) ? x : null)
// Shared reports are untrusted input: keep only known fields with sane types, drop anything else.
export function sanitize(r) {
  if (!r || typeof r.cid !== 'string' || !/^[A-Za-z0-9]+$/.test(r.cid) || !r.vantage || typeof r.vantage.id !== 'string') throw new Error('malformed report')
  const v = r.vantage
  const lat = num(v.lat), lon = num(v.lon)
  return {
    v: 1, cid: r.cid, blocks: num(r.blocks) ?? 0,
    vantage: { id: v.id.slice(0, 32), label: String(v.label ?? 'unnamed').slice(0, 40), lat: lat != null && Math.abs(lat) <= 90 ? lat : null, lon: lon != null && Math.abs(lon) <= 180 ? lon : null, ts: String(v.ts ?? '').slice(0, 40) },
    providers: (Array.isArray(r.providers) ? r.providers : []).map((p) => ({
      url: typeof p.url === 'string' && /^https?:\/\/[\w.-]+(:\d+)?$/.test(p.url) ? p.url : null,
      peers: (Array.isArray(p.peers) ? p.peers : []).filter((x) => typeof x === 'string' && /^[A-Za-z0-9]+$/.test(x)).slice(0, 20),
      peerCount: num(p.peerCount) ?? (Array.isArray(p.peers) ? p.peers.length : 0),
      ip: typeof p.ip === 'string' && /^[\d.:a-f]+$/i.test(p.ip) ? p.ip : null,
      asn: num(p.asn), holder: p.holder == null ? null : String(p.holder).slice(0, 60), cdn: !!p.cdn,
      status: STATUSES.has(p.status) ? p.status : 'advertised',
      baseline: num(p.baseline), probe: num(p.probe), excess: num(p.excess), transfer: num(p.transfer), verified: num(p.verified), rounds: num(p.rounds),
      error: p.error == null ? null : String(p.error).slice(0, 80), warmed: !!p.warmed, weak: !!p.weak, transport: p.transport === 'bitswap' ? 'bitswap' : undefined,
    })).filter((p) => p.url || p.peers.length || p.peerCount),
  }
}

// Merge many single-vantage reports into { cid, vantages, providers:[{ url, peers, ip, asn, holder, cdn, obs:[...] }] }
export function merge(reports) {
  const cids = new Set(reports.map((r) => r.cid))
  if (cids.size > 1) throw new Error(`reports are for different CIDs: ${[...cids].join(', ')}`)
  const vantages = [], providers = new Map()
  for (const r of reports) {
    if (vantages.some((v) => v.id === r.vantage.id)) continue
    vantages.push(r.vantage)
    for (const p of r.providers) {
      // Same URL with a different IP (geo-DNS, anycast) is a different box, so it gets its own row.
      const key = (p.url ?? `peer:${p.peers?.[0] ?? 'bitswap'}`) + (p.ip ? `@${p.ip}` : '')
      const m = providers.get(key) ?? providers.set(key, { key, url: p.url, peers: [], peerCount: 0, ip: p.ip, asn: p.asn, holder: p.holder, cdn: !!p.cdn, obs: [] }).get(key)
      for (const id of p.peers ?? []) if (!m.peers.includes(id)) m.peers.push(id)
      m.peerCount = Math.max(m.peerCount, m.peers.length, p.peerCount ?? 0)
      m.ip ??= p.ip; m.asn ??= p.asn; m.holder ??= p.holder; m.cdn ||= !!p.cdn
      m.obs.push({ vantageId: r.vantage.id, vantage: r.vantage, status: p.status, baseline: p.baseline, probe: p.probe, excess: p.excess, transfer: p.transfer, verified: p.verified, rounds: p.rounds, error: p.error, warmed: p.warmed, weak: p.weak })
    }
  }
  return { cid: reports[0]?.cid, vantages, providers: [...providers.values()] }
}

const b64url = (bytes) => btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function pipe(bytes, stream) {
  const r = new Blob([bytes]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(r).arrayBuffer())
}

// Share links carry a compact form: no peer IDs (just the count), no probe/transfer (excess is what matters),
// baseline rounded up to whole ms (never shrinks a disk), nulls and falses dropped. Untested rows are dropped too.
export function compact(reports) {
  return reports.map((r) => ({
    ...r,
    providers: (Array.isArray(r?.providers) ? r.providers : []).filter((p) => !['untested', 'advertised'].includes(p.status)).map(({ peers, probe, transfer, ...p }) => {
      const out = { ...p, peerCount: p.peerCount ?? peers?.length ?? 0, baseline: p.baseline == null ? null : Math.ceil(p.baseline), excess: p.excess == null ? null : Math.round(p.excess) }
      return Object.fromEntries(Object.entries(out).filter(([, v]) => v != null && v !== false))
    }),
  }))
}

export async function encodeReports(reports) {
  const json = new TextEncoder().encode(JSON.stringify(compact(reports)))
  return b64url(await pipe(json, new CompressionStream('deflate-raw')))
}

export async function decodeReports(frag) {
  const bytes = await pipe(unb64url(frag), new DecompressionStream('deflate-raw'))
  const parsed = JSON.parse(new TextDecoder().decode(bytes))
  return (Array.isArray(parsed) ? parsed : [parsed]).map(sanitize)
}

export const shareUrl = async (base, reports) => `${base.split(/[#?]/)[0]}#r=${await encodeReports(reports)}` // drop ?cid&lat&auto so recipients run as themselves
export const reportsFromUrl = async (url) => { const m = url.match(/#r=([A-Za-z0-9_-]+)/); return m ? decodeReports(m[1]) : [] }
