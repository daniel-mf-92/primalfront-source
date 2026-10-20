/**
 * structure-theme.ts — era/biome structure sprite + tint selection.
 *
 * This is the structure-sprite/icon mapping module used by StructurePass. It is
 * the single place that decides, for a given (unitType, owner age, tile biome),
 * WHICH icon-atlas column to sample and WHICH multiplicative tint to apply.
 *
 * The committed icon atlas (resources/atlases/icon-atlas.png) keeps the six
 * legacy structure columns first, then appends dedicated primitive/permanent-
 * settlement columns. Era/biome theming is still a deterministic multiplicative
 * tint so structures pick up local climate without needing per-biome art.
 *
 * Everything here is a pure function of its inputs (no time, no randomness), so
 * rendering stays deterministic and replay-safe.
 *
 * Mirrors src/core/game/Biome.ts (engine-side biome derivation + biomeTint). We
 * re-implement the LATITUDE portion here because the renderer has the map height
 * but NOT per-tile terrain magnitude, so the elevation/highland bias the engine
 * applies is unavailable at render time — see latitudeBiome() below.
 */

import { BiomeBands, biomeTint } from "src/core/game/Biome";
import { Biome } from "src/core/game/Game";
import {
  UT_CITY,
  UT_DEFENSE_POST,
  UT_FACTORY,
  UT_HUT,
  UT_MISSILE_SILO,
  UT_PORT,
  UT_PRIMITIVE_FARM,
  UT_SAM_LAUNCHER,
  UT_SCOUT_LOOKOUT,
  UT_TRADE_OUTPOST,
} from "../../types";

// Synthetic atlas key for the dedicated objective glyph used by a level-1 City.
// There is no "Permanent Settlement" engine UnitType: this key only names an
// atlas column and render-settings shape.
export const UT_PERMANENT_SETTLEMENT = "Permanent Settlement" as const;

// Age enum values (Game.ts Age) — duplicated as plain numbers so this render
// module does not import the engine Age enum just for one comparison.
const AGE_PRIMITIVE = 0;

/**
 * Icon-atlas column order. Index = atlas column. MUST match the column order in
 * StructurePass / StructureLevelPass and the baked atlas (resources/atlases/
 * icon-atlas.png, now ELEVEN 64px columns). selectStructureSprite() maps every
 * (unitType, age, biome, level) onto one of these columns. Columns 6-10 are the
 * dedicated primitive/permanent-settlement glyphs.
 */
export const STRUCTURE_ATLAS_ORDER = [
  UT_CITY,
  UT_PORT,
  UT_FACTORY,
  UT_DEFENSE_POST,
  UT_SAM_LAUNCHER,
  UT_MISSILE_SILO,
  UT_HUT,
  UT_PERMANENT_SETTLEMENT,
  UT_TRADE_OUTPOST,
  UT_SCOUT_LOOKOUT,
  UT_PRIMITIVE_FARM,
] as const;

export const ATLAS_COL = {
  city: 0,
  port: 1,
  factory: 2,
  defensePost: 3,
  sam: 4,
  silo: 5,
  hut: 6,
  permanentSettlement: 7,
  tradeOutpost: 8,
  scoutLookout: 9,
  primitiveFarm: 10,
} as const;

/** Result of theming one structure: which glyph + the multiplicative tint. */
export interface StructureSprite {
  /** Icon-atlas column to sample (0..10). */
  atlasCol: number;
  /**
   * Multiplicative RGB tint in 0..1, applied to the structure's player color.
   * [1,1,1] = no change (the structure keeps its pure player color).
   */
  tint: readonly [number, number, number];
}

const NO_TINT: readonly [number, number, number] = [1, 1, 1];

/**
 * Derive biome from a tile row, LATITUDE-ONLY.
 *
 * Engine `biomeAt` (Biome.ts) additionally pushes high-magnitude (highland)
 * tiles one band colder. The renderer does not carry per-tile terrain
 * magnitude, so this mirrors only the latitude bands. Net effect: a structure
 * sitting on a snow-capped highland near the equator will render with its
 * latitude biome here, while the engine considers it Cold. This is a known,
 * documented render-side approximation (part of the art gap) — it never affects
 * simulation, only the cosmetic tint. Deterministic: pure function of (y,h).
 */
export function latitudeBiome(
  y: number,
  mapHeight: number,
  bands: BiomeBands,
): Biome {
  const lat = mapHeight > 1 ? Math.abs(y / (mapHeight - 1) - 0.5) * 2 : 0;
  if (lat >= bands.cold) return Biome.Cold;
  if (lat >= bands.forest) return Biome.Forest;
  if (lat >= bands.green) return Biome.Green;
  if (lat >= bands.arid) return Biome.Arid;
  if (lat >= bands.sandy) return Biome.Sandy;
  return Biome.Jungle;
}

