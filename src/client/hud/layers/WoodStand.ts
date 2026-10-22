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

type WoodScanGame = Pick<
  GameView,
  | "width"
  | "height"
  | "ref"
  | "resourceAt"
  | "isResourceVisible"
  | "ownerID"
  | "isValidCoord"
  | "isLand"
>;

/** Extra margin around the search box the reach flood may walk through. */
const REACH_MARGIN = 30;

/**
 * Pure: which tiles in the box a land advance from my border can reach. An
 * advance into the wild takes unowned land touching my border, again and
 * again (AttackExecution), so the reachable set is the unowned land
 * 4-connected to my territory. A rival's tile counts when it borders that
 * set or my land (it can be attacked). Water, and wild land cut off by water
 * or other tribes, cannot be reached: the goal marker must never point there
 * (playtest 2026-10-22: a stand across a strait, ten minutes, no progress).
 */
export function landReach(
  game: Pick<WoodScanGame, "width" | "height" | "ref" | "ownerID" | "isLand">,
  mySmallID: number,
  box: { x0: number; y0: number; x1: number; y1: number },
): (x: number, y: number) => boolean {
  const w = box.x1 - box.x0 + 1;
  const h = box.y1 - box.y0 + 1;
  // 0 = unknown, 1 = mine, 2 = reachable wild, 3 = other.
  const mark = new Uint8Array(w * h);
  const queue: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tile = game.ref(box.x0 + x, box.y0 + y);
      const owner = game.ownerID(tile);
      if (owner === mySmallID) {
        mark[y * w + x] = 1;
        queue.push(y * w + x);
      } else if (owner !== 0 || !game.isLand(tile)) {
        mark[y * w + x] = 3;
      }
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    const x = i % w;
    const y = (i - x) / w;
    const next = [
      x > 0 ? i - 1 : -1,
      x < w - 1 ? i + 1 : -1,
      y > 0 ? i - w : -1,
      y < h - 1 ? i + w : -1,
    ];
    for (const n of next) {
      if (n < 0 || mark[n] !== 0) continue;
      mark[n] = 2;
      queue.push(n);
    }
  }
  return (x: number, y: number) => {
    const lx = x - box.x0;
    const ly = y - box.y0;
    if (lx < 0 || ly < 0 || lx >= w || ly >= h) return false;
    const i = ly * w + lx;
    if (mark[i] === 1 || mark[i] === 2) return true;
    // A rival's tile: reachable when it touches my land or reachable wild.
    const tile = game.ref(x, y);
    if (game.ownerID(tile) === 0 || !game.isLand(tile)) return false;
    const touches = (j: number) => mark[j] === 1 || mark[j] === 2;
    return (
      (lx > 0 && touches(i - 1)) ||
      (lx < w - 1 && touches(i + 1)) ||
      (ly > 0 && touches(i - w)) ||
      (ly < h - 1 && touches(i + w))
    );
  };
}

/**
 * Pure: pick the nearest visible, un-owned, still-rich wood node around an
 * anchor that a land advance can actually reach. Shared by the goal panel
 * (is there a stand to send the player to at all?) and the on-map marker
 * (where is it?), so the two can never disagree.
 */
export function nearestWoodStand(
  game: WoodScanGame,
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
  let reach: ((x: number, y: number) => boolean) | null = null;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const tile = game.ref(x, y);
      const node = game.resourceAt(tile);
      if (node.kind !== ResourceKind.Wood || node.quantity < MIN_USEFUL_WOOD) {
        continue;
      }
      if (game.ownerID(tile) === mySmallID) continue;
      if (!game.isResourceVisible(tile)) continue;
      // The flood is only worth building once a candidate turns up.
      reach ??= landReach(game, mySmallID, {
        x0: Math.max(0, x0 - REACH_MARGIN),
        y0: Math.max(0, y0 - REACH_MARGIN),
        x1: Math.min(game.width() - 1, x1 + REACH_MARGIN),
        y1: Math.min(game.height() - 1, y1 + REACH_MARGIN),
      });
      if (!reach(x, y)) continue;
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
