from __future__ import annotations

import argparse
import json
import time
from collections import deque
from pathlib import Path

import cv2
import numpy as np

from press_up_down import prep_frame, SignalPlot
from press_worker_filter import parse_roi, scale_roi, point_in_roi

LOOK_SIZE = (96, 48)


def default_bolster(stroke_native):
    sx, sy, sw, sh = stroke_native
    return (int(round(sx - 0.15 * sw)), int(sy + sh), int(round(1.3 * sw)), int(sh))


def crop_roi(frame, roi):
    x, y, w, h = roi
    H, W = frame.shape[:2]
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    return frame[y0:y1, x0:x1] if (x1 > x0 and y1 > y0) else None


def look(crop):
    g = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)
    g = cv2.resize(g, LOOK_SIZE, interpolation=cv2.INTER_AREA).astype(np.float32)
    g = cv2.GaussianBlur(g, (0, 0), 1.2)
    return (g - g.mean()) / (g.std() + 1e-6)


def look_diff(a, b):
    return float(np.mean(np.abs(a - b)))


def to_seconds(s):
    if s is None:
        return None
    parts = [float(x) for x in s.split(":")]
    return sum(v * 60 ** i for i, v in enumerate(reversed(parts)))


def hms(t):
    t = int(t)
    return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}"


