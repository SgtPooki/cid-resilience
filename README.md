# cid-resilience

Paste a CID, learn how many independent copies of it really exist and how spread out they are.

- Web app: https://sgtpooki.github.io/cid-resilience/ (also on Filecoin Onchain Cloud, see [Hosting](#hosting))
- No backend. Everything runs in your browser against public IPFS primitives.
- No provider cooperation. Nothing to install on the storage provider side.

## What it measures

For one CID the app:

1. **Discovers** providers from IPNI (`cid.contact`) and delegated routing (`delegated-ipfs.dev`), merged by Peer ID. Either source alone is enough; delegated routing sometimes drops its CORS header and is skipped when that happens.
2. **Samples** the DAG: streams a CAR from the first provider that serves one, hash-checks up to 64 blocks, and stops.
3. **Challenges** each HTTP endpoint with random blocks (`GET /ipfs/{block}?format=raw`), timing time-to-first-byte against the same endpoint's `bafkqaaa` baseline, which a gateway answers without touching storage. The body is hashed against the CID.
4. **Probes bitswap-only peers** that advertise browser-dialable addresses (WebTransport, WebRTC-direct, WSS) through helia, using libp2p ping as the baseline. The probe is timed to the first byte of the want-block response and the block is hash-checked. That first byte also includes the peer's bitswap engine scheduling delay, so the 30 ms threshold is calibrated for HTTP, not bitswap; treat bitswap `on-demand` as unproven rather than caught.
5. **Clusters** endpoints by resolved IP (one box) and by ASN (one operator). Known CDN ASNs are labelled and excluded from the durable count.
6. **Bounds distance**: 100 km per millisecond of baseline round trip is a hard upper bound on how far the responder is from you (light in fibre, see research). One vantage gives "N copies within X km of you".
7. **Merges vantages**: the share link carries every report. When someone opens it elsewhere and measures, two responders whose distance disks do not overlap are proven apart. The resilience score is the largest set of boxes that are pairwise proven apart, not the raw provider count.

Per provider you get one of: `advertised` (listed, never answered), `unreachable`, `invalid` (answered, wrong bytes or 404), `on-demand` (right bytes, but slower than the baseline by more than the threshold, so fetched from somewhere else), `local` (right bytes, within the threshold).

## What it cannot tell you

- **Proxies closer than the threshold.** The default 30 ms excess allows an upstream within roughly 1,500 km. A provider relaying from a box in the same metro passes.
- **Anything about tomorrow.** It is a point-in-time measurement, not a continuous proof like PDP or WindowPoSt.
- **Separation from one vantage.** Every single-vantage disk contains you, so two providers can never be shown apart until a second located vantage is merged.
- **Honest vantages.** Vantage locations are self-reported and reports are unsigned. The app flags contradictory disks but cannot stop a lying vantage from manufacturing a separation.
- **Private fibre.** Like every latency-geolocation paper, it assumes the provider has no faster-than-Internet link between its sites.
- **Durability.** A CDN edge with a warm cache is a real copy right now and not one next week. It is counted separately.

The full comparison with PoRep and PDP is in [research/vs-porep.md](research/vs-porep.md) and the attack table in [research/threat-model.md](research/threat-model.md). Every protocol claim traces to a pinned permalink and quote in [research/sources-porep.md](research/sources-porep.md), [research/sources-pdp.md](research/sources-pdp.md), or [research/sources-ipfs-geo.md](research/sources-ipfs-geo.md).

## A real example

CID `bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi`, stored by Filecoin Onchain Cloud providers, measured on 2026-10-28 from Austin, Texas and from a Frankfurt droplet that lived ten minutes. The merged report is in this link (open it and press Measure to add your own vantage):

