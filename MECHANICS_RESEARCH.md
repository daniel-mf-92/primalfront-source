# Eonfront — Anti-Snowball Mechanics Design Document

**Status:** Prioritized design spec, derived from 20 structured research findings across Civ VI, AoE II/IV, Rise of Nations, Humankind, Forge of Empires, The Battle of Polytopia, the .io territory genre (Territorial.io / OpenFront.io / Generals.io), StarCraft/CoH/WC3/C&C, and EU4/Paradox.
**Codebase ground truth:** Eonfront is a fork of OpenFront. The base 3-Age system (`Age` enum, `techPoints`, `threatScore`, `advancePenalty`, age-scaled costs, building upkeep, border upkeep, leader tax) is **already implemented** per `EONFRONT_SPEC.md` (verified: `PlayerImpl._age`, `Config.advanceAgeCost`, `leaderTaxRate`, `AdvanceAgeExecution.ts`, etc. all exist). This document specifies what to build **on top of** that base. Every adaptation below cites the real OpenFront hook it extends.

Determinism is the hard constraint: `src/core` is a pure, no-dependency, seeded-PRNG, **no-floating-point-in-divergent-paths** sim running in a Web Worker. Gold is `bigint`. Every mechanic here is expressed as integer/fixed-point state updated on the existing tick loop, validated through Zod intents in `src/core/Schemas.ts`.

---

## 1. Executive Summary — Design Pillars

Five pillars emerged consistently across the research. They are the lens for every accept/reject decision below.

1. **Snowball is a feedback loop, break the loop — don't punish the leader.** The strongest, most-cited anti-snowball levers are *structural and subtle* (StarCraft saturation cap, CoH upkeep, RoN Commerce Limit, OpenFront troop cap), not punitive rubber-bands (WC3 income cliff was flagged as the cautionary tale). The leader should hit **smooth diminishing returns and rising surface area**, so each marginal tile is worth less and harder to defend — never a flat "you're winning so you're nerfed" tax that feels bad. *(Eonfront already has a `leaderTaxRate` = `threatScore * 0.30`; treat that as the ONE explicit rubber-band and keep everything else structural.)*

2. **Decouple "most tiles" from "wins the game."** The single highest-value finding (Humankind Fame, RoN Commerce Limit, Polytopia territory-scaled tech) is that **map domination must not auto-convert into economy, tech, AND victory simultaneously**. Eonfront already breaks tiles→tech (age cost scales with expansion) and tiles→economy (border + building upkeep). The missing leg is tiles→victory: add non-domination win/score paths so a wiped or boxed-in player still has agency.

3. **Conquest must be expensive to *keep*, not just to *take*.** EU4 overextension, RoN attrition + assimilation, Civ VI loyalty: grabbing land faster than you can integrate it should make you temporarily *weaker* (revolts, attrition bleed, ungoverned tiles). This converts the OpenFront failure mode ("one huge troop wave rolls across the map to the capital") into a conquer→digest→conquer rhythm.

4. **The social layer is the best anti-snowball engine.** Timed alliances + coalitions-against-the-leader (OpenFront, Civ VI Emergencies, EU4 coalitions) let the table self-correct. Eonfront already has timed alliances + a traitor system + `threatScore`; the high-value add is making `threatScore` *socially actionable* (visible "glowing red" leader + a coalition pact subtype + plunder that makes the leader a juicy target).

5. **Power must be gated, tiered, and telegraphed — never a linear ramp.** Discrete Age spikes with a visible **vulnerability window** during advancement (AoE timing attacks, the existing `advancePenalty`), cross-age unit obsolescence so early leads don't carry, and a hard cap on the endgame (RoN Armageddon Clock) so the Modern age doesn't collapse into superweapon spam. This directly serves the stated goal: *avoid a linear rush to an overpowered endgame.*

---

## 2. MUST-HAVE Mechanics

Deduped across all sources. Ordered by value-to-effort. Each tags the **system it extends** in Eonfront's architecture: `model` (Game.ts/PlayerImpl), `economy` (Config goldAddition/troopIncrease), `buildings` (UnitType/Config unitInfo), `combat` (attackLogic/AttackExecution), `diplomacy` (alliance/*), `victory` (WinCheckExecution), `hud` (client), `progression` (Age/tech).

