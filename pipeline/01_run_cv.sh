#!/usr/bin/env bash
# Real CV pass over the full Press 200 recording.
# ROIs are pinned from the measured auto-calibration so the run is reproducible
# and skips the warm-up: machine_roi was derived as 74,12,231,231 (proc px).
#
# NOTE: --det-half is deliberately NOT passed. FP16 inference emits NaN boxes on
# this GPU (GTX 1650), and press_full_monitor2.py casts box coords to int
# without guarding, so the run dies with
#   ValueError: cannot convert float NaN to integer   (line 386)
# Measured on frames 33100-33400: 4 NaN boxes with --det-half, 0 without.
set -euo pipefail

# NOTE: you do NOT need to run this to see the app. The outputs it produces are
# already committed under web/public/data/, so `npm run dev` works on a fresh
# clone. This script only matters if you want to re-derive them from the video.
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# The recording. Pass it as $1, or set PRESS_VIDEO; see docs/DATA.md for where
# to get it — it is a release asset, not in the repo.
VIDEO="${1:-${PRESS_VIDEO:-$ROOT/web/public/videos/press200.mp4}}"
OUT="$ROOT/out"
# Whichever python has ultralytics + torch. Set PRESS_PY to point at a venv.
PY="${PRESS_PY:-$(command -v python3)}"
mkdir -p "$OUT"
cd "$ROOT/Press_work-main"
exec "$PY" press_full_monitor2.py \
  --video "$VIDEO" \
  --weights best.pt \
  --machine-roi "74,12,231,231" \
  --det-every 10 --yolo-every 3 --reid-every 25 \
  --json-every 5 \
  --overlay none \
  --json "$OUT/p200_full.json" \
  --csv  "$OUT/p200_events.csv" \
  --trace "$OUT/p200_trace.csv"
