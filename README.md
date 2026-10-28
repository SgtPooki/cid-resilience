# cid-resilience

Paste a CID, learn how many independent copies of it really exist and how spread out they are.

- Web app: https://sgtpooki.github.io/cid-resilience/ or, served from Filecoin Onchain Cloud, https://bafybeig43wchznmt6mcythdifebmy7qfmxm6mqkfhqvbcm6jfblzekbhum.ipfs.inbrowser.link/
- No backend. Everything runs in your browser against public IPFS primitives.
- No provider cooperation. Nothing to install on the storage provider side.

## What it measures

For one CID the app:

1. **Discovers** providers from IPNI (`cid.contact`) and delegated routing (`delegated-ipfs.dev`), merged by Peer ID. Either source alone is enough; delegated routing sometimes drops its CORS header and is skipped when that happens.
2. **Samples** the DAG: streams a CAR from the first provider that serves one, checks that the first block is the requested root, hash-checks up to 64 blocks, and stops. Challenges are drawn uniformly from that prefix, so a large DAG's tail is never tested. That provider is marked `warmed` in the table.
3. **Challenges** each HTTP endpoint with random blocks (`GET /ipfs/{block}?format=raw`), timing time-to-first-byte against an interleaved `bafkqaaa` baseline, which a gateway answers without touching storage. The body is hashed against the CID.
4. **Probes bitswap-only peers** that advertise browser-dialable addresses (WebTransport, WebRTC-direct, WSS) through helia, using libp2p ping as the baseline. The probe is timed to the first byte of the want-block response and the block is hash-checked. That first byte also includes the peer's bitswap engine scheduling delay, so the 30 ms threshold is calibrated for HTTP, not bitswap; treat bitswap `on-demand` as unproven rather than caught.
5. **Clusters** endpoints by resolved IP (one box) and by ASN (one operator). Known CDN ASNs are labelled and excluded from the durable count.
6. **Bounds distance**: 102 km per millisecond of baseline round trip, plus 11 km for coordinate rounding, is an upper bound on how far the responder is from you (light in fibre, see research). One vantage gives "N copies within X km of you".
7. **Merges vantages**: the share link carries every report. When someone opens it elsewhere and measures, two responders whose distance disks do not overlap are proven apart. The resilience score is the largest set of boxes that are pairwise proven apart, not the raw provider count.

Per provider you get one of: `advertised` (listed, never answered), `unreachable`, `invalid` (answered, wrong bytes or 404), `on-demand` (right bytes, but slower than the baseline by more than the threshold, so fetched from somewhere else), `local` (right bytes, within the threshold).

## What it cannot tell you

- **Proxies closer than the threshold.** The default 30 ms excess allows an upstream within roughly 3,000 km. A provider relaying from a box in the same metro passes, as does one that flushes headers before fetching the body or that slows its own baseline. `on-demand` means "measurably slower than its own no-op", not "proven proxied": the same box can land on either side of the line from different vantages.
- **Anything about tomorrow.** It is a point-in-time measurement, not a continuous proof like PDP or WindowPoSt.
- **Separation from one vantage.** Every single-vantage disk contains you, so two providers can never be shown apart until a second located vantage is merged.
- **Honest vantages.** Vantage locations are self-reported and reports are unsigned. The app flags contradictory disks but cannot stop a lying vantage from manufacturing a separation.
- **Private fibre.** Like every latency-geolocation paper, it assumes the provider has no faster-than-Internet link between its sites.
- **Durability.** A CDN edge with a warm cache is a real copy right now and not one next week. It is counted separately.

The full comparison with PoRep and PDP is in [research/vs-porep.md](research/vs-porep.md) and the attack table in [research/threat-model.md](research/threat-model.md). Every protocol claim traces to a pinned permalink and quote in [research/sources-porep.md](research/sources-porep.md), [research/sources-pdp.md](research/sources-pdp.md), or [research/sources-ipfs-geo.md](research/sources-ipfs-geo.md).

## A real example

CID `bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi`, stored by Filecoin Onchain Cloud providers, measured on 2026-10-28 from Austin, Texas and from a Frankfurt droplet that lived ten minutes. The merged report is in this link (open it and press Measure to add your own vantage):

