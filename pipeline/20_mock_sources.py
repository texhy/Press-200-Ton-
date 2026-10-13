#!/usr/bin/env python3
"""PLC + VFD, SIMULATED — but derived FROM the camera's real stroke cadence.

Why not random: if the PLC is mocked independently it disagrees with the camera
at random, the reason engine produces nonsense, and the demo falls apart. So:

  1. the camera's real stroke timestamps become the PLC stroke counter
  2. the camera's real die-change episodes become INCH mode + MOTOR STOP
  3. real gaps in the camera's cadence get scripted causes assigned to them,
     so every injected alarm lands where the footage genuinely shows a stop
  4. operator absence is written to the camera channel ONLY — the PLC stays
     blind to it, because that is the point the demo has to make

Outside the 53-minute camera window the day is synthesised with a seeded RNG.
Every value this file produces is marked trust="simulated" downstream.
"""
from __future__ import annotations
import json, random
from pathlib import Path
from _common import (OUT, CAM_START_MIN, SHIFT, JOB, VFD_FAULTS, write_json)

RNG = random.Random(20261008)          # seeded: the day is the same every build

# Causes handed to real camera gaps, in the order the gaps appear. Each carries
# the PLC bit that must fire for the reason engine to find it.
SCRIPT = [
    ("feed_jam",    "MISFEED",  "high"),
    ("changeover",  None,       "certain"),
    ("lubrication", "OIL",      "high"),
    ("micro_stop",  None,       "high"),
    ("overload",    "OVERLOAD", "certain"),
    ("material",    None,       "high"),
    ("unexplained", None,       "none"),
    ("air",         "AIR",      "high"),
]


