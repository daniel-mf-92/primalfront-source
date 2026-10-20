# Primitive-Era Redesign — Implementation Spec (2026-06-16)

Authoritative spec for the primitive-era overhaul. Built from owner direction + a 4-area code recon. All file:line anchors are from canonical tree `/home/opc/work/primalfront` @ `aba89a9`.

## DETERMINISM — READ FIRST (non-negotiable)

This is an OpenFront lockstep sim: every client re-runs identical ticks. **All new randomness MUST use the seeded `PseudoRandom` (`src/core/PseudoRandom.ts`)**, seeded from a replicated value. NEVER `Math.random()` / `Date.now()`. Use distinct gameID-offset seeds to avoid stream collisions (TribeSpawner already uses `simpleHash(gameID)+2`): resources `+3`, animal-pack classification `+4`. Per-event rolls (raids) seed from `tick + attackerID + defenderID`. Gold is `bigint` — keep loot math in integer basis points, never float-multiply-then-cast. Iterate tiles in `TileRef` order so RNG draw order is identical everywhere. Bound any per-tick scan (cap tiles examined/changed per tick) — `PlayerExecution.tick()` runs per-player-per-tick.

---

## 1. TRIBE TAXONOMY (fixes "all tribes are animals")

Today: every `PlayerType.Bot` gets a biome `tribeArchetype` and the name layer shows the animal name while `age===Primitive` — and everyone starts Primitive, so ALL tribes read as animals. Wrong.

Target:

