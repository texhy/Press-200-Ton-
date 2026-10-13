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


# ── added ───────────────────────────────────────────────────────────────
class SignalPlot:
    """Live signed-velocity chart.  + = slide moving DOWN, - = moving UP."""

    def __init__(self, seconds, fps, w, h, takt, min_phase=3, min_gap_s=1.0):
        self.n = max(60, int(seconds * fps))
        self.buf = deque([0.0] * self.n, maxlen=self.n)
        self.mag = deque(maxlen=self.n)
        self.w, self.h, self.fps, self.takt = w, h, fps, takt
        self.state, self.cycles = "idle", 0
        # a phase (DOWN or UP) only counts once vy has stayed past the gate for min_phase
        # consecutive frames -- a 1-frame blip can no longer arm or close a stroke
        self.min_phase = max(1, min_phase)
        self.min_gap = int(min_gap_s * fps)       # refractory: no 2nd stroke within this many frames
        self.run_sign = 0
        self.run_len = 0
        self.i = 0
        self.last_cycle_i = -10 ** 9

    def limit(self):
        if len(self.mag) < 20:
            return 1.0
        return max(0.05, float(np.percentile(self.mag, 95)))

    def push(self, v):
        self.i += 1
        self.buf.append(v)
        if abs(v) > 1e-9:
            self.mag.append(abs(v))
        # one stroke = a down phase followed by an up phase; hysteresis stops chatter
        gate = self.limit() * 0.35
        sign = 1 if v > gate else (-1 if v < -gate else 0)
        if sign != 0 and sign == self.run_sign:
            self.run_len += 1
        else:
            self.run_sign, self.run_len = sign, (1 if sign else 0)
        if self.run_len < self.min_phase:
            return
        if sign > 0 and self.state != "down":
            self.state = "down"
        elif sign < 0 and self.state == "down":
            self.state = "up"
            if self.i - self.last_cycle_i >= self.min_gap:
                self.cycles += 1
                self.last_cycle_i = self.i

    def draw(self, elapsed_s, vy_now, n_move):
        img = np.full((self.h, self.w, 3), 22, np.uint8)
        mid, amp = self.h // 2 + 10, self.h // 2 - 32
        s = self.limit()

        if self.takt > 0:                                   # one gridline per planned stroke
            step = self.takt * self.fps
            j = 0
            while j * step < self.n:
                x = int(self.w - j * step * self.w / self.n)
                cv2.line(img, (x, 26), (x, self.h), (55, 55, 55), 1)
                j += 1

        cv2.line(img, (0, mid), (self.w, mid), (105, 105, 105), 1)

        b = list(self.buf)
        ypix = lambda v: int(mid - np.clip(v / s, -1.0, 1.0) * amp)
        for i in range(1, self.n):
            if b[i - 1] == 0.0 and b[i] == 0.0:
                continue
            col = (80, 80, 255) if b[i] > 0 else (255, 190, 60)
            cv2.line(img, (int((i - 1) * self.w / self.n), ypix(b[i - 1])),
                     (int(i * self.w / self.n), ypix(b[i])), col, 1, cv2.LINE_AA)

        rate = self.cycles / elapsed_s * 60.0 if elapsed_s > 1 else 0.0
        arrow = "DOWN" if vy_now > 0 else ("UP" if vy_now < 0 else "--")
        cv2.putText(img, f"vy {vy_now:+.3f} px/f  {arrow}   pts {n_move}   "
                         f"strokes {self.cycles}  ({rate:.2f}/min)",
                    (10, 18), cv2.FONT_HERSHEY_SIMPLEX, .5, (255, 255, 255), 1, cv2.LINE_AA)
        cv2.putText(img, f"+{s:.2f}  DOWN", (10, mid - amp - 4),
                    cv2.FONT_HERSHEY_SIMPLEX, .42, (80, 80, 255), 1, cv2.LINE_AA)
        cv2.putText(img, f"-{s:.2f}  UP", (10, mid + amp + 14),
                    cv2.FONT_HERSHEY_SIMPLEX, .42, (255, 190, 60), 1, cv2.LINE_AA)
        if self.takt > 0:
            cv2.putText(img, f"gridlines {self.takt:.0f}s   span {self.n/self.fps:.0f}s   "
                             f"plan {60/self.takt:.2f}/min",
                        (self.w - 330, 18), cv2.FONT_HERSHEY_SIMPLEX, .42,
                        (150, 150, 150), 1, cv2.LINE_AA)
        return img
