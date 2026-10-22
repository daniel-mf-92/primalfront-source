import { Config } from "../../../core/configuration/Config";
import { GameEvent } from "../../../core/EventBus";
import { Game } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { PlayerView } from "../../view";

// A land click is the game's main verb: it sends troops toward that tile. It
// used to answer only when it worked, and even then with a marker that could
// sit for minutes on a tile the tribe never reached (real-screen playtest
// 2026-10-22: "Claiming here" on a wood stand across the water, troops full,
// ten minutes). Every land click now gets an answer where it landed: the
// advance starts (and its marker lives exactly as long as the attack), or the
// reason it cannot.

export type LandClickRefusal =
  | "allied"
  | "peace"
  | "no_border"
  | "unreachable"
  | "no_troops"
  | "land_cap";

export type LandClickVerdict =
  | { kind: "ignore" }
  | {
      kind: "advance";
      /** Rival's name, or null for the wild. */
      target: string | null;
      /** Troops go by boat (no land path, but a shore launch). */
      boat: boolean;
      /** An advance on the same target is already out: this joins it. */
      reinforce: boolean;
    }
  | { kind: "refuse"; reason: LandClickRefusal; target: string | null };

export interface LandClickFacts {
  isLand: boolean;
  ownedByMe: boolean;
  /** Owner's display name when a tribe holds the tile, else null (wild). */
  targetName: string | null;
  /** Ally or teammate. */
  friendly: boolean;
  /** The sim's own answer (PlayerImpl.canAttack). */
  canAttack: boolean;
  /** Shares a border with the owning tribe (rivals only). */
  sharedBorder: boolean;
  canBoat: boolean;
  /** Troops the click would send. */
  attackTroops: number;
  /** Wild land only: the band already holds all the land it can feed. */
  atLandCap: boolean;
  alreadyAdvancing: boolean;
}

/** Pure: what a land click does, or why it does nothing. */
export function landClickVerdict(f: LandClickFacts): LandClickVerdict {
  if (!f.isLand || f.ownedByMe) return { kind: "ignore" };
  const target = f.targetName;
  const refuse = (reason: LandClickRefusal): LandClickVerdict => ({
    kind: "refuse",
    reason,
    target,
  });
  if (target !== null && f.friendly) return refuse("allied");
  if (f.attackTroops < 1) return refuse("no_troops");
  if (!f.canAttack) {
    if (f.canBoat) {
      return { kind: "advance", target, boat: true, reinforce: false };
    }
    if (target !== null) {
      // Bordering but still refused: immunity or a coalition pact.
      return refuse(f.sharedBorder ? "peace" : "no_border");
    }
    return refuse("unreachable");
  }
  if (target === null && f.atLandCap) return refuse("land_cap");
  return {
    kind: "advance",
    target,
    boat: false,
    reinforce: f.alreadyAdvancing,
  };
}

/** Translation key + params for a verdict's on-map label. */
export function landClickLabel(v: LandClickVerdict): {
  key: string;
  params: Record<string, string>;
} | null {
  if (v.kind === "ignore") return null;
  const name = v.target ?? "";
  if (v.kind === "refuse") {
    return { key: `land_click.refuse_${v.reason}`, params: { name } };
  }
  if (v.boat) return { key: "land_click.boat", params: { name } };
  if (v.reinforce) return { key: "land_click.reinforce", params: { name } };
  return v.target === null
    ? { key: "land_click.wild", params: {} }
    : { key: "land_click.rival", params: { name } };
}

/** A land click was answered: GuideBeacon shows it where it landed. */
export class LandClickFeedbackEvent implements GameEvent {
  constructor(
    public readonly tile: TileRef,
    public readonly verdict: LandClickVerdict,
    /** smallID of the attacked owner (0 = wild), for tracking the advance. */
    public readonly targetSmallID: number,
  ) {}
}

/**
 * Pure mirror of AttackExecution's nomadic attrition check: a roaming-age
 * tribe whose land is at nomadOvershootMult x its carrying capacity gets its
 * troops sent straight home from any push into the wild. `troopsAfter` is
 * what the tribe keeps once the attack leaves (capacity grows with troops).
 */
export function atWildLandCap(
  config: Config,
  player: PlayerView,
  ticks: number,
  troopsAfter: number = player.troops(),
): boolean {
  const age = player.age();
  if (!config.rewildEnabled(age)) return false;
  // carryingCapacityTiles reads troops(): ask it about the tribe as it will
  // be once the attack has left.
  const after = Object.create(player) as PlayerView;
  after.troops = () => troopsAfter;
  const clock = { ticks: () => ticks } as unknown as Game;
  const cap =
    config.carryingCapacityTiles(after) *
    config.landCapacityMult(age) *
    config.climateLandScale(clock);
  return player.numTilesOwned() >= cap * config.nomadOvershootMult();
}