- **Human players (`PlayerType.Human`) + Nations (`PlayerType.Nation`): ALWAYS normal human tribes.** Never an animal archetype, in any age.
- **Bots (`PlayerType.Bot`):** deterministically split at spawn — **~20% = ANIMAL PACK**, ~80% = normal human tribe. Roll seeded RNG `PseudoRandom(simpleHash(gameID)+4)` (or per-spawn deterministic hash); `< config.animalPackBotRatio()` (0.20) ⇒ animal pack.
- Add `isAnimalPack: boolean` to `PlayerInfo` + `PlayerImpl` (default false). Only animal packs get a `TribeArchetype`; everyone else gets a **human tribe name** (need a human-tribe name generator in `Tribes.ts` alongside the existing predator names).
- Display: `client/render/.../name-pass/index.ts:~505-512` and `PlayerView.ts:~514-521` — show animal name iff `isAnimalPack`; otherwise human tribe name. Remove the age===Primitive archetype gate.
- Spawn sites: `TribeSpawner.ts:28-33`, `SpawnExecution.ts:78-86`, `TribeSplitExecution.ts:165-171` (split children inherit parent's `isAnimalPack`).

## 2. ANIMAL-PACK BEHAVIOR

- **Predatory AI:** keep/extend `TribeExecution` aggression (`TribeExecution.ts:107-135`). They attack wilderness + neighbors.
- **Cannot gather resources:** harvest gated by `!isAnimalPack` (Layer 5 HarvestExecution rejects packs).
- **Cannot advance tech/age:** `techPointsPerTick` (Config.ts:1271-1276) returns 0 for packs; `meetsAdvanceCriteria` (PlayerImpl.ts:1370) false for packs. They stay Primitive forever.
- **Faster nomad drift:** larger per-tick shed+gain, lower target size (Layer 3) via `config.animalPackNomadMult()`.
- **Attack vs invade:** packs can be attacked normally, but **only fully conquered by a "super aggressive" attack** — normal attacks just push/damage them (they rewild away); only an attack whose committed troops ≫ pack strength (e.g. ratio ≥ `config.animalPackConquerRatio()`, ~3×) actually annihilates/conquers. Hook in `AttackExecution` conquest path (`handleDeadDefender`/conquer).
- **Yield MEAT:** when a pack is raided OR killed, attacker gains `meat` into the general resource pile (Layer 4/5).

## 3. NOMADIC MOVEMENT & SETTLEMENTS (primitive only; gated `rewildEnabled(age)`)

Today (`PlayerExecution.ts`): rewild only nibbles freshly-captured frontier on integration-debt overflow (`digestIntegrationDebt` 249-291, `revoltFrontierTiles` 297-333), thresholds set so high (`PRIMITIVE_REVOLT_TOLERANCE_MULT=2.5`, `MAX_REVOLT_TILES_PER_TICK=3`) tribes effectively expand-and-hold.

Target = **drift, not hold**:

- Replace the debt-overflow gate with **shed-on-move**: maintain a target owned-tile count (`config.nomadTargetTiles()`, ×`animalPackNomadMult` for packs). Each tick, if `numTilesOwned() > target`, `relinquish()` the trailing tiles **farthest from the current advance direction** (reuse centroid/guide math from `PathExpansion.computePathAnchor` 60-104), capped per tick. Leading edge still advances via existing path expansion (`AttackExecution.ts:406`).
- **Shed from the contiguous trailing edge only** — never punch interior holes (would fragment the tribe and `removeClusters` 414-453 hands fragments to enemies). Re-check ownership after each `relinquish` (mirror revolt 323-326).
- **Settlements anchor land:** tiles within radius `config.settlementHoldRadius()` of an owned Hut/City are EXEMPT from shedding (skip them in selection). Settled land is sticky; unsettled drifts.
- **Hut expires:** give Hut a `builtAtTick` + `config.hutLifetimeTicks()`. Tick pass enqueues `DeleteUnitExecution` when `ticks - builtAt > lifetime` (model `ShellExecution.ts:45`); on expiry, relinquish its anchored tiles. **City is PERMANENT** (it's the advance gate — never expire it).

## 4. RESOURCES — general pile (wood / rocks / meat)

- Player pile: add `_wood`, `_rocks`, `_meat` (plain `number`, mirror the `_techPoints` triplet at `PlayerImpl.ts:107/1212/1216`) + accessors `wood()/addWood()` etc. Surface in `GameUpdates.ts` PlayerUpdate next to `techPoints?` (241). Add a generic `addResource(kind, n)` switch.
- **Per-tile resource layer:** `private resourceMap: Uint8Array` on `GameMapImpl` (1 byte/tile): bits0-1 type {None=0,Wood=1,Rock=2}, bits2-7 quantity (0-63). Accessors `resourceAt/setResource/harvestResource` mirror terrain accessors. DON'T cram into the 16-bit state word.
- **Seeding (deterministic):** new `ResourceSeedExecution`, added once in `GameRunner.init()` (~99), seeded `PseudoRandom(simpleHash(gameID)+3)`, iterate tiles in `TileRef` order. For each land tile, `b = biomeAt(map,tile,config.biomeLatitudeBands())`:
  - **Wood:** only if `b ∈ {Forest, Jungle, Green}` (NEVER Cold-ice / Sandy-desert / Arid; and abundance 0 on barren/alien maps). Biome-weighted density (Forest/Jungle dense, Green sparse).
  - **Rock:** any land tile, modest density, ×higher at `TerrainType.Mountain/Highland`.
- **Harvest:** click a node when `ownerID(tile)==me` OR any `forEachNeighborWithDiag(tile)` owned by me. New `HarvestController` (client, subscribe `MouseUpEvent`, mirror `BuildPreviewController`) → `SendHarvestIntentEvent(tile)` → `Transport.onSendHarvestIntent` → `sendIntent({type:"harvest",tile})`. New `HarvestIntentSchema` in `Schemas.ts` (mirror AdvanceAge), `ExecutionManager` `case "harvest"` → `HarvestExecution` which **server-revalidates** (adjacency/ownership/non-empty, reject if `isAnimalPack`), decrements node, `addWood/addRocks`, records a resource-tile delta; node→0 clears + broadcasts removal.
- **Meat:** not tile-seeded — granted from raiding/killing animal packs (Layer 6 / AttackExecution).

## 5. BUILD MENU / HUT (concrete bugs)

- **HUT PLACEMENT BUG (high confidence):** `src/core/execution/ConstructionExecution.ts` — `UnitType.Hut` is missing from BOTH `isStructure()` (179-199) and the `completeConstruction()` switch (105-176), so clicking Hut hits the non-structure branch, never calls `buildUnit`, then warns "cannot be constructed" and no-ops. FIX: add `case UnitType.Hut: return true` to `isStructure()`, and a passive `case UnitType.Hut:` in `completeConstruction()` grouped with `Palisade`/`Granary` (break, no per-tick exec). Everything else (cost 5000, minAge/maxAge Primitive, placement validation) is already correct.
- **HIDE LOCKED BUILDINGS:** active filter already hides out-of-era items (`isInEra`, `BuildMenu.ts:451-465`, `getBuildableUnits` 613-622; radial 419-438). Remove the LEGACY show-locked path: `lockedAge()` (434-444) + render lock branches (522-526, 533-539, 566-573) + `.build-locked` CSS (343-347) + `build_menu.requires_age` key. KEEP the affordability-disabled greyed style (272-287) for in-era-but-can't-afford.

## 6. ECONOMY / AGE / RAID

- **Harder age:** in `PlayerImpl.advanceAge()` (1393-1410) actually CHARGE a cost — deduct `advanceAgeCost(this).gold` (table already populated, Config.ts:1147-1157) and/or consume techPoints (today it spends NOTHING — AI-NOTE 1397). Raise Primitive→Imperial gate (1370-1373) to >1 City or a tech floor. Lower `diffusionContiguousDiscount` 0.9→~0.4 (Config.ts:1207). Optionally raise `advanceAgeCost` techPoints (1142-1161) / slow `techPointsPerTick` (1271).
- **Kill random/passive income:** shrink `goldAdditionRate` baseRate toward upkeep-only (Config.ts:969-1018) — wealth must come from raids/trade/conquest, not a passive drip. Touch only base/income terms; leave upkeep/tax/coalition intact.
- **RAID (extract wealth, no land):** new `RaidExecution` + `RaidIntentSchema` (Schemas, mirror AdvanceAge) + `ExecutionManager` case + `Transport` hook + a client trigger (radial/right-click on enemy). Resolve ONCE in `init()` with `PseudoRandom` seeded from `tick + attackerSmallID + defenderSmallID`:
  - `power(p) = numTilesOwned(p) + k_t·troops(p) + k_dev·(unitsOwned(City)·C + age(p)·A)`
  - `P(success) = clamp(powerAtt/(powerAtt+powerDef), pMin≈0.1, pMax≈0.9)`
  - `success = rng.nextFloat() < P`. On success: transfer `config.raidLootFraction()·defender.gold()` (integer basis points, `removeGold`/`addGold`, mirror plunder `AttackExecution.ts:515-522`), maybe some troops. **No `conquerPlayer`, no tile capture.** Raiding an **animal pack** yields **meat** to the pile.
- Don't read the stale `threatScore()` (recomputed every 20 ticks, tiles-only) — compute the size/dev ratio inline.

## 7. RENDERING (resource nodes) — hardest, do last

Clone `StructurePass.ts` → `ResourceNodePass` (instanced sprites; tree glyph=wood, boulder=rock; `biomeTint()` flavor). Wire in `gl/Renderer.ts` + `gl/MapRenderer.ts`, push data from `WebGLFrameBuilder.update()`. **ART GAP:** atlas has no tree/rock glyph — use a tinted-dot/fallback (like the hut→city fallback) until art exists. **Delta channel:** the packed tile-update path (`GameImpl.ts:507`, 32-bit `state|terrain<<16`) has no spare bits — add a PARALLEL `recordResourceUpdate`/`drainPackedResourceUpdates` + `applyResourceDelta` drip in the new pass so chopped nodes disappear without desyncing the territory stream.

---

## EXECUTION WAVES (avoid concurrent edits to shared files Config.ts/PlayerImpl.ts/Game.ts/PlayerExecution.ts/ExecutionManager.ts)

- **Wave I (parallel, disjoint):** §1+§4 data-model/config foundation (Game/PlayerImpl/Config/GameMap/GameUpdates/Schemas) ‖ §5 build-menu+hut bug (ConstructionExecution/BuildMenu). → `npx tsc --noEmit`.
- **Wave II (sequential):** §1 taxonomy → §3 movement/settlements → §4 resources seed/harvest → §6 economy/raid. (Shared files edited one layer at a time.) → tsc + `npm test` each.
- **Wave III:** §7 rendering. → tsc + vite build.
- **Verify:** `run-openfront` skill — boot SP game, confirm: tribes are mostly human (not all animals), ~20% animal packs, hut places, locked buildings hidden, wood/rock nodes visible+harvestable, nomadic drift, age harder. Screenshot.

---

# ADDENDUM 2026-06-16 — Resource→Money economy + fog/scout (owner direction, 2nd pass)

Authoritative extension. Owner re-scoped the primitive economy into one deliberately-brutal scarcity chain:

> **population → resources → gold → permanent settlement**, every conversion **lossy and risky**, so breaking out of Primitive is a slow, uncertain grind.

Gold is NOT a passive drip in Primitive. You spend **population** to harvest scarce **resources**; you spend **resources** to run risky **caravans** that convert goods to **gold** at a destination; you hoard gold (20× a temp building) to plant a **permanent settlement** that finally unlocks the next era. Resources are simultaneously the **trade good**, the caravan's **armor** (bows/arrows → survival odds), and its **reach** (canoes across rivers/tiny seas). Making gold is _super resource-intensive_ by design.

Code recon grounding this addendum (trade-ship machinery to mirror): `PortExecution.ts:24-61` (spawn), `Config.ts:253-275` (`tradeShipGold`/`tradeShipSpawnRate`), `TradeShipExecution.ts:15-213` (lifecycle, `wasCaptured` 67-72, payouts 175-197), `WarshipExecution.ts:634-673` (`captureUnit`), `pathfinding/algorithms/AStar.Rail.ts:6-104` (`RailAdapter` — the land-A\* template), `PathFinder.ts:97-104` (`PathFinder.Rail` builder), `PlayerImpl.buildUnit` 1527-1555, `UnitPass.ts:68-81` (`UNIT_ORDER` atlas columns). Hut-expiry template: §3 above + `Config.hutLifespanTicks()` (~1244) + `DeleteUnitExecution` (model `ShellExecution.ts:45`).

## 8. TRADE OUTPOST + CARAVANS (the primitive money loop)

### 8.1 Trade Outpost — temporary "primitive factory"

- New `UnitType.TradeOutpost` (Game.ts enum + `unitInfo` cost block). `minAge/maxAge = Age.Primitive` (auto-hidden later, like Hut). Cheap (≈ Hut cost). **TEMPORARY** — clone the §3 Hut lifecycle: `builtAtTick` + `config.tradeOutpostLifetimeTicks()` → enqueue `DeleteUnitExecution` on expiry. Add to `ConstructionExecution.isStructure()` + a passive `case` in `completeConstruction()` (grouped with Hut/Palisade/Granary).
- It is the caravan **endpoint** — the land analog of a Port. Add a `TradeOutpostExecution` (mirror `PortExecution`): every N ticks, if under the caravan cap (`config.maxCaravansPerOutpost()` ≈ 1–2 — _small numbers_), spawn a `TradeCaravanExecution` from this outpost to another **land-reachable** tradeable endpoint (another of the player's outposts = _internal_, or a tradeable other player's = _external_; mirror `tradingPorts()` + `canTrade()` but over the LAND component). If no partner is reachable → no caravans (that scarcity is intended).

### 8.2 Trade Caravan — mirror the trade ship, on land

- New `UnitType.TradeCaravan` + atlas column in `UNIT_ORDER`. `TradeCaravanExecution` mirrors `TradeShipExecution`: init pathfinder → per-tick advance one tile → on arrival, payout + consume.
- **Land pathfinder (NEW):** clone `AStar.Rail.ts`→`AStar.Land.ts` with a `LandAdapter`: traversable = `!isWater` (land only), cost 1, Manhattan heuristic; build via `PathFinder.Land(game)` (mirror `PathFinder.Rail`) with `MiniMapTransformer` + stepper, staggered like `WaterPathFinder`.
- **Canoe reach (resource-gated):** the adapter MAY cross a water tile **iff** (a) the contiguous water span ≤ `config.caravanMaxWaterSpan()` (rivers + _very small_ seas only — never open ocean) **and** (b) the owner holds ≥ `config.canoeWoodCost()` wood. Crossing **consumes** that wood (`removeWood`). Low resources ⇒ land-only ⇒ _fewer routing options_.
- **Gold on ARRIVAL (resource→money):** new `config.caravanGold(dist, goodsDelivered, player)` (scaled-down `tradeShipGold` shape; gold ∝ goods delivered + distance). On successful arrival: **consume** stockpiled wood/rock (the trade good, `removeWood/removeRocks`) and `addGold(owner)`. _"Consumes resources when max successful."_
- **Survival is resource-intensive (㉑):** before/per leg, the caravan spends _extra_ resources (up to `config.caravanArmCost()`, only if available) to "make bows & arrows" → an **armament bonus** that lowers its robbery/capture chance. No resources ⇒ no arming ⇒ base (high) vulnerability. This is the deliberate "gold is super resource-intensive" sink.
- **Capture by enemy players:** reuse `wasCaptured` + `captureUnit` exactly as trade ships (carried gold → capturer). On land, any adjacent enemy unit/owned tile captures (no warship gate); captured caravan reroutes to nearest friendly outpost or is deleted (mirror `TradeShipExecution` 93-118).
- **Predation by tribes (animal + human):** each tick the caravan tile is near an animal pack or hostile tribe, roll `PseudoRandom(tick + caravanID + predatorID)`; `P(rob) = clamp(base − armamentBonus(resources), pMin, pMax)`. On a hit, the carried gold is stolen (to the predator if a player-ish tribe, else burned) and the caravan is destroyed/redirected. Deterministic, integer basis points.

### 8.3 Population cost (㉒ "resources always consume population")

- Harvesting draws **troops/population**: `HarvestExecution` calls `removeTroops(config.harvestTroopCost() * amount)` (clamped). Gathering is not free — it competes with your army. (Optionally caravans also cost a few troops to field via `buildUnit` troops param.) This closes the chain: population is the ultimate primitive currency.

## 9. FOG-OF-WAR FOR RESOURCES + SCOUT

- **Visibility rule:** a resource node renders **only** if its tile is visible to the player: (a) within owned territory (owner==me, or within a small sight radius of owned tiles), OR (b) within a Scout's revealed set. Implement as a per-player **resource-visibility mask** pushed to `ResourceNodePass` (the pass already gates per-instance in `fullRebuild`/`applyTileDelta` — add a `visible(tile)` check there; feed the mask from `WebGLFrameBuilder`). Without this, the zoom-gate (done) only declutters; the fog is the real "can't see resources outside your reach" rule.
- **Scout (`UnitType.ScoutLookout`):** temporary edge structure, clone Hut lifecycle (expires like outpost/hut). Placed on/near a territory edge. While alive it adds tiles to the player's resource-visibility set out to `config.scoutRange()`. **[OPEN A]** reveal shape = directional **cone** (wedge facing outward, direction = vector from territory centroid → scout tile, half-angle `config.scoutConeAngle()`) vs simple **radius**. **[OPEN B]** revealed tiles are **remembered** after the scout expires vs **re-fog**.

## 10. FISHING — a regenerating spatial resource (coast + rivers)

Unlike wood/rock (static depleting point-nodes), **fish** are a _regenerating field_ over water tiles, so fishing pressure is spatial and forces movement.

- **Data model:** add `ResourceKind.Fish` as the tile-kind value `3` in the `resourceMap` 2-bit slot — _free_, because `Meat` (kind enum 3) is **pile-only and never tile-stored**, so the on-tile kinds remain None/Wood/Rock/Fish within 2 bits. Player pile gains `_fish` + `fish()/addFish()/removeFish()` mirroring wood/rock; route in `addResource`. Fish live on **water tiles that are coastline or river** (`isShoreline` / river terrain), seeded by a fish-density pass (quantity 0–63) in `ResourceSeedExecution` (same `+3` stream, after the land loop, still TileRef order).
- **Harvest:** clicking a **water tile within your territory** (owned, or sight-radius of owned) → `HarvestExecution` revalidates water+fish+ownership, **sacrifices population** (`removeTroops(config.fishTroopCost()*amount)`), grants `addFish`, decrements that tile's fish quantity. Reuse the same HarvestController click path (it already handles tile clicks) — branch on `isWater`.
- **Depletion + regen:** a bounded `FishRegenExecution` (per-tick, **capped tiles/tick** for determinism, seeded stream) regrows fish on coastline/river tiles toward a biome cap at `config.fishRegenPerTick()`; harvest knocks it down. Because regen is per-tile, a fished-out coastline/river stretch goes barren and you must drift **upstream/downstream** to fresh water — emergent, no special-casing.
- **Render:** OPTIONAL faint shimmer/ripple on high-fish water tiles via the resource pass (kind=Fish branch); MVP can ship fishing without a node sprite (clickable + HUD count) and add the water shimmer later. **[OPEN C]** render fish density or not for M-fishing.

## 11. HUNTABLE GAME — mobile prey herds (→ meat)

**Distinct from §2 animal PACKS** (those are _hostile predators_ — wolf/bear/lion/jackal `PlayerType.Bot` tribes you raid). Game herds are _passive PREY_: **elk/deer cluster near woodland** (Forest/Jungle/Green), **plains game (bison/antelope)** on open grass, etc. They are the second **meat** source.

- **Entity:** lightweight **neutral herd** objects (NOT players, NOT full units) — a tile position + size + species, tracked in a `HerdManager` (seeded stream, e.g. `simpleHash(gameID)+5`). Spawned near their preferred biome/terrain (and near relevant resources).
- **Mobile (keeps you drifting, like fish):** a bounded per-tick `HerdDriftExecution` nudges each herd toward its preferred biome / away from threats (capped herds/tick, TileRef-ordered, deterministic). Herds wander — you follow them, which pulls your fluid territory (§3) around the map.
- **Fog-gated (§9):** a herd renders **only** if its tile is in your territory (owned + sight radius) OR scout-revealed — **unless** it wanders right up against / into your territory, then it's visible. Same visibility mask as resource nodes.
- **Hunt:** click a herd within reach → `HuntExecution` (mirror `HarvestExecution`): revalidate proximity/ownership, **sacrifice population** (`removeTroops(config.huntTroopCost())`), `addMeat(config.meatPerHunt() * herdSize)`, then shrink/disperse the herd (it must regrow or respawn elsewhere). Over-hunting a region empties it ⇒ drift on.
- **Render:** new herd sprite(s) (elk / plains variants) in the unit or a small herd overlay pass, fog-gated. **ART GAP** → tinted marker fallback until art (same policy as resource nodes).

## 12. PROCEDURAL PLACEMENT & MOVEMENT — the "proper system" (supersedes salt-and-pepper rolls)

Per-tile independent probability rolls (current `ResourceSeedExecution`, and the §4 density knobs) are _random_ but **not realistic** — they salt-and-pepper resources uniformly. Real forests grow in **stands**, rock fields follow **ranges**, fish run along **coasts/rivers**, game roams **near** its biome. Established PCG practice (sources in chat) gives a layered recipe; here adapted to the **lockstep-deterministic** sim.

### 12.1 Placement — layered, seeded, terrain-logical, clustered (per-game varied)

Each layer multiplies into the next; all seeded from `simpleHash(gameID)+<offset>` so every client computes identical results (lockstep) yet every game differs.

1. **Terrain/biome gate (hard):** a kind is only _eligible_ where it's plausible — Wood ∈ {Forest, Jungle, Green}; Rock = any land, concentrated on Mountain/Highland; Fish = water tiles that are `isShoreline` or river. (Game herds spawn via the herd manager, §11, not tile seeding.)
2. **Worley / cellular patch field (the clustering layer):** scatter `K` seeded feature points for the kind; each tile belongs to its nearest feature's _cell_; only cells whose seeded value < `richnessThreshold` bear the resource. → discrete **stands/fields/ranges**, not uniform scatter. Worley is the established choice for clustered resource regions & biome boundaries. Use a coarse feature-grid for O(1) nearest-feature lookup so init stays ~O(tiles).
3. **Value-noise density (natural falloff):** within a rich cell, a seeded value-noise field sets local abundance (dense core → sparse feathered edge), so patches don't have hard borders.
4. **Blue-noise / Poisson-disk spacing (kills both clumping AND salt-and-pepper):** place individual nodes with a seeded Poisson-disk / blue-noise so a stand reads like a real stand — min-spacing between trees, gaps, no stacking. Grid approach: seeded Bridson, or grid-jitter + min-distance suppression. Different `minDist` per kind (trees sparser than grass, mob/herd seeds sparser still).
5. **DETERMINISM (non-negotiable):** seed every layer from gameID; use **integer hash-based noise** (hash → value/Worley), NOT platform-divergent transcendentals (`sin/exp/pow`) in the _sim_ — those can diverge across platforms and desync lockstep. Keep fancy trig in the **render shader only** (already true). The §4 density knobs (`rockChanceBase`, `woodChanceForBiome`) become inputs to layer-2/3 _richness/abundance_, not standalone per-tile probabilities.

> Net: `eligible(terrain) × inRichCell(Worley) × density(value-noise) × spaced(Poisson)` → realistic, terrain-logical, per-game-random, deterministic.

### 12.2 Movement — believable wander for fish & game (not static)

- **Game herds (§11):** boids-lite steering (Reynolds 1987 — separation / alignment / cohesion) + **wander** (smooth seeded heading drift) + **biome attraction** (steer toward preferred terrain via the layer-2 field gradient) + **threat flee** (away from predator packs / players). Per tick: sum steering → step ≤1 tile; seeded `PseudoRandom(gameID)+5`; cap herds processed/tick (bounded scan) for perf+determinism. Herds _spawn_ near their preferred biome's rich cells.
- **Fish (§10):** "fishing grounds" = Worley-clustered rich cells on coast/river that **deplete** on harvest, **regen** over time, and whose rich cells **slowly drift** (periodically re-seed feature points on a long cycle) so grounds _shift_ — you can't camp one stretch forever; over-fish ⇒ move up/down-coast or -river.

**Build note:** factor this as a small reusable `src/core/pcg/` module — `Hash` (deterministic int hash), `WorleyField` (seeded cells + richness), `ValueNoise` (seeded density), `PoissonGrid` (seeded blue-noise) — consumed by `ResourceSeedExecution` (static: wood/rock/fish) and the `HerdManager`/`FishField` (dynamic). One tested PCG core, many consumers (anti-sprawl).

## ADDENDUM amendments to earlier sections

- **§3 movement — fluid + costly:** keep/strengthen the nomadic _drift, not hold_ model — territory must **rewild and stay fluid** (you drift to chase resources; settlements/Cities anchor land, the rest sheds). NEW: **moving consumes resources** — each tile drifted (advance/relinquish beyond the settled radius) costs `config.moveResourceCost()` wood/rock (`removeWood/removeRocks`, clamped); drift stalls when you're tapped out. Movement is a resource sink alongside harvest's population sink.
- **§4 density — DONE (this pass):** `rockChanceBase` 0.03→**0.01**, `rockMountainMult` 3→**4** (rock clusters on rocky ground); `woodChanceForBiome` Forest/Jungle 0.25→**0.10**, Green 0.06→**0.02**. Resources are now scarce. + add the §8.3 population cost to harvest.
- **§6 income — STRENGTHEN to ZERO in Primitive:** while `age==Age.Primitive`, `goldAdditionRate` returns `0n` (no passive drip at all). Primitive gold comes **only** from caravan trade (and raids/conquest per §6). Imperial+ keeps the existing income model.
- **§6 age gate — City = 20× temp:** permanent settlement (City) cost = `20 × (temp-building cost)` (hut/outpost/scout). Combined with zero passive income + risky trade, saving it is a long, uncertain grind. Keep advance criteria hard.
- **§7 rendering — DONE (this pass):** flat tinted dot → **procedural** faceted-boulder (rock) / mottled-canopy (wood) shader, per-tile size+shape hash jitter, muted colors + grounding rim-shadow, **zoom-gated** (`minZoom`/`fadeRange` in render-settings) so nodes vanish at overview and fade in near harvest range. Pending: §9 fog visibility input + mini-2018 pixel-render verify.
- **ART / STYLE BAR — cross-cutting (rocks, trees, fish, game herds):** every resource visual must look **realistic and integrate with the map's art style** — not flat placeholder markers. The procedural boulder/canopy shader is the _interim_ bar; the target is style-matched sprite atlas art (or richer procedural shading) tuned against the live terrain aesthetic — boulders that sit in the terrain shading, tree clumps that read as the map's woodland, a subtle water shimmer for fish, recognizable elk/plains-game silhouettes. **Every resource render is GUI work → verify by rendering on mini-2018 and running a fresh-eyes judge against the map style** (per the verify-before-done GUI rule), never sign off from code. Replace the ART-GAP fallbacks as real art lands; keep colors/scale terrain-integrated, never high-contrast stickers.

### Build milestones (each: tsc + npm test, then WebGL/visual verify on **mini-2018**, not the OCI hub)

- **M1 — Visual polish** ✅ code-complete (tsc 0 err); pending render verify (fold into M2).
- **M2 — Fog + Scout** (§9): visibility mask + ScoutLookout structure + reveal. Render-verify resources hidden outside reach.
- **M3 — Trade Outpost + Caravan economy** (§8): new UnitTypes, `AStar.Land`, `TradeOutpost/TradeCaravan` executions, capture/predation, resource→gold + population cost. The big one.
- **M4 — Balance** (§6 amend): zero Primitive income, City=20×temp, tune lifespans/rates. Verify the full loop end-to-end in SP.
