/**
 * FxFlashPass — a full-screen additive color wash for big moments (nuke
 * detonations, Golden Age, era advance, being wiped out).
 *
 * Each flash is a single-decay envelope: a very short linear attack (so the
 * first frame doesn't pop) into a quadratic ease-out. Flashes never strobe,
 * and the combined intensity is hard-capped by `settings.fx.flashMaxAlpha`
 * so the map always stays readable. Drawn last in the overlay phase with
 * additive blending; the DOM HUD sits above the canvas and is unaffected.
 */

import type { RenderSettings } from "../../RenderSettings";
import { createProgram } from "../../utils/GlUtils";

import flashFragSrc from "../../shaders/fx/flash.frag.glsl?raw";
import flashVertSrc from "../../shaders/fx/flash.vert.glsl?raw";

interface ActiveFlash {
  r: number;
  g: number;
  b: number;
  peak: number;
  startMs: number;
  durationMs: number;
}

// Fraction of the duration spent ramping up — keeps the onset from popping.
const ATTACK_FRACTION = 0.06;

/**
 * Envelope for a flash at normalized time t in [0,1]: short linear attack,
 * then quadratic ease-out. Pure — exported for unit tests.
 */
export function flashEnvelope(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  if (t < ATTACK_FRACTION) return t / ATTACK_FRACTION;
  const d = (t - ATTACK_FRACTION) / (1 - ATTACK_FRACTION);
  return (1 - d) * (1 - d);
}

export class FxFlashPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;

  private program: WebGLProgram;
  private uColor: WebGLUniformLocation;
  private vao: WebGLVertexArrayObject;

  private active: ActiveFlash[] = [];
  private timeFn: () => number = () => performance.now();

  constructor(gl: WebGL2RenderingContext, settings: RenderSettings) {
    this.gl = gl;
    this.settings = settings;
    this.program = createProgram(gl, flashVertSrc, flashFragSrc);
    this.uColor = gl.getUniformLocation(this.program, "uColor")!;
    // The vertex shader generates the fullscreen triangle from gl_VertexID —
    // the VAO exists only because core WebGL2 requires one to be bound.
    this.vao = gl.createVertexArray()!;
  }

  /** Queue a wash. `alpha` is the requested peak; the cap is applied at draw. */
  push(
    r: number,
    g: number,
    b: number,
    alpha: number,
    durationMs: number,
  ): void {
    if (!(alpha > 0) || !(durationMs > 0)) return;
    this.active.push({
      r,
      g,
      b,
      peak: alpha,
      startMs: this.timeFn(),
      durationMs,
    });
  }

  draw(): void {
    if (this.active.length === 0) return;
    const now = this.timeFn();

    // Combine all live flashes into one weighted wash, capped for readability.
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    this.active = this.active.filter((f) => {
      const t = (now - f.startMs) / f.durationMs;
      if (t >= 1) return false;
      const w = f.peak * flashEnvelope(t);
      r += f.r * w;
      g += f.g * w;
      b += f.b * w;
      a += w;
      return true;
    });
    if (a < 0.002) return;
    const cap = Math.min(a, this.settings.fx.flashMaxAlpha);
    // Normalize the color to the summed weight, then apply the capped alpha.
    r /= a;
    g /= a;
    b /= a;

    const gl = this.gl;
    gl.useProgram(this.program);
    gl.bindVertexArray(this.vao);
    // Additive wash; restore the overlay phase's standard alpha blending after.
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    gl.uniform4f(this.uColor, r, g, b, cap);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    this.active = [];
  }
}