class DieChangeDots:
    def __init__(self, fps, bolster_proc, bolster_native, step, idle_sec=60.0, jog_gap_sec=30.0, cadence_n=3,
                 zone_margin=30, zone_quiet_pts=3, zone_memory_sec=4.0, change_thr=0.45, change_hold_sec=5.0,
                 big_frac=0.33, big_pts=60, big_sec=2.0, pre_look_sec=60.0, min_sec=120.0, merge_sec=300.0):
        self.merge_frames = int(merge_sec * fps)
        self.fps, self.step = fps, max(1, int(step))
        self.bp = bolster_proc
        self.bn = bolster_native
        self.idle_frames = int(idle_sec * fps)
        self.jog_gap = int(jog_gap_sec * fps)
        self.cadence_n = max(2, cadence_n)
        self.zone_margin = zone_margin
        self.zone_quiet_pts = zone_quiet_pts
        self.zone_decay = np.exp(-self.step / max(1.0, zone_memory_sec * fps))
        self.change_thr = change_thr
        self.change_hold = max(1, int(change_hold_sec * fps / self.step))
        self.big_frac, self.big_pts, self.big_hold = big_frac, big_pts, max(1, int(big_sec * fps / self.step))
        self.pre_look_len = max(5, int(pre_look_sec * fps / self.step))
        self.min_frames = int(min_sec * fps)

        self.i = 0
        self.last_count = None
        self.prev_stroke_i = None
        self.run_start_i = None
        self.run_len = 0
        self.last_cadence_i = None
        self.zone_motion = 0.0
        self.recent_looks = deque(maxlen=self.pre_look_len)
        self.pre_look = None
        self.cur_look = None
        self.diff = None
        self.changed = False
        self.change_run = 0
        self.big_run = 0
        self.forklift = False
        self.forklift_times = []
        self.state = "running"
        self.episode = None
        self.episodes = []
        self.worker_motion_frames = 0

    @property
    def idle_s(self):
        return (self.i - (self.last_cadence_i if self.last_cadence_i is not None else 0)) / self.fps

    def _zone_dots(self, moved, is_press):
        n = 0
        for j, pt in enumerate(moved):
            if not is_press[j] and point_in_roi(tuple(pt), self.bp, self.zone_margin):
                n += 1
        return n

    def _big_object(self, moved, is_press, frame_wh, cell=20):
        pts = moved[~is_press] if len(moved) else moved
        if len(pts) < self.big_pts:
            return False, 0.0
        W, H = frame_wh
        gw, gh = W // cell + 1, H // cell + 1
        grid = np.zeros((gh, gw), np.uint8)
        grid[np.clip((pts[:, 1] // cell).astype(int), 0, gh - 1), np.clip((pts[:, 0] // cell).astype(int), 0, gw - 1)] = 1
        grid = cv2.dilate(grid, np.ones((3, 3), np.uint8))
        n, lbl, stats, _ = cv2.connectedComponentsWithStats(grid, 8)
        if n <= 1:
            return False, 0.0
        k = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        frac = (stats[k, cv2.CC_STAT_WIDTH] * cell * stats[k, cv2.CC_STAT_HEIGHT] * cell) / float(W * H)
        n_in = int(np.sum(lbl[np.clip((pts[:, 1] // cell).astype(int), 0, gh - 1),
                              np.clip((pts[:, 0] // cell).astype(int), 0, gw - 1)] == k))
        return (frac >= self.big_frac and n_in >= self.big_pts), frac

    def update(self, raw, stroke_count, moved, is_press, frame_wh):
        self.i += self.step
        t = self.i / self.fps
        stroke_now = self.last_count is not None and stroke_count != self.last_count
        self.last_count = stroke_count
        cadence_now = False
        if stroke_now:
            if self.prev_stroke_i is not None and self.i - self.prev_stroke_i <= self.jog_gap:
                self.run_len += 1
            else:
                self.run_start_i, self.run_len = self.i, 1
            if self.run_len >= self.cadence_n:
                cadence_now = True
                self.last_cadence_i = self.i
            self.prev_stroke_i = self.i

        moved = np.asarray(moved).reshape(-1, 2) if len(moved) else np.empty((0, 2))
        is_press = np.asarray(is_press, bool) if len(is_press) == len(moved) else np.zeros(len(moved), bool)

        nz = self._zone_dots(moved, is_press)
        self.zone_motion = self.zone_motion * self.zone_decay + nz
        clean = nz < self.zone_quiet_pts and self.zone_motion < 2.0 * self.zone_quiet_pts
        if self.state != "running" and nz >= self.zone_quiet_pts:
            self.worker_motion_frames += self.step

        if clean:
            crop = crop_roi(raw, self.bn)
            if crop is not None:
                self.cur_look = look(crop)
                if self.state == "running":
                    self.recent_looks.append(self.cur_look)
                elif self.pre_look is None and not self.forklift_times and not self.forklift:
                    self.pre_look = self.cur_look
                if self.pre_look is not None:
                    self.diff = look_diff(self.cur_look, self.pre_look)
                    over = self.diff > self.change_thr
                    self.change_run = self.change_run + 1 if over else 0
                    if self.change_run >= self.change_hold:
                        self.changed = True

        big, frac = self._big_object(moved, is_press, frame_wh)
        self.big_run = self.big_run + 1 if big else 0
        self.forklift = self.big_run >= self.big_hold
        if self.forklift and self.state != "running" and (not self.forklift_times or t - self.forklift_times[-1] > 5.0):
            self.forklift_times.append(round(t, 2))

        prev = self.state
        idle = (self.i - (self.last_cadence_i if self.last_cadence_i is not None else 0)) >= self.idle_frames
        if self.state == "running":
            if idle:
                self.state = "idle"
                self.pre_look = np.median(np.stack(self.recent_looks), axis=0) if len(self.recent_looks) >= 5 else self.cur_look
                self.changed, self.change_run, self.diff = False, 0, None
                self.forklift_times, self.worker_motion_frames = [], 0
        if self.state == "idle":
            if self.forklift or self.changed:
                self.state = "die_change"
                self.episode = {"id": len(self.episodes) + 1,
                                "start_s": round(self.last_cadence_i / self.fps, 2) if self.last_cadence_i is not None else 0.0,
                                "partial_start": self.last_cadence_i is None,
                                "flag_at_s": round(t, 2),
                                "trigger": "forklift" if self.forklift else "plate changed",
                                "plate_changed_at_s": round(t, 2) if self.changed else None,
                                "strokes_while_open": 0}
        if self.state in ("idle", "die_change") and cadence_now:
            if self.state == "die_change":
                ep = self.episode
                ep["end_s"] = round(self.run_start_i / self.fps, 2)
                ep["duration_s"] = round(ep["end_s"] - ep["start_s"], 1)
                ep["plate_changed_at_s"] = ep["plate_changed_at_s"] or (round(t, 2) if self.changed else None)
                ep["plate_looks_different_after"] = bool(self.changed)
                ep["forklift_times_s"] = list(self.forklift_times)
                ep["worker_motion_s"] = round(self.worker_motion_frames / self.fps, 1)
                ep["die_change"] = bool(self.changed)
                if (ep["end_s"] - ep["start_s"]) * self.fps >= self.min_frames:
                    prev_ep = self.episodes[-1] if self.episodes else None
                    if prev_ep is not None and prev_ep.get("end_s") is not None and \
                            (ep["start_s"] - prev_ep["end_s"]) * self.fps <= self.merge_frames:
                        prev_ep["end_s"] = ep["end_s"]
                        prev_ep["duration_s"] = round(prev_ep["end_s"] - prev_ep["start_s"], 1)
                        prev_ep["strokes_while_open"] += ep["strokes_while_open"]
                        prev_ep["forklift_times_s"] = sorted(set(prev_ep["forklift_times_s"] + ep["forklift_times_s"]))
                        prev_ep["worker_motion_s"] = round(prev_ep["worker_motion_s"] + ep["worker_motion_s"], 1)
                        prev_ep["plate_looks_different_after"] = prev_ep["plate_looks_different_after"] or ep["plate_looks_different_after"]
                        prev_ep["die_change"] = prev_ep["die_change"] or ep["die_change"]
                        prev_ep["plate_changed_at_s"] = prev_ep["plate_changed_at_s"] or ep["plate_changed_at_s"]
                        prev_ep["parts"] = prev_ep.get("parts", 1) + 1
                    else:
                        ep["parts"] = 1
                        self.episodes.append(ep)
                self.episode = None
            self.state = "running"
            self.pre_look = None
            self.recent_looks.clear()
        if self.episode is not None and stroke_now:
            self.episode["strokes_while_open"] += 1
        return {"state": self.state, "idle_s": round(self.idle_s, 1), "clean": clean, "zone_dots": nz,
                "diff": None if self.diff is None else round(self.diff, 3), "plate_changed": self.changed,
                "forklift": self.forklift, "big_frac": round(frac, 3), "changed_state": prev != self.state,
                "episode": self.episode["id"] if self.episode else None}

    def finish(self):
        if self.episode is not None:
            ep = self.episode
            ep.update({"end_s": None, "partial_end": True, "plate_looks_different_after": bool(self.changed),
                       "forklift_times_s": list(self.forklift_times), "die_change": bool(self.changed),
                       "worker_motion_s": round(self.worker_motion_frames / self.fps, 1)})
            self.episodes.append(ep)
            self.episode = None
        return self.episodes


def parse_args():
    p = argparse.ArgumentParser(description="die (mold) change flag from dots: idle press + forklift-sized motion "
                                            "or a changed base plate, worker excluded by motion; ends when "
                                            "production cadence returns")
    p.add_argument("--video", required=True)
    p.add_argument("--start", default=None, help="hh:mm:ss")
    p.add_argument("--end", default=None, help="hh:mm:ss")
    p.add_argument("--stroke-roi", default="530,40,480,300", help="x,y,w,h native px of the slide")
    p.add_argument("--bolster-roi", default=None, help="x,y,w,h native px of the base plate (default: under the slide)")
    p.add_argument("--proc-width", type=int, default=580)
    p.add_argument("--max-corners", type=int, default=1200)
    p.add_argument("--quality", type=float, default=0.005)
    p.add_argument("--min-distance", type=int, default=4)
    p.add_argument("--thresh", type=float, default=0.3)
    p.add_argument("--stroke-min-move-pts", type=int, default=10)
    p.add_argument("--stroke-phase-frames", type=int, default=3)
    p.add_argument("--min-stroke-gap", type=float, default=1.0)
    p.add_argument("--every", type=int, default=2, help="whole-frame dots every Nth frame (slide signal uses all)")
    p.add_argument("--dc-idle-sec", type=float, default=60.0, help="no production cadence for this long = idle")
    p.add_argument("--dc-jog-gap-sec", type=float, default=30.0)
    p.add_argument("--dc-cadence-n", type=int, default=3)
    p.add_argument("--dc-zone-margin", type=int, default=30, help="proc px around the plate watched for worker dots")
    p.add_argument("--dc-zone-quiet-pts", type=int, default=3, help="fewer moving dots than this near the plate = "
                                                                    "nobody working on it")
    p.add_argument("--dc-zone-memory-sec", type=float, default=4.0, help="motion near the plate blocks the plate "
                                                                          "reading for this long afterwards")
    p.add_argument("--dc-change-thr", type=float, default=0.45, help="plate-look difference vs the pre-idle look "
                                                                      "that counts as changed")
    p.add_argument("--dc-change-hold-sec", type=float, default=5.0)
    p.add_argument("--dc-big-frac", type=float, default=0.33, help="moving cluster bbox >= this fraction of the "
                                                                    "frame = forklift-sized object (a person passing "
                                                                    "near the camera reaches ~0.25)")
    p.add_argument("--dc-big-pts", type=int, default=60)
    p.add_argument("--dc-big-sec", type=float, default=2.0)
    p.add_argument("--dc-min-sec", type=float, default=120.0, help="shorter episodes are dropped")
    p.add_argument("--dc-merge-sec", type=float, default=300.0, help="episodes closer than this are one die change "
                                                                      "(test-stroke bursts split them otherwise)")
    p.add_argument("--json", default=None)
    p.add_argument("--out", default=None, help="save the annotated video here (e.g. x_diechange2.mp4); "
                                               "'auto' = <video stem>_diechange2.mp4; omitted = no video")
    p.add_argument("--out-scale", type=float, default=1.0, help="scale of the saved frames relative to the 580-px "
                                                                 "processing frame (1.0 = 580 wide)")
    p.add_argument("--display", action="store_true")
    p.add_argument("--display-scale", type=float, default=1.6)
    p.add_argument("--debug", action="store_true", help="draw the plate box, the moving dots, the status line and "
                                                         "the forklift flag; without it only the orange box and "
                                                         "'DIE CHANGE IN PROGRESS' appear during a die change")
    return p.parse_args()


def main():
    args = parse_args()
    vpath = Path(args.video)
    cap = cv2.VideoCapture(str(vpath))
    if not cap.isOpened():
        raise RuntimeError(f"cannot open {vpath}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    native_w = int(cap.get(3))
    scale = (args.proc_width / native_w) if (args.proc_width and native_w > args.proc_width) else 1.0
    stroke_native = parse_roi(args.stroke_roi)
    stroke_proc = scale_roi(stroke_native, scale)
    bolster_native = parse_roi(args.bolster_roi) if args.bolster_roi else default_bolster(stroke_native)
    bolster_proc = scale_roi(bolster_native, scale)
    f0 = int(to_seconds(args.start) * fps) if args.start else 0
    f1 = int(to_seconds(args.end) * fps) if args.end else int(cap.get(7))
    if f0:
        cap.set(cv2.CAP_PROP_POS_FRAMES, f0)
    print(f"video: {vpath.name}  stroke={stroke_native}  bolster={bolster_native}  frames {f0}..{f1}  (dots only)")

    dc = DieChangeDots(fps, bolster_proc, bolster_native, args.every, idle_sec=args.dc_idle_sec,
                       jog_gap_sec=args.dc_jog_gap_sec, cadence_n=args.dc_cadence_n, zone_margin=args.dc_zone_margin,
                       zone_quiet_pts=args.dc_zone_quiet_pts, zone_memory_sec=args.dc_zone_memory_sec,
                       change_thr=args.dc_change_thr, change_hold_sec=args.dc_change_hold_sec, big_frac=args.dc_big_frac,
                       big_pts=args.dc_big_pts, big_sec=args.dc_big_sec, min_sec=args.dc_min_sec, merge_sec=args.dc_merge_sec)
    plot = SignalPlot(60, fps, 400, 100, 0.0, args.stroke_phase_frames, args.min_stroke_gap)
    lk = dict(winSize=(31, 31), maxLevel=4, criteria=(cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 30, 0.01))
    sgray, gray_buf = deque(maxlen=3), deque(maxlen=3)
    sx, sy, sw, sh = stroke_native
    i, t0 = f0, time.perf_counter()
    last_state = None
    out_path = None
    if args.out:
        out_path = vpath.with_name(f"{vpath.stem}_diechange2.mp4") if args.out == "auto" else Path(args.out)
    writer = None
    draw = args.display or out_path is not None
    while i < f1:
        ok, raw = cap.read()
        if not ok:
            break
        sgray.append(cv2.cvtColor(raw[max(0, sy):sy + sh, max(0, sx):sx + sw], cv2.COLOR_BGR2GRAY))
        vy = 0.0
        if len(sgray) == 3:
            c1 = cv2.goodFeaturesToTrack(sgray[1], maxCorners=args.max_corners, qualityLevel=args.quality,
                                         minDistance=args.min_distance)
            if c1 is not None and len(c1) >= 8:
                pb, s0, _ = cv2.calcOpticalFlowPyrLK(sgray[1], sgray[0], c1, None, **lk)
                pf, s2, _ = cv2.calcOpticalFlowPyrLK(sgray[1], sgray[2], c1, None, **lk)
                st = s0.reshape(-1).astype(bool) & s2.reshape(-1).astype(bool)
                d = (pf.reshape(-1, 2)[st] - pb.reshape(-1, 2)[st]) / 2.0
                if len(d):
                    mv = np.linalg.norm(d, axis=1) > args.thresh
                    if int(mv.sum()) >= args.stroke_min_move_pts:
                        vy = float(np.median(d[mv, 1]))
            plot.push(vy)
        frame = prep_frame(raw, 1.0, args.proc_width)
        gray_buf.append(cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY))
        if (i - f0) % args.every == 0 and len(gray_buf) == 3:
            g0, g1, g2 = gray_buf
            c1 = cv2.goodFeaturesToTrack(g1, maxCorners=args.max_corners, qualityLevel=args.quality,
                                         minDistance=args.min_distance)
            moved = np.empty((0, 2))
            if c1 is not None and len(c1) >= 8:
                pb, s0, _ = cv2.calcOpticalFlowPyrLK(g1, g0, c1, None, **lk)
                pf, s2, _ = cv2.calcOpticalFlowPyrLK(g1, g2, c1, None, **lk)
                st = s0.reshape(-1).astype(bool) & s2.reshape(-1).astype(bool)
                p1 = c1.reshape(-1, 2)[st]
                d = (pf.reshape(-1, 2)[st] - pb.reshape(-1, 2)[st]) / 2.0
                moved = p1[np.linalg.norm(d, axis=1) > args.thresh] if len(p1) else moved
            is_press = np.array([point_in_roi(tuple(pt), stroke_proc, 6) for pt in moved], bool) if len(moved) else np.zeros(0, bool)
            out = dc.update(raw, plot.cycles, moved, is_press, (frame.shape[1], frame.shape[0]))
            if out["changed_state"] or (out["forklift"] and out["state"] != "running" and last_state != "fork"):
                print(f"[{hms(i / fps)}] state={out['state']:11s} idle={out['idle_s']:.0f}s strokes={plot.cycles} "
                      f"plate_diff={out['diff']} changed={out['plate_changed']} forklift={out['forklift']} "
                      f"(cluster {out['big_frac']:.2f} of frame)", flush=True)
            last_state = "fork" if (out["forklift"] and out["state"] != "running") else out["state"]
            if draw:
                bx, by, bw, bh = bolster_proc
                if args.debug:
                    col = (0, 140, 255) if out["state"] == "die_change" else ((0, 255, 0) if out["clean"] else (0, 0, 255))
                    cv2.rectangle(frame, (bx, by), (bx + bw, by + bh), col, 2)
                    for (x, y) in moved:
                        cv2.circle(frame, (int(x), int(y)), 2, (0, 0, 255), -1)
                    cv2.putText(frame, f"{hms(i / fps)}  {out['state']}  idle {out['idle_s']:.0f}s  strokes {plot.cycles}  "
                                       f"plate {'held (worker)' if not out['clean'] else ('CHANGED' if out['plate_changed'] else 'as before')}"
                                       f"  diff={out['diff'] if out['diff'] is not None else '-'}",
                                (8, 24), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 2)
                    if out["forklift"]:
                        cv2.putText(frame, "FORKLIFT / LARGE OBJECT", (8, 50), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 0, 255), 2)
                if out["state"] == "die_change":
                    if not args.debug:
                        cv2.rectangle(frame, (bx, by), (bx + bw, by + bh), (0, 140, 255), 3)
                    cv2.putText(frame, "DIE CHANGE IN PROGRESS", (frame.shape[1] // 2 - 170, 80), cv2.FONT_HERSHEY_SIMPLEX,
                                1.0, (0, 140, 255), 3)
                if out_path is not None:
                    saved = cv2.resize(frame, None, fx=args.out_scale, fy=args.out_scale) if args.out_scale != 1.0 else frame
                    if writer is None:
                        writer = cv2.VideoWriter(str(out_path), cv2.VideoWriter_fourcc(*"mp4v"), fps / args.every,
                                                 (saved.shape[1], saved.shape[0]))
                    writer.write(saved)
                if args.display:
                    shown = cv2.resize(frame, None, fx=args.display_scale, fy=args.display_scale) if args.display_scale != 1.0 else frame
                    cv2.imshow("press_die_change2", shown)
                    if (cv2.waitKey(1) & 0xFF) in (ord("q"), 27):
                        break
        i += 1
        if (i - f0) % 3000 == 0:
            print(f"  {i - f0} frames  {(i - f0) / (time.perf_counter() - t0):.0f} fps  state={dc.state}  strokes={plot.cycles}", flush=True)
    episodes = dc.finish()
    cap.release()
    if writer is not None:
        writer.release()
    if args.display:
        cv2.destroyAllWindows()
    out_json = Path(args.json) if args.json else vpath.with_name(f"{vpath.stem}_diechange2.json")
    for ep in episodes:
        for k in ("start_s", "flag_at_s", "plate_changed_at_s", "end_s"):
            if ep.get(k) is not None:
                ep[k.replace("_s", "")] = hms(ep[k])
    out_json.write_text(json.dumps({"video": vpath.name, "fps": fps, "stroke_roi": list(stroke_native),
                                    "bolster_roi": list(bolster_native), "strokes": plot.cycles, "episodes": episodes}, indent=2))
    print(f"\ndone: {i - f0} frames in {time.perf_counter() - t0:.1f}s  strokes {plot.cycles}  episodes {len(episodes)}")
    for ep in episodes:
        print("  ", json.dumps(ep))
    print(f"json -> {out_json}")
    if out_path is not None:
        print(f"video -> {out_path}")


if __name__ == "__main__":
    main()