/**
 * Convert the engine's 0..255 biomeTint into a gentle 0..1 multiplicative tint.
 *
 * biomeTint() returns an aesthetic absolute color (e.g. pale icy blue for Cold).
 * Used raw as a multiplier it would wash structures toward that color far too
 * hard and crush the player color. We instead pull each channel a fraction of
 * the way from white (1,1,1) toward the normalized biome color, so the player
 * color stays dominant and the biome only nudges the hue. `strength` controls
 * how far (0 = none, 1 = full biome color).
 */
function biomeMultiplier(
  biome: Biome,
  strength: number,
): readonly [number, number, number] {
  const [r, g, b] = biomeTint(biome);
  const nr = r / 255;
  const ng = g / 255;
  const nb = b / 255;
  return [
    1 + (nr - 1) * strength,
    1 + (ng - 1) * strength,
    1 + (nb - 1) * strength,
  ];
}

// How hard a structure leans into its tile's biome. Subtle — the player color
// must still read first; the biome is a regional flavor, not a recolor.
const BIOME_TINT_STRENGTH = 0.35;
// Primitive structures get an extra warm-earth knockdown on top of biome tint so
// the tribal era reads as muted/organic vs. the brighter built-up later eras.
const PRIMITIVE_DARKEN: readonly [number, number, number] = [0.82, 0.74, 0.6];

function mul(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): readonly [number, number, number] {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
}

const isPrimitive = (age: number): boolean => age <= AGE_PRIMITIVE;

/**
 * Choose the icon-atlas column + multiplicative tint for a structure, themed by
 * (unitType, owner age, tile biome, structure level).
 *
 *   - Primitive structures → dedicated glyphs, earth-darkened.
 *   - City at level 1 → the dedicated Permanent Settlement objective glyph,
 *     NOT the multi-tower city/apartment glyph.
 *   - City at level ≥2 → the built-up CITY/apartments glyph as it upgrades.
 *     A Primitive-era City keeps the earth-darkened tint; from Imperial it reads
 *     as a brighter built settlement (biome tint only).
 *   - Port / Factory / Defense Post / SAM / Silo always use their own glyph and
 *     take only the biome tint (they don't exist in the Primitive era anyway —
 *     the build menu gates them — so no era branch is needed).
 *
 * Pure + deterministic.
 */
export function selectStructureSprite(
  unitType: string,
  age: number,
  biome: Biome,
  level: number = 1,
): StructureSprite {
  const biomeTintMul = biomeMultiplier(biome, BIOME_TINT_STRENGTH);

  const primitiveTint = mul(biomeTintMul, PRIMITIVE_DARKEN);
  if (unitType === UT_HUT)
    return { atlasCol: ATLAS_COL.hut, tint: primitiveTint };
  if (unitType === UT_TRADE_OUTPOST)
    return { atlasCol: ATLAS_COL.tradeOutpost, tint: primitiveTint };
  if (unitType === UT_SCOUT_LOOKOUT)
    return { atlasCol: ATLAS_COL.scoutLookout, tint: primitiveTint };
  if (unitType === UT_PRIMITIVE_FARM)
    return { atlasCol: ATLAS_COL.primitiveFarm, tint: primitiveTint };

  if (unitType === UT_CITY) {
    // Level-1 City is the Permanent Settlement objective; upgrades grow into City.
    const atlasCol =
      level <= 1 ? ATLAS_COL.permanentSettlement : ATLAS_COL.city;
    const tint = isPrimitive(age) ? primitiveTint : biomeTintMul;
    return { atlasCol, tint };
  }

  const col = atlasColFor(unitType);
  if (col === undefined) {
    // Not a structure we render (shouldn't reach here — caller pre-filters).
    return { atlasCol: ATLAS_COL.city, tint: NO_TINT };
  }
  return { atlasCol: col, tint: biomeTintMul };
}

function atlasColFor(unitType: string): number | undefined {
  switch (unitType) {
    case UT_CITY:
      return ATLAS_COL.city;
    case UT_PORT:
      return ATLAS_COL.port;
    case UT_FACTORY:
      return ATLAS_COL.factory;
    case UT_DEFENSE_POST:
      return ATLAS_COL.defensePost;
    case UT_SAM_LAUNCHER:
      return ATLAS_COL.sam;
    case UT_MISSILE_SILO:
      return ATLAS_COL.silo;
    case UT_HUT:
      return ATLAS_COL.hut;
    case UT_TRADE_OUTPOST:
      return ATLAS_COL.tradeOutpost;
    case UT_SCOUT_LOOKOUT:
      return ATLAS_COL.scoutLookout;
    case UT_PRIMITIVE_FARM:
      return ATLAS_COL.primitiveFarm;
    default:
      return undefined;
  }
}

/**
 * Is this a structure type StructurePass should draw at all?
 */
export function structureAtlasCol(unitType: string): number | undefined {
  return atlasColFor(unitType);
}
