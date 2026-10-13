#!/usr/bin/env python3
"""Floor map data: hand-authored layout + CV-derived events for s_press_1.

The layout half (pipeline/floor_layout.json) is hand-authored and never
regenerated — it encodes a sketch of the real shop. This script only merges in
the parts that come from measurement, so `build_all.sh` can run freely without
clobbering the drawing.

Everything derived here is precomputed deliberately: the floor map is the app's
landing page and must never parse cv.json (5.1 MB raw / 305 KB gzipped) just to
know when an operator was at the station.
"""
from __future__ import annotations
import json
from _common import CAM_START_MIN, DATA, ROOT, write_json

LAYOUT = ROOT / "pipeline" / "floor_layout.json"
MIN_GAP = 4.0          # seconds; bridge detection flicker rather than emit confetti
MIN_RUN = 2.0          # seconds; drop one-frame blips


def complement(spans, lo, hi, min_len):
    """The holes in `spans` inside [lo, hi] — the absences worth asking about.

    A presence list answers "was someone there". The gaps are what a shift lead
    actually acts on, and on this run the largest is 953 s: the operator leaves
    at 09:49:16 and the camera watches an idle press until coverage ends at
    10:06. That is the single biggest fact in the footage and it only exists as
    the absence of data, so it gets computed rather than left to be noticed.
    """
    out, cur = [], lo
    for a, b in sorted(spans):
        if a - cur >= min_len:
            out.append([round(cur, 1), round(a, 1)])
        cur = max(cur, b)
    if hi - cur >= min_len:
        out.append([round(cur, 1), round(hi, 1)])
    return out


def intervals(frames, pred, t0_clock):
    """Compress a per-frame predicate into [start, end] clock-second spans."""
    out, run = [], None
    for f in frames:
        if pred(f):
            if run is None:
                run = [f["t"], f["t"]]
            else:
                run[1] = f["t"]
        elif run is not None:
            out.append(run); run = None
    if run is not None:
        out.append(run)

    merged = []
    for a, b in out:
        if merged and a - merged[-1][1] <= MIN_GAP:
            merged[-1][1] = b
        else:
            merged.append([a, b])
    kept = [[round(t0_clock + a, 1), round(t0_clock + b, 1)]
            for a, b in merged if b - a >= MIN_RUN]
    intervals.last_raw = len(out)
    return kept


def pair_forklift(times):
    """The detector logs a sighting on the way in AND on the way out.

    Six timestamps are three visits: gaps inside a pair are 5-7 s, gaps between
    pairs are 2-3 minutes. Rendering six arrivals would double the traffic.
    """
    visits, i = [], 0
    while i < len(times):
        if i + 1 < len(times) and times[i + 1] - times[i] <= 30:
            visits.append([round(times[i], 1), round(times[i + 1], 1)]); i += 2
        else:
            visits.append([round(times[i], 1), round(times[i] + 20, 1)]); i += 1
    return visits


