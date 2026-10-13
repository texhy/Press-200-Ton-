#!/usr/bin/env bash
# Rebuild every data file the web app reads, in dependency order.
# Safe to run while 01_run_cv.sh is still going — the CV reader tolerates a
# partially written JSON and simply uses whatever is complete so far.
set -euo pipefail
cd "$(dirname "$0")"
for s in 10_cv_timeline 20_mock_sources 30_reason_engine 40_build_day 41_build_history 42_build_plan 43_build_floor; do
  echo "=== $s ==="
  python3 "$s.py"
done
echo
echo "done — web/public/data is up to date"
