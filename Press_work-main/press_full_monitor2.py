from __future__ import annotations

import argparse
import csv
import json
import time
from collections import deque
from pathlib import Path

import cv2
import numpy as np

from press_up_down import prep_frame, SignalPlot
from press_worker_filter import (WRIST_IDX, derive_roi_from_heatmap, parse_roi, scale_roi, union_roi,
                                 point_in_roi, dist_to_roi, people_wrists)
from press_die_change2 import DieChangeDots, default_bolster
from press_worker_reid import WorkerEmbeddings


def parse_args():
    p = argparse.ArgumentParser(description="stroke graph + worker + sheet in/out + parts + die change (dots) in one pass")
    p.add_argument("--video", required=True)
    p.add_argument("--out", default=None, help="default <stem>_monitor.mp4 (video stacked over the graph)")
    p.add_argument("--no-video", action="store_true")
    p.add_argument("--display", action="store_true")
    p.add_argument("--overlay", choices=["none", "clean", "full"], default="clean",
                   help="what to draw on the saved/displayed video: none = no video at all, clean = worker box, "
                        "part boxes, SHEET IN/OUT banner, counters and the orange DIE CHANGE box, full = everything "
                        "incl. dots, zones, plate status and forklift flag")
    p.add_argument("--debug", action="store_true", help="same as --overlay full")
    p.add_argument("--no-graph", action="store_true", help="do not stack the stroke graph under the video")
    p.add_argument("--json", default=None, help="per-frame log (default <stem>_full.json)")
    p.add_argument("--json-every", type=int, default=1, help="write every Nth processed frame to the JSON "
                                                              "(events are always written)")
    p.add_argument("--weights", default="press_model/runs/detect/yolo11s/weights/best.pt",
                   help="trained part detector; '' disables it")
    p.add_argument("--det-every", type=int, default=5, help="run the part detector every N processed frames")
    p.add_argument("--det-imgsz", type=int, default=1280)
    p.add_argument("--det-conf", type=float, default=0.25)
    p.add_argument("--det-half", action="store_true", help="FP16 for the part detector")
    p.add_argument("--max-frames", type=int, default=0)

    p.add_argument("--bolster-roi", default=None, help="x,y,w,h native px of the base plate (default: under the slide)")
    p.add_argument("--dc-idle-sec", type=float, default=60.0, help="no production cadence for this long = idle")
    p.add_argument("--dc-jog-gap-sec", type=float, default=30.0)
    p.add_argument("--dc-cadence-n", type=int, default=3)
    p.add_argument("--dc-zone-margin", type=int, default=30)
    p.add_argument("--dc-zone-quiet-pts", type=int, default=3)
    p.add_argument("--dc-zone-memory-sec", type=float, default=4.0)
    p.add_argument("--dc-change-thr", type=float, default=0.45)
    p.add_argument("--dc-change-hold-sec", type=float, default=5.0)
    p.add_argument("--dc-big-frac", type=float, default=0.33)
    p.add_argument("--dc-big-pts", type=int, default=60)
    p.add_argument("--dc-big-sec", type=float, default=2.0)
    p.add_argument("--dc-min-sec", type=float, default=120.0)
    p.add_argument("--dc-merge-sec", type=float, default=300.0)
    p.add_argument("--no-die-change", action="store_true")

    p.add_argument("--proc-width", type=int, default=580)
    p.add_argument("--crop", type=float, default=1.0)
    p.add_argument("--stride", type=int, default=1)
    p.add_argument("--max-corners", type=int, default=1200)
    p.add_argument("--quality", type=float, default=0.005)
    p.add_argument("--min-distance", type=int, default=4)
    p.add_argument("--thresh", type=float, default=0.3)
    p.add_argument("--lk-win", type=int, default=31)
    p.add_argument("--lk-levels", type=int, default=4)

    p.add_argument("--stroke-roi", default="530,40,480,300", help="x,y,w,h NATIVE px of the slide "
                                                                   "(default = the 200-ton camera)")
    p.add_argument("--stroke-stride", type=int, default=1)
    p.add_argument("--stroke-max-corners", type=int, default=1200)
    p.add_argument("--stroke-quality", type=float, default=0.005)
    p.add_argument("--stroke-min-distance", type=int, default=4)
    p.add_argument("--stroke-thresh", type=float, default=0.3)
    p.add_argument("--stroke-min-move-pts", type=int, default=10, help="fewer movers in the slide crop = still")
    p.add_argument("--stroke-phase-frames", type=int, default=3, help="consecutive frames past the gate to confirm "
                                                                       "a rise / descent")
    p.add_argument("--min-stroke-gap", type=float, default=1.0, help="seconds; a 2nd stroke within this is ignored")
    p.add_argument("--press-still-vy", type=float, default=0.35)
    p.add_argument("--slide-quiet-pts", type=int, default=12)
    p.add_argument("--press-margin", type=int, default=6, help="moving dots within this of the slide box = PRESS")
    p.add_argument("--stroke-rise-vy", type=float, default=0.0, help="UP gate (native px/frame); 0 = auto")
    p.add_argument("--press-settle-sec", type=float, default=0.2)
    p.add_argument("--press-hold-sec", type=float, default=0.0, help="0 = window lasts until the next descent")

    p.add_argument("--plot-sec", type=float, default=120.0)
    p.add_argument("--plot-h", type=int, default=220)
    p.add_argument("--takt", type=float, default=0.0, help="planned seconds per stroke -> gridlines; 0 = none")

    p.add_argument("--yolo-model", default="yolov8n-pose.pt")
    p.add_argument("--yolo-conf", type=float, default=0.35)
    p.add_argument("--yolo-every", type=int, default=2)
    p.add_argument("--kp-conf", type=float, default=0.5)
    p.add_argument("--hand-radius", type=int, default=30)

    p.add_argument("--machine-roi", default=None, help="x,y,w,h proc px -- skip calibration")
    p.add_argument("--min-strokes", type=int, default=2)
    p.add_argument("--zone-margin", type=int, default=15)
    p.add_argument("--hand-reach-dist", type=int, default=120)
    p.add_argument("--hand-splat-radius", type=int, default=12)
    p.add_argument("--hand-roi-percentile", type=float, default=75.0)
    p.add_argument("--auto-roi-percentile", type=float, default=85.0)
    p.add_argument("--auto-roi-blur-sigma", type=float, default=18.0)
    p.add_argument("--auto-roi-margin", type=int, default=20)
    p.add_argument("--window-sec", type=float, default=10.0, help="rolling activity window per person")
    p.add_argument("--min-samples", type=int, default=15)
    p.add_argument("--worker-frac", type=float, default=0.30)
    p.add_argument("--work-dist", type=int, default=140, help="proximity gate: median closest-wrist distance to "
                                                               "the slide box must be within this")
    p.add_argument("--min-near-sec", type=float, default=5.0, help="duration gate: total seconds a wrist was within "
                                                                    "--work-dist before someone can be WORKER")
    p.add_argument("--track-timeout", type=int, default=60)
    p.add_argument("--no-reid", action="store_true", help="disable the appearance re-identification")
    p.add_argument("--reid-weights", default="yolo26n-reid.onnx", help="person re-ID network (ultralytics ReID)")
    p.add_argument("--reid-min", type=float, default=0.40, help="min cosine similarity to the operator gallery to "
                                                                 "accept a person as the operator")
    p.add_argument("--reid-margin", type=float, default=0.10, help="best match must beat the runner-up by this")
    p.add_argument("--reid-every", type=int, default=3, help="compute embeddings every N processed frames")

    p.add_argument("--sheet-radius", type=int, default=90)
    p.add_argument("--sheet-reach-dist", type=int, default=170)
    p.add_argument("--sheet-min-dots", type=int, default=4)
    p.add_argument("--sheet-rise-dots", type=int, default=3)
    p.add_argument("--baseline-sec", type=float, default=20.0)
    p.add_argument("--integrate-sec", type=float, default=0.6)
    p.add_argument("--move-px", type=float, default=6.0)
    p.add_argument("--min-carry-frac", type=float, default=0.33)
    p.add_argument("--wrist-weight", type=float, default=0.5)
    p.add_argument("--any-order", action="store_true", help="allow IN before OUT inside one press-up window")
    p.add_argument("--no-part-gate", action="store_true", help="do NOT require a detected part for a sheet event "
                                                                "(default: a part must have been detected within "
                                                                "--part-grace-sec, the last check before IN/OUT fires)")
    p.add_argument("--part-grace-sec", type=float, default=10.0, help="a part detection this recent counts as "
                                                                       "'part present' for the sheet-event gate")
    p.add_argument("--min-window-sec", type=float, default=1.0)
    p.add_argument("--csv", default=None, help="event log (default <stem>_events.csv)")
    p.add_argument("--trace", default=None, help="per-frame diagnostic CSV")
    return p.parse_args()


