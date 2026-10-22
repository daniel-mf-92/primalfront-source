/**
 * ResourceNodePass — GPU-rendered natural resource nodes.
 *
 * The sim stores tile resource kind/quantity. Each node draws as a small
 * parchment disc with an ink emblem from the shared badge atlas (pine tree,
 * stone cairn, salmon; game-icons.net, CC BY 3.0). Owned resources smoulder
 * faintly, resources in current primitive sight outside territory breathe a
 * bloom, and remembered/out-of-sight resources do not render.
 */

import { ResourceKind } from "../../../../core/game/Game";
import {
  BADGE_CELLS,
  BADGE_TEXTURE_UNIT,
  badgeAtlasTexture,
  bindBadgeAtlas,
} from "../BadgeAtlas";
import { DynamicInstanceBuffer } from "../DynamicBuffer";
import type { RenderSettings } from "../RenderSettings";
import { createProgram } from "../utils/GlUtils";

import resourceNodeFragSrc from "../shaders/resource-node/resource-node.frag.glsl?raw";
import resourceNodeVertSrc from "../shaders/resource-node/resource-node.vert.glsl?raw";

export interface ResourceMapView {
  width(): number;
  forEachTile(fn: (tile: number) => void): void;
  resourceAt(tile: number): { kind: ResourceKind; quantity: number };
  drainResourceUpdates?(): number[];
  isResourceVisible?(tile: number): boolean;
  resourceVisibilityState?(tile: number): number;
  primitiveResourceView?(): boolean;
}

const RESOURCE_HIDDEN = 0;
const RESOURCE_IN_TERRITORY = 1;
const RESOURCE_VISIBLE_OUTSIDE_TERRITORY = 2;

const FLOATS_PER_INSTANCE = 8;
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;
const FALLBACK_RESCAN_INTERVAL = 30;
const GONE_ANIMATION_MS = 900;
const MAX_VISUAL_QUANTITY = 40;

type NodeRecord = {
  kind: ResourceKind;
  quantity: number;
  deathStartMs: number | null;
  lastVisibilityState: number;
};

export class ResourceNodePass {
  private gl: WebGL2RenderingContext;
  private settings: RenderSettings;
  private program: WebGLProgram;

  private uCamera: WebGLUniformLocation;
  private uZoom: WebGLUniformLocation;
  private uNodeSize: WebGLUniformLocation;
  private uMinPx: WebGLUniformLocation;
  private uGlobalAlpha: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;
  private atlas: WebGLTexture;

  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;
  private instanceCount = 0;

