#!/usr/bin/env python3
"""Every gap gets a cause, a confidence, and an ordered evidence chain.

THE RULE THAT MAKES IT DEFENSIBLE: the signal that fired FIRST is the cause;
everything after it is consequence. The evidence chain preserves that order, so
the argument is visible rather than asserted. A gap that matches no rule is
labelled "unexplained" and escalated — never quietly absorbed.
"""
from __future__ import annotations
import json
from _common import OUT, DATA, CAM_START_MIN, SHIFT, JOB, TARIFF, PLC_TAGS, VFD_FAULTS

BIT_CAUSE = {
    "OVERLOAD": ("overload", "Tonnage overload — stop and inspect the die", "certain"),
    "MISFEED":  ("feed_jam", "Feed jam", "high"),
    "CURTAIN":  ("operator_absent", "Light curtain broken — operator in the die", "high"),
    "OIL":      ("lubrication", "Lubrication stop", "high"),
    "AIR":      ("air", "Pneumatics / compressor", "high"),
}
IDLE_KW = 2.6          # motor spinning with nothing to show for it


def in_break(m):
    return any(a <= m < b for a, b in SHIFT["breaks"])


def find_gaps(minutes, cam0, cam1):
    """A gap is a run of in-shift minutes with no strokes.

    Runs are SPLIT whenever the machine status or the motor state changes, and
    whenever a scheduled break starts or ends. Merging blindly produces a single
    "gap" that contains a break AND an unexplained stop, which then classifies
    as whichever rule the merged evidence happens to hit — the break's motor-on
    swallowing a motor-off stop was exactly that bug.
    """
    gaps, run = [], None
    key = lambda r: (r["st"], r["motor"], in_break(r["m"]))
    for mm in minutes:
        m = mm["m"]
        if not (SHIFT["m0"] <= m < SHIFT["m1"]):
            continue
        if mm["s"] == 0:
            if run is None or key(run["rows"][-1]) != key(mm) or m != run["m1"] + 1:
                if run is not None:
                    gaps.append(run)
                run = {"m0": m, "m1": m, "rows": [mm]}
            else:
                run["m1"] = m
                run["rows"].append(mm)
        elif run is not None:
            gaps.append(run)
            run = None
    if run is not None:
        gaps.append(run)
    return [g for g in gaps if (g["m1"] - g["m0"] + 1) >= 1]


