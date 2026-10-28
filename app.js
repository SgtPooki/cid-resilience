import { run, analyze, newVantage, withinKm, radiusKm, haversineKm, disksOf, inconsistencies, shareUrl, reportsFromUrl, sanitize, grade } from './engine/index.js'

const $ = (id) => document.getElementById(id)
let reports = [], providers = new Map(), running = false
const fmt = (n) => (n == null || !isFinite(n) ? '' : Math.round(n))
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// Location and label edits after a run update this browser's own vantage, so a late geolocation grant still lands in the report.
function syncVantage() {
  const mine = reports.find((r) => r.vantage.id === current?.id)
  if (!mine) return
  mine.vantage.lat = $('lat').value ? Number($('lat').value) : null
  mine.vantage.lon = $('lon').value ? Number($('lon').value) : null
  mine.vantage.label = $('label').value.trim() || 'me'
  renderMerged()
}
for (const id of ['lat', 'lon', 'label']) $(id).onchange = syncVantage
$('geo').onclick = () => navigator.geolocation.getCurrentPosition(
  (p) => { $('lat').value = p.coords.latitude.toFixed(1); $('lon').value = p.coords.longitude.toFixed(1); syncVantage() },
  (e) => { $('status').textContent = `location denied: ${e.message}` }, { timeout: 10000 })

function renderLive() {
  $('results').hidden = false
  $('rows').innerHTML = [...providers.values()].map((p) => row(p, [{ vantage: current, status: p.status, baseline: p.baseline, excess: p.excess, verified: p.verified, rounds: p.rounds, error: p.error }])).join('')
}

const STATUS = new Set(['advertised', 'untested', 'local', 'on-demand', 'invalid', 'unreachable'])
const st = (s) => (STATUS.has(s) ? s : 'advertised')
const safeHttp = (u) => (typeof u === 'string' && /^https?:\/\/[\w.-]+(:\d+)?$/.test(u) ? u : null)
const BEST = ['local', 'on-demand', 'invalid', 'unreachable', 'untested', 'advertised']
function row(p, obs) {
  const ob = obs.toSorted((a, b) => BEST.indexOf(st(a.status)) - BEST.indexOf(st(b.status)))[0] // best observation across vantages; per-vantage detail is in the last column
  const url = safeHttp(p.url)
  const where = url ? `<a href="${esc(url)}/ipfs/bafkqaaa" class="mono">${esc(url)}</a>` : `<span class="mono">${esc(p.peers?.[0])}</span> <span class="tag">bitswap</span>`
  const op = [esc(p.ip), p.holder ? esc(`AS${p.asn} ${p.holder}`) : p.asn ? esc(`AS${p.asn}`) : ''].filter(Boolean).join('<br>') + (p.cdn ? ' <span class="tag">cdn</span>' : '') + (obs.some((o) => o.warmed) ? ' <span class="tag" title="served the sample CAR first, so its cache was warm before the challenge">warmed</span>' : '')
  const km = obs.filter((o) => o.status === 'local' && o.vantage?.lat != null).map((o) => `${fmt(radiusKm(o.baseline))}`).join(' / ')
  const seen = obs.map((o) => `<span class="${st(o.status)}">${esc(o.vantage?.label ?? '?')}: ${st(o.status)}${o.weak ? ' (weak timing)' : ''}${o.error ? ` (${esc(o.error)})` : ''}</span>`).join('<br>')
  return `<tr><td class="${st(ob.status)}">${st(ob.status)}</td><td>${where}<br><small>${(p.peers ?? []).length} peer id${p.peers?.length === 1 ? '' : 's'}</small></td><td>${op}</td><td class="n">${fmt(ob.baseline)}</td><td class="n">${fmt(ob.excess)}</td><td class="n">${ob.verified != null ? `${fmt(ob.verified)}/${fmt(ob.rounds)}` : ''}</td><td class="n">${km}</td><td>${seen}</td></tr>`
}

