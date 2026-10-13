from __future__ import annotations

import argparse
import time
from collections import deque
from pathlib import Path

import cv2
import numpy as np

from press_static_dot import prep_frame

WRIST_IDX = {"L": 9, "R": 10}


class StrokeCounter:

    def __init__(self, maxlen=200):
        self.mag = deque(maxlen=maxlen)
        self.state = "idle"
        self.down_count = 0
        self.up_count = 0

    def limit(self):
        if len(self.mag) < 20:
            return 1.0
        return max(0.05, float(np.percentile(self.mag, 95)))

    def push(self, v):
        if abs(v) > 1e-9:
            self.mag.append(abs(v))
        gate = self.limit() * 0.35
        if v > gate and self.state != "down":
            self.state = "down"
            self.down_count += 1
        elif v < -gate and self.state != "up":
            self.state = "up"
            self.up_count += 1

    @property
    def cycles(self):
        return min(self.down_count, self.up_count)


def derive_roi_from_heatmap(heatmap, percentile, blur_sigma, margin, w, h):
    """blur the motion-density heatmap, threshold, take the largest connected
    component's bounding box -- see press_worker_filter's auto-roi comment."""
    blur = cv2.GaussianBlur(heatmap, (0, 0), sigmaX=blur_sigma)
    nz = blur[blur > 0]
    if not nz.size:
        return None
    thr = np.percentile(nz, percentile)
    mask = (blur >= thr).astype(np.uint8)
    n_lbl, lbl, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if n_lbl <= 1:
        return None
    best = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    bx, by, bw, bh, _ = stats[best]
    x0, x1 = max(0, bx - margin), min(w, bx + bw + margin)
    y0, y1 = max(0, by - margin), min(h, by + bh + margin)
    return (int(x0), int(y0), int(x1 - x0), int(y1 - y0))


def parse_roi(s):
    x, y, w, h = (int(v) for v in s.split(","))
    return x, y, w, h


def scale_roi(roi, s):
    x, y, w, h = roi
    return (round(x * s), round(y * s), round(w * s), round(h * s))


def union_roi(a, b):
    if a is None:
        return b
    if b is None:
        return a
    x0, y0 = min(a[0], b[0]), min(a[1], b[1])
    x1, y1 = max(a[0] + a[2], b[0] + b[2]), max(a[1] + a[3], b[1] + b[3])
    return (x0, y0, x1 - x0, y1 - y0)


def point_in_roi(pt, roi, margin=0):
    x, y = pt
    rx, ry, rw, rh = roi
    return (rx - margin) <= x <= (rx + rw + margin) and (ry - margin) <= y <= (ry + rh + margin)


def dist_to_roi(pt, roi):
    """0 if pt is inside roi, else the Euclidean distance to its nearest edge.
    This is the actual "how close is this hand to the machine" number --
    the worker's hand should sit near 0 while working; a passerby's should
    read as a large, non-shrinking number."""
    x, y = pt
    rx, ry, rw, rh = roi
    dx = max(rx - x, 0.0, x - (rx + rw))
    dy = max(ry - y, 0.0, y - (ry + rh))
    return float((dx * dx + dy * dy) ** 0.5)


def people_wrists(result, kp_conf):
    """all detected people this frame -> list of dict(tid, box, wrists={"L":pt/None,"R":pt/None})."""
    boxes = result.boxes
    if boxes is None or len(boxes) == 0 or result.keypoints is None or boxes.id is None:
        return []
    ids = boxes.id.cpu().numpy().astype(int)
    xyxy = boxes.xyxy.cpu().numpy()
    kp_xy = result.keypoints.xy.cpu().numpy()
    kp_conf_all = result.keypoints.conf
    kp_conf_all = kp_conf_all.cpu().numpy() if kp_conf_all is not None else np.ones(kp_xy.shape[:2])

    people = []
    for i, tid in enumerate(ids):
        wrists = {}
        for side, idx in WRIST_IDX.items():
            wrists[side] = tuple(kp_xy[i, idx]) if kp_conf_all[i, idx] >= kp_conf else None
        people.append({"tid": int(tid), "box": tuple(xyxy[i]), "wrists": wrists})
    return people


