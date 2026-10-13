#!/usr/bin/env python3
"""press_full_monitor2 output -> compact cv.json (overlays) + pulse + stroke table.

INPUT. `out/p200_full.json` is the complete run of 00000000465000000.mp4:
80,001 frames processed, 79,999 JSON records, video second 0.08 -> 3200.0, a
parsed footer, 72 strokes and one closed die-change episode. It is written at
EVERY frame (25 Hz), not the 5 Hz of the earlier partial run, so this one file
now carries both jobs the old pipeline needed two files for:

  overlay geometry + part boxes + events   (was p200_full.json at 5 Hz)
  the stroke signal at 40 ms               (was p200_trace.csv at 25 Hz)

The 40 ms signal is the whole reason the camera beats the PLC tap: the HMI polls
at ~200 ms, which cannot split down-stroke from up-stroke. A 0.56 s descent is
three samples at 200 ms and fourteen at 40 ms. So the stroke table is built from
the native cadence and is never decimated.

OUTPUT, and why three files instead of one:

  cv.json     overlays, DECIMATED to ~5 Hz. 25 Hz overlays would be a 25 MB
              document to redraw a box that moves four pixels. Lazy-loaded,
              only on the camera and timeline screens.
  pulse.json  the raw vy trace at the FULL 25 Hz plus the cumulative stroke
              count. Loaded on every screen, so it carries no geometry.
  out/strokes_raw.json   the per-stroke timing table (72 rows).
"""
from __future__ import annotations
import csv, json, statistics, sys
from collections import Counter, defaultdict
from pathlib import Path
from _common import OUT, read_monitor_json, write_json

STILL = 0.35            # --press-still-vy: below this the slide is not moving
MIN_RUN = 3             # --stroke-phase-frames: frames needed to confirm a phase
OVERLAY_HZ = 5.0        # cv.json overlay cadence

# A class is treated as STOCK IN VIEW rather than production when the detector
# sees several of it at once, in the same place, for much of the run. See
# detect_stock_pile() for why this matters more than it sounds.
PILE_MIN_FRAME_SHARE = 0.20
PILE_MIN_CONCURRENT = 3


def motion_events(rows, fps: float):
    """Every TDC -> BDC -> TDC slide motion in the 25 Hz vy signal.

    `rows` is [(frame, vy, press_open)] at the native cadence. vy > 0 is the
    slide descending, vy < 0 is it rising (press_full_monitor2's convention).

    This finds MOTION, which is not the same thing as a production stroke, and
    the difference is the point. On this run the signal holds 82 such motions
    while the monitor's own counter reaches 72. All ten extras fall between
    36 s and 1011 s — inside the die change — because a setter inching the
    slide moves it exactly like a stroke does. The monitor is right not to
    count those, so the count stays its own (see attach_timing); the ten get
    reported separately as setup jogs, which is useful on its own.
    """
    if not rows:
        return []

    # collapse to sign runs, keeping only runs long enough to be a real phase
    runs, cur_sign, start = [], 0, 0
    for i, (_f, vy, _o) in enumerate(rows):
        s = 1 if vy > STILL else (-1 if vy < -STILL else 0)
        if s != cur_sign:
            if cur_sign != 0 and i - start >= MIN_RUN:
                runs.append((cur_sign, start, i))
            cur_sign, start = s, i
    if cur_sign != 0 and len(rows) - start >= MIN_RUN:
        runs.append((cur_sign, start, len(rows)))

    # a stroke = a DOWN run, the RISE run after it, up to the next DOWN run
    downs = [r for r in runs if r[0] == 1]
    strokes = []
    for k, (_s, i0, i_down_end) in enumerate(downs):
        nxt = downs[k + 1][1] if k + 1 < len(downs) else None
        rise = next((r for r in runs if r[0] == -1 and r[1] > i0), None)
        if rise is None or (nxt is not None and rise[1] >= nxt):
            continue
        t_tdc = rows[i0][0] / fps
        # BDC is where the DESCENT ends. Taking it as the start of the next
        # rise folds any pause at the bottom into "down-stroke time" — the same
        # error as on the up-stroke, and it read as a 120 s descent.
        t_bdc = rows[min(i_down_end, len(rows) - 1)][0] / fps
        # The up-stroke is the rise run's OWN duration. Measuring BDC -> next
        # TDC folds the idle wait into "up-stroke time", which made the
        # brake-wear indicator read 30 s whenever the operator paused.
        t_up_start = rows[rise[1]][0] / fps
        t_up_end = rows[min(rise[2], len(rows) - 1)][0] / fps
        t_next = rows[nxt][0] / fps if nxt is not None else None
        # dwell = everything that is not the slide moving: the hold at the
        # bottom plus the wait at the top before the next descent
        dwell = ((t_up_start - t_bdc) +
                 ((t_next - t_up_end) if t_next is not None else 0.0))
        period = (t_next - t_tdc) if t_next else None
        strokes.append({
            "t": round(t_tdc, 2),
            "period": round(period, 3) if period else None,
            "spm": round(60.0 / period, 2) if period and period > 0 else None,
            "down_ms": round((t_bdc - t_tdc) * 1000),
            "up_ms": round((t_up_end - t_up_start) * 1000),
            "dwell_ms": round(dwell * 1000),
        })
    return strokes


