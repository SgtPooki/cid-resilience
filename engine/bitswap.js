// Browser-only Bitswap probe via helia, loaded lazily from esm.sh so the app stays dependency-free.
// Baseline = libp2p ping RTT (G 4b); probe = bitswap block fetch (G 4a). Hash verification is done by helia on receipt.
import { median, pick } from './probe.js'

let libP
const lib = () => (libP ??= (async () => {
  const [{ createHelia }, { bitswap }, { multiaddr }, { CID }, { peerIdFromString }] = await Promise.all([
    import('https://esm.sh/helia'), import('https://esm.sh/@helia/block-brokers'), import('https://esm.sh/@multiformats/multiaddr'),
    import('https://esm.sh/multiformats/cid'), import('https://esm.sh/@libp2p/peer-id'),
  ])
  // esm.sh build: the libp2p getter throws NotStarted unless we start explicitly after construction.
  const helia = await createHelia({ blockBrokers: [bitswap()], routers: [], libp2p: { peerDiscovery: [] }, start: false })
  await helia.start()
  return { helia, multiaddr, CID, peerIdFromString }
})())

export async function bitswapProbe(peer, blocks, { rounds = 5, maxExcessMs = 30 } = {}) {
  try {
    const { helia, multiaddr, CID, peerIdFromString } = await lib()
    const pid = peerIdFromString(peer.id)
    const mas = peer.addrs.map((a) => multiaddr(a.includes('/p2p/') ? a : `${a}/p2p/${peer.id}`))
    await helia.libp2p.dial(mas, { signal: AbortSignal.timeout(15000) })
    const ping = helia.libp2p.services.ping
    const baseline = []
    for (let k = 0; k < rounds; k++) baseline.push(await ping.ping(pid, { signal: AbortSignal.timeout(10000) }))
    const probe = []
    let verified = 0
    const picks = pick(blocks, rounds)
    for (const b of picks) {
      const c = CID.parse(b.cid)
      const t0 = performance.now()
      try {
        await helia.blockstore.get(c, { signal: AbortSignal.timeout(15000) })
        probe.push(performance.now() - t0); verified++
        await helia.blockstore.delete(c).catch(() => {}) // so the next peer is challenged, not the local cache
      } catch { probe.push(Infinity) }
    }
    await helia.libp2p.hangUp(pid).catch(() => {})
    const excess = median(probe) - median(baseline)
    return { status: verified < picks.length ? 'invalid' : excess < maxExcessMs ? 'local' : 'on-demand', baseline: median(baseline), probe: median(probe), excess, verified, rounds: picks.length, transport: 'bitswap' }
  } catch (err) {
    return { status: 'unreachable', error: (err.message ?? String(err)).slice(0, 80), transport: 'bitswap' }
  }
}
