// Report shape, merge, and URL-fragment encoding (deflate-raw + base64url, no deps).
// report = { v:1, cid, vantage:{ id, label, lat, lon, ts }, providers:[{ url, peers, ip, asn, holder, cdn, status, baseline, probe, excess, verified, rounds, error }] }

export const newVantage = (label, loc) => ({ id: Math.random().toString(36).slice(2, 10), label: label || 'unnamed', lat: loc?.lat ?? null, lon: loc?.lon ?? null, ts: new Date().toISOString() })

// Merge many single-vantage reports into { cid, vantages, providers:[{ url, peers, ip, asn, holder, cdn, obs:[...] }] }
export function merge(reports) {
  const cids = new Set(reports.map((r) => r.cid))
  if (cids.size > 1) throw new Error(`reports are for different CIDs: ${[...cids].join(', ')}`)
  const vantages = [], providers = new Map()
  for (const r of reports) {
    if (vantages.some((v) => v.id === r.vantage.id)) continue
    vantages.push(r.vantage)
    for (const p of r.providers) {
      const key = p.url ?? `peer:${p.peers?.[0]}`
      const m = providers.get(key) ?? providers.set(key, { key, url: p.url, peers: [], ip: p.ip, asn: p.asn, holder: p.holder, cdn: !!p.cdn, obs: [] }).get(key)
      for (const id of p.peers ?? []) if (!m.peers.includes(id)) m.peers.push(id)
      m.ip ??= p.ip; m.asn ??= p.asn; m.holder ??= p.holder; m.cdn ||= !!p.cdn
      m.obs.push({ vantageId: r.vantage.id, vantage: r.vantage, status: p.status, baseline: p.baseline, probe: p.probe, excess: p.excess, verified: p.verified, rounds: p.rounds, error: p.error })
    }
  }
  return { cid: reports[0]?.cid, vantages, providers: [...providers.values()] }
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const unb64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))

async function pipe(bytes, stream) {
  const r = new Blob([bytes]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(r).arrayBuffer())
}

export async function encodeReports(reports) {
  const json = new TextEncoder().encode(JSON.stringify(reports))
  return b64url(await pipe(json, new CompressionStream('deflate-raw')))
}

export async function decodeReports(frag) {
  const bytes = await pipe(unb64url(frag), new DecompressionStream('deflate-raw'))
  return JSON.parse(new TextDecoder().decode(bytes))
}

export const shareUrl = async (base, reports) => `${base.split('#')[0]}#r=${await encodeReports(reports)}`
export const reportsFromUrl = async (url) => { const m = url.match(/#r=([A-Za-z0-9_-]+)/); return m ? decodeReports(m[1]) : [] }
