# Where each file comes from

## Committed — the app runs on these

| File | Size | Built by | Contents |
|---|---|---|---|
| `web/public/data/cv.json` | 2.5 MB | `10_cv_timeline.py` | overlay geometry at 5 Hz, stroke stats, die changes, stock piles |
| `web/public/data/pulse.json` | 530 KB | `10_cv_timeline.py` | the raw slide signal at the full 25 Hz + cumulative strokes |
| `web/public/data/day.json` | 400 KB | `40_build_day.py` | the 1,440-minute spine: PLC/VFD per minute, gaps, alarms, OEE |
| `web/public/data/history.json` | 14 KB | `41_build_history.py` | 30 days + 7 condition indicators |
| `web/public/data/plan.json` | 6 KB | `42_build_plan.py` | the weekly plan and per-part rates |
| `web/public/data/floor.json` | 10 KB | `43_build_floor.py` | shop-floor layout + precomputed camera events |

## Release assets — too large for git

| File | Size | Why it's out | Get it |
|---|---|---|---|
| `web/public/videos/press200.mp4` | 241 MB | over GitHub's 100 MB per-file hard limit | `./scripts/fetch-assets.sh` |
| `out/p200_full.json` | 65 MB | raw CV output; only needed to re-run the pipeline | same |

`p200_full.json` is the complete run of the vision pass over the recording:
80,001 frames at 25 Hz, 79,999 JSON records, a parsed footer, 72 counted
strokes and one closed die-change episode.

## Pipeline order

```
01_run_cv.sh        video ──────────────> out/p200_full.json      (GPU, optional)
10_cv_timeline.py   p200_full.json ─────> cv.json, pulse.json, out/strokes_raw.json
20_mock_sources.py  cv.json ────────────> out/sources.json        (PLC + VFD, simulated FROM the camera)
30_reason_engine.py sources + cv ───────> out/reasons.json        (why each stop happened)
40_build_day.py     all of the above ───> day.json
41_build_history.py day.json ───────────> history.json
42_build_plan.py    part rates ─────────> plan.json
43_build_floor.py   floor_layout + cv ──> floor.json
```

`build_all.sh` runs 10 → 43 in order and needs only the Python 3 standard
library. `floor_layout.json` is hand-authored and is never regenerated — the
build merges measured events into it rather than overwriting it.
