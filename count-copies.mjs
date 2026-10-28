#!/usr/bin/env node
// CLI over the shared engine. Usage: node count-copies.mjs <cid> [--lat N --lon N --label X] [--merge report.json ...] [--out report.json]
import { readFile, writeFile } from 'node:fs/promises'
import { run, analyze, newVantage, withinKm } from './engine/index.js'

const args = process.argv.slice(2)
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined }
const cid = args.find((a) => !a.startsWith('--') && !args[args.indexOf(a) - 1]?.startsWith('--')) ?? 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
const merges = args.flatMap((a, i) => (a === '--merge' ? [args[i + 1]] : []))
const loc = opt('--lat') ? { lat: Number(opt('--lat')), lon: Number(opt('--lon')) } : null
const vantage = newVantage(opt('--label') ?? 'cli', loc)
const f = (n) => (n == null ? '    -' : n.toFixed(0).padStart(5))

const report = await run(cid, {
  vantage, rounds: Number(process.env.ROUNDS ?? 5), maxExcessMs: Number(process.env.MAX_EXCESS_MS ?? 30),
  onEvent: (e) => {
    if (e.type === 'discovered') console.log(`${cid}\nrecords: ipni=${e.counts.ipni} delegated=${e.counts.delegated} -> ${e.peers} peers, ${e.endpoints} http endpoints, ${e.bitswapPeers} bitswap-only${Object.keys(e.errors).length ? ' errors=' + JSON.stringify(e.errors) : ''}`)
    if (e.type === 'dag') console.log(`dag: ${e.blocks} blocks${e.from ? ` (from ${e.from})` : ''}\n`)
  },
})
const bsOnly = report.providers.filter((p) => !p.url)
if (bsOnly.length) console.log(`${bsOnly.length} bitswap-only peers skipped (browser-dialable; probed only in the web app)`)
for (const p of report.providers.filter((p) => p.url).toSorted((a, b) => String(a.ip).localeCompare(String(b.ip)))) {
  console.log(`${p.status.padEnd(12)} ${String(p.ip ?? '?').padEnd(16)} AS${String(p.asn ?? '?').padEnd(7)} base=${f(p.baseline)}ms probe=${f(p.probe)}ms excess=${f(p.excess)}ms sha=${p.verified ?? '-'}/${p.rounds ?? '-'} ${p.url ?? p.peers[0]}${p.cdn ? ' [cdn]' : ''}${p.error ? ' (' + p.error + ')' : ''}`)
}
const others = await Promise.all(merges.map((m) => readFile(m, 'utf8').then(JSON.parse)))
const { score, merged } = analyze([report, ...others.flat()])
console.log(`\n${JSON.stringify(score)}`)
if (loc) console.log(`local copies within 500 km of this vantage: ${withinKm(merged.providers, vantage.id, 500)}`)
if (opt('--out')) await writeFile(opt('--out'), JSON.stringify(report, null, 1))