def attach_timing(frames, motions, fps: float, match_s: float = 3.0):
    """The authoritative stroke list, with 40 ms phase timing attached.

    The COUNT comes from the monitor (`stroke.count`, which reaches 72) — it is
    the detector's own judgement about what was a production stroke and this
    pipeline does not second-guess it. The TIMING comes from the vy sign runs,
    matched to each counted stroke by nearest TDC. Motion the monitor did not
    count is returned separately as `jogs`.

    Two counted strokes (204.48 s, 1043.24 s) have no clean sign-run pair, both
    inside the die change: they keep their timestamp and carry null phases
    rather than being dropped or given invented numbers.
    """
    inc = []
    prev = 0
    for r in frames:
        c = r["stroke"]["count"]
        if c != prev:
            inc.append((c, r["time_s"]))
            prev = c

    used = set()
    strokes = []
    for n, t in inc:
        best, bi = None, -1
        for i, m in enumerate(motions):
            if i in used:
                continue
            dt = abs(m["t"] - t)
            if dt <= match_s and (best is None or dt < abs(best["t"] - t)):
                best, bi = m, i
        row = {"i": n, "t": round(t, 2),
               "down_ms": None, "up_ms": None, "dwell_ms": None,
               "period": None, "spm": None, "timed": False}
        if best is not None:
            used.add(bi)
            row.update({k: best[k] for k in ("down_ms", "up_ms", "dwell_ms")})
            row["timed"] = True
        strokes.append(row)

    # period/spm from the counted stroke timestamps, not from the motion runs,
    # so cadence and count can never tell different stories
    for a, b in zip(strokes, strokes[1:]):
        a["period"] = round(b["t"] - a["t"], 3)
        a["spm"] = round(60.0 / a["period"], 2) if a["period"] > 0 else None

    jogs = [{**m, "why": "slide motion the stroke counter did not count"}
            for i, m in enumerate(motions) if i not in used]
    return strokes, jogs


def trace_from_csv(path: Path):
    if not path.exists():
        return []
    rows = []
    with open(path) as fh:
        for r in csv.DictReader(fh):
            try:
                rows.append((int(r["frame"]), float(r["vy"]), int(r["press_open"] or 0)))
            except (ValueError, KeyError):
                continue
    return rows


def detect_stock_pile(frames, classes):
    """Find classes the detector is seeing as a STATIONARY STOCK TRAY.

    This run fires `part_collar` 429,989 times — eleven at once, every frame,
    inside a 379x264 px patch that never moves, at 0.76 median confidence. That
    is a tray of collar parts sitting in shot. It is not 429,989 parts made, and
    a dashboard that counts detections as production would read ~5,000 parts per
    minute off a press doing five strokes a minute.

    So piles are identified, declared with their envelope and typical count, and
    kept OUT of the per-frame overlay — one labelled region instead of eleven
    anonymous boxes per frame. That is both honest and ~2.4 MB smaller. Parts
    made are counted from strokes, never from detections.
    """
    n = len(frames)
    per_frame = defaultdict(list)
    boxes = defaultdict(list)
    conf = defaultdict(list)
    first_t, last_t = {}, {}
    for r in frames:
        c = Counter(d["class"] for d in r["parts"]["detections"])
        for cls, k in c.items():
            per_frame[cls].append(k)
            first_t.setdefault(cls, r["time_s"])
            last_t[cls] = r["time_s"]
        for d in r["parts"]["detections"]:
            boxes[d["class"]].append(d["box"])
            conf[d["class"]].append(d["conf"])

    piles, job = {}, []
    for cls in classes:
        counts = per_frame.get(cls)
        if not counts:
            continue
        share = len(counts) / max(1, n)
        conc = statistics.median(counts)
        bs = boxes[cls]
        env = [min(b[0] for b in bs), min(b[1] for b in bs),
               max(b[2] for b in bs), max(b[3] for b in bs)]
        if share >= PILE_MIN_FRAME_SHARE and conc >= PILE_MIN_CONCURRENT:
            piles[cls] = {
                "class": cls,
                "envelope": env,
                "typical_n": int(conc),
                "max_n": max(counts),
                "frames_seen": len(counts),
                "frame_share": round(share, 3),
                "conf_median": round(statistics.median(conf[cls]), 3),
                "first_s": round(first_t[cls], 1), "last_s": round(last_t[cls], 1),
                "why": (f"{int(conc)} detections at once inside a "
                        f"{env[2]-env[0]}x{env[3]-env[1]} px patch that does not move — "
                        f"stock in view, excluded from part counts"),
            }
        else:
            job.append(cls)
    return piles, job


