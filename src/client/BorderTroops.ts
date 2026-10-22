// Border troops (Marta 2026-10-22): "troops at the borders as we move which do
// battle when two territories interact ... era appropriate: Stone Age a small
// number of scouts, and as eras progress troops change and increase in
// proportion to the size of the territory".
//
// Presentation only. The simulation still pools troops per player (OpenFront's
// model); this picks where to draw them. Pure and deterministic for a given map
// state so it is cheap to test and never flickers between refreshes: guards
// sit on border tiles chosen by a fixed per-cell hash, the number per player
// follows its territory size and age, and wherever two owners touch while one
// is attacking the other a clash is drawn instead of a guard.

export interface BorderTroopMap {
  width(): number;
  height(): number;
  ownerID(tile: number): number;
  isLand(tile: number): boolean;
}

export interface BorderTroopPlayer {
  smallID: number;
  age: number;
  tiles: number;
  color: [number, number, number];
  /** smallIDs of players this one is currently attacking. */
  attacking: ReadonlySet<number>;
}

export interface BorderTroop {
  x: number;
  y: number;
  /** 0 = guard, 1 = clash. */
  kind: number;
  age: number;
  color: [number, number, number];
  /** +1 faces right, -1 faces left (toward the outside of the territory). */
  facing: number;
}

/** Grid cell size in tiles: at most one figure per cell keeps them apart. */
export const TROOP_CELL = 7;

/**
 * Tiles of territory per drawn figure, by age. Stone Age bands field a handful
 * of scouts; armies thicken with every age. Index = Age value.
 */
export const TILES_PER_TROOP = [110, 80, 60, 45, 36, 30, 26, 24];

/** Hard cap per player so a continental empire stays readable. */
export const MAX_TROOPS_PER_PLAYER = [5, 10, 18, 26, 34, 42, 50, 56];

export function troopsForPlayer(age: number, tiles: number): number {
  const a = Math.max(0, Math.min(TILES_PER_TROOP.length - 1, age | 0));
  if (tiles <= 0) return 0;
  return Math.max(
    1,
    Math.min(MAX_TROOPS_PER_PLAYER[a], Math.round(tiles / TILES_PER_TROOP[a])),
  );
}

function cellHash(cx: number, cy: number): number {
  let h = (cx * 374761393 + cy * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * One scan of the map: per cell, the first border tile met along the cell's
 * diagonals (fixed order) becomes that cell's candidate. Candidates are then
 * ranked per player by the cell hash and the first troopsForPlayer() of them
 * are kept; clash candidates (border with someone being attacked) are kept
 * first and do not count against the guard budget.
 */
export function computeBorderTroops(
  map: BorderTroopMap,
  players: ReadonlyMap<number, BorderTroopPlayer>,
  isVisible: (tile: number) => boolean = () => true,
  region?: { x0: number; y0: number; x1: number; y1: number },
): BorderTroop[] {
  const W = map.width();
  const H = map.height();
  const x0 = Math.max(0, region?.x0 ?? 0);
  const y0 = Math.max(0, region?.y0 ?? 0);
  const x1 = Math.min(W, region?.x1 ?? W);
  const y1 = Math.min(H, region?.y1 ?? H);
  type Cand = { hash: number; troop: BorderTroop };
  const guards = new Map<number, Cand[]>();
  const clashes: BorderTroop[] = [];
  const c = TROOP_CELL;
  const cxs = Math.floor(x0 / c);
  const cys = Math.floor(y0 / c);
  for (let cy = cys; cy * c < y1; cy++) {
    for (let cx = cxs; cx * c < x1; cx++) {
      let found = false;
      for (let i = 0; i < c && !found; i++) {
        for (const [dx, dy] of [
          [i, i],
          [c - 1 - i, i],
        ]) {
          const x = cx * c + dx;
          const y = cy * c + dy;
          if (x >= W || y >= H) continue;
          const t = y * W + x;
          const owner = map.ownerID(t);
          if (owner === 0 || !map.isLand(t)) continue;
          const p = players.get(owner);
          if (p === undefined) continue;
          let foreign = -1;
          let fx = 0;
          for (const [nx, ny] of [
            [x + 1, y],
            [x - 1, y],
            [x, y + 1],
            [x, y - 1],
          ]) {
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const nt = ny * W + nx;
            const no = map.ownerID(nt);
            if (no !== owner && map.isLand(nt)) {
              foreign = no;
              fx = nx - x;
              if (no !== 0) break;
            }
          }
          if (foreign < 0) continue;
          found = true;
          if (!isVisible(t)) break;
          const other = foreign !== 0 ? players.get(foreign) : undefined;
          const fighting =
            other !== undefined &&
            (p.attacking.has(foreign) || other.attacking.has(owner));
          const troop: BorderTroop = {
            x,
            y,
            kind: fighting ? 1 : 0,
            age: p.age,
            color: p.color,
            facing: fx < 0 ? -1 : 1,
          };
          if (fighting) {
            clashes.push(troop);
          } else {
            const list = guards.get(owner) ?? [];
            list.push({ hash: cellHash(cx, cy), troop });
            guards.set(owner, list);
          }
          break;
        }
      }
    }
  }
  const out: BorderTroop[] = [...clashes];
  for (const [owner, list] of guards) {
    const p = players.get(owner)!;
    list.sort((a, b) => a.hash - b.hash);
    const n = troopsForPlayer(p.age, p.tiles);
    for (let i = 0; i < Math.min(n, list.length); i++) out.push(list[i].troop);
  }
  return out;
}
