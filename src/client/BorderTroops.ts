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
  /**
   * Stable identity across refreshes: owner and grid cell (and kind). The same
   * guard keeps its key while it stays in its cell, so the renderer can glide
   * it to its new spot instead of popping; see BorderTroopPass.
   */
  key: number;
  /** Owner smallID. */
  owner: number;
  x: number;
  y: number;
  /** 0 = guard, 1 = clash. */
  kind: number;
  age: number;
  color: [number, number, number];
  /** +1 faces right, -1 faces left (toward the outside of the territory). */
  facing: number;
  /**
   * The other end of this guard's patrol: another border tile of the same
   * owner a few tiles along the border (the spot itself when there is none,
   * and always for clashes). The renderer walks the guard back and forth.
   */
  px: number;
  py: number;
}

/** Patrol reach, tiles: how far along the border a guard walks. */
export const PATROL_RADIUS = 3;
/** Seconds for one patrol round trip (plus up to PATROL_JITTER per troop). */
const PATROL_SECONDS = 9;
const PATROL_JITTER = 4;

/**
 * Where along its patrol a guard is at a moment (0 = its spot, 1 = the far
 * end): walk out, pause, walk back, pause, on a per-troop period and phase
 * (seed in [0, 1)). Used by BorderTroopPass every frame.
 */
export function patrolWeight(seconds: number, seed: number): number {
  const period = PATROL_SECONDS + PATROL_JITTER * seed;
  const u = seconds / period + seed;
  const f = u - Math.floor(u);
  return smoothstep(0.08, 0.42, f) - smoothstep(0.58, 0.92, f);
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
/** Directions tried for the patrol end, in a fixed order (16 compass points). */
const PATROL_DIRS: ReadonlyArray<readonly [number, number]> = Array.from(
  { length: 16 },
  (_, i) => {
    const a = (i * Math.PI) / 8;
    return [
      Math.round(Math.cos(a) * PATROL_RADIUS),
      Math.round(Math.sin(a) * PATROL_RADIUS),
    ] as const;
  },
);

function isBorderOf(
  map: BorderTroopMap,
  W: number,
  H: number,
  x: number,
  y: number,
  owner: number,
): boolean {
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  const t = y * W + x;
  if (map.ownerID(t) !== owner || !map.isLand(t)) return false;
  for (const [nx, ny] of [
    [x + 1, y],
    [x - 1, y],
    [x, y + 1],
    [x, y - 1],
  ]) {
    if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
    const nt = ny * W + nx;
    if (map.ownerID(nt) !== owner && map.isLand(nt)) return true;
  }
  return false;
}

/** A border tile of the same owner about PATROL_RADIUS away, or the spot. */
function patrolEnd(
  map: BorderTroopMap,
  W: number,
  H: number,
  t: BorderTroop,
  hash: number,
): [number, number] {
  const start = Math.floor(hash * PATROL_DIRS.length);
  for (let i = 0; i < PATROL_DIRS.length; i++) {
    const [dx, dy] = PATROL_DIRS[(start + i) % PATROL_DIRS.length];
    if (isBorderOf(map, W, H, t.x + dx, t.y + dy, t.owner)) {
      return [t.x + dx, t.y + dy];
    }
  }
  return [t.x, t.y];
}

/** Grid cell size in tiles: at most one figure per cell keeps them apart. */
export const TROOP_CELL = 7;

/**
 * Tiles of territory per drawn figure, by age. Stone Age bands field a handful
 * of scouts; armies thicken with every age. Index = Age value.
 */
export const TILES_PER_TROOP = [110, 80, 60, 45, 36, 30, 26, 24];

/**
 * Clashes along one front are thinned so a long war line reads as a few
 * sparks, not a solid red chain: kept clashes stand at least this many tiles
 * apart, and at most MAX_CLASHES_PER_FRONT per pair of owners.
 */
export const CLASH_SPACING = TROOP_CELL * 2;
export const MAX_CLASHES_PER_FRONT = 8;

/**
 * Two neighbours each post a guard on their side of a shared border, often a
 * tile apart. Badges closer than this (tiles) to one already kept are dropped,
 * so a busy border reads as a row of single badges, not stacked pairs.
 */
export const MIN_TROOP_SPACING = 6;

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
 * first and do not count against the guard budget; per front (pair of owners)
 * they are thinned to a few well-spaced sparks.
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
  const clashes = new Map<number, Cand[]>();
  const c = TROOP_CELL;
  const cellsX = Math.ceil(W / c);
  const cellsTotal = cellsX * Math.ceil(H / c);
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
          const kind = fighting ? 1 : 0;
          const troop: BorderTroop = {
            key: (owner * cellsTotal + cy * cellsX + cx) * 2 + kind,
            owner,
            x,
            y,
            kind,
            age: p.age,
            color: p.color,
            facing: fx < 0 ? -1 : 1,
            px: x,
            py: y,
          };
          if (fighting) {
            const front =
              Math.min(owner, foreign) * 65536 + Math.max(owner, foreign);
            const list = clashes.get(front) ?? [];
            list.push({ hash: cellHash(cx, cy), troop });
            clashes.set(front, list);
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
  const out: BorderTroop[] = [];
  const spacing2 = CLASH_SPACING * CLASH_SPACING;
  for (const list of clashes.values()) {
    list.sort((a, b) => a.hash - b.hash);
    const kept: BorderTroop[] = [];
    for (const { troop } of list) {
      if (kept.length >= MAX_CLASHES_PER_FRONT) break;
      if (
        kept.some((k) => (k.x - troop.x) ** 2 + (k.y - troop.y) ** 2 < spacing2)
      )
        continue;
      kept.push(troop);
    }
    out.push(...kept);
  }
  // Guards: each owner's best-ranked spots, then globally spaced so badges
  // of neighbouring owners never stack.
  const picked: Cand[] = [];
  for (const [owner, list] of guards) {
    const p = players.get(owner)!;
    list.sort((a, b) => a.hash - b.hash);
    const n = troopsForPlayer(p.age, p.tiles);
    for (let i = 0; i < Math.min(n, list.length); i++) picked.push(list[i]);
  }
  picked.sort((a, b) => a.hash - b.hash || a.troop.key - b.troop.key);
  // Spatial hash (bucket = MIN_TROOP_SPACING tiles) keeps this linear.
  const S = MIN_TROOP_SPACING;
  const min2 = S * S;
  const buckets = new Map<number, BorderTroop[]>();
  const bucketKey = (bx: number, by: number) => by * 65536 + bx;
  const place = (t: BorderTroop) => {
    const k = bucketKey(Math.floor(t.x / S), Math.floor(t.y / S));
    const b = buckets.get(k);
    if (b) b.push(t);
    else buckets.set(k, [t]);
  };
  const near = (t: BorderTroop) => {
    const bx = Math.floor(t.x / S);
    const by = Math.floor(t.y / S);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        for (const k of buckets.get(bucketKey(bx + dx, by + dy)) ?? [])
          if ((k.x - t.x) ** 2 + (k.y - t.y) ** 2 < min2) return true;
    return false;
  };
  for (const t of out) place(t);
  for (const { troop, hash } of picked) {
    if (near(troop)) continue;
    [troop.px, troop.py] = patrolEnd(map, W, H, troop, hash);
    out.push(troop);
    place(troop);
  }
  return out;
}