[merged two-vantage report](https://sgtpooki.github.io/cid-resilience/#r=7Ztbk6pI1ob_SgXXVTR5Ism6A0T9FG1BRXSiLzgKIgc5iU7Mf5-wyqqyevbevfdM9DdtTxtRF0oKvE-uXLlkvfW3v3Mt9wweOS_2uWfOdcKTG8Rb_1Sea1KFBW38lEYNFZuInqCYhSgIm9P-4Lghyr39tj6cCAndsx9zj1zrZLWzDbjnv3MvZ8sPXRsXPuQeub3jBnvumXOaqo6zlw9q7hkJPKSP3D7PuOcnRnmKH7m64p45KEDxCQhPUFoA8RmiZwJ5SOiG-8cj5-5zL6lebroo8zb2g7Linv_2d64pL1eI6rqonn_6KXXiLAvqp8Iv-DgLSyfM93HOe3nKPXJF8PolDsAeGuf5SnXLxI6joIT2xjzVO2U7jAzWLMVTP6jCQXSkU3mhT0VxGfe5Xx65qnbq5nKn-9xz9twjFxfcMwcEzEPhcquQx4B75Jwq454JAQK63GwQxt2vRgk_Qcw9clG-94OSe-YWw_-bPk1_1n8erB-eHhZRnD1l-T7fnh4fdF3lHjnPz7jn0NlXwSPnOlWwj7OAu-BhFCOK2cuLSi9s3MsRxgOMrp8zJlLxkQs6L6gq7lnkgcgAvB6UGCaPXBuUcRgH_gvfMm8y_4L6H4-_xus8hfH-6fKOd5qS3zdfoqpIaVdrrnTIwNqjpD-u5Nm2kvSqljJ7uLVXg6Pd1wanGcAy9_j-tRnbzdSFeSzMhI6ommTHg4oigJtd09ZKPiVAWjfxiEzmffPma9rAytMwXJqrLu7Oa9gox6R00sP83GhWD7TVTFynu-PofC7lb8whIzwgPMCYBwy_zSHCgNLbObyOghIv_ASk2ylUNV2bL7Qnef6gBvugqoOHuTz_6tRhAfEUAwbE6zSg97kDAuIxw4gS4eUF4cfcPSFB4CGmBIPrzH7_3G2dOjg6Jz736ryIM94pii_NXi_waqkXNdrguDJTtErd41oDfqKtK-NIR4Z8yN0011cJDstPPOOsdfax_2lVAJ4SHiD6BhQghMivFwXgRXxZEsInnvu88cO9UwZvDOuy-YQQSISngL0FMhPJB0LCeAoF6W1lMOkGIST8hffbMZHeIhS-iRAIjAdE4OFLqJBnCWP0JYaDaKqusuU5ICMFu7ttkw6S0UjtdWMcD9OeNA_ZrtxFhnNO3U8Mm6wMHC9y3H3wwfHTNd9IQomIn0Cyl-AVLoEJb0Eqi6fl-BKWShnXcRU9LIJ94OVp2mSx59RxnlUPepzGdeD_KlqDsswvZ9DUn6dTU-sv51qP-1conrOP3aB8OdV35t1xUJ_X62nSFd5gqsXycqes2AKLO3lAgKLHwU5sFGM1NhrZ-MQnz578IHUy_7-ee6ko8QIEIryu0o_1K0HME8qAKL4ewR-xR0SekMvifT0C0Pev3uJ7Mu8kOjczORudy-18OejkyQF0W-3s7aQm0puFt50f9dnWT0cjf_3tXAgFgQeU8SL9Vi58GSW-xBz7D5Ihw7xEMAP0igW8s2SYJwKk7Jrt0G0qFHhEIHjjT3-1kL9N81Im8MG58IsznwX1F3exInQMtzsOwrPoFs1qMMa0tpHd2gMblMk0OdkMOTjp-t3yW7XBf2v13iRKSHkgASpIrxRv8qQg8YTA913oU54EEi9C6Z09gd-PNxSAgCnj62OcHRqncko-zr8Eed4remXqWhY9BdYY98Vqrskrz9iVx0Ga7aK48iYoM0O9qtnXIUMAeSCIPICYh5B9LWLfhjHxPw5YiReRRCR4xXa7eYs8FBBC6JoWbohSnoj4bVcXMJG-H-hLjoW_EbGakbeFQsf9OWk16my787mTU3vjrsxT1T_oBWJivlt221XwrUrojxCxEuElLL0XqeQDMCM8Ei4R-0qRkJuIZQJPMIHXOJfYDwCuy6aq90FV8WG8Dy538pWI1ayeNKxsmw2jrg42YbgZgN1xp3vNcTacmwMpYvpMn8yHdT37BuRL7ryUmpeghe_VkQjpJ8jXUa_lJr2l_LM1fLj8fStKAeQhghLC11AUxY8wRbwoIUG6HoLoBiPgMRHeqypJZD9cYj61gC_izKkd3ruUcbccjdS1-2ujKraOamg1qgIyd_VirS2r7WDbH7sSW7D2GJGjU87RNwhSeCkbAYE8gOCr9eXHqF_v-79dYELMYxEwwq6QhA9-BF02f_LGT6A3_OAlpzLx_QfWb29LWbPff0Lkt-JpGifpcrVc2U2oj3RzmrTimlVr4qXbwCamtZLxajo549-oH1_P_QLnepkrm9d3bzhe332p-nPjujo6xVOe7U8Pl3t8fMjyhxcOD07rxPvLxR6ioAy4rwl631JLtwwiCx1pZaxnlpr0sJwYdVsbxtixU6lpqZObK5IZ0faOZA3qdaLIzmE0GWnp6TjpHDWezqiuav2l3I91TZHnAUTQg9bwDmQZqSP5fl8zVtpSiner1u_sFGXdkubDyqzVUyI71llaLddRPM7uQNDbPOlbMx50EB8aegqS01g7amo46VUntthYMB9rRPRLqVcu17Z6R7KUbWYdOqh1vj0o1KM-1BdR75hCFSyCsuk5iyAZpa2_OXZqfUeyjPHWksVi3q5kC0CpoDs79hRyXKt4WPaVYtoQb2R5emyz4x3JMkMzNw_aScVG5eL8CE_hoJrL8ild9OfdTmxLOF8bWZcQsrojWca2DwxxxaJmdNTskT1VV2wc1a2VG_Zu3j_aQSaKcoVgrtF7klXYtoIPK9GEOwmSQ-xE5g4ZyDrKnbawKNQti5FBgyRJuSNZsjVVxBKdN9q4rXYJKZTzIQtRSM_erITiKGQ26jZyPMpX5R3JUqMK2Nuk9TfduS_P8TGYzJZTZbdrEXPRRlFtJCGzV4mp7N2RLNPRlcMgVrFW1WE7iwNddqfrbFONlMMMTDfJYq1ZM0VNyvIe6os3WVO1INVWWeVTd0yWRE16h15tt9tARWKTJXKzNNqErhzDWN_T2prs-rKpbTo0KnV3FxTHkV0PVE9zNTM7zLv1Cq1MOR3HM2ymdyRr0Fkkz5firDtMsvVuMA13i5XlpZMRXvQtdOyLCkBSr15Og_MdyerXcZ-5klvXKfHtuR4F62k9XmxkTz3NSiUhO13b1axfZEV4R7JGM6DN283JnJpGNgpmTWGsZbfQe6Xbh7No051QoSwWO7QexHckS55PfHcwXHa24s3gqCfKzijXckQPZrRN4Ka0_WTJrEhej3t3JGtQj_OtJeYjfzNUCpDPaZrv5mgTM12PndUmdpNGY9Zq6HnSHckyx6SvGb3ALfEkCs5k2wdBzvIuW5_9ZjtZg1kd7sgClPiY35GsHttO3GKYhtGMlT1psdXzodMW0oD1odfLG6tkPW8yCYv2PP4jyfrlIuz3s30ctkF7PIjdje0jLJ0sCZuyfnN-EIEHV-OHxNMvuD7oMyAXfwiF0l-uj69ZByDgGaYYvHYRP5plgCCeAUjYtffAbrtl8NKvRFgCkvD2tb9MH7emD_L7mz4uwYAIfu8BfUwdZLyIBImK766O94mjmKcQEXadtx8w6_zeho_PLCWJBwDzjPLoq0_jP8b8-NN4QngoCRRdGz8i-HgajyWeQSISdH3gfotP5BEhggRfgUuE_gDAv-we_2W7xx8j4UKKIM9ESOhNrhWgwDOKKKa3LXMKAM8kSYL4L2dH9tongxKR0FubDHx4D-AlpUIGwbXNeOnxfuxWEg9EyATprfP2A-aD_ylvB5V4Si9Oo1cHKP3giwAvUgbR6xEJkhsf0hOmvMAoerN9_EBO_LNbOwjmBYwQvKLBH0seYZ4BSkVyDVjxFihgPICEiFdnF8U_kAD-x8wdl9wjigjjq9kLfhBGvAREJNI3P_OnkL1YQhij4tU6h36A8O_v7vgXYyKhPICMR5THwtf8Hdcxwr_l7kCMlxhCErnCwjfFJLzYDMGby5Dc1EOXbVEUEYVX-tIPJNb_T3fHxfYi8ehiHibfMg-_Dvo3vB2XfEIgxTe_ld7wAYGniArgWjN-WuaIJ4DQa1Jl5DvK8b_MHX-ZO_44sv605g6F7bDvaj08RXgVO2BTkK3kRTmysR32shIcpCqLNG_cJs0dydIX5zicF7uycTdWZ-fLQq-CInKzYXFwWw30tX5UzFS3OdPJHckyN14zUXyPamdFjlsd7KKaHT2EI3WOWnjGm-mqyYB8yof3ZBcwwzbYriXj2LLMHNrhvMnrySqwCu2seLv-RJWAqyEzG07oPbU0h_2h2eySTrK6nuo4LQLJFMfTouxN-5kqVkVvOZ0MWisYsuCOZP1Je3_yIiOetGs3bVb6SerbsEjKw1lZ6NVkO5KNibJY5nS7To0BvCNZ4x7Z-GOAVE3Xe8mhSoyBRjxQJPmCbHYzceDN87G6S6uxck9BaLCJWGrLyczqjxr9YM_i_FS1h7YSsVr3F-HUMOP1ydzoTX1PffU_qx8My5Niuui2B22N4xlQFcdclno7T_1VoG50Y6qd8HCUepvmnhxG801iDRkxx1RNUs2DYD05dY2UVANLBfOhbx-kAIK8NnqKeUey5HHfPiTnbpr0lnZhzaShu6tJfzia7Zx0pBjDjbKdLMmyJqN7qgn_pFYcpaZ9GpJVhE1ERpXTdal-2nrRyN8Wx53jByWdVZuWgtHynvatXrToaVsoVkq4ZN3Gm_StzhpOpfMhITSaJTsxVcXE8iYjndyRrMFos1zJyTiL7e5Qrg_9Q5Smphxn8Qich3rmnf1QmkFRiZb2HclSgd2ptqVOhgdMW6fcwrJuvN50bY2weBjPrfPOPjVBOUyre6rg_6T_-jCZTUkWYB_azF9oGOa61En0kIUmmlTD-TIR00PQk-eeTAd3JIvVFI175XI8Cfw2OZWT3fboywelKjeGcbIPkyNdHs82PprW4o5kqWN9ktphrIflttJWZDkjTRLMprLvqPH5ULiFsgzXMTvS9p5sbkaYw3HMpubRyWNcZDNzPFpS2NsEqyVrzLNskoO7nqUjK9XvSJZmKbOhmhatQZOzZizlkXFCaWNvipaN4inVbbrZFlnq9oPojyTrl3_88k8)

What the two vantages showed:

| | Austin | Frankfurt |
|---|---|---|
| advertised | 33 peers, 11 HTTP endpoints | 39 peers, 11 HTTP endpoints |
| served valid | 9 | 10 |
| local copy | 8 | 9 |
| on demand | 1 (caliberation-pdp.infrafolio.com) | 1 (trustless.filebase.io) |
| boxes / operators | 5 / 4 | 5 / 3 |

Merged: 7 boxes with a local copy across 4 operators, and **2 boxes proven apart**: `trustless.filebase.io` (15.204.196.122, within 1,223 km of Austin) and `p-fil-http.aur.lu` (195.200.179.67, within 5,329 km of Frankfurt). Those disks cannot overlap because Austin and Frankfurt are 8,529 km apart. The three European operators (aur.lu, ezpdpz.net, twinquasar.io) could not be separated from each other: from Frankfurt their disks all span most of Europe, and from Austin they span the hemisphere.

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

The app is plain static files (`index.html`, `app.js`, `engine/`). It is deployed to GitHub Pages from `main`, and to Filecoin Onchain Cloud with `filecoin-pin add .` where it is served through `inbrowser.link` (see the latest CID in the commit history). Helia is loaded on demand from jsdelivr only when a bitswap-only peer is found; everything else is first-party code.