def classify(g, cv_by_min, dc_minutes, prev_part, next_part):
    rows = g["rows"]
    m0, m1 = g["m0"], g["m1"]
    dur_min = m1 - m0 + 1
    motor_on = any(r["motor"] for r in rows)
    bits_seen = [(r["m"], b) for r in rows for b in r["bits"]]
    faults = [(r["m"], r["fault"]) for r in rows if r["fault"]]
    cam = any(CAM_START_MIN <= r["m"] for r in rows) and any(r["trust"] == "measured" for r in rows)
    present = [r["present"] for r in rows if r["present"] is not None]
    die = any(r["die"] for r in rows if r["die"] is not None) or bool(dc_minutes & set(range(m0, m1 + 1)))
    ev = []

    def add(m, label, detail, kind, src, seek=None):
        ev.append({"t": m * 60, "label": label, "detail": detail,
                   "kind": kind, "src": src, **({"seek": seek} if seek is not None else {})})

    # ---- rule 1/2: a hard fault beats everything --------------------------
    if faults:
        fm, fc = faults[0]
        add(fm, "VFD fault", f"{VFD_FAULTS.get(fc, fc)} (2100H = {fc})", "cause", "vfd")
        add(fm, "Strokes stop", "production halted", "consequence", "plc")
        cause, label, conf = "drive_trip", f"Drive tripped — {VFD_FAULTS.get(fc, fc)}", "certain"
    elif any(b == "OVERLOAD" for _, b in bits_seen):
        bm = next(m for m, b in bits_seen if b == "OVERLOAD")
        add(bm, "OVERLOAD set", f"{PLC_TAGS['OVERLOAD']} — tonnage exceeded", "cause", "plc")
        add(bm, "Motor stopped", "press stopped on overload", "consequence", "plc")
        cause, label, conf = "overload", "Tonnage overload — stop and inspect the die", "certain"

    # ---- rule 7/8: changeover, planned or not -----------------------------
    elif die or (any(r["mode"] == "INCH" for r in rows) and dur_min >= 2):
        planned = prev_part and next_part and prev_part != next_part
        add(m0, "Cadence stops", "no production rhythm", "cause", "cv" if cam else "plc")
        if cam:
            add(m0, "Die zone activity", "camera: forklift-sized motion over the bolster",
                "consequence", "cv", seek=max(0, (m0 - CAM_START_MIN) * 60))
        add(m0, "Mode -> INCH", f"{PLC_TAGS['INCH']} — setup mode", "consequence", "plc")
        if planned:
            cause = "changeover"
            label = f"Planned changeover -> {next_part}"
            conf = "certain"
            add(m1, "Plan agrees", f"job changed {prev_part} -> {next_part}", "action", "plan")
        else:
            cause = "changeover"
            label = "Unplanned die pull — suspect die damage"
            conf = "medium"
            add(m1, "Plan disagrees", "same part before and after — not a planned changeover",
                "action", "plan")

    # ---- rules 3-6: the first alarm bit is the cause ----------------------
    elif bits_seen:
        bm, b = next(((m, b) for m, b in bits_seen if b in BIT_CAUSE), (None, None))
        if b:
            cause, label, conf = BIT_CAUSE[b]
            add(bm, f"{b} set", f"{PLC_TAGS.get(b, '')} — first signal", "cause", "plc")
            add(bm, "Strokes stop", "production halted", "consequence", "plc")
            if motor_on:
                kw = max((r["kw"] for r in rows), default=0)
                add(bm, "Motor still running", f"{kw:.1f} kW burning, nothing produced",
                    "consequence", "vfd")
            if cam and present and max(present) > 40:
                add(bm, "Operator at the die", "camera: operator entered the die zone",
                    "action", "cv", seek=max(0, (bm - CAM_START_MIN) * 60))
            if any(x == "RESET" for _, x in bits_seen):
                rm = next(m for m, x in bits_seen if x == "RESET")
                add(rm, "RESET pressed", f"{PLC_TAGS['RESET']} — operator acknowledged", "action", "plc")
        else:
            cause, label, conf = "micro_stop", "Micro-stop", "high"
            add(m0, "Strokes stop", "no bit, motor running", "cause", "plc")
    # ---- rule 11: scheduled break ----------------------------------------
    elif in_break(m0):
        cause, label, conf = "break", "Break", "certain"
        add(m0, "Scheduled break", f"{SHIFT['breaks']}", "cause", "plan")

    # ---- rule 10: camera says nobody was there ---------------------------
    elif cam and present and max(present) < 20:
        cause, label, conf = "operator_absent", "Operator away from the station", "medium"
        add(m0, "Station empty", "camera: no operator detected", "cause", "cv",
            seek=max(0, (m0 - CAM_START_MIN) * 60))
        add(m0, "PLC blind", "no bit fired — the controller cannot see this", "consequence", "plc")

    # ---- rule 12/13: motor on, nothing wrong, nothing produced -----------
    elif motor_on:
        kw = max((r["kw"] for r in rows), default=0)
        if dur_min >= 2 and kw >= IDLE_KW:
            cause, label, conf = "idle_burn", "Idle burn — motor on, nothing produced", "certain"
        else:
            cause, label, conf = "micro_stop", "Micro-stop", "high"
        add(m0, "Strokes stop", "no alarm bit set", "cause", "plc")
        add(m0, "Motor running", f"{kw:.1f} kW with zero output", "consequence", "vfd")

    # ---- rule 14: nothing explains it ------------------------------------
    else:
        if dur_min >= 20:
            cause, label, conf = "unexplained", "UNEXPLAINED — escalate", "none"
            add(m0, "Motor off", "no alarm, no mode change, no camera evidence", "cause", "plc")
            add(m0, "Nothing explains this", f"{dur_min} min unaccounted", "consequence", "plc")
        else:
            cause, label, conf = "micro_stop", "Micro-stop", "high"
            add(m0, "Strokes stop", "short stop, motor off", "cause", "plc")

    nxt = m1 + 1
    add(nxt, "Strokes resume", "production restarted", "resume", "plc")

    # ---- what it cost ----------------------------------------------------
    plan_spm = 60.0 / JOB["takt_sec"]
    kwh = sum(r["kw"] for r in rows) / 60.0
    cost = {
        "minutes": dur_min,
        "strokes": round(dur_min * plan_spm),
        "parts": round(dur_min * plan_spm),
        "pkr": round(kwh * TARIFF),
    }
    return {
        "id": f"g{m0:04d}",
        "m0": m0, "m1": m1, "t0": m0 * 60, "t1": (m1 + 1) * 60,
        "dur_s": dur_min * 60,
        "cause": cause, "confidence": conf, "label": label,
        "why": ev[0]["detail"] if ev else "",
        "evidence": ev, "cost": cost,
        "motor_on": motor_on, "camera": cam,
    }


BIT_LABEL = {"MISFEED": ("feed_jam", "Feed jam", "high"),
             "OIL": ("lubrication", "Lubrication stop", "high"),
             "AIR": ("air", "Pneumatics / compressor", "high"),
             "OVERLOAD": ("overload", "Tonnage overload — stop and inspect the die", "certain")}


