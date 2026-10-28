// Timed challenges over the trustless gateway. Sources: G 3a, 3c, 10b.
import { parseCarChunk, concat, sha256hex, cidDigest } from './car.js'

export const IDENTITY = 'bafkqaaa' // G 3c: liveness + RTT baseline only
export const median = (xs) => xs.length ? xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)] : null

// Fetch up to maxBlocks of the DAG as a CAR from any endpoint, verifying each block hash and that the first block is the requested root.
// ponytail: membership of later blocks is not checked (would need dag-pb/dag-cbor link decoding); a lying CAR source can only
// substitute non-root blocks, and only the first maxBlocks of the DAG are ever sampled. Both are stated in the README.
export async function fetchBlocks(cid, urls, { maxBlocks = 64, timeoutMs = 30000, fetchFn = fetch } = {}) {
  const root = cidDigest(cid)
  const ctls = urls.map(() => new AbortController())
  const one = async (base, ctl) => {
    const t = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      const r = await fetchFn(`${base}/ipfs/${cid}?format=car`, { headers: { accept: 'application/vnd.ipld.car' }, signal: ctl.signal })
      if (!r.ok) throw new Error(`${r.status}`)
      const reader = r.body.getReader()
      let buf = new Uint8Array(0), state = { headerDone: false }
      const blocks = []
      while (blocks.length < maxBlocks) {
        const { value, done } = await reader.read()
        if (done) break
        buf = concat(buf, value)
        const out = parseCarChunk(buf, state)
        buf = out.rest
        for (const b of out.blocks) {
          if (blocks.length >= maxBlocks) break
          if (b.mhCode === 0x12 && (await sha256hex(b.bytes)) !== b.digest) throw new Error(`bad block from ${base}`)
          if (!blocks.length && b.digest !== root.digest) throw new Error(`bad block from ${base}: CAR root is not the requested CID`)
          if (!blocks.some((x) => x.digest === b.digest)) blocks.push({ cid: b.cid, mhCode: b.mhCode, digest: b.digest, size: b.size })
        }
      }
      if (!blocks.length) throw new Error('empty CAR')
      return { blocks, from: base }
    } finally { clearTimeout(t); ctl.abort() }
  }
  // Race every endpoint; the first good CAR wins and the rest are aborted. A bad-block CAR is a hard failure, not a race loser.
  try {
    return await Promise.any(urls.map((u, i) => one(u, ctls[i]).catch((e) => { if (e.message?.startsWith('bad block')) throw Object.assign(e, { fatal: true }); throw e })))
  } catch (agg) {
    const fatal = agg.errors?.find((e) => e.fatal)
    if (fatal) throw fatal
    return null
  } finally { ctls.forEach((c) => c.abort()) }
}

// Time to first byte + body. -> { ttfb, total, ok, status, body }
export async function timedGet(base, cid, { timeoutMs = 15000, fetchFn = fetch, now = () => performance.now() } = {}) {
  const t0 = now()
  const r = await fetchFn(`${base}/ipfs/${cid}?format=raw`, { headers: { accept: 'application/vnd.ipld.raw' }, signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' })
  const ttfb = now() - t0
  const body = new Uint8Array(await r.arrayBuffer())
  return { ttfb, total: now() - t0, ok: r.ok, status: r.status, body }
}

// Uniform sample without replacement (Fisher-Yates prefix).
export function pick(blocks, n, rand = Math.random) {
  const a = [...blocks]
  for (let i = 0; i < Math.min(n, a.length); i++) { const j = i + Math.floor(rand() * (a.length - i)); [a[i], a[j]] = [a[j], a[i]] }
  return a.slice(0, n)
}

// Classify one endpoint. -> { status: 'local'|'on-demand'|'invalid'|'unreachable', baseline, probe, excess, verified, rounds, error? }
export async function challenge(base, blocks, { rounds = 5, maxExcessMs = 30, fetchFn = fetch, timeoutMs = 15000, now, onPair = () => {} } = {}) {
  const opts = { fetchFn, timeoutMs, now }
  try {
    const warm = await timedGet(base, IDENTITY, opts)
    if (!warm.ok) return { status: 'unreachable', error: `bafkqaaa ${warm.status}` }
    const picks = pick(blocks.filter((b) => b.mhCode === 0x12), rounds)
    if (!picks.length) return { status: 'invalid', error: 'no sha256 blocks to challenge' }
    const baseline = [], probe = [], transfer = [], diffs = []
    let verified = 0, failed = []
    for (const b of picks) { // interleaved pairs so path drift during the run cancels out
      const bl = (await timedGet(base, IDENTITY, opts)).ttfb
      const r = await timedGet(base, b.cid, opts)
      baseline.push(bl); probe.push(r.ttfb); transfer.push(r.total - r.ttfb); diffs.push(r.ttfb - bl)
      onPair(diffs.length, picks.length)
      const h = r.ok ? await sha256hex(r.body) : null
      if (h && h === b.digest) verified++
      else failed.push({ cid: b.cid, status: r.status })
    }
    const excess = median(diffs)
    const allValid = verified === picks.length
    return {
      status: !allValid ? 'invalid' : excess < maxExcessMs ? 'local' : 'on-demand',
      error: !allValid ? (failed.some((f) => f.status === 200) ? 'served wrong bytes' : `HTTP ${failed[0]?.status}: piece not served`) : undefined,
      baseline: median(baseline), probe: median(probe), excess, transfer: median(transfer), verified, rounds: picks.length, failed,
      weak: picks.length < 3 || excess < -50 || undefined, // fewer than 3 pairs, or baseline noisier than the signal: timing is not meaningful
    }
  } catch (err) {
    return { status: 'unreachable', error: err.cause?.code ?? (err.name === 'TypeError' ? 'fetch failed (TLS, CORS or DNS)' : err.name) }
  }
}
