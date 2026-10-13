"use client";
import type { Severity, Trust } from "./types";

/** Shapes emitted by pipeline/43_build_floor.py.
 *  Metres, Y up, origin at floor centre. The layout half is a hand-authored
 *  SKETCH of the real shop — see `provenance`, and do not read dimensions off it. */

export type StationKind = "hydraulic_4col" | "mechanical_cframe";
export type SimState = "running" | "idle" | "break" | "changeover" | "fault";

export interface SimSpan {
  m0: number; m1: number;          // minute-of-day
  state: SimState;
  severity?: Severity;
  label?: string;
}

export interface Station {
  id: string;
  label: string;
  kind: StationKind;
  tonnage: number;
  pos: [number, number, number];   // [x, y, z]
  rot: number;
  dims: { w: number; h: number; d: number; col_r?: number; col_inset?: number; frame_t?: number };
  ram: { travel: number; plate: [number, number, number]; park: number };
  flywheel?: { r: number; t: number; offset: [number, number, number] };
  operator_post?: { pts: [number, number][] };
  /** the single flag everything else keys off */
  instrumented: boolean;
  trust: Trust;
  sources: string[];
  /** null primary = the UI must NOT link this station to any dashboard */
  routes: { primary: string | null; camera?: string; timeline?: string };
  sim: { phase: number; spm: number; pattern: SimSpan[] } | null;
}

export interface FloorRoom {
  id: string; label: string; pos: [number, number];
  dims: { w: number; h: number; d: number };
  door: [number, number];
  routes: { primary: string | null };
}

export interface FloorPath {
  id: string; pts: [number, number][]; closed: boolean;
  speed_mps: number; trust: Trust;
}

/** What the camera actually saw at the one instrumented station, precomputed by
 *  pipeline/43_build_floor.py so the landing page never parses cv.json. */
export interface StationEvents {
  operator_present_s: [number, number][];
  /** the holes in presence, >= 60 s. The largest on this run is 1004 s: the
   *  operator leaves at 09:49:16 and the camera watches an idle press until
   *  coverage ends. The absences are what a shift lead acts on. */
  operator_absent_s: [number, number][];
  die_change_s: [number, number][];
  forklift_visits_s: [number, number][];
  coverage_s: [number, number][];
  measured: {
    strokes: number; running_spm: number; running_period_s: number | null;
    down_ms: number | null; up_ms: number | null; dwell_ms: number | null;
    dwell_pct: number | null;
    sheet_in: number; sheet_out: number;
    no_signal_s: number;
    covered_s: number; present_s: number; setup_jogs: number;
    stock: { class: string; typical_n: number; why: string }[];
    video: { frames: number; seconds: number; signal_hz: number; overlay_hz: number };
  };
  provenance: { presence: string; operator_position: string; forklift: string };
  source: string;
}

export interface FloorData {
  schema: string;
  note: string;
  provenance: { layout: string; dimensions: string };
  floor: { w: number; d: number; origin: string; up: string; grid_m: number };
  aisles: { id: string; pts: [number, number][]; w: number }[];
  stations: Station[];
  room: FloorRoom;
  paths: FloorPath[];
  ambient: {
    walkers: { id: string; path: string; phase: number }[];
    forklift_patrol: { id: string; path: string; phase: number };
  };
  views: { id: string; pos: [number, number, number]; target: [number, number, number]; zoom: number }[];
  events: Record<string, StationEvents>;
  legend: { instrumented: number; total: number; text: string };
}

/** Cheap runtime assert — a malformed file should fall back to the 2D plan
 *  through useAsync's existing `err`, not throw inside a render. */
export async function loadFloor(): Promise<FloorData> {
  const r = await fetch("/data/floor.json");
  if (!r.ok) throw new Error(`floor.json: ${r.status}`);
  const d = (await r.json()) as FloorData;
  if (!Array.isArray(d.stations) || !d.stations.length) throw new Error("floor.json: no stations");
  if (!d.floor?.w || !d.floor?.d) throw new Error("floor.json: no floor extents");
  for (const s of d.stations) {
    if (!s.id || !Array.isArray(s.pos) || s.pos.length !== 3) {
      throw new Error(`floor.json: bad station ${s?.id ?? "?"}`);
    }
  }
  return d;
}

export const inSpan = (t: number, spans: [number, number][]) =>
  spans.some(([a, b]) => t >= a && t < b);
