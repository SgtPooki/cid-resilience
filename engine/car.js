// CAR v1 parsing and CID helpers. No deps; works in browser and Node.

export function varint(buf, i) {
  let n = 0, shift = 0, b
  do {
    if (i >= buf.length) return null // incomplete
    b = buf[i++]; n += (b & 0x7f) * 2 ** shift; shift += 7
  } while (b & 0x80)
  return [n, i]
}

const B32 = 'abcdefghijklmnopqrstuvwxyz234567'
export function base32(bytes) {
  let bits = 0, val = 0, out = ''
  for (const b of bytes) {
    val = ((val << 8) | b) >>> 0; bits += 8
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5 }
  }
  return bits ? out + B32[(val << (5 - bits)) & 31] : out
}

export const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

// Parse a CID at buf[start]. -> { cid, mhCode, digest, end } or null if incomplete.
export function parseCid(buf, start) {
  if (buf[start] === 0x12 && buf[start + 1] === 0x20) { // CIDv0 = bare sha256 multihash
    const end = start + 34
    if (end > buf.length) return null
    return { cid: 'b' + base32(Uint8Array.of(0x01, 0x70, ...buf.subarray(start, end))), mhCode: 0x12, digest: hex(buf.subarray(start + 2, end)), end }
  }
  let r = varint(buf, start); if (!r) return null // version
  r = varint(buf, r[1]); if (!r) return null       // codec
  r = varint(buf, r[1]); if (!r) return null
  const mhCode = r[0]
  r = varint(buf, r[1]); if (!r) return null
  const end = r[1] + r[0]
  if (end > buf.length) return null
  return { cid: 'b' + base32(buf.subarray(start, end)), mhCode, digest: hex(buf.subarray(r[1], end)), end }
}

// Incremental CAR v1 parse. Returns the complete blocks found and the unconsumed tail.
// state.headerDone tracks whether the header varint+bytes were skipped.
export function parseCarChunk(buf, state = { headerDone: false }) {
  let i = 0
  const blocks = []
  if (!state.headerDone) {
    const r = varint(buf, 0)
    if (!r || r[1] + r[0] > buf.length) return { blocks, rest: buf, state }
    i = r[1] + r[0]
    state.headerDone = true
  }
  while (i < buf.length) {
    const r = varint(buf, i)
    if (!r) break
    const [secLen, start] = r
    const end = start + secLen
    if (end > buf.length) break
    const c = parseCid(buf.subarray(0, end), start)
    if (!c || c.end > end) throw new Error('CID overruns its CAR section')
    blocks.push({ cid: c.cid, mhCode: c.mhCode, digest: c.digest, size: end - c.end, bytes: buf.subarray(c.end, end) })
    i = end
  }
  return { blocks, rest: buf.subarray(i), state }
}

export function parseCar(buf) {
  const { blocks, rest } = parseCarChunk(buf)
  if (rest.length) throw new Error(`${rest.length} trailing bytes in CAR`)
  return blocks
}

export const concat = (a, b) => { const out = new Uint8Array(a.length + b.length); out.set(a); out.set(b, a.length); return out }

export async function sha256hex(bytes) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
}

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
function base58(str) {
  const bytes = [0]
  for (const ch of str) {
    let carry = B58.indexOf(ch)
    if (carry < 0) throw new Error('bad base58')
    for (let i = 0; i < bytes.length; i++) { carry += bytes[i] * 58; bytes[i] = carry & 0xff; carry >>= 8 }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8 }
  }
  for (const ch of str) { if (ch !== '1') break; bytes.push(0) }
  return Uint8Array.from(bytes.reverse())
}
function unbase32(str) {
  let bits = 0, val = 0
  const out = []
  for (const ch of str) {
    const v = B32.indexOf(ch); if (v < 0) throw new Error('bad base32')
    val = ((val << 5) | v) >>> 0; bits += 5
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8 }
  }
  return Uint8Array.from(out)
}
// CID string -> { mhCode, digest (hex) }. Supports CIDv0 (Qm..., base58btc) and base32 CIDv1 (b...).
export function cidDigest(cid) {
  const bytes = cid.startsWith('Qm') ? base58(cid) : cid.startsWith('b') ? unbase32(cid.slice(1)) : null
  if (!bytes) throw new Error('unsupported CID encoding (use base32 CIDv1 or CIDv0)')
  const c = parseCid(bytes, 0)
  if (!c || c.end !== bytes.length) throw new Error('bad CID')
  return { mhCode: c.mhCode, digest: c.digest }
}
