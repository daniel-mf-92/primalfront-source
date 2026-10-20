/**
 * GPU-ready color utilities.
 *
 * Terrain RGBA: Uint8Array(w × h × 4) — one RGBA pixel per tile, computed
 * from the terrain color rules applied to the raw terrain byte layout. RGB is
 * displayed color; alpha stores terrain-class metadata for the terrain shader
 * and is forced back to opaque at output.
 *
 * Player palette is NOT built here — consumers provide a pre-built
 * Float32Array(PALETTE_SIZE × 2 × 4) to the GPURenderer constructor.
 */

/** Must cover 12-bit smallID range (0-4095). */
const PALETTE_SIZE = 4096;

export function getPaletteSize(): number {
  return PALETTE_SIZE;
}

// ---------- Terrain ----------

/**
 * Compute a static RGBA8 texture from raw terrain bytes.
 * The single source of truth for terrain colors.
 *
 * Terrain byte layout per tile:
 *   bit 7: isLand
 *   bit 6: isShoreline
 *   bit 5: isOcean  (water only)
 *   bits 0-4: magnitude (0-31)
 */

// --- Old chart land ramp -----------------------------------------------------
// Continuous elevation tint tuned for a hand-painted nautical chart: warm
// green-gold lowlands, ochre highlands, brown hachure-like mountains, and only
// muted paper-white peaks. Anchors are interpolated so there are no hard bands.
// Terrain magnitudes top out at 30 in shipped maps, so the light peak anchors
// sit at 28–30 rather than 31.
type Stop = readonly [number, number, number, number]; // [magnitude, r, g, b]
const LAND_RAMP: readonly Stop[] = [
  [0, 176, 184, 116], // washed lowland green
  [5, 191, 186, 116], // yellow-green plains
  [9, 207, 187, 123], // dry grass / sunlit steppe
  [13, 204, 174, 123], // ochre foothills
  [17, 190, 158, 119], // warm highland brown
  [21, 174, 142, 111], // inked mountain brown
  [25, 188, 168, 132], // bare rock / parchment shadow
  [28, 207, 194, 162], // old-paper high peaks
  [30, 222, 214, 188], // pale peak highlight
];

// Alpha metadata bands. The terrain pass samples linearly, so these double as
// soft masks around coasts for the fragment shader's paper/chart treatment.
const META_DEEP_WATER = 32;
const META_SHALLOW_WATER = 96;
const META_LAND_SHORE = 160;
const META_LAND = 224;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Interpolated land color for a 0–31 magnitude. */
function landColor(magnitude: number): [number, number, number] {
  const m = magnitude < 0 ? 0 : magnitude > 31 ? 31 : magnitude;
  for (let i = 1; i < LAND_RAMP.length; i++) {
    const hi = LAND_RAMP[i];
    if (m <= hi[0]) {
      const lo = LAND_RAMP[i - 1];
      const span = hi[0] - lo[0];
      const t = span === 0 ? 0 : (m - lo[0]) / span;
      return [
        lerp(lo[1], hi[1], t),
        lerp(lo[2], hi[2], t),
        lerp(lo[3], hi[3], t),
      ];
    }
  }
  const last = LAND_RAMP[LAND_RAMP.length - 1];
  return [last[1], last[2], last[3]];
}

/** Encode one terrain byte → RGBA, writing into `out[offset..offset+3]`.
 *  This is the per-tile BASE color (no relief shading — that needs neighbor
 *  elevations and is layered on in `buildTerrainRGBA`). Also used directly by
 *  the 1×1 nuke-delta path in TerrainPass, where neighbors aren't available. */
export function encodeTerrainTile(
  tb: number,
  out: Uint8Array,
  offset: number,
): void {
  const isLand = (tb & 0x80) !== 0;
  const isShoreline = (tb & 0x40) !== 0;
  const magnitude = tb & 0x1f;

  let r: number, g: number, b: number;

  if (isLand && isShoreline) {
    // Dry parchment beach, ready to receive the CPU-side ink edge.
    r = 215;
    g = 190;
    b = 121;
  } else if (isLand) {
    [r, g, b] = landColor(magnitude);
  } else if (isShoreline) {
    // Shallow coastal water — muted blue-green wash.
    r = 104;
    g = 166;
    b = 156;
  } else {
    // Deep water — blue-green ink wash, not modern satellite blue.
    const m = Math.min(magnitude, 14);
    const t = m / 14;
    r = Math.round(78 - 28 * t);
    g = Math.round(135 - 40 * t);
    b = Math.round(146 - 42 * t);
  }

  out[offset] = r;
  out[offset + 1] = g;
  out[offset + 2] = b;
  out[offset + 3] =
    (isLand
      ? isShoreline
        ? META_LAND_SHORE
        : META_LAND
      : isShoreline
        ? META_SHALLOW_WATER
        : META_DEEP_WATER) + Math.min(magnitude, 31);
}

