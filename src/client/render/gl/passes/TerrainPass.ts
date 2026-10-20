/**
 * TerrainPass — renders the terrain map as a textured quad.
 *
 * Initial upload happens once; per-tile updates flow through
 * applyTerrainDelta() so water-nuke conversions (land → water) are reflected
 * live. Vertex shader transforms the map quad by the camera mat3; fragment
 * shader samples the RGBA8 terrain texture with nearest-neighbour filtering
 * so each terrain cell stays pixel-crisp at every zoom level.
 */

import terrainFragSrc from "../shaders/terrain/terrain.frag.glsl?raw";
import terrainVertSrc from "../shaders/terrain/terrain.vert.glsl?raw";
import { encodeTerrainTile } from "../utils/ColorUtils";
import {
  createMapQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "../utils/GlUtils";

// ---------------------------------------------------------------------------
// TerrainPass
// ---------------------------------------------------------------------------

export class TerrainPass {
  private program: WebGLProgram;
  private tex: WebGLTexture;
  private vao: WebGLVertexArrayObject;
  private uCamera: WebGLUniformLocation;
  private uIceExtent: WebGLUniformLocation;
  private uZoom: WebGLUniformLocation;
  private mapW: number;
  // Ice-age cap extent (latitude fraction from each pole). Pushed per tick from
  // the same climate clock used by the sim; 0 = fully receded.
  private iceExtent = 0;
  // Scratch buffer for 1×1 sub-uploads; reused across applyTerrainDelta calls.
  private readonly pixelScratch = new Uint8Array(4);

  constructor(
    private gl: WebGL2RenderingContext,
    terrainRGBA: Uint8Array,
    mapW: number,
    mapH: number,
  ) {
    this.mapW = mapW;
    this.program = createProgram(
      gl,
      shaderSrc(terrainVertSrc, { MAP_W: mapW, MAP_H: mapH }),
      shaderSrc(terrainFragSrc, { MAP_W: mapW, MAP_H: mapH }),
    );
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uIceExtent = gl.getUniformLocation(this.program, "uIceExtent")!;
    this.uZoom = gl.getUniformLocation(this.program, "uZoom")!;

    this.tex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.RGBA8,
      format: gl.RGBA,
      type: gl.UNSIGNED_BYTE,
      data: terrainRGBA,
      // LINEAR = bilinear-blended biomes → smooth coastlines, no pixel steps.
      // Only the terrain *color* layer is smoothed; territory ownership and
      // border textures stay NEAREST so tile boundaries remain pixel-exact.
      filter: gl.LINEAR,
    });

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  /**
   * Update a subset of terrain tiles in-place (e.g. land→water from a water
   * nuke). `bytes[i]` is the new terrain byte for `refs[i]` (parallel arrays).
   * One 1×1 texSubImage2D per ref — fine for the small bursts a single nuke
   * produces.
   */
  applyTerrainDelta(refs: readonly number[], bytes: Uint8Array): void {
    if (refs.length === 0) return;
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (let i = 0; i < refs.length; i++) {
      const ref = refs[i];
      const x = ref % this.mapW;
      const y = (ref - x) / this.mapW;
      encodeTerrainTile(bytes[i], this.pixelScratch, 0);
      gl.texSubImage2D(
        gl.TEXTURE_2D,
        0,
        x,
        y,
        1,
        1,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.pixelScratch,
      );
    }
  }

  /**
   * Ice-age cap extent: latitude fraction from each pole currently frozen.
   * 0 = no ice. Driven by the same climate clock used by carrying capacity.
   */
  setIceExtent(extent: number): void {
    this.iceExtent = extent;
  }

  /** Render the terrain. Call with depth test disabled, no blending.
   *  `zoom` = camera zoom (screen px per world tile) — drives the high-zoom
   *  paper stipple in the fragment shader. */
  draw(cameraMatrix: Float32Array, zoom: number): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uIceExtent, this.iceExtent);
    gl.uniform1f(this.uZoom, zoom);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.tex);
    // VAO + buffer leak is acceptable on dispose (context is being destroyed)
  }
}
