# Press 200 — design system

**"Instrument, not dashboard."** Dark steel, hairline construction, tabular
readouts, and one living trace that never stops moving.

1. **Motion must mean something.** Every animation is driven by real data or
   real state. A press that stops makes the UI go still — that stillness is
   information.
2. **One time, everywhere.** A single cursor (`lib/cursor.ts`) is shared by
   every panel on every screen.
3. **Hairlines, not boxes.** 1px rules at ~9% ink. Status is a 3px left
   edge-bar plus icon and label — never a filled card.
4. **Numbers are instruments.** Mono + `tabular-nums` for anything that
   changes, so digits never reflow.

## Colour — validated, not eyeballed

Run against the real surfaces, not the defaults:

```
dark  on #121619 → ALL PASS   worst adjacent CVD ΔE 8.4 · normal-vision 19.3 · all 8 ≥3:1
light on #fbfcfd → ALL PASS   worst adjacent CVD ΔE 9.1 · normal-vision 19.6
                              + documented contrast WARN on slots 3/4/5 (relief: labels + table views)
dark, first 3 slots, --pairs all → PASS   (the cap for scatter / small multiples)
```

Status tokens measured on `#121619`: good 5.42 · warning 9.91 · serious 6.90 ·
critical 3.79 — all clear 3:1. The muted ink is a cool `#8b949e` (5.91:1),
which beats the warm default (5.06) and suits the steel theme.

### Two families that must never swap

`lib/palette.ts` keeps them side by side deliberately:

- **Categorical** `--s1..--s8` = **identity**. A downtime cause is an entity, so
  "Breakdown" is permanently slot 8. Filtering never repaints a survivor.
- **Status** `--good/--warning/--serious/--critical` = **state**, always with an
  icon and a label.

Both want red. They get different reds. ISO-style health zones are the one
place a severity ramp is correct, because A/B/C/D genuinely *are* states.

## Navigation

- **Top bar (64px):** brand · machine · **live stroke pulse** · status · clock ·
  spm/kW · trust chips · Live · theme · operator.
- **Left rail (72 → 212px):** three groups of three — Monitor (Live, Timeline,
  Camera) · Analyze (Downtime, Energy, Health) · Plan (Planner, Reports) ·
  Operator view. Badges only for things needing a human decision.
- **Time spine (56px, bottom, every screen):** the anchor. Reason-coded blocks,
  camera-coverage underline, event stepping. Content fades around it on route
  change; the spine never moves.

## The four canvas instruments

| | What |
|---|---|
| **I · StrokePulse** | the machine's heartbeat in the top bar; flatlines and dims when strokes stop |
| **II · SlidePosition** | a block that physically rides up and down with real `vy` |
| **III · LaneTimeline** | the day on ten lanes; zoom 24 h → 10 s, click to seek, drag to pan |
| **IV · VideoOverlay** | boxes drawn over the video — **geometry interpolated 5 Hz → 25 fps** |

Instrument IV matters: `cv.json` is 5 Hz and the video is 25 fps, so box corners
are lerped between neighbouring samples every frame. Discrete state (part class,
banners, counters) snaps instead — interpolating a class label is meaningless.

## Charts

Hand-rolled on `d3-scale` rather than a chart library, so the mark specs are
exact: bars ≤24px with a 4px rounded data-end **square at the baseline**, 2px
lines, ≥8px markers, 2px surface gaps between touching fills, hairline **solid**
gridlines. Every chart ships a hover layer, a legend for ≥2 series, and a
**table-view twin** — nothing is gated behind a hover.

**Banned, in writing:** dual axes · pie/donut · radial gauges · rainbow ramps ·
value-ramps on nominal categories · a number on every point · dashed gridlines ·
recolour-on-filter · a generated 9th hue.

Form follows the data's job: OEE is three **meters** (not gauges, not donuts);
the downtime Pareto folds to **top 5 + Other**; weekly cause trends are **small
multiples**, not six lines on one plot; magnitude on a grid is a **sequential
heatmap**, one hue.

## Motion

```
--t-fast 120ms   --t-base 200ms   --t-slow 320ms   --t-tell 480ms
--e-out cubic-bezier(.2,0,0,1)    --e-move cubic-bezier(.4,0,.2,1)
```

Live data never animates through CSS — it is `requestAnimationFrame` on canvas.
CSS motion is for UI only. The crosshair is **0 ms**: latency there feels broken.
One ambient animation exists in the whole app (the breathing sparkline tip).
Alarms pulse **once** on arrival and then hold still.

`prefers-reduced-motion`: decorative motion off, functional motion kept — the
overlay interpolation stays, because it prevents stutter rather than causing it.

## Non-negotiables

1. Run the validator before changing any series colour.
2. Categorical ≠ status. Never swap the tokens.
3. One axis. No dual-axis chart, ever.
4. Colour follows the entity, not its rank.
5. Text wears text tokens, never the series colour.
6. Every chart has a table twin and a hover layer.
7. `measured` / `inferred` / `simulated` is visible on every number.
8. Grey means no coverage. Zero means measured zero.
9. Quality is never fabricated.
10. One hero figure per view.
