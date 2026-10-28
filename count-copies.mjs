#!/usr/bin/env node
// Count how many providers provably hold their own copy of a CID, using only IPFS primitives:
// delegated routing + IPNI for discovery, trustless gateway block fetches as timed challenges.
import { createHash } from 'node:crypto'
import { lookup } from 'node:dns/promises'

const cid = process.argv[2] ?? 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const ROUNDS = Number(process.env.ROUNDS ?? 5)
const MAX_EXCESS_MS = Number(process.env.MAX_EXCESS_MS ?? 30)
const IDENTITY = 'bafkqaaa' // empty identity CID: gateway answers without touching storage

const varint = (buf, i) => {
  let n = 0, shift = 0, b
  do { b = buf[i++]; n += (b & 0x7f) * 2 ** shift; shift += 7 } while (b & 0x80)
  return [n, i]
}

const B32 = 'abcdefghijklmnopqrstuvwxyz234567'
const base32 = (bytes) => {
  let bits = 0, val = 0, out = ''
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5 }
  }
  return bits ? out + B32[(val << (5 - bits)) & 31] : out
}

// -> [{ cid, mhCode, digest }]
function parseCar(buf) {
  let [len, i] = varint(buf, 0)
  i += len
  const blocks = []
  while (i < buf.length) {
    const [secLen, start] = varint(buf, i)
    const end = start + secLen
    let cidBytes, mhCode, digest, j
    if (buf[start] === 0x12 && buf[start + 1] === 0x20) {
      j = start + 34
      cidBytes = Uint8Array.of(0x01, 0x70, ...buf.subarray(start, j))
      mhCode = 0x12
      digest = buf.subarray(start + 2, j)
    } else {
      ;[, j] = varint(buf, start)
      ;[, j] = varint(buf, j)
      ;[mhCode, j] = varint(buf, j)
      let mhLen
      ;[mhLen, j] = varint(buf, j)
      digest = buf.subarray(j, j + mhLen)
      j += mhLen
      cidBytes = buf.subarray(start, j)
    }
    blocks.push({ cid: 'b' + base32(cidBytes), mhCode, digest: Buffer.from(digest).toString('hex') })
    i = end
  }
  return blocks
}

// /dns/host/tcp/443/https or /ip4/1.2.3.4/tcp/8443/https -> https://host:port
function httpsUrl(ma) {
  const m = ma.match(/^\/(?:dns|dns4|dns6|ip4)\/([^/]+)\/tcp\/(\d+)\/(?:tls\/http|https)$/)
  return m && `https://${m[1]}${m[2] === '443' ? '' : ':' + m[2]}`
}

async function discover() {
  const [dr, ipni] = await Promise.all([
    fetch(`https://delegated-ipfs.dev/routing/v1/providers/${cid}`).then((r) => r.json()).then((j) => j.Providers ?? []).catch(() => []),
    fetch(`https://cid.contact/cid/${cid}`, { headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : { MultihashResults: [] }))
      .then((j) => j.MultihashResults.flatMap((m) => m.ProviderResults.map((p) => p.Provider)))
      .catch(() => []),
  ])
  const byUrl = new Map()
  let skipped = new Set()
  for (const p of [...dr, ...ipni]) {
    const urls = (p.Addrs ?? []).map(httpsUrl).filter(Boolean)
    if (!urls.length) skipped.add(p.ID)
    for (const u of urls) (byUrl.get(u) ?? byUrl.set(u, new Set()).get(u)).add(p.ID)
  }
  return { byUrl, skipped, counts: { delegated: dr.length, ipni: ipni.length } }
}

async function timedGet(base, c) {
  const t = performance.now()
  const r = await fetch(`${base}/ipfs/${c}?format=raw`, { headers: { accept: 'application/vnd.ipld.raw' }, signal: AbortSignal.timeout(15000) })
  const ms = performance.now() - t
  return { ms, ok: r.ok, body: new Uint8Array(await r.arrayBuffer()) }
}

const median = (xs) => xs.toSorted((a, b) => a - b)[Math.floor(xs.length / 2)]

async function challenge(base, blocks) {
  try {
    await timedGet(base, IDENTITY) // warm TLS
    const picks = blocks.toSorted(() => Math.random() - 0.5).slice(0, ROUNDS)
    const baseline = [], probe = []
    let verified = 0, unverifiable = 0
    for (let k = 0; k < ROUNDS; k++) baseline.push((await timedGet(base, IDENTITY)).ms)
    for (const b of picks) {
      const r = await timedGet(base, b.cid)
      probe.push(r.ms)
      if (b.mhCode !== 0x12) unverifiable++
      else if (r.ok && createHash('sha256').update(r.body).digest('hex') === b.digest) verified++
    }
    const excess = median(probe) - median(baseline)
    const pass = verified + unverifiable === picks.length && excess < MAX_EXCESS_MS
    return { baseline: median(baseline), probe: median(probe), excess, verified: `${verified}/${picks.length}`, pass }
  } catch (err) {
    return { error: err.cause?.code ?? err.name, pass: false }
  }
}

const { byUrl, skipped, counts } = await discover()
console.log(`${cid}\nrecords: delegated-routing=${counts.delegated} ipni=${counts.ipni} -> ${byUrl.size} http endpoints (${skipped.size} non-http peers skipped)\n`)

let blocks
for (const base of byUrl.keys()) {
  const r = await fetch(`${base}/ipfs/${cid}?format=car`, { headers: { accept: 'application/vnd.ipld.car' }, signal: AbortSignal.timeout(30000) }).catch(() => null)
  if (r?.ok) { blocks = parseCar(new Uint8Array(await r.arrayBuffer())); console.log(`dag: ${blocks.length} blocks (from ${base})\n`); break }
}
if (!blocks) throw new Error('no provider served the DAG')
if (blocks.length < ROUNDS) console.log(`warning: only ${blocks.length} blocks, fewer than ${ROUNDS} rounds; timing is weak\n`)

const rows = await Promise.all([...byUrl].map(async ([base, peers]) => {
  const host = new URL(base).hostname
  const ip = await lookup(host).then((a) => a.address).catch(() => '?')
  return { base, ip, peers: peers.size, ...(await challenge(base, blocks)) }
}))

const f = (n) => (n == null ? '' : n.toFixed(0).padStart(5))
for (const r of rows.toSorted((a, b) => a.ip.localeCompare(b.ip))) {
  const verdict = r.error ? `FAIL (${r.error})` : r.pass ? 'PASS' : 'FAIL'
  console.log(`${verdict.padEnd(18)} ${r.ip.padEnd(16)} base=${f(r.baseline)}ms probe=${f(r.probe)}ms excess=${f(r.excess)}ms sha=${r.verified ?? '-'} peers=${r.peers} ${r.base}`)
}

// ponytail: one copy per IP; a single operator with many IPs in one DC still counts N times. Fix with multi-vantage RTT geolocation.
const copies = new Set(rows.filter((r) => r.pass).map((r) => r.ip))
console.log(`\n${byUrl.size} endpoints, ${copies.size} distinct IPs proved a local copy (excess < ${MAX_EXCESS_MS}ms)`)
