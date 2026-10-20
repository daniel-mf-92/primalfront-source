# Ice-Age Primitive Economy — Diagnosis + Vision + Phased Plan (2026-06-16)

Authoritative spec for the "un-break the frozen Primitive era + build the ice-age
climate economy" program. Owner-directed (Daniel), built on a full code recon of
the **live** commit `40d6019` (= `master` d3538d7 + render/branding commits).

> Working branch for Phase 1: `feat/primitive-unbreak` (off `40d6019`).

---

## A. VERIFIED DIAGNOSIS — why the live game is "broken / all tribes locked, no development"

It is **not a crash**. It is a structural progression deadlock with several layers:

1. **Bots can NEVER develop (the core freeze).** Every Bot runs `TribeExecution`
   (`src/core/execution/TribeExecution.ts`), which **only attacks/expands** and
   even **deletes its own structures** (`deleteNextStructure()`). It never builds
   a Hut or City. Leaving Primitive requires owning Cities
   (`PlayerImpl.meetsAdvanceCriteria` :1460 — `unitsOwned(City) >= 2`), so **no bot
   can ever advance**, regardless of gold or cost. The §1 redesign added the
   human-tribe-vs-animal-pack _flag_ (`isAnimalPack`) but never gave non-pack
   ("human") tribes a _develop_ behavior. → every tribe is stuck Primitive forever.
2. **The era gate is a gold wall no one can pay.** Primitive→Imperial needs **≥2
   Cities** at `permanentSettlementCost()` = **125,000 gold** each (`Config.ts:1188`)
   - an 8,000 toll (`advanceAgeCost`). 258k gold total.
