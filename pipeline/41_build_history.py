#!/usr/bin/env python3
"""30-day report history + health trends.

Time-to-threshold is emitted ONLY where R^2 > 0.7. Below that the field is null
and the UI must print "insufficient trend" — a projection on a bad fit is how
you lose an engineer's trust permanently.
"""
from __future__ import annotations
import json, random
from datetime import date, timedelta
from _common import OUT, DATE, TARIFF, PARTS, SHIFT, ewma, linfit, write_json

RNG = random.Random(100626)


def main():
    day = json.load(open(OUT.parent / "web" / "public" / "data" / "day.json"))
    today = date.fromisoformat(DATE)
    pmap = {p["part"]: p for p in PARTS}
    rows, prev_part = [], None

    for k in range(29, -1, -1):
        d = today - timedelta(days=k)
        is_today = k == 0
        if is_today:
            t = day["totals"]
            rows.append({
                "date": d.isoformat(), "real": False,
                "part": day["job"]["part"], "process": day["job"]["process"],
                "operator": day["operator"]["name"],
                "target": day["job"]["target"], "produced": t["parts_est"],
                "strokes": t["strokes"],
                "efficiency": round(100 * t["strokes"] / max(1, day["job"]["target"])),
                "plan_min": SHIFT["plan_min"], "running_min": t["production_min"] + t["idle_min"],
                "production_min": t["production_min"], "idle_min": t["idle_min"],
                "downtime_min": t["downtime_min"], "unexplained_min": t["unexplained_min"],
                "kwh": t["kwh"], "idle_kwh": t["idle_kwh"], "pkr": t["pkr"],
                "oee": day["oee"]["oee"],
                "top_cause": max(day["gaps"], key=lambda g: g["cost"]["minutes"])["cause"] if day["gaps"] else "—",
                "top_cause_min": max((g["cost"]["minutes"] for g in day["gaps"]), default=0),
            })
            continue
        part = RNG.choice(list(pmap))
        p = pmap[part]
        # a slow mechanical drift over the month, so the health trends mean something
        drift = 1.0 + (29 - k) * 0.0042
        prod = RNG.randint(230, 300)
        strokes = round(prod * p["achieved_spm"] * RNG.uniform(0.92, 1.06))
        downtime = RNG.randint(45, 150)
        idle = RNG.randint(30, 110)
        kwh = round(strokes / 1000 * p["kwh_per_1000"] * drift, 1)
        idle_kwh = round(idle * 2.95 / 60, 1)
        rows.append({
            "date": d.isoformat(), "real": False,
            "part": part, "process": p["process"],
            "operator": RNG.choice(["Zaheer Ahmed", "Imran Shah", "Bilal Nawaz"]),
            "target": RNG.choice([1100, 1400, 1600]), "produced": round(strokes * 0.97),
            "strokes": strokes,
            "efficiency": RNG.randint(78, 118),
            "plan_min": SHIFT["plan_min"], "running_min": prod + idle,
            "production_min": prod, "idle_min": idle,
            "downtime_min": downtime, "unexplained_min": RNG.randint(0, 28),
            "kwh": kwh, "idle_kwh": idle_kwh, "pkr": round(kwh * TARIFF),
            "oee": round(RNG.uniform(52, 78), 1),
            "top_cause": RNG.choice(["feed_jam", "changeover", "lubrication", "micro_stop", "breakdown"]),
            "top_cause_min": RNG.randint(18, 70),
        })
        prev_part = part

    # ---- health indicators ------------------------------------------------
    def series(base, rate, noise, n=30):
        return [round(base + rate * i + RNG.uniform(-noise, noise), 3) for i in range(n)]

    # Which CHANNEL each indicator is derived from. They are not the same, and
    # the difference is the point: up-stroke time and load/unload dwell exist
    # ONLY because the camera resolves 40 ms — the HMI polls at ~200 ms and
    # cannot produce either. Torque, bus volts and flywheel recovery exist only
    # because the drive is on Modbus. A reader who cannot tell which is which
    # cannot tell what they would lose by dropping one of the two taps.
    SRC = {
        "up_stroke": "camera", "cycle_cv": "camera", "torque_peak": "vfd",
        "kwh_1000": "vfd", "flywheel": "vfd", "dcbus_min": "vfd", "dwell": "camera",
    }

    specs = [
        ("up_stroke", "Up-stroke time", "ms", series(400, 1.9, 2.2),
         {"A": 400, "B": 440, "C": 480}, "up-bad",
         "Rising up-stroke is the brake dragging. Camera-measured at 40 ms."),
        ("cycle_cv", "Cycle-time variance (CV)", "%", series(2.6, 0.035, 0.22),
         {"A": 3.0, "B": 4.5, "C": 6.0}, "up-bad",
         "Clutch/brake wear, or air pressure drop."),
        ("torque_peak", "Peak torque per stroke", "%", series(61, 0.21, 2.2),
         {"A": 68, "B": 78, "C": 88}, "up-bad",
         "Same part, same die — rising means the die is going blunt."),
        ("kwh_1000", "Energy per 1,000 strokes", "kWh", series(11.6, 0.031, 0.10),
         {"A": 12.4, "B": 13.5, "C": 14.6}, "up-bad",
         "General mechanical degradation. EWMA lambda 0.2."),
        ("flywheel", "Flywheel recovery time", "s", series(2.05, 0.011, 0.03),
         {"A": 2.3, "B": 2.7, "C": 3.1}, "up-bad",
         "Belt slip, motor, or bearing drag."),
        ("dcbus_min", "DC bus minimum", "V", series(548, -0.33, 3.1),
         {"A": 530, "B": 515, "C": 500}, "down-bad",
         "Incoming supply sagging."),
        ("dwell", "Load/unload dwell", "ms", series(880, 1.4, 22),
         {"A": 950, "B": 1050, "C": 1200}, "up-bad",
         "Operator pace across the shift. Camera-only — the PLC cannot see this."),
    ]

    health = []
    for key, label, unit, vals, bands, direction, note in specs:
        sm = ewma(vals, 0.2)
        slope, r2 = linfit(vals[-14:])
        cur, cure = vals[-1], sm[-1]
        # next boundary = the first threshold the EWMA has not yet crossed
        order = [bands["A"], bands["B"], bands["C"]]
        if direction == "up-bad":
            zone = "A" if cure < order[0] else "B" if cure < order[1] else "C" if cure < order[2] else "D"
            nb = next((b for b in order if b > cure), None)
            weeks = round((nb - cure) / (slope * 7), 1) if (nb and slope > 1e-6 and r2 > 0.7) else None
        else:
            zone = "A" if cure > order[0] else "B" if cure > order[1] else "C" if cure > order[2] else "D"
            nb = next((b for b in reversed(order) if b < cure), None)
            weeks = round((cure - nb) / (-slope * 7), 1) if (nb and slope < -1e-6 and r2 > 0.7) else None
        health.append({
            "key": key, "label": label, "unit": unit,
            "value": round(cur, 2), "ewma": round(cure, 2),
            "zone": zone, "bands": bands, "direction": direction,
            "spark": [round(v, 2) for v in vals],
            "r2": round(r2, 2),
            "weeks_to_boundary": weeks,
            "note": note,
            "source": SRC[key],
        })

    write_json("history.json", {
        "note": ("Today's row is built from the camera-measured window plus simulated "
                 "PLC/VFD. The other 29 days are simulated so the history and the "
                 "health trends can be exercised."),
        "real_dates": [], "rows": rows, "health": health,
        "thermal_limit": ("The VFD-B exposes no temperature register. Overheat (oH, code 3) "
                          "appears only as a fault that already happened, never as a trend. "
                          "Thermal trending needs an external sensor."),
    })
    print(f"  {len(rows)} days · {len(health)} health indicators")
    for h in health:
        w = h["weeks_to_boundary"]
        proj = "no projection (R2<=0.7)" if w is None else ("crossing now" if w < 0.3 else f"{w}w")
        print(f"   {h['label']:30s} zone {h['zone']}  R2 {h['r2']}  {proj}")


if __name__ == "__main__":
    main()