  private mapW: number;
  private allNodes = new Map<number, NodeRecord>();
  private builtOnce = false;
  private pushCount = 0;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    settings: RenderSettings,
  ) {
    this.gl = gl;
    this.settings = settings;
    this.mapW = mapW;

    this.program = createProgram(gl, resourceNodeVertSrc, resourceNodeFragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uZoom = gl.getUniformLocation(this.program, "uZoom")!;
    this.uNodeSize = gl.getUniformLocation(this.program, "uNodeSize")!;
    this.uMinPx = gl.getUniformLocation(this.program, "uMinPx")!;
    this.uGlobalAlpha = gl.getUniformLocation(this.program, "uGlobalAlpha")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;
    gl.useProgram(this.program);
    gl.uniform1i(
      gl.getUniformLocation(this.program, "uAtlas"),
      BADGE_TEXTURE_UNIT,
    );
    gl.uniform1f(gl.getUniformLocation(this.program, "uCells"), BADGE_CELLS);
    this.atlas = badgeAtlasTexture(gl);

    const instanceGlBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      instanceGlBuf,
      1024,
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
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 4 * 4);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
  }

  update(map: ResourceMapView): void {
    this.pushCount++;
    const nowMs = performance.now();
    const primitiveMode = map.primitiveResourceView?.() ?? false;
    if (!primitiveMode) this.dropPrimitiveOnlyNodes();
    this.maintainNodes(map, nowMs, primitiveMode);
    this.rebuildVisible(map, nowMs, primitiveMode);
  }

  private maintainNodes(
    map: ResourceMapView,
    nowMs: number,
    primitiveMode: boolean,
  ): void {
    if (!this.builtOnce) {
      this.rescan(map, nowMs, primitiveMode);
      this.builtOnce = true;
      return;
    }

    const drain = map.drainResourceUpdates?.bind(map);
    if (drain) {
      for (const tile of drain()) {
        this.applyTileState(map, tile, nowMs, primitiveMode);
      }
    } else if (this.pushCount % FALLBACK_RESCAN_INTERVAL === 0) {
      this.rescan(map, nowMs, primitiveMode);
    }
  }

  private rescan(
    map: ResourceMapView,
    nowMs: number,
    primitiveMode: boolean,
  ): void {
    if (!primitiveMode) {
      this.allNodes.clear();
      map.forEachTile((tile) => {
        const { kind, quantity } = map.resourceAt(tile);
        if (this.isDrawable(kind, primitiveMode) && quantity > 0) {
          this.allNodes.set(tile, {
            kind,
            quantity,
            deathStartMs: null,
            lastVisibilityState: RESOURCE_VISIBLE_OUTSIDE_TERRITORY,
          });
        }
      });
      return;
    }

    const seen = new Set<number>();
    map.forEachTile((tile) => {
      const { kind, quantity } = map.resourceAt(tile);
      if (this.isDrawable(kind, primitiveMode) && quantity > 0) {
        seen.add(tile);
        const existing = this.allNodes.get(tile);
        this.allNodes.set(tile, {
          kind,
          quantity,
          deathStartMs: null,
          lastVisibilityState:
            existing?.lastVisibilityState ?? RESOURCE_VISIBLE_OUTSIDE_TERRITORY,
        });
      }
    });

    for (const [tile, node] of this.allNodes) {
      if (seen.has(tile) || node.deathStartMs !== null) continue;
      node.quantity = 0;
      node.deathStartMs = nowMs;
    }
  }

  private applyTileState(
    map: ResourceMapView,
    tile: number,
    nowMs: number,
    primitiveMode: boolean,
  ): void {
    const { kind, quantity } = map.resourceAt(tile);
    const existing = this.allNodes.get(tile);
    if (this.isDrawable(kind, primitiveMode) && quantity > 0) {
      this.allNodes.set(tile, {
        kind,
        quantity,
        deathStartMs: null,
        lastVisibilityState:
          existing?.lastVisibilityState ?? RESOURCE_VISIBLE_OUTSIDE_TERRITORY,
      });
      return;
    }

    if (!primitiveMode) {
      this.allNodes.delete(tile);
      return;
    }

    if (existing !== undefined && existing.deathStartMs === null) {
      existing.quantity = 0;
      existing.deathStartMs = nowMs;
    }
  }

  private rebuildVisible(
    map: ResourceMapView,
    nowMs: number,
    primitiveMode: boolean,
  ): void {
    this.instanceBuf.ensureCapacity(this.allNodes.size);
    const expired: number[] = [];
    let slot = 0;

    for (const [tile, node] of this.allNodes) {
      if (!this.isDrawable(node.kind, primitiveMode)) continue;
      const deathProgress =
        node.deathStartMs === null
          ? 0
          : Math.min(1, (nowMs - node.deathStartMs) / GONE_ANIMATION_MS);
      if (deathProgress >= 1) {
        expired.push(tile);
        continue;
      }

      const state = this.visibilityState(map, tile, node);
      if (state === RESOURCE_HIDDEN) continue;
      this.writeNode(slot, tile, node, state, deathProgress, primitiveMode);
      slot++;
    }

    for (const tile of expired) {
      this.allNodes.delete(tile);
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

  private visibilityState(
    map: ResourceMapView,
    tile: number,
    node: NodeRecord,
  ): number {
    const raw = map.resourceVisibilityState?.(tile);
    if (raw !== undefined) {
      if (raw === RESOURCE_IN_TERRITORY) {
        node.lastVisibilityState = RESOURCE_IN_TERRITORY;
        return raw;
      }
      if (raw === RESOURCE_VISIBLE_OUTSIDE_TERRITORY) {
        node.lastVisibilityState = RESOURCE_VISIBLE_OUTSIDE_TERRITORY;
        return raw;
      }
      return RESOURCE_HIDDEN;
    }

    const visible = map.isResourceVisible?.(tile) ?? true;
    if (!visible) return RESOURCE_HIDDEN;
    return node.lastVisibilityState || RESOURCE_VISIBLE_OUTSIDE_TERRITORY;
  }

  private isDrawable(kind: ResourceKind, primitiveMode: boolean): boolean {
    if (kind === ResourceKind.None) return false;
    if (kind === ResourceKind.Fish && !primitiveMode) return false;
    return true;
  }

  private writeNode(
    slot: number,
    tile: number,
    node: NodeRecord,
    visibilityState: number,
    deathProgress: number,
    primitiveMode: boolean,
  ): void {
    const off = slot * FLOATS_PER_INSTANCE;
    const x = tile % this.mapW;
    const y = (tile - x) / this.mapW;
    const quantityRatio = primitiveMode
      ? Math.max(0.08, Math.min(1, node.quantity / MAX_VISUAL_QUANTITY))
      : 1;
    const alpha = primitiveMode
      ? node.deathStartMs === null
        ? 0.62 + 0.38 * Math.sqrt(quantityRatio)
        : 1 - deathProgress
      : 0.7 + 0.3 * Math.min(1, node.quantity / 8);

    const f = this.instanceBuf.float32;
    f[off + 0] = x;
    f[off + 1] = y;
    f[off + 2] = node.kind;
    f[off + 3] = visibilityState;
    f[off + 4] = quantityRatio;
    f[off + 5] = alpha;
    f[off + 6] = primitiveMode ? deathProgress : 0;
    f[off + 7] = primitiveMode ? 1 : 0;
  }

  private dropPrimitiveOnlyNodes(): void {
    for (const [tile, node] of this.allNodes) {
      if (node.deathStartMs !== null || node.kind === ResourceKind.Fish) {
        this.allNodes.delete(tile);
      }
    }
  }

  draw(cameraMatrix: Float32Array, zoom: number): void {
    if (this.instanceCount === 0) return;

    const rs = this.settings.resourceNode;
    const fadeStart = rs.minZoom - rs.fadeRange;
    if (zoom <= fadeStart) return;
    const zoomFade =
      zoom >= rs.minZoom
        ? 1
        : (zoom - fadeStart) / Math.max(rs.fadeRange, 1e-4);

    const gl = this.gl;
    gl.useProgram(this.program);
    bindBadgeAtlas(gl, this.atlas);

    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uZoom, zoom);
    gl.uniform1f(this.uNodeSize, rs.nodeSize);
    gl.uniform1f(this.uMinPx, rs.minPx);
    gl.uniform1f(this.uGlobalAlpha, rs.alpha * zoomFade);
    gl.uniform1f(this.uTime, (performance.now() / 1000) % 3600);

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