def parse_args():
    p = argparse.ArgumentParser(description="track people, keep only the one(s) actually working the machine")
    p.add_argument("--video", required=True)
    p.add_argument("--out", default=None)
    p.add_argument("--no-video", action="store_true")
    p.add_argument("--display", action="store_true")

    # motion detector -- same defaults as press_static_dot.py
    p.add_argument("--stride", type=int, default=1)
    p.add_argument("--proc-width", type=int, default=580)
    p.add_argument("--crop", type=float, default=1.0)
    p.add_argument("--max-corners", type=int, default=1200)
    p.add_argument("--quality", type=float, default=0.005)
    p.add_argument("--min-distance", type=int, default=4)
    p.add_argument("--thresh", type=float, default=0.3)
    p.add_argument("--lk-win", type=int, default=31)
    p.add_argument("--lk-levels", type=int, default=4)

    # YOLO pose + tracking
    p.add_argument("--yolo-model", default="yolov8n-pose.pt")
    p.add_argument("--yolo-conf", type=float, default=0.35)
    p.add_argument("--yolo-every", type=int, default=2, help="run YOLO pose+track every N processed frames "
                                                              "(kept low -- tracker IDs need regular updates)")
    p.add_argument("--kp-conf", type=float, default=0.5, help="min wrist-keypoint confidence to trust it")

    # hand ROI / motion confirmation (same as press_person_hands)
    p.add_argument("--hand-radius", type=int, default=30)

    # worker-vs-passerby zone + rolling window
    p.add_argument("--machine-roi", default=None, help="x,y,w,h in --proc-width pixel space. "
                                                        "Omit to auto-learn it from motion density + strokes.")
    p.add_argument("--stroke-roi", default=None, help="x,y,w,h in NATIVE SOURCE pixel space (same numbers as "
                                                       "ffmpeg's crop=W:H:X:Y -> x=X,y=Y,w=W,h=H) -- fixed region "
                                                       "to measure the press's own up-down motion in, cropped "
                                                       "live from the full-res frame (not downscaled to "
                                                       "--proc-width first -- that was starving the tracker of "
                                                       "the resolution it needs). Omit to auto-search it instead.")
    p.add_argument("--stroke-stride", type=int, default=4, help="k for the stroke-zone LK pair -- decoupled "
                                                                  "from --stride, matches press_up_down.py's "
                                                                  "usual tuning for catching a fast slide move")
    p.add_argument("--stroke-max-corners", type=int, default=800)
    p.add_argument("--stroke-quality", type=float, default=0.005)
    p.add_argument("--stroke-min-distance", type=int, default=2)
    p.add_argument("--stroke-thresh", type=float, default=0.25, help="per-frame px, matches press_up_down.py's "
                                                                       "usual tuning")
    p.add_argument("--zone-margin", type=int, default=15, help="grow machine-roi by this many px for the "
                                                                "hand-in-zone test (a hand right at the edge "
                                                                "still counts)")
    p.add_argument("--hand-reach-dist", type=int, default=120, help="proc-width px. During calibration a "
                                                                     "trusted wrist within this distance of the "
                                                                     "stroke zone feeds the hand working-envelope "
                                                                     "heatmap. 0 disables it (magenta box reverts "
                                                                     "to machine-only).")
    p.add_argument("--hand-splat-radius", type=int, default=12, help="radius (proc px) of the filled disc added "
                                                                      "to the hand heatmap per near-machine wrist "
                                                                      "sample")
    p.add_argument("--hand-roi-percentile", type=float, default=75.0, help="density percentile defining the "
                                                                            "hand working envelope (lower than "
                                                                            "--auto-roi-percentile: the hand "
                                                                            "signal is sparser)")
    p.add_argument("--work-dist", type=int, default=140, help="proc px. Post-calibration a person is only "
                                                               "eligible to be WORKER if their rolling median "
                                                               "closest-wrist distance to the machine stroke "
                                                               "zone is within this. Generous by design.")
    p.add_argument("--auto-roi-recompute-sec", type=float, default=2.0, help="how often the candidate zone "
                                                                              "is refreshed from the heatmap "
                                                                              "while calibrating")
    p.add_argument("--auto-roi-max-sec", type=float, default=0.0, help="safety cap on calibration time (0 = "
                                                                        "unlimited -- keep calibrating until "
                                                                        "--min-strokes is actually observed)")
    p.add_argument("--min-strokes", type=int, default=3, help="confirmed up-down cycles inside the stroke "
                                                                "zone required to end calibration")
    p.add_argument("--auto-roi-percentile", type=float, default=85.0, help="motion-density percentile that "
                                                                            "defines the candidate zone")
    p.add_argument("--auto-roi-blur-sigma", type=float, default=18.0, help="Gaussian blur applied to the "
                                                                            "motion heatmap before thresholding "
                                                                            "-- turns jittery per-pixel counts "
                                                                            "into a smooth density so the real "
                                                                            "hot spot beats scattered noise")
    p.add_argument("--auto-roi-margin", type=int, default=20, help="padding (px) around the candidate zone")
    p.add_argument("--window-sec", type=float, default=3.0, help="rolling window used to score each person")
    p.add_argument("--min-samples", type=int, default=15, help="tracked samples needed before scoring a person")
    p.add_argument("--worker-frac", type=float, default=0.30, help="fraction of the window with a hand active "
                                                                    "in the zone needed to call someone a WORKER")
    p.add_argument("--track-timeout", type=int, default=60, help="drop a person's history after this many "
                                                                   "processed frames without seeing them again")

    p.add_argument("--max-frames", type=int, default=0)
    return p.parse_args()


