# Eonfront — Age System Implementation Spec (authoritative)

Fork of OpenFront. Adds a 3-Age tech-stage system + anti-snowball economy.
**This doc resolves all type/design ambiguity. Follow it exactly. Do not invent alternatives.**

Game is deterministic & runs in a Web Worker; ALL gameplay state must serialize to the client
via the PlayerUpdate diff mechanism. Gold is `bigint`; troops internally bigint, `troops()` returns number.

## 0. Canonical type decisions (NON-NEGOTIABLE)
- `Age` is a **numeric enum**: `export enum Age { Primitive = 0, Imperial = 1, Modern = 2 }` declared in `src/core/game/Game.ts` near the other enums.
- `techPoints` is a **`number`** (NOT bigint). Accrues per tick, store as float, display floored.
- `threatScore` is a **`number`** in `[0,1]` (0 = nobody, 1 = the dominant leader).
- `minAge` on `UnitInfo` is **`Age` (numeric)**, optional, default `Age.Primitive` (0).
- Advance penalty tracked as a tick deadline: `_advancePenaltyEndTick: Tick` (0 = inactive).
- All new Config knobs have **hardcoded defaults inside Config.ts methods** (Schemas.ts fields optional; do not require game-config changes to function).

## 1. Core model (Layer A) — files: Game.ts, PlayerImpl.ts, GameUpdates.ts, GameUpdateUtils.ts, Renderer.ts (client PlayerState), PlayerView.ts
Add to **Player interface** (Game.ts) and implement in **PlayerImpl**:
```
age(): Age;
setAge(a: Age): void;
techPoints(): number;
addTechPoints(n: number): void;
threatScore(): number;
setThreatScore(n: number): void;
advancePenaltyActive(): boolean;      // returns this.mg.ticks() < this._advancePenaltyEndTick
setAdvancePenalty(endTick: Tick): void;
canAdvanceAge(): boolean;             // age<Modern && gold>=cost.gold && techPoints>=cost.techPoints (uses config.advanceAgeCost(this))
advanceAge(): boolean;                // if canAdvanceAge: removeGold(cost.gold), techPoints-=cost.techPoints, age++, set advance penalty, return true; else false
```
PlayerImpl new private fields (default values): `_age: Age = Age.Primitive`, `_techPoints = 0`,
`_threatScore = 0`, `_advancePenaltyEndTick: Tick = 0`.

**Serialization:**
- `PlayerUpdate` (GameUpdates.ts): add optional `age?: Age; techPoints?: number; threatScore?: number;` + import Age.
- `PlayerImpl.toFullUpdate()`: include `age: this._age, techPoints: Math.floor(this._techPoints), threatScore: this._threatScore`.
- `diffPlayerUpdate()` (GameUpdateUtils.ts): add `setIfDifferent('age', prev.age === next.age)` and same for techPoints, threatScore.
- `applyStateUpdate()` (GameUpdateUtils.ts): `if (pu.age !== undefined) target.age = pu.age;` (and techPoints, threatScore).
- client `PlayerState` (Renderer.ts): add `age: number; techPoints: number; threatScore: number;` (init age:0, techPoints:0, threatScore:0 wherever PlayerState is initialized).
- `PlayerView.ts` (client proxy): add `age(): Age`, `techPoints(): number`, `threatScore(): number` reading from the backing PlayerState/PlayerUpdate. Match the existing getter pattern in that file.

**Layer A must leave `npx tsc --noEmit` GREEN.** (techPoints diffs every tick — acceptable for now; add a `// PERF TODO` comment.)

## 2. Config + anti-rush economy (Layer B) — files: Config.ts, Schemas.ts, PlayerExecution.ts, new AdvanceAgeExecution.ts, ExecutionManager.ts, Schemas.ts (intent), client SendAdvanceAgeIntent wiring
### Config.ts new methods (with these default tables):
```
ageExpansionCostMult(p): number   // [Primitive,Imperial,Modern] = [0.7, 1.0, 1.6][p.age()]
ageTroopRegenMult(p): number      // [1.5, 1.0, 0.7][p.age()]
advanceAgeCost(p): {gold: bigint, techPoints: number} | null
    // from Primitive->Imperial: {15000n, 400}; Imperial->Modern: {60000n, 1200}; Modern: null
advancePenaltyTicks(): number               // ~45s. Find ticks/sec in codebase; if 10/s -> 450. Use a named const.
advancePenaltyRegenMult(): number           // 0.5  (troop regen during penalty window)
techPointsPerTick(p): number                // base 1 + 0.5 per City owned + 1.0 per Granary owned (count via p.units(type))
buildingUpkeepPerTick(unitType): number     // Factory:15, Airbase:25, MissileSilo:20, SAMLauncher:10, ArtilleryFort:8, Harbor:0(income), DefensePost:2, else 0
borderUpkeepPerTile(): number               // 0.02 (small)
leaderTaxRate(p): number                     // p.threatScore() * 0.30  (up to 30% gold income tax on the leader)
```
### threatScore computation (in PlayerExecution.tick(), cache, recompute every ~20 ticks):
`threat = clamp01( (myTilesOwned - meanAliveTilesOwned) / (maxAliveTilesOwned - meanAliveTilesOwned) )`, 0 if denom<=0. Set via `player.setThreatScore(...)`.
### Apply in economy:
- `troopIncreaseRate(p)`: multiply base growth by `ageTroopRegenMult(p)`, and if `p.advancePenaltyActive()` also multiply by `advancePenaltyRegenMult()`. Keep existing max clamp.
- `goldAdditionRate(p)`: from base income subtract `(sum buildingUpkeepPerTick over p.units()) + borderUpkeepPerTile()*p.borderTiles().size`, then subtract `income*leaderTaxRate(p)`. Never return negative (clamp >= 0n). Cache the per-unit upkeep sum on PlayerImpl, invalidate on unit build/delete (or recompute every ~10 ticks to bound cost — pick the cheaper-to-implement; document choice).
- `unitInfo()` City & Factory cost: multiply final cost by `ageExpansionCostMult(player)` (player available in cost closure).
- **techPoint accrual**: in `PlayerExecution.tick()` add `player.addTechPoints(config.techPointsPerTick(player))`.
### Advance-age intent (networked):
- Add intent schema `AdvanceAgeIntentSchema` in Schemas.ts (type literal e.g. "advance_age", playerID). Add to the Intent union.
- `ExecutionManager.createExec()`: route "advance_age" -> `new AdvanceAgeExecution(playerID)`.
- New file `src/core/execution/AdvanceAgeExecution.ts`: implements Execution; on first tick, resolve player, call `player.advanceAge()`, then complete. Mirror the simplest existing single-shot Execution.
- Client: add a send method (mirror existing `sendXIntent` in the client transport/InputHandler/EventBus path) so the Advance button (Layer D) can dispatch it.

