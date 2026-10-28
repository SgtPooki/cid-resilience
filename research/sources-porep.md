# PoRep / PoSt facts: primary sources

Checked 2026-10-28. Repos pinned at:

- builtin-actors `a90a438e` (`BA`)
- rust-fil-proofs `d451d23b` (`RFP`)
- rust-filecoin-proofs-api `8708f265` (`API`)
- filecoin-ffi `32084c18` (`FFI`)
- specs `a9500283` (`SPEC`, source of spec.filecoin.io)
- filecoin-docs `d1ad5f45` (`DOCS`, secondary)
- lotus-docs `abf5c713`, curio `f9ebe19a` (secondary)

Papers (no commit to pin, so a sha256 is given for each PDF):

- PoRep tech report, Benet/Dalrymple/Greco 2017: https://research.protocol.ai/publications/proof-of-replication/benet2017.pdf (sha256 `d3603407...f72d`)
- Filecoin paper 2017: https://research.protocol.ai/publications/filecoin-a-decentralized-storage-network/protocollabs2017a.pdf (sha256 `b451b698...ef14`)

## 1. Replica ID composition

| claim | verdict | value | permalink | quote |
|---|---|---|---|---|
| ReplicaID = SHA256(prover_id, sector_id, ticket, CommD, porep_seed) | VERIFIED | 5 inputs, SHA-256, truncated to a field element | [RFP params.rs#L1265-L1281](https://github.com/filecoin-project/rust-fil-proofs/blob/d451d23ba6dcabd107e66b2f9c6531887b17fd3d/storage-proofs-porep/src/stacked/vanilla/params.rs#L1265-L1281) | `.chain_update(prover_id) .chain_update(sector_id.to_be_bytes()) .chain_update(ticket) .chain_update(&comm_d) .chain_update(porep_seed)` |
| porep_seed is `porep_config.porep_id` | VERIFIED | | [RFP seal.rs#L185-L191](https://github.com/filecoin-project/rust-fil-proofs/blob/d451d23ba6dcabd107e66b2f9c6531887b17fd3d/filecoin-proofs/src/api/seal.rs#L185-L191) | `generate_replica_id::<Tree::Hasher, _>(&prover_id, sector_id.into(), &ticket, comm_d, &porep_config.porep_id,)` |
| porep_id = registered proof type ID + version nonce | VERIFIED | bytes 0..8 proof ID LE, 8..16 nonce LE, rest zero | [API registry.rs#L292-L301](https://github.com/filecoin-project/rust-filecoin-proofs-api/blob/8708f2653e4babfba5d7dccb61edb4f064d850c2/src/registry.rs#L292-L301) | `porep_id[0..8].copy_from_slice(&registered_proof_id.to_le_bytes()); porep_id[8..16].copy_from_slice(&nonce.to_le_bytes());` |
| prover_id = miner actor ID | VERIFIED | ID-address payload of the miner actor | [FFI proofs.go#L918-L925](https://github.com/filecoin-project/filecoin-ffi/blob/32084c18efba86bd6fa7f7f6729db88499d14b35/proofs.go#L918-L925) | `func toProverID(minerID abi.ActorID) ... maddr, err := address.NewIDAddress(uint64(minerID))` |
| ticket = chain randomness, there to tie the seal to a chain | VERIFIED | | [SPEC sealing.md#L41](https://github.com/filecoin-project/specs/blob/a95002835b34d4042c007feda3fecf5e68e79dfa/content/systems/filecoin_mining/sector/sealing.md#L41) | "Tickets are used as input to calculation of the ReplicaID in order to tie Proofs-of-Replication to a given chain, thereby preventing long-range attacks" |
| Nothing in it encodes physical location | VERIFIED (by inspection) | none of the 5 inputs is location, hardware, or network | same as row 1 | (the full input list is quoted above) |

## 2. Sealing algorithm, time, cost, security argument

| claim | verdict | value | permalink | quote |
|---|---|---|---|---|
| Algorithm is SDR (Stacked DRG) | VERIFIED | SDR. The planned NSE upgrade never shipped; every mainnet seal proof is `StackedDRG*` (see 6) | [SPEC sealing.md#L19](https://github.com/filecoin-project/specs/blob/a95002835b34d4042c007feda3fecf5e68e79dfa/content/systems/filecoin_mining/sector/sealing.md#L19) | "The Filecoin Protocol will launch with Stacked Depth Robust (SDR) PoRep" |
| SDR is sequential and regeneration-resistant | VERIFIED | | [SPEC sdr/_index.md#L543](https://github.com/filecoin-project/specs/blob/a95002835b34d4042c007feda3fecf5e68e79dfa/content/algorithms/sdr/_index.md#L543) | "build a sequential and regeneration resistant encoding scheme" |
| Sealing a 32 GiB sector takes about 3 h | VERIFIED (docs, secondary) | ~3 h total, with PC1 the bulk. The docs disagree with each other: one page says 1.5 h | [DOCS sealing-pipeline.md#L43](https://github.com/filecoin-project/filecoin-docs/blob/d1ad5f455b4cda7be638b241593dc756140406b2/storage-providers/architecture/sealing-pipeline.md#L43); [DOCS network-performance.md#L24](https://github.com/filecoin-project/filecoin-docs/blob/d1ad5f455b4cda7be638b241593dc756140406b2/networks-and-tools/networks/mainnet/network-performance.md#L24) | "sealing a single 32 GiB sector takes roughly **3 hours**"; "roughly 1.5 hours for a 32 GB sector" |
| PC1 3.5-5 h on Curio SupraSeal batch | VERIFIED (docs) | | [curio supraseal.md#L278](https://github.com/filecoin-project/curio/blob/f9ebe19a440f33de6285a9f884f9f9633f56be5e/documentation/en/supraseal.md#L278) | "PC1 will take 3.5-5 hours, followed by PC2 on GPU" |
| PC2 10-20 min on GPU | VERIFIED (docs) | | [DOCS sealing-pipeline.md#L49](https://github.com/filecoin-project/filecoin-docs/blob/d1ad5f455b4cda7be638b241593dc756140406b2/storage-providers/architecture/sealing-pipeline.md#L49) | "typically 10 to 20 minutes on a capable GPU" |
| Sealing hardware | VERIFIED (docs) | 256 GiB RAM, SHA-ext CPU, 11 GB GPU, 2 TB NVMe (lotus). The newer docs say 512 GiB-1 TiB RAM | [lotus-docs hardware-requirements.md#L22-L28](https://github.com/filecoin-project/lotus-docs/blob/abf5c713b745c222f99362b68fabefeb35a2e2dc/content/en/storage-providers/get-started/hardware-requirements.md#L22-L28); [DOCS agent-quickstart.md#L39](https://github.com/filecoin-project/filecoin-docs/blob/d1ad5f455b4cda7be638b241593dc756140406b2/storage-providers/agent-quickstart.md#L39) | "RAM \| 256 GiB RAM + Swap"; "512 GiB–1 TiB RAM on sealing nodes, 10 GB+ GPUs" |
| Sealing hardware cost in $ | UNVERIFIED | no primary source found | - | - |
| Protocol window for ProveCommit after PreCommit | VERIFIED | 30 days + 150 epochs (V1_1 proofs) | [BA miner/policy.rs#L63-L82](https://github.com/filecoin-project/builtin-actors/blob/a90a438e3e9b93247347befb182456818777098a/actors/miner/src/policy.rs#L63-L82); [BA runtime policy.rs#L288](https://github.com/filecoin-project/builtin-actors/blob/a90a438e3e9b93247347befb182456818777098a/runtime/src/runtime/policy.rs#L288) | `Some(30 * EPOCHS_IN_DAY + policy.pre_commit_challenge_delay)`; `PRE_COMMIT_CHALLENGE_DELAY: ChainEpoch = 150` |
| Security argument: re-sealing must be slower than the PoSt response deadline | VERIFIED | WinningPoSt has to be answered within the epoch (30 s), and the spec says that makes on-demand sealing impossible. For WindowPoSt the argument is economic ("irrational"), not a strict time bound | [SPEC post.md#L16-L17](https://github.com/filecoin-project/specs/blob/a95002835b34d4042c007feda3fecf5e68e79dfa/content/algorithms/pos/post.md#L16-L17) | "has to be submitted within a short deadline, making it impossible for the miner to seal and find the answer to the challenge on demand"; "makes it irrational for a miner to _not_ keep a sealed copy" |
| The original PoRep construction is a time/RTT bound | VERIFIED | The 2017 report's "time-bounded PoRep" tells honest and cheating provers apart by RTT + proving time, with Encode 10-100x slower | PoRep report p.5 (PDF above) | "computing Encode must run distinguishably slower than acceptable variance in RTT ... we set the minimum time of Encode T Encode = 10 × T honest or 100 × T honest" |

## 3. Unsealing

| claim | verdict | value | permalink | quote |
|---|---|---|---|---|
| Retrieval from a sealed sector requires unsealing | VERIFIED | | [SPEC data_transfer/_index.md#L50](https://github.com/filecoin-project/specs/blob/a95002835b34d4042c007feda3fecf5e68e79dfa/content/systems/filecoin_files/data_transfer/_index.md#L50) | "The storage provider has to unseal all of the requested data before initiating the actual data transfer." |
| Unsealing decodes the whole sector, even to read a small range | VERIFIED | | [RFP api/mod.rs#L73-L76](https://github.com/filecoin-project/rust-fil-proofs/blob/d451d23ba6dcabd107e66b2f9c6531887b17fd3d/filecoin-proofs/src/api/mod.rs#L73-L76) | "Note that the entire sector is unsealed each time this function is called." |
| Unsealing is slow | VERIFIED (docs) | ~1 h to ~3 h per 32 GiB; 1-5 h to delivery. Docs disagree | [DOCS filecoin-faqs.md#L156](https://github.com/filecoin-project/filecoin-docs/blob/d1ad5f455b4cda7be638b241593dc756140406b2/getting-started/community/filecoin-faqs.md#L156); [DOCS network-performance.md#L38](https://github.com/filecoin-project/filecoin-docs/blob/d1ad5f455b4cda7be638b241593dc756140406b2/networks-and-tools/networks/mainnet/network-performance.md#L38) | "a sealed sector holding data takes \~1 hour to unseal. 1-5 hours is our best real-world estimate"; "around \~3 hours for a 32 GiB sector" |
| SPs typically keep an unsealed copy | VERIFIED (docs; "typically" is a recommendation, not a measurement) | recommended practice; FCSS requires it | [DOCS storage-deals.md#L30](https://github.com/filecoin-project/filecoin-docs/blob/d1ad5f455b4cda7be638b241593dc756140406b2/storage-providers/filecoin-deals/storage-deals.md#L30); [DOCS storage.md#L26](https://github.com/filecoin-project/filecoin-docs/blob/d1ad5f455b4cda7be638b241593dc756140406b2/storage-providers/infrastructure/storage.md#L26); [DOCS agent-quickstart.md#L833](https://github.com/filecoin-project/filecoin-docs/blob/d1ad5f455b4cda7be638b241593dc756140406b2/storage-providers/agent-quickstart.md#L833) | "The storage provider can (and should) keep unsealed data copies"; "Storage providers keep copies of sealed sectors and unsealed sectors (for fast retrieval)"; "Keep an unsealed copy of every FCSS piece" |

Implication (inference, not quoted): the unsealed copy that serves retrievals is not covered by any PoRep/PoSt proof, so a latency probe on retrieval measures the unsealed copy, not the sealed replica.

## 4. WindowPoSt constants (mainnet build)

| claim | verdict | value | permalink | quote |
|---|---|---|---|---|
| Epoch duration | VERIFIED | 30 s; 2880 epochs/day | [BA network.rs#L6-L12](https://github.com/filecoin-project/builtin-actors/blob/a90a438e3e9b93247347befb182456818777098a/runtime/src/builtin/network.rs#L6-L12) | `EPOCH_DURATION_SECONDS: i64 = 30`; `EPOCHS_IN_DAY: i64 = SECONDS_IN_DAY / EPOCH_DURATION_SECONDS` |
| WPOST_PROVING_PERIOD | VERIFIED | 2880 epochs (24 h) | [BA policy.rs#L249](https://github.com/filecoin-project/builtin-actors/blob/a90a438e3e9b93247347befb182456818777098a/runtime/src/runtime/policy.rs#L249) | `WPOST_PROVING_PERIOD: ChainEpoch = EPOCHS_IN_DAY` |
| WPOST_CHALLENGE_WINDOW | VERIFIED | 60 epochs (30 min) | [BA policy.rs#L251-L253](https://github.com/filecoin-project/builtin-actors/blob/a90a438e3e9b93247347befb182456818777098a/runtime/src/runtime/policy.rs#L251-L253) | `WPOST_CHALLENGE_WINDOW: ChainEpoch = 30 * 60 / EPOCH_DURATION_SECONDS` |
| WPOST_PERIOD_DEADLINES | VERIFIED | 48 | [BA policy.rs#L256](https://github.com/filecoin-project/builtin-actors/blob/a90a438e3e9b93247347befb182456818777098a/runtime/src/runtime/policy.rs#L256) | `WPOST_PERIOD_DEADLINES: u64 = 48` |
| WPOST_CHALLENGE_LOOKBACK | VERIFIED | 20 epochs (10 min): the challenge is known 10 min before the window opens | [BA policy.rs#L302-L305](https://github.com/filecoin-project/builtin-actors/blob/a90a438e3e9b93247347befb182456818777098a/runtime/src/runtime/policy.rs#L302-L305) | "The challenge is available this many epochs before the window is actually open"; `WPOST_CHALLENGE_LOOKBACK: ChainEpoch = 20` |
| FAULT_DECLARATION_CUTOFF | VERIFIED | 70 epochs | [BA policy.rs#L309](https://github.com/filecoin-project/builtin-actors/blob/a90a438e3e9b93247347befb182456818777098a/runtime/src/runtime/policy.rs#L309) | `FAULT_DECLARATION_CUTOFF: ChainEpoch = WPOST_CHALLENGE_LOOKBACK + 50` |
| FAULT_MAX_AGE | VERIFIED | 42 days | [BA policy.rs#L311](https://github.com/filecoin-project/builtin-actors/blob/a90a438e3e9b93247347befb182456818777098a/runtime/src/runtime/policy.rs#L311) | `FAULT_MAX_AGE: ChainEpoch = WPOST_PROVING_PERIOD * 42` |
| Partition size / challenges | VERIFIED (spec) | 2349 sectors (32 GiB) per partition, 10 challenges each | [SPEC post.md#L41](https://github.com/filecoin-project/specs/blob/a95002835b34d4042c007feda3fecf5e68e79dfa/content/algorithms/pos/post.md#L41) | "limit a single proof to 2349 sectors (a partition), with 10 challenges each" |

Note: a prover has up to lookback + window = 80 epochs (40 min) from seeing the challenge to the end of the deadline. That is much shorter than a ~3 h re-seal, which is the real time bound for WindowPoSt.

## 5. WinningPoSt, power, and Expected Consensus

| claim | verdict | value | permalink | quote |
|---|---|---|---|---|
| Leader election is proportional to QA power | VERIFIED | | [SPEC post.md#L37](https://github.com/filecoin-project/specs/blob/a95002835b34d4042c007feda3fecf5e68e79dfa/content/algorithms/pos/post.md#L37); [SPEC expected_consensus#L75](https://github.com/filecoin-project/specs/blob/a95002835b34d4042c007feda3fecf5e68e79dfa/content/algorithms/expected_consensus/_index.md#L75) | "miners will be chosen (on expectation) proportionally to their _Quality Adjusted Power_"; "a miner is elected proportionally to their quality adjusted power" |
| WinningPoSt must be produced within the epoch; missing it has no penalty | VERIFIED | | [SPEC post.md#L35](https://github.com/filecoin-project/specs/blob/a95002835b34d4042c007feda3fecf5e68e79dfa/content/algorithms/pos/post.md#L35) | "before the end of the current epoch ... No penalty is incurred in this case." |
| QA power scales linearly with committed storage | VERIFIED | | [SPEC storage_power_consensus#L44](https://github.com/filecoin-project/specs/blob/a95002835b34d4042c007feda3fecf5e68e79dfa/content/systems/filecoin_blockchain/storage_power_consensus/_index.md#L44) | "defined to increase linearly with the useful storage that a miner has committed to the network" |
| "Power = proven unique storage" is the Sybil basis of consensus | VERIFIED (paper + spec) | The generation and Sybil attacks are named because they would inflate block-win odds | Filecoin paper p.10 (PDF above); [SPEC porep-old/_index.md#L10](https://github.com/filecoin-project/specs/blob/a95002835b34d4042c007feda3fecf5e68e79dfa/content/algorithms/porep-old/_index.md#L10) | "this inflates the malicious miner's likelihood of winning a block reward in Filecoin, which is proportional to the miner's storage currently in use"; "resistant to Sybil attacks, and unfriendly to outsourcing" |
| Splitting power across Sybil miners does not change expected reward | VERIFIED | WinCount is designed to be Sybil-invariant | [SPEC expected_consensus#L170-L172](https://github.com/filecoin-project/specs/blob/a95002835b34d4042c007feda3fecf5e68e79dfa/content/algorithms/expected_consensus/_index.md#L170-L172) | "WinCount guarantees that a lucky single block will earn the same reward as the reward that the miner would earn had they split their power into multiple sybils." |
| Minimum power to take part in consensus | VERIFIED | 10 TiB (mainnet default) | [BA policy.rs#L379-L384](https://github.com/filecoin-project/builtin-actors/blob/a90a438e3e9b93247347befb182456818777098a/runtime/src/runtime/policy.rs#L379-L384) | `MINIMUM_CONSENSUS_POWER: i64 = 10 << 40` |

## 6. Mainnet sector sizes

| claim | verdict | value | permalink | quote |
|---|---|---|---|---|
| Mainnet supports 32 GiB and 64 GiB | VERIFIED | 32 GiB, 64 GiB (SDR V1_1, SyntheticPoRep, NI-PoRep variants) | [BA runtime/build.rs#L2](https://github.com/filecoin-project/builtin-actors/blob/a90a438e3e9b93247347befb182456818777098a/runtime/build.rs#L2); [BA policy.rs#L451-L462](https://github.com/filecoin-project/builtin-actors/blob/a90a438e3e9b93247347befb182456818777098a/runtime/src/runtime/policy.rs#L451-L462) | `("mainnet", &["sector-32g", "sector-64g"])` |

## 7. On-chain retrieval proof

| claim | verdict | value | permalink | quote |
|---|---|---|---|---|
| The protocol does not prove or enforce retrieval | VERIFIED | Retrieval is off-chain. The miner actor has no retrieval method: the full `Method` enum covers PoSt, commits, faults, and admin only | [SPEC retrieval_market#L15](https://github.com/filecoin-project/specs/blob/a95002835b34d4042c007feda3fecf5e68e79dfa/content/systems/filecoin_markets/retrieval_market/_index.md#L15); [SPEC markets#L14](https://github.com/filecoin-project/specs/blob/a95002835b34d4042c007feda3fecf5e68e79dfa/content/systems/filecoin_markets/_index.md#L14); [BA miner lib.rs#L105-L142](https://github.com/filecoin-project/builtin-actors/blob/a90a438e3e9b93247347befb182456818777098a/actors/miner/src/lib.rs#L105-L142) | "the negotiation process for the retrieval happens primarily off-chain"; "Retrieval deals are also negotiated off-chain and executed with micropayments" |
| PoSt proves the sealed replica, not serving of the data | VERIFIED | | [SPEC post.md#L12](https://github.com/filecoin-project/specs/blob/a95002835b34d4042c007feda3fecf5e68e79dfa/content/algorithms/pos/post.md#L12) | "can only be correctly answered if the miner is actually storing a copy of the sealed data" |
| Nuance: FCSS (application layer) measures retrievability with an oracle | VERIFIED (docs) | This is a FOC service contract, not protocol consensus | [DOCS agent-quickstart.md#L759](https://github.com/filecoin-project/filecoin-docs/blob/d1ad5f455b4cda7be638b241593dc756140406b2/storage-providers/agent-quickstart.md#L759) | "an oracle records your service-level indicators on chain" |

## 8. Fault and termination penalties (builtin-actors)

| claim | verdict | value | permalink | quote |
|---|---|---|---|---|
| The first missed WindowPoSt has no fee; power is lost | VERIFIED | 0 fee in the deadline where the fault is first detected | [BA miner lib.rs#L4245-L4250](https://github.com/filecoin-project/builtin-actors/blob/a90a438e3e9b93247347befb182456818777098a/actors/miner/src/lib.rs#L4245-L4250) | "Faults detected by this missed PoSt pay no penalty, but sectors that were already faulty and remain faulty through this deadline pay the fault fee." |
| Continued fault fee (FF) | VERIFIED | 3.51 days of the sector's expected block reward, charged each proving period it stays faulty | [BA monies.rs#L77-L80](https://github.com/filecoin-project/builtin-actors/blob/a90a438e3e9b93247347befb182456818777098a/actors/miner/src/monies.rs#L77-L80) | `CONTINUED_FAULT_FACTOR_NUM: i64 = 351; CONTINUED_FAULT_FACTOR_DENOM: i64 = 100` |
| Faulty for 42 days leads to termination | VERIFIED | fault expiration = deadline end + FAULT_MAX_AGE | [BA miner lib.rs#L683](https://github.com/filecoin-project/builtin-actors/blob/a90a438e3e9b93247347befb182456818777098a/actors/miner/src/lib.rs#L683) | `let fault_expiration = current_deadline.last() + policy.fault_max_age;` |
| Termination fee (FIP-0098) | VERIFIED | 8.5% of initial pledge, scaled by age / 140 days; floor = max(2% of pledge, 1.05 x FF) | [BA monies.rs#L43-L53](https://github.com/filecoin-project/builtin-actors/blob/a90a438e3e9b93247347befb182456818777098a/actors/miner/src/monies.rs#L43-L53); [BA monies.rs#L183-L206](https://github.com/filecoin-project/builtin-actors/blob/a90a438e3e9b93247347befb182456818777098a/actors/miner/src/monies.rs#L183-L206) | `TERM_FEE_PLEDGE_MULTIPLE_NUM: u32 = 85; ..._DENOM: u32 = 1000`; `TERM_FEE_MIN_PLEDGE_MULTIPLE_NUM: u32 = 2`; `TERM_FEE_MAX_FAULT_FEE_MULTIPLE_NUM: u32 = 105` |
| Invalid (disputed) WindowPoSt penalty | VERIFIED | BR(FF period + 2 days) + 20 FIL | [BA monies.rs#L66-L70](https://github.com/filecoin-project/builtin-actors/blob/a90a438e3e9b93247347befb182456818777098a/actors/miner/src/monies.rs#L66-L70) | `BASE_PENALTY_FOR_DISPUTED_WINDOW_POST: TokenAmount = TokenAmount::from_whole(20)`; `CONTINUED_FAULT_PROJECTION_PERIOD + 2 * EPOCHS_IN_DAY` |

## 9. Independence across miner IDs held by one entity

| claim | verdict | value | permalink | quote |
|---|---|---|---|---|
| PoRep guarantees each replica is a separate, non-deduplicable physical encoding | VERIFIED | | PoRep report p.4 (PDF above); [SPEC stacked_drg.md#L16](https://github.com/filecoin-project/specs/blob/a95002835b34d4042c007feda3fecf5e68e79dfa/content/algorithms/porep-old/stacked_drg.md#L16) | "No two replicas R_i, R_j can be deduplicated into the same physical storage; they must be stored independently."; "a physically independent copy of some data _D_, unique to _P_" |
| The Sybil defense = n identities must store n encodings | VERIFIED | | PoRep report p.4, p.5 (PDF above) | "Sybil Attack ... succceeds if P 0 ...P n store less than n copies of D (i.e. one copy)"; "forces any number of Sybil identities or colluding participants to prove each of those n replicas existed" |
| PoRep guarantees independence of location, operator, or failure domain | REFUTED / not claimed | "physically independent" means separate bytes on disk, not separate sites. The report even names datacenter collocation as a setting where only RTT minimums matter. Nothing in ReplicaID binds location (see 1) | PoRep report p.5 (PDF above) | "(e.g. proofs across the interplanetary internet, or collocated in a datacenter)" |
| Filecoin's (f, m) fault tolerance assumes "independent storage providers" | VERIFIED as an assumption, not something the protocol proves | | Filecoin paper p.8 (PDF above) | "if it results in its input data being stored in m independent storage providers (out of n total)" |