# ────────────────────────────────────────────────────────────────────────


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
    # added
    p.add_argument("--plot-sec", type=float, default=120.0)
    p.add_argument("--plot-w", type=int, default=1000)
    p.add_argument("--plot-h", type=int, default=300)
    p.add_argument("--takt", type=float, default=25.0, help="0 disables gridlines")
    p.add_argument("--plot-out", default=None, help="also save the plot as a video")
    p.add_argument("--combined", action="store_true", help="save --out as the stacked view (dots on top, "
                                                            "graph underneath), same as the display window")
    # noise guards for the stroke counter
    p.add_argument("--min-move-pts", type=int, default=10, help="fewer moving points than this = still "
                                                                 "(one stray corner can jump 50px and fake a stroke)")
    p.add_argument("--min-phase-frames", type=int, default=3, help="consecutive frames past the gate needed to "
                                                                    "enter a DOWN or UP phase")
    p.add_argument("--min-stroke-gap", type=float, default=1.0, help="seconds; a 2nd stroke within this is ignored")
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
    plot = SignalPlot(args.plot_sec, src_fps, args.plot_w, args.plot_h, args.takt,
                      args.min_phase_frames, args.min_stroke_gap)                    # added
    plot_writer = None                                                              # added
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
            vy_med = 0.0                                                    # added
            if c1 is not None and len(c1) >= 8:
                p_back, s0, _ = cv2.calcOpticalFlowPyrLK(f1, f0, c1, None, **lk) 
                p_fwd, s2, _ = cv2.calcOpticalFlowPyrLK(f1, f2, c1, None, **lk)
                st = s0.reshape(-1).astype(bool) & s2.reshape(-1).astype(bool)
                p0, p1, p2 = p_back.reshape(-1, 2)[st], c1.reshape(-1, 2)[st], p_fwd.reshape(-1, 2)[st]

                if len(p1) >= 1:
                    delta = (p2 - p0) / base                                # added
                    residual = np.linalg.norm(delta, axis=1)                # same value as before
                    moving = residual > args.thresh
                    n_move = int(moving.sum())
                    if n_move:
                        move_px = float(np.median(residual[moving]))
                    if n_move >= args.min_move_pts:                         # too few movers = noise, slide is still
                        vy_med = float(np.median(delta[moving, 1]))         # added: + down, - up

                    for (x, y), mv in zip(p1, moving):
                        cv2.circle(vis, (int(x), int(y)), 2, (0, 0, 255) if mv else (0, 180, 0), -1)

            plot.push(vy_med)                                               # added
            pimg = plot.draw(proc / src_fps, vy_med, n_move)                # added

            # one image: dots on top (scaled to the plot width), signal plot underneath
            vh, vw = vis.shape[:2]
            combined = np.vstack([cv2.resize(vis, (args.plot_w, int(vh * args.plot_w / vw))), pimg])
            save_img = combined if args.combined else vis

            if not args.no_video:
                if writer is None:
                    hh, ww = save_img.shape[:2]
                    writer = cv2.VideoWriter(out_path, cv2.VideoWriter_fourcc(*"mp4v"), src_fps, (ww, hh))
                writer.write(save_img)
            if args.plot_out:                                               # added
                if plot_writer is None:
                    plot_writer = cv2.VideoWriter(args.plot_out, cv2.VideoWriter_fourcc(*"mp4v"),
                                                  src_fps, (args.plot_w, args.plot_h))
                plot_writer.write(pimg)
            if args.display:
                cv2.imshow("press_up_down -- top: green=static red=moving | bottom: + DOWN / - UP", combined)
                if (cv2.waitKey(1) & 0xFF) in (ord("q"), 27):
                    break
            det += 1; movers += n_move

        proc += 1
        if proc % 60 == 0:
            print(f"  {proc} frames  {proc / (time.perf_counter() - t0):4.1f} fps  "
                  f"avg moving pts/frame={movers / max(det, 1):.1f}  strokes={plot.cycles}")
        if args.max_frames and proc >= args.max_frames:
            break

    cap.release()
    if writer is not None:
        writer.release()
    if plot_writer is not None:
        plot_writer.release()
    if args.display:
        cv2.destroyAllWindows()
    print(f"\ndone: {proc} frames in {time.perf_counter() - t0:.1f}s")
    print(f"strokes counted: {plot.cycles}")
    if not args.no_video:
        print(f"saved: {out_path}")
    if args.plot_out:
        print(f"saved: {args.plot_out}")


if __name__ == "__main__":
    main()