def nearest_roi_point(pt, roi):
    x, y = pt
    rx, ry, rw, rh = roi
    if rx <= x <= rx + rw and ry <= y <= ry + rh:
        return (rx + rw / 2.0, ry + rh / 2.0)
    return (min(max(x, rx), rx + rw), min(max(y, ry), ry + rh))


def _disc(radius):
    r = max(1, radius)
    yy, xx = np.ogrid[-r:r + 1, -r:r + 1]
    return ((xx * xx + yy * yy) <= r * r).astype(np.float32), r


def _splat(heat, x, y, disc, r, h, w):
    xi, yi = int(round(x)), int(round(y))
    y0, y1 = max(0, yi - r), min(h, yi + r + 1)
    x0, x1 = max(0, xi - r), min(w, xi + r + 1)
    if y1 <= y0 or x1 <= x0:
        return
    ky, kx = y0 - (yi - r), x0 - (xi - r)
    heat[y0:y1, x0:x1] += disc[ky:ky + (y1 - y0), kx:kx + (x1 - x0)]


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
    native_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    scale_to_proc = (args.proc_width / native_w) if (args.proc_width and native_w > args.proc_width) else 1.0
    proc_w = int(round(native_w * scale_to_proc))
    if args.debug:
        args.overlay = "full"
    args.clean = args.overlay == "clean"
    if args.overlay == "none":
        args.no_video = True
    out_path = args.out or f"{vpath.stem}_full2.mp4"
    csv_path = Path(args.csv) if args.csv else vpath.with_name(f"{vpath.stem}_events.csv")
    json_path = Path(args.json) if args.json else vpath.with_name(f"{vpath.stem}_full.json")

    stroke_native = parse_roi(args.stroke_roi) if args.stroke_roi else (0, 0, native_w, native_h)
    stroke_proc = scale_roi(stroke_native, scale_to_proc)
    machine_roi = parse_roi(args.machine_roi) if args.machine_roi else None
    calibrating = machine_roi is None
    machine_core = stroke_proc
    print(f"video: {vpath.name}  {native_w}x{native_h} @ {src_fps:.1f}fps  stroke-roi native={stroke_native} "
          f"proc={stroke_proc}  {'machine_roi given' if machine_roi else f'calibrating until {args.min_strokes} strokes'}")

    model = YOLO(args.yolo_model)
    dc = None
    if not args.no_die_change:
        bolster_native = parse_roi(args.bolster_roi) if args.bolster_roi else default_bolster(stroke_native)
        dc = DieChangeDots(src_fps, scale_roi(bolster_native, scale_to_proc), bolster_native, 1,
                           idle_sec=args.dc_idle_sec, jog_gap_sec=args.dc_jog_gap_sec, cadence_n=args.dc_cadence_n,
                           zone_margin=args.dc_zone_margin, zone_quiet_pts=args.dc_zone_quiet_pts,
                           zone_memory_sec=args.dc_zone_memory_sec, change_thr=args.dc_change_thr,
                           change_hold_sec=args.dc_change_hold_sec, big_frac=args.dc_big_frac, big_pts=args.dc_big_pts,
                           big_sec=args.dc_big_sec, min_sec=args.dc_min_sec, merge_sec=args.dc_merge_sec)
        print(f"die-change (dots): bolster native={bolster_native}")
    dc_out = {"state": "off", "idle_s": 0.0, "clean": True, "diff": None, "plate_changed": False, "forklift": False,
              "big_frac": 0.0, "episode": None}
    det_model = YOLO(args.weights) if args.weights else None
    det_names = det_model.names if det_model else {}
    det_extra = {"quantize": 16} if args.det_half else {}
    last_det = []
    last_part_det = -10 ** 9
    part_grace = int(args.part_grace_sec * src_fps)
    raw_buf = deque(maxlen=2 * max(1, args.stride) + 1)
    inv = 1.0 / scale_to_proc

    jf = open(json_path, "w")
    jf.write(json.dumps({"video": vpath.name, "fps": src_fps, "native_size": [native_w, native_h],
                         "stroke_roi_native": list(stroke_native), "weights": args.weights or None,
                         "classes": list(det_names.values()) if det_names else []})[:-1]
             + ', "frames": [\n')
    n_json = 0

    k = max(1, args.stride)
    base = 2 * k
    gray_buf, color_buf = deque(maxlen=base + 1), deque(maxlen=base + 1)
    lk = dict(winSize=(args.lk_win, args.lk_win), maxLevel=args.lk_levels,
              criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01))
    stroke_k = max(1, args.stroke_stride)
    stroke_bufN = 2 * stroke_k
    stroke_gray = deque(maxlen=stroke_bufN + 1)

    plot = SignalPlot(args.plot_sec, src_fps, proc_w, args.plot_h, args.takt,
                      args.stroke_phase_frames, args.min_stroke_gap)

    settle_frames = int(args.press_settle_sec * src_fps)
    hold_frames = int(args.press_hold_sec * src_fps) if args.press_hold_sec > 0 else 10 ** 9
    new_rise_gap = max(settle_frames, int(1.0 * src_fps))
    integ_len = max(3, int(args.integrate_sec * src_fps))
    baseline_len = max(5, int(args.baseline_sec * src_fps))
    hist_len = max(args.min_samples, int(args.window_sec * src_fps))
    min_near_frames = int(args.min_near_sec * src_fps)
    hand_disc, _hr = _disc(args.hand_splat_radius)

    raw_i = 0
    vy_zone = 0.0
    slide_movers = 0
    last_rise_raw = arm_raw = None
    run_sign = run_len = 0
    window_id = n_windows = 0
    prev_in_window = False
    press_state = "----"

    heatmap = hand_heatmap = None
    hand_near_counts = {}
    history, last_seen, dist_hist, near_frames = {}, {}, {}, {}
    last_people = []
    worker_tid = None
    confirmed_tids = set()
    reid = None if args.no_reid else WorkerEmbeddings(args.reid_weights, min_sim=args.reid_min,
                                                      margin=args.reid_margin, every=args.reid_every, fps=src_fps)
    reid_scores = {}

    baseline_hist = deque(maxlen=baseline_len)
    wrist_dist_hist = deque(maxlen=max(2, int(0.25 * src_fps)))
    integ, carry_hist = deque(maxlen=integ_len), deque(maxlen=integ_len)
    window_events, window_open_frames = {}, {}
    events = []
    n_in = n_out = 0
    flash = None

    writer = None
    trace = open(args.trace, "w", newline="") if args.trace else None
    tracew = csv.writer(trace) if trace else None
    if tracew:
        tracew.writerow(["frame", "window", "vy", "state", "in_window", "press_open", "worker_tid", "wrist_dist",
                         "wrist_v", "n_hand", "n_sheet", "baseline", "carry", "toward", "cum", "strokes"])
    proc = det = 0
    t0 = time.perf_counter()

    while True:
        ok, raw = cap.read()
        if not ok:
            break
        raw_i += 1

        rx, ry, rw, rh = stroke_native
        rx, ry = max(0, rx), max(0, ry)
        rw = max(1, min(rw, raw.shape[1] - rx))
        rh = max(1, min(rh, raw.shape[0] - ry))
        stroke_gray.append(cv2.cvtColor(raw[ry:ry + rh, rx:rx + rw], cv2.COLOR_BGR2GRAY))
        vy_zone, slide_movers = 0.0, 0
        if len(stroke_gray) == stroke_bufN + 1:
            f0s, f1s, f2s = stroke_gray[0], stroke_gray[stroke_k], stroke_gray[stroke_bufN]
            c1s = cv2.goodFeaturesToTrack(f1s, maxCorners=args.stroke_max_corners,
                                          qualityLevel=args.stroke_quality, minDistance=args.stroke_min_distance)
            if c1s is not None and len(c1s) >= 8:
                pb, s0, _ = cv2.calcOpticalFlowPyrLK(f1s, f0s, c1s, None, **lk)
                pf, s2, _ = cv2.calcOpticalFlowPyrLK(f1s, f2s, c1s, None, **lk)
                stt = s0.reshape(-1).astype(bool) & s2.reshape(-1).astype(bool)
                p0s, p2s = pb.reshape(-1, 2)[stt], pf.reshape(-1, 2)[stt]
                if len(p0s) >= 1:
                    dd = (p2s - p0s) / stroke_bufN
                    mv = np.linalg.norm(dd, axis=1) > args.stroke_thresh
                    slide_movers = int(mv.sum())
                    if slide_movers >= args.stroke_min_move_pts:
                        vy_zone = float(np.median(dd[mv, 1]))
            plot.push(vy_zone)
            _rg = args.stroke_rise_vy or max(0.12, plot.limit() * 0.35)
            sgn = 1 if vy_zone > _rg else (-1 if vy_zone < -_rg else 0)
            if sgn != 0 and sgn == run_sign:
                run_len += 1
            else:
                run_sign, run_len = sgn, (1 if sgn else 0)
            if run_len >= args.stroke_phase_frames:
                if sgn < 0:
                    if last_rise_raw is None or (raw_i - last_rise_raw) > new_rise_gap:
                        n_windows += 1
                        window_id = n_windows
                        arm_raw = raw_i
                        integ.clear(); carry_hist.clear()
                    last_rise_raw = raw_i
                else:
                    if last_rise_raw is not None and arm_raw is not None and (raw_i - arm_raw) < new_rise_gap:
                        window_events.pop(window_id, None); window_open_frames.pop(window_id, None)
                        n_windows -= 1
                        window_id = n_windows
                    last_rise_raw = arm_raw = None
                    integ.clear(); carry_hist.clear()

        frame = prep_frame(raw, args.crop, args.proc_width)
        gray_buf.append(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
        color_buf.append(frame)
        raw_buf.append(raw)
        if len(gray_buf) < base + 1:
            proc += 1
            continue

        f0, f1, f2 = gray_buf[0], gray_buf[k], gray_buf[base]
        vis = color_buf[k].copy()
        h, w = f1.shape
        if heatmap is None:
            heatmap = np.zeros((h, w), np.float32)
            hand_heatmap = np.zeros((h, w), np.float32)

        c1 = cv2.goodFeaturesToTrack(f1, maxCorners=args.max_corners, qualityLevel=args.quality,
                                     minDistance=args.min_distance)
        p1, moving, delta = np.empty((0, 2)), np.empty((0,), bool), np.empty((0, 2))
        if c1 is not None and len(c1) >= 8:
            pb, s0, _ = cv2.calcOpticalFlowPyrLK(f1, f0, c1, None, **lk)
            pf, s2, _ = cv2.calcOpticalFlowPyrLK(f1, f2, c1, None, **lk)
            stt = s0.reshape(-1).astype(bool) & s2.reshape(-1).astype(bool)
            p0, p1, p2 = pb.reshape(-1, 2)[stt], c1.reshape(-1, 2)[stt], pf.reshape(-1, 2)[stt]
            if len(p1):
                delta = (p2 - p0) / base
                moving = np.linalg.norm(delta, axis=1) > args.thresh
        move_idx = np.nonzero(moving)[0]
        moved_pts = p1[move_idx] if len(p1) else np.empty((0, 2))
        moved_vel = delta[move_idx] if len(delta) else np.empty((0, 2))
        is_press = np.array([point_in_roi(tuple(pt), stroke_proc, args.press_margin) for pt in moved_pts], bool) \
            if len(moved_pts) else np.empty((0,), bool)
        slide_move_pts = int(is_press.sum())

        if det % args.yolo_every == 0:
            res = model.track(vis, classes=[0], conf=args.yolo_conf, persist=True,
                              tracker="bytetrack.yaml", verbose=False)[0]
            last_people = people_wrists(res, args.kp_conf)
        people = last_people
        claim = {}
        claimed = np.zeros(len(moved_pts), bool)
        wrist_entries = [(pr["tid"], side, wpt) for pr in people for side, wpt in pr["wrists"].items() if wpt is not None]
        if len(moved_pts) and wrist_entries:
            dists = np.stack([np.linalg.norm(moved_pts - np.array(wpt), axis=1) for _, _, wpt in wrist_entries])
            dists[dists > args.hand_radius] = np.inf
            for j in range(len(moved_pts)):
                e = int(np.argmin(dists[:, j]))
                if np.isfinite(dists[e, j]) and not is_press[j]:
                    claim.setdefault((wrist_entries[e][0], wrist_entries[e][1]), []).append(j)
                    claimed[j] = True

        if det_model is not None and det % args.det_every == 0:
            r = det_model.predict(raw_buf[k], imgsz=args.det_imgsz, conf=args.det_conf, verbose=False, **det_extra)[0]
            last_det = [(det_names[int(b.cls)], round(float(b.conf), 3), *[round(float(v)) for v in b.xyxy[0]])
                        for b in r.boxes]
        part_present = len(last_det) > 0
        if part_present:
            last_part_det = det
        part_gate_ok = args.no_part_gate or det_model is None or (det - last_part_det) <= part_grace

        if dc is not None:
            dc_out = dc.update(raw_buf[k], plot.cycles, moved_pts, is_press, (w, h))
        die_changing = dc_out["state"] == "die_change"

        if calibrating:
            for j, (x, y) in enumerate(moved_pts):
                if is_press[j] or claimed[j]:
                    xi, yi = int(x), int(y)
                    if 0 <= yi < h and 0 <= xi < w:
                        heatmap[yi, xi] += 1.0
            if args.hand_reach_dist > 0:
                for pr in people:
                    for wpt in pr["wrists"].values():
                        if wpt is not None and dist_to_roi(wpt, stroke_proc) <= args.hand_reach_dist:
                            _splat(hand_heatmap, wpt[0], wpt[1], hand_disc, _hr, h, w)
                            hand_near_counts[pr["tid"]] = hand_near_counts.get(pr["tid"], 0) + 1
            if plot.cycles >= args.min_strokes:
                work_roi = derive_roi_from_heatmap(heatmap, args.auto_roi_percentile, args.auto_roi_blur_sigma,
                                                   args.auto_roi_margin, w, h)
                hand_roi = derive_roi_from_heatmap(hand_heatmap, args.hand_roi_percentile, args.auto_roi_blur_sigma,
                                                   args.auto_roi_margin, w, h)
                machine_roi = union_roi(union_roi(work_roi, stroke_proc), hand_roi)
                pad = args.hand_reach_dist + args.auto_roi_margin
                sx, sy, sw, sh = stroke_proc
                cx0, cy0, cx1, cy1 = max(0, sx - pad), max(0, sy - pad), min(w, sx + sw + pad), min(h, sy + sh + pad)
                mx, my, mw, mh = machine_roi
                machine_roi = (max(mx, cx0), max(my, cy0), min(mx + mw, cx1) - max(mx, cx0), min(my + mh, cy1) - max(my, cy0))
                calibrating = False
                near = dict(sorted(hand_near_counts.items(), key=lambda kv: -kv[1]))
                print(f"[zone calibrated @ f={proc}] machine_roi={machine_roi}  hand_near_counts={near}  "
                      f"(pass --machine-roi \"{machine_roi[0]},{machine_roi[1]},{machine_roi[2]},{machine_roi[3]}\" to skip)")

        if machine_roi is not None:
            for pr in people:
                tid = pr["tid"]
                active = False
                for side, wpt in pr["wrists"].items():
                    if wpt is not None and claim.get((tid, side)) and dist_to_roi(wpt, machine_roi) <= args.zone_margin:
                        active = True
                core = [dist_to_roi(wpt, machine_core) for wpt in pr["wrists"].values() if wpt is not None]
                if core:
                    dist_hist.setdefault(tid, deque(maxlen=hist_len)).append(min(core))
                    if min(core) <= args.work_dist:
                        near_frames[tid] = near_frames.get(tid, 0) + 1
                last_seen[tid] = det
                history.setdefault(tid, deque(maxlen=hist_len)).append(active)
            for tid in list(history):
                if det - last_seen.get(tid, det) > args.track_timeout:
                    for d_ in (history, last_seen, dist_hist, near_frames):
                        d_.pop(tid, None)

        def status(tid):
            if machine_roi is None:
                return "calibrating", None
            hh = history.get(tid)
            if hh is None or len(hh) < args.min_samples:
                return "pending", None
            s = sum(hh) / len(hh)
            if s < args.worker_frac:
                return "passerby", s
            dh = dist_hist.get(tid)
            if dh and float(np.median(dh)) > args.work_dist:
                return "passerby", s
            if near_frames.get(tid, 0) < min_near_frames:
                return "pending", s
            return "worker", s

        stat_of = {pr["tid"]: status(pr["tid"]) for pr in people}
        workers = [pr for pr in people if stat_of[pr["tid"]][0] == "worker"]
        worker = max(workers, key=lambda pr: near_frames.get(pr["tid"], 0)) if workers else None
        provisional = False
        reid_scores = {}
        if reid is not None:
            reid.refresh(raw_buf[k], people, scale=inv)
            reid_scores = reid.score(people) if reid.ready else {}
        if reid is not None and reid.ready:
            reid_tid = reid.pick(reid_scores)
            worker = next((pr for pr in people if pr["tid"] == reid_tid), None)
            if worker is not None:
                confirmed_tids.add(worker["tid"])
        elif worker is not None:
            confirmed_tids.add(worker["tid"])
        elif confirmed_tids:
            known = [pr for pr in people if pr["tid"] in confirmed_tids and stat_of[pr["tid"]][0] != "passerby"]
            worker = max(known, key=lambda pr: near_frames.get(pr["tid"], 0)) if known else None
        if worker is None and not confirmed_tids and not (reid is not None and reid.ready):
            best = None
            for pr in people:
                if stat_of[pr["tid"]][0] == "passerby":
                    continue
                d = min((dist_to_roi(wp, stroke_proc) for wp in pr["wrists"].values() if wp is not None), default=None)
                if d is not None and d <= args.sheet_reach_dist and (best is None or d < best[0]):
                    best = (d, pr)
            if best is not None:
                worker, provisional = best[1], True
        worker_tid = worker["tid"] if worker else None

        wpts = [np.array(wp) for wp in worker["wrists"].values() if wp is not None] if worker else []
        is_hand = np.zeros(len(moved_pts), bool)
        is_sheet = np.zeros(len(moved_pts), bool)
        dmin = np.full(len(moved_pts), np.inf)
        if len(moved_pts) and wpts:
            dmin = np.min(np.stack([np.linalg.norm(moved_pts - wp, axis=1) for wp in wpts]), axis=0)
            is_hand = (dmin <= args.hand_radius) & ~is_press
        wrist_dist = min((dist_to_roi(tuple(wp), stroke_proc) for wp in wpts), default=None)
        in_reach = wrist_dist is not None and wrist_dist <= args.sheet_reach_dist
        if in_reach and len(moved_pts):
            is_sheet = (dmin <= args.sheet_radius) & ~is_hand & ~is_press
        n_sheet = int(is_sheet.sum())

        toward = 0.0
        centroid = v_sheet = None
        if n_sheet:
            centroid = moved_pts[is_sheet].mean(axis=0)
            v_sheet = moved_vel[is_sheet].mean(axis=0)
            u = np.array(nearest_roi_point(tuple(centroid), stroke_proc)) - centroid
            nrm = float(np.linalg.norm(u))
            if nrm > 1e-6:
                toward = float(np.median(moved_vel[is_sheet] @ (u / nrm)))
        if wrist_dist is not None:
            wrist_dist_hist.append(wrist_dist)
        wrist_v = 0.0
        if len(wrist_dist_hist) >= 2:
            wrist_v = -(wrist_dist_hist[-1] - wrist_dist_hist[0]) / (len(wrist_dist_hist) - 1)

        slide_still = abs(vy_zone) < args.press_still_vy and slide_move_pts < args.slide_quiet_pts
        in_window = last_rise_raw is not None and settle_frames <= (raw_i - last_rise_raw) <= hold_frames
        if prev_in_window and not in_window:
            integ.clear(); carry_hist.clear()
        prev_in_window = in_window
        press_open = in_window and slide_still
        press_state = ("DOWN" if vy_zone > args.press_still_vy else
                       ("RISE" if vy_zone < -args.press_still_vy else ("STILL" if press_open else "----")))

        if in_reach:
            baseline_hist.append(n_sheet)
        baseline = float(np.percentile(baseline_hist, 25)) if baseline_hist else 0.0
        carry = n_sheet >= max(args.sheet_min_dots, baseline + args.sheet_rise_dots)
        step = (toward + args.wrist_weight * float(np.clip(wrist_v, -4.0, 4.0))) if (press_open and carry) else 0.0
        integ.append(step)
        carry_hist.append(1 if (press_open and carry) else 0)
        cum = float(sum(integ))
        enough = len(carry_hist) >= integ_len and sum(carry_hist) >= args.min_carry_frac * integ_len

        evt = None
        if die_changing or not part_gate_ok:
            integ.clear(); carry_hist.clear()
            cum, enough = 0.0, False
        if in_window and not die_changing and part_gate_ok:
            window_open_frames[window_id] = window_open_frames.get(window_id, 0) + int(press_open)
            fired = window_events.setdefault(window_id, set())
            if enough and cum <= -args.move_px and "OUT" not in fired:
                evt = "OUT"
            elif enough and cum >= args.move_px and "IN" not in fired and ("OUT" in fired or args.any_order):
                evt = "IN"
        if evt is not None:
            fired.add(evt)
            integ.clear(); carry_hist.clear()
            n_in += evt == "IN"
            n_out += evt == "OUT"
            t_s = proc / src_fps
            events.append((proc, round(t_s, 2), evt, window_id, worker_tid, int(provisional), n_sheet,
                           round(toward, 2), round(wrist_dist, 1) if wrist_dist is not None else ""))
            flash = (f"SHEET {evt}", det + int(src_fps))
            print(f"[t={t_s:7.1f}s f={proc:6d}] SHEET {evt:<3}  (window #{window_id}  "
                  f"{'provisional' if provisional else 'worker'} id{worker_tid}  dots {n_sheet}  toward {toward:+.2f})")

        if reid is not None and worker is not None and not provisional:
            reid.learn(worker["tid"], strong=evt is not None)

        if tracew:
            tracew.writerow([proc, window_id, round(vy_zone, 3), press_state, int(in_window), int(press_open),
                             worker_tid, round(wrist_dist, 1) if wrist_dist is not None else "", round(wrist_v, 1),
                             int(is_hand.sum()), n_sheet, baseline, int(carry), round(toward, 2), round(cum, 1),
                             plot.cycles])

        if evt is not None or det % max(1, args.json_every) == 0:
            rec = {
                "frame": proc, "time_s": round(proc / src_fps, 3),
                "stroke": {"vy": round(vy_zone, 3), "state": press_state, "count": plot.cycles,
                           "press_open": bool(press_open), "window": window_id if in_window else None},
                "worker": ({"tid": worker_tid, "confirmed": not provisional,
                            "reid_sim": (round(reid_scores[worker_tid], 3) if worker_tid in reid_scores else None),
                            "box": [round(float(v) * inv) for v in worker["box"]]} if worker is not None else None),
                "reid": {str(t_): round(s_, 3) for t_, s_ in reid_scores.items()},
                "sheet": {"event": evt, "in": n_in, "out": n_out, "part_gate_ok": bool(part_gate_ok)},
                "parts": {"present": part_present,
                          "detections": [{"class": n_, "conf": c_, "box": [x1_, y1_, x2_, y2_]}
                                         for n_, c_, x1_, y1_, x2_, y2_ in last_det]},
                "die_change": {"state": dc_out["state"], "idle_s": float(dc_out["idle_s"]),
                               "plate_clean": bool(dc_out["clean"]), "plate_diff": dc_out["diff"],
                               "plate_changed": bool(dc_out["plate_changed"]), "forklift": bool(dc_out["forklift"]),
                               "episode": dc_out["episode"]},
            }
            jf.write(("," if n_json else "") + json.dumps(rec) + "\n")
            n_json += 1

        if args.clean:
            if worker is not None:
                x1, y1, x2, y2 = (int(v) for v in worker["box"])
                wc = (0, 255, 255) if provisional else (0, 255, 0)
                cv2.rectangle(vis, (x1, y1), (x2, y2), wc, 2 if provisional else 3)
                cv2.putText(vis, "WORKER?" if provisional else "WORKER", (x1, max(0, y1 - 8)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, wc, 2)
            for n_, c_, x1_, y1_, x2_, y2_ in last_det:
                p1_, p2_ = (int(x1_ * scale_to_proc), int(y1_ * scale_to_proc)), (int(x2_ * scale_to_proc), int(y2_ * scale_to_proc))
                cv2.rectangle(vis, p1_, p2_, (170, 40, 0), 2)
                cv2.putText(vis, f"{n_} {c_:.2f}", (p1_[0], max(12, p1_[1] - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                            (170, 40, 0), 2)
            if calibrating:
                cv2.putText(vis, f"calibrating zone: strokes {plot.cycles}/{args.min_strokes}", (8, 28),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 200, 0), 2)
            else:
                cv2.putText(vis, f"strokes {plot.cycles}   IN {n_in}   OUT {n_out}", (8, 28),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 255), 2)
            if det_model is not None:
                ptxt = "part: " + (", ".join(sorted({d[0] for d in last_det})) if part_present else "NOT PRESENT")
                cv2.putText(vis, ptxt, (8, 52), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                            (170, 40, 0) if part_present else (0, 0, 255), 2)
            if dc_out["state"] == "die_change":
                bx_, by_, bw_, bh_ = dc.bp
                cv2.rectangle(vis, (bx_, by_), (bx_ + bw_, by_ + bh_), (0, 140, 255), 3)
                cv2.putText(vis, "DIE CHANGE IN PROGRESS", (w // 2 - 170, 80), cv2.FONT_HERSHEY_SIMPLEX, 1.0,
                            (0, 140, 255), 3)
            if flash is not None and det < flash[1]:
                cv2.putText(vis, flash[0], (w // 2 - 110, h // 2), cv2.FONT_HERSHEY_SIMPLEX, 1.4,
                            (0, 255, 0) if flash[0].endswith("IN") else (0, 140, 255), 4)
        else:
            for i, ((x, y), mv) in enumerate(zip(p1, moving)):
                if not mv:
                    cv2.circle(vis, (int(x), int(y)), 2, (0, 150, 0), -1)
            for j, (x, y) in enumerate(moved_pts):
                if is_hand[j]:
                    col, rad = (0, 165, 255), 3
                elif is_sheet[j]:
                    col, rad = (255, 255, 0), 3
                elif claimed[j]:
                    col, rad = (0, 255, 255), 3
                else:
                    col, rad = (0, 0, 255), 2
                cv2.circle(vis, (int(x), int(y)), rad, col, -1)
            if centroid is not None and v_sheet is not None:
                tip = centroid + v_sheet * 12.0
                cv2.arrowedLine(vis, (int(centroid[0]), int(centroid[1])), (int(tip[0]), int(tip[1])), (255, 255, 0), 2,
                                tipLength=0.35)
            sx, sy, sw2, sh2 = stroke_proc
            cv2.rectangle(vis, (sx, sy), (sx + sw2, sy + sh2), (0, 200, 255), 1)
            if machine_roi is not None:
                mx, my, mw, mh = machine_roi
                cv2.rectangle(vis, (mx, my), (mx + mw, my + mh), (170, 40, 0), 2)
            BOX_COLOR = {"worker": (0, 255, 0), "passerby": (150, 150, 150), "pending": (0, 255, 255),
                         "calibrating": (255, 200, 0)}
            for pr in people:
                stat, sc = stat_of[pr["tid"]]
                picked = worker is not None and pr["tid"] == worker["tid"]
                col = ((0, 255, 255) if provisional else (0, 255, 0)) if picked else BOX_COLOR[stat]
                x1, y1, x2, y2 = (int(v) for v in pr["box"])
                cv2.rectangle(vis, (x1, y1), (x2, y2), col, 3 if picked else 1)
                lbl = ("WORKER? " if picked and provisional else "WORKER " if picked else "") + \
                      f"id{pr['tid']} {stat}" + (f" {sc:.0%}" if sc is not None else "") + \
                      f" near={near_frames.get(pr['tid'], 0) / src_fps:.0f}s" + \
                      (f" sim={reid_scores[pr['tid']]:.2f}" if pr['tid'] in reid_scores else "")
                cv2.putText(vis, lbl, (x1, max(0, y1 - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, col, 2)
                for wpt in pr["wrists"].values():
                    if wpt is not None:
                        cv2.circle(vis, (int(wpt[0]), int(wpt[1])), 4, col, 1)
            col = (0, 220, 0) if press_open else ((60, 170, 255) if in_window else (0, 0, 255))
            cv2.putText(vis, f"press {press_state:5s} vy {vy_zone:+.2f}  strokes {plot.cycles}  "
                             f"{'calibrating ' if calibrating else ''}{'provisional' if provisional else 'worker'} id{worker_tid}",
                        (8, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.52, col, 2)
            cv2.putText(vis, f"sheet dots {n_sheet} (base {baseline:.0f}) toward {toward:+.2f} moved {cum:+.1f}/{args.move_px:.0f}px"
                             f"{'' if part_gate_ok else '  [no part seen -> events blocked]'}",
                        (8, 42), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 0) if carry else (180, 180, 180), 1)
            cv2.putText(vis, f"IN {n_in}   OUT {n_out}", (8, 64), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 2)
            for n_, c_, x1_, y1_, x2_, y2_ in last_det:
                p1_, p2_ = (int(x1_ * scale_to_proc), int(y1_ * scale_to_proc)), (int(x2_ * scale_to_proc), int(y2_ * scale_to_proc))
                cv2.rectangle(vis, p1_, p2_, (170, 40, 0), 2)
                cv2.putText(vis, f"{n_} {c_:.2f}", (p1_[0], max(12, p1_[1] - 5)), cv2.FONT_HERSHEY_SIMPLEX, 0.5,
                            (170, 40, 0), 2)
            if det_model is not None:
                ptxt = "part: " + (", ".join(sorted({d[0] for d in last_det})) if part_present else "NOT PRESENT")
                cv2.putText(vis, ptxt, (8, 86), cv2.FONT_HERSHEY_SIMPLEX, 0.6,
                            (170, 40, 0) if part_present else (0, 0, 255), 2)
            if dc is not None:
                bx_, by_, bw_, bh_ = dc.bp
                pc = (0, 140, 255) if dc_out["state"] == "die_change" else ((0, 255, 0) if dc_out["clean"] else (0, 0, 255))
                cv2.rectangle(vis, (bx_, by_), (bx_ + bw_, by_ + bh_), pc, 2)
                cv2.putText(vis, f"die {dc_out['state']}  idle {dc_out['idle_s']:.0f}s  plate "
                                 f"{'held (worker)' if not dc_out['clean'] else ('CHANGED' if dc_out['plate_changed'] else 'as before')}"
                                 f"  diff={dc_out['diff'] if dc_out['diff'] is not None else '-'}"
                                 f"{'  FORKLIFT ' + format(dc_out['big_frac'], '.2f') if dc_out['forklift'] else ''}",
                            (8, 108), cv2.FONT_HERSHEY_SIMPLEX, 0.5, pc, 1)
                if dc_out["state"] == "die_change":
                    cv2.putText(vis, "DIE CHANGE IN PROGRESS", (w // 2 - 170, 80), cv2.FONT_HERSHEY_SIMPLEX, 1.0,
                                (0, 140, 255), 3)
            if flash is not None and det < flash[1]:
                cv2.putText(vis, flash[0], (w // 2 - 90, h // 2), cv2.FONT_HERSHEY_SIMPLEX, 1.2,
                            (0, 255, 0) if flash[0].endswith("IN") else (0, 140, 255), 3)

        if args.no_graph:
            combined = vis
        else:
            pimg = plot.draw(proc / src_fps, vy_zone, slide_movers)
            if pimg.shape[1] != vis.shape[1]:
                pimg = cv2.resize(pimg, (vis.shape[1], pimg.shape[0]))
            combined = np.vstack([vis, pimg])

        if not args.no_video:
            if writer is None:
                hh, ww = combined.shape[:2]
                writer = cv2.VideoWriter(out_path, cv2.VideoWriter_fourcc(*"mp4v"), src_fps, (ww, hh))
            writer.write(combined)
        if args.display:
            cv2.imshow("press_full_monitor2 -- worker | parts | SHEET IN/OUT | strokes | die change", combined)
            if (cv2.waitKey(1) & 0xFF) in (ord("q"), 27):
                break
        det += 1
        proc += 1
        if proc % 250 == 0:
            print(f"  {proc} frames  {proc / (time.perf_counter() - t0):4.1f} fps  strokes={plot.cycles}  "
                  f"worker={worker_tid}  IN={n_in}  OUT={n_out}  part={'yes' if part_present else 'no'}", flush=True)
        if args.max_frames and proc >= args.max_frames:
            break

    cap.release()
    if writer is not None:
        writer.release()
    if args.display:
        cv2.destroyAllWindows()
    if trace:
        trace.close()
    with open(csv_path, "w", newline="") as fh:
        wcsv = csv.writer(fh)
        wcsv.writerow(["frame", "time_s", "event", "window", "worker_tid", "provisional", "n_sheet", "toward", "wrist_dist"])
        wcsv.writerows(events)

    ev_dicts = [{"frame": e[0], "time_s": e[1], "event": e[2], "window": e[3], "worker_tid": e[4],
                 "provisional": bool(e[5]), "n_sheet": e[6], "toward": e[7]} for e in events]
    die_changes = dc.finish() if dc is not None else []
    for ep in die_changes:
        for kk in ("start_s", "flag_at_s", "plate_changed_at_s", "end_s"):
            if ep.get(kk) is not None:
                tt = int(ep[kk]); ep[kk.replace("_s", "")] = f"{tt // 3600}:{tt % 3600 // 60:02d}:{tt % 60:02d}"
    jf.write('], "events": ' + json.dumps(ev_dicts) + ', "summary": '
             + json.dumps({"frames_processed": proc, "strokes": plot.cycles, "sheet_in": n_in, "sheet_out": n_out,
                           "machine_roi_proc": list(machine_roi) if machine_roi else None,
                           "json_records": n_json, "die_changes": die_changes,
                           "bolster_roi_native": list(dc.bn) if dc is not None else None}) + "}\n")
    for ep in die_changes:
        print("die change:", json.dumps(ep))
    jf.close()
    print(f"json -> {json_path}  ({n_json} frame records, {len(events)} events)")

    min_open = int(args.min_window_sec * src_fps)
    missing = {wid: {"IN", "OUT"} - ev for wid, ev in window_events.items()
               if ev != {"IN", "OUT"} and window_open_frames.get(wid, 0) >= min_open}
    n_ok = sum(1 for v in window_open_frames.values() if v >= min_open)
    print(f"\ndone: {proc} frames in {time.perf_counter() - t0:.1f}s")
    print(f"strokes {plot.cycles}   press-up windows {n_ok}   SHEET IN {n_in}   SHEET OUT {n_out}   "
          f"machine_roi={machine_roi}")
    if missing:
        print("windows missing an event: " + ", ".join(f"#{wid} no {'/'.join(sorted(m))}" for wid, m in sorted(missing.items())))
    print(f"events -> {csv_path.name}")
    if not args.no_video:
        print(f"saved: {out_path}")


if __name__ == "__main__":
    main()
