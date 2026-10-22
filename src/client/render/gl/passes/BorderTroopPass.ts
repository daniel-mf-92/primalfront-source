/**
 * BorderTroopPass — era-styled figures standing on territory borders, and a
 * clash figure wherever one owner is attacking another (see BorderTroops.ts
 * for how the spots are chosen). Presentation only, one instanced draw.
 */
import type { BorderTroop } from "../../../BorderTroops";
import { DynamicInstanceBuffer } from "../DynamicBuffer";
import type { RenderSettings } from "../RenderSettings";
import { createProgram } from "../utils/GlUtils";

import fragSrc from "../shaders/border-troop/border-troop.frag.glsl?raw";
import vertSrc from "../shaders/border-troop/border-troop.vert.glsl?raw";

const FLOATS_PER_INSTANCE = 8;
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;

export class BorderTroopPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private program: WebGLProgram;
  private uCamera: WebGLUniformLocation;
  private uZoom: WebGLUniformLocation;
  private uSize: WebGLUniformLocation;
  private uMinPx: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uGlobalAlpha: WebGLUniformLocation;
  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;
  private instanceCount = 0;

  constructor(gl: WebGL2RenderingContext, settings: RenderSettings) {
    this.gl = gl;
    this.settings = settings;
    this.program = createProgram(gl, vertSrc, fragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uZoom = gl.getUniformLocation(this.program, "uZoom")!;
    this.uSize = gl.getUniformLocation(this.program, "uSize")!;
    this.uMinPx = gl.getUniformLocation(this.program, "uMinPx")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    this.uGlobalAlpha = gl.getUniformLocation(this.program, "uGlobalAlpha")!;

    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      gl.createBuffer()!,
      256,
      FLOATS_PER_INSTANCE,
    );
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
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
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 16);
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
  }

  update(troops: ReadonlyArray<BorderTroop>): void {
    this.instanceBuf.ensureCapacity(Math.max(1, troops.length));
    const f = this.instanceBuf.float32;
    let slot = 0;
    for (const t of troops) {
      const o = slot * FLOATS_PER_INSTANCE;
      f[o] = t.x;
      f[o + 1] = t.y;
      f[o + 2] = t.kind;
      f[o + 3] = t.age;
      f[o + 4] = t.color[0];
      f[o + 5] = t.color[1];
      f[o + 6] = t.color[2];
      f[o + 7] = t.facing;
      slot++;
    }
    this.instanceCount = slot;
    if (slot === 0) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, f, 0, slot * FLOATS_PER_INSTANCE);
  }

  draw(cameraMatrix: Float32Array, zoom: number): void {
    if (this.instanceCount === 0) return;
    const rs = this.settings.borderTroop;
    const fadeStart = rs.minZoom - rs.fadeRange;
    if (zoom <= fadeStart) return;
    const fade =
      zoom >= rs.minZoom
        ? 1
        : (zoom - fadeStart) / Math.max(rs.fadeRange, 1e-4);
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uZoom, zoom);
    gl.uniform1f(this.uSize, rs.size);
    gl.uniform1f(this.uMinPx, rs.minPx);
    gl.uniform1f(this.uTime, performance.now() / 1000);
    gl.uniform1f(this.uGlobalAlpha, rs.alpha * fade);
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
