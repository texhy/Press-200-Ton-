#!/usr/bin/env bash
# Download the two files that are too large for the git repo.
#
#   web/public/videos/press200.mp4   241 MB  — the recording the camera screens play
#   out/p200_full.json                65 MB  — the raw CV output, only needed to
#                                              re-run the pipeline
#
# Neither is required to BROWSE the app: every number on every screen is already
# in web/public/data/. Without the video you get nine working screens and an
# empty player on /camera and /timeline.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="${PRESS_REPO:-texhy/Press-200-Ton-}"
TAG="${PRESS_TAG:-assets-v1}"

mkdir -p "$ROOT/web/public/videos" "$ROOT/out"

have() { command -v "$1" >/dev/null 2>&1; }

get() {   # get <asset-name> <destination>
  local name="$1" dest="$2"
  if [ -f "$dest" ]; then echo "already have $(basename "$dest")"; return; fi
  echo "fetching $name ..."
  if have gh; then
    gh release download "$TAG" --repo "$REPO" --pattern "$name" --output "$dest" --clobber
  else
    curl -fL --progress-bar -o "$dest" \
      "https://github.com/$REPO/releases/download/$TAG/$name"
  fi
}

get press200.mp4   "$ROOT/web/public/videos/press200.mp4"
get p200_full.json "$ROOT/out/p200_full.json"

echo
echo "done:"
ls -lh "$ROOT/web/public/videos/press200.mp4" "$ROOT/out/p200_full.json" 2>/dev/null | awk '{printf "  %6s  %s\n", $5, $9}'
