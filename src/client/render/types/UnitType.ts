/**
 * Canonical unit type string constants.
 *
 * These match the strings the upstream game sends in UnitEventUpdate.unitType.
 * Use these instead of raw string literals to prevent typos and enable
 * find-all-references.
 */

// ---------------------------------------------------------------------------
// Individual unit type constants
// ---------------------------------------------------------------------------

// Mobile units
export const UT_TRANSPORT = "Transport" as const;
export const UT_TRADE_SHIP = "Trade Ship" as const;
export const UT_WARSHIP = "Warship" as const;
export const UT_ATOM_BOMB = "Atom Bomb" as const;
export const UT_HYDROGEN_BOMB = "Hydrogen Bomb" as const;
export const UT_MIRV = "MIRV" as const;
export const UT_SAM_MISSILE = "SAMMissile" as const;
export const UT_SHELL = "Shell" as const;
export const UT_MIRV_WARHEAD = "MIRV Warhead" as const;
export const UT_TRAIN = "Train" as const;

// Structures
export const UT_CITY = "City" as const;
export const UT_PORT = "Port" as const;
export const UT_FACTORY = "Factory" as const;
export const UT_DEFENSE_POST = "Defense Post" as const;
export const UT_SAM_LAUNCHER = "SAM Launcher" as const;
export const UT_MISSILE_SILO = "Missile Silo" as const;
// Primitive-era structures. They render on the map via StructurePass and must
// be treated as structures so GameView marks the structure layer dirty when one
// is built/captured/removed.
export const UT_HUT = "Hut" as const;
export const UT_SCOUT_LOOKOUT = "Scout Lookout" as const;
export const UT_PRIMITIVE_FARM = "Primitive Farm" as const;
export const UT_TRADE_OUTPOST = "Trade Outpost" as const;

// ---------------------------------------------------------------------------
// Derived sets
// ---------------------------------------------------------------------------

// AI-NOTE: Primitive structures MUST be here — this is the gate GameView uses
// to set _structuresDirty (→ frame.structuresDirty → view.updateStructures).
// Drop one and a newly built/captured instance never re-uploads the structure
// layer, so its atlas glyph silently fails to render.
export const STRUCTURE_TYPES: ReadonlySet<string> = new Set([
  UT_CITY,
  UT_PORT,
  UT_FACTORY,
  UT_DEFENSE_POST,
  UT_SAM_LAUNCHER,
  UT_MISSILE_SILO,
  UT_HUT,
  UT_SCOUT_LOOKOUT,
  UT_PRIMITIVE_FARM,
  UT_TRADE_OUTPOST,
]);

export const NUKE_TYPES: ReadonlySet<string> = new Set([
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
]);

/** Blast radii (in tiles) matching upstream DefaultConfig.nukeMagnitudes(). */
export const NUKE_MAGNITUDES: Readonly<
  Record<string, { inner: number; outer: number }>
> = {
  [UT_ATOM_BOMB]: { inner: 12, outer: 30 },
  [UT_HYDROGEN_BOMB]: { inner: 80, outer: 100 },
  [UT_MIRV_WARHEAD]: { inner: 12, outer: 18 },
};

// ---------------------------------------------------------------------------
// Ordered lists (atlas column order — used by GPU passes + header)
// ---------------------------------------------------------------------------

/** All unit type strings in the canonical order used by RendererConfig.unitTypes. */
export const ALL_UNIT_TYPES = [
  UT_TRANSPORT,
  UT_TRADE_SHIP,
  UT_WARSHIP,
  UT_ATOM_BOMB,
  UT_HYDROGEN_BOMB,
  UT_MIRV,
  UT_SAM_MISSILE,
  UT_SHELL,
  UT_MIRV_WARHEAD,
  UT_CITY,
  UT_PORT,
  UT_FACTORY,
  UT_DEFENSE_POST,
  UT_SAM_LAUNCHER,
  UT_MISSILE_SILO,
  UT_HUT,
  UT_SCOUT_LOOKOUT,
  UT_PRIMITIVE_FARM,
  UT_TRADE_OUTPOST,
  UT_TRAIN,
] as const;
