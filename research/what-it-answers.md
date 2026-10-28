# What this measurement answers, and what it does not

A plain-language companion to [vs-porep.md](vs-porep.md) and [threat-model.md](threat-model.md). Citations P, D, G refer to rows in `sources-porep.md`, `sources-pdp.md` and `sources-ipfs-geo.md`; everything else is implementation-derived or INFERRED from the measurements linked in the README.

## The question

Content-addressed storage tells you who *claims* to hold a CID. An IPNI record is self-published (G 2a, 2b), a gateway answer says nothing about where the bytes came from, and on-chain proofs cover a sealed replica (P §7) or a Merkle sample answered within 30 minutes (D §3). None of them says how many independent places the bytes are in today, or whether a given "copy" is a cache that will be gone next week.

This tool asks that question from the only place that needs no cooperation: a client fetching the content.

## What it establishes

| statement | strength | basis |
|---|---|---|
| Provider X served bytes that hash to the CID's blocks | verified for the sampled blocks | hash check on every challenge (G 3a) |
| Provider X answered a random block about as fast as it answers a no-op request | measured; classed `local` below a threshold | bafkqaaa baseline (G 3c), interleaved pairs, median excess |
| Provider X is within R km of the measuring browser | upper bound, assuming nothing faster than light in fibre | G 10a, 10b |
| Providers X and Y respond from different places | proven, given two honest vantages whose bounds for X and Y do not overlap | G 9d; threat-model.md |
| The advertised count overstates real copies | observed on every CID measured so far | README example |

## What it does not establish

- **That the bytes live where the responder is.** A relay whose upstream answers within the threshold (about 3,000 km at 30 ms) passes. A relay that flushes headers before fetching, or that slows its own baseline, passes. This is the relay problem named by Gondree & Peterson (G 7), narrowed but not removed.
- **Anything about tomorrow.** One run is one moment. A warm cache and a durable copy look identical at that moment.
- **Whole-file integrity.** Only the first 64 blocks of a DAG are sampled; the tail is never read.
- **Who owns what.** Same IP is treated as one box and same ASN as one operator. Both are heuristics; one ASN hosts many tenants and one IP can front many machines.
- **Separation from one vantage.** Every single-vantage bound contains the measurer, so two providers can never be shown apart until a second located vantage is merged. First-time users always land on "unproven".
- **Honest vantages.** Locations are self-reported and reports are unsigned. Merging a stranger's report is trusting them.

## Where it is useful

- **Checking that "N copies" means N places.** Protocol-level copy counts are counts of identities (P §9, D §5). Two browsers in two cities can show whether the responders behind those identities are apart.
- **Spot-checking a mirror or pin.** Any gateway that advertises to IPNI can be checked without deploying anything on it. The result is sampled retrieval evidence plus a distance bound, which is more than a 200 status and less than a proof.
- **Explaining the gap between advertised and real.** The per-provider table (advertised, untested, unreachable, invalid, on-demand, local) is the artefact people can argue about, with the bytes and timings behind each row.

## Where it is not enough on its own

- Any claim that needs continuous coverage. That requires repeated measurement and a record of change, which this tool does not keep beyond one browser's last run.
- Any claim about the full content rather than a sample.
- Any setting with a fully adversarial provider that controls the network path. Latency-based location breaks there by construction (G 8, G 9a).

## How to read a result

A headline of "N responders proven geographically apart" means: for each pair, there is a vantage A and a vantage B such that the bound for one responder from A and the bound for the other from B cannot overlap, under the fibre-or-slower assumption and trusting both vantages' coordinates. It does not say the two responders are owned by different people, run different software, or will both answer tomorrow. "Local copy" means "not measurably slower than its own no-op", and the page says so.