def main():
    layout = json.load(open(LAYOUT))
    cv = json.load(open(DATA / "cv.json"))
    day = json.load(open(DATA / "day.json"))
    kinds = layout.pop("kinds")
    t0 = CAM_START_MIN * 60                       # video second 0 -> clock seconds

    stations = []
    for s in layout["stations"]:
        k = dict(kinds[s["kind"]])
        st = {
            "id": s["id"], "label": s["label"], "kind": s["kind"],
            "tonnage": s["tonnage"],
            "pos": [s["pos"][0], 0, s["pos"][1]],
            "rot": s.get("rot", 0),
            "dims": k["dims"], "ram": k["ram"],
            "instrumented": bool(s.get("instrumented")),
            "routes": s.get("routes", {"primary": None}),
        }
        if "flywheel" in k:
            st["flywheel"] = k["flywheel"]
        if s.get("operator_post"):
            st["operator_post"] = s["operator_post"]
        if st["instrumented"]:
            st["trust"] = "measured"
            st["sources"] = ["cv", "plc", "vfd"]
            st["sim"] = None
        else:
            st["trust"] = "simulated"
            st["sources"] = []
            sim = s["sim"]
            # expand the terse pattern rows into named fields
            st["sim"] = {
                "phase": sim["phase"], "spm": sim["spm"],
                "pattern": [
                    {"m0": p[0], "m1": p[1], "state": p[2],
                     **({"severity": p[3], "label": p[4]} if len(p) > 4 else {})}
                    for p in sim["pattern"]
                ],
            }
        stations.append(st)

    # ---- the measured half ------------------------------------------------
    frames = cv["frames"]
    present = intervals(frames, lambda f: f["w"] is not None, t0)
    die = [[round(t0 + e["start_s"], 1), round(t0 + (e.get("end_s") or e["start_s"]), 1)]
           for e in cv.get("die_changes", []) if e.get("end_s")]
    fk_raw = [t for e in cv.get("die_changes", []) for t in e.get("forklift_times_s", [])]
    visits = [[round(t0 + a, 1), round(t0 + b, 1)] for a, b in pair_forklift(sorted(fk_raw))]
    coverage = [[day["camera"]["start_min"] * 60, day["camera"]["end_min"] * 60]]
    raw_runs = getattr(intervals, "last_raw", len(present))
    absent = complement(present, coverage[0][0], coverage[0][1], 60.0)

    tot = cv.get("totals", {})
    sst = cv.get("stroke_stats", {})
    dn, up, dw = sst.get("down_ms") or 0, sst.get("up_ms") or 0, sst.get("dwell_ms") or 0
    measured = {
        "strokes": tot.get("strokes"),
        "running_spm": tot.get("running_spm"),
        "running_period_s": sst.get("running_period_s"),
        "down_ms": dn or None, "up_ms": up or None, "dwell_ms": dw or None,
        "dwell_pct": round(100 * dw / (dn + up + dw)) if (dn + up + dw) else None,
        "sheet_in": tot.get("sheet_in"), "sheet_out": tot.get("sheet_out"),
        "no_signal_s": tot.get("no_signal_s"),
        "covered_s": round(coverage[0][1] - coverage[0][0]),
        "present_s": round(sum(b - a for a, b in present)),
        "setup_jogs": sst.get("setup_jogs"),
        "stock": [{"class": p["class"], "typical_n": p["typical_n"], "why": p["why"]}
                  for p in cv.get("stock", [])],
        "video": {"frames": tot.get("frames_processed"), "seconds": tot.get("seconds"),
                  "signal_hz": cv.get("signal_hz"), "overlay_hz": cv.get("overlay_hz")},
    }

    out = {
        **layout,
        "stations": stations,
        "events": {
            "s_press_1": {
                "operator_present_s": present,
                "operator_absent_s": absent,
                "die_change_s": die,
                "forklift_visits_s": visits,
                "coverage_s": coverage,
                "measured": measured,
                "provenance": {
                    "presence": (f"{raw_runs} raw detector runs merged to "
                                 f"{len(present)} intervals (gaps <= {MIN_GAP}s bridged, "
                                 f"runs < {MIN_RUN}s dropped) — the detector drops the box "
                                 f"for a frame or two constantly and the raw runs are "
                                 f"flicker, not trips away from the press"),
                    "operator_position": ("PRESENCE ONLY. The detector box is image-space "
                                          "pixels from a camera with no known extrinsics, "
                                          "so it is never projected to floor coordinates. "
                                          "Any movement shown at the post is inferred."),
                    "forklift": (f"{len(fk_raw)} sightings paired into {len(visits)} visits "
                                 f"— the detector logs one on the way in and one on the "
                                 f"way out"),
                },
                "source": "cv.json — frames[].w, die_changes[], stroke_stats",
            }
        },
        "legend": {
            "instrumented": sum(1 for s in stations if s["instrumented"]),
            "total": len(stations),
            "text": (f"{sum(1 for s in stations if s['instrumented'])} of {len(stations)} "
                     f"stations instrumented — the rest show simulated state"),
        },
    }
    write_json("floor.json", out)
    print(f"  {len(stations)} stations · {sum(1 for s in stations if s['instrumented'])} instrumented")
    print(f"  operator present: {len(present)} intervals ({raw_runs} raw runs) · "
          f"absent >60s: {len(absent)} · die change: {len(die)} · "
          f"forklift: {len(visits)} visits (from {len(fk_raw)} sightings)")
    if absent:
        big = max(absent, key=lambda x: x[1] - x[0])
        print(f"  longest absence: {round(big[1]-big[0])}s from "
              f"{int(big[0])//3600:02d}:{int(big[0])%3600//60:02d}:{int(big[0])%60:02d}")
    print(f"  measured: {measured['strokes']} strokes · {measured['running_spm']} spm · "
          f"{measured['dwell_pct']}% dwell · {measured['no_signal_s']}s no signal")


if __name__ == "__main__":
    main()