### M1. Territory-scaled troop cap with soft/hard band + interest decay
- **System:** economy + model
- **Source:** Territorial.io (soft cap 100×pixels, hard cap 150×, interest decays to 0 in the band); OpenFront (pop cap from land/cities); RoN Commerce Limit.
- **Why:** The #1 economic anti-snowball. A leader who stops fighting *cannot* bank an infinite troop stockpile to one-shot the map; growth throttles itself, forcing the dominant player to keep committing and exposing forces. "Use it or lose it" tempo.
- **Adaptation:** Eonfront already has `Config.maxTroops()` and `troopIncreaseRate()`. Formalize a band: `softCap = K_age * maxTroops`, `hardCap = 1.5 * softCap`, where `K_age` rises with Age (advancing an Age is itself a cap unlock — reinforces progression). Interest/growth scales linearly from full at `softCap` to 0 at `hardCap`; never exceed `hardCap`. All integer/fixed-point on the existing `troopIncreaseRate(player)` path.
- **Complexity:** low.

### M2. Defender's advantage (attacker pays ~2×) scaled by structures + terrain + Age
- **System:** combat
- **Source:** Territorial.io / OpenFront (defense 2× attack); AoE2 walls/castles; SC2 high ground.
- **Why:** Makes aggression expensive so a leader can't cheaply roll smaller players, rewards picking overextended targets over brute force, and gives the underdog a real chance on home soil. Pairs with M3 to make cross-Age steamrolling punishing.
- **Adaptation:** Eonfront has `attackLogic()` and `defensePostDefenseBonus()` already. Extend the resolution so `attackerLoss ≈ 2 * defenderLoss`, amplified by (a) adjacent defensive structures (existing DefensePost bonus path; new Palisade/ArtilleryFort reuse it per spec §3), (b) terrain class of the defended tile, and (c) a **cross-Age multiplier**: a Primitive attacker into a Modern defender is punished hard. Deterministic integer math in `attackLogic`.
- **Complexity:** low.

