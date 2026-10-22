import { ResourceKind } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { GameView, PlayerView } from "../../view";

/** How far (tiles) from the tribe's centre a stand is still worth pointing at. */
export const WOOD_SEARCH_RADIUS = 70;
/** A node this depleted is a stump, not a stand. */
const MIN_USEFUL_WOOD = 4;

export interface WorldPoint {
  x: number;
  y: number;
}

export interface WoodTarget extends WorldPoint {
  tile: TileRef;
  dist: number;
}

/**
 * Pure: pick the nearest visible, un-owned, still-rich wood node around an
 * anchor. Shared by the goal panel (is there a stand to send the player to at
 * all?) and the on-map marker (where is it?), so the two can never disagree.
 */
export function nearestWoodStand(
  game: Pick<
    GameView,
    | "width"
    | "height"
    | "ref"
    | "resourceAt"
    | "isResourceVisible"
    | "ownerID"
    | "isValidCoord"
  >,
  anchor: WorldPoint,
  mySmallID: number,
  radius: number = WOOD_SEARCH_RADIUS,
): WoodTarget | null {
  const ax = Math.round(anchor.x);
  const ay = Math.round(anchor.y);
  let best: WoodTarget | null = null;
  const x0 = Math.max(0, ax - radius);
  const x1 = Math.min(game.width() - 1, ax + radius);
  const y0 = Math.max(0, ay - radius);
  const y1 = Math.min(game.height() - 1, ay + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const tile = game.ref(x, y);
      const node = game.resourceAt(tile);
      if (node.kind !== ResourceKind.Wood || node.quantity < MIN_USEFUL_WOOD) {
        continue;
      }
      if (game.ownerID(tile) === mySmallID) continue;
      if (!game.isResourceVisible(tile)) continue;
      const dist = Math.hypot(x - ax, y - ay);
      if (best === null || dist < best.dist) {
        best = { tile, x, y, dist };
      }
    }
  }
  return best;
}

/** Where the tribe "is": its name label, else its spawn tile. */
export function tribeAnchor(game: GameView, me: PlayerView): WorldPoint | null {
  const name = me.nameLocation();
  if (name !== undefined && name.size > 0) {
    return { x: name.x, y: name.y };
  }
  const spawn = me.spawnTile();
  if (spawn === undefined) return null;
  return { x: game.x(spawn), y: game.y(spawn) };
}
