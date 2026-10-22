import { GameEvent } from "../../../core/EventBus";
import {
  Age,
  BuildableUnit,
  PlayerBuildableUnitType,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { renderNumber, translateText } from "../../Utils";
import { GameView } from "../../view";

/** A build order left the client: show it on the map at once. */
export class BuildPlacedEvent implements GameEvent {
  constructor(
    public readonly unitType: PlayerBuildableUnitType,
    public readonly tile: TileRef,
    /** A standing Hut was renewed rather than a new one placed. */
    public readonly renewed: boolean = false,
  ) {}
}

/** A build click was refused on this client: say why, where it happened. */
export class BuildRefusedEvent implements GameEvent {
  constructor(
    public readonly unitType: PlayerBuildableUnitType,
    public readonly tile: TileRef,
    public readonly reason: string,
  ) {}
}

/**
 * What the build ghost under the cursor would do, said next to the cursor
 * while hovering (not only after a click: playtest 2026-10-22, a red ring on
 * the wild with no word of why). null = nothing to say (a valid spot).
 */
export class BuildHoverEvent implements GameEvent {
  constructor(
    public readonly label: string | null,
    public readonly ok: boolean,
  ) {}
}

/** Pure: the hover label for a ghost's current buildable answer. */
export function buildHoverLabel(
  game: GameView,
  buildable: Pick<BuildableUnit, "type" | "cost" | "canBuild" | "canUpgrade">,
  tile: TileRef | null,
): { label: string; ok: boolean } | null {
  if (tile === null) return null;
  if (buildable.type === UnitType.Hut && buildable.canUpgrade !== false) {
    return {
      label: translateText("build_menu.renew_hut", {
        cost: renderNumber(buildable.cost),
      }),
      ok: true,
    };
  }
  if (buildable.canBuild !== false || buildable.canUpgrade !== false) {
    return null;
  }
  return { label: buildRefusalReason(game, buildable, tile), ok: false };
}

/**
 * Why a structure cannot go on this tile, in the player's words. Shared by
 * the build menu (greyed buttons) and the build bar's click-to-place path,
 * which used to drop a refused click without a word (audit 2026-10-22:
 * "press 2 + click land, nothing happens").
 */
export function buildRefusalReason(
  game: GameView,
  buildable: Pick<BuildableUnit, "type" | "cost">,
  tile: TileRef | null,
): string {
  const player = game.myPlayer();
  if (!player) return translateText("build_menu.reason_place");
  const cfg = game.config();
  if (buildable.type === UnitType.City && player.age() === Age.Primitive) {
    const meltTick = Math.ceil(
      cfg.climateMeltTicks() * (1 - cfg.settlementMaxIceFraction()),
    );
    const left = meltTick - game.ticks();
    if (left > 0) {
      return translateText("build_menu.reason_ice", {
        seconds: String(Math.ceil(left / 10)),
      });
    }
  }
  const gold = player.gold();
  if (buildable.cost > gold) {
    return translateText("build_menu.reason_gold", {
      gold: renderNumber(buildable.cost - gold),
    });
  }
  if (tile !== null && game.ownerID(tile) !== player.smallID()) {
    return translateText("build_menu.reason_own_land");
  }
  if (buildable.type === UnitType.Hut && tile !== null) {
    const minDist = cfg.hutMinSpacing();
    const tooClose = player
      .units(UnitType.Hut)
      .some(
        (hut) =>
          game.euclideanDistSquared(hut.tile(), tile) < minDist * minDist,
      );
    if (tooClose) return translateText("build_menu.reason_hut_spacing");
  }
  if (
    buildable.type === UnitType.TradeOutpost &&
    player.units(UnitType.TradeOutpost).length >= cfg.tradeOutpostMaxCount()
  ) {
    return translateText("build_menu.reason_outpost_cap", {
      n: String(cfg.tradeOutpostMaxCount()),
    });
  }
  return translateText("build_menu.reason_place");
}

/**
 * The number keys are bound to the later-age build slots (1 City, 2 Factory,
 * 3 Port, 4 Defense Post, 5 Silo), but in the Stone Age the build bar shows
 * 1 Settlement, 2 Hut, 3 Trade post, 4 Lookout, 5 Farm, and the goal panel
 * says "press 2" for a Hut. Pressing 2 raised a Factory ghost that could
 * never be placed, so the click did nothing (audit 2026-10-22). A slot whose
 * key-bound unit is out of era resolves to the unit the bar shows in that
 * slot for the player's age.
 */
const SLOT_EQUIVALENTS: Partial<Record<UnitType, PlayerBuildableUnitType>> = {
  [UnitType.Factory]: UnitType.Hut,
  [UnitType.Port]: UnitType.TradeOutpost,
  [UnitType.DefensePost]: UnitType.ScoutLookout,
  [UnitType.MissileSilo]: UnitType.PrimitiveFarm,
};

function inEra(game: GameView, type: UnitType, age: Age): boolean {
  const info = game.unitInfo(type);
  if (info.minAge !== undefined && age < info.minAge) return false;
  if (info.maxAge !== undefined && age > info.maxAge) return false;
  return true;
}

export function eraHotkeyTarget(
  game: GameView,
  type: PlayerBuildableUnitType,
): PlayerBuildableUnitType {
  const player = game.myPlayer();
  if (!player) return type;
  const age = player.age();
  if (inEra(game, type, age)) return type;
  const slot = SLOT_EQUIVALENTS[type];
  if (slot !== undefined && inEra(game, slot, age)) return slot;
  return type;
}
