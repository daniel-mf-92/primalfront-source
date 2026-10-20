# Primitive-Era FULL-RECONCILE Plan (mine fa78db7 ⊕ theirs 65ca90d)

Merge-base aba89a9. MINE=`feat/primitive-era-redesign`@fa78db7 (taxonomy/resources/raid/harder-age/node-render). THEIRS=`65ca90d` on origin/master (glob-drift/HutExecution/canoe-wood/hut+house ICON art). Most unique work is in non-conflicting files; 10 files have textual conflicts; several clean-merge files still need SEMANTIC fixups.

## ARCHITECTURE DECISIONS

1. **DRIFT = THEIRS' glob-drift** (`rewildUnsupportedFrontier`, positional support-radius, runs every 10 ticks, sheds border tiles outside `nomadCampSupportRadius`(11) of owned centroid AND `settlementSupportRadius`(16) of any Hut/City). PathExpansion.ts STAYS DELETED (only AttackExecution imported it). GRAFT mine's: (a) faster pack drift — when `isAnimalPack()` multiply `maxRewildTilesPerTick` by `animalPackNomadMult()` and shrink both support radii by ~mult; (b) keep mine's pack-tech-gate `if(!isAnimalPack) addTechPoints(...)` which lives in same tick(). DROP mine's nomadicDrift/computeAdvanceVector/settledExemptTiles + constants nomadTargetTiles/settlementHoldRadius/hutLifetimeTicks. Hut-expiry-relinquish is redundant under positional rewild → drop it.
2. **HUT = THEIRS' HutExecution.ts** (dedicated Execution, expiry → hut.delete()). ConstructionExecution just addExecution(HutExecution) for Hut + shared `isStructure()` Hut case (identical both sides = the placement bug fix, survives). DELETE mine's hutExpireAtTick timer machinery. City permanent (both guarantee). Keep theirs' hutMinSpacing + PlayerImpl.hutSpawn.
3. **AttackExecution = THEIRS base** (front/glob, no PathExpansion, keep theirs' woodland-harvest block w/ its AI-NOTE + Age import). PORT mine's `target.isAnimalPack()` conquer block (meat on strike; conquer only if troops ≥ animalPackConquerRatio×packTroops else push-only return) + ResourceKind import. Remove all mine's pathMode/PATH_MAX_TILES_PER_TICK.
4. **Config = UNION knobs.** Delete mine's retired drift knobs (nomadTargetTiles, settlementHoldRadius, hutLifetimeTicks). Keep theirs': settlementSupportRadius, nomadCampSupportRadius, maxRewildTilesPerTick, hutLifespanTicks, hutMinSpacing, woodPerWoodlandTile, woodlandCaptureTroopCost, canoeWoodCost, expansionStyle(Primitive)="front", EonSite minAge fix, Port/Warship minAge:Imperial. Keep mine's: animalPackBotRatio, animalPackNomadMult, animalPackConquerRatio, raid\* knobs, woodChanceForBiome/rockChanceBase/rockMountainMult, diffusionContiguousDiscount 0.4.
5. **PlayerImpl** — ONE `_wood` (use theirs' CLAMPED `addWood=max(0,_wood+n)`, apply same clamp to addRocks/addMeat) + mine's `_rocks/_meat/addResource/_isAnimalPack` + ADD theirs' `removeWood` (canoe sink). Keep theirs' hutSpawn + Hut switch reroute. Keep mine's meetsAdvanceCriteria/advanceAge harder-age rewrite (pack-gate false, ≥2 Cities, gold toll). toUpdate = mine's superset (wood/rocks/meat/isAnimalPack).
6. **ECONOMY unified:** mine's NODE wood/rock/meat (ResourceSeedExecution + HarvestExecution + ResourceNodePass) = acquisition; theirs' canoe = wood SINK; KEEP theirs' woodland-capture wood bonus too (both feed addWood — additive, tuning dial). Keep theirs' isWoodland/woodlandAt Biome helpers. GameImpl/Game union all (mine resource layer + isAnimalPack + drainPackedResourceUpdates; theirs wood/removeWood + isWoodland).

## CONFLICT RESOLUTIONS (10 textual)

- PlayerExecution.ts → DECISION 1.
- PlayerImpl.ts → DECISION 5.
- ControlPanel.ts → keep MINE's renderResourcePile (🪵🪨🍖, non-zero gated); drop theirs' separate wood chip.
- render/types/Renderer.ts PlayerState → MINE's superset (wood,rocks,meat,isAnimalPack).
- PlayerView.ts → MINE's superset; **mine's primitiveDisplayName keyed off isAnimalPack() (NOT age) MUST survive = the jackal fix**.
- GameUpdates.ts / GameUpdateUtils.ts → MINE's superset (incl packedResourceUpdates channel).
- tests/GameUpdateUtils.test.ts + both render fixtures (nuke-telegraphs, player-status) → MINE's superset fields.
- tests/OverextensionC.test.ts → THEIRS' body (validates glob-drift) + ADD mine's `integrationDebt` digestion assertion.

## CLEAN-MERGE FILES NEEDING VERIFY (no markers but semantic)

- BuildMenu.ts: mine's hide-locked cleanup + theirs' Hut/House SVG icons both survive (disjoint).
- en.json: mine deletes requires_age; theirs edits city/hut + adds control_panel.wood (harmless if wood-chip dropped).
- Config.ts/GameImpl.ts/Game.ts/ConstructionExecution.ts/AttackExecution.ts: auto-clean but apply the semantic deletions above.

## MUST-SURVIVE (each side)

MINE: animal-pack taxonomy (Spawn/TribeSpawner/TribeSplit/Tribes/name-pass/PlayerView), node resources (GameMap resourceMap, ResourceSeedExecution, HarvestExecution, HarvestController, Schemas harvest, ExecutionManager harvest case, ResourceNodePass+shaders, worker→main packed-resource delta), RaidExecution + raid intent/menu, harder-age, build-menu hide-locked (BuildMenu+UnitDisplay), HUD pile, pack-faster-drift + pack-tech-gate + pack-conquer/meat.
THEIRS: glob-drift rewild, HutExecution + hutSpawn spacing, canoe TransportShip wood sink, woodland-capture wood, Biome woodland helpers, hut/house ICON art (icon-atlas.png/manifest, HutIconWhite/HouseIconWhite SVG, StructurePass level, structure-theme glyphs), Port/Warship/EonSite minAge fixes + their disjoint test edits.

## EXECUTE

Branch off fa78db7 → `git merge --no-commit --no-ff 65ca90d` → resolve 10 conflicts + semantic fixups per above → tsc → full `npm test` (--workers=1 if flaky) → vite build → commit.
