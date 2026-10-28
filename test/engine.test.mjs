import { test } from 'node:test'
import assert from 'node:assert/strict'
import { varint, base32, parseCar, parseCarChunk, sha256hex, concat, cidDigest } from '../engine/car.js'
import { protocolsFromMetadata, httpUrl, endpoints } from '../engine/discover.js'
import { challenge, median, fetchBlocks, pick } from '../engine/probe.js'
import { haversineKm, disjoint, separated, maxSeparatedSet, score, radiusKm, inconsistencies, KM_PER_MS, LOCATION_SLACK_KM, grade } from '../engine/score.js'
import { merge, encodeReports, decodeReports } from '../engine/report.js'
import { wantBlockMessage, parseResponse } from '../engine/bitswap.js'

const uvarint = (n) => { const out = []; while (n >= 0x80) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128) } out.push(n); return out }
async function carFor(bodies) {
  const header = [0xa2, 0x65, 0x72, 0x6f, 0x6f, 0x74, 0x73, 0x80, 0x67, 0x76, 0x65, 0x72, 0x73, 0x69, 0x6f, 0x6e, 0x01] // {roots:[],version:1}
  const parts = [...uvarint(header.length), ...header]
  const cids = []
  for (const body of bodies) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', body))
    const cidBytes = [0x01, 0x55, 0x12, 0x20, ...digest]
    cids.push('b' + base32(Uint8Array.from(cidBytes)))
    parts.push(...uvarint(cidBytes.length + body.length), ...cidBytes, ...body)
  }
  return { car: Uint8Array.from(parts), cids }
}

test('varint', () => {
  assert.deepEqual(varint(Uint8Array.of(0x05), 0), [5, 1])
  assert.deepEqual(varint(Uint8Array.of(0xac, 0x02), 0), [300, 2])
  assert.equal(varint(Uint8Array.of(0xac), 0), null)
})

test('base32 matches a known CID', () => {
  // bafkqaaa = CIDv1 raw identity empty: bytes 01 55 00 00
  assert.equal('b' + base32(Uint8Array.of(0x01, 0x55, 0x00, 0x00)), 'bafkqaaa')
})

test('parseCar reads blocks and incremental parse handles split chunks', async () => {
  const bodies = [new TextEncoder().encode('hello'), new Uint8Array(300).fill(7)]
  const { car, cids } = await carFor(bodies)
  const blocks = parseCar(car)
  assert.equal(blocks[0].cid, 'bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq') // raw sha256("hello"), computed with python base64.b32encode
  assert.deepEqual(blocks.map((b) => b.cid), cids)
  assert.equal(blocks[1].size, 300)
  assert.equal(await sha256hex(blocks[0].bytes), blocks[0].digest)
  // split mid-way through the second section: first chunk yields block 0 only, remainder completes block 1
  const cut = car.length - 100
  const state = { headerDone: false }
  const first = parseCarChunk(car.subarray(0, cut), state)
  assert.deepEqual(first.blocks.map((b) => b.cid), [cids[0]])
  assert.equal(state.headerDone, true)
  const second = parseCarChunk(concat(first.rest, car.subarray(cut)), state)
  assert.deepEqual(second.blocks.map((b) => b.cid), [cids[1]])
  assert.equal(second.rest.length, 0)
  assert.throws(() => parseCar(car.subarray(0, car.length - 1)), /trailing/)
})

test('CIDv0 sections parse', () => {
  const digest = new Uint8Array(32).fill(1)
  const sec = [0x12, 0x20, ...digest, 0xaa]
  const car = Uint8Array.from([1, 0xa0, ...uvarint(sec.length), ...sec])
  const [b] = parseCar(car)
  assert.equal(b.mhCode, 0x12); assert.equal(b.size, 1); assert.equal(b.digest, '01'.repeat(32))
  assert.throws(() => parseCar(Uint8Array.from([1, 0xa0, 5, 0x12, 0x20, 1, 1, 1])), /overruns/) // CID longer than its section
})

test('cidDigest decodes CIDv0 and base32 CIDv1 to the same digest', () => {
  const v0 = cidDigest('QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB')
  const v1 = cidDigest('bafybeiasb5vpmaounyilfuxbd3lryvosl4yefqrfahsb2esg46q6tu6y5q') // v0 re-encoded as base32 CIDv1 with python base64.b32encode
  assert.equal(v0.digest, v1.digest); assert.equal(v0.mhCode, 0x12)
  assert.throws(() => cidDigest('zdj7Wd'), /unsupported/)
})

