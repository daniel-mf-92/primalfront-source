# Eonfront Era Overhaul — Implementation Spec

Authoritative brief for the `feat/era-overhaul` branch. Goal: make territory
capture **elegant and era-varied** — a deliberate tribe in the Primitive era
that _cannot_ hold much land, growing into a sweeping empire by the Modern/Alien
era; era advancement driven by **criteria, not money**, and **spreading across
contiguous land** like real technology diffusion; structures themed by **biome**
and **era**; the build menu showing **only era-relevant** options.

All code lives under `src/`. Engine is deterministic (no `Date.now`/`Math.random`
outside `PseudoRandom`). Keep edits deterministic. After each module, the owning
agent runs `npx tsc --noEmit` and reports remaining errors (cross-module dangling
refs are expected until integration).

## Current-state facts (verified against the code)

- `Age` enum (`src/core/game/Game.ts` ~L334): `Primitive=0, Imperial=1, Feudal=2,
Enlightened=3, Industrial=4, Modern=5, Alien=6`.
- `UnitType` enum (`Game.ts` ~L166): has `City="City"`. **No `Hut`.**
  `Structures` group ~L213. `City` def in `Config.ts` ~L390: **no `minAge`**,
  cost `2^numUnits * 125_000` (cap 1M) via `applyAgeCostMult`, `upgradable:true`.
- Unit defs carry optional `minAge` (Config ~L345-490). **No `maxAge` exists.**
- `PlayerImpl.canBuildUnitType` (~L1410) checks `info.minAge !== undefined &&
this.age() < info.minAge`. `buildableUnits` ~L1468.
- `PlayerImpl.advanceAge()` (~L1330) spends `gold+techPoints` from
  `Config.advanceAgeCost()` (~L1123, per-age `{gold,techPoints}`), does `_age++`,
  `setAdvancePenalty`. `canAdvanceAge()` ~L1323.
- Overextension (the "rewild"): `PlayerExecution.digestIntegrationDebt` +
  `revoltFrontierTiles` (`src/core/execution/PlayerExecution.ts`,
  `MAX_REVOLT_TILES_PER_TICK=8`). Config knobs: `integrationDebtPerCapture`,
  `integrationThroughputPerTick`, `overextensionCapacity`,
  `frontierRevoltThreshold`, `supplyDepotReliefPerDepot`. `relinquish` →
  `setOwnerID(tile,0)` = back to neutral.
- `AttackExecution` (`src/core/execution/AttackExecution.ts`): `refreshToConquer`
  enqueues the **whole** owner border; `addNeighbors` priority math; supports an
  anchored `sourceTile` (used by boats); on capture calls `conquer`,
  `addIntegrationDebt`, `recordCapture`.
- Terrain byte (`GameMap.ts` ~L117): `IS_LAND_BIT=7, SHORELINE_BIT=6,
OCEAN_BIT=5, MAGNITUDE_MASK=0x1f`. **No biome/temperature field** → biome is
  DERIVED (see Module D).
- Client render: `StructurePass.ts` draws structure sprites; PNGs in
  `resources/images/buildings/` (`city1..5`, `cityAlt1`, `factory*`, `port*`,
  `silo*`). Build menu UI: `src/client/hud/layers/BuildMenu.ts` +
  `RadialMenuElements.ts`. Unrest meter bug: `ControlPanel.ts:203`
  (`_unrest = clamp(integrationDebt(),0,1)` → pegs at 100%).
- Player state serialized via `GameUpdates.ts` (PlayerUpdate) +
  `GameUpdateUtils.ts` (diff/apply); client mirror in
  `src/client/view/PlayerView.ts`.

---

## Module 0 — FOUNDATION (do first, single owner)

Establishes the shared contract. Files: `Game.ts`, `Config.ts`, `PlayerImpl.ts`,
`Player` interface, `GameUpdates.ts`, `GameUpdateUtils.ts`, `PlayerView.ts`.

1. **`UnitType.Hut = "Hut"`** added to enum + included in `Structures` group.
2. **Biome + Tribe enums** in `Game.ts`:
   - `export enum Biome { Cold=0, Green=1, Arid=2, Sandy=3 }` (Green = temperate/plains).
   - `export enum TribeArchetype { Wolf=0, Bear=1, Lion=2, Jackal=3 }`
     (Wolf↔Cold, Bear↔Green, Lion↔Arid, Jackal↔Sandy).
