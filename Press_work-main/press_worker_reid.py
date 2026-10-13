from __future__ import annotations

from collections import deque

import numpy as np


class WorkerEmbeddings:

    def __init__(self, weights="yolo26n-reid.onnx", device=None, min_sim=0.40, margin=0.10, hyst=0.10,
                 ema=0.3, top_k=5, max_strong=80, max_weak=40, every=3, adapt_sec=2.0, confirm_sec=0.6,
                 fps=25.0):
        from ultralytics.trackers.utils.reid import ReID
        if device is None and str(weights).endswith(".onnx"):
            try:
                import onnxruntime as ort
                device = "cuda" if "CUDAExecutionProvider" in ort.get_available_providers() else "cpu"
            except ImportError:
                device = "cpu"
        self.enc = ReID(weights, device=device)
        self.min_sim, self.margin, self.hyst, self.ema, self.top_k = min_sim, margin, hyst, ema, top_k
        self.strong = deque(maxlen=max_strong)
        self.weak = deque(maxlen=max_weak)
        self.every = max(1, int(every))
        self.adapt_every = max(1, int(adapt_sec * fps))
        self.confirm_n = max(1, int(confirm_sec * fps))
        self.above = {}
        self.eligible = {}
        self.frame_w = None
        self.last_seen = {}
        self.keep_n = max(1, int(2.0 * fps))
        self._n = 0
        self._emb = {}
        self.track_sim = {}
        self.current = None
        self._gallery = None
        self._last_adapt = -10 ** 9

    def _embed(self, frame, boxes):
        if not boxes:
            return []
        b = np.asarray(boxes, dtype=np.float32)
        xywh = np.column_stack([(b[:, 0] + b[:, 2]) / 2, (b[:, 1] + b[:, 3]) / 2, b[:, 2] - b[:, 0], b[:, 3] - b[:, 1]])
        out = []
        for f in self.enc(frame, xywh):
            if f is None:
                out.append(None)
                continue
            f = np.asarray(f, dtype=np.float32).ravel()
            n = np.linalg.norm(f)
            out.append(f / n if n > 1e-9 else None)
        return out

    def refresh(self, frame, people, scale=1.0):
        self._n += 1
        if (self._n - 1) % self.every:
            return
        boxes = [tuple(float(v) * scale for v in pr["box"]) for pr in people]
        W = frame.shape[1]
        for pr, (x1, y1, x2, y2) in zip(people, boxes):
            self.eligible[pr["tid"]] = not (x1 <= 2 or x2 >= W - 3) or (x2 - x1) >= 0.12 * W
        for pr, e in zip(people, self._embed(frame, boxes)):
            if e is not None:
                self._emb[pr["tid"]] = e
        for pr in people:
            self.last_seen[pr["tid"]] = self._n
        for tid in list(self.last_seen):
            if self._n - self.last_seen[tid] > self.keep_n:
                for d in (self._emb, self.track_sim, self.above, self.eligible, self.last_seen):
                    d.pop(tid, None)
                if self.current == tid:
                    self.current = None

    @property
    def ready(self):
        return len(self.strong) + len(self.weak) >= 3

    def _rebuild(self):
        allv = list(self.strong) + list(self.weak)
        self._gallery = np.stack(allv) if allv else None

    def learn(self, tid, strong=False):
        e = self._emb.get(tid)
        if e is None:
            return
        if strong:
            self.strong.append(e)
        elif len(self.weak) < self.weak.maxlen and len(self.strong) < 10:
            self.weak.append(e)
        else:
            return
        self._rebuild()

    def _adapt(self, tid, sim):
        if sim >= self.min_sim + 0.15 and self._n - self._last_adapt >= self.adapt_every:
            e = self._emb.get(tid)
            if e is not None:
                self.weak.append(e)
                self._rebuild()
                self._last_adapt = self._n

    def _sim(self, e):
        s = self._gallery @ e
        k = min(self.top_k, s.size)
        return float(np.sort(s)[-k:].mean())

    def score(self, people):
        out = {}
        if self._gallery is None:
            return out
        for pr in people:
            tid = pr["tid"]
            e = self._emb.get(tid)
            if e is None:
                continue
            s = self._sim(e)
            prev = self.track_sim.get(tid)
            s = s if prev is None else (1 - self.ema) * prev + self.ema * s
            self.track_sim[tid] = s
            out[tid] = s
            self.above[tid] = self.above.get(tid, 0) + 1 if s >= self.min_sim else 0
        return out

    def pick(self, scores):
        if not scores:
            return None
        order = sorted(scores.items(), key=lambda kv: -kv[1])
        best_tid, best = order[0]
        runner = order[1][1] if len(order) > 1 else -1.0
        cur = self.current
        if cur is not None:
            if cur not in scores:
                return None
            if scores[cur] >= self.min_sim - self.hyst and not (best_tid != cur and best - scores[cur] >= self.margin
                                                                and best >= self.min_sim):
                self._adapt(cur, scores[cur])
                return cur
        if best >= self.min_sim and best - runner >= self.margin and self.above.get(best_tid, 0) >= self.confirm_n \
                and self.eligible.get(best_tid, True):
            self.current = best_tid
            self._adapt(best_tid, best)
            return best_tid
        self.current = None
        return None