### M3. Cross-Age unit obsolescence (Age combat-power tiering)
- **System:** combat + progression
- **Source:** Rise of Nations (knight can't fight a tank); AoE age power spike.
- **Why:** Ensures an early army lead does **not** carry to the endgame — the single most important lever against "linear runaway." Creates clear comeback windows: a behind player who tech-jumps an Age can suddenly counter a much larger old-tech army. Makes hoarding old troops a trap, pulling everyone to spend on advancing.
- **Adaptation:** Make effective combat strength in `attackLogic` a function of the combatant's `age()`. A Modern troop value should beat a meaningfully larger Primitive value at equal gold. **Tune so a one-Age deficit is recoverable but a two-Age deficit is dire.** `age()` already exists on Player; this is a multiplier table in Config (`ageCombatMult[attackerAge][defenderAge]`).
- **Complexity:** low.

### M4. Overextension / integration debt (digestion cost on raw conquest)
- **System:** model + economy
- **Source:** EU4 overextension (uncapped, scales penalties; only coring removes it); Stellaris sprawl; RoN assimilation timer; Civ VI loyalty.
- **Why:** Decouples "tiles grabbed" from "tiles usable." A player who blitzes faster than they integrate gets *temporarily weaker* (reduced income/regen, frontier revolts), so raw land-grab speed self-limits and the OpenFront "one wave to the capital" play stops paying off. Pillar 3 incarnate.
- **Adaptation:** Track per-player `unintegratedTiles` = owned − integrated. `overextension = Σ(tileWeight) over unintegrated tiles / playerEconomyBase`, clamped. Penalty (up to ~40% at 100%): scale down `goldAdditionRate` and `troopIncreaseRate`; past a threshold, deterministically spawn neutral "revolt" troops on the least-integrated frontier tile (trigger on a tick counter, NOT a die roll). Integration is a background FIFO queue draining gold/tick; **throughput gated by Age** (`adminEfficiency` rises Primitive→Modern), so a Modern player digests fast and a Primitive over-grabber chokes. Newly captured tiles yield ~25% income until integrated. Reuses the existing per-tick `PlayerExecution.tick()` and `goldAdditionRate` cache pattern.
- **Complexity:** med.

### M5. Coalition-against-the-leader (threatScore made socially actionable)
- **System:** diplomacy + hud
- **Source:** OpenFront timed alliances + betrayal penalty; Civ VI Emergencies; EU4 aggressive-expansion coalitions.
- **Why:** The strongest anti-snowball tool of all — it lets the whole table coalition against whoever is winning, which is exactly the dynamic that prevents a linear rush to an unstoppable endgame. Eonfront already computes `threatScore` ∈ [0,1] and has timed alliances + a traitor counter; this makes the meter *do something socially* instead of only taxing gold.
- **Adaptation:** (1) **Visibly surface the threat leader** on the map/HUD (glow red, threat bar) — reuses `threatScore` already serialized in `PlayerUpdate`. (2) Add a **Coalition** alliance subtype: when a player's `threatScore` crosses a threshold they become eligible as a coalition *target*; other players can join a time-boxed pact (mirror `AllianceRequestExecution`/`AllianceImpl` with an `expiresAt`) granting joiners a temporary buff vs the target (e.g. +attack, shared vision) and a mutual non-aggression lock between members. Success below-threshold dissolves it; failure grants the target a small "resilience" buff so it isn't a free dogpile. New `CoalitionExecution.ts` mirroring the alliance executions; new Zod intent.
- **Complexity:** high.

### M6. Plunder / conquest payout (kill-reward economy)
- **System:** economy + combat
- **Source:** Territorial.io (annex pays out banked balance); OpenFront (plunder + captured-city yield to the finisher).
- **Why:** Turns a bloated leader into a reward piñata — incentivizes the rest of the table to gang up (composes with M5), funds the underdog who lands a decisive blow (a deliberate catch-up spike), and prevents stalemates by making the kill worth it.
- **Adaptation:** On tile/structure capture, transfer a fraction of the victim's banked gold (and a slice of troops) to the conqueror; the finisher on a contested region gets the plunder. OpenFront already has `boatCapturedTrade` precedent for value-transfer-on-capture. Deterministic transfer on the capture event in `AttackExecution`. Combined with M1's cap this lets an underdog leap forward without letting a hoarder sit.
- **Complexity:** low.

### M7. Multi-track cumulative score + alternative win condition (Renown)
- **System:** victory + model + hud
- **Source:** Humankind Fame (sole victory metric, never lost); CoH victory points; AoE4 Wonder/Sacred-site win.
- **Why:** Closes the pillar-2 gap (tiles→victory). Decouples winning from map domination so the biggest-army rush is no longer the dominant line, and a wiped/trailing player keeps banked score (a comeback lane). Huge for .io retention — early kills aren't game-over.
- **Adaptation:** Add a deterministic integer **Renown ledger** per player, accumulated on events Eonfront already emits (tiles-ever-held, gold-ever-earned, troops-killed, structures-built, alliances-formed, first-to-reach-each-Age). `WinCheckExecution` already has time-limit + percentage-tiles win; add a second win mode: **highest Renown at the time cap**. Since Renown is never decremented, a player reduced to one tile can still place top-3, and an economy/turtle build can win on points. `StatsImpl.ts` is the natural home for the counters.
- **Complexity:** med.

### M8. Per-attacker attrition / escalating cost to keep advancing
- **System:** combat + model
- **Source:** Forge of Empires Guild Battlegrounds (each successful capture raises *your* attrition, making every next defender stronger; resets per season); RoN deep-territory attrition.
- **Why:** A per-player escalator so no single strong player chain-captures the whole map alone — their own momentum taxes them, forcing breadth/consolidation. Deterministic, cheap, and directly attacks the linear-rush problem. Distinct from M4 (which taxes the *held result*); this taxes the *act of continuous advancing*.
- **Adaptation:** Track `attritionLevel` per player, reset each match. Each successful tile capture increments it. In `attackLogic`, defender strength on any contested tile = `base * (1 + k * attackerAttritionLevel)` using the attacker's level at resolution tick (stays lockstep-deterministic). Scale `k` per Age so Modern attrition bites harder. **Counterplay:** a "Supply Depot" structure (or supplied-tile flag, RoN-style) suppresses attrition within radius N — deterministic fractional reduction, NOT a chance roll. Show the player their attrition + next-tile projected defense in the HUD before committing.
- **Complexity:** med.

### M9. Age-up vulnerability window (already partially present — formalize + telegraph)
- **System:** progression + combat + hud
- **Source:** AoE II/IV timing attacks; the existing Eonfront `advancePenalty`.
- **Why:** Concentrates power into discrete, earned spikes and gives a trailing player a concrete, telegraphed moment to punish a leader who over-commits to teching up. The reward (the Age spike) is balanced by a real risk.
- **Adaptation:** Eonfront already drains gold+techPoints and applies `advancePenaltyRegenMult` (0.5 troop regen) for `advancePenaltyTicks` (~45s). **Add:** (a) a visible "Advancing" state on the player's tiles/HUD so neighbors *see* the window (currently it's only a regen debuff), and optionally (b) a small defensive debuff during the window. Make the Modern age cost the steepest jump (AoE-style gating) so rushing it requires consolidating first.
- **Complexity:** low.