[merged two-vantage report](https://sgtpooki.github.io/cid-resilience/#r=7Zxbc6patoD_SornhHbemMy8IaIeRbdXQLv2A1e5yEVuol3930-RaOLqXn169zo7u3b1IlWpChIIfGMwGBO-mb_-jau5V_DM2YHDvXKW6V0sNzg4l_xaksLLaOXE1K-oUPn0AoXEQ65XXY4n0_JQah8P5elCiGddnYB75qxjakfF2-5qMynNg8u9_o1723F6auogcyD3zB1Nyz1yr5xZFWWQvH1Qcq-ox0P6zB3ThHt9YZSn-JkrC-6Vgz0ovIDeCxQ3QHiF6JVAHhK65_7-zGV5WgeOmxfc61__xlV5u1u_LLPi9S9_ic0gSdzyJXMyPki83PTSY5Dydhpzz1zmvm_EAThA0zTVZSuPjMB3c2jsV5cy7B_G_pJVW-EydAtv5J_pXNqoc0HYBkPu12cuyLhXDvQwD3vt4UAeA-6ZM4uEeyUE9NAz56dHx825V24z_p_5y_wX9ZfR7unlaeMHyUuSHtPD5flJVWXumbOdhHv1zGPhPnNFaZZVe9rH1DaPLVOzcI9B4nLteTOKEcXs7YuKb-dvtWsYDzC6fc6YQIVnzm1styi4V4EHAgPwtlJkmDxzZW4mhdceXFIdj89c7eaBF7jOW-TytEqc9yC6eZ5-_NLZzOP2V94O9O_P_4jbfPGC40u7xJtVzh-r71Hui3FTKpZ4SsDOpmQ4LaTFoRDVohQTY3ww9NHZGCqjywJgiXv-2GzBwoW8WZ2zVUQnVI6S80lGPsBVWNVlP50TIO6qYEJm6-HqYTNlpKWx521XehM01x2s-ucoN-PT-lop2gDUxULYxeF5cr3m0mdMGeEB4QHGPGD4HlOEAaUPMZUVVVlvlBdp_SS7R7co3ae1tP7tscQ9xFMMGBBucUEfwQQ9xGOGESW9ty8IP4P5gno9HmJKMLiF-muCeTBL92xe-NQu0yxIeDPLvhfOgWuX4sCvlNFZX8VIj63zTgFOpOyK5ZlOltIpteJU1SPs5d9eNICnhAeI3vkChBB55HtMK8c7mrl7Z1rm1SPSIKnNY-B8AxWIhKeA3XOdCeQTKmE8hT3xfvEw8QEqJHwbgfs6gf5fUHs_DBX0GA9Ij4dv6UVeRYzR96iO_LmsJ9urSyZ9bIWHKh5Fk4k8aKY4GMcDce2xMA_9pXmNrQeq3-z8zhWKRHjA2t-8bKdt0vbzoAwK_2njHl07jeMqCWyzDNKkeFKDOChd51_lcpXkrmn7pnV0v4H_juCG-33hDvh96V8jfV--U71t-w6WU-Rf5vOVMtyulQH3bxHb5jGw3PztTH5j4Z-65XW3m0dNZo_mSiBtw77ONlgIpREBfTVwQ6HqL_XpspKWf0jhT5MXx43N5NvcpoLI9yAQ4K0qfNYLEWKeUAYE4X0N_gRPBJ6Qtli8rwHoa6pF9ltK_8y_VgspmVzzw3o7aqTZCTQH5WqHYuWr1cY-rM_q4uDEk4mz-6YYw16PB5TxAv2qYswwLxLMAL1hAh9sGeZJD1J2q7bosRT3eEQguMeD_puy8eN02z6Gd6-Zk135xC2_e1vNPHNpNeeRdxWsrNJHU0xLAxm1MTJAHs2ji8GQiaNm2Gz_-Irxz8ABpDwQAe2J71wf6nRP5AmBH_fFb-o0EHkBih_RIPBrgHs90MOU8eU5SE6VWZg5H6Tfw74eZIM8tjSNXlxtiodCsVYk3V6G-XkUJ6EfFPYMJStPLUr2gR0CyIOewAOIeQjZl-W0yAtIJCK8cXzsLwQe9hBC6FZJHhBTngj43nj0MBG_hvBbmYb_JqmVZVpnfTodrkmtUPPQXK-NFBt7S19diuFJzRAT0nDbHHRX-lMktUh4EYsfrTb5RM4Ij3ptUr9zJeQhqVmPJ5jA26Ugsi9CXuZVUR7douC94Oi2R_0vklrRBuK4MAw29pvS3XvefgTCc6ja1XkxXq9Gos_UhTpbj8ty8Ym9LdNtw9zmNfxo6gRIH7H_oo2f2u__KJEB5CGCIsK3bBWEz0xGvCCinnhbBdEDV8Bj0vvoBEWBfWmj_FIDPgsSszR5u-1cH8EuY8sY7pZFdjDlpVKiwiVrS812yrY4jA7DqSWyDavPPjmb-Rp9IqWQFzAPCOQBBD_cJ_8zUIh5LABG2I1a7xMoQW2PQe5Ae_QBKGwLMxM-BpK_793u1j1-MnNq4TIPonirb3Wj8tSJuppHtbBjxY7Y8cE1yErTJazPZ1d8Z_a-kzdO7z_eMb0v_RnaWSsoi7OZvaTJ8fLUnu7zU5I-vf2ZJ7M2g2N7IE---xbP34TqowfIrdz1NXSmxXK30ORogKVoWdblcjk1jVisamqmK50kS__QAWuHWeUu6kvmaTKbKPHlPGtMOZgvqCorw600DFSlL61diKANtfFPDWwZm6LjDJWlrmzFINRrpzFilDRbmo6LVSlfIsnUrqK-3fnBNPmpUd1zSz2sglED8amiFze6TJWzInuzQXFhm70G06lCBCcXB_l2Z8gdsLZ6HRLt1EClcYxRJp_VsbrxB-cYymDj5tXA3LjRJK6d_bmRyw5YmurL6UGThGxd65IGoJjR0AjsPjnvZDzOh_1sXhF7otlqYLBzByxN9ZW3Slcn5SLjZWHh9Awv3qhYS9Il3gzXTSjUOVzvlkkTEaJ3wNoMOwzBUtCZX03OijEx5rLOpn5Za-nSCNfDs-EmgiAVCKYK7YC1wDLD6OOTLqxgKEJyCkx_FaIl0s5So2w0ClVNY2RUIVHsd8DSVJe0eV_I0XWvTOsijEjWv54SD3n0ai9yKEw8ZqBmLwWTVM87YO1LSr8AxiGqnX1zHUprfHZni-28H4Y1Yhba92UDiWg1KIRYsjtgbdE31f5pFMhYKUqvXgSuKlnzXbIvJv3TAsz30WanaIu-HOX5z93j34HN5YwUh76ezq0p2RI5GpwGpVEfXBkJVRJJ1XZZR1Q3l8tdV8PeXmuEQ2ml7Bs0yVUrdLPzxChHsq1Yyio5rZudjvSVFE-DBV7FHbB22N1oJE23wqI5zZJdOJp74UbX7Hg2wZuhhs5DoQ-QOCi3c_faAUtTfVgGQ2aJVlnGxDHWqu_u5uV0s5ds-bLI-xEJVSUs2TBLMq8Dlqb6ZAGUdb2_rOarZTJxF1W23ElWpg5yawgX_r65oKy_2YRoNwo6YG0ftp451mi8bYy-vYCTgSCZk1RJET2t_EME97nhRFum-dJuOuiAvT06nKYHTUgnzn7cz0C6pnEartE-YKoamPo-sKJKYZo-tm2xA9b2YVMyVJYD18rxzHev5DAEbsrSJtldneow24FF6YVkA3J8TjtgrVnFDjMrG8eev2D5QNwc1HRs1pk4YkNoD9JKy9nAns28rL5Ofw5gv7bI_hBV9XRw6_NJaB5UVS83k8ir8vJuq5IeD26yqsjT75iq9BWQ1mmlUPz5TFUMAc8wxeBdPAIPGh7iGYCE3dwD9ijUwFZxQlgEYu--WSeq_kZRlXyVR9ImDiL4Qwr5jCVkvIB6IhU-TNSPSFLMU4gIuwXyi4zjL5VURZEHAPOM8uh3fPdOCA_FHkU3EUQAn-_escgzSASCbq_XH3kKPCKkJ8L3CIiEfhHRzlDtDNUfKviQIsgzARL6UOt7sMcziiimjw4fBYBnoihC3Mmo3y0RiIciEdFdwQGfciQkrV3FILg5Ta1h9nn3FHkgQNYT71bPF9mR_4U6KhV5Slt9-n1eDf0kjgAvUAbR-xoRkge5-gVTvscoupuqX1ST_ytsVIL5HkYI3ljhzyqBMM8ApQK55bTwSBgwHkBChJu_TvEX1Yz_Sh-1rVKCgDC-Se3wkzniRSAggd4nkn2T1a3FyhgVblMG0Bcx_1ohlVAeQMYjyuPe_0NH_f5cDMR4kSEkkhs__NATw3bGBbhPuCAPXVx7JxYEROEtIOIXFegvVFJbxVfkUTtzi_yeRmpbfAik-GFUeAcKejxFtAduve831QHxBBB6K86M_M7jjH94MtMpqZ2S2impfxJgnZL6n1-MLMSOpQzwHGE9MME-IwfR9lNkYMMbJDk4iUXiK_a0jqoOWOvwbq6Bt87CvLL2WmOk20wt3My3knF2smoFDJWhny1kq7rSWQesfcmzt6tZ37Gpcu1LQa2C0C_Z2UbYl9eohle8n-tVAqRLOu6EwXcltXYPO3F5rlmyGhveukrLme5qmXLt2-FwJovAUtAqGc9oJ9u0wMbD8aoKo0bUmoFsmjUC0RwH8ywfzIeJLBTZYDufjWrNHTO3A9a5Iz-gQmwSYothva-T3Ilix4BZlJ-u_Y1azA4TaTnrb7YpPezi5Qh2wNqH0wOyd6YAyYqqDqJTES1HCrFBFqUbsg8Xwshep1M5jItpv7sk3yxxNhNyZTtbaMNJpZ6MRZBeivpUFwKWy-HGmy9Xwe6y2qtV2flv3TyEHwGGpVk23zSHk7LDwQLIfXO1zdV6HTu6K-_V5Vy54PEktvdVZ4m_PTnfR9qYkdWUylGs2BDsZpemEqNipMlgPXaMk-hCkJbLQX_VAWvvktOhcYquzTwabI1MW4hjKyzJcDxZhGY86S_H-_5htiXbkky6sWQnPf_I04qSDqlHdB-vEJkUZtPE6uVg-xPnkJ1D03Fzuij2NQWTbdeHvVku_magHKBQ9L0ta_b2bKg12nguXk8Rof4iCoVYFiLNnk1U0gFrL8nJfqtL0TQJjOaU707Dkx_HKylIggm4jtXEvjqeuIBC398aHbDWOwRGIxuaPBufMK3N_ADzsrIH8502wcJputauoXGp3HwcF93Tiu6fAPzIXKrFnCQudqDBnI2CYaqKjUhPibdCs2K83kZCfHIH0tqW6KgDlqY6KymaDvLtdOY6dXTJZ-Hh7EinfpHvl8uLcZqd6fZ8NfB5pW06YG0Nm6qz2PAC1csPhaKT7YJUkbuYS44pB9dTZmX9rbcL2JnW3cSNt7Gkl8JpwOars5kGOEsWq-lkS-Fg7-pbVq2u0oqcrN0inmix2gF7s1X6i7EcZ_WSRldluZUmywuKK2Of1WwSzKlq0P0hS2Jr6Po_B7Bf__7r_wI)

What the two vantages showed:

| | Austin | Frankfurt |
|---|---|---|
| advertised | 33 peers, 11 HTTP endpoints | 39 peers, 11 HTTP endpoints |
| served valid | 9 | 10 |
| local copy | 8 | 9 |
| on demand | 1 (caliberation-pdp.infrafolio.com) | 1 (trustless.filebase.io) |
| boxes / operators | 5 / 4 | 5 / 3 |

Merged: 13 endpoints served valid blocks, 7 boxes with a local copy across 4 operators, and **2 boxes proven apart**: `trustless.filebase.io` (15.204.196.122, within 1,260 km of Austin) and `p-fil-http.aur.lu` (195.200.179.67, within 5,451 km of Frankfurt). Those disks cannot overlap because Austin and Frankfurt are 8,529 km apart. The three European operators (aur.lu, ezpdpz.net, twinquasar.io) could not be separated from each other: from Frankfurt their disks all span most of Europe, and from Austin they span the hemisphere.

Two things the single-vantage number would have hidden:

- Filebase resolves to a different IP from Frankfurt (57.129.37.40, OVH Europe) and that endpoint is `on-demand`: 253 ms over its own baseline. The European edge fetches from the US copy. Filebase counts as one box, not two.
- `gateway-v1.pinata.cloud` and `gateway.octopin.app` sit behind Cloudflare. They answer fast from both vantages because the edge is near you. They are labelled `cdn` and left out of the durable count.

Raw numbers from the Frankfurt run are in the link above; the CLI prints the same table.

## CLI

```sh
node count-copies.mjs <cid> [--lat 50.1 --lon 8.7 --label frankfurt] [--out report.json] [--merge other.json]
ROUNDS=5 MAX_EXCESS_MS=30   # env overrides
node --test 'test/*.test.mjs'
```

Node 22 or newer, no dependencies. The CLI and the web app share `engine/`.

## Hosting

The app is plain static files (`index.html`, `app.js`, `engine/`). It is deployed to GitHub Pages from `main`, and to Filecoin Onchain Cloud (calibration, provider ezpdpz-calib2, data set 141) with `filecoin-pin add --provider-id 2 --copies 1 dist/` where `dist/` holds `index.html`, `app.js` and `engine/`. Current root CID: `bafybeig43wchznmt6mcythdifebmy7qfmxm6mqkfhqvbcm6jfblzekbhum`, served through `inbrowser.link`. Paste that CID into the app to measure the app itself. Helia is loaded on demand from jsdelivr only when a bitswap-only peer is found; everything else is first-party code.