// --- Biome tinting -------------------------------------------------------------
// Latitude-biome wash blended into the land ramp so deserts read tan, jungle
// deep green, tundra washed-out — instead of one elevation ramp everywhere.
// The derivation MIRRORS src/core/game/Biome.ts biomeAt() EXACTLY (same band
// constants, same integer-hash value-noise warp, same elevation biases) so the
// tinted terrain bands agree with the sim's biome (wood costs, structure tints
// via StructurePass). Any drift here shows up as structures tinted for a biome
// the ground doesn't show.

/** Mirrors Config.biomeLatitudeBands() default (same pin as StructurePass). */
const BIOME_BANDS = {
  cold: 0.78,
  forest: 0.55,
  green: 0.38,
  arid: 0.22,
  sandy: 0.1,
} as const;

// Band-warp value noise — constants and hash MUST match Biome.ts.
const BAND_WARP_CELL = 26;
const BAND_WARP_AMPLITUDE = 0.13;

function latticeHash(ix: number, iy: number): number {
  let n = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}

function bandWarpNoise(x: number, y: number): number {
  const gx = x / BAND_WARP_CELL;
  const gy = y / BAND_WARP_CELL;
  const ix = Math.floor(gx);
  const iy = Math.floor(gy);
  const fx = gx - ix;
  const fy = gy - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = latticeHash(ix, iy);
  const n10 = latticeHash(ix + 1, iy);
  const n01 = latticeHash(ix, iy + 1);
  const n11 = latticeHash(ix + 1, iy + 1);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

// Hand-tinted chart washes per biome (Green = baseline ramp, no tint). Kept
// muted/parchment-adjacent — the biome should read as a regional watercolor
// wash over the elevation ramp, never a recolor.
type BiomeWash = readonly [number, number, number];
const WASH_COLD: BiomeWash = [198, 206, 196]; // pale washed grey-green
const WASH_FOREST: BiomeWash = [106, 148, 118]; // deeper blue-green
const WASH_ARID: BiomeWash = [204, 176, 116]; // dry ochre / khaki
const WASH_SANDY: BiomeWash = [220, 197, 140]; // warm desert tan
const WASH_JUNGLE: BiomeWash = [72, 126, 74]; // saturated dark tropical green

// How far the wash pulls the ramp color at full strength (low elevation).
const BIOME_WASH_STRENGTH = 0.32;
// Wash fades from full below this magnitude…
const BIOME_FADE_START = 12;
// …to zero at/above this one, so mountains stay elevation-colored.
const BIOME_FADE_END = 20;

/**
 * Biome wash color for a land tile, or null for Green (baseline) tiles.
 * Faithful port of Biome.ts biomeAt(): warped latitude + elevation biases.
 */
function biomeWashAt(
  x: number,
  y: number,
  magnitude: number,
  mapH: number,
): BiomeWash | null {
  // High elevation reads cold regardless of latitude (matches biomeAt) — the
  // elevation fade zeroes the wash up there anyway, keeping peaks ramp-colored.
  if (magnitude >= 24) return WASH_COLD;

  let lat = mapH > 1 ? Math.abs(y / (mapH - 1) - 0.5) * 2 : 0;
  lat += (bandWarpNoise(x, y) - 0.5) * 2 * BAND_WARP_AMPLITUDE;
  if (magnitude >= 16) lat += 0.15; // highlands sit one band colder
  lat = Math.max(0, Math.min(1, lat));

  if (lat >= BIOME_BANDS.cold) return WASH_COLD;
  if (lat >= BIOME_BANDS.forest) return WASH_FOREST;
  if (lat >= BIOME_BANDS.green) return null; // Green = current baseline ramp
  if (lat >= BIOME_BANDS.arid) return WASH_ARID;
  if (lat >= BIOME_BANDS.sandy) return WASH_SANDY;
  return WASH_JUNGLE;
}

// --- Relief shading ----------------------------------------------------------
// Directional hillshade reined in for a painted-map look: enough relief to
// read mountains, but less glossy than satellite terrain.
const RELIEF_LIGHT_X = -1; // light from the west  (screen −x)
const RELIEF_LIGHT_Y = -1; // light from the north (screen −y, up)
const RELIEF_STRENGTH = 0.012; // per unit of summed neighbor-magnitude slope
const RELIEF_MIN = 0.96; // clamp shadows (keeps valley floors from going dingy)
const RELIEF_MAX = 1.045; // clamp highlights
// Subtle per-tile value noise so equal-elevation fields aren't dead-flat.
const TEXTURE_STRENGTH = 0.018; // +/- fraction of brightness
const WATER_TEXTURE_STRENGTH = 0.02;
const COAST_INK: readonly [number, number, number] = [86, 58, 30];
const WATER_COAST_INK: readonly [number, number, number] = [54, 105, 106];

/** Land height for shading: magnitude on land, sea level (0) on water, so
 *  coastlines pick up a gentle relief edge. */
function shadeHeight(tb: number): number {
  return (tb & 0x80) !== 0 ? tb & 0x1f : 0;
}

/** Deterministic [0,1) value noise from tile coords (no RNG — stable build). */
function tileNoise(x: number, y: number): number {
  let hsh = (x * 374761393 + y * 668265263) | 0;
  hsh = (hsh ^ (hsh >>> 13)) * 1274126177;
  hsh = hsh ^ (hsh >>> 16);
  return ((hsh >>> 0) % 1000) / 1000;
}

function mixByte(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function neighborLandCount(
  terrainBytes: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
): number {
  let count = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if ((terrainBytes[ny * w + nx] & 0x80) !== 0) count++;
    }
  }
  return count;
}

