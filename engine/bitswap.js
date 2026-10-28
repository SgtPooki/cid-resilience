// Browser-only Bitswap probe over helia's libp2p, loaded lazily from jsdelivr so the app stays dependency-free.
// (esm.sh's build of helia never starts libp2p and its block-brokers bundle 404s; jsdelivr +esm works.)
// We speak bitswap 1.2 ourselves (G 4a): send want-block on our stream, receive the response on the stream the
// peer opens to us, stamp the first byte for latency, hash the block for verification. Baseline = libp2p ping (G 4b).
import { median, pick } from './probe.js'
import { varint, concat, sha256hex } from './car.js'

const uvarint = (n) => { const out = []; while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128) } out.push(n); return out }
const field = (tag, bytes) => [tag, ...uvarint(bytes.length), ...bytes]

// Message{ wantlist(1): Wantlist{ entries(1): Entry{ block(1)=cid, priority(2)=1, wantType(4)=0 Block, sendDontHave(5)=1 } } }, length-prefixed.
export function wantBlockMessage(cidBytes) {
  const entry = [...field(0x0a, cidBytes), 0x10, 1, 0x20, 0, 0x28, 1]
  const msg = field(0x0a, field(0x0a, entry))
  return Uint8Array.from([...uvarint(msg.length), ...msg])
}

// Minimal protobuf field walk: -> [{ tag, bytes|num }] for wire types 2 and 0.
export function fields(buf) {
  const out = []
  let i = 0
  const v = (at) => varint(buf, at) ?? (() => { throw new Error('truncated protobuf') })()
  while (i < buf.length) {
    const [key, j] = v(i)
    const tag = key >> 3, wt = key & 7
    if (wt === 2) { const [len, k] = v(j); if (k + len > buf.length) throw new Error('truncated protobuf'); out.push({ tag, bytes: buf.subarray(k, k + len) }); i = k + len }
    else if (wt === 0) { const [num, k] = v(j); out.push({ tag, num }); i = k }
    else throw new Error(`unsupported wire type ${wt}`)
  }
  return out
}

// Response Message: blocks(2) raw bytes (bitswap 1.0), payload(3) Block{prefix(1), data(2)}, blockPresences(4) {cid(1), type(2): 1 = DontHave}.
// -> { blocks: [Uint8Array], dontHave: [cidBytes] }
export function parseResponse(msg) {
  const blocks = [], dontHave = []
  for (const f of fields(msg)) {
    if (f.tag === 2) blocks.push(f.bytes)
    if (f.tag === 3) { const d = fields(f.bytes).find((x) => x.tag === 2); if (d) blocks.push(d.bytes) }
    if (f.tag === 4) { const fs = fields(f.bytes); if (fs.find((x) => x.tag === 2)?.num === 1) dontHave.push(fs.find((x) => x.tag === 1)?.bytes) }
  }
  return { blocks, dontHave }
}

let libP
const waiting = new Map() // sha256 hex -> { t0, resolve }
const lib = () => (libP ??= (async () => {
  const [{ createHelia }, { multiaddr }, { CID }, { peerIdFromString }] = await Promise.all([
    import('https://cdn.jsdelivr.net/npm/helia@5/+esm'), import('https://cdn.jsdelivr.net/npm/@multiformats/multiaddr@12/+esm'),
    import('https://cdn.jsdelivr.net/npm/multiformats@13/cid/+esm'), import('https://cdn.jsdelivr.net/npm/@libp2p/peer-id@5/+esm'),
  ])
  const helia = await createHelia({ blockBrokers: [], routers: [], libp2p: { peerDiscovery: [] } })
  await helia.libp2p.handle(['/ipfs/bitswap/1.2.0', '/ipfs/bitswap/1.1.0', '/ipfs/bitswap/1.0.0'], ({ stream, connection }) => {
    (async () => {
      const from = connection.remotePeer.toString()
      const mine = (w) => w && w.peer === from // only the challenged peer's own response counts, for timing and for bytes
      let buf = new Uint8Array(0)
      for await (const chunk of stream.source) {
        const t = performance.now()
        for (const w of waiting.values()) if (mine(w)) w.ttfb ??= t - w.t0
        buf = concat(buf, chunk.subarray())
        for (let r; (r = varint(buf, 0)) && r[1] + r[0] <= buf.length;) {
          const { blocks, dontHave } = parseResponse(buf.subarray(r[1], r[1] + r[0]))
          buf = buf.subarray(r[1] + r[0])
          for (const b of blocks) { const w = waiting.get(await sha256hex(b)); if (mine(w)) w.resolve({ ttfb: w.ttfb, ok: true }) }
          for (const c of dontHave) { const w = waiting.get(cidDigestHex(c)); if (mine(w)) w.resolve({ ttfb: w.ttfb, ok: false, error: 'DONT_HAVE' }) }
        }
      }
    })().catch(() => {})
  }, { runOnLimitedConnection: true })
  return { helia, multiaddr, CID, peerIdFromString }
})())

const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
const cidDigestHex = (cidBytes) => cidBytes && hex(cidBytes.subarray(cidBytes.length - 32))

async function wantBlock(libp2p, pid, cid, timeoutMs = 15000) {
  const key = hex(cid.multihash.digest)
  if (waiting.has(key)) throw new Error('bitswap probes must run one at a time') // index.js serialises them
  return new Promise(async (resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(key); resolve({ ok: false, error: 'timeout' }) }, timeoutMs)
    waiting.set(key, { t0: performance.now(), peer: pid.toString(), resolve: (r) => { clearTimeout(timer); waiting.delete(key); resolve(r) } })
    try {
      const stream = await libp2p.dialProtocol(pid, ['/ipfs/bitswap/1.2.0', '/ipfs/bitswap/1.1.0'], { signal: AbortSignal.timeout(timeoutMs) })
      await stream.sink((async function* () { yield wantBlockMessage(cid.bytes) })())
    } catch (e) { clearTimeout(timer); waiting.delete(key); reject(e) }
  })
}

export async function bitswapProbe(peer, blocks, { rounds = 5, maxExcessMs = 30 } = {}) {
  try {
    const { helia, multiaddr, CID, peerIdFromString } = await lib()
    const id = peer.id ?? peer.peers?.[0]
    const pid = peerIdFromString(id)
    const mas = peer.addrs.map((a) => multiaddr(a.includes('/p2p/') ? a : `${a}/p2p/${id}`))
    await helia.libp2p.dial(mas, { signal: AbortSignal.timeout(15000) })
    const ping = helia.libp2p.services.ping
    const baseline = []
    for (let k = 0; k < rounds; k++) baseline.push(await ping.ping(pid, { signal: AbortSignal.timeout(10000) }))
    const probe = []
    let verified = 0, lastError
    const picks = pick(blocks.filter((b) => b.mhCode === 0x12), rounds)
    for (const b of picks) {
      const r = await wantBlock(helia.libp2p, pid, CID.parse(b.cid))
      if (r.ok) { probe.push(r.ttfb); verified++ } else { probe.push(Infinity); lastError = r.error }
    }
    await helia.libp2p.hangUp(pid).catch(() => {})
    const excess = median(probe) - median(baseline)
    return { status: verified < picks.length ? 'invalid' : excess < maxExcessMs ? 'local' : 'on-demand', baseline: median(baseline), probe: median(probe), excess, verified, rounds: picks.length, error: lastError, transport: 'bitswap' }
  } catch (err) {
    return { status: 'unreachable', error: (err.message ?? String(err)).slice(0, 80), transport: 'bitswap' }
  }
}
