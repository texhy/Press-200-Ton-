"""Shared helpers for the Press 200 pipeline."""
from __future__ import annotations
import json, math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out"
DATA = ROOT / "web" / "public" / "data"

# ---- the demo's fixed context ------------------------------------------------
MACHINE = "Press 200"
DATE = "2026-10-08"
TARIFF = 58.0                      # PKR per kWh
OPERATOR = {"name": "Zaheer Ahmed", "id": 1, "shift": "A"}

# The 53m20s recording (80,001 frames at 25 fps = 3200.0 s) is anchored inside
# a mocked shift, so it covers 09:12:00 -> 10:05:20. Camera-covered
# minutes are MEASURED; everything outside is grey, never zero.
CAM_START_MIN = 9 * 60 + 12        # 09:12
SHIFT = {"label": "Shift A", "m0": 6 * 60, "m1": 14 * 60 + 30,
         "breaks": [[9 * 60, 9 * 60 + 15], [12 * 60, 12 * 60 + 45]],
         "plan_min": 510}

JOB = {"part": "part_form_left", "process": "Form Left", "die": "D-204",
       "target": 3600, "takt_sec": 7}

# Rates. part_form_left is MEASURED: the complete run gives a median period of
# 11.20 s between counted strokes while running = 5.36 spm. Against the job's
# 7 s takt (8.57 spm) the press is at 63% of rate, which is the single most
# useful number on this dataset and must not be smoothed away.
#
# The other four parts are ESTIMATED. They keep their original rate ratios but
# are re-anchored on the measured one, so a plan built across parts stays
# internally consistent instead of mixing one real rate with four optimistic
# guesses. spm_trust says which is which, and the planner surfaces it.
MEASURED_SPM = 5.36

PARTS = [
    {"part": "part_draw",       "process": "Draw",       "die": "D-101", "achieved_spm": 4.9, "kwh_per_1000": 11.8, "spm_trust": "estimated"},
    {"part": "part_bend",       "process": "Bend",       "die": "D-150", "achieved_spm": 6.4, "kwh_per_1000": 9.6,  "spm_trust": "estimated"},
    {"part": "part_form_left",  "process": "Form Left",  "die": "D-204", "achieved_spm": 5.36, "kwh_per_1000": 12.4, "spm_trust": "measured"},
    {"part": "part_form_right", "process": "Form Right", "die": "D-205", "achieved_spm": 5.1, "kwh_per_1000": 12.6, "spm_trust": "estimated"},
    {"part": "part_collar",     "process": "Collar",     "die": "D-310", "achieved_spm": 6.9, "kwh_per_1000": 7.4,  "spm_trust": "estimated"},
]

# PLC tag map, straight off the tap sheet.
PLC_TAGS = {
    "TDC": "CIO 0.01", "BDC": "CIO 1.05", "MOTOR": "CIO 1.10",
    "INCH": "CIO 0.06", "SINGLE": "CIO 0.07", "CONT": "CIO 0.08",
    "START": "CIO 0.11", "CURTAIN": "CIO 0.09", "MISFEED": "CIO 0.05",
    "OIL": "CIO 1.02", "AIR": "CIO 1.01", "OVERLOAD": "CIO 0.03",
    "TOPSTOP": "CIO 1.04", "EJECTOR": "CIO 1.09", "RESET": "CIO 0.02",
}

# VFD-B fault codes we decode (0 = no fault).
VFD_FAULTS = {
    0: "none", 1: "oc — over-current", 2: "ov — over-voltage",
    3: "oH — heatsink overheat", 4: "oL — overload", 6: "ocA — accel over-current",
    9: "ocd — decel over-current", 11: "Lv — low voltage",
}


def read_monitor_json(path: Path) -> dict:
    """Parse press_full_monitor2's JSON **even while it is still being written**.

    The writer emits a header line, one record per line, then a footer. A run in
    progress therefore has no footer and is not valid JSON, so we parse line by
    line and simply stop at whatever the last complete record was. This keeps
    the whole pipeline usable against a partial run.
    """
    header, frames, events, summary = {}, [], [], {}
    with open(path) as fh:
        first = fh.readline().rstrip("\n")
        if first.endswith(', "frames": ['):
            header = json.loads(first[: -len(', "frames": [')] + "}")
        for line in fh:
            line = line.rstrip("\n")
            if not line:
                continue
            if line.startswith("]"):                      # the footer
                # The footer is:  ], "events": [...], "summary": {...}}
                # Stripping the leading "], " leaves a fragment that ALREADY
                # carries the document's final brace, so only the opening one
                # is added back. (Appending a second "}" here silently failed
                # the parse, which left complete=False and dropped the
                # die-change episodes.)
                try:
                    tail = json.loads("{" + line[1:].lstrip().lstrip(",").lstrip())
                    events, summary = tail.get("events", []), tail.get("summary", {})
                except Exception as e:
                    print(f"  ! footer parse failed: {e}")
                break
            if line.startswith(","):
                line = line[1:]
            try:
                frames.append(json.loads(line))
            except Exception:
                break                                      # truncated tail
    return {"header": header, "frames": frames, "events": events, "summary": summary,
            "complete": bool(summary)}


def ewma(xs, lam=0.2):
    out, prev = [], None
    for x in xs:
        prev = x if prev is None else lam * x + (1 - lam) * prev
        out.append(prev)
    return out


def linfit(ys):
    """Least-squares slope + R^2. Time-to-threshold is only honest where R^2>0.7."""
    n = len(ys)
    if n < 3:
        return 0.0, 0.0
    xs = list(range(n))
    mx, my = sum(xs) / n, sum(ys) / n
    sxx = sum((x - mx) ** 2 for x in xs)
    if sxx == 0:
        return 0.0, 0.0
    slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sxx
    ss_tot = sum((y - my) ** 2 for y in ys)
    if ss_tot == 0:
        return slope, 0.0
    ss_res = sum((y - (my + slope * (x - mx))) ** 2 for x, y in zip(xs, ys))
    return slope, max(0.0, 1 - ss_res / ss_tot)


def write_json(name: str, obj) -> Path:
    DATA.mkdir(parents=True, exist_ok=True)
    p = DATA / name
    with open(p, "w") as fh:
        json.dump(obj, fh, separators=(",", ":"))
    print(f"  -> {p.relative_to(ROOT)}  {p.stat().st_size / 1e6:.2f} MB")
    return p
