import fogFragSrc from "../shaders/primitive-fog/primitive-fog.frag.glsl?raw";
import fogVertSrc from "../shaders/primitive-fog/primitive-fog.vert.glsl?raw";
import {
  createMapQuad,
  createProgram,
  createTexture2D,
  shaderSrc,
} from "../utils/GlUtils";

export class PrimitiveFogPass {
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly tex: WebGLTexture;
  private readonly uCamera: WebGLUniformLocation;
  private readonly uTime: WebGLUniformLocation | null;
  private active = false;
  private uploadedOnce = false;

  constructor(
    private readonly gl: WebGL2RenderingContext,
    private readonly mapW: number,
    private readonly mapH: number,
  ) {
    this.program = createProgram(
      gl,
      shaderSrc(fogVertSrc, { MAP_W: mapW, MAP_H: mapH }),
      shaderSrc(fogFragSrc, { MAP_W: mapW, MAP_H: mapH }),
    );
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime");
    this.vao = createMapQuad(gl, mapW, mapH);
    this.tex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.R8,
      format: gl.RED,
      type: gl.UNSIGNED_BYTE,
      data: new Uint8Array(mapW * mapH),
      filter: gl.LINEAR,
    });

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uFog"), 0);
  }

  /** The R8 per-tile fog byte texture — shared read-only with the territory
   *  and border-stamp passes so rival territory can hide under unseen fog. */
  get texture(): WebGLTexture {
    return this.tex;
  }

  update(data: Uint8Array | null, dirty: boolean): void {
    if (data === null) {
      this.active = false;
      return;
    }
    this.active = true;
    if (!dirty && this.uploadedOnce) return;

    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.mapW,
      this.mapH,
      gl.RED,
      gl.UNSIGNED_BYTE,
      data,
    );
    this.uploadedOnce = true;
  }

  draw(cameraMatrix: Float32Array): void {
    if (!this.active) return;
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    if (this.uTime !== null) {
      gl.uniform1f(this.uTime, performance.now() / 1000);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteTexture(this.tex);
  }
}