def minute_of(video_s: float) -> int:
    return CAM_START_MIN + int(video_s // 60)


def load_cv():
    """Read the COMPACT cv.json (short keys), not the raw monitor output."""
    from _common import DATA
    cv = json.load(open(DATA / "cv.json"))
    strokes = []
    if (OUT / "strokes_raw.json").exists():
        strokes = json.load(open(OUT / "strokes_raw.json"))
    return cv, cv["frames"], strokes


def find_cadence_gaps(strokes, min_gap=25.0):
    """Real silences in the camera's stroke cadence — the spine of the mock."""
    gaps = []
    for a, b in zip(strokes, strokes[1:]):
        d = b["t"] - a["t"]
        if d >= min_gap:
            gaps.append({"t0": a["t"], "t1": b["t"], "dur": round(d, 1)})
    return gaps


def main():
    d, frames, strokes = load_cv()
    fps = d.get("fps", 25.0)
    cam_end_min = CAM_START_MIN + int((frames[-1]["t"] if frames else 0) // 60) + 1
    print(f"camera window: minute {CAM_START_MIN}..{cam_end_min} "
          f"({len(frames)} cv samples, {len(strokes)} strokes)")

    # ---- per-second camera truth, indexed for the minute roll-up -----------
    by_min_cv: dict[int, dict] = {}
    for r in frames:
        m = minute_of(r["t"])
        b = by_min_cv.setdefault(m, {"n": 0, "present": 0, "working": 0, "dc": 0,
                                     "si": None, "so": None, "parts": {}, "c": 0})
        b["n"] += 1
        if r["w"]:
            b["present"] += 1
            if r["op"] or r["ps"] in (1, 3):
                b["working"] += 1
        b["dc"] += r["dc"]
        b["si"], b["so"], b["c"] = r["si"], r["so"], r["c"]
        for det in r["d"]:
            b["parts"][det[0]] = b["parts"].get(det[0], 0) + 1

    # The per-frame die_change flag only latches once the plate change is
    # CONFIRMED, so it misses the first several minutes of the episode. The
    # episode record knows the true span — use it for the minute spine.
    dc_span_min: set[int] = set()
    for ep in d.get("die_changes", []):
        if not ep.get("end_s"):
            continue
        a = minute_of(ep["start_s"]); b = minute_of(ep["end_s"])
        dc_span_min.update(range(a, b + 1))
    if dc_span_min:
        print(f"die-change episode spans minutes {min(dc_span_min)}..{max(dc_span_min)} "
              f"({len(dc_span_min)} min)")

    cv_strokes_per_min: dict[int, int] = {}
    for s in strokes:
        cv_strokes_per_min[minute_of(s["t"])] = cv_strokes_per_min.get(minute_of(s["t"]), 0) + 1

    # The envelope the SIMULATED minutes resample from, taken from the measured
    # station's own per-minute stroke counts.
    #
    # This block used to be `RNG.randint(7, 9)` — a hardcoded ~8 spm, while the
    # camera measures 5.36. The whole point of deriving the mock from CV truth
    # is that the two cannot disagree, and a simulated day running 50% faster
    # than the only station anyone measured is the disagreement that matters
    # most: it quietly inflated OEE performance to 91%.
    #
    # Resampling the measured per-MINUTE counts was the obvious move and it was
    # wrong: a run that starts at 09:34:48 puts one stroke in minute 09:34, so
    # the measured buckets run 1-6 and their mean (4.1) is an artefact of where
    # minute boundaries fell, not a rate. It read as 50% performance.
    #
    # So resample the measured PERIOD between counted strokes instead, and fill
    # each simulated minute by drawing periods until 60 s is used up. That
    # reproduces the real cadence (11.20 s median = 5.36 spm) and its real
    # spread, and boundary effects fall out of it the same way they do in the
    # measured data.
    cadence = sorted(s["period"] for s in strokes
                     if s.get("period") and 0 < s["period"] < 60)
    if not cadence:
        cadence = [JOB["takt_sec"]]
    print(f"simulated cadence resamples {len(cadence)} measured stroke periods: "
          f"{cadence[0]:.2f}-{cadence[-1]:.2f}s, median "
          f"{cadence[len(cadence)//2]:.2f}s = {60/cadence[len(cadence)//2]:.2f} spm")

    def minute_strokes() -> int:
        """Strokes in one simulated production minute, from measured periods."""
        # A stroke happens at the START of each period, so count first and then
        # advance. Advancing first and counting after discards the last stroke
        # of every minute and biases the rate down by a whole stroke (5.36 spm
        # came out as 4.5).
        used, n = 0.0, 0
        while used < 60.0:
            n += 1
            used += RNG.choice(cadence)
        return n

    # ---- assign scripted causes to REAL camera gaps ------------------------
    gaps = find_cadence_gaps(strokes)

    # The die change is ONE event, and the stroke signal goes quiet four
    # separate times inside it (the setter inches the slide, stops, inches
    # again). Scripting each silence separately produced "feed jam" at 09:12
    # followed by three changeovers — four causes for one job, and a feed jam
    # during a die change is incoherent on its face. So: every cadence gap that
    # overlaps the episode collapses into a single changeover spanning the
    # episode, and the script only runs on the gaps outside it.
    #
    # The per-frame `dc` flag cannot be the test here: it latches only once the
    # plate change is CONFIRMED (509.2 s on this run), which is 8 minutes after
    # the episode actually starts. dc_span_min comes from the episode record and
    # knows the true span.
    ep_gaps = [g for g in gaps
               if dc_span_min & set(range(minute_of(g["t0"]), minute_of(g["t1"]) + 1))]
    scripted = []
    if ep_gaps:
        scripted.append({
            "t0": ep_gaps[0]["t0"], "t1": ep_gaps[-1]["t1"],
            "dur": round(ep_gaps[-1]["t1"] - ep_gaps[0]["t0"], 1),
            "m0": min(dc_span_min), "m1": max(dc_span_min),
            "cause": "changeover", "bit": None, "conf": "certain",
            "merged_silences": len(ep_gaps),
        })
    si = 0
    for g in gaps:
        if g in ep_gaps:
            continue
        m0, m1 = minute_of(g["t0"]), minute_of(g["t1"])
        cause, bit, conf = SCRIPT[si % len(SCRIPT)]
        if cause == "changeover":          # the only real one is the measured episode
            si += 1
            cause, bit, conf = SCRIPT[si % len(SCRIPT)]
        si += 1
        scripted.append({**g, "m0": m0, "m1": m1, "cause": cause, "bit": bit, "conf": conf})
    scripted.sort(key=lambda x: x["t0"])
    print(f"real cadence gaps >=25 s inside the camera window: {len(scripted)}")
    for s in scripted[:12]:
        print(f"   {s['t0']:7.1f}s +{s['dur']:6.1f}s  -> {s['cause']}"
              + (f"  (inject {s['bit']})" if s["bit"] else "")
              + (f"  [{s['merged_silences']} silences merged]" if s.get("merged_silences") else ""))

    bit_minutes: dict[int, list[str]] = {}
    for s in scripted:
        if s["bit"]:
            bit_minutes.setdefault(s["m0"], []).append(s["bit"])
            if s["cause"] in ("feed_jam", "overload"):
                bit_minutes.setdefault(min(s["m1"], s["m0"] + 1), []).append("RESET")

    gap_min = {}
    for s in scripted:
        for m in range(s["m0"], s["m1"] + 1):
            gap_min[m] = s

    # ---- lay out the simulated part of the day as EPISODES ----------------
    # Built once up front so every minute outside the camera window belongs to a
    # named run with a plausible duration, giving the Pareto real shape.
    sim_plan: dict[int, tuple] = {}

    def lay(m0, length, kind):
        for mm in range(m0, min(m0 + length, 1440)):
            sim_plan[mm] = kind

    m = SHIFT["m0"]
    while m < SHIFT["m1"]:
        if any(a <= m < b for a, b in SHIFT["breaks"]):
            m += 1
            continue
        roll = RNG.random()
        if roll < 0.56:
            n = RNG.randint(18, 55); lay(m, n, ("prod", []))
        elif roll < 0.68:
            n = RNG.randint(3, 9);   lay(m, n, ("pause", []))
        elif roll < 0.78:
            n = RNG.randint(22, 46); lay(m, n, ("tryout", []))
        elif roll < 0.86:
            n = RNG.randint(6, 18);  lay(m, n, ("lifter", []))
        elif roll < 0.93:
            n = RNG.randint(8, 26);  lay(m, n, ("breakdown", ["OVERLOAD"] if RNG.random() < 0.4 else []))
        elif roll < 0.97:
            n = RNG.randint(2, 6);   lay(m, n, ("jam", ["MISFEED", "RESET"]))
        else:
            n = RNG.randint(21, 34); lay(m, n, ("unexplained", []))
        m += n

    # The triage queue must have something in it — the escalation path is a
    # headline feature. Placed deterministically in a break-free window so it
    # cannot be truncated or absorbed by a scheduled break.
    lay(13 * 60 + 10, 26, ("unexplained", []))

    def sim_episode(mm):
        if mm < SHIFT["m0"] or mm >= SHIFT["m1"]:
            return 0, "OFF", 0, "Others", []
        if any(a <= mm < b for a, b in SHIFT["breaks"]):
            return 0, "CONT", 1, "Break/Recess", []
        kind, bits_ = sim_plan.get(mm, ("prod", []))
        first = sim_plan.get(mm - 1) != sim_plan.get(mm)
        emit = list(bits_) if first else []
        if kind == "prod":
            return minute_strokes(), "CONT", 1, "Production", emit
        if kind == "pause":
            return 0, "CONT", 1, "Machine Pause", emit
        if kind == "tryout":
            return RNG.randint(0, 1), "INCH", 1, "Die Try-out", emit
        if kind == "lifter":
            return 0, "CONT", 1, "Lifter", emit
        if kind == "breakdown":
            return 0, "OFF", 0, "Machine Breakdown", emit
        if kind == "jam":
            return 0, "CONT", 1, "Machine Pause", emit
        return 0, "OFF", 0, "Others", emit          # unexplained

    # ---- build the 1440-minute spine --------------------------------------
    minutes = []
    in_break = lambda m: any(a <= m < b for a, b in SHIFT["breaks"])
    cum_counter = 184_320                      # lifetime maintain counter seed

    for m in range(1440):
        cam = CAM_START_MIN <= m < cam_end_min
        cvb = by_min_cv.get(m)
        bits = list(bit_minutes.get(m, []))
        g = gap_min.get(m)

        if cam:
            # ---------- MEASURED minute: PLC mirrors the camera ------------
            s = cv_strokes_per_min.get(m, 0)
            dc = m in dc_span_min or bool(cvb and cvb["dc"] > cvb["n"] * 0.4)
            mode = "INCH" if dc else "CONT"
            motor = 0 if (dc or (g and g["cause"] in ("changeover", "overload", "unexplained"))) else 1
            # physical constraint: the slide cannot stroke with the motor off.
            # A camera minute that straddles the start of a changeover was
            # producing both signals at once; the strokes are the ground truth.
            if s > 0:
                motor = 1
            st = ("Die Try-out" if dc else
                  "Machine Breakdown" if (g and g["cause"] in ("overload", "drive_trip")) else
                  "Break/Recess" if in_break(m) else
                  "Lifter" if (g and g["cause"] == "material") else
                  "Machine Pause" if (g and s == 0) else "Production")
            present = round(100 * cvb["present"] / max(1, cvb["n"])) if cvb else None
            working = round(100 * cvb["working"] / max(1, cvb["n"])) if cvb else None
            part = max(cvb["parts"], key=cvb["parts"].get) if (cvb and cvb["parts"]) else None
            trust = "measured"
        else:
            # ---------- SIMULATED minute: EPISODES, not coin flips ---------
            # Independent per-minute rolls produce dozens of isolated 1-minute
            # gaps, which is noise rather than a shop floor. A real day is runs:
            # a 35-minute changeover, a 12-minute breakdown, then production.
            ep = sim_episode(m)
            s, mode, motor, st, eb = ep
            bits.extend(eb)
            present = working = part = None
            trust = "simulated"

        # ---------- VFD, driven by the stroke/load model -------------------
        if not motor:
            kw = amps = torque = hz = pf = dcbus = 0.0
        else:
            idle_kw = 2.9 + RNG.uniform(-0.15, 0.15)       # flywheel spinning, no work
            kw = round(idle_kw + 0.44 * s + RNG.uniform(-0.2, 0.2), 2)
            amps = round(kw * 1.72 + RNG.uniform(-0.4, 0.4), 1)
            torque = round(min(92, 18 + 5.6 * s + RNG.uniform(-4, 4)), 1) if s else round(RNG.uniform(7, 12), 1)
            hz = round(50.0 - 0.06 * s + RNG.uniform(-0.1, 0.1), 2)
            pf = round(0.72 + 0.016 * s + RNG.uniform(-0.02, 0.02), 3)
            dcbus = round(562 - 1.4 * s + RNG.uniform(-3, 3), 1)
        fault = 0
        if g and g["cause"] == "overload" and m == g["m0"]:
            fault = 4                                       # oL — overload
        if "OVERLOAD" in bits:
            torque = 99.0

        minutes.append({
            "m": m, "s": s, "mode": mode, "motor": motor, "bits": bits, "st": st,
            "kw": kw, "amps": amps, "torque": torque, "hz": hz, "pf": pf,
            "dcbus": dcbus, "fault": fault,
            "present": present, "working": working,
            "cvs": cv_strokes_per_min.get(m) if cam else None,
            "sin": cvb["si"] if cvb else None, "sout": cvb["so"] if cvb else None,
            "part": part, "stack": None,
            "die": int(m in dc_span_min or bool(cvb and cvb["dc"])) if cam else None,
            "spm": s, "trust": trust,
        })
        cum_counter += s

    out = {
        "date": "2026-10-08",
        "camera": {"start_min": CAM_START_MIN, "end_min": cam_end_min},
        "maintain_counter": cum_counter,
        "scripted_gaps": scripted,
        "minutes": minutes,
        "vfd_faults": VFD_FAULTS,
    }
    (OUT / "sources.json").write_text(json.dumps(out))
    tot = sum(x["s"] for x in minutes)
    cam_tot = sum(x["s"] for x in minutes if x["trust"] == "measured")
    print(f"spine: 1440 minutes · {tot} strokes total ({cam_tot} measured by camera)")
    print(f"  -> out/sources.json")


if __name__ == "__main__":
    main()
