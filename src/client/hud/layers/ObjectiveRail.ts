import { Config } from "../../../core/configuration/Config";
import {
  Age,
  EraTriumph,
  Player,
  Unit,
  UnitType,
} from "../../../core/game/Game";
import { PlayerView } from "../../view/PlayerView";
import { UnitView } from "../../view/UnitView";

export type ObjectiveID =
  | "advance_age"
  | "build_economy"
  | "build_keystone"
  | "convert_resources"
  | "expand_defend"
  | "final_age"
  | "find_resources"
  | "found_city"
  | "generate_tech"
  | "save_advance_toll";

export interface ObjectiveRailItem {
  id: ObjectiveID;
  titleKey: string;
  detailKey: string;
  /** Values for the detail string's {placeholders}. */
  detailParams?: Record<string, string>;
  /** True when the next action is "go to the wood stand" (on-map marker). */
  pointToWood: boolean;
  progress: number;
}

export type GateValueKind = "gold" | "number";

export interface AgeGate {
  id: "city" | "gold" | "keystone" | "tech";
  labelKey: string;
  labelValue?: string;
  current: number | bigint;
  target: number | bigint;
  kind: GateValueKind;
  complete: boolean;
}

export interface PrimitiveGoldPipeline {
  resourceGoldPerSecond: bigint;
  farmGoldPerSecond: bigint;
  totalGoldPerSecond: bigint;
  resourceSpendPerSecond: number;
}

export type EraTriumphID = "ingenuity" | "prosperity" | "dominion" | "legacy";

export interface EraTriumphStatus {
  id: EraTriumphID;
  labelKey: string;
  detailKey: string;
  current: number | bigint;
  target: number | bigint;
  kind: GateValueKind;
  complete: boolean;
  blocked?: boolean;
}

export interface EraProfile {
  taglineKey: string;
  focusKey: string;
  unlockKey: string;
}

export const ERA_PROFILES: Record<Age, EraProfile> = {
  [Age.Primitive]: {
    taglineKey: "control_panel.era_tagline_primitive",
    focusKey: "control_panel.era_focus_primitive",
    unlockKey: "control_panel.era_unlock_primitive",
  },
  [Age.Classical]: {
    taglineKey: "control_panel.era_tagline_classical",
    focusKey: "control_panel.era_focus_classical",
    unlockKey: "control_panel.era_unlock_classical",
  },
  [Age.Imperial]: {
    taglineKey: "control_panel.era_tagline_imperial",
    focusKey: "control_panel.era_focus_imperial",
    unlockKey: "control_panel.era_unlock_imperial",
  },
  [Age.Feudal]: {
    taglineKey: "control_panel.era_tagline_feudal",
    focusKey: "control_panel.era_focus_feudal",
    unlockKey: "control_panel.era_unlock_feudal",
  },
  [Age.Enlightened]: {
    taglineKey: "control_panel.era_tagline_enlightened",
    focusKey: "control_panel.era_focus_enlightened",
    unlockKey: "control_panel.era_unlock_enlightened",
  },
  [Age.Industrial]: {
    taglineKey: "control_panel.era_tagline_industrial",
    focusKey: "control_panel.era_focus_industrial",
    unlockKey: "control_panel.era_unlock_industrial",
  },
  [Age.Modern]: {
    taglineKey: "control_panel.era_tagline_modern",
    focusKey: "control_panel.era_focus_modern",
    unlockKey: "control_panel.era_unlock_modern",
  },
  [Age.Alien]: {
    taglineKey: "control_panel.era_tagline_alien",
    focusKey: "control_panel.era_focus_alien",
    unlockKey: "control_panel.era_unlock_alien",
  },
};

type ObjectivePlayer = Player | PlayerView;
type ObjectiveUnit = Unit | UnitView;

const TICKS_PER_SECOND = 10;

// Where my era sits against the rest of the table.
//
// The era ladder's length is deliberately never shown, so "how far along am I"
// can only be answered relative to other players. `ahead` is how many living
// rivals are in a later era than me; rank 1 means nobody is.
export interface EraStanding {
  ahead: number;
  rank: number;
  peers: number;
}

