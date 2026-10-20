/**
 * MammothHerdPass — GPU-rendered mammoth herds (Module §11).
 *
 * Draws one woolly-brown beast sprite per mammoth herd in a single instanced
 * call, fog- and zoom-gated exactly like ResourceNodePass (its template). Herds
 * are FEW (≤ ~10) and slowly drifting, and live only in the simulation
 * (MammothHerdExecution); the client receives their tile positions each tick via
 * a MammothHerd GameUpdate and pushes them here. Sprite size scales with herd
 * size; alpha fades as a herd is hunted/dies out.
 *
 * Presentation only — never mutates sim state, no RNG affecting the sim.
 */

import { DynamicInstanceBuffer } from "../DynamicBuffer";
import type { RenderSettings } from "../RenderSettings";
import { createProgram } from "../utils/GlUtils";

import mammothFragSrc from "../shaders/mammoth-herd/mammoth-herd.frag.glsl?raw";
import mammothVertSrc from "../shaders/mammoth-herd/mammoth-herd.vert.glsl?raw";

export interface MammothHerdSprite {
  tile: number;
  size: number;
}

// Per-instance layout: x, y, size, alpha (vec4).
const FLOATS_PER_INSTANCE = 4;
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;

export class MammothHerdPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private program: WebGLProgram;

  private uCamera: WebGLUniformLocation;
  private uZoom: WebGLUniformLocation;
  private uNodeSize: WebGLUniformLocation;
  private uMinPx: WebGLUniformLocation;
  private uHerdColor: WebGLUniformLocation;
  private uGlobalAlpha: WebGLUniformLocation;

  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;
  private instanceCount = 0;

  private mapW: number;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = mapW;

    this.program = createProgram(gl, mammothVertSrc, mammothFragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uZoom = gl.getUniformLocation(this.program, "uZoom")!;
    this.uNodeSize = gl.getUniformLocation(this.program, "uNodeSize")!;
    this.uMinPx = gl.getUniformLocation(this.program, "uMinPx")!;
    this.uHerdColor = gl.getUniformLocation(this.program, "uHerdColor")!;
    this.uGlobalAlpha = gl.getUniformLocation(this.program, "uGlobalAlpha")!;

    const instanceGlBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      instanceGlBuf,
      64,
      FLOATS_PER_INSTANCE,
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

    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.bindVertexArray(null);
  }

  /**
   * Push the current herd snapshot. Herds are few; rebuild the instance buffer
   * each push. `isVisible` is the fog test (reuses the resource-visibility rule):
   * a herd renders only if the local player can see its tile (owned/adjacent/
   * scout). When absent (replay/headless), all herds render.
   */
  update(
    herds: ReadonlyArray<MammothHerdSprite>,
    isVisible?: (tile: number) => boolean,
  ): void {
    this.instanceBuf.ensureCapacity(Math.max(1, herds.length));
    let slot = 0;
    for (const h of herds) {
      if (h.size <= 0) continue;
      if (isVisible !== undefined && !isVisible(h.tile)) continue;
      this.writeHerd(slot, h.tile, h.size);
      slot++;
    }
    this.instanceCount = slot;
    if (slot === 0) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      this.instanceBuf.float32,
      0,
      slot * FLOATS_PER_INSTANCE,
    );
  }

  private writeHerd(slot: number, tile: number, size: number): void {
    const off = slot * FLOATS_PER_INSTANCE;
    const x = tile % this.mapW;
    const y = (tile - x) / this.mapW;
    // Fade a dwindling (hunted/dying) herd: full at size>=12, faint as it nears 0.
    const alpha = 0.45 + 0.55 * Math.min(1, size / 12);
    const f = this.instanceBuf.float32;
    f[off + 0] = x;
    f[off + 1] = y;
    f[off + 2] = size;
    f[off + 3] = alpha;
  }

  draw(cameraMatrix: Float32Array, zoom: number): void {
    if (this.instanceCount === 0) return;

    const rs = this.settings.mammothHerd;
    // Zoom gate (same shape as ResourceNodePass): hidden at overview scale, fades
    // in as the player zooms toward the herds.
    const fadeStart = rs.minZoom - rs.fadeRange;
    if (zoom <= fadeStart) return;
    const zoomFade =
      zoom >= rs.minZoom
        ? 1
        : (zoom - fadeStart) / Math.max(rs.fadeRange, 1e-4);

    const gl = this.gl;
    gl.useProgram(this.program);

    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uZoom, zoom);
    gl.uniform1f(this.uNodeSize, rs.nodeSize);
    gl.uniform1f(this.uMinPx, rs.minPx);
    gl.uniform3f(this.uHerdColor, rs.herdR, rs.herdG, rs.herdB);
    gl.uniform1f(this.uGlobalAlpha, rs.alpha * zoomFade);

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.instanceBuf.dispose();
    gl.deleteVertexArray(this.vao);
  }
}