function applyTint(
  pixels: Uint8Array,
  off: number,
  tint: readonly [number, number, number],
  amount: number,
): void {
  pixels[off] = mixByte(pixels[off], tint[0], amount);
  pixels[off + 1] = mixByte(pixels[off + 1], tint[1], amount);
  pixels[off + 2] = mixByte(pixels[off + 2], tint[2], amount);
}

export function buildTerrainRGBA(
  terrainBytes: Uint8Array,
  w: number,
  h: number,
): Uint8Array {
  const pixels = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const off = i * 4;
      const tb = terrainBytes[i];
      encodeTerrainTile(tb, pixels, off);

      const isLand = (tb & 0x80) !== 0;
      const landNeighbors = neighborLandCount(terrainBytes, w, h, x, y);

      // Water gets a little paper-like variation plus a darker ink wash where
      // it touches land. This gives coastlines the old-chart outline even after
      // the terrain texture is linearly filtered.
      if (!isLand) {
        const n = tileNoise(x * 3 + 17, y * 3 + 29) - 0.5;
        const mult = 1 + n * WATER_TEXTURE_STRENGTH;
        pixels[off] *= mult;
        pixels[off + 1] *= mult;
        pixels[off + 2] *= mult;
        if (landNeighbors > 0) {
          applyTint(
            pixels,
            off,
            WATER_COAST_INK,
            Math.min(0.16, 0.06 + landNeighbors * 0.018),
          );
        }
        continue;
      }

      // Biome wash BEFORE hillshade/noise so relief shading still reads on
      // top of the tinted ground. Beach (shoreline) tiles keep their fixed
      // parchment color so the coast ink treatment stays consistent.
      const isShoreline = (tb & 0x40) !== 0;
      const magnitude = tb & 0x1f;
      if (!isShoreline) {
        const wash = biomeWashAt(x, y, magnitude, h);
        if (wash !== null && magnitude < BIOME_FADE_END) {
          const fade =
            magnitude <= BIOME_FADE_START
              ? 1
              : (BIOME_FADE_END - magnitude) /
                (BIOME_FADE_END - BIOME_FADE_START);
          applyTint(pixels, off, wash, BIOME_WASH_STRENGTH * fade);
        }
      }

      const xl = x > 0 ? x - 1 : x;
      const xr = x < w - 1 ? x + 1 : x;
      const yu = y > 0 ? y - 1 : y;
      const yd = y < h - 1 ? y + 1 : y;
      const dzdx =
        shadeHeight(terrainBytes[y * w + xr]) -
        shadeHeight(terrainBytes[y * w + xl]);
      const dzdy =
        shadeHeight(terrainBytes[yd * w + x]) -
        shadeHeight(terrainBytes[yu * w + x]);

      // Brighter where the slope rises toward the light, darker away from it.
      let mult =
        1 + (dzdx * RELIEF_LIGHT_X + dzdy * RELIEF_LIGHT_Y) * RELIEF_STRENGTH;
      mult += (tileNoise(x, y) - 0.5) * TEXTURE_STRENGTH;
      if (mult < RELIEF_MIN) mult = RELIEF_MIN;
      else if (mult > RELIEF_MAX) mult = RELIEF_MAX;

      const r = pixels[off] * mult;
      const g = pixels[off + 1] * mult;
      const b = pixels[off + 2] * mult;
      pixels[off] = r > 255 ? 255 : r;
      pixels[off + 1] = g > 255 ? 255 : g;
      pixels[off + 2] = b > 255 ? 255 : b;

      if (landNeighbors < 8) {
        applyTint(
          pixels,
          off,
          COAST_INK,
          Math.min(0.36, 0.18 + (8 - landNeighbors) * 0.025),
        );
      }
    }
  }
  return pixels;
}