def main():
    src = OUT / "p200_full.json"
    if not src.exists():
        sys.exit(f"missing {src} — run pipeline/01_run_cv.sh first")
    d = read_monitor_json(src)
    hdr, frames, summary = d["header"], d["frames"], d["summary"]
    fps = hdr.get("fps", 25.0)
    nat = hdr.get("native_size", [1920, 1080])
    classes = hdr.get("classes", [])
    if not frames:
        sys.exit("no frame records parsed")

    span = frames[-1]["time_s"] - frames[0]["time_s"]
    hz = round((len(frames) - 1) / span, 3) if span > 0 else fps
    print(f"cv: {len(frames)} frame records  fps={fps}  native cadence {hz} Hz  "
          f"{span:.1f}s  {'COMPLETE' if d['complete'] else 'PARTIAL (run still going)'}")
    if not d["complete"]:
        print("  ! footer did not parse — die-change episodes and summary totals are MISSING")

    # ---- the stroke table, at the native cadence, never decimated ----------
    trace = trace_from_csv(OUT / "p200_trace.csv")
    if trace:
        print(f"stroke signal: p200_trace.csv ({len(trace)} rows)")
    else:
        trace = [(r["frame"], r["stroke"]["vy"], int(bool(r["stroke"]["press_open"])))
                 for r in frames]
        print(f"stroke signal: p200_full.json frames ({len(trace)} rows at {hz} Hz)")
    motions = motion_events(trace, fps)
    strokes, jogs = attach_timing(frames, motions, fps)
    claimed = summary.get("strokes")
    print(f"strokes: {len(strokes)} counted by the monitor"
          + (f" (summary says {claimed})" if claimed is not None else "")
          + f"; {len(motions)} slide motions in the 40 ms signal, "
            f"{len(jogs)} of them uncounted setup jogs")
    if claimed is not None and claimed != len(strokes):
        print(f"  ! count disagrees with the footer — using the per-frame counter")
    timed = [s for s in strokes if s["timed"]]
    # the cadence that matters is the one DURING production; the 426 s
    # die-change gap would otherwise drag the median into nonsense
    run_periods = sorted(s["period"] for s in strokes if s["period"] and s["period"] < 60)
    med = statistics.median(run_periods) if run_periods else 0.0
    if med:
        print(f"  running period median {med:.2f}s = {60/med:.2f} spm "
              f"(p10 {run_periods[len(run_periods)//10]:.2f}s, "
              f"p90 {run_periods[9*len(run_periods)//10]:.2f}s)")
    if timed:
        dn = statistics.median([s["down_ms"] for s in timed])
        up = statistics.median([s["up_ms"] for s in timed])
        dw = statistics.median([s["dwell_ms"] for s in timed])
        print(f"  down {dn:.0f} ms · up {up:.0f} ms · dwell {dw:.0f} ms "
              f"-> {100*dw/(dn+up+dw):.0f}% of the cycle is dwell "
              f"({len(timed)}/{len(strokes)} strokes timed)")

    # ---- stock piles vs the job part --------------------------------------
    piles, job_classes = detect_stock_pile(frames, classes)
    for p in piles.values():
        print(f"stock pile: {p['class']} — {p['why']}")
    print(f"job part classes kept per frame: {job_classes}")

    # ---- overlays, decimated ----------------------------------------------
    stride = max(1, round(hz / OVERLAY_HZ))
    out = []
    for r in frames[::stride]:
        st, w, sh, dc = r["stroke"], r.get("worker"), r["sheet"], r["die_change"]
        ps = {"----": 0, "RISE": 1, "STILL": 2, "DOWN": 3}.get(st["state"], 0)
        person = None
        if w and w.get("box"):
            b = w["box"]
            person = [w.get("tid") or 0, b[0], b[1], b[2], b[3], 3,
                      round((w.get("reid_sim") or 0) * 100)]
        dets = r["parts"]["detections"]
        out.append({
            "f": r["frame"], "t": round(r["time_s"], 2),
            "vy": st["vy"], "ps": ps, "op": int(bool(st["press_open"])),
            "c": st["count"],
            "w": person, "cf": int(bool(w and w.get("confirmed"))),
            # job-part boxes only; the stock tray rides in cv.stock as a count.
            # Class stays a NAME: four call sites read d[0][0] as one, and
            # indexing it to save bytes buys nothing now that the pile is out.
            "d": [[x["class"], round(x["conf"] * 100), *x["box"]]
                  for x in dets if x["class"] in job_classes],
            "sn": sum(1 for x in dets if x["class"] in piles),
            "ev": sh.get("event"), "si": sh["in"], "so": sh["out"],
            "pg": int(bool(sh.get("part_gate_ok"))),
            "dcs": {"running": 1, "idle": 2, "die_change": 3}.get(dc["state"], 0),
            "dc": int(dc["state"] == "die_change"), "fk": int(bool(dc["forklift"])),
            "sk": None,
        })

    # how much of the window the slide signal was simply unavailable
    no_sig = sum(1 for r in frames if r["stroke"]["state"] == "----")
    states = Counter(r["stroke"]["state"] for r in frames)

    cv = {
        "video": hdr.get("video", "00000000465000000.mp4"),
        "video_url": "/videos/press200.mp4",
        "fps": fps, "native": nat,
        "overlay_hz": round(hz / stride, 2),
        "signal_hz": hz,
        "stroke_roi": hdr.get("stroke_roi_native", [530, 40, 480, 300]),
        "bolster_roi": summary.get("bolster_roi_native", [458, 340, 624, 300]),
        "machine_roi": summary.get("machine_roi_proc", [74, 12, 231, 231]),
        "classes": classes,
        "job_classes": job_classes,
        "stock": list(piles.values()),
        "complete": d["complete"],
        "totals": {
            "frames_processed": summary.get("frames_processed", len(frames)),
            "records": len(frames),
            "overlay_samples": len(out),
            "strokes": summary.get("strokes", out[-1]["c"] if out else 0),
            "sheet_in": summary.get("sheet_in", out[-1]["si"] if out else 0),
            "sheet_out": summary.get("sheet_out", out[-1]["so"] if out else 0),
            "seconds": round(frames[-1]["time_s"], 1),
            "no_signal_s": round(no_sig / hz, 1),
            "slide_states": dict(states),
            "running_spm": round(60 / med, 2) if med else 0,
        },
        "stroke_stats": {
            "counted": len(strokes),
            "timed": len(timed),
            "motions": len(motions),
            "setup_jogs": len(jogs),
            "running_period_s": round(med, 2) if med else None,
            "down_ms": round(statistics.median([s["down_ms"] for s in timed])) if timed else None,
            "up_ms": round(statistics.median([s["up_ms"] for s in timed])) if timed else None,
            "dwell_ms": round(statistics.median([s["dwell_ms"] for s in timed])) if timed else None,
            "note": ("count is the monitor's own stroke counter; phase timing is "
                     "measured from the 40 ms vy signal and matched by nearest TDC"),
        },
        "setup_jogs": jogs,
        "die_changes": summary.get("die_changes", []),
        "events": d["events"],
        "frames": out,
    }
    write_json("cv.json", cv)

    # A companion file so the stroke pulse in the top bar shows the REAL signal
    # on every screen. cv.json is megabytes of geometry and only the camera and
    # timeline screens justify it; this is the raw vy trace alone, at 40 ms.
    write_json("pulse.json", {
        "t0": round(frames[0]["time_s"], 2),
        "hz": hz,
        "video_s": round(frames[-1]["time_s"], 1),
        "vy": [round(r["stroke"]["vy"], 2) for r in frames],
        "c": [r["stroke"]["count"] for r in frames],
    })

    OUT.mkdir(exist_ok=True)
    with open(OUT / "strokes_raw.json", "w") as fh:
        json.dump(strokes, fh)
    print(f"  -> out/strokes_raw.json  ({len(strokes)} strokes, {len(timed)} with phases)")


if __name__ == "__main__":
    main()
