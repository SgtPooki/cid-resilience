import { run, analyze, newVantage, withinKm, radiusKm, disksOf, inconsistencies, shareUrl, reportsFromUrl } from './engine/index.js'

const $ = (id) => document.getElementById(id)
let reports = [], providers = new Map(), running = false
const fmt = (n) => (n == null || !isFinite(n) ? '' : Math.round(n))
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

$('geo').onclick = () => navigator.geolocation.getCurrentPosition(
  (p) => { $('lat').value = p.coords.latitude.toFixed(1); $('lon').value = p.coords.longitude.toFixed(1) },
  (e) => { $('status').textContent = `location denied: ${e.message}` }, { timeout: 10000 })

function renderLive() {
  $('results').hidden = false
  $('rows').innerHTML = [...providers.values()].map((p) => row(p, [{ vantage: current, status: p.status, baseline: p.baseline, excess: p.excess, verified: p.verified, rounds: p.rounds, error: p.error }])).join('')
}

function row(p, obs) {
  const ob = obs[0]
  const where = p.url ? `<a href="${esc(p.url)}/ipfs/bafkqaaa" class="mono">${esc(p.url)}</a>` : `<span class="mono">${esc(p.peers?.[0])}</span> <span class="tag">bitswap</span>`
  const op = [p.ip, p.holder ? `AS${p.asn} ${p.holder}` : p.asn ? `AS${p.asn}` : ''].filter(Boolean).join('<br>') + (p.cdn ? ' <span class="tag">cdn</span>' : '')
  const km = obs.filter((o) => o.status === 'local' && o.vantage?.lat != null).map((o) => `${fmt(radiusKm(o.baseline))}`).join(' / ')
  const seen = obs.map((o) => `<span class="${o.status}">${esc(o.vantage?.label ?? '?')}: ${o.status}${o.error ? ` (${esc(o.error)})` : ''}</span>`).join('<br>')
  return `<tr><td class="${ob.status}">${ob.status}</td><td>${where}<br><small>${(p.peers ?? []).length} peer id${p.peers?.length === 1 ? '' : 's'}</small></td><td>${op}</td><td class="n">${fmt(ob.baseline)}</td><td class="n">${fmt(ob.excess)}</td><td class="n">${ob.verified != null ? `${ob.verified}/${ob.rounds}` : ''}</td><td class="n">${km}</td><td>${seen}</td></tr>`
}

function renderMerged() {
  const { merged, score, boxes } = analyze(reports)
  const s = score
  const sepIds = new Set(s.separateKeys)
  $('cards').innerHTML = [
    ['advertised', s.advertised, 'IPNI + delegated routing records, deduped by endpoint'],
    ['served valid', s.servedValid, 'answered a random block that hashed correctly'],
    ['local copy', s.local, 'valid and under the latency threshold'],
    ['on demand', s.onDemand, 'valid but slow: fetched from elsewhere'],
    ['boxes', s.boxes, 'distinct IPs with a local copy (CDN edges excluded)'],
    ['operators', s.operators, 'distinct ASNs with a local copy'],
    ['proven apart', s.provenSeparate, s.locatedVantages >= 2 ? 'largest set of boxes with non-overlapping RTT disks' : 'needs 2+ located vantages'],
  ].map(([k, v, d]) => `<div class="card"><b>${v}</b>${k}<br><span>${d}</span></div>`).join('')
  const me = merged.vantages.find((v) => v.id === current?.id) ?? merged.vantages[0]
  $('near').innerHTML = me?.lat != null
    ? [500, 1000, 3000].map((km) => `<b>${withinKm(merged.providers, me.id, km)}</b> local copies within ${km} km of ${esc(me.label)}`).join(' · ')
    : 'Add a location to see "N copies within X km of you".'
  $('sepnote').textContent = s.locatedVantages >= 2
    ? `Resilience score: ${s.provenSeparate} independent failure domain${s.provenSeparate === 1 ? '' : 's'} proven apart (${s.operators} operators, ${s.boxes} boxes seen). Vantage locations are self-reported.`
    : `Resilience score needs reports from two located vantages. From one vantage every disk contains you, so nothing can be proven apart. Conservative count: ${s.operators} operators.`
  $('rows').innerHTML = merged.providers
    .toSorted((a, b) => rank(a) - rank(b))
    .map((p) => row(p, p.obs).replace('<tr>', `<tr${boxes.find((c) => c.providers.includes(p) && sepIds.has(c.key)) ? ' style="outline:1px solid var(--ok)"' : ''}>`)).join('')
  $('vantages').innerHTML = merged.vantages.map((v) => `<li>${esc(v.label)} ${v.lat != null ? `(${v.lat}, ${v.lon})` : '(no location)'} <small>${esc(v.ts)} · self-reported</small></li>`).join('')
  const bad = []
  for (const p of merged.providers) {
    const obs = p.obs.filter((o) => o.status === 'local' && o.vantage?.lat != null)
    for (const [i, j] of inconsistencies(disksOf(obs))) bad.push(`${esc(obs[i].vantage.label)} and ${esc(obs[j].vantage.label)} give disjoint disks for ${esc(p.url ?? p.peers[0])}: one of them is mislocated or lying`)
  }
  $('incons').innerHTML = bad.join('<br>')
  shareUrl(location.href, reports).then((u) => { $('share').value = u; history.replaceState(null, '', u) })
  $('results').hidden = false
}
const rank = (p) => ({ local: 0, 'on-demand': 1, invalid: 2, unreachable: 3 }[p.obs[0]?.status] ?? 4)

