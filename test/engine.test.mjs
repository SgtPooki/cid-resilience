import { test } from 'node:test'
import assert from 'node:assert/strict'
import { varint, base32, parseCar, parseCarChunk, sha256hex } from '../engine/car.js'
import { protocolsFromMetadata, httpUrl, endpoints } from '../engine/discover.js'
import { challenge, median } from '../engine/probe.js'
import { haversineKm, disjoint, separated, maxSeparatedSet, score, radiusKm, inconsistencies } from '../engine/score.js'
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
  assert.deepEqual(blocks.map((b) => b.cid), cids)
  assert.equal(blocks[1].size, 300)
  assert.equal(await sha256hex(blocks[0].bytes), blocks[0].digest)
  // feed byte by byte
  let buf = new Uint8Array(0), state = { headerDone: false }, got = []
  for (const byte of car) {
    buf = Uint8Array.from([...buf, byte])
    const r = parseCarChunk(buf, state); buf = r.rest; got.push(...r.blocks)
  }
  assert.deepEqual(got.map((b) => b.cid), cids)
  assert.equal(buf.length, 0)
  assert.throws(() => parseCar(car.subarray(0, car.length - 1)), /trailing/)
})

test('CIDv0 sections parse', () => {
  const digest = new Uint8Array(32).fill(1)
  const sec = [0x12, 0x20, ...digest, 0xaa]
  const car = Uint8Array.from([1, 0xa0, ...uvarint(sec.length), ...sec])
  const [b] = parseCar(car)
  assert.equal(b.mhCode, 0x12); assert.equal(b.size, 1); assert.equal(b.digest, '01'.repeat(32))
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

const fakeFetch = (delays, bodies = {}) => async (url) => {
  const c = url.match(/\/ipfs\/([^?]+)/)[1]
  await new Promise((r) => setTimeout(r, delays[c] ?? 0))
  const body = bodies[c] ?? new Uint8Array(0)
  return { ok: !!(c === 'bafkqaaa' || bodies[c]), status: bodies[c] || c === 'bafkqaaa' ? 200 : 404, arrayBuffer: async () => body.buffer }
}

test('challenge classifies local, on-demand, invalid, unreachable', async () => {
  const body = new TextEncoder().encode('block')
  const digest = await sha256hex(body)
  const blocks = [{ cid: 'bX', mhCode: 0x12, digest }]
  const opts = { rounds: 2, maxExcessMs: 30 }
  assert.equal((await challenge('http://h', blocks, { ...opts, fetchFn: fakeFetch({ bX: 2 }, { bX: body }) })).status, 'local')
  assert.equal((await challenge('http://h', blocks, { ...opts, fetchFn: fakeFetch({ bX: 80 }, { bX: body }) })).status, 'on-demand')
  assert.equal((await challenge('http://h', blocks, { ...opts, fetchFn: fakeFetch({}, { bX: new Uint8Array(3) }) })).status, 'invalid')
  assert.equal((await challenge('http://h', blocks, { ...opts, fetchFn: fakeFetch({}, {}) })).status, 'invalid')
  assert.equal((await challenge('http://h', blocks, { ...opts, fetchFn: async () => { throw new Error('boom') } })).status, 'unreachable')
  assert.equal(median([3, 1, 2]), 2)
})

test('distance bounds and separation', () => {
  const nyc = { lat: 40.71, lon: -74.01 }, lon = { lat: 51.51, lon: -0.13 }
  assert.ok(Math.abs(haversineKm(nyc, lon) - 5570) < 30)
  assert.equal(radiusKm(10), 1000)
  assert.ok(disjoint({ ...nyc, r: 1000 }, { ...lon, r: 1000 }))
  assert.ok(!disjoint({ ...nyc, r: 3000 }, { ...lon, r: 3000 }))
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
  const s = score(cl, ops, [v1, v2])
  assert.equal(s.advertised, 5); assert.equal(s.local, 4); assert.equal(s.onDemand, 1)
  assert.equal(s.boxes, 2); assert.equal(s.operators, 1); assert.equal(s.cdnClusters, 1); assert.equal(s.provenSeparate, 2)
  assert.equal(score(cl, ops, [v1]).provenSeparate, 0)
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
  assert.deepEqual(await decodeReports(frag), [r1, r2])
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
})