3. **`maxAge`** optional field on unit info (Config). Hut = `{minAge:Primitive,
maxAge:Primitive, cost: small (see below), upgradable:false}`. City stays
   `minAge:Imperial`-free but becomes the **permanent settlement** (see Module B).
4. **Config knobs** (new methods; values are starting points, all tunable):
   - `attackTilesPerTick` already age-aware — ensure Primitive multiplier ≈ very
     low (deliberate), ramping to high by Modern. Add
     `expansionStyle(age): "path" | "front" | "sweep"` → `path` for Primitive,
     `front` Imperial–Feudal, `sweep` Enlightened+.
   - **Rewild = Primitive-only & gentle**: `rewildEnabled(age): boolean` → true
     only for `Age.Primitive`. Reduce `MAX_REVOLT_TILES_PER_TICK` effect for
     primitive to a gentle bleed (e.g. cap 3/tick) and raise tolerance so it's
     "can't hold _massive_ land" not "loses everything". Later ages: capacity
     effectively unbounded (no revolt).
   - `hutCost()` and the permanent-settlement cost **X** (`permanentSettlementCost()`
     — start at `125_000`, tunable). `advanceAgeCost` → criteria, see Module B.
   - Biome bands: `biomeLatitudeBands()` thresholds (Module D).
   - Diffusion: `diffusionContiguousDiscount()` (e.g. 0.9 — near-free on same
     landmass), `diffusionDistanceFalloff()` (global decay), `diffusionMaxRange()`.
5. **Player state fields** (PlayerImpl + Player interface + serialize +
   PlayerView mirror): `dominantBiome: Biome`, `tribeArchetype: TribeArchetype`,
   `ageAdvanceCredit: number` (0..1 diffusion discount toward next age),
   `integrationDebt` already exists. Add getters/setters.
6. **`advanceAge` rewrite** (Module B owns the criteria logic; Foundation just
   removes the gold spend and exposes `meetsAdvanceCriteria()` +
   `applyDiffusionCredit()` hooks so it compiles).
7. **maxAge filter**: `canBuildUnitType` also rejects when `info.maxAge !==
undefined && this.age() > info.maxAge`. `buildableUnits` respects it.

Acceptance: `tsc` errors only from not-yet-created executions/util referenced by
later modules.

---

## Module A — Primitive PATHWAY claim (territory)

Primitive expansion is a **path blazed through wilderness**, not a flood. Files:
new `src/core/execution/PathwayClaimExecution.ts`, `AttackExecution.ts`,
`ExecutionManager.ts`.

- In Primitive, a land "attack" does NOT enqueue the whole border
  (`refreshToConquer`). Instead it claims a **corridor** from the player's land
  toward the clicked target tile: a short path (width ~1-2 tiles) advancing each
  tick toward the target, anchored to `sourceTile`.
- The **tail re-wilds**: corridor tiles not adjacent to a "supported" core
  (a settlement or contiguous owned bulk) revert to neutral over time (reuse the
  rewild/relinquish path, Primitive-gated). Net effect: a tribe snakes out, and
  unmaintained trails return to wild.
- Later eras keep current `AttackExecution` behavior (`front`/`sweep`). Gate the
  new path behavior behind `config.expansionStyle(age) === "path"`.
- Register the execution; ensure replay-determinism (PseudoRandom only).

## Module B — Criteria-based advance + DIFFUSION (no money)

Files: `PlayerImpl.ts` (advance criteria), new
`src/core/execution/DiffusionExecution.ts` or a `PlayerExecution` hook,
`GameImpl.ts` (landmass query), `Config.ts`.

- **Remove gold from advancing.** `canAdvanceAge`/`advanceAge` no longer spend
  gold. New criteria per age via `meetsAdvanceCriteria(player, toAge)`:
  - **Primitive→Imperial**: own ≥1 **permanent settlement (`City`)** — i.e. the
    player upgraded a Hut to a House/City (cost **X**). (Humankind outpost→city.)
  - Later ages: own that era's keystone structure **+** a techPoints threshold
    (keep techPoints as the "knowledge" gate; drop gold). Keystones (tunable):
    Imperial→Feudal Harbor; Feudal→Enlightened Wonder; →Industrial Factory;
    →Modern Airbase/Silo; →Alien EonSite.
