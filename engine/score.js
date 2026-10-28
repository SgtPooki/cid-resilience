// Distance bounds, multi-vantage separation, resilience score. Sources: G 9d, 10a, 10b.
// G 10a: group index 1.4682 -> 299792.458/1.4682 = 204.19 km/ms one way, so 102.1 km per ms of RTT. Rounded UP: a
// smaller constant would shrink disks and could manufacture a separation. (G 10b's "100 km per ms" is the rule of thumb.)
export const KM_PER_MS = 102.1
export const LOCATION_SLACK_KM = 11 // vantage coordinates are rounded to 0.1 degree (~11 km) before sharing

export const radiusKm = (rttMs) => rttMs * KM_PER_MS + LOCATION_SLACK_KM

export function haversineKm(a, b) {
  const R = 6371, toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

// A disk is { lat, lon, r } (vantage position + radius). Disjoint disks cannot share a point.
export const disjoint = (a, b) => haversineKm(a, b) > a.r + b.r

// Observations: [{ vantage:{lat,lon}, baseline }] per provider. -> disks (vantages without location give none)
export const disksOf = (obs) => obs.filter((o) => o.vantage?.lat != null && o.baseline != null && o.status === 'local')
  .map((o) => ({ lat: o.vantage.lat, lon: o.vantage.lon, r: radiusKm(o.baseline) }))

// Two providers are proven apart if any disk of A is disjoint from any disk of B (sound, not complete).
export const separated = (disksA, disksB) => disksA.some((a) => disksB.some((b) => disjoint(a, b)))

// Same provider seen from two vantages must have intersecting disks; otherwise a vantage lied or mislocated itself.
export function inconsistencies(disks) {
  const out = []
  for (let i = 0; i < disks.length; i++) for (let j = i + 1; j < disks.length; j++) if (disjoint(disks[i], disks[j])) out.push([i, j])
  return out
}

// Largest set of pairwise-separated items. ponytail: brute force over bitmasks; callers must keep items <= MAX_CLIQUE_ITEMS.
export const MAX_CLIQUE_ITEMS = 20
export function maxSeparatedSet(items, isSep) {
  const n = Math.min(items.length, MAX_CLIQUE_ITEMS)
  let best = []
  for (let mask = 1; mask < 1 << n; mask++) {
    const idx = []
    for (let i = 0; i < n; i++) if (mask & (1 << i)) idx.push(i)
    if (idx.length <= best.length) continue
    let ok = true
    outer: for (let a = 0; a < idx.length; a++) for (let b = a + 1; b < idx.length; b++) if (!isSep(items[idx[a]], items[idx[b]])) { ok = false; break outer }
    if (ok) best = idx
  }
  return best.map((i) => items[i])
}

// ipClusters: boxes (same IP). asnClusters: operators (same ASN), the conservative count when nothing is proven apart.
// Each: [{ key, cdn, providers:[{ obs:[{vantage, baseline, status}] }] }]
const hasLocal = (c) => !c.cdn && c.providers.some((p) => p.obs.some((o) => o.status === 'local'))
export function score(ipClusters, asnClusters, vantages) {
  const durable = ipClusters.filter(hasLocal)
  const disksC = (c) => c.providers.flatMap((p) => disksOf(p.obs))
  const sep = maxSeparatedSet(durable, (a, b) => separated(disksC(a), disksC(b)))
  const allProviders = ipClusters.flatMap((c) => c.providers)
  const count = (...ss) => allProviders.filter((p) => p.obs.some((o) => ss.includes(o.status))).length
  const located = vantages.filter((v) => v.lat != null).length
  return {
    advertised: allProviders.length,
    servedValid: count('local', 'on-demand'),
    local: count('local'),
    onDemand: count('on-demand'),
    boxes: durable.length,
    operators: asnClusters.filter(hasLocal).length,
    cdnClusters: ipClusters.filter((c) => c.cdn).length,
    provenSeparate: located >= 2 ? sep.length : 0,
    separateKeys: located >= 2 ? sep.map((c) => c.key) : [],
    vantages: vantages.length,
    locatedVantages: located,
    capped: durable.length > MAX_CLIQUE_ITEMS, // provenSeparate is then a lower bound over the first MAX_CLIQUE_ITEMS boxes
  }
}

// "N copies within X km of you": local providers whose disk radius from this vantage is <= km.
export const withinKm = (providers, vantageId, km) =>
  providers.filter((p) => p.obs.some((o) => o.vantageId === vantageId && o.status === 'local' && radiusKm(o.baseline) <= km)).length
