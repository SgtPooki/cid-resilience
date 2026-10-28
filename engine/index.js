// Orchestrator shared by the CLI and the web app.
import { discover, endpoints, bitswapPeers } from './discover.js'
import { fetchBlocks, challenge } from './probe.js'
import { annotate, clusters, operatorKey } from './cluster.js'
import { merge } from './report.js'
import { score } from './score.js'

export * from './discover.js'
export * from './probe.js'
export * from './cluster.js'
export * from './score.js'
export * from './report.js'

const mixedContent = typeof location !== 'undefined' && location.protocol === 'https:'

// Run a full single-vantage measurement. onEvent receives {type, ...} as results stream in.
export async function run(cid, { vantage, rounds = 5, maxExcessMs = 30, concurrency = 4, onEvent = () => {}, fetchFn = fetch, bitswapProbe = null } = {}) {
  const d = await discover(cid, { fetchFn })
  const eps = endpoints(d.peers)
  const bs = bitswapPeers(d.peers)
  onEvent({ type: 'discovered', peers: d.peers.size, endpoints: eps.length, bitswapPeers: bs.length, counts: d.counts, errors: d.errors })

  const providers = eps.map((e) => ({ url: e.url, peers: e.peers, status: 'advertised' }))
  for (const p of bs) providers.push({ url: null, peers: [p.id], addrs: p.addrs, ip: p.addrs.map((a) => a.match(/^\/ip4\/([\d.]+)\//)?.[1]).find(Boolean) ?? null, status: 'advertised' })
  for (const p of providers) onEvent({ type: 'provider', provider: p })
  await annotate(providers, { fetchFn })
  for (const p of providers) onEvent({ type: 'provider', provider: p })

  const usable = eps.filter((e) => e.https || !mixedContent).map((e) => e.url)
  const dag = await fetchBlocks(cid, usable, { fetchFn })
  if (!dag) {
    for (const p of providers) Object.assign(p, { status: 'untested', error: 'no endpoint served the DAG' })
    onEvent({ type: 'dag', blocks: 0 })
  } else {
    onEvent({ type: 'dag', blocks: dag.blocks.length, from: dag.from })
    const queue = [...providers]
    let bsLock = Promise.resolve() // bitswap probes run one at a time so responses are attributable
    const worker = async () => {
      for (let p; (p = queue.shift());) {
        if (p.url && !p.url.startsWith('https') && mixedContent) Object.assign(p, { status: 'unreachable', error: 'http endpoint blocked from an https page' })
        else if (p.url) Object.assign(p, await challenge(p.url, dag.blocks, { rounds, maxExcessMs, fetchFn }), { warmed: p.url === dag.from || undefined })
        else if (bitswapProbe) Object.assign(p, await (bsLock = bsLock.then(() => bitswapProbe(p, dag.blocks, { rounds, maxExcessMs }))))
        else Object.assign(p, { status: 'untested', error: 'bitswap-only peer; probed only in the web app' })
        onEvent({ type: 'provider', provider: p })
      }
    }
    await Promise.all(Array.from({ length: concurrency }, worker))
  }
  const report = { v: 1, cid, vantage, blocks: dag?.blocks.length ?? 0, providers: providers.map(({ addrs, failed, ...p }) => p) }
  onEvent({ type: 'done', report })
  return report
}

// Merge reports and score them. -> { merged, boxes, operators, score }
export function analyze(reports) {
  const merged = merge(reports)
  const boxes = clusters(merged.providers), operators = clusters(merged.providers, operatorKey)
  return { merged, boxes, operators, score: score(boxes, operators, merged.vantages) }
}
