// Provider discovery: IPNI (cid.contact) + delegated routing, merged by Peer ID.
// Sources: research/sources-ipfs-geo.md rows 1a-1e, 2a-2e.
import { varint } from './car.js'

export const IPNI = 'https://cid.contact'
export const DELEGATED = 'https://delegated-ipfs.dev'
const BITSWAP = 0x0900, GATEWAY_HTTP = 0x0920 // G 2d, 2e

// IPNI metadata: repeated (uvarint code, payload). Decode by prefix.
export function protocolsFromMetadata(b64) {
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
  const out = []
  const r = varint(bytes, 0)
  if (!r) return out
  if (r[0] === BITSWAP) out.push('transport-bitswap')
  if (r[0] === GATEWAY_HTTP) out.push('transport-ipfs-gateway-http')
  if (r[0] === 0x0910) out.push('transport-graphsync-filecoinv1')
  if (r[0] === 0x3e0000) out.push('transport-filecoin-piece-http') // curio FilecoinPieceHttp
  return out
}

// /dns/host/tcp/443/https or /ip4/1.2.3.4/tcp/8443/https -> https://host:port. http:// kept but flagged.
export function httpUrl(ma) {
  const m = ma.match(/^\/(?:dns|dns4|dns6|ip4)\/([^/]+)\/tcp\/(\d+)\/(tls\/http|https|http)$/)
  if (!m) return null
  const https = m[3] !== 'http'
  const port = m[2] === (https ? '443' : '80') ? '' : ':' + m[2]
  return `${https ? 'https' : 'http'}://${m[1]}${port}`
}

export const browserDialable = (ma) => /\/(wss|webtransport|webrtc-direct|webrtc)(\/|$)/.test(ma)

async function fromIpni(cid, fetchFn) {
  const r = await fetchFn(`${IPNI}/cid/${cid}`, { headers: { accept: 'application/json' } })
  if (r.status === 404) return []
  if (!r.ok) throw new Error(`ipni ${r.status}`)
  const j = await r.json()
  return (j.MultihashResults ?? []).flatMap((m) => m.ProviderResults.map((p) => ({
    id: p.Provider.ID, addrs: p.Provider.Addrs ?? [], protocols: protocolsFromMetadata(p.Metadata ?? ''), context: p.ContextID,
  })))
}

async function fromDelegated(cid, fetchFn) {
  const r = await fetchFn(`${DELEGATED}/routing/v1/providers/${cid}`, { headers: { accept: 'application/json' } })
  if (r.status === 404) return []
  if (!r.ok) throw new Error(`delegated ${r.status}`)
  const j = await r.json()
  return (j.Providers ?? []).filter((p) => p.Schema === 'peer' || p.ID).map((p) => ({ id: p.ID, addrs: p.Addrs ?? [], protocols: p.Protocols ?? [] }))
}

// -> { peers: Map<peerId, {id, addrs:Set, protocols:Set, sources:Set, contexts:number}>, errors: {ipni?, delegated?} }
export async function discover(cid, { fetchFn = fetch } = {}) {
  const errors = {}
  const [ipni, delegated] = await Promise.all([
    fromIpni(cid, fetchFn).catch((e) => { errors.ipni = String(e.message ?? e); return [] }),
    fromDelegated(cid, fetchFn).catch((e) => { errors.delegated = String(e.message ?? e); return [] }),
  ])
  const peers = new Map()
  const add = (rec, source) => {
    const p = peers.get(rec.id) ?? peers.set(rec.id, { id: rec.id, addrs: new Set(), protocols: new Set(), sources: new Set(), contexts: 0 }).get(rec.id)
    rec.addrs.forEach((a) => p.addrs.add(a))
    rec.protocols.forEach((x) => p.protocols.add(x))
    p.sources.add(source)
    if (rec.context) p.contexts++
  }
  ipni.forEach((r) => add(r, 'ipni'))
  delegated.forEach((r) => add(r, 'delegated'))
  return { peers, errors, counts: { ipni: ipni.length, delegated: delegated.length } }
}

// Group peers by HTTP endpoint. -> [{ url, peers: [id], https }]
export function endpoints(peers) {
  const byUrl = new Map()
  for (const p of peers.values()) {
    for (const a of p.addrs) {
      const u = httpUrl(a)
      if (u) (byUrl.get(u) ?? byUrl.set(u, new Set()).get(u)).add(p.id)
    }
  }
  return [...byUrl].map(([url, ids]) => ({ url, peers: [...ids], https: url.startsWith('https') }))
}

// Peers with no HTTP endpoint but a browser-dialable bitswap addr.
export function bitswapPeers(peers) {
  return [...peers.values()]
    .filter((p) => ![...p.addrs].some(httpUrl))
    .map((p) => ({ id: p.id, addrs: [...p.addrs].filter(browserDialable), bitswap: p.protocols.has('transport-bitswap') }))
    .filter((p) => p.addrs.length)
}
