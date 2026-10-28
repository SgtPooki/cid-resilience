import { run, analyze, newVantage, withinKm, radiusKm, haversineKm, disksOf, inconsistencies, shareUrl, reportsFromUrl, sanitize, grade, cidDigest } from './engine/index.js'

const $ = (id) => document.getElementById(id)
let reports = [], providers = new Map(), running = false
const fmt = (n) => (n == null || !isFinite(n) ? '' : Math.round(n))
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// Location and label edits after a run update this browser's own vantage, so a late geolocation grant still lands in the report.
function syncVantage() {
  const mine = reports.find((r) => r.vantage.id === current?.id)
  if (!mine) return
  let inputs
  try { inputs = readInputs() } catch (e) { $('status').textContent = e.message; return }
  mine.vantage.lat = inputs.loc?.lat ?? null
  mine.vantage.lon = inputs.loc?.lon ?? null
  mine.vantage.label = $('label').value.trim() || 'me'
  $('status').textContent = inputs.loc ? 'Location updated.' : 'Location cleared.'
  renderMerged(); saveState()
}
for (const id of ['lat', 'lon', 'label']) $(id).onchange = syncVantage
$('geo').onclick = () => navigator.geolocation.getCurrentPosition(
  (p) => { $('lat').value = p.coords.latitude.toFixed(1); $('lon').value = p.coords.longitude.toFixed(1); syncVantage() },
  (e) => { $('status').textContent = `Location not available (${e.message}). You can type latitude and longitude by hand instead.` }, { timeout: 10000 })

let total = 0, t0 = 0, ticker = null
function renderLive() {
  $('results').hidden = false
  const list = [...providers.values()]
  const rounds = Number($('rounds').value) || 5
  const done = list.filter((p) => !['advertised', 'testing'].includes(p.status)).length
  const pairs = list.reduce((n, p) => n + (p.progress ? p.progress[0] : ['advertised', 'testing'].includes(p.status) ? 0 : rounds), 0)
  $('prog').hidden = false; $('prog').max = Math.max(total * rounds, 1); $('prog').value = pairs
  const local = list.filter((p) => p.status === 'local').length
  const secs = Math.round((performance.now() - t0) / 1000)
  $('grade').textContent = `Measuring, ${secs} s: ${pairs} of ${total * rounds} test fetches done, ${done} of ${total} providers finished, ${local} local cop${local === 1 ? 'y' : 'ies'} so far`
  $('grade').className = 'grade'
  $('final').hidden = false; $('cards').hidden = true; $('near').hidden = true; $('sepnote').hidden = true; $('cert').hidden = true; $('final2').hidden = true
  $('rows').innerHTML = list.map((p) => row(p, [{ vantage: current, status: p.status, baseline: p.baseline, excess: p.excess, verified: p.verified, rounds: p.rounds, error: p.error, weak: p.weak }])).join('')
}

const STATUS = new Set(['advertised', 'untested', 'testing', 'local', 'on-demand', 'invalid', 'unreachable'])
const st = (s) => (STATUS.has(s) ? s : 'advertised')
const safeHttp = (u) => (typeof u === 'string' && /^https?:\/\/[\w.-]+(:\d+)?$/.test(u) ? u : null)
const BEST = ['local', 'on-demand', 'invalid', 'unreachable', 'testing', 'untested', 'advertised']
function row(p, obs) {
  const ob = obs.toSorted((a, b) => BEST.indexOf(st(a.status)) - BEST.indexOf(st(b.status)))[0] // best observation across vantages; per-vantage detail is in the last column
  const url = safeHttp(p.url)
  const where = url ? `<a href="${esc(url)}/ipfs/bafkqaaa" class="mono">${esc(url)}</a>` : `<span class="mono">${esc(p.peers?.[0])}</span> <span class="tag">bitswap</span>`
  const op = [esc(p.ip), p.holder ? esc(`AS${p.asn} ${p.holder}`) : p.asn ? esc(`AS${p.asn}`) : ''].filter(Boolean).join('<br>') + (p.cdn ? ' <span class="tag">cdn</span>' : '') + (obs.some((o) => o.warmed) ? ' <span class="tag" title="served the sample CAR before being tested, so its cache may have been warm">warmed</span>' : '')
  const km = obs.filter((o) => o.status === 'local' && o.vantage?.lat != null).map((o) => `${fmt(radiusKm(o.baseline))}`).join(' / ')
  const seen = obs.map((o) => `<span class="${st(o.status)}">${esc(o.vantage?.label ?? '?')}: ${st(o.status)}${o.weak ? ' (weak timing)' : ''}${o.error ? ` (${esc(o.error)})` : ''}</span>`).join('<br>')
  const cell = ob.status === 'testing' ? `testing${p.progress ? ` ${p.progress[0]}/${p.progress[1]}` : ''}` : st(ob.status)
  return `<tr><td class="${st(ob.status)}">${cell}</td><td>${where}<br><small>${p.peerCount ?? (p.peers ?? []).length} peer id${(p.peerCount ?? p.peers?.length) === 1 ? '' : 's'}</small></td><td>${op}</td><td class="n">${fmt(ob.baseline)}</td><td class="n">${fmt(ob.excess)}</td><td class="n">${ob.verified != null ? `${fmt(ob.verified)}/${fmt(ob.rounds)}` : ''}</td><td class="n">${km}</td><td>${seen}</td></tr>`
}

