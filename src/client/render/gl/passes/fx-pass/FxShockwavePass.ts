/**
 * FxShockwavePass — instanced procedural ring quads.
 *
 * Spawned alongside sprite FX for nuke and SAM interception events.
 * Uses an SDF circle rendered in a unit quad, no texture required.
 */

import { DynamicInstanceBuffer } from "../../DynamicBuffer";
import type { RenderSettings } from "../../RenderSettings";
import { createProgram } from "../../utils/GlUtils";

import shockwaveFragSrc from "../../shaders/fx/shockwave.frag.glsl?raw";
import shockwaveVertSrc from "../../shaders/fx/shockwave.vert.glsl?raw";

// ---------------------------------------------------------------------------
// Active state
// ---------------------------------------------------------------------------

interface ActiveShockwave {
  x: number;
  y: number;
  startMs: number;
  durationMs: number;
  maxRadius: number;
  r: number;
  g: number;
  b: number;
}

// ---------------------------------------------------------------------------
// Instance data layout: x, y, radius, alpha, r, g, b
// ---------------------------------------------------------------------------

const SHOCKWAVE_FLOATS = 7;

// ---------------------------------------------------------------------------
// FxShockwavePass
// ---------------------------------------------------------------------------

export class FxShockwavePass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;

  private program: WebGLProgram;
  private uCamera: WebGLUniformLocation;
  private uRingWidth: WebGLUniformLocation;
  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;
  private shockwaveCount = 0;

  private active: ActiveShockwave[] = [];
  private timeFn: () => number = () => performance.now();

  constructor(gl: WebGL2RenderingContext, settings: RenderSettings) {
    this.gl = gl;
    this.settings = settings;

    this.program = createProgram(gl, shockwaveVertSrc, shockwaveFragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uRingWidth = gl.getUniformLocation(this.program, "uRingWidth")!;

    const glBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      glBuf,
      16,
      SHOCKWAVE_FLOATS,
    );

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const stride = SHOCKWAVE_FLOATS * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, glBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);
    // Per-instance ring color (raid strikes are gold/crimson, nukes/SAM white).
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 16);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
  }

  // -------------------------------------------------------------------------
  // Spawning
  // -------------------------------------------------------------------------

  pushNukeShockwave(x: number, y: number, nukeRadius: number): void {
    const fx = this.settings.fx;
    this.active.push({
      x,
      y,
      startMs: this.timeFn(),
      durationMs: fx.nukeShockwaveDurationMs,
      maxRadius: nukeRadius * fx.nukeShockwaveRadiusFactor,
      r: 1,
      g: 1,
      b: 1,
    });
  }

  pushSAMShockwave(x: number, y: number): void {
    const fx = this.settings.fx;
    this.active.push({
      x,
      y,
      startMs: this.timeFn(),
      durationMs: fx.samShockwaveDurationMs,
      maxRadius: fx.samShockwaveRadius,
      r: 1,
      g: 1,
      b: 1,
    });
  }

  // Raid strike: a rapid triple pulse of gold→ember→crimson rings at the raided
  // tile, so a wealth-raid reads as a punchy hit on the enemy instead of a
  // silent number change (owner direction 2026-07-04: "raiding not look cool").
  pushRaidStrike(x: number, y: number): void {
    const now = this.timeFn();
    const rings: {
      color: [number, number, number];
      radius: number;
      dur: number;
      delay: number;
    }[] = [
      { color: [1.0, 0.84, 0.4], radius: 11.0, dur: 700, delay: 0 },
      { color: [1.0, 0.6, 0.26], radius: 17.0, dur: 820, delay: 130 },
      { color: [0.95, 0.3, 0.22], radius: 24.0, dur: 940, delay: 270 },
    ];
    for (const ring of rings) {
      this.active.push({
        x,
        y,
        startMs: now + ring.delay,
        durationMs: ring.dur,
        maxRadius: ring.radius,
        r: ring.color[0],
        g: ring.color[1],
        b: ring.color[2],
      });
    }
  }

  // -------------------------------------------------------------------------
  // Tick
  // -------------------------------------------------------------------------

  tick(): void {
    if (this.active.length === 0) return;
    const now = this.timeFn();

    for (let i = this.active.length - 1; i >= 0; i--) {
      if (now - this.active[i].startMs >= this.active[i].durationMs) {
        this.active[i] = this.active[this.active.length - 1];
        this.active.pop();
      }
    }

    this.rebuildInstances(now);
  }

  private rebuildInstances(now: number): void {
    const count = this.active.length;
    this.instanceBuf.ensureCapacity(count);

    const data = this.instanceBuf.float32;
    for (let i = 0; i < count; i++) {
      const sw = this.active[i];
      const rawT = (now - sw.startMs) / sw.durationMs;
      // Staggered raid rings have a future startMs (rawT < 0) — keep them
      // invisible (alpha 0) until they fire.
      const t = rawT < 0 ? 0 : rawT;
      const off = i * SHOCKWAVE_FLOATS;
      data[off + 0] = sw.x;
      data[off + 1] = sw.y;
      data[off + 2] = t * sw.maxRadius;
      data[off + 3] = rawT < 0 ? 0 : 1 - t;
      data[off + 4] = sw.r;
      data[off + 5] = sw.g;
      data[off + 6] = sw.b;
    }

    this.shockwaveCount = count;
  }

  // -------------------------------------------------------------------------
  // Draw
  // -------------------------------------------------------------------------

  draw(cameraMatrix: Float32Array): void {
    if (this.shockwaveCount === 0) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    // Set our own alpha-blend state instead of inheriting whatever the previous
    // pass left bound — a prior pass leaving BLEND disabled (or an odd func) was
    // silently dropping these rings. Depth off so the ring composites over the
    // map like the other 2D overlays.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uRingWidth, this.settings.fx.shockwaveRingWidth);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      this.instanceBuf.float32,
      0,
      this.shockwaveCount * SHOCKWAVE_FLOATS,
    );
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.shockwaveCount);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  setTimeFn(fn: () => number): void {
    this.timeFn = fn;
  }

  clear(): void {
    this.active.length = 0;
    this.shockwaveCount = 0;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.instanceBuf.dispose();
    gl.deleteVertexArray(this.vao);
  }
}