export function computeEraStanding(
  me: ObjectivePlayer,
  everyone: readonly ObjectivePlayer[],
): EraStanding | null {
  const myAge = me.age();
  let ahead = 0;
  let peers = 0;
  for (const p of everyone) {
    if (p === me || !p.isAlive()) continue;
    peers++;
    if (p.age() > myAge) ahead++;
  }
  // A standing against nobody is noise, not information.
  if (peers === 0) return null;
  return { ahead, rank: ahead + 1, peers };
}

export function countBuiltUnits(
  player: ObjectivePlayer,
  type: UnitType,
): number {
  return player
    .units(type)
    .filter((unit: ObjectiveUnit) => !unit.isUnderConstruction()).length;
}

export function computeAgeGates(
  player: ObjectivePlayer,
  config: Config,
): AgeGate[] {
  const cost = config.advanceAgeCost(player);
  if (cost === null || player.age() >= Age.Alien) {
    return [];
  }

  const gates: AgeGate[] = [];
  const gold = player.gold();

  if (player.age() === Age.Primitive) {
    const cities = countBuiltUnits(player, UnitType.City);
    const neededCities = config.citiesToAdvance();
    gates.push({
      id: "city",
      labelKey: "control_panel.gate_city",
      current: cities,
      target: neededCities,
      kind: "number",
      complete: cities >= neededCities,
    });
    gates.push({
      id: "gold",
      labelKey: "control_panel.gate_gold",
      current: gold,
      target: cost.gold,
      kind: "gold",
      complete: gold >= cost.gold,
    });
    return gates;
  }

  const keystone = config.advanceKeystone(player.age());
  if (keystone !== null) {
    const count = countBuiltUnits(player, keystone);
    gates.push({
      id: "keystone",
      labelKey: "control_panel.gate_keystone",
      labelValue: keystone,
      current: count,
      target: 1,
      kind: "number",
      complete: count >= 1,
    });
  }

  const effectiveTech = Math.ceil(
    cost.techPoints * (1 - player.ageAdvanceCredit()),
  );
  gates.push({
    id: "tech",
    labelKey: "control_panel.gate_tech",
    current: Math.floor(player.techPoints()),
    target: effectiveTech,
    kind: "number",
    complete: player.techPoints() >= effectiveTech,
  });
  gates.push({
    id: "gold",
    labelKey: "control_panel.gate_gold",
    current: gold,
    target: cost.gold,
    kind: "gold",
    complete: gold >= cost.gold,
  });

  return gates;
}

export function canAdvanceFromGates(gates: readonly AgeGate[]): boolean {
  return gates.length > 0 && gates.every((gate) => gate.complete);
}

export function computeEraTriumphs(
  player: ObjectivePlayer,
  config: Config,
): EraTriumphStatus[] {
  if (player.age() >= Age.Alien) return [];
  const base = config.baseAdvanceAgeCost(player.age());
  if (base === null) return [];

  const mask = player.eraTriumphMask();
  const techTarget = Math.ceil(
    base.techPoints *
      (1 - player.ageAdvanceCredit()) *
      config.eraIngenuityTargetMult(),
  );
  const capacity = Math.max(1, config.overextensionCapacity(player));
  const stableRealm =
    player.integrationDebt() / capacity <= config.eraDominionMaxDebtRatio();

  return [
    {
      id: "ingenuity",
      labelKey: "control_panel.triumph_ingenuity",
      detailKey: "control_panel.triumph_ingenuity_detail",
      current: Math.floor(player.techPoints()),
      target: techTarget,
      kind: "number",
      complete: (mask & EraTriumph.Ingenuity) !== 0,
    },
    {
      id: "prosperity",
      labelKey: "control_panel.triumph_prosperity",
      detailKey: "control_panel.triumph_prosperity_detail",
      current: player.gold(),
      target: config.eraProsperityTarget(player.age()),
      kind: "gold",
      complete: (mask & EraTriumph.Prosperity) !== 0,
    },
    {
      id: "dominion",
      labelKey: "control_panel.triumph_dominion",
      detailKey: "control_panel.triumph_dominion_detail",
      current: player.numTilesOwned(),
      target: config.eraDominionTarget(player.age()),
      kind: "number",
      complete: (mask & EraTriumph.Dominion) !== 0,
      blocked: !stableRealm,
    },
    {
      id: "legacy",
      labelKey: "control_panel.triumph_legacy",
      detailKey: "control_panel.triumph_legacy_detail",
      current: Math.floor(player.eraRenownEarned()),
      target: config.eraLegacyTarget(player.age()),
      kind: "number",
      complete: (mask & EraTriumph.Legacy) !== 0,
    },
  ];
}