function renderMerged() {
  const { merged, score, boxes } = analyze(reports)
  const s = score
  $('prog').hidden = true
  for (const id of ['final', 'cards', 'near', 'sepnote', 'cert', 'final2']) $(id).hidden = false
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
    : `From one place every distance bound includes you, so nothing can be proven apart yet. Next step: copy the share link below, open it from another city (a friend, a phone on mobile data elsewhere, a server), and press Measure there. Until then, counting distinct networks (ASNs, an inferred operator heuristic) instead of copies gives ${s.operators}.`) + when
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
  $('copy').disabled = $('download').disabled = !reports.length
  if (!reports.length) $('sharemsg').textContent = 'Nothing to share yet: press Measure first.'
  $('results').hidden = false
}
const rank = (p) => ({ local: 0, 'on-demand': 1, invalid: 2, unreachable: 3, untested: 4 }[p.obs[0]?.status] ?? 5)

let current
// Validate everything locally before any network request.
function readInputs() {
  const cid = $('cid').value.trim()
  if (!cid) throw new Error('Paste a CID first. It starts with bafy, bafk or Qm.')
  try { cidDigest(cid) } catch { throw new Error('That is not a valid CID: check for a copy error or a missing character. Expected something like bafybei... or Qm...') }
  const num = (id, lo, hi, what) => { const v = $(id).value.trim(); if (v === '') return null; const n = Number(v); if (!isFinite(n) || n < lo || n > hi) throw new Error(`${what} must be a number between ${lo} and ${hi}.`); return n }
  const lat = num('lat', -90, 90, 'latitude'), lon = num('lon', -180, 180, 'longitude')
  if ((lat == null) !== (lon == null)) throw new Error('Enter both latitude and longitude, or neither.')
  const rounds = num('rounds', 1, 20, 'pieces per provider') ?? 5
  const maxExcessMs = num('excess', 1, 10000, 'ms over baseline') ?? 30
  $('rounds').value = rounds; $('excess').value = maxExcessMs
  return { cid, loc: lat == null ? null : { lat, lon }, rounds, maxExcessMs }
}
const saveState = () => { try { localStorage.setItem('cid-resilience', JSON.stringify({ reports, label: $('label').value, lat: $('lat').value, lon: $('lon').value })) } catch {} }

$('run').onclick = async () => {
  if (running) return
  let inputs
  try { inputs = readInputs() } catch (e) { $('status').textContent = e.message; return }
  running = true; $('run').disabled = true; $('run').textContent = 'Measuring...'
  t0 = performance.now(); clearInterval(ticker); ticker = setInterval(() => { if (running) renderLive() }, 1000)
  const { cid, loc } = inputs
  current = newVantage($('label').value.trim() || 'me', loc)
  try { current.id = localStorage.getItem('cid-resilience-vantage') ?? (localStorage.setItem('cid-resilience-vantage', current.id), current.id) } catch {}
  providers = new Map(); total = 0
  $('status').textContent = 'Asking the public index who holds this CID...'
  $('status').scrollIntoView({ block: 'start', behavior: 'smooth' })
  try {
    const bitswapProbe = $('bitswap').checked ? (await import('./engine/bitswap.js')).bitswapProbe : null
    const report = await run(cid, {
      vantage: current, rounds: inputs.rounds, maxExcessMs: inputs.maxExcessMs, bitswapProbe,
      onEvent: (e) => {
        if (e.type === 'discovered') { total = e.endpoints + e.bitswapPeers; $('status').textContent = `${e.peers} providers claim to hold it (${e.endpoints} over HTTP, ${e.bitswapPeers} over bitswap only)${Object.keys(e.errors).length ? `; one index did not answer (${Object.keys(e.errors).join(', ')})` : ''}. Downloading a sample of the content...` }
        if (e.type === 'dag') $('status').textContent = e.blocks ? `Got ${e.blocks} piece${e.blocks === 1 ? '' : 's'} of the content from ${e.from}. Now fetching random pieces from every provider and timing the answers; this takes a minute or two.${e.blocks < 3 ? ` The sample contains only ${e.blocks} block${e.blocks === 1 ? '' : 's'}, so each provider gets at most ${e.blocks} test${e.blocks === 1 ? '' : 's'} and timing is marked weak.` : ''}` : 'No provider served the content, so nothing can be tested.'
        if (e.type === 'provider') { providers.set(e.provider.url ?? e.provider.peers[0], e.provider); if (running) renderLive() }
        if (e.type === 'annotated' && reports.includes(e.report)) { renderMerged(); saveState() }
      },
    })
    reports = reports.filter((r) => r.cid === cid && r.vantage.id !== current.id).concat(report)
    $('status').textContent = 'Done.'
    renderMerged(); saveState()
  } catch (err) {
    $('status').textContent = `error: ${err.message}`
  }
  running = false; $('run').disabled = false; $('run').textContent = 'Measure'; clearInterval(ticker)
}