3. **Income was gutted with no replacement.** `goldAdditionRate` base cut ~85%
   (bot `8n`/tick, human `15n`/tick) minus border upkeep → often nets ~0. The
   designed replacement income (caravan **trade**, §8) **was never built**
   (`TradeCaravanExecution`/`TradeOutpostExecution` do not exist; only
   `RaidExecution.ts` exists and bots don't trigger it).
4. **Rewild makes a static blob, not a drift.** `rewildUnsupportedFrontier`
   (`PlayerExecution.ts:295`) sheds the tiles **farthest from the centroid**,
   symmetrically, so a tribe that isn't actively conquering one way just pulses in
   place (`nomadCampSupportRadius` = 11). → "land not moving fluidly in directions."
5. **Vanilla fill feel.** `expansionStyle(Primitive)` = `"front"` (vanilla
   OpenFront contiguous fill); only the (broken) rewild was meant to make it drift.
6. **Biome stripes.** `biomeAt` (`Biome.ts:32`) derives biome purely from
   `map.y()` → perfectly horizontal latitude bands.
7. **Resource over-density + no declutter.** Live seeds 25% of Forest/Jungle tiles
   with wood, 3% of all land with rock (`woodChanceForBiome`/`rockChanceBase`), and
   `ResourceNodePass` has **no zoom-gate** → every node draws at overview scale.

---

## B. THE VISION — ice-age climate economy

One global **climate clock** (deterministic, tick-driven) starts the world in an
**ice age** and slowly **recedes the ice caps** from poles toward the equator. The
recession is the era's progression timer — it gradually loosens every brutal
ice-age constraint until breaking out of Primitive becomes possible.

### Economy chain (deliberately lossy, population is the root currency)

- **population → harvest** (fish / game / wood / rock), harvest **costs population**.
- **resources → gold**: a **slow passive internal economy** converts the stockpile
  to gold over time; **a little faster** via **Trade Outposts** (max **3 per tribe**).
- **Primitive Farm** (a "primitive factory"): generates internal gold **slowly on
  its own**; **temporary** (ages out like other primitive buildings); must net
  **+30% over its full lifetime** vs its build cost; if **raided/damaged it goes
  quickly loss-making** (a raid sets it below break-even).

### Building + settlement cost ramps (driven by the climate clock)

- **All primitive buildings cost 3× baseline at ice-age start**, declining to
  **baseline (1×)** as ice fully recedes.
- **Permanent settlement (City)** cost starts **prohibitively high** in the ice age
  and **declines, settling at 20× a primitive building** (20 × hutCost 5,000 =
  **100,000**). This is the affordability ramp that finally lets tribes settle and
  advance — the climate clock IS the progression unlock.

### Tribe development behavior (the un-freeze)

- **Animal packs** (~20% of bots): nomadic predators — never settle, never tech,
  stay Primitive, drift fast, yield meat when raided/killed. (Already gated.)
- **Human tribes** (~80% of bots) + Nations + Humans: **develop** — accumulate
  gold from the economy, build Huts → Farms → Trade Outposts → Cities, and
  **advance age** when criteria are met. This behavior is the missing piece.

### Tech-diffusion "cheapening blast radius" (institution spread)

- When a player reaches a tech/era tier, it emits an **expanding cheapening field**
  that **creeps** outward across **reachable landmasses + small ocean gaps**, up to
  a max radius, and **stacks per achiever**. The more advanced neighbors around
  you, the **cheaper your own advance** (gold/tech/settlement). Extends the existing
  `grantEraDiffusion` + `_ageAdvanceCredit` (`PlayerImpl.ts:1516`) into a spatial,
  distance-decayed, stacking field.

### Resource scarcity (a search, not a given)

- Resources must be **scarce** so building is a **challenge and a search across the
  map** — you are NOT surrounded by plenty, especially **when ice is heavy**.
- Place as **discoverable clustered stands/ranges** (Worley + Poisson), not ambient
  salt-and-pepper, so finding a resource patch is a goal.
- **Spawn rate scales UP with ice recession**: very scarce under full ice →
  gradually more abundant as the caps melt (climate-clock-driven, Phase 3). Phase 1
  ships the low static baseline; Phase 3 makes it ramp.

### Climate / species coupling (fold in `feat/neanderthal-tribes` 159d5d3)

- Ice recession **reveals** water, land, and resources previously locked under ice.
- **Mammoths abundant in the ice age → decline → replaced by normal animals** as ice
  recedes (herd species transition).
- **Neanderthal tribes** boom early (pro-Neanderthal ice conditions, most start
  manpower, hunt mammoths, strong vs packs, can't hold money so can't advance) and
  suffer **escalating climate attrition → extinction by end of Primitive**. The
  attrition + mammoth boom-collapse curves already exist on branch `159d5d3`.

---

## C. PHASED PLAN

**Phase 1 — UN-BREAK (deploy off live ASAP).** Make the game progress + look right.

- **Tribe develop behavior:** non-pack tribes build Hut → City and advance age when
  affordable (and stop self-deleting their settlements). THE structural un-freeze.
- **Passive income engine:** convert stockpiled wood/rock/fish/meat → gold slowly
  (config knob) in `PlayerExecution.tick`, so tribes earn toward settlements.
- **Reachable era gate:** `permanentSettlementCost` 125k → **100k**; Primitive gate
  Cities-needed 2 → **1** (tunable; Phase 3 climate-ramps these back up early-game).
- **Directional rewild drift:** shed tiles **opposite the advance vector**, not
  symmetric-from-centroid.
- **De-stripe biomes:** deterministic integer-hash value-noise warp on the latitude
  fraction in `biomeAt` (no transcendentals — lockstep safe).
- **Resource declutter:** density down (wood 0.25→0.10 / 0.06→0.02, rock 0.03→0.01,
  mountainMult 3→4) + **zoom-gate** in `ResourceNodePass`.
- **Verify:** `tsc` + `npm test` + NEW headless **sim-arc test** proving ≥1 bot
  leaves Primitive within N ticks (the un-freeze, provable without WebGL) + vite
  build + render-verify on **mini-2018** + deploy via OCI-runner GHA.

**Phase 2 — ECONOMY STRUCTURES.** New `UnitType.PrimitiveFarm` + `UnitType.TradeOutpost`
(cost blocks, `ConstructionExecution` wiring, per-tick executions, lifecycle/expiry,
raid→loss-making for the farm, max-3 cap for outposts, bot AI to build them, build
menu, render). Farm net +30%/lifetime accounting.

**Phase 3 — CLIMATE CLOCK + ICE CAPS.** Global climate state; ice-cap terrain overlay
that recedes pole→equator over time; reveal of land/water/resources; cost ramps
(buildings 3×→1×, settlement prohibitive→100k) as functions of climate progress.

**Phase 4 — SPECIES + DIFFUSION.** Mammoth→normal-animal herd transition; fold in
Neanderthal tribes + attrition/extinction; tech-diffusion spatial cheapening field.

---

## D. DETERMINISM (non-negotiable — lockstep sim)

Every client re-runs identical ticks. ALL randomness uses seeded `PseudoRandom`
from a replicated value (distinct gameID offsets per stream); NEVER `Math.random` /
`Date.now`. Integer **hash-based** noise only in the sim (no `sin/exp/pow` — they
diverge across platforms and desync); keep trig in render shaders. Iterate tiles in
`TileRef` order. Gold is `bigint` — integer basis points, never float-cast. Bound
every per-tick scan (cap tiles/units examined). The climate clock is a pure function
of `game.ticks()` (replicated), so it is identical on every client with no new state.
