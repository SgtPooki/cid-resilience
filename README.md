# cid-resilience

Paste a CID, learn how many independent copies of it really exist and how spread out they are.

Research + tooling for proving unique, geographically distinct copies of IPFS / PDP data using only IPFS primitives (IPNI, delegated routing, trustless gateways, Bitswap) and timed challenges. No provider cooperation, no sealing.

Status: early research. Every protocol claim lives in `research/sources-*.md` with a pinned source and a quote.

## Try the prototype

```sh
node count-copies.mjs [cid]   # Node >= 22, no deps. ROUNDS=5 MAX_EXCESS_MS=30
```

Finds providers, challenges each with random blocks, verifies hashes, and flags providers whose block latency exceeds their baseline RTT (fetching on demand). Counts passing copies per distinct IP. Single vantage, so it cannot yet prove geographic separation.

## Research

- [PoRep / PoSt facts](research/sources-porep.md)
- [PDP / FWSS / dealbot / Curio facts](research/sources-pdp.md)
- [IPFS specs + latency geolocation literature](research/sources-ipfs-geo.md)
