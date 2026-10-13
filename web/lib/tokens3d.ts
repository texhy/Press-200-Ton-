"use client";
import * as THREE from "three";

/** CSS design token -> three.js material bridge.
 *
 *  WHY NOT getComputedStyle(root).getPropertyValue("--s1"):
 *  that returns the AUTHORED TOKEN TEXT, not a resolved colour. Custom
 *  properties are not computed to a colour unless registered with @property.
 *  It happens to work for plain hex tokens and breaks the moment anything uses
 *  color-mix() — which this codebase already does freely.
 *
 *  Instead: set `color: var(--token)` on a probe element and read back the
 *  COMPUTED `color`, which forces the browser to resolve var() chains and
 *  color-mix(). A 2D canvas then normalises exotic forms (oklab, color(srgb …))
 *  to something THREE.Color understands.
 *
 *  The probe inherits from <html>, so it picks up [data-theme] AND the
 *  prefers-color-scheme branch — both matter, because the light palette is
 *  declared in two places. */

let probe: HTMLSpanElement | null = null;
let norm: CanvasRenderingContext2D | null = null;

function ensure() {
  if (probe) return;
  probe = document.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;width:0;height:0;opacity:0;pointer-events:none";
  document.body.appendChild(probe);
  norm = document.createElement("canvas").getContext("2d");
}

function resolve(token: string): { hex: string; alpha: number } {
  ensure();
  probe!.style.color = "";
  probe!.style.color = `var(${token})`;
  const raw = getComputedStyle(probe!).color || "rgb(128,128,128)";
  const m = /rgba?\(([^)]+)\)/.exec(raw);
  let alpha = 1;
  if (m) {
    const parts = m[1].split(/[,/]/).map((v) => v.trim());
    if (parts.length > 3) alpha = parseFloat(parts[3]);
  }
  norm!.fillStyle = "#808080";
  norm!.fillStyle = raw;
  return { hex: norm!.fillStyle as string, alpha: Number.isFinite(alpha) ? alpha : 1 };
}

/* ---- stable shared instances, mutated in place on theme change ---------- */

const colors = new Map<string, THREE.Color>();
const alphas = new Map<string, number>();

/** Returns a SHARED THREE.Color for a token. Never clone-on-read: the whole
 *  point is that a theme switch mutates these in place, so no React component
 *  has to re-render for the scene to recolour. */
export function tokenColor(token: string): THREE.Color {
  let c = colors.get(token);
  if (!c) {
    const { hex, alpha } = resolve(token);
    c = new THREE.Color().setStyle(hex);
    colors.set(token, c);
    alphas.set(token, alpha);
  }
  return c;
}

export const tokenAlpha = (token: string) => (alphas.get(token) ?? (tokenColor(token), alphas.get(token) ?? 1));

type Kind = "standard" | "basic";
const materials = new Map<string, THREE.Material>();

/** One material per (token, kind), shared across every mesh that uses it.
 *  `basic` is unlit — required for anything carrying a validated status colour,
 *  because a lit surface multiplies the colour by an arbitrary N·L term and the
 *  contrast guarantee stops being true. */
export function tokenMaterial(token: string, kind: Kind = "standard",
                              opts: { roughness?: number; metalness?: number; opacity?: number } = {}) {
  const key = `${token}|${kind}|${JSON.stringify(opts)}`;
  let m = materials.get(key);
  if (!m) {
    const color = tokenColor(token);
    const transparent = (opts.opacity ?? 1) < 1;
    m = kind === "basic"
      ? new THREE.MeshBasicMaterial({ color, transparent, opacity: opts.opacity ?? 1 })
      : new THREE.MeshStandardMaterial({
          color,
          roughness: opts.roughness ?? 0.72,
          metalness: opts.metalness ?? 0.12,
          transparent,
          opacity: opts.opacity ?? 1,
        });
    materials.set(key, m);
  }
  return m as THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
}

/** Re-resolve every token and push into the shared colours/materials.
 *  No React render, no needsUpdate — uniforms are read per frame, and only
 *  structural changes (transparency toggling, maps) force recompilation. */
export function refreshTokens() {
  for (const [token, c] of colors) {
    const { hex, alpha } = resolve(token);
    c.setStyle(hex);
    alphas.set(token, alpha);
  }
  for (const [key, m] of materials) {
    const token = key.split("|")[0];
    const c = colors.get(token);
    if (c && "color" in m) (m as THREE.MeshStandardMaterial).color.copy(c);
  }
}

/** Watch BOTH signals: TopBar stamps data-theme, but before it mounts the
 *  theme can come from the media query alone. */
export function watchTheme(onChange: () => void): () => void {
  const fire = () => { refreshTokens(); onChange(); };
  const mo = new MutationObserver(fire);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  const mq = window.matchMedia("(prefers-color-scheme: light)");
  mq.addEventListener("change", fire);
  return () => { mo.disconnect(); mq.removeEventListener("change", fire); };
}

/** Honour reduced motion, and keep honouring it — reading `.matches` once at
 *  mount (as two existing canvas instruments do) means an OS-level change does
 *  nothing until reload. */
export function watchReducedMotion(cb: (reduce: boolean) => void): () => void {
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  const fire = () => cb(mq.matches);
  fire();
  mq.addEventListener("change", fire);
  return () => mq.removeEventListener("change", fire);
}
