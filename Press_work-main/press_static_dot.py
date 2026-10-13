from __future__ import annotations
import argparse
import time
from collections import deque
from pathlib import Path

import cv2
import numpy as np


def prep_frame(frame, crop, proc_width):
    if 0.0 < crop < 1.0:
        H0, W0 = frame.shape[:2]
        cw, ch = int(W0 * crop), int(H0 * crop)
        frame = frame[(H0 - ch) // 2:(H0 - ch) // 2 + ch, (W0 - cw) // 2:(W0 - cw) // 2 + cw]
    if proc_width and frame.shape[1] > proc_width:
        s = proc_width / frame.shape[1]
        frame = cv2.resize(frame, (proc_width, int(frame.shape[0] * s)))
    return frame


def parse_args():
    p = argparse.ArgumentParser(description="static camera press version")
    p.add_argument("--video", required=True)
    p.add_argument("--out", default=None)
    p.add_argument("--no-video", action="store_true")
    p.add_argument("--display", action="store_true")
    p.add_argument("--stride", type=int, default=1, help="k: 3 frames hain {t-k, t, t+k}")
    p.add_argument("--proc-width", type=int, default=580)
    p.add_argument("--crop", type=float, default=1.0)
    p.add_argument("--max-corners", type=int, default=1200)
    p.add_argument("--quality", type=float, default=0.005)
    p.add_argument("--min-distance", type=int, default=4)
    p.add_argument("--thresh", type=float, default=0.3) 
    p.add_argument("--lk-win", type=int, default=31)
    p.add_argument("--lk-levels", type=int, default=4)
    p.add_argument("--max-frames", type=int, default=0)
    return p.parse_args()


def main():
    args = parse_args()
    vpath = Path(args.video)
    if not vpath.exists():
        raise FileNotFoundError(vpath)
    cap = cv2.VideoCapture(str(vpath))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open {vpath}")
    src_fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    out_path = args.out or f"{vpath.stem}_static.mp4"
    print(f"video: {vpath.name}  stride={args.stride}  thresh={args.thresh}px/frame")

    k = max(1, args.stride)
    base = 2 * k 
    gray_buf, color_buf = deque(maxlen=base + 1), deque(maxlen=base + 1)
    lk = dict(winSize=(args.lk_win, args.lk_win), maxLevel=args.lk_levels, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01))
    writer = None
    proc = det = movers = 0
    t0 = time.perf_counter()

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame = prep_frame(frame, args.crop, args.proc_width)
        gray_buf.append(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
        color_buf.append(frame)

        if len(gray_buf) == base + 1:
            f0, f1, f2 = gray_buf[0], gray_buf[k], gray_buf[base] 
            vis = color_buf[k].copy()
            h, w = f1.shape

            c1 = cv2.goodFeaturesToTrack(f1, maxCorners=args.max_corners, qualityLevel=args.quality, minDistance=args.min_distance)
            n_move = 0
            move_px = 0.0
            if c1 is not None and len(c1) >= 8:
                p_back, s0, _ = cv2.calcOpticalFlowPyrLK(f1, f0, c1, None, **lk) 
                p_fwd, s2, _ = cv2.calcOpticalFlowPyrLK(f1, f2, c1, None, **lk)
                st = s0.reshape(-1).astype(bool) & s2.reshape(-1).astype(bool)
                p0, p1, p2 = p_back.reshape(-1, 2)[st], c1.reshape(-1, 2)[st], p_fwd.reshape(-1, 2)[st]

                if len(p1) >= 1:
                    residual = np.linalg.norm(p2 - p0, axis=1) / base
                    moving = residual > args.thresh
                    n_move = int(moving.sum())
                    if n_move:
                        move_px = float(np.median(residual[moving]))

                    for (x, y), mv in zip(p1, moving):
                        cv2.circle(vis, (int(x), int(y)), 2, (0, 0, 255) if mv else (0, 180, 0), -1)

            if not args.no_video:
                if writer is None:
                    hh, ww = vis.shape[:2]
                    writer = cv2.VideoWriter(out_path, cv2.VideoWriter_fourcc(*"mp4v"), src_fps, (ww, hh))
                writer.write(vis)
            if args.display:
                cv2.imshow("press_static_dot -- green=static  red=moving", vis)
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
