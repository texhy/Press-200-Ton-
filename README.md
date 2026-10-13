# Press 200 — monitoring platform demo

A monitoring and analytics front end for a 200-ton mechanical press, built on
three channels: a **camera** (computer vision over a 53-minute recording), a
**PLC** tap, and a **VFD** drive link.

**Only the camera channel is real.** Everything the PLC and the VFD "report"
here is simulated — but simulated *from the camera's own measured stroke
cadence*, so the three channels agree with each other wherever they should. The
UI labels the difference on every single number rather than hiding it; see
[Provenance](#provenance).

---

## Run it

```bash
cd web
npm install
npm run dev          # http://localhost:3000
```

That is the whole setup. **All the data the app needs is committed** under
`web/public/data/`, so a fresh clone runs with the exact numbers you saw — no
pipeline run, no Python, no GPU.

### Optional: the video

`/camera` and `/timeline` play the recording the CV ran over. It is 241 MB,
which is over GitHub's 100 MB per-file limit, so it ships as a release asset:

```bash
./scripts/fetch-assets.sh      # needs `gh` or `curl`
```

Without it you get nine fully working screens and an empty player on two of
them. Nothing else changes — every number is already in the committed JSON.

---

## What you're looking at

| Screen | What it answers |
|---|---|
| `/` | the whole shop floor in 3D — which of the 12 presses needs attention |
| `/live` | what the press is doing right now, and whether it will hit target |
| `/camera` | the CV overlays on the footage: strokes, operator, sheets, die change |
| `/timeline` | the day on ten lanes, scrubbable to any second |
| `/downtime` | every stop, classified, with the evidence behind each one |
| `/energy` | production power vs idle burn, in rupees |
| `/health` | seven condition indicators with 30-day trends |
| `/planner` | the week, editable, with plan-vs-actual variance |
| `/reports` | the full day log, minute by minute, every value with its source |
| `/operator` | the shop-floor view: one instruction, four numbers, Urdu toggle |

There's a **shift assistant** (the `✦ Ask` button, bottom right) with 13
predefined questions. It calls no model — every answer is a pure function of
the loaded JSON, so it can't invent a number, and it refuses anything outside
its vocabulary rather than guessing.

---

## Provenance

Every tile and chart carries a chip saying which box produced it:

| Chip | Channel | What only it can tell you | Real here? |
|---|---|---|---|
| `CAMERA` | vision pass, 25 Hz | strokes and 40 ms phase timing, parts, people, sheets, the die change | **yes — measured** |
| `PLC` | Omron CIO tap, ~200 ms poll | machine *state*: run/stop, mode, MISFEED / OIL / AIR / OVERLOAD | simulated |
| `VFD` | Delta VFD-B Modbus | the *drive*: kW, amps, torque, power factor, DC bus, fault 2100H | simulated |
| `CALC` | — | derived from the above (OEE, costs, downtime classification) | — |
| `PLAN` | — | business inputs: targets, takt, tariff, the schedule | — |

The headline finding from the real data: the press runs at **5.36 spm against
an 8.6 spm takt**, and **90% of every cycle is the slide sitting still** waiting
for a manual load (down 560 ms, up 560 ms, dwell 10,100 ms). The press is not
the constraint. Only the camera can show this — at a 200 ms PLC poll a 560 ms
down-stroke is three samples.

---

## Layout

```
pipeline/            Python: CV output -> the JSON the app reads
  01_run_cv.sh         the real CV pass (needs the video + a GPU)
  10..43_*.py          timeline, mock PLC/VFD, reason engine, day, history, plan, floor
  build_all.sh         runs them in dependency order
  floor_layout.json    hand-authored shop-floor sketch (never regenerated)
web/                 Next.js 15 app router, React 19, TypeScript, Tailwind 4
  public/data/*.json   >>> the committed data the app runs on <<<
  lib/                 cursor clock, CV reader, provenance, assistant
  components/          charts, 3D floor, instruments, shell
Press_work-main/     the original CV pipeline + model weights, unmodified
docs/DATA.md         where each file comes from and how to rebuild it
```

## Rebuilding the data (optional)

Only if you want to re-derive everything from the video:

```bash
./scripts/fetch-assets.sh        # gets the video + raw CV output
./pipeline/build_all.sh          # regenerates web/public/data/*.json
```

`build_all.sh` needs nothing but Python 3 stdlib. Re-running the CV itself
(`pipeline/01_run_cv.sh`) needs ultralytics + torch and a GPU — set `PRESS_PY`
to a venv that has them.

## Known limits

- One of twelve presses is instrumented. The other eleven show a **declared
  simulation** so the floor map reads as a shop; the UI says so in three places.
- There is **no quality or scrap source** anywhere, so OEE is A × P only. The
  Quality meter shows "no source", never a zero.
- The recording's wall-clock time was not preserved; it is anchored at 09:12 so
  the measured window sits inside a morning production block.
- Planner edits are stored in **browser localStorage** — there is no backend.