export function computePrimitiveGoldPipeline(
  player: ObjectivePlayer,
  config: Config,
): PrimitiveGoldPipeline {
  const resources = player.resources();
  let resourceSpend = 0;
  if (resources > 0) {
    resourceSpend = Math.floor(resources * config.internalEconomyFraction());
    if (resourceSpend < config.internalEconomyMinPerTick()) {
      resourceSpend = Math.min(resources, config.internalEconomyMinPerTick());
    }
    resourceSpend = Math.min(resourceSpend, config.internalEconomyMaxPerTick());
  }

  // AI-NOTE: floor at source — resourceSpend can be a fractional pool remainder
  // (player.resources() is a float pile), so without this the no-outpost path
  // reaches BigInt(resourceGoldPerTick * TICKS_PER_SECOND) below with a
  // non-integer and the HUD render throws RangeError. Mirrors
  // PlayerExecution.convertResourcesToGold. | evidence:
  // tests/client/graphics/layers/ObjectiveRail.test.ts (fractional-pile
  // cases) | expires: when the resource pile is integer-only
  let resourceGoldPerTick = Math.floor(
    resourceSpend * config.resourceGoldValue(),
  );
  const outposts = Math.min(
    countBuiltUnits(player, UnitType.TradeOutpost),
    config.tradeOutpostMaxCount(),
  );
  if (outposts > 0 && resourceGoldPerTick > 0) {
    const bonusPct = outposts * config.tradeOutpostConversionBonusPct();
    resourceGoldPerTick = Math.floor(
      (resourceGoldPerTick * (100 + bonusPct)) / 100,
    );
  }

  const farmGoldPerTick =
    BigInt(countBuiltUnits(player, UnitType.PrimitiveFarm)) *
    config.primitiveFarmGoldPerTick();

  const resourceGoldPerSecond = BigInt(resourceGoldPerTick * TICKS_PER_SECOND);
  const farmGoldPerSecond = farmGoldPerTick * BigInt(TICKS_PER_SECOND);

  return {
    resourceGoldPerSecond,
    farmGoldPerSecond,
    totalGoldPerSecond: resourceGoldPerSecond + farmGoldPerSecond,
    resourceSpendPerSecond: resourceSpend * TICKS_PER_SECOND,
  };
}

/** What a Hut costs right now (the ice age inflates it early on). */
export function hutCostNow(config: Config, ticks: number): number {
  const ice = config.climateIceFractionAtTick(ticks);
  return Math.floor(config.hutCost() * (1 + 0.5 * ice));
}

/**
 * What the next Permanent Settlement costs right now: 20 huts, doubling per
 * City already built, capped, and inflated by the ice age. Mirrors
 * Config.unitInfo(City).cost without needing a Game handle.
 */
export function settlementCostNow(
  config: Config,
  player: ObjectivePlayer,
  ticks: number,
): number {
  const cities = countBuiltUnits(player, UnitType.City);
  const base = Math.min(1_000_000, Math.pow(2, cities) * 20 * config.hutCost());
  const ice = config.climateIceFractionAtTick(ticks);
  return Math.floor(base * (1 + ice));
}