$('copy').onclick = async () => {
  try { await navigator.clipboard.writeText($('share').value); $('sharemsg').textContent = 'Link copied.' }
  catch { $('share').select(); $('sharemsg').textContent = 'Could not copy automatically: the link is selected, press Ctrl/Cmd+C.' }
}
$('download').onclick = () => {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([JSON.stringify(reports, null, 1)], { type: 'application/json' }))
  a.download = `cid-resilience-${reports[0]?.cid ?? 'report'}.json`; a.click()
  $('sharemsg').textContent = `Saved ${a.download}.`
}
$('mergebtn').onclick = async () => {
  const t = $('paste').value.trim()
  if (!t) { $('status').textContent = 'Paste a share link or the contents of a downloaded JSON file into the box first.'; return }
  try {
    const incoming = (t.startsWith('[') || t.startsWith('{') ? [JSON.parse(t)].flat().map(sanitize) : await reportsFromUrl(t))
    if (!incoming.length) throw new Error('no reports found')
    const have = reports[0]?.cid ?? $('cid').value.trim()
    if (have && incoming.some((r) => r.cid !== have)) throw new Error(`that report is for a different CID (${incoming.find((r) => r.cid !== have).cid.slice(0, 16)}...) than the one on this page`)
    const candidate = [...reports, ...incoming]
    analyze(candidate) // throws on mixed CIDs; only commit state if it merges
    reports = candidate
    if (!$('cid').value) $('cid').value = incoming[0].cid
    renderMerged(); saveState(); $('paste').value = ''
    $('status').textContent = `Merged ${incoming.length} report${incoming.length === 1 ? '' : 's'}; ${reports.length} in total.`
  } catch (e) { $('status').textContent = `Could not merge: ${e.message}. Paste a share link from this site or the contents of a JSON it downloaded.` }
}

// ?cid=... prefills; &auto runs immediately. A #r= fragment loads shared reports.
const params = new URLSearchParams(location.search)
if (params.get('cid')) $('cid').value = params.get('cid')
if (params.get('label')) $('label').value = params.get('label')
if (params.get('lat')) { $('lat').value = params.get('lat'); $('lon').value = params.get('lon') }
$('copy').disabled = $('download').disabled = true; $('sharemsg').textContent = 'Nothing to share yet: press Measure first.'
$('forget').onclick = () => { try { localStorage.removeItem('cid-resilience') } catch {} reports = []; history.replaceState(null, '', location.pathname); $('results').hidden = true; $('status').textContent = 'Forgot the saved results and location.' }
window.addEventListener('beforeunload', (e) => { if (running) { e.preventDefault(); e.returnValue = '' } })
reportsFromUrl(location.href).then((rs) => {
  if (params.has('auto')) $('run').click()
  if (rs.length) {
    reports = rs; $('cid').value = rs[0].cid
    $('status').textContent = `Loaded ${rs.length} report${rs.length === 1 ? '' : 's'} from the link. Press Measure to add this location.`
    renderMerged(); return
  }
  if (location.hash.startsWith('#r=')) { $('status').textContent = 'This share link is incomplete or damaged. Ask for it again, or paste the downloaded JSON instead.'; return }
  // Nothing in the URL: restore the last session from this browser.
  try {
    const saved = JSON.parse(localStorage.getItem('cid-resilience') ?? 'null')
    if (saved?.reports?.length) {
      reports = saved.reports.map(sanitize); $('cid').value ||= reports[0].cid
      $('label').value ||= saved.label ?? ''; $('lat').value ||= saved.lat ?? ''; $('lon').value ||= saved.lon ?? ''
      $('status').textContent = 'Restored your last results from this browser. Press Measure to run again.'
      renderMerged()
    }
  } catch {}
}).catch(() => { $('status').textContent = 'This share link is incomplete or damaged. Ask for it again, or paste the downloaded JSON instead.' })