def classify_cv_gap(g, i):
    """A gap seen by the CAMERA, at second resolution.

    The minute spine cannot carry these: a 30-second micro-stop never makes a
    zero-stroke minute, so a minute-resolution detector is blind to exactly the
    thing this product exists to show. The camera resolves 40 ms, so inside the
    covered window the stroke timestamps are the gap source.
    """
    cause, bit, conf = g["cause"], g.get("bit"), g["conf"]
    t0, t1 = CAM_START_MIN * 60 + g["t0"], CAM_START_MIN * 60 + g["t1"]
    dur = g["dur"]
    ev = []

    def add(t, label, detail, kind, source, seek=None):
        ev.append({"t": round(t, 1), "label": label, "detail": detail,
                   "kind": kind, "src": source, **({"seek": round(seek, 1)} if seek is not None else {})})

    add(t0, "Stroke cadence stops", f"camera: no stroke for {dur:.0f} s", "cause", "cv", seek=g["t0"])
    if bit and bit in BIT_LABEL:
        cause, label, conf = BIT_LABEL[bit]
        ev.insert(0, {"t": round(t0, 1), "label": f"{bit} set",
                      "detail": f"{PLC_TAGS.get(bit, '')} — first signal", "kind": "cause", "src": "plc"})
        ev[1]["kind"] = "consequence"
    elif cause == "changeover":
        label = "Changeover — die work at the bolster"
        add(t0 + 1, "Die zone active", "camera: motion over the bolster plate", "consequence", "cv", seek=g["t0"])
    elif cause == "material":
        label = "Material delivery"
        add(t0 + 1, "Forklift-sized motion", "camera: forklift at the press", "consequence", "cv", seek=g["t0"])
    elif cause == "operator_absent":
        label = "Operator away from the station"
    elif cause == "unexplained":
        label = "UNEXPLAINED — escalate"
        conf = "none"
    else:
        cause, label, conf = "micro_stop", f"Micro-stop — {dur:.0f} s the PLC counter hides", "high"

    add(t1, "Strokes resume", "cadence restarts", "resume", "cv", seek=g["t1"])
    plan_spm = 60.0 / JOB["takt_sec"]
    lost = dur / 60.0 * plan_spm
    return {
        "id": f"c{i:03d}",
        "m0": int(t0 // 60), "m1": int(t1 // 60),
        "t0": round(t0, 1), "t1": round(t1, 1), "dur_s": round(dur, 1),
        "cause": cause, "confidence": conf, "label": label,
        "why": ev[0]["detail"], "evidence": ev,
        "cost": {"minutes": round(dur / 60.0, 1), "strokes": round(lost),
                 "parts": round(lost), "pkr": round(dur / 3600.0 * 3.0 * TARIFF)},
        "motor_on": cause not in ("changeover", "overload"),
        "camera": True,
    }


def die_change_gap(ep, i):
    """A die change the CAMERA actually saw, with its own evidence.

    press_die_change2 reports a full episode — when the cadence died, when the
    bolster plate was seen to change, every forklift-sized movement, and how
    many jog strokes happened while it was open. That is a far better account
    of a changeover than inferring one from a silence in the stroke counter,
    so the episode wins over any cadence gap inside its span.
    """
    t0 = CAM_START_MIN * 60 + ep["start_s"]
    t1 = CAM_START_MIN * 60 + (ep.get("end_s") or ep["start_s"])
    dur = (ep.get("end_s") or ep["start_s"]) - ep["start_s"]
    ev = [{"t": round(t0, 1), "label": "Production cadence stops",
           "detail": "camera: strokes stop, press goes idle", "kind": "cause",
           "src": "cv", "seek": round(ep["start_s"], 1)}]
    if ep.get("flag_at_s"):
        ev.append({"t": round(CAM_START_MIN * 60 + ep["flag_at_s"], 1),
                   "label": "Bolster plate changed",
                   "detail": f"camera: the plate under the slide is visibly different "
                             f"({ep['trigger']})",
                   "kind": "consequence", "src": "cv", "seek": round(ep["flag_at_s"], 1)})
    for k, ft in enumerate(ep.get("forklift_times_s", [])[:4]):
        ev.append({"t": round(CAM_START_MIN * 60 + ft, 1), "label": "Forklift at the press",
                   "detail": "camera: forklift-sized motion over the bolster",
                   "kind": "action", "src": "cv", "seek": round(ft, 1)})
    if ep.get("strokes_while_open"):
        ev.append({"t": round(t0 + 1, 1), "label": "Jog strokes",
                   "detail": f"{ep['strokes_while_open']} strokes in setup mode — die try-out",
                   "kind": "action", "src": "cv"})
    ev.append({"t": round(t1, 1), "label": "Production resumes",
               "detail": "camera: cadence restarts on the new die", "kind": "resume",
               "src": "cv", "seek": round(ep.get("end_s") or 0, 1)})
    ev.sort(key=lambda e: (e["t"], 0 if e["kind"] == "cause" else 1))
    plan_spm = 60.0 / JOB["takt_sec"]
    return {
        "id": f"dc{i:02d}",
        "m0": int(t0 // 60), "m1": int(t1 // 60),
        "t0": round(t0, 1), "t1": round(t1, 1), "dur_s": round(dur, 1),
        "cause": "changeover", "confidence": "certain",
        "label": f"Die change — {dur / 60:.0f} min",
        "why": f"camera saw the bolster plate change ({ep['trigger']})",
        "evidence": ev,
        "cost": {"minutes": round(dur / 60.0, 1), "strokes": round(dur / 60.0 * plan_spm),
                 "parts": round(dur / 60.0 * plan_spm), "pkr": 0},
        "motor_on": False, "camera": True,
        "die_change": {"trigger": ep["trigger"],
                       "plate_changed_at_s": ep.get("plate_changed_at_s"),
                       "forklift_count": len(ep.get("forklift_times_s", [])),
                       "strokes_while_open": ep.get("strokes_while_open", 0)},
    }


def main():
    src = json.load(open(OUT / "sources.json"))
    minutes = src["minutes"]
    cam0, cam1 = src["camera"]["start_min"], src["camera"]["end_min"]
    dc_minutes = {m["m"] for m in minutes if m.get("die")}

    part_by_min = {m["m"]: m["part"] for m in minutes if m.get("part")}
    gaps_raw = find_gaps(minutes, cam0, cam1)
    gaps = []
    for g in gaps_raw:
        # inside the camera window the second-resolution pass owns the gaps
        if cam0 <= g["m0"] < cam1:
            continue
        before = [p for mm, p in part_by_min.items() if mm < g["m0"]]
        after = [p for mm, p in part_by_min.items() if mm > g["m1"]]
        gaps.append(classify(g, {}, dc_minutes,
                             before[-1] if before else None,
                             after[0] if after else None))

    # the die-change episodes the camera actually saw — these OWN their span
    cvt = json.load(open(DATA / "cv.json"))
    dc_eps = [die_change_gap(ep, i) for i, ep in enumerate(cvt.get("die_changes", []), 1)
              if ep.get("end_s")]
    def inside_episode(t0, t1):
        return any(d["t0"] - 1 <= t0 and t1 <= d["t1"] + 1 for d in dc_eps)

    # the camera's own gaps, at the resolution only it can give
    for i, cg in enumerate(src.get("scripted_gaps", []), 1):
        g = classify_cv_gap(cg, i)
        if inside_episode(g["t0"], g["t1"]):
            continue                      # the episode already explains this
        gaps.append(g)
    gaps.extend(dc_eps)
    gaps.sort(key=lambda x: x["t0"])

    alarms = []
    for mm in minutes:
        for b in mm["bits"]:
            sev = ("critical" if b == "OVERLOAD" else
                   "serious" if b in ("MISFEED", "CURTAIN") else
                   "warning" if b in ("OIL", "AIR") else "info")
            alarms.append({"id": f"a{mm['m']}_{b}", "t": mm["m"] * 60, "m": mm["m"],
                           "severity": sev, "tag": PLC_TAGS.get(b, b), "label": b.title(),
                           "detail": f"{b} on {PLC_TAGS.get(b, '-')}", "src": "plc"})
        if mm["fault"]:
            alarms.append({"id": f"a{mm['m']}_vfd", "t": mm["m"] * 60, "m": mm["m"],
                           "severity": "critical", "tag": "2100H",
                           "label": f"Drive fault {mm['fault']}",
                           "detail": VFD_FAULTS.get(mm["fault"], "?"), "src": "vfd"})

    by_cause = {}
    for g in gaps:
        c = by_cause.setdefault(g["cause"], {"minutes": 0, "n": 0, "pkr": 0})
        c["minutes"] += g["cost"]["minutes"]; c["n"] += 1; c["pkr"] += g["cost"]["pkr"]

    out = {"gaps": gaps, "alarms": alarms, "by_cause": by_cause}
    (OUT / "reasons.json").write_text(json.dumps(out))
    print(f"gaps classified: {len(gaps)}   alarms: {len(alarms)}")
    for c, v in sorted(by_cause.items(), key=lambda kv: -kv[1]["minutes"]):
        print(f"   {c:18s} {v['minutes']:6.1f} min  x{v['n']:<3d} Rs {v['pkr']}")
    unexp = [g for g in gaps if g["cause"] == "unexplained"]
    print(f"UNEXPLAINED needing triage: {len(unexp)}")
    print("  -> out/reasons.json")


if __name__ == "__main__":
    main()