### M10. Building upkeep + concave per-tile income (already present — keep + tune)
- **System:** economy
- **Source:** Civ/CoH upkeep; RoN economic radius diminishing returns; OpenFront exponential structure cost.
- **Why:** The smooth, non-punitive backbone curve everything else sits on (pillar 1). A giant empire still leads but its marginal gold/troop growth flattens, leaving room for focused smaller players — without a frustrating hard rubber-band.
- **Adaptation:** Eonfront already subtracts `buildingUpkeepPerTick` (Factory:15, Silo:20, …) and `borderUpkeepPerTile * borderTiles` from `goldAdditionRate`, clamped ≥0. **Add** a concave per-tile income curve (`incomePerTile = base / (1 + ownedTiles/T)`) so the 500th tile earns far less than the 50th, and make per-type structure cost exponential with a cap (OpenFront pattern: `base * growth^count`, clamped). Pure tuning on existing methods.
- **Complexity:** low.

---

## 3. NICE-TO-HAVE

- **Distance-bonus trade routes / Harbor income** (OpenFront `tradeShipGold(dist)` already exists; Harbor structure is in the spec). A non-territorial income stream a weaker coastal player can exploit, and a target raiders can plunder. *(med)*
- **Branching Age-up via Landmark choice** (AoE4): each Age advance picks one of two structures — economy-leaning vs military-leaning — that persists and is capturable. Adds decision-diversity to progression. *(med)*
- **Globally-unique Wonders** (RoN one-per-game; Polytopia once-per-game monuments): a small set of one-owner power-spike structures, destructible/capturable, optionally a Modern-age timed-countdown "Wonder victory" that rallies a coalition. *(med)*
- **Map objective / "Eon Site" trickle nodes with contest-pauses-timer** (AoE4 Sacred Sites): fixed high-value tiles emitting income that ignores the concave cap, plus a hold-to-win timer that *pauses* while an enemy contests — an elegant anti-stalemate rubber-band giving the underdog a rally point. *(med)*
- **Armageddon Clock for Modern superweapons** (RoN): if Modern keeps MIRV/Nuke (it does — `MIRVExecution`, `NukeExecution` exist), gate launches behind a shared global doomsday integer shown to all; at zero everyone loses. Caps endgame WMD spam. One integer + UI. *(low)*
- **Catch-up: free tech / cheaper Age on first contact with a new opponent** (Polytopia): boxed-in players (many neighbors) accrue discounts; open-land leaders get none. Deterministic first-adjacency trigger. *(low)*
- **Out-of-sync 0-score brake** (Humankind): a player a full Age ahead of the median still advances but earns 0 Renown for it — tempo, not points. Composes with M7. *(low)*
- **Retreat / partial-loss instead of annihilation** (CoH): a failed attack returns a fraction of troops to the origin tile rather than zeroing the stack (`BoatRetreatExecution`/`RetreatExecution` precedents exist). Softens the death spiral. *(med)*
- **Scorched-earth structure refund** (C&C): raze your own city/port for ~40% gold before it's captured, denying the conqueror a working asset. Trivial deterministic refund. *(low)*
- **Troops-vs-economy slider** (OpenFront worker/troop split): a single always-relevant macro knob whose sweet spot shifts by Age and threat. *(low)* — verify whether the OpenFront fork already exposes this before building.
- **First-to deeds** (Humankind competitive deeds): ~15 one-time global bounties (first port, first 50 tiles, first Modern unit) feeding the Renown ledger; deterministic lowest-player-id tiebreak. *(low)*