let current
$('run').onclick = async () => {
  if (running) return
  running = true; $('run').disabled = true
  const cid = $('cid').value.trim()
  const loc = $('lat').value ? { lat: Number($('lat').value), lon: Number($('lon').value) } : null
  current = newVantage($('label').value.trim() || 'me', loc)
  providers = new Map()
  $('status').textContent = 'discovering providers...'
  try {
    const bitswapProbe = $('bitswap').checked ? (await import('./engine/bitswap.js')).bitswapProbe : null
    const report = await run(cid, {
      vantage: current, rounds: Number($('rounds').value), maxExcessMs: Number($('excess').value), bitswapProbe,
      onEvent: (e) => {
        if (e.type === 'discovered') $('status').textContent = `${e.peers} peers advertised (ipni ${e.counts.ipni}, delegated ${e.counts.delegated}), ${e.endpoints} http endpoints, ${e.bitswapPeers} browser-dialable bitswap peers${Object.keys(e.errors).length ? `; discovery errors: ${JSON.stringify(e.errors)}` : ''}. Fetching DAG...`
        if (e.type === 'dag') $('status').textContent = e.blocks ? `${e.blocks} blocks sampled from ${e.from}. Challenging providers...${e.blocks < Number($('rounds').value) ? ' (fewer blocks than rounds: timing is weak)' : ''}` : 'no endpoint served the DAG'
        if (e.type === 'provider') { providers.set(e.provider.url ?? e.provider.peers[0], e.provider); renderLive() }
      },
    })
    reports = reports.filter((r) => r.cid === cid && r.vantage.id !== current.id).concat(report)
    $('status').textContent = 'done'
    renderMerged()
  } catch (err) {
    $('status').textContent = `error: ${err.message}`
  }
  running = false; $('run').disabled = false
}

$('copy').onclick = () => navigator.clipboard.writeText($('share').value)
$('download').onclick = () => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(reports, null, 1)], { type: 'application/json' }))
  a.download = `cid-resilience-${reports[0]?.cid ?? 'report'}.json`; a.click()
}
$('mergebtn').onclick = async () => {
  const t = $('paste').value.trim()
  try {
    const incoming = t.startsWith('[') || t.startsWith('{') ? [JSON.parse(t)].flat() : await reportsFromUrl(t)
    if (!incoming.length) throw new Error('no reports found')
    reports = [...reports, ...incoming]
    if (!$('cid').value) $('cid').value = incoming[0].cid
    renderMerged(); $('paste').value = ''
  } catch (e) { $('status').textContent = `merge failed: ${e.message}` }
}

// ?cid=... prefills; &auto runs immediately. A #r= fragment loads shared reports.
const params = new URLSearchParams(location.search)
if (params.get('cid')) $('cid').value = params.get('cid')
if (params.get('label')) $('label').value = params.get('label')
if (params.get('lat')) { $('lat').value = params.get('lat'); $('lon').value = params.get('lon') }
reportsFromUrl(location.href).then((rs) => {
  if (params.has('auto')) $('run').click()
  if (!rs.length) return
  reports = rs; $('cid').value = rs[0].cid
  $('status').textContent = `loaded ${rs.length} report${rs.length === 1 ? '' : 's'} from the link. Measure from here to add your vantage.`
  renderMerged()
}).catch((e) => { $('status').textContent = `could not read link: ${e.message}` })