def main():
    args = parse_args()
    from ultralytics import YOLO

    vpath = Path(args.video)
    if not vpath.exists():
        raise FileNotFoundError(vpath)
    cap = cv2.VideoCapture(str(vpath))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open {vpath}")
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    native_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    # scale from NATIVE source pixels -> the --proc-width space the rest of the file works in.
    # The stroke crop is read from the native-res frame directly (see below) so --stroke-roi is
    # given in native pixels too -- same numbers you'd hand ffmpeg's crop=W:H:X:Y, no rescaling
    # needed. downscaling to --proc-width FIRST and cropping a small box out of that starved the
    # stroke tracker of resolution -- a physically-large stroke shrank to only a few px of motion.
    scale_to_proc = (args.proc_width / native_w) if (args.proc_width and native_w > args.proc_width) else 1.0
    out_path = args.out or f"{vpath.stem}_worker.mp4"
    machine_roi = parse_roi(args.machine_roi) if args.machine_roi else None
    calibrating = machine_roi is None
    stroke_zone_native = parse_roi(args.stroke_roi) if args.stroke_roi else None   # native source px
    stroke_zone = scale_roi(stroke_zone_native, scale_to_proc) if stroke_zone_native else None  # proc-space
    fixed_stroke_roi = stroke_zone is not None
    heatmap = None                    # every motion point anywhere -- machine AND any person
    hand_heatmap = None               # calibration-only: where trusted wrists were, near the machine
    hand_near_counts = {}             # tid -> near-machine wrist sample count during calibration
    machine_core = None               # stroke_zone frozen at calibration end -- the proximity-gate reference
    stroke_counter = StrokeCounter()
    recompute_frames = max(1, int(args.auto_roi_recompute_sec * src_fps))
    max_calib_frames = int(args.auto_roi_max_sec * src_fps) if args.auto_roi_max_sec > 0 else None
    stroke_roi_desc = stroke_zone_native if stroke_zone_native is not None else "auto-searched"
    print(f"video: {vpath.name}  stride={args.stride}  thresh={args.thresh}px/frame  "
          f"machine_roi={machine_roi if machine_roi else f'auto (stroke_roi={stroke_roi_desc} native, until {args.min_strokes} strokes seen)'}")

    model = YOLO(args.yolo_model)

    k = max(1, args.stride)
    base = 2 * k
    gray_buf, color_buf = deque(maxlen=base + 1), deque(maxlen=base + 1)
    lk = dict(winSize=(args.lk_win, args.lk_win), maxLevel=args.lk_levels,
              criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01))

    # filled-disc kernel splatted into hand_heatmap once per near-machine wrist sample
    _hr = max(1, args.hand_splat_radius)
    _yy, _xx = np.ogrid[-_hr:_hr + 1, -_hr:_hr + 1]
    splat_disc = ((_xx * _xx + _yy * _yy) <= _hr * _hr).astype(np.float32)

    # ---- stroke sub-pipeline: its own goodFeaturesToTrack + LK run ONLY on a crop of
    # stroke_zone, at its own stride -- exactly what press_up_down.py does on a
    # pre-cropped file. Filtering whole-frame corners down to a small zone starves it
    # (goodFeaturesToTrack spreads corners across the WHOLE frame, so a small zone gets
    # almost none); cropping first gives it the same dense, local corner set
    # press_up_down.py gets. Decoupled stride too -- --stroke-stride defaults to 4,
    # matching the baseline that's proven to catch this press's stroke speed.
    stroke_k = max(1, args.stroke_stride)
    stroke_base = 2 * stroke_k
    stroke_gray_buf = deque(maxlen=stroke_base + 1)
    stroke_zone_seen = None    # detects stroke_zone moving so the buffer can be reset
    stroke_vis_pts = []        # last frame's (local_x, local_y, moving) for the calibration overlay

    hist_len = max(args.min_samples, int(args.window_sec * src_fps))
    history = {}    # tid -> deque[bool]
    last_seen = {}  # tid -> det frame index
    last_dist = {}  # tid -> most recent min(wrist distance to machine_roi), px
    dist_hist = {}  # tid -> deque[float] (maxlen=hist_len): per-frame closest-wrist dist to machine_core
    last_people = []

    writer = None
    proc = det = movers = 0
    t0 = time.perf_counter()

    while True:
        ok, raw_frame = cap.read()
        if not ok:
            break

        # ---- stroke sub-pipeline: crop from the RAW, full-resolution frame (before the
        # --proc-width downscale below) -- runs every raw frame, independent of the main stride ----
        if calibrating and stroke_zone is not None:
            if not fixed_stroke_roi:   # auto-searched zone can move; keep its native version in sync
                stroke_zone_native = scale_roi(stroke_zone, 1.0 / scale_to_proc)
            if stroke_zone_native != stroke_zone_seen:
                stroke_gray_buf.clear()    # zone moved -- old crops don't line up any more
                stroke_zone_seen = stroke_zone_native
            rx, ry, rw, rh = stroke_zone_native
            rx, ry = max(0, rx), max(0, ry)
            rw, rh = max(1, min(rw, raw_frame.shape[1] - rx)), max(1, min(rh, raw_frame.shape[0] - ry))
            crop_gray = cv2.cvtColor(raw_frame[ry:ry + rh, rx:rx + rw], cv2.COLOR_BGR2GRAY)
            stroke_gray_buf.append(crop_gray)
            if len(stroke_gray_buf) == stroke_base + 1:
                f0s, f1s, f2s = stroke_gray_buf[0], stroke_gray_buf[stroke_k], stroke_gray_buf[stroke_base]
                c1s = cv2.goodFeaturesToTrack(f1s, maxCorners=args.stroke_max_corners,
                                              qualityLevel=args.stroke_quality,
                                              minDistance=args.stroke_min_distance)
                stroke_vis_pts = []
                if c1s is not None and len(c1s) >= 8:
                    p_back_s, s0s, _ = cv2.calcOpticalFlowPyrLK(f1s, f0s, c1s, None, **lk)
                    p_fwd_s, s2s, _ = cv2.calcOpticalFlowPyrLK(f1s, f2s, c1s, None, **lk)
                    sts = s0s.reshape(-1).astype(bool) & s2s.reshape(-1).astype(bool)
                    p0s, p1s, p2s = p_back_s.reshape(-1, 2)[sts], c1s.reshape(-1, 2)[sts], p_fwd_s.reshape(-1, 2)[sts]
                    if len(p1s) >= 1:
                        deltas = (p2s - p0s) / stroke_base
                        ress = np.linalg.norm(deltas, axis=1)
                        movs = ress > args.stroke_thresh
                        # scaled to proc-space for drawing on `vis`, which is proc-width sized
                        stroke_vis_pts = [(float(x) * scale_to_proc, float(y) * scale_to_proc, bool(mv))
                                          for (x, y), mv in zip(p1s, movs)]
                        if movs.any():
                            vy_zone = float(np.median(deltas[movs, 1]))   # native px/frame, like press_up_down.py
                            stroke_counter.push(vy_zone)

        frame = prep_frame(raw_frame, args.crop, args.proc_width)
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray_buf.append(gray)
        color_buf.append(frame)

        if len(gray_buf) == base + 1:
            f0, f1, f2 = gray_buf[0], gray_buf[k], gray_buf[base]
            vis = color_buf[k].copy()
            h, w = f1.shape

            # ---- press_static_dot motion test, unchanged ----
            c1 = cv2.goodFeaturesToTrack(f1, maxCorners=args.max_corners,
                                         qualityLevel=args.quality, minDistance=args.min_distance)
            p1, moving = np.empty((0, 2)), np.empty((0,), bool)
            delta = np.empty((0, 2))
            if c1 is not None and len(c1) >= 8:
                p_back, s0, _ = cv2.calcOpticalFlowPyrLK(f1, f0, c1, None, **lk)
                p_fwd, s2, _ = cv2.calcOpticalFlowPyrLK(f1, f2, c1, None, **lk)
                st = s0.reshape(-1).astype(bool) & s2.reshape(-1).astype(bool)
                p0, p1, p2 = p_back.reshape(-1, 2)[st], c1.reshape(-1, 2)[st], p_fwd.reshape(-1, 2)[st]
                if len(p1) >= 1:
                    delta = (p2 - p0) / base                 # signed velocity, same as press_up_down.py
                    residual = np.linalg.norm(delta, axis=1)
                    moving = residual > args.thresh
            n_move = int(moving.sum())
            move_idx = np.nonzero(moving)[0]
            moved_pts = p1[move_idx]

            # ---- YOLO pose + track, every N frames (moved ahead of calibration -- press_person_hands'
            # wrist-claiming is needed BEFORE the heatmap so it can tell hand motion apart from noise) ----
            if det % args.yolo_every == 0:
                res = model.track(vis, classes=[0], conf=args.yolo_conf, persist=True,
                                   tracker="bytetrack.yaml", verbose=False)[0]
                last_people = people_wrists(res, args.kp_conf)
            people = last_people

            # ---- claim each moving point for at most one (person, side) wrist -- same rule as
            # press_person_hands.py: nearest trusted wrist within --hand-radius, one point can't be
            # two different hands, and this claiming is what makes a point "hand motion" below ----
            r = args.hand_radius
            claim = {}  # (tid, side) -> list of point indices
            claimed = np.zeros(len(move_idx), bool)
            wrist_entries = [(pr["tid"], side, wpt) for pr in people for side, wpt in pr["wrists"].items()
                              if wpt is not None]
            if len(moved_pts) and wrist_entries:
                dists = np.stack([np.linalg.norm(moved_pts - np.array(wpt), axis=1) for _, _, wpt in wrist_entries])
                dists[dists > r] = np.inf
                for j in range(len(moved_pts)):
                    e = int(np.argmin(dists[:, j]))
                    if np.isfinite(dists[e, j]):
                        tid, side, _ = wrist_entries[e]
                        claim.setdefault((tid, side), []).append(move_idx[j])
                        claimed[j] = True
            claimed_global = {i for idxs in claim.values() for i in idxs}   # global point indices claimed as a hand

            # ---- auto-calibration: strokes confirm the machine, the heatmap defines the work zone ----
            if calibrating:
                # ONLY machine motion (inside stroke_zone) and HAND motion (claimed by a wrist just
                # above, press_person_hands' own rule) pile into this heatmap -- not every stray
                # moving point in the frame. Unfiltered, background flicker/unrelated equipment could
                # drag the derived work zone somewhere meaningless; restricting it to "the machine" and
                # "an actual hand" is what "use press_person_hands as well to define the overall
                # machine and worker area" means here.
                if heatmap is None:
                    heatmap = np.zeros((h, w), np.float32)
                for gi in move_idx:
                    x, y = p1[gi]
                    in_stroke = stroke_zone is not None and point_in_roi((x, y), stroke_zone)
                    if in_stroke or gi in claimed_global:
                        xi, yi = int(x), int(y)
                        if 0 <= yi < h and 0 <= xi < w:
                            heatmap[yi, xi] += 1.0

                # ---- hand working-envelope: where trusted wrists were, NEAR the machine, over the
                # whole stroke window. Not gated on motion (a hand hovering at the press between
                # strokes still counts); a filled disc so a sparse wrist track forms a connected
                # blob for derive_roi_from_heatmap. The densest region = the real worker's reach. ----
                if args.hand_reach_dist > 0 and stroke_zone is not None:
                    if hand_heatmap is None:
                        hand_heatmap = np.zeros((h, w), np.float32)
                    for pr in people:
                        for wpt in pr["wrists"].values():
                            if wpt is None or dist_to_roi(wpt, stroke_zone) > args.hand_reach_dist:
                                continue
                            wx, wy = int(round(wpt[0])), int(round(wpt[1]))
                            y0, y1 = max(0, wy - _hr), min(h, wy + _hr + 1)
                            x0, x1 = max(0, wx - _hr), min(w, wx + _hr + 1)
                            if y1 > y0 and x1 > x0:
                                ky, kx = y0 - (wy - _hr), x0 - (wx - _hr)
                                hand_heatmap[y0:y1, x0:x1] += splat_disc[ky:ky + (y1 - y0), kx:kx + (x1 - x0)]
                                hand_near_counts[pr["tid"]] = hand_near_counts.get(pr["tid"], 0) + 1

                # stroke_zone: fixed if --stroke-roi was given, else auto-searched from the same heatmap
                # (the actual stroke signal itself comes from the dedicated crop pipeline above, not
                # from filtering these whole-frame points -- see the comment by stroke_gray_buf)
                if not fixed_stroke_roi and (det % recompute_frames == 0 or stroke_zone is None):
                    stroke_zone = derive_roi_from_heatmap(heatmap, args.auto_roi_percentile,
                                                          args.auto_roi_blur_sigma, args.auto_roi_margin, w, h)

                timed_out = max_calib_frames is not None and det + 1 >= max_calib_frames
                if stroke_zone is not None and (stroke_counter.cycles >= args.min_strokes or timed_out):
                    # final envelope = machine motion + machine crop + the learned worker-hand
                    # working area (most-frequent near-machine wrist positions, x and y).
                    work_roi = derive_roi_from_heatmap(heatmap, args.auto_roi_percentile,
                                                       args.auto_roi_blur_sigma, args.auto_roi_margin, w, h)
                    hand_roi = (derive_roi_from_heatmap(hand_heatmap, args.hand_roi_percentile,
                                                        args.auto_roi_blur_sigma, args.auto_roi_margin, w, h)
                                if hand_heatmap is not None else None)
                    machine_roi = union_roi(union_roi(work_roi, stroke_zone), hand_roi)   # union_roi is None-safe
                    # clamp: the envelope may not reach past the stroke zone grown by hand_reach_dist+margin,
                    # so a passerby who reached in once during calibration can't inflate it unboundedly.
                    pad = args.hand_reach_dist + args.auto_roi_margin
                    sx, sy, sw, sh = stroke_zone
                    cx0, cy0 = max(0, sx - pad), max(0, sy - pad)
                    cx1, cy1 = min(w, sx + sw + pad), min(h, sy + sh + pad)
                    mx, my, mw, mh = machine_roi
                    nx0, ny0 = max(mx, cx0), max(my, cy0)
                    nx1, ny1 = min(mx + mw, cx1), min(my + mh, cy1)
                    machine_roi = (nx0, ny0, nx1 - nx0, ny1 - ny0)
                    machine_core = stroke_zone        # proximity-gate reference -- the tight machine crop
                    calibrating = False
                    reason = f"down={stroke_counter.down_count} up={stroke_counter.up_count} confirmed" if not timed_out else \
                        f"--auto-roi-max-sec reached with down={stroke_counter.down_count} up={stroke_counter.up_count} " \
                        f"(needed {args.min_strokes} each)"
                    near = dict(sorted(hand_near_counts.items(), key=lambda kv: -kv[1]))
                    print(f"auto-learned machine_roi={machine_roi} ({reason}, stroke_zone={stroke_zone}, "
                          f"hand_roi={hand_roi}, hand_near_counts={near}) "
                          f"(pass --machine-roi \"{machine_roi[0]},{machine_roi[1]},{machine_roi[2]},{machine_roi[3]}\" "
                          f"to reuse it without relearning)")

            # ---- per person: is a hand active AND close to the machine this frame? ----
            # (skipped while the zone is still auto-calibrating -- nothing to score against yet)
            if machine_roi is not None:
                for pr in people:
                    tid = pr["tid"]
                    active = False
                    wrist_dists = []
                    for side, wpt in pr["wrists"].items():
                        if wpt is None:
                            continue
                        d = dist_to_roi(wpt, machine_roi)
                        wrist_dists.append(d)
                        has_motion = len(claim.get((tid, side), [])) > 0
                        if has_motion and d <= args.zone_margin:
                            active = True
                    if wrist_dists:
                        last_dist[tid] = min(wrist_dists)   # closer hand wins -- that's the one doing the work
                    # measurement #1: closest-wrist distance to the tight machine crop (machine_core),
                    # NOT the wide envelope -- so an over-large envelope can't loosen the worker test.
                    if machine_core is not None:
                        core_dists = [dist_to_roi(wpt, machine_core) for wpt in pr["wrists"].values()
                                      if wpt is not None]
                        if core_dists:
                            dist_hist.setdefault(tid, deque(maxlen=hist_len)).append(min(core_dists))
                    last_seen[tid] = det
                    history.setdefault(tid, deque(maxlen=hist_len)).append(active)

                for tid in list(history):
                    if det - last_seen.get(tid, det) > args.track_timeout:
                        del history[tid]
                        last_seen.pop(tid, None)
                        last_dist.pop(tid, None)
                        dist_hist.pop(tid, None)

            def score(tid):
                hist = history.get(tid)
                if hist is None or len(hist) < args.min_samples:
                    return None
                return sum(hist) / len(hist)

            def median_core_dist(tid):
                dh = dist_hist.get(tid)
                return float(np.median(dh)) if dh else None

            def status(tid):
                if machine_roi is None:
                    return "calibrating", None
                s = score(tid)
                if s is None:
                    return "pending", None
                if s < args.worker_frac:
                    return "passerby", s
                wd = median_core_dist(tid)             # hard proximity gate (measurement #1)
                if wd is not None and wd > args.work_dist:
                    return "passerby", s
                return "worker", s

            per_point_status = {}  # move_idx position -> "worker"/"passerby"/"pending"
            for (tid, side), idxs in claim.items():
                stat, _ = status(tid)
                for gi in idxs:
                    per_point_status[gi] = stat

            # ---- draw whole-frame dots: every claimed hand point is yellow, regardless of
            # whose hand it is or their worker/passerby status -- "highlight the hands as
            # yellow". Worker-vs-passerby is shown on the box/label/ring instead. ----
            HAND_COLOR = (0, 255, 255)   # yellow
            for i, ((x, y), mv) in enumerate(zip(p1, moving)):
                if per_point_status.get(i) is not None:
                    cv2.circle(vis, (int(x), int(y)), 3, HAND_COLOR, -1)
                elif mv:
                    cv2.circle(vis, (int(x), int(y)), 2, (0, 0, 255), -1)
                else:
                    cv2.circle(vis, (int(x), int(y)), 2, (0, 180, 0), -1)

            if machine_roi is not None:
                # magenta box IS the learned envelope now: machine crop + machine motion +
                # the worker's most-frequent near-machine hand-reach area (x and y).
                mx, my, mw, mh = machine_roi
                cv2.rectangle(vis, (mx, my), (mx + mw, my + mh), (255, 0, 255), 2)
            elif stroke_zone is not None:
                sx, sy, sw, sh = stroke_zone
                cv2.rectangle(vis, (sx, sy), (sx + sw, sy + sh), (255, 200, 0), 1)
                for lx, ly, mv in stroke_vis_pts:   # the crop-local points actually feeding the stroke signal
                    cv2.circle(vis, (int(sx + lx), int(sy + ly)), 2, (0, 0, 255) if mv else (0, 180, 0), -1)

            n_worker = n_pass = 0
            BOX_COLOR = {"worker": (0, 255, 0), "passerby": (150, 150, 150),
                        "pending": (0, 255, 255), "calibrating": (255, 200, 0)}
            for pr in people:
                tid = pr["tid"]
                stat, sc = status(tid)
                if stat == "worker":
                    n_worker += 1
                elif stat == "passerby":
                    n_pass += 1
                box_color = BOX_COLOR[stat]
                x1, y1, x2, y2 = (int(v) for v in pr["box"])
                cv2.rectangle(vis, (x1, y1), (x2, y2), box_color, 2 if stat == "worker" else 1)
                label = f"id{tid} {stat}" + (f" {sc:.0%}" if sc is not None else "")
                if tid in last_dist:
                    label += f" d={last_dist[tid]:.0f}"     # closest hand -> envelope, this frame
                wd = median_core_dist(tid)                  # median closest hand -> machine crop, over window
                if wd is not None:
                    label += f" w={wd:.0f}"
                cv2.putText(vis, label, (x1, max(0, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, box_color, 2)
                for side, wpt in pr["wrists"].items():
                    if wpt is not None:
                        cv2.circle(vis, (int(wpt[0]), int(wpt[1])), 4, box_color, 1)

            if machine_roi is None:
                if stroke_zone is None:
                    status_txt = "learning machine zone: locating stroke region..."
                else:
                    status_txt = (f"learning machine zone: down {stroke_counter.down_count}  "
                                  f"up {stroke_counter.up_count}  (need {args.min_strokes} each)")
                cv2.putText(vis, status_txt, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (255, 200, 0), 2)
            else:
                cv2.putText(vis, f"moving points: {n_move}   workers: {n_worker}   passerby(filtered): {n_pass}",
                            (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 2)

            if not args.no_video:
                if writer is None:
                    hh, ww = vis.shape[:2]
                    writer = cv2.VideoWriter(out_path, cv2.VideoWriter_fourcc(*"mp4v"), src_fps, (ww, hh))
                writer.write(vis)
            if args.display:
                cv2.imshow("press_worker_filter -- green box=worker  gray=passerby  yellow dots=hands", vis)
                if (cv2.waitKey(1) & 0xFF) in (ord("q"), 27):
                    break
            det += 1; movers += n_move

        proc += 1
        if proc % 60 == 0:
            print(f"  {proc} frames  {proc / (time.perf_counter() - t0):4.1f} fps  "
                  f"avg moving pts/frame={movers / max(det, 1):.1f}")
        if args.max_frames and proc >= args.max_frames:
            break

    cap.release()
    if writer is not None:
        writer.release()
    if args.display:
        cv2.destroyAllWindows()
    print(f"\ndone: {proc} frames in {time.perf_counter() - t0:.1f}s")
    if not args.no_video:
        print(f"saved: {out_path}")


if __name__ == "__main__":
    main()
