#!/usr/bin/env python3
"""Join the three sources on the minute spine -> web/public/data/day.json."""
from __future__ import annotations
import json
from _common import (OUT, DATA, MACHINE, DATE, TARIFF, OPERATOR, CAM_START_MIN,
                     SHIFT, JOB, write_json)

def main():
    src = json.load(open(OUT / "sources.json"))
    rea = json.load(open(OUT / "reasons.json"))
    cv = json.load(open(DATA / "cv.json"))
    strokes_raw = json.load(open(OUT / "strokes_raw.json")) if (OUT / "strokes_raw.json").exists() else []

    minutes = src["minutes"]
    cam0, cam1 = src["camera"]["start_min"], src["camera"]["end_min"]

    # ---- per-stroke table, moved onto the clock + joined to the VFD -------
    by_min = {m["m"]: m for m in minutes}
    strokes = []
    for s in strokes_raw:
        tod = (CAM_START_MIN * 60) + s["t"]
        mm = by_min.get(int(tod // 60), {})
        strokes.append({
            "i": s["i"], "t": round(tod, 2),
            "period": s["period"], "spm": s["spm"],
            "down_ms": s["down_ms"], "up_ms": s["up_ms"], "dwell_ms": s["dwell_ms"],
            "amps": mm.get("amps", 0), "torque": mm.get("torque", 0),
            "part": mm.get("part"),
        })

    # ---- blocks: runs of one machine status ------------------------------
    blocks, cur = [], None
    for mm in minutes:
        if SHIFT["m0"] > mm["m"] or mm["m"] >= SHIFT["m1"]:
            continue
        if cur and cur["st"] == mm["st"]:
            cur["m1"] = mm["m"]; cur["min"] += 1; cur["strokes"] += mm["s"]
        else:
            if cur: blocks.append(cur)
            cur = {"st": mm["st"], "m0": mm["m"], "m1": mm["m"], "min": 1, "strokes": mm["s"]}
    if cur: blocks.append(cur)

    shift_rows = [m for m in minutes if SHIFT["m0"] <= m["m"] < SHIFT["m1"]]
    total_strokes = sum(m["s"] for m in shift_rows)
    prod_min = sum(1 for m in shift_rows if m["s"] > 0)
    idle_min = sum(1 for m in shift_rows if m["s"] == 0 and m["motor"])
    dead_min = sum(1 for m in shift_rows if not m["motor"])
    kwh = sum(m["kw"] for m in shift_rows) / 60.0
    idle_kwh = sum(m["kw"] for m in shift_rows if m["s"] == 0 and m["motor"]) / 60.0
    # Scheduled breaks are PLANNED downtime — excluded from loss and from
    # availability, per OEE convention. They stay on the timeline as context.
    loss_gaps = [g for g in rea["gaps"] if g["cause"] != "break"]
    break_min = round(sum(g["cost"]["minutes"] for g in rea["gaps"] if g["cause"] == "break"), 1)
    down_min = round(sum(g["cost"]["minutes"] for g in loss_gaps), 1)
    unexp_min = round(sum(g["cost"]["minutes"] for g in loss_gaps if g["cause"] == "unexplained"), 1)

    plan_spm = 60.0 / JOB["takt_sec"]
    run_min = SHIFT["plan_min"] - break_min            # planned operating time
    availability = round(100 * (run_min - down_min) / max(1, run_min), 1)
    performance = round(100 * (total_strokes / max(1, prod_min)) / plan_spm, 1)

    cam_out = cv["totals"].get("sheet_out", 0)
    cam_in = cv["totals"].get("sheet_in", 0)
    # Asymmetric by measurement (3 IN vs 4 OUT observed) -> reconcile, never assert.
    parts_est = min(cam_in, cam_out)

    day = {
        "date": DATE, "machine": MACHINE, "real": False,
        "note": ("Camera channel is MEASURED from the 53-minute recording. "
                 "PLC and VFD channels are SIMULATED — derived from the camera's real "
                 "stroke cadence so the sources agree where they should. "
                 "Minutes outside the camera window are synthesised."),
        "shift": SHIFT, "job": JOB, "operator": OPERATOR,
        "camera": {
            "start_min": cam0, "end_min": cam1,
            "video_url": "/videos/press200.mp4",
            "fps": cv["fps"], "native": cv["native"],
            "anchor": "assumed",
            "anchor_note": ("Recording time was not preserved. Anchored at 09:12 so the "
                            "measured window sits inside the morning production block."),
            "complete": cv.get("complete", False),
        },
        "tariff_pkr_per_kwh": TARIFF,
        "totals": {
            "strokes": total_strokes,
            "camera_strokes": cv["totals"].get("strokes", 0),
            "production_min": prod_min, "idle_min": idle_min, "dead_min": dead_min,
            "downtime_min": down_min, "unexplained_min": unexp_min,
            "break_min": break_min,
            "kwh": round(kwh, 1), "idle_kwh": round(idle_kwh, 1),
            "pkr": round(kwh * TARIFF), "idle_pkr": round(idle_kwh * TARIFF),
            "kwh_per_1000": round(kwh / max(1, total_strokes) * 1000, 2),
            "pkr_per_stroke": round(kwh * TARIFF / max(1, total_strokes), 2),
            "maintain_counter": src["maintain_counter"],
            "sheet_in": cam_in, "sheet_out": cam_out, "parts_est": parts_est,
            "peak_kw": round(max((m["kw"] for m in shift_rows), default=0), 1),
            "avg_pf": round(sum(m["pf"] for m in shift_rows if m["pf"]) /
                            max(1, sum(1 for m in shift_rows if m["pf"])), 3),
        },
        "oee": {
            "availability": availability,
            "performance": min(performance, 140.0),
            "quality": None,
            "oee": round(availability * min(performance, 140.0) / 100, 1),
            "quality_source": ("No quality source exists in the PLC or the VFD. "
                               f"Camera sheet-OUT gives an estimate of {parts_est} parts "
                               "(IN/OUT counts are asymmetric). Enter manually to complete OEE."),
        },
        "minutes": minutes,
        "blocks": blocks,
        "gaps": rea["gaps"],
        "alarms": rea["alarms"],
        "strokes": strokes,
    }
    write_json("day.json", day)
    print(f"  OEE A {availability}%  P {min(performance,140.0)}%  Q none -> {day['oee']['oee']}%")
    print(f"  downtime {down_min} min (unexplained {unexp_min})  idle Rs {day['totals']['idle_pkr']}")


if __name__ == "__main__":
    main()