test('fetchBlocks rejects a CAR whose root is not the requested CID', async () => {
  const { car } = await carFor([new TextEncoder().encode('hello')])
  const other = 'bafybeiasb5vpmaounyilfuxbd3lryvosl4yefqrfahsb2esg46q6tu6y5q'
  const fetchFn = async () => new Response(car)
  await assert.rejects(fetchBlocks(other, ['https://g'], { fetchFn }), /root is not the requested CID/)
  const ok = await fetchBlocks('bafkreibm6jg3ux5qumhcn2b3flc3tyu6dmlb4xa7u5bf44yegnrjhc4yeq', ['https://g'], { fetchFn })
  assert.equal(ok.blocks.length, 1); assert.equal(ok.from, 'https://g')
  // strict cap: a CAR delivered in one chunk with more blocks than maxBlocks yields exactly maxBlocks
  const many = await carFor(Array.from({ length: 5 }, (_, i) => Uint8Array.of(i)))
  const capped = await fetchBlocks(many.cids[0], ['https://g'], { fetchFn: async () => new Response(many.car), maxBlocks: 3 })
  assert.equal(capped.blocks.length, 3)
})

test('IPNI metadata and multiaddr parsing', () => {
  assert.deepEqual(protocolsFromMetadata('gBI='), ['transport-bitswap'])
  assert.deepEqual(protocolsFromMetadata('oBIA'), ['transport-ipfs-gateway-http'])
  assert.equal(httpUrl('/dns/x.io/tcp/443/https'), 'https://x.io')
  assert.equal(httpUrl('/dns4/x.io/tcp/8443/tls/http'), 'https://x.io:8443')
  assert.equal(httpUrl('/ip4/1.2.3.4/tcp/80/http'), 'http://1.2.3.4')
  assert.equal(httpUrl('/ip4/1.2.3.4/tcp/4001'), null)
  const peers = new Map([['A', { id: 'A', addrs: new Set(['/dns/x.io/tcp/443/https', '/ip4/1.1.1.1/tcp/4001']) }], ['B', { id: 'B', addrs: new Set(['/dns/x.io/tcp/443/https']) }]])
  assert.deepEqual(endpoints(peers), [{ url: 'https://x.io', peers: ['A', 'B'], https: true }])
})

// Fake gateway with a fake clock: each fetch advances `t` by the configured latency, no real timers.
const fakeGateway = (latency, bodies = {}) => {
  let t = 0
  const fetchFn = async (url) => {
    const c = url.match(/\/ipfs\/([^?]+)/)[1]
    t += latency[c] ?? 1
    const body = bodies[c] ?? new Uint8Array(0)
    return { ok: !!(c === 'bafkqaaa' || bodies[c]), status: bodies[c] || c === 'bafkqaaa' ? 200 : 404, arrayBuffer: async () => body.buffer }
  }
  return { fetchFn, now: () => t }
}

test('challenge classifies local, on-demand, invalid, unreachable', async () => {
  const body = new TextEncoder().encode('block')
  const digest = await sha256hex(body)
  const blocks = [{ cid: 'bX', mhCode: 0x12, digest }]
  const opts = { rounds: 2, maxExcessMs: 30 }
  const local = await challenge('http://h', blocks, { ...opts, ...fakeGateway({ bafkqaaa: 10, bX: 25 }, { bX: body }) })
  assert.equal(local.status, 'local'); assert.equal(local.baseline, 10); assert.equal(local.excess, 15)
  const slow = await challenge('http://h', blocks, { ...opts, ...fakeGateway({ bafkqaaa: 10, bX: 40 }, { bX: body }) })
  assert.equal(slow.status, 'on-demand'); assert.equal(slow.excess, 30) // threshold is exclusive
  assert.equal((await challenge('http://h', blocks, { ...opts, ...fakeGateway({}, { bX: new Uint8Array(3) }) })).status, 'invalid')
  assert.equal((await challenge('http://h', blocks, { ...opts, ...fakeGateway({}, {}) })).status, 'invalid')
  assert.equal((await challenge('http://h', blocks, { ...opts, fetchFn: async () => { throw new Error('boom') } })).status, 'unreachable')
  assert.equal(median([3, 1, 2]), 2)
  assert.deepEqual(pick([1, 2, 3, 4], 2, () => 0), [1, 2]) // rand=0 keeps order; samples without replacement
  assert.deepEqual(pick([1, 2, 3], 5, () => 0.99), [3, 1, 2])
})