function renderMerged() {
  const { merged, score, boxes } = analyze(reports)
  const s = score
  const g = grade(s)
  $('grade').textContent = g.headline; $('grade').className = `grade ${g.level}`
  const sepIds = new Set(s.separateKeys)
  $('cards').innerHTML = [
    ['advertised', s.advertised, 'provider rows: one per HTTP endpoint and IP, plus one per bitswap-only peer'],
    ['served valid', s.servedValid, 'answered a random block that hashed correctly'],
    ['local copy', s.local, 'valid and not measurably slower than the no-op baseline, from any vantage (CDN edges included)'],
    ['on demand', s.onDemand, 'valid but slower than the threshold from some vantage'],
    ['boxes', s.boxes, 'distinct IPs with a local copy, CDN edges excluded'],
    ['operators', s.operators, 'distinct networks (ASNs) with a local copy, CDN edges excluded'],
    ['proven apart', s.provenSeparate, s.locatedVantages >= 2 ? 'largest set of boxes with non-overlapping RTT disks' : 'impossible from one vantage: needs a second located vantage'],
  ].map(([k, v, d]) => `<div class="card"><b>${v}</b>${k}<br><span>${d}</span></div>`).join('')
  const me = merged.vantages.find((v) => v.id === current?.id) ?? merged.vantages[0]
  $('near').innerHTML = me?.lat != null
    ? [500, 1000, 3000].map((km) => `<b>${withinKm(merged.providers, me.id, km)}</b> local copies within ${km} km of ${esc(me.label)}`).join(' · ')
    : 'Add a location to see "N copies within X km of you".'
  const ts = merged.vantages.map((v) => Date.parse(v.ts)).filter(Boolean)
  const when = ts.length ? ` Measured ${new Date(Math.min(...ts)).toISOString().slice(0, 16)}Z${ts.length > 1 ? ` to ${new Date(Math.max(...ts)).toISOString().slice(0, 16)}Z` : ''}; a report only says what was true then.` : ''
  $('sepnote').textContent = (s.locatedVantages >= 2
    ? `${s.provenSeparate} responder location${s.provenSeparate === 1 ? '' : 's'} proven geographically apart (${s.operators} networks, ${s.boxes} boxes seen${s.capped ? '; only the first 20 boxes were searched, so this is a lower bound' : ''}). Geographic separation only: it says nothing about shared ownership or software. Vantage locations are self-reported.`
    : `From one vantage every distance disk contains you, so nothing can be proven apart. Next step: copy the share link below and open it from another city, then press Measure there. Conservative count meanwhile: ${s.operators} networks.`) + when
  // Separation certificate: name the pair, both disks, and the gap, so the proof is readable without the table.
  $('cert').innerHTML = s.provenSeparate >= 2 ? (() => {
    const sepBoxes = boxes.filter((c) => sepIds.has(c.key))
    const best = (c) => c.providers.flatMap((p) => p.obs.filter((o) => o.status === 'local' && o.vantage?.lat != null).map((o) => ({ p, o, r: radiusKm(o.baseline) }))).toSorted((a, b) => a.r - b.r)[0]
    const lines = []
    for (let i = 0; i < sepBoxes.length; i++) for (let j = i + 1; j < sepBoxes.length; j++) {
      const a = sepBoxes[i], b = sepBoxes[j]
      let pick = null
      for (const pa of a.providers) for (const oa of pa.obs) for (const pb of b.providers) for (const ob of pb.obs) {
        if (oa.status !== 'local' || ob.status !== 'local' || oa.vantage?.lat == null || ob.vantage?.lat == null) continue
        const ra = radiusKm(oa.baseline), rb = radiusKm(ob.baseline), gap = haversineKm(oa.vantage, ob.vantage)
        if (gap > ra + rb && (!pick || gap - ra - rb > pick.margin)) pick = { pa, oa, ra, pb, ob, rb, gap, margin: gap - ra - rb }
      }
      if (pick) lines.push(`<li><b>${esc(pick.pa.url ?? pick.pa.peers?.[0])}</b> (${esc(pick.pa.ip)}${pick.pa.holder ? ', ' + esc(pick.pa.holder) : ''}) is within ${fmt(pick.ra)} km of ${esc(pick.oa.vantage.label)}; <b>${esc(pick.pb.url ?? pick.pb.peers?.[0])}</b> (${esc(pick.pb.ip)}${pick.pb.holder ? ', ' + esc(pick.pb.holder) : ''}) is within ${fmt(pick.rb)} km of ${esc(pick.ob.vantage.label)}; those vantages are ${fmt(pick.gap)} km apart, so the two disks cannot overlap (margin ${fmt(pick.margin)} km).</li>`)
    }
    return `<p>Why these count as apart:</p><ul>${lines.join('')}</ul>`
  })() : ''
  $('rows').innerHTML = merged.providers
    .toSorted((a, b) => rank(a) - rank(b))
    .map((p) => row(p, p.obs).replace('<tr>', `<tr${boxes.find((c) => c.providers.includes(p) && sepIds.has(c.key)) ? ' style="outline:1px solid var(--ok)"' : ''}>`)).join('')
  $('vantages').innerHTML = merged.vantages.map((v) => `<li>${esc(v.label)} ${v.lat != null ? `(${fmt(v.lat * 10) / 10}, ${fmt(v.lon * 10) / 10})` : '(no location)'} <small>${esc(v.ts)} · self-reported</small></li>`).join('')
  const bad = []
  for (const p of merged.providers) {
    const obs = p.obs.filter((o) => o.status === 'local' && o.vantage?.lat != null)
    for (const [i, j] of inconsistencies(disksOf(obs))) bad.push(`${esc(obs[i].vantage.label)} and ${esc(obs[j].vantage.label)} give disjoint disks for ${esc(p.url ?? p.peers[0])}: a vantage is mislocated or lying, or this IP is anycast served from several sites`)
  }
  $('incons').innerHTML = bad.join('<br>')
  shareUrl(location.href, reports).then((u) => { $('share').value = u; history.replaceState(null, '', u) })
  $('results').hidden = false
}
const rank = (p) => ({ local: 0, 'on-demand': 1, invalid: 2, unreachable: 3, untested: 4 }[p.obs[0]?.status] ?? 5)

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
        if (e.type === 'dag') $('status').textContent = e.blocks ? `${e.blocks} block${e.blocks === 1 ? '' : 's'} sampled from ${e.from}. Challenging providers...${e.blocks < 3 ? ' This DAG has fewer than 3 blocks, so each provider gets one challenge pair and timing is marked weak.' : ''}` : 'no endpoint served the DAG'
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
    const incoming = (t.startsWith('[') || t.startsWith('{') ? [JSON.parse(t)].flat().map(sanitize) : await reportsFromUrl(t))
    if (!incoming.length) throw new Error('no reports found')
    const candidate = [...reports, ...incoming]
    analyze(candidate) // throws on mixed CIDs; only commit state if it merges
    reports = candidate
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