---

## 4. AVOID / Anti-Patterns

These either *cause* snowballs or kill fun. Explicitly rejected.

- **Punitive income cliffs (the WC3 mistake).** Humankind's own community and the Wayward Strategy essays flag hard rubber-bands as the worst outcome — they feel like punishment for playing well. Keep catch-up *subtle and structural* (CoH-smooth), and confine the one explicit penalty to the existing `leaderTaxRate` (capped 30%, threat-proportional).
- **Untouchable / global economy upgrades.** The StarCraft failure mode (Dawn of War 1, C&C Generals: eco safe in main base) removes all comeback paths. **Never add a "+X% gold" global buff that can't be attacked.** Keep ALL income tile/structure-local and destructible — aligns with OpenFront's model.
- **One dominant progression path (the Humankind culture-switch trap).** Humankind made switching culture strictly dominant because the loyalty bonus was too weak, collapsing a "flexible" system into a single line. If we add Landmark/Doctrine choices, **playtest the crossover point** so commit-vs-switch stay in a comparable payoff band.
- **Ages that blitz past.** Humankind eras flipped too fast and desynced the field. Set Age-gate costs high enough that each Age lasts a meaningful number of minutes; use the out-of-sync 0-score brake so the first to blitz can't run away.
- **Permanent sunk-cost destruction as the only outcome.** Annihilation-on-loss is the #1 snowball driver (AoE/CoH lesson). Prefer capture/retreat/refund so losses are recoverable.
- **Linear, monotonic power ramp.** No smooth "buy your way to OP endgame." Power must be gated behind discrete, vulnerable Age transitions with obsolescence — this is the stated core goal.
- **RNG in the divergent sim path.** Hard determinism constraint: no `Math.random`, no floats in branchy code, no `Date.now()` in `src/core`. Every "chance" mechanic from the source games (FoE support-building %, EU4 revolt rolls) must be reimplemented as a deterministic threshold/counter.
- **Adding a 4th resource.** Polytopia's clarity lesson: route tech/structure spend through gold + the existing techPoints; do **not** invent a separate "research points" pool on top.

---

## 5. Implementation Roadmap — Independent Feature Modules

Grouped so parallel agents can work with minimal file overlap. Each module lists the files it touches and an effort tag. **Shared-file hotspots** (`Config.ts`, `Game.ts`, `attackLogic`, `PlayerExecution.tick`, `Schemas.ts`) are flagged so the orchestrator can sequence or assign them to a single agent to avoid merge conflicts.

> **Sequencing note:** The base Age system (spec Layers A–E) is the foundation and is already implemented. Modules below assume it is merged and `tsc`-green. Build M-modules in roughly the order shown; M7 (Renown/victory) and M5 (coalition) are the most independent and can start immediately in parallel.

### Module A — Economy curve hardening (M1, M10)
- **Files:** `core/configuration/Config.ts` + `DefaultConfig.ts` (`maxTroops`, `troopIncreaseRate`, `goldAdditionRate`, `unitInfo` cost closures). Minimal new state on `PlayerImpl`.
- **Work:** soft/hard troop-cap band with interest decay; concave per-tile income; exponential capped structure cost.
- **Effort:** low. **Hotspot:** Config.ts (shares with C, F) — assign Config-touching modules to one agent or stagger.

### Module B — Combat resolution overhaul (M2, M3, M8)
- **Files:** `core/configuration/Config.ts::attackLogic`, `core/execution/AttackExecution.ts`, `PlayerImpl` (`attritionLevel`), new `core/execution/SupplyDepotExecution.ts` (+ Supply structure in Game.ts UnitType).
- **Work:** 2× defender advantage; cross-Age combat multiplier table; per-attacker attrition escalator + supply suppression.
- **Effort:** med. **Hotspot:** `attackLogic` (shares with nothing else major — good isolated target), Game.ts UnitType enum (shares with D).