test('distance bounds and separation', () => {
  const nyc = { lat: 40.71, lon: -74.01 }, lon = { lat: 51.51, lon: -0.13 }
  assert.ok(Math.abs(haversineKm(nyc, lon) - 5570) < 30)
  assert.equal(radiusKm(10), 10 * KM_PER_MS + LOCATION_SLACK_KM)
  assert.ok(KM_PER_MS >= 299792.458 / 1.4682 / 2 / 1000, 'constant must not be below the fibre bound (G 10a)')
  assert.ok(disjoint({ ...nyc, r: 1000 }, { ...lon, r: 1000 }))
  assert.ok(!disjoint({ ...nyc, r: 3000 }, { ...lon, r: 3000 }))
  const half = haversineKm(nyc, lon) / 2
  assert.ok(!disjoint({ ...nyc, r: half }, { ...lon, r: half }), 'touching disks are not disjoint')
  // provider A near NYC (10 ms from nyc), B near London: two vantages prove them apart
  const obsA = [{ vantage: nyc, baseline: 10, status: 'local' }, { vantage: lon, baseline: 80, status: 'local' }]
  const obsB = [{ vantage: nyc, baseline: 80, status: 'local' }, { vantage: lon, baseline: 10, status: 'local' }]
  const d = (o) => o.map((x) => ({ ...x.vantage, r: radiusKm(x.baseline) }))
  assert.ok(separated(d(obsA), d(obsB)))
  // single vantage: concentric disks, never separated
  assert.ok(!separated(d(obsA.slice(0, 1)), d(obsB.slice(0, 1))))
  assert.deepEqual(inconsistencies([{ ...nyc, r: 100 }, { ...lon, r: 100 }]), [[0, 1]])
})

test('maxSeparatedSet is the largest pairwise-separated subset', () => {
  const sep = (a, b) => Math.abs(a - b) >= 2
  assert.deepEqual(maxSeparatedSet([1, 2, 3, 5, 7], sep), [1, 3, 5, 7])
  assert.deepEqual(maxSeparatedSet([], sep), [])
  assert.equal(maxSeparatedSet(Array.from({ length: 25 }, (_, i) => i * 10), sep).length, 20) // capped: callers report score.capped
})

test('score counts failure domains, not providers; needs two located vantages', () => {
  const v1 = { id: 'a', lat: 40.71, lon: -74.01 }, v2 = { id: 'b', lat: 51.51, lon: -0.13 }
  const p = (s1, b1, s2, b2) => ({ obs: [{ vantageId: 'a', vantage: v1, status: s1, baseline: b1 }, { vantageId: 'b', vantage: v2, status: s2, baseline: b2 }] })
  const cl = [
    { key: 'x', cdn: false, providers: [p('local', 10, 'local', 80), p('local', 11, 'local', 81)] }, // same operator, 2 IPs
    { key: 'y', cdn: false, providers: [p('local', 80, 'local', 10)] },
    { key: 'z', cdn: true, providers: [p('local', 5, 'local', 5)] },
    { key: 'w', cdn: false, providers: [p('on-demand', 10, 'on-demand', 10)] },
  ]
  const ops = [{ key: 'op', cdn: false, providers: [...cl[0].providers, ...cl[1].providers] }, cl[2], cl[3]]
  cl[3].providers[0].obs[0].status = 'local' // local from one vantage, on-demand from the other: counted once as served valid
  const s = score(cl, ops, [v1, v2])
  assert.equal(s.advertised, 5); assert.equal(s.servedValid, 5); assert.equal(s.local, 5); assert.equal(s.onDemand, 1); assert.equal(s.capped, false)
  assert.equal(s.boxes, 3); assert.equal(s.operators, 2); assert.equal(s.cdnClusters, 1); assert.equal(s.provenSeparate, 2)
  assert.equal(score(cl, ops, [v1]).provenSeparate, 0)
  assert.equal(score([cl[0]], [ops[0]], [v1, v2]).provenSeparate, 0) // a lone box is never 'proven apart'
  assert.equal(score(cl, ops, [v1, { id: 'c', lat: null, lon: null }]).provenSeparate, 0)
})

