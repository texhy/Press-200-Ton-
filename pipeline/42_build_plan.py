#!/usr/bin/env python3
"""Weekly planner board + the capacity model that gives it teeth."""
from __future__ import annotations
import json, random
from _common import PARTS, SHIFT, TARIFF, write_json

RNG = random.Random(4242)
DAYS = ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08",
        "2026-10-09", "2026-10-10", "2026-10-11"]
SHIFTS = ["A", "B"]
# median changeover minutes per die pair, from past runs
CHANGEOVER = {("D-101", "D-150"): 32, ("D-150", "D-204"): 38, ("D-204", "D-205"): 21,
              ("D-205", "D-310"): 44, ("D-310", "D-101"): 36, ("D-204", "D-150"): 37}


def main():
    pmap = {p["part"]: p for p in PARTS}
    cells, prev_die = [], None
    seq = ["part_bend", "part_form_left", "part_form_left", "part_form_left",
           "part_draw", "part_collar", "part_form_right",
           "part_bend", "part_collar", "part_draw", "part_form_left",
           "part_form_right", "part_collar", "part_bend"]
    i = 0
    for d in DAYS:
        for sh in SHIFTS:
            part = seq[i % len(seq)]; i += 1
            p = pmap[part]
            avail = SHIFT["plan_min"] - (40 if prev_die and prev_die != p["die"] else 0)
            # Quantities span both sides of capacity on purpose: a planner that
            # never says "no" is a calendar, not a planning tool.
            #
            # They are set as a FRACTION OF THE CELL'S OWN CAPACITY rather than
            # as absolute piece counts. Absolutes were hardcoded against the
            # old optimistic rates, so when the measured cadence came in at
            # 5.36 spm nine of fourteen cells went infeasible at once and the
            # board read as broken instead of informative. A ratio keeps the
            # intended mix whatever the rates do.
            load = RNG.choice([0.72, 0.78, 0.84, 0.88, 0.92, 0.95, 0.98, 1.07, 1.16])
            qty = int(round(p["achieved_spm"] * avail * load / 50.0) * 50)
            required = round(qty / avail, 2)
            achieved = p["achieved_spm"]
            feasible = required <= achieved
            short = max(0.0, round(100 * (required - achieved) / required, 1)) if required else 0.0
            co = CHANGEOVER.get((prev_die, p["die"]), 35) if prev_die and prev_die != p["die"] else 0
            kwh = round(qty / 1000 * p["kwh_per_1000"], 1)
            cells.append({
                "date": d, "shift": sh,
                "part": part, "process": p["process"], "die": p["die"],
                "qty": qty,
                "required_spm": required, "achieved_spm": achieved,
                "spm_trust": p.get("spm_trust", "estimated"),
                "planned_load_pct": round(100 * load),
                "feasible": feasible, "shortfall_pct": short,
                "overtime_min": 0 if feasible else round(qty / achieved - avail),
                "realistic_qty": qty if feasible else round(achieved * avail),
                "changeover_from": prev_die if co else None,
                "changeover_min": co,
                "energy_kwh": kwh, "energy_pkr": round(kwh * TARIFF),
                "operator": RNG.choice(["Zaheer Ahmed", "Imran Shah", "Bilal Nawaz"]),
            })
            prev_die = p["die"]

    write_json("plan.json", {
        "note": ("Plan is illustrative. achieved_spm is MEASURED for part_form_left "
                 "(5.36 spm, median of 70 timed strokes in the camera run) and "
                 "ESTIMATED for the other four, re-anchored on it — see spm_trust "
                 "on every cell."),
        "week_of": DAYS[0], "cells": cells, "parts": PARTS,
    })
    infeasible = [c for c in cells if not c["feasible"]]
    print(f"  {len(cells)} cells · {len(infeasible)} over capacity")


if __name__ == "__main__":
    main()
