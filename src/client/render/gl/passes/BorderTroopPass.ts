/**
 * BorderTroopPass — era badges standing on territory borders, and a clash
 * badge wherever one owner is attacking another (see BorderTroops.ts for how
 * the spots are chosen). Presentation only, one instanced draw.
 *
 * Each troop is a small parchment medallion: ink outline, team-colour ring and
 * the era emblem in ink from the shared badge atlas (game-icons.net, CC BY
 * 3.0). Clashes swap the ring for ember red and show crossed swords.
 *
 * Animation lives here, not in the sim: the spot list arrives about once a
 * second, keyed per owner and grid cell. The pass keeps a display copy of each
 * troop and eases it toward its target every frame, so guards glide as borders
 * move, fade in when they appear and fade out when they go. A new key close to
 * a just-vanished one of the same owner and kind adopts it (it glides there
 * instead of blinking out and in). The shader adds the idle bob and the clash
 * pulse from a per-troop phase.
 */
import type { BorderTroop } from "../../../BorderTroops";
import { TROOP_CELL } from "../../../BorderTroops";
import {
  BADGE_CELLS,
  BADGE_CLASH,
  BADGE_TEXTURE_UNIT,
  badgeAtlasTexture,
  bindBadgeAtlas,
} from "../BadgeAtlas";
import { DynamicInstanceBuffer } from "../DynamicBuffer";
import type { RenderSettings } from "../RenderSettings";
import { createProgram } from "../utils/GlUtils";

import fragSrc from "../shaders/border-troop/border-troop.frag.glsl?raw";
import vertSrc from "../shaders/border-troop/border-troop.vert.glsl?raw";

// x, y, kind, cell | r, g, b, alpha | seed, appear
const FLOATS_PER_INSTANCE = 10;
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;
/** Seconds to fade a troop fully in or out. */
const FADE_SECONDS = 0.4;
/** Glide speed: fraction of the remaining distance closed per second (exp). */
const GLIDE_RATE = 5;
/** A new spot this close (tiles) to a vanished troop of the same owner adopts it. */
const ADOPT_RADIUS = TROOP_CELL * 2.2;
/** If the pass was not drawn for this long, snap instead of animating. */
const SNAP_AFTER_MS = 1500;

interface DisplayTroop {
  key: number;
  owner: number;
  kind: number;
  age: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  color: [number, number, number];
  alpha: number;
  alive: boolean;
  seed: number;
}