function goldProgress(player: ObjectivePlayer, cost: number): number {
  if (cost <= 0) return 1;
  return Math.max(0, Math.min(1, Number(player.gold()) / cost));
}

/**
 * Ticks left before the ice lets a Permanent Settlement be built (0 = now).
 * Mirrors BuildMenu's "The ice must recede first" reason.
 */
export function settlementIceWaitTicks(config: Config, ticks: number): number {
  const meltTick = Math.ceil(
    config.climateMeltTicks() * (1 - config.settlementMaxIceFraction()),
  );
  return Math.max(0, meltTick - ticks);
}

/**
 * The Stone Age goal ladder, in order. The goal panel walks DOWN this list
 * and never back up it: a dry stand, a Hut that wore away or gold spent on
 * something else changes the advice inside a step, never the step itself
 * (real-screen audit 2026-10-22: "Build a Hut" -> "Claim the wood stand" ->
 * "Build a Hut" again within eight minutes, with a Hut standing).
 */
export const PRIMITIVE_LADDER: readonly ObjectiveID[] = [
  "find_resources",
  "convert_resources",
  "build_economy",
  "found_city",
  "save_advance_toll",
];

/** Furthest Stone Age step this tribe has reached. Owned by the caller. */
export interface ObjectiveMemory {
  stage: number;
}

export interface ObjectiveContext {
  /** Kept across ticks so the ladder only moves forward. */
  memory?: ObjectiveMemory;
  /**
   * Whether a usable wood stand is in sight near the tribe. `null` (or left
   * out) = not scanned; the panel then assumes there is one, which is what
   * the spawn guarantee gives every new tribe.
   */
  woodInSight?: boolean | null;
}