- **Diffusion** (EU4 institutions): when player X advances to age N, every other
  player P gets `ageAdvanceCredit` toward N:
  - **Contiguous landmass** (P owns a tile on the same connected landmass as X's
    _main_ landmass) → `diffusionContiguousDiscount()` (near-free: criteria
    techPoints requirement waived/deeply cut; keystone build still required).
  - **Else (global, distance-decay)**: credit = `falloff(distance(X,P))`,
    descending with distance — far islands get a little, never the full cheap
    upgrade. Remote unconnected islands rely solely on this small term.
  - Landmass query: from X's largest owned-tile cluster, flood over **contiguous
    land tiles** (owned or neutral, `isLand`, non-water) → component set; P is
    "contiguous" if any P-owned tile ∈ component. Add a helper on `GameImpl`
    (reuse `forEachNeighbor`; cache per tick; deterministic).
  - `applyDiffusionCredit` reduces the _effective_ criteria in
    `meetsAdvanceCriteria`/`canAdvanceAge`.

## Module C — Primitive-only gentle rewild (tuning)

Files: `PlayerExecution.ts`, `Config.ts`. (Combine with Module B's
`PlayerExecution` edits if same agent to avoid file contention.)

- `digestIntegrationDebt`/`revoltFrontierTiles` only meaningfully act when
  `config.rewildEnabled(player.age())` (Primitive). Non-primitive: effectively
  no revolt (huge capacity / disabled).
- **Also gate `overextensionPenalty` to Primitive-only.** Currently the
  gold/regen penalty (down to ~0.6 as debt→capacity) applies in every era and is
  so punishing that the optimal play is to **nuke land before settling it** —
  dumb. Outside Primitive, `overextensionPenalty` returns `{goldMult:1,
regenMult:1}` (no penalty). Inside Primitive, keep it but **tone it down**.
- Make Primitive revolt **gentler** than today: lower per-tick cap, higher
  tolerance — the feel is "you can't hold _massive_ land as a tribe," a slow
  bleed of the least-integrated frontier, not a collapse. The "expensive to
  keep" pressure should be a mild tribal flavor, never a reason to nuke-first.

## Module D — BIOME aesthetics + era/biome icons

Files: new `src/client/.../biome.ts` (or `src/core/game/Biome*`),
`StructurePass.ts`, structure-icon mapping, `PlayerImpl.ts` (dominant-biome
tracking, periodic). Latitude-derived since terrain has no biome data.

- `biomeAt(map, tile): Biome` — derive from **latitude** `lat=(y/H)`:
  poles→`Cold`, temperate band→`Green`, sub-tropic→`Arid`, equatorial→`Sandy`
  (thresholds from `config.biomeLatitudeBands()`); high `magnitude` biases colder.
  Deterministic, pure function of tile.
- **Player dominant biome** = the biome most of the player's owned land sits in;
  recomputed on the existing periodic cadence in `PlayerExecution`; stored +
  serialized; **updates as terrain composition changes**.
- **Render**: structure sprite chosen by `(unitType, owner.age(), biomeAt(tile))`
  — a hut sprite for Primitive, a house/city sprite for later, themed by biome.
  Reuse the existing alt-sprite/level system. Where a biome/era PNG does not yet
  exist, fall back to the closest existing sprite + a biome **tint** (document the
  art gap in the PR; do NOT block on missing art).

## Module E — Build menu era-gating (hide, don't grey)

Files: `BuildMenu.ts`, `RadialMenuElements.ts`. Use the Module-0 `minAge`/`maxAge`
to **omit** out-of-era entries entirely (Hut hidden past Primitive; Nukes/Airbase
hidden in Primitive). No greyed-out clutter.

## Module F — Predator tribes (Primitive identity)

Files: new tribe-def module, `SpawnExecution.ts` (assignment), display name
plumbing. Assign `TribeArchetype` at spawn from the spawn tile's biome
(Cold→Wolf, Green→Bear, Arid→Lion, Sandy→Jackal). In Primitive, the player's
display identity reads as e.g. "Wolf Pack" (flavor; minimal mechanical effect for
v1, with a hook for small terrain affinity). Names tunable.

## Module G — Unrest meter fix

`ControlPanel.ts:203`: `this._unrest = clamp(player.integrationDebt() /
config.overextensionCapacity(player), 0, 1)`. Re-label as overextension/unrest;
ensure it reads 0 at no debt and trends up only as a tribe overextends.

