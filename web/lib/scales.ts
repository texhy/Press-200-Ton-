/** Thin wrappers so chart components read the same way everywhere.
 *  d3-scale does the maths; these fix the conventions (clean ticks, padding). */
import { scaleLinear, scaleBand, scaleTime } from "d3-scale";
export { scaleLinear, scaleBand, scaleTime };

/** Round a domain out to clean numbers — axis ticks must read 0 / 1,000 / 2,000. */
export function niceDomain(values: number[], zeroBased = true): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return [0, 1];
  let lo = Math.min(...finite), hi = Math.max(...finite);
  if (zeroBased) lo = Math.min(0, lo);
  if (hi === lo) hi = lo + 1;
  const span = hi - lo;
  const step = Math.pow(10, Math.floor(Math.log10(span))) / 2;
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

export function ticks(lo: number, hi: number, n = 4): number[] {
  const out: number[] = [];
  const step = (hi - lo) / n;
  for (let i = 0; i <= n; i++) out.push(lo + step * i);
  return out;
}

/** Fixed mark specs from the design system — imported, never re-typed. */
export const MARK = {
  barMax: 24,        // never fill the band; the leftover is air
  barRadius: 4,      // rounded data-end, square at the baseline
  line: 2,
  marker: 8,
  gap: 2,            // surface gap between touching fills
  areaOpacity: 0.1,  // a wash, never a saturated block
} as const;