### Module C — Overextension / integration (M4)
- **Files:** `PlayerImpl` (`unintegratedTiles`, `overextension`, integration queue), `core/execution/PlayerExecution.ts::tick` (penalty application + revolt spawn), `Config.ts` (`adminEfficiency`, penalty curves).
- **Work:** integration FIFO queue, overextension penalty on income/regen, deterministic frontier revolt spawns, Age-gated digestion throughput.
- **Effort:** med. **Hotspot:** `PlayerExecution.tick` (shares with A's per-tick economy and the existing techPoint accrual — coordinate), Config.ts.

### Module D — New structures + wonders (Harbor income, Supply, optional Wonders/Eon Sites)
- **Files:** `Game.ts` (UnitType enum, structure groups, buildable list), `Config.ts::unitInfo`, `core/execution/ConstructionExecution.ts`, per-structure executions (clone DefensePost/City pattern), `client/hud/.../BuildMenu.ts` + `UnitDisplay.ts` (gating already exists for minAge).
- **Work:** Harbor income wiring; Supply Depot (for Module B); optional unique Wonders + Eon Site trickle nodes.
- **Effort:** med. **Hotspot:** Game.ts UnitType enum (shares with B) — define ALL new UnitTypes in one coordinated PR.

### Module E — Diplomacy / coalition (M5)
- **Files:** new `core/execution/CoalitionExecution.ts`, `core/game/AllianceImpl.ts` / `Game.ts` (coalition subtype or parallel pact), `core/Schemas.ts` (new intent), `core/execution/ExecutionManager.ts` (route intent), client send-intent path + HUD threat-leader glow.
- **Work:** visible threat leader; time-boxed coalition pact vs high-threat target with buffs + mutual NAP; resilience consolation on failure.
- **Effort:** high. **Hotspot:** `Schemas.ts` + `ExecutionManager.ts` (shared with any new-intent module — coordinate the intent union edits).

### Module F — Plunder economy (M6)
- **Files:** `core/execution/AttackExecution.ts` (transfer on capture), `Config.ts` (plunder fraction).
- **Work:** banked-gold + troop transfer to finisher on tile/structure capture.
- **Effort:** low. **Hotspot:** `AttackExecution.ts` (shares with Module B — merge into the same combat-overhaul PR to avoid conflict).

### Module G — Scoring & victory (M7 + NTH out-of-sync brake + first-to deeds)
- **Files:** `core/game/StatsImpl.ts` / `Stats.ts` (Renown counters), `core/execution/WinCheckExecution.ts` (Renown win mode), `core/game/GameUpdates.ts` + `GameUpdateUtils.ts` (serialize Renown), client leaderboard HUD.
- **Work:** cumulative Renown ledger on existing events; Renown-at-time-cap win mode; 0-score-when-too-far-ahead brake; first-to deeds.
- **Effort:** med. **Hotspot:** GameUpdates serialization (shares the diff pattern with the base Age system — follow the same `setIfDifferent` convention). Otherwise highly independent — **good first parallel module.**

### Module H — Endgame cap (NTH Armageddon Clock)
- **Files:** `Game.ts` / `GameImpl.ts` (shared doomsday integer), `core/execution/NukeExecution.ts` + `MIRVExecution.ts` (decrement + zero-check), `WinCheckExecution.ts` (everyone-loses trigger), client HUD clock.
- **Work:** shared launch-budget integer, decrement per WMD, draw/everyone-loses at zero.
- **Effort:** low. **Hotspot:** none major — isolated. Can run parallel with G.

### Module I — HUD & telegraphing (M9 advancing-state visibility + threat/attrition/renown readouts)
- **Files:** `client/hud/.../ControlPanel.ts`, `client/render/...` (tile glow for advancing/threat), `client/components/leaderboard`.
- **Work:** "Advancing" visible state, threat-leader glow, attrition + projected-defense preview, Renown leaderboard column.
- **Effort:** med. **Hotspot:** client-only — fully parallel to all core modules, but depends on their serialized fields existing first.

**Recommended parallel waves:**
- **Wave 1 (no overlap):** G (scoring/victory), H (armageddon), A (economy curves). Different files, all build directly on the merged base.
- **Wave 2:** B+F merged (combat + plunder, both touch AttackExecution), C (overextension), D (structures).
- **Wave 3:** E (coalition — depends on threatScore being surfaced), I (HUD — depends on Waves 1–2 fields).

---

*Citations are inline per mechanic. Determinism caveat applies to every core mechanic: integer/fixed-point only, seeded-PRNG only, validated via Zod intents in `src/core/Schemas.ts`, serialized via the `PlayerUpdate` diff mechanism.*