export class BorderTroopPass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private program: WebGLProgram;
  private uCamera: WebGLUniformLocation;
  private uZoom: WebGLUniformLocation;
  private uSize: WebGLUniformLocation;
  private uMinPx: WebGLUniformLocation;
  private uMaxPx: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private uGlobalAlpha: WebGLUniformLocation;
  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;
  private atlas: WebGLTexture;
  private troops = new Map<number, DisplayTroop>();
  private lastDrawMs = -Infinity;

  constructor(gl: WebGL2RenderingContext, settings: RenderSettings) {
    this.gl = gl;
    this.settings = settings;
    this.program = createProgram(gl, vertSrc, fragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uZoom = gl.getUniformLocation(this.program, "uZoom")!;
    this.uSize = gl.getUniformLocation(this.program, "uSize")!;
    this.uMinPx = gl.getUniformLocation(this.program, "uMinPx")!;
    this.uMaxPx = gl.getUniformLocation(this.program, "uMaxPx")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    this.uGlobalAlpha = gl.getUniformLocation(this.program, "uGlobalAlpha")!;
    gl.useProgram(this.program);
    gl.uniform1i(
      gl.getUniformLocation(this.program, "uAtlas"),
      BADGE_TEXTURE_UNIT,
    );
    gl.uniform1f(gl.getUniformLocation(this.program, "uCells"), BADGE_CELLS);
    this.atlas = badgeAtlasTexture(gl);

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
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, BYTES_PER_INSTANCE, 32);
    gl.vertexAttribDivisor(3, 1);
    gl.bindVertexArray(null);
  }

  /** New target spots (about once a second). */
  update(next: ReadonlyArray<BorderTroop>): void {
    const snap = performance.now() - this.lastDrawMs > SNAP_AFTER_MS;
    const incoming = new Map<number, BorderTroop>();
    for (const t of next) incoming.set(t.key, t);

    // Troops whose key vanished this round: candidates for adoption.
    const orphans: DisplayTroop[] = [];
    for (const d of this.troops.values()) {
      if (!incoming.has(d.key) && d.alive) orphans.push(d);
    }

    for (const t of next) {
      let d = this.troops.get(t.key);
      if (d === undefined && !snap) {
        let best = -1;
        let bestDist = ADOPT_RADIUS * ADOPT_RADIUS;
        for (let i = 0; i < orphans.length; i++) {
          const o = orphans[i];
          if (o.owner !== t.owner || o.kind !== t.kind) continue;
          const dx = o.x - t.x;
          const dy = o.y - t.y;
          const dist = dx * dx + dy * dy;
          if (dist < bestDist) {
            bestDist = dist;
            best = i;
          }
        }
        if (best >= 0) {
          d = orphans[best];
          orphans[best] = orphans[orphans.length - 1];
          orphans.pop();
          this.troops.delete(d.key);
          d.key = t.key;
          this.troops.set(t.key, d);
        }
      }
      if (d === undefined) {
        d = {
          key: t.key,
          owner: t.owner,
          kind: t.kind,
          age: t.age,
          x: t.x,
          y: t.y,
          tx: t.x,
          ty: t.y,
          color: t.color,
          alpha: snap ? 1 : 0,
          alive: true,
          seed: fract(t.key * 0.6180339887 + t.owner * 0.1234567),
        };
        this.troops.set(t.key, d);
      }
      d.tx = t.x;
      d.ty = t.y;
      d.age = t.age;
      d.color = t.color;
      d.alive = true;
      if (snap) {
        d.x = t.x;
        d.y = t.y;
        d.alpha = 1;
      }
    }
    for (const o of orphans) o.alive = false;
    if (snap) {
      for (const [k, d] of this.troops) if (!d.alive) this.troops.delete(k);
    }
  }

  draw(cameraMatrix: Float32Array, zoom: number): void {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastDrawMs) / 1000));
    this.lastDrawMs = now;
    if (this.troops.size === 0) return;
    // Ease every display troop toward its target and write the instances.
    this.instanceBuf.ensureCapacity(this.troops.size);
    const f = this.instanceBuf.float32;
    const glide = 1 - Math.exp(-GLIDE_RATE * dt);
    const fadeStep = dt / FADE_SECONDS;
    let n = 0;
    for (const [k, d] of this.troops) {
      d.alpha = d.alive
        ? Math.min(1, d.alpha + fadeStep)
        : Math.max(0, d.alpha - fadeStep);
      if (!d.alive && d.alpha <= 0) {
        this.troops.delete(k);
        continue;
      }
      d.x += (d.tx - d.x) * glide;
      d.y += (d.ty - d.y) * glide;
      const o = n * FLOATS_PER_INSTANCE;
      f[o] = d.x;
      f[o + 1] = d.y;
      f[o + 2] = d.kind;
      f[o + 3] = d.kind === 1 ? BADGE_CLASH : Math.max(0, Math.min(7, d.age));
      f[o + 4] = d.color[0];
      f[o + 5] = d.color[1];
      f[o + 6] = d.color[2];
      f[o + 7] = smooth(d.alpha);
      f[o + 8] = d.seed;
      f[o + 9] = d.alive ? smooth(d.alpha) : 1;
      n++;
    }
    const rs = this.settings.borderTroop;
    const fadeStart = rs.minZoom - rs.fadeRange;
    if (n === 0 || zoom <= fadeStart) return;
    const fade =
      zoom >= rs.minZoom
        ? 1
        : (zoom - fadeStart) / Math.max(rs.fadeRange, 1e-4);

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, f, 0, n * FLOATS_PER_INSTANCE);
    gl.useProgram(this.program);
    bindBadgeAtlas(gl, this.atlas);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uZoom, zoom);
    gl.uniform1f(this.uSize, rs.size);
    gl.uniform1f(this.uMinPx, rs.minPx);
    gl.uniform1f(this.uMaxPx, rs.maxPx);
    gl.uniform1f(this.uTime, (now / 1000) % 3600);
    gl.uniform1f(this.uGlobalAlpha, rs.alpha * fade);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.instanceBuf.dispose();
    gl.deleteVertexArray(this.vao);
  }
}

function fract(v: number): number {
  return v - Math.floor(v);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}
