import { Game, PlayerType, ResourceKind } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";

// A tribe that spawns with no wood in walking distance has nothing to do: the
// whole Primitive loop (walk onto a stand, gather wood, mint gold, build a hut,
// settle, advance) starts with a stand. Measured on the World map before this
// existed: 83 stands for 650,000 land tiles, median 56 tiles to the nearest
// one, and a real-screen playthrough that gathered nothing in ten minutes.
//
// So every HUMAN spawn is guaranteed a small stand nearby. Deterministic: the
// caller hands in the spawn's own PseudoRandom (seeded from gameID + playerID),
// so every lockstep peer places the identical nodes. Bots never get one (they
// roam toward whatever the seeded map holds).

/** Existing stands this close to the spawn make a starter stand redundant. */
export const STARTER_STAND_SEARCH_RADIUS = 18;
/**
 * The stand is placed this far from the spawn centre: just outside the
 * radius-9 starting blob (so the tribe has to take one short walk) and well
 * inside the 26-tile Primitive sight bubble (so it is on screen from the start).
 */
export const STARTER_STAND_MIN_DIST = 12;
export const STARTER_STAND_MAX_DIST = 15;
/** Nodes in the stand; each is a full, fresh wood node. */
export const STARTER_STAND_NODES = 4;
const STARTER_NODE_MIN_QTY = 30;
const STARTER_NODE_MAX_QTY = 39;
/** Ground this iced-over is impassable for a fresh tribe; never place on it. */
const MAX_ICE = 0.5;

const NODE_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [2, 1],
  [-2, 2],
  [1, -2],
  [-1, -3],
  [3, -1],
  [-3, 0],
  [0, 3],
  [3, 3],
  [-3, -2],
  [2, -4],
  [-4, 1],
];

export function woodNodesWithin(
  mg: Game,
  center: TileRef,
  radius: number,
): number {
  const cx = mg.x(center);
  const cy = mg.y(center);
  let count = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radius * radius) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (!mg.isValidCoord(x, y)) continue;
      const tile = mg.ref(x, y);
      const node = mg.resourceAt(tile);
      if (node.kind === ResourceKind.Wood && node.quantity > 0) count++;
    }
  }
  return count;
}

function placeableWood(
  mg: Game,
  x: number,
  y: number,
  ticks: number,
  maxIce: number,
): boolean {
  if (!mg.isValidCoord(x, y)) return false;
  const tile = mg.ref(x, y);
  if (!mg.isLand(tile) || mg.hasOwner(tile)) return false;
  if (mg.resourceAt(tile).kind !== ResourceKind.None) return false;
  const ice = mg.config().climateTileIceFractionAtTick(mg, tile, ticks);
  return ice <= maxIce;
}

/**
 * Guarantee a wood stand within one short walk of `center`. Returns the tiles
 * that received a node (empty when a stand already exists or nothing fits).
 */
export function ensureStarterStand(
  mg: Game,
  center: TileRef,
  random: PseudoRandom,
  ticks: number,
): TileRef[] {
  if (woodNodesWithin(mg, center, STARTER_STAND_SEARCH_RADIUS) >= 2) {
    return [];
  }
  const cx = mg.x(center);
  const cy = mg.y(center);
  // Eight compass directions in a seeded order, each tried at a seeded
  // distance; the first direction with enough room takes the stand.
  const dirs: Array<[number, number]> = [
    [1, 0],
    [0.7071, 0.7071],
    [0, 1],
    [-0.7071, 0.7071],
    [-1, 0],
    [-0.7071, -0.7071],
    [0, -1],
    [0.7071, -0.7071],
  ];
  for (let i = dirs.length - 1; i > 0; i--) {
    const j = random.nextInt(0, i);
    [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
  }
  const dist = random.nextInt(STARTER_STAND_MIN_DIST, STARTER_STAND_MAX_DIST);
  // Prefer thawed ground; a tribe that spawned inside the ice sheet still gets
  // its stand rather than nothing (the second pass accepts any ice).
  for (const maxIce of [MAX_ICE, 1]) {
    for (const [dx, dy] of dirs) {
      const sx = Math.round(cx + dx * dist);
      const sy = Math.round(cy + dy * dist);
      const spots: TileRef[] = [];
      for (const [ox, oy] of NODE_OFFSETS) {
        if (spots.length >= STARTER_STAND_NODES) break;
        if (placeableWood(mg, sx + ox, sy + oy, ticks, maxIce)) {
          spots.push(mg.ref(sx + ox, sy + oy));
        }
      }
      if (spots.length < STARTER_STAND_NODES) continue;
      for (const tile of spots) {
        mg.setResource(
          tile,
          ResourceKind.Wood,
          random.nextInt(STARTER_NODE_MIN_QTY, STARTER_NODE_MAX_QTY),
        );
      }
      return spots;
    }
  }
  return [];
}

export function wantsStarterStand(mg: Game, playerType: PlayerType): boolean {
  return playerType === PlayerType.Human && mg.config().primitiveStarterStand();
}
