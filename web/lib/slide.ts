/** THE SLIDE MODEL — one function, two renderers.
 *
 *  The 2D instrument in the top of the live screen and the 3D ram on the floor
 *  map must never disagree about where the slide is. They did: the instrument
 *  integrated vy with `pos + (target - pos) * 0.25`, a per-frame lerp that
 *  moves the block further per second at 144 Hz than at 60 Hz, so the same
 *  recording played back differently on different monitors. The ram would have
 *  been a second, independent version of the same mistake.
 *
 *  So the model lives here and both call it:
 *
 *    - vy > 0 descends, vy < 0 rises (press_full_monitor2's convention)
 *    - position is normalised 0 = TDC, 1 = BDC, and clamped — the integrator
 *      must not be able to walk the ram out through the bolster
 *    - with no stroke signal the slide parks at TDC, because that is where a
 *      mechanical press stops
 *    - smoothing is FRAME-RATE INDEPENDENT: an exponential approach in real
 *      seconds, not a fixed fraction per frame
 */

/** Seconds to drift back to the park position when the signal is dead. */
const PARK_TAU = 0.9;
/** Where the slide sits when there is nothing to show. Not 0: a ram welded to
 *  the crown looks broken, and a real slide rests just below TDC. */
export const PARK = 0.08;

/** Normalised travel per unit of (vy · second).
 *
 *  CALIBRATION, and why it is not 1. vy is optical flow in the stroke ROI,
 *  in pixels per frame. It gives direction and timing to 40 ms, which is the
 *  whole reason the camera beats the 200 ms PLC poll — but it is NOT a
 *  calibrated displacement, so integrating it raw lands the ram wherever the
 *  flow magnitude happens to put it.
 *
 *  What makes a scale factor legitimate here is that the integral is stable.
 *  Over the 101 descents in the complete run, the integral of vy·dt is 3.398
 *  median against 3.512 at p90 — a 3% spread. The slide really does make the
 *  same trip every stroke, so normalising it to the station's declared travel
 *  is a unit conversion, not an invention. 1 / 3.398 = 0.294.
 *
 *  (It also means the ram amplitude is the one part of this that is derived
 *  rather than measured. The phase, the direction and the timing are measured.)
 */
const VY_RATE = 0.294;

/** Frame-rate-independent exponential approach. */
const approach = (from: number, to: number, tau: number, dt: number) =>
  to + (from - to) * Math.exp(-dt / tau);

/**
 * Advance the slide one frame.
 *
 * @param pos    previous normalised position, 0 = TDC … 1 = BDC
 * @param vy     the raw signal at the playhead
 * @param state  the monitor's slide state: 0 NO SIGNAL, 1 rise, 2 still, 3 down
 * @param dt     seconds since the last call (clamp it before calling)
 * @param reduce honour prefers-reduced-motion: snap instead of easing
 */
export function advanceSlide(pos: number, vy: number, state: 0 | 1 | 2 | 3,
                             dt: number, reduce = false): number {
  // state 0 is the monitor's "----" — the ROI gave it nothing. That is not a
  // stopped press, but it is also not a position, so the ram parks rather than
  // integrating noise.
  if (state === 0) return reduce ? PARK : approach(pos, PARK, PARK_TAU, dt);

  // STILL: hold. Integrating sub-threshold flow through a 10 s dwell — 90% of
  // every cycle on this press — would let noise walk the ram down the frame.
  if (state === 2) return pos;

  // RISE / DOWN: integrate in REAL TIME. The first version of this did
  // `approach(pos, pos + vy * k, tau, dt)`, which re-damped the increment it
  // had just computed and delivered ~26% of it per frame; the ram swept 0.118 m
  // of a 0.42 m stroke and looked like a twitch. An integrator does not want
  // smoothing applied to its own output — the 25 Hz signal is already smooth
  // at 60 fps.
  return Math.max(0, Math.min(1, pos + vy * VY_RATE * dt));
}

/**
 * The eleven uninstrumented presses: CLOSED FORM, never integrated.
 *
 * There is no signal to integrate, and an integrator with no reference drifts —
 * after an hour on screen the rams would be at arbitrary phases and a viewer
 * would read meaning into it. This is a pure function of the clock, so it is
 * the same at t whether you got there by playing or by scrubbing.
 *
 * @param t      clock seconds
 * @param spm    declared strokes per minute for the station
 * @param phase  declared phase offset, 0..1, so twelve presses are not in sync
 */
export function closedFormSlide(t: number, spm: number, phase: number): number {
  if (spm <= 0) return PARK;
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * (t * spm / 60 + phase));
}
