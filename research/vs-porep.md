# What PoRep, PDP, and timed retrieval each prove

Every protocol claim below cites a row in [sources-porep.md](sources-porep.md) (P), [sources-pdp.md](sources-pdp.md) (D), or [sources-ipfs-geo.md](sources-ipfs-geo.md) (G). Rows marked INFERRED are our reasoning from cited facts, not a quoted source. "Timed retrieval" is the method in this repo: IPNI/delegated-routing discovery, random-block challenges over the trustless gateway (or Bitswap), hash verification, baseline-vs-probe latency, and multi-vantage RTT disks.

## 1. What each proof actually establishes

| property | PoRep + WindowPoSt | PDP (FWSS) | timed retrieval (this repo) |
|---|---|---|---|
| Prover holds the bytes at proof time | Yes, the sealed replica: "can only be correctly answered if the miner is actually storing a copy of the sealed data" (P §7) | Yes, or has access to them: 5 x 32 B leaves + Merkle paths per proof (D §1, §3) | Yes: random blocks are fetched and hashed against the CID (G 3a; engine `verify`) |
| Copy is a distinct physical encoding | Yes: ReplicaID binds prover_id + sector_id + ticket (P §1, §9), and SDR makes regeneration slow (P §2) | No: pieces are committed by standard CommPv2 of the raw data, no provider-specific encoding (D §4) | No: raw blocks are identical everywhere by construction. Distinctness comes from *where* and *how fast* they are served, not from encoding |
| Proof is bound to the prover identity | Yes: prover_id is a ReplicaID input (P §1) | No: challenge = keccak(seed, setId, i); whoever holds the bytes or the tree can compute it for any data set (D §3) | Partly: the responder is bound by its network endpoint (IP, peer ID, TLS host), which is what gets clustered (engine `cluster`) |
| n identities must store n copies | Yes, by design: "forces any number of Sybil identities ... to prove each of those n replicas" (P §9) | No: PDPVerifier does not check whether a piece exists in another data set; one physical copy can prove for many data sets (D §4, §3). synapse only enforces distinct provider IDs (D §5) | Partly: n endpoints that each pass a local-copy check from one vantage could still be one box with many IPs (threat-model.md, "Sybil peer IDs") |
| Copies are in independent locations | No: "physically independent" means separate bytes, and the 2017 report names datacenter collocation as a valid setting (P §9). Nothing in ReplicaID encodes location (P §1) | No: 30-min response window fits any internet RTT, so timing gives no geographic signal (D §3) | Yes, with >=2 vantages: each vantage gives an RTT disk of radius ~100 km/ms (G 10b); disjoint disks for two responders prove they are apart (G 9d; threat-model.md) |
| Data is retrievable | No on-chain retrieval proof; retrieval is off-chain (P §7). The unsealed copy that serves retrievals is not covered by any proof (P §3, inference) | No: payment depends only on proofs (D §6). Dealbot checks retrievability from one location (D §6) | Yes, that is the measurement: a block served and verified from the vantage |
| Served from local storage, not fetched on demand | Yes for the sealed replica: re-seal (~3 h) is far slower than the 40-min PoSt bound (P §2, §4). Not applicable to the unsealed copy | No: an SP needs ~160 B to ~20 MiB (or a ~5 KB finished proof) from a copy holder within 30 min (D §3) | Yes, within limits: probe latency minus bafkqaaa baseline exposes an upstream fetch (G 3c; threat-model.md "on-demand proxying" states the floor) |
| Needs the prover to cooperate / run special code | Yes: sealing hardware, PoSt pipeline (P §2) | Yes: Curio proving tasks (D §1) | No: only the IPFS primitives the SP already exposes (G 1a, 2a, 3a). This is the difference from GoAT, where the prover pings anchors (G 9b) |
| Penalty for failing | Fault fee, termination after 42 days (P §8) | Faulted period pays zero, no slashing (D §8) | None. This is a measurement, not an enforcement mechanism |
| Time bound on cheating | Re-seal ~3 h vs 40 min (P §2 note under §4) | None in practice: 30 min window (D §3) | ms-scale: light in fiber ~204 km/ms one way (G 10a); excess latency of one extra network hop |

## 2. Where timed retrieval is weaker

| limit | detail | source |
|---|---|---|
| Proves responder location, not data location | A geolocated server may be a proxy relaying to the real holder. The latency check narrows this to "the extra hop costs less than the threshold" | G 7 (Gondree & Peterson name the relay attack); threat-model.md |
| Only economically rational adversaries | RAFT and LoSt both say fully malicious storage cannot be handled by timing | G 8, 9a |
| Point-in-time | Each probe is one moment. PoSt and PDP run every 24 h with on-chain records (P §4, D §2). Continuous coverage needs repeated runs | INFERRED |
| Samples a few blocks | Like PDP's 5 challenges (D §1): a provider missing 1% of blocks passes 95% of 5-block probes. Detection probability compounds over repeated runs (D §8 gives the PDP math: 1% loss -> 77.9% in 30 days at 5/day) | D §8 |
| One vantage gives only an upper bound | d_max = 100 km per ms RTT. Two providers 1 ms apart in RTT from one vantage could be in the same rack or 100 km apart | G 10b, 9d |
| Distance precision | Benson et al. report 900-1200 km error with cooperative datacenter-adjacent landmarks; Gondree & Peterson got <=12,000 km² on S3. Browser vantages are worse, not better | G 6, 7 |
| Dark fiber / private backhaul | Breaks the "no exclusive link" assumption that every latency-geolocation paper makes | G 6, 7; threat-model.md |

## 3. Use cases

| use case | what is needed | PoRep/PoSt gives | PDP gives | timed retrieval gives |
|---|---|---|---|---|
| **PDP marketing**: "your data is stored on N providers" | Evidence that N is N operators, not N provider IDs on one box | n/a (PDP data is not sealed) | N distinct provider IDs (D §5). Nothing about operators or sites (D §4, "approved/endorsed sets do not attest independence" is UNVERIFIED either way) | N endpoints that each served valid blocks from local storage, clustered by IP/ASN, and with two vantages, how many are provably apart. A number the sales page can cite with its method attached |
| **IPFS archive reliability**: will this CID survive a provider outage? | Count of independent failure domains that hold a verified copy | n/a for plain IPFS content | n/a | Resilience score = largest set of pairwise proven-separate operator clusters, not the raw IPNI provider count (which double-counts: one Peer ID per ContextID, G 2b) |
| **MSP placement checks**: did the secondary copy land somewhere else? | synapse uploads to 2 providers by default, secondaries pull from the primary (D §5). Curio has an SP-to-SP pull endpoint (D §7) | n/a | Distinct provider IDs only (D §5) | RTT disks from two vantages for each provider endpoint; disjoint disks prove separate sites. Same IP or ASN for both flags a same-operator placement |
| **Dealbot-style integrity + retrievability** | Per-block hash verification, TTFB, from a known probe location | n/a | Dealbot already does IPNI lookup + `/ipfs` fetch + hash (D §6), from one location (`probe_location` unknown until dealbot#246, D §6) | The same check from any browser, so probe_location is the user's own, and the baseline-vs-probe excess adds a local-vs-on-demand signal dealbot does not record |

## 4. One-line summary

PoRep proves n distinct encodings exist. PDP proves someone can answer 5 Merkle challenges within 30 minutes. Neither proves retrievability, locality, or geographic independence. Timed retrieval from >=2 vantages proves that verified copies were served from local storage at responders that are provably apart, and needs nothing from the provider beyond the gateway it already runs.