test('merge + fragment round trip', async () => {
  const r1 = { v: 1, cid: 'bafy1', vantage: { id: 'a', label: 'nyc', lat: 40.7, lon: -74 }, providers: [{ url: 'https://x', peers: ['P'], ip: '1.1.1.1', status: 'local', baseline: 10 }] }
  const r2 = { v: 1, cid: 'bafy1', vantage: { id: 'b', label: 'lon', lat: 51.5, lon: -0.1 }, providers: [{ url: 'https://x', peers: ['Q'], ip: '1.1.1.1', status: 'on-demand', baseline: 80 }] }
  const m = merge([r1, r2, r1])
  assert.equal(m.vantages.length, 2)
  assert.equal(m.providers.length, 1)
  assert.deepEqual(m.providers[0].peers, ['P', 'Q'])
  assert.equal(m.providers[0].ip, '1.1.1.1')
  assert.equal(m.providers[0].obs.length, 2)
  assert.throws(() => merge([r1, { ...r2, cid: 'other' }]), /different CIDs/)
  // geo-DNS: same URL, different IP from another vantage is a separate box
  const r3 = { ...r2, vantage: { id: 'c', label: 'fra', lat: 50.1, lon: 8.7 }, providers: [{ ...r2.providers[0], ip: '2.2.2.2' }] }
  assert.equal(merge([r1, r3]).providers.length, 2)
  const frag = await encodeReports([r1, r2])
  assert.match(frag, /^[A-Za-z0-9_-]+$/)
  const back = await decodeReports(frag)
  assert.equal(back.length, 2)
  assert.equal(back[0].providers[0].url, 'https://x'); assert.equal(back[0].providers[0].baseline, 10); assert.equal(back[1].vantage.label, 'lon')
  // untrusted input: bad url scheme, unknown status and html in labels are dropped or neutralised
  const evil = { ...r1, vantage: { ...r1.vantage, label: '<img src=x onerror=1>' }, providers: [{ url: 'javascript:alert(1)', peers: ['P'], status: 'pwned', baseline: 'NaN' }] }
  const [san] = await decodeReports(await encodeReports([evil]))
  assert.equal(san.providers[0].url, null); assert.equal(san.providers[0].status, 'advertised'); assert.equal(san.providers[0].baseline, null)
  await assert.rejects(decodeReports(await encodeReports([{ nope: 1 }])), /malformed/)
})

test('bitswap want-block message encodes as length-prefixed protobuf', () => {
  const cid = Uint8Array.of(1, 0x55, 0x12, 0x20, ...new Uint8Array(32).fill(9))
  const m = wantBlockMessage(cid)
  // outer length, Message.wantlist(0x0a), Wantlist.entries(0x0a), Entry.block(0x0a)
  assert.equal(m[0], m.length - 1)
  assert.deepEqual([...m.slice(1, 7)], [0x0a, 46, 0x0a, 44, 0x0a, 36])
  assert.deepEqual([...m.slice(43)], [0x10, 1, 0x20, 0, 0x28, 1])
})

test('bitswap response parsing: payload blocks and DontHave presences', () => {
  const data = Uint8Array.of(1, 2, 3), prefix = Uint8Array.of(1, 0x55, 0x12, 0x20), cid = new Uint8Array(36).fill(4)
  const block = [0x0a, prefix.length, ...prefix, 0x12, data.length, ...data]
  const presence = [0x0a, cid.length, ...cid, 0x10, 1]
  const msg = Uint8Array.of(0x1a, block.length, ...block, 0x22, presence.length, ...presence, 0x28, 0)
  const r = parseResponse(msg)
  assert.deepEqual([...r.blocks[0]], [1, 2, 3])
  assert.deepEqual([...r.dontHave[0]], [...cid])
  assert.deepEqual([...parseResponse(Uint8Array.of(0x12, 2, 7, 8)).blocks[0]], [7, 8]) // bitswap 1.0 raw block
  assert.throws(() => parseResponse(Uint8Array.of(0x1a, 50, 1)), /truncated/)
})

test('grade levels', () => {
  const base = { servedValid: 0, local: 0, boxes: 0, operators: 0, locatedVantages: 1, provenSeparate: 0, capped: false }
  assert.equal(grade(base).level, 'none')
  assert.equal(grade({ ...base, servedValid: 2, local: 2, boxes: 1, operators: 1 }).level, 'single')
  assert.equal(grade({ ...base, servedValid: 3, local: 3, boxes: 3, operators: 2 }).level, 'unproven')
  assert.equal(grade({ ...base, servedValid: 3, local: 3, boxes: 3, operators: 2, locatedVantages: 2, provenSeparate: 1 }).level, 'unproven')
  assert.equal(grade({ ...base, servedValid: 3, local: 3, boxes: 3, operators: 2, locatedVantages: 2, provenSeparate: 2 }).level, 'proven')
})