---

## Verification (HARD — verify-before-done)

1. `npx tsc --noEmit` clean.
2. Run the affected unit tests (`npm test` / vitest). Add focused tests for:
   advance-criteria (no gold), diffusion contiguous-vs-island, maxAge hiding,
   biome derivation, unrest scaling.
3. Headless render on M4 (Chrome) — confirm: Primitive shows huts + path claim;
   menu hides out-of-era; oceans/biomes render; unrest not pegged at 100%.
4. Push `feat/era-overhaul`. **Do NOT merge to master** (co-driven) and **do NOT
   deploy** (Hetzner creds not on this fleet).

---

## Revision 2026-06-16 — Primitive drift, hut lifecycle, wood economy, icons

Play-test feedback ("primalfront broken") drove these changes (branch
`era-fixes`):

- **Hut was unbuildable (bug).** `ConstructionExecution` listed `Hut` in neither
  `isStructure()` nor `completeConstruction()`, so building a hut logged a warning
  and placed nothing. Fixed; huts now construct and get a `HutExecution`.
- **Straight-line "path" expansion retired.** The Module-A corridor
  (`PathExpansion.ts`) blazed a literal narrow straight trail — it read badly.
  Deleted. **All** ages now expand as a contiguous front/glob.
- **Primitive "glob that drifts" (settlement-anchored rewild).** A Primitive
  tribe only HOLDS land that is _supported_ — within `settlementSupportRadius`
  of a Hut/City, or within `nomadCampSupportRadius` of its owned-tile centroid
  (the mobile camp). Unsupported border tiles re-wild to neutral each ~1s, capped
  by `maxRewildTilesPerTick`, most-exposed first. Net feel: push one edge and the
  unsupported far edge sheds → the territory MOVES more than it GROWS; settlements
  are the only way to anchor land. Replaces the old debt-driven revolt (which shed
  the _newest_ captures and so fought the drift). `PlayerExecution.rewildUnsupportedFrontier`.
- **Hut lifecycle.** A Hut is temporary: it self-destructs after
  `hutLifespanTicks` (`HutExecution`), stays non-upgradeable (`upgradable:false`),
  and a second Hut cannot be placed within `hutMinSpacing` of an existing one
  (`PlayerImpl.hutSpawn`). To permanently anchor land + advance the era you build a
  House (City), not a hut.
- **Wood + woodland economy.** New per-player `wood` resource (mirrors
  `techPoints` plumbing). Capturing woodland (Forest/Jungle biome, `Game.isWoodland`)
  in the **Primitive era** costs extra population (`woodlandCaptureTroopCost`) and
  yields `wood` (`woodPerWoodlandTile`). Wood is spent on **canoes**: a Primitive
  boat (`TransportShipExecution`) costs `canoeWoodCost` and needs no Port. Later
  ages launch boats freely and don't gather wood.
- **Era gating fixes / land-only Primitive.** `EonSite` was mis-tagged
  `minAge: Primitive` (it is the Modern→Alien keystone) → fixed to `Modern`.
  `Port` and `Warship` gated to `minAge: Imperial` (Primitive is land + canoes).
- **Icons (art gap closed for settlements).** `icon-atlas.png` expanded 6→8
  columns: new **hut** (col 6, conical thatch) and **house** (col 7, single
  gabled house) glyphs. `selectStructureSprite` now picks: Hut→hut glyph, City
  level 1→house glyph ("first house"), City level ≥2→city/apartments glyph. Build
  menu uses `HutIconWhite.svg` / `HouseIconWhite.svg`.
- **HUD.** Wood readout shown in the ControlPanel during the Primitive era.

Tunable knobs added in `Config.ts`: `settlementSupportRadius`,
`nomadCampSupportRadius`, `maxRewildTilesPerTick`, `hutLifespanTicks`,
`hutMinSpacing`, `woodPerWoodlandTile`, `woodlandCaptureTroopCost`,
`canoeWoodCost`. Verified: `tsc --noEmit` clean, full vitest suite green (12
tests updated to encode the new behavior), headless boot + icon render reviewed.

Still open / deferred: woodland is the whole Forest/Jungle climate band (not yet
patchy or rendered on terrain); the canoe is the wood-costed TransportShip (no
distinct unit/sprite); biome-tinted hut/house variants reuse one glyph each.
