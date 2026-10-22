/**
 * BadgeAtlas — the shared ink-icon strip used by the border troop badges and
 * the resource node discs (resources/atlases/badge-atlas.png, built by
 * scripts/build-badge-atlas.sh from game-icons.net SVGs, CC BY 3.0, see
 * CREDITS.md). 12 cells of 128 px. Troop and clash cells (0-8) are white on
 * clear and read by alpha only; resource cells (9-11) pack four masks in RGBA
 * (icon, silhouette, outline, halo) for the pictogram shader.
 *
 * One texture per GL context, mipmapped, bound on its own texture unit so it
 * never disturbs the units other passes use.
 */
import { assetUrl } from "src/core/AssetUrls";

const badgeAtlasUrl = assetUrl("atlases/badge-atlas.png");

/** Number of 128 px cells in the strip. */
export const BADGE_CELLS = 12;
/** Cells 0-7: one troop emblem per age (Age value = cell index). */
export const BADGE_TROOP_FIRST = 0;
export const BADGE_CLASH = 8;
export const BADGE_WOOD = 9;
export const BADGE_ROCK = 10;
export const BADGE_FISH = 11;

/** Texture unit reserved for the badge atlas (TerritoryPass uses 0-9). */
export const BADGE_TEXTURE_UNIT = 11;

const cache = new WeakMap<WebGL2RenderingContext, WebGLTexture>();

/** The badge atlas texture for this context (transparent until it loads). */
export function badgeAtlasTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const existing = cache.get(gl);
  if (existing !== undefined) return existing;
  const tex = gl.createTexture()!;
  cache.set(gl, tex);
  const prev = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
  gl.activeTexture(gl.TEXTURE0 + BADGE_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 0]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.activeTexture(prev);
  void load(gl, tex);
  return tex;
}

async function load(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
): Promise<void> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = badgeAtlasUrl;
  try {
    await img.decode();
  } catch {
    return; // Badges then draw without their emblem; never break the frame.
  }
  if (gl.isContextLost()) return;
  const prev = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
  gl.activeTexture(gl.TEXTURE0 + BADGE_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    gl.LINEAR_MIPMAP_LINEAR,
  );
  gl.activeTexture(prev);
}

/** Bind the atlas on its unit for a draw, restoring the active unit after. */
export function bindBadgeAtlas(
  gl: WebGL2RenderingContext,
  tex: WebGLTexture,
): void {
  const prev = gl.getParameter(gl.ACTIVE_TEXTURE) as number;
  gl.activeTexture(gl.TEXTURE0 + BADGE_TEXTURE_UNIT);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.activeTexture(prev);
}