**Layer B must leave tsc GREEN.**

## 3. New buildings + minAge gating (Layer C) — files: Game.ts (UnitType + structure groups + buildable list), Config.ts (unitInfo cases), PlayerImpl.ts (canBuildUnitType), ConstructionExecution.ts
- Add UnitTypes: `Palisade, Granary, ArtilleryFort, Harbor, Airbase`. Register them everywhere existing structures are registered (UnitType enum, the structures/`unitTypeGroup`, the player-buildable list).
- `UnitInfo.minAge?: Age`. Set minAge in unitInfo() cases:
  - Existing: `MissileSilo`, `SAMLauncher`, `Factory` -> `Age.Modern`. `DefensePost` -> `Age.Imperial`.
  - New: `Palisade` -> Primitive(0), `Granary` -> Primitive(0), `ArtilleryFort` -> Imperial(1), `Harbor` -> Imperial(1), `Airbase` -> Modern(2).
- For each new building provide a `unitInfo()` case: a sensible `cost` (closure; reuse City/Port `costWrapper` scaling pattern), `constructionDuration`, `territoryBound:true` where structures are. Effects:
  - Palisade: contributes a defense bonus near owned border (if a clean hook exists in attackLogic/DefensePost pattern; otherwise register it like DefensePost and reuse its defense modifier path).
  - Granary: passive (counted by techPointsPerTick). No execution behavior needed beyond existing structure.
  - Harbor: +gold income (add its income in goldAdditionRate as a negative-upkeep, or simplest: count harbors and add flat income there).
  - ArtilleryFort / Airbase: build as gated structures with stats present. **Ranged-bombard / air-projectile combat is OUT OF SCOPE for this pass** — leave a clear `// TODO(eonfront): ranged/air projectile combat` and make them function as fortified structures (reuse DefensePost defensive behavior) so the build is green and they're placeable & gated.
- `PlayerImpl.canBuildUnitType(type)`: after existing cost/disabled checks add:
  `const info = this.mg.unitInfo(type); if (info.minAge !== undefined && this.age() < info.minAge) return false;`
- New buildings need construction routing in `ConstructionExecution.ts` — if they reuse a generic structure path, ensure they're handled; if each needs an Execution, reuse the simplest structure Execution (e.g. clone DefensePost/City execution) and register in ExecutionManager if required.

**Layer C must leave tsc GREEN.** Add/adjust any tests that assert UnitType/PlayerUpdate shape.

## 4. Client HUD (Layer D) — files: BuildMenu.ts, UnitDisplay.ts, ControlPanel.ts, RadialMenuElements.ts, MainRadialMenu.ts
- **Build gating**: in BuildMenu.ts and UnitDisplay.ts, when listing buildable structures, hide or disable entries whose `unitInfo.minAge > myPlayer.age()`. Show a small lock + required age label on disabled entries (reuse the existing affordability-disable styling pattern).
- **HUD display** (ControlPanel.ts): show current Age name (`["Primitive","Imperial","Modern"][age]`) and techPoints (floored). Place near gold/troops display, matching existing markup (Lit components — match the existing `render()` pattern and i18n usage; plain English strings are fine if i18n is heavy, but follow local convention).
- **Advance Age button**: add an element (RadialMenuElements.ts / MainRadialMenu.ts or a button in ControlPanel — pick whichever is least invasive). It shows next-age cost (gold + techPoints) and progress; enabled only when `myPlayer` can afford (gold & techPoints) and age<Modern; on click dispatch the advance_age intent via the Layer-B client send method. Disabled (greyed, with reason) otherwise.

**Layer D must leave tsc GREEN and `npx vite build` must succeed.**

## 5. Verify (Layer E)
`npx tsc --noEmit` green, `npm test` (vitest) — fix any shape tests broken by new fields, `npx vite build` succeeds. Capture evidence (counts/exit codes).

## Conventions
- Match surrounding code style. Numeric enum compares are fine (`age < minAge`).
- Keep changes minimal & localized. Don't refactor unrelated code.
- After EACH layer run `npx tsc --noEmit` from repo root and fix everything you introduced before returning.
- Report: files changed, what you did, tsc result (paste the tail), and anything you stubbed/deferred.
