"use client";

/** WebGL capability probe — cached, and it RELEASES the context it creates.
 *
 *  The previous version was:
 *      !!document.createElement("canvas").getContext("webgl2")
 *  which looks harmless and is not. Every call creates a real GL context on a
 *  detached canvas that is never freed, and browsers cap simultaneous contexts
 *  (~16 in Chrome). React StrictMode double-invokes effects in dev, so each
 *  mount leaked two; navigate between pages a few times and the pool is gone.
 *  getContext then returns null and the app concludes "WebGL unavailable"
 *  permanently — on a machine where WebGL works perfectly.
 *
 *  So: probe at most once per page load, and hand the context straight back
 *  with WEBGL_lose_context. */

export type GlReport = { ok: boolean; reason: string; renderer?: string };

let cached: GlReport | null = null;

export function probeWebGL(): GlReport {
  if (cached) return cached;
  if (typeof document === "undefined") return { ok: false, reason: "no document" };

  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", { failIfMajorPerformanceCaveat: false });
    if (!gl) {
      // distinguish "this browser has no WebGL2" from "we ran out of contexts"
      const gl1 = canvas.getContext("webgl");
      cached = gl1
        ? { ok: false, reason: "only WebGL 1 available — three.js needs WebGL 2" }
        : { ok: false, reason: "no WebGL 2 context (GPU blocked, or too many contexts open)" };
      if (gl1) (gl1 as WebGLRenderingContext).getExtension("WEBGL_lose_context")?.loseContext();
      return cached;
    }
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : undefined;
    // hand it straight back — this is the whole point
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    cached = { ok: true, reason: "ok", renderer };
    return cached;
  } catch (e) {
    cached = { ok: false, reason: `WebGL threw: ${(e as Error).message}` };
    return cached;
  } finally {
    if (canvas) { canvas.width = 0; canvas.height = 0; }
  }
}

/** Let a false negative be recoverable rather than sticky for the session. */
export function resetWebGLProbe() { cached = null; }