export function chooseObjective(
  player: ObjectivePlayer,
  config: Config,
  gates: readonly AgeGate[] = computeAgeGates(player, config),
  pipeline: PrimitiveGoldPipeline = computePrimitiveGoldPipeline(
    player,
    config,
  ),
  ticks: number = 0,
  context: ObjectiveContext = {},
): ObjectiveRailItem {
  const completeGates = gates.filter((gate) => gate.complete).length;
  const gateProgress =
    gates.length === 0 ? 1 : Math.min(1, completeGates / gates.length);

  if (player.age() >= Age.Alien) {
    return objective("final_age", 1);
  }

  if (canAdvanceFromGates(gates)) {
    return objective("advance_age", 1);
  }

  if (player.age() !== Age.Primitive) {
    const firstOpenGate = gates.find((gate) => !gate.complete);
    if (firstOpenGate?.id === "keystone") {
      return objective("build_keystone", gateProgress);
    }
    if (firstOpenGate?.id === "tech") {
      return objective("generate_tech", gateProgress);
    }
    if (firstOpenGate?.id === "gold") {
      return objective("build_economy", gateProgress);
    }
    return objective("expand_defend", gateProgress);
  }

  const cityGate = gates.find((gate) => gate.id === "city");
  const goldGate = gates.find((gate) => gate.id === "gold");
  const stockpile = player.resources();
  const flowing = pipeline.totalGoldPerSecond > 0n || stockpile > 0;
  // Any standing economy building means the Hut step is behind us. (The Hut
  // is the step's own building: without it the panel stayed on "Build a
  // Hut" at 100% after the Hut was up, real-screen playtest 2026-10-22.)
  const economyBuildings =
    countBuiltUnits(player, UnitType.Hut) +
    countBuiltUnits(player, UnitType.PrimitiveFarm) +
    countBuiltUnits(player, UnitType.TradeOutpost);
  const hutCost = hutCostNow(config, ticks);
  const gold = Number(player.gold());

  let reached: number;
  if (cityGate?.complete) {
    reached = 4;
  } else if (economyBuildings > 0) {
    reached = 3;
  } else if (gold >= hutCost) {
    // Affordable Hut first: a stand that ran dry leaves the pile at zero, and
    // telling a tribe that holds a Hut's worth of gold to go walk again (seen
    // on a real screen 2026-10-21) wastes the one thing it has earned.
    reached = 2;
  } else if (flowing) {
    reached = 1;
  } else {
    reached = 0;
  }
  let stage = Math.max(reached, context.memory?.stage ?? 0);
  if (context.memory !== undefined) context.memory.stage = stage;
  // A lost settlement is the one honest way back: the toll step needs one.
  if (stage === 4 && !cityGate?.complete) stage = 3;

  const woodInSight = context.woodInSight ?? true;
  // When the gold has stopped, the next action is always the same: get wood
  // again, from the marked stand or, with none in sight, by pushing out.
  const dryHint = woodInSight
    ? "control_panel.objective_hint_dry_wood"
    : "control_panel.objective_hint_dry_explore";

  switch (stage) {
    case 4:
      return objective(
        goldGate?.complete ? "advance_age" : "save_advance_toll",
        gateProgress,
      );
    case 3: {
      const cost = settlementCostNow(config, player, ticks);
      if (gold >= cost) {
        const wait = settlementIceWaitTicks(config, ticks);
        return objective("found_city", 0.9, {
          detailKey:
            wait > 0
              ? "control_panel.objective_found_city_ice_detail"
              : "control_panel.objective_found_city_ready_detail",
          detailParams:
            wait > 0 ? { seconds: String(Math.ceil(wait / 10)) } : undefined,
        });
      }
      // Never a full bar for a step that is not done.
      const progress = Math.min(0.9, goldProgress(player, cost));
      // The Hut wore away (they are temporary) and its land is slipping back
      // to the wild: rebuilding it is the one thing to do while saving.
      if (countBuiltUnits(player, UnitType.Hut) === 0 && gold >= hutCost) {
        return objective("found_city", progress, {
          detailKey: "control_panel.objective_hint_rebuild_hut",
        });
      }
      if (!flowing) {
        return objective("found_city", progress, {
          detailKey: dryHint,
          pointToWood: woodInSight,
        });
      }
      return objective("found_city", progress);
    }
    case 2:
      if (gold >= hutCost) {
        // The gold is there but the Hut is not: 80%, never a full bar for a
        // step that is not done (audit 2026-10-22: "Build a Hut 100%" for
        // minutes with no Hut read as broken).
        return objective("build_economy", 0.8);
      }
      // Reached the Hut's price once, then spent or lost part of it.
      return objective("build_economy", 0.8 * goldProgress(player, hutCost), {
        detailKey: flowing
          ? "control_panel.objective_build_economy_saving_detail"
          : dryHint,
        pointToWood: !flowing && woodInSight,
      });
    case 1:
      return objective("convert_resources", goldProgress(player, hutCost), {
        detailKey: flowing ? undefined : dryHint,
        pointToWood: woodInSight,
      });
    default:
      if (!woodInSight) {
        return objective("find_resources", 0, {
          titleKey: "control_panel.objective_explore",
          detailKey: "control_panel.objective_explore_detail",
        });
      }
      return objective("find_resources", 0, { pointToWood: true });
  }
}

/** Index of a Stone Age goal on the ladder, -1 for later-age goals. */
export function primitiveStageOf(id: ObjectiveID): number {
  if (id === "advance_age") return PRIMITIVE_LADDER.length;
  return PRIMITIVE_LADDER.indexOf(id);
}

function objective(
  id: ObjectiveID,
  progress: number,
  extra: {
    titleKey?: string;
    detailKey?: string;
    detailParams?: Record<string, string>;
    pointToWood?: boolean;
  } = {},
): ObjectiveRailItem {
  const standard = {
    titleKey: `control_panel.objective_${id}`,
    detailKey: `control_panel.objective_${id}_detail`,
  };
  return {
    id,
    titleKey: extra.titleKey ?? standard.titleKey,
    detailKey: extra.detailKey ?? standard.detailKey,
    detailParams: extra.detailParams,
    pointToWood: extra.pointToWood ?? false,
    progress: Math.max(0, Math.min(1, progress)),
  };
}
