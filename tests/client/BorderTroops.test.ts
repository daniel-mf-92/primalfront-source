import { describe, expect, it } from "vitest";
import {
  BorderTroopPlayer,
  CLASH_SPACING,
  computeBorderTroops,
  MAX_CLASHES_PER_FRONT,
  MAX_TROOPS_PER_PLAYER,
  MIN_TROOP_SPACING,
  PATROL_RADIUS,
  patrolWeight,
  TROOP_CELL,
  troopsForPlayer,
} from "../../src/client/BorderTroops";

function grid(W: number, H: number, owner: (x: number, y: number) => number) {
  const o = new Uint16Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) o[y * W + x] = owner(x, y);
  return {
    width: () => W,
    height: () => H,
    ownerID: (t: number) => o[t],
    isLand: () => true,
  };
}

function player(
  id: number,
  age: number,
  tiles: number,
  attacking: number[] = [],
): BorderTroopPlayer {
  return {
    smallID: id,
    age,
    tiles,
    color: [1, 0, 0],
    attacking: new Set(attacking),
  };
}

describe("border troops", () => {
  it("a Stone Age band fields a few scouts, later ages more, all capped", () => {
    expect(troopsForPlayer(0, 250)).toBeGreaterThanOrEqual(1);
    expect(troopsForPlayer(0, 250)).toBeLessThanOrEqual(
      MAX_TROOPS_PER_PLAYER[0],
    );
    for (let age = 1; age < 8; age++) {
      expect(troopsForPlayer(age, 5000)).toBeGreaterThanOrEqual(
        troopsForPlayer(age - 1, 5000),
      );
    }
    // More land, more troops (until the cap).
    expect(troopsForPlayer(3, 2000)).toBeGreaterThan(troopsForPlayer(3, 400));
  });

  it("stands guards on the border, never inside the territory", () => {
    const map = grid(60, 60, (x, y) =>
      x >= 10 && x < 40 && y >= 10 && y < 40 ? 1 : 0,
    );
    const troops = computeBorderTroops(map, new Map([[1, player(1, 3, 900)]]));
    expect(troops.length).toBeGreaterThan(0);
    expect(troops.length).toBeLessThanOrEqual(troopsForPlayer(3, 900));
    for (const t of troops) {
      const onEdge = t.x === 10 || t.x === 39 || t.y === 10 || t.y === 39;
      expect(onEdge).toBe(true);
      expect(t.kind).toBe(0);
    }
  });

  it("draws clashes where one owner attacks its neighbour", () => {
    const map = grid(60, 30, (x) => (x < 30 ? 1 : 2));
    const players = new Map([
      [1, player(1, 1, 900, [2])],
      [2, player(2, 1, 900)],
    ]);
    const troops = computeBorderTroops(map, players);
    const clashes = troops.filter((t) => t.kind === 1);
    expect(clashes.length).toBeGreaterThan(0);
    for (const c of clashes) expect(c.x === 29 || c.x === 30).toBe(true);
  });

  it("is stable: the same map gives the same troops", () => {
    const map = grid(80, 80, (x, y) =>
      (x - 40) ** 2 + (y - 40) ** 2 < 600 ? 1 : 0,
    );
    const p = new Map([[1, player(1, 2, 1880)]]);
    expect(computeBorderTroops(map, p)).toEqual(computeBorderTroops(map, p));
  });

  it("hides troops the local player cannot see", () => {
    const map = grid(40, 40, (x, y) =>
      x >= 5 && x < 30 && y >= 5 && y < 30 ? 1 : 0,
    );
    const troops = computeBorderTroops(
      map,
      new Map([[1, player(1, 4, 600)]]),
      () => false,
    );
    expect(troops).toHaveLength(0);
  });
  it("gives every troop a unique key that names its owner", () => {
    const map = grid(60, 30, (x) => (x < 20 ? 1 : x < 40 ? 2 : 3));
    const players = new Map([
      [1, player(1, 3, 600, [2])],
      [2, player(2, 3, 600)],
      [3, player(3, 3, 600)],
    ]);
    const troops = computeBorderTroops(map, players);
    expect(troops.length).toBeGreaterThan(2);
    const keys = new Set(troops.map((t) => t.key));
    expect(keys.size).toBe(troops.length);
    for (const t of troops) {
      expect(players.has(t.owner)).toBe(true);
      expect(Number.isSafeInteger(t.key)).toBe(true);
    }
  });

  it("keeps a guard's key when its border moves inside the same cell", () => {
    // A straight east border; push it one tile east, staying in the cell.
    const edge = TROOP_CELL * 3 + 2;
    const before = computeBorderTroops(
      grid(70, 70, (x) => (x <= edge ? 1 : 0)),
      new Map([[1, player(1, 5, 2000)]]),
    );
    const after = computeBorderTroops(
      grid(70, 70, (x) => (x <= edge + 1 ? 1 : 0)),
      new Map([[1, player(1, 5, 2000)]]),
    );
    const onEdge = (ts: typeof before, x: number) =>
      new Map(ts.filter((t) => t.x === x).map((t) => [t.key, t]));
    const a = onEdge(before, edge);
    const b = onEdge(after, edge + 1);
    expect(a.size).toBeGreaterThan(0);
    let shared = 0;
    for (const [key, t] of a) {
      const moved = b.get(key);
      if (moved === undefined) continue;
      shared++;
      expect(moved.x).toBe(t.x + 1);
      expect(moved.owner).toBe(1);
    }
    expect(shared).toBeGreaterThan(0);
  });

  it("a clash and a guard in the same cell never share a key", () => {
    const map = grid(40, 20, (x) => (x < 20 ? 1 : 2));
    const peace = computeBorderTroops(
      map,
      new Map([
        [1, player(1, 2, 400)],
        [2, player(2, 2, 400)],
      ]),
    );
    const war = computeBorderTroops(
      map,
      new Map([
        [1, player(1, 2, 400, [2])],
        [2, player(2, 2, 400)],
      ]),
    );
    const peaceKeys = new Set(peace.map((t) => t.key));
    for (const t of war.filter((w) => w.kind === 1)) {
      expect(peaceKeys.has(t.key)).toBe(false);
    }
  });
  it("thins a long war front to a few well-spaced clashes", () => {
    const map = grid(40, 200, (x) => (x < 20 ? 1 : 2));
    const troops = computeBorderTroops(
      map,
      new Map([
        [1, player(1, 4, 4000, [2])],
        [2, player(2, 4, 4000, [1])],
      ]),
    );
    const clashes = troops.filter((t) => t.kind === 1);
    expect(clashes.length).toBeGreaterThan(1);
    expect(clashes.length).toBeLessThanOrEqual(MAX_CLASHES_PER_FRONT);
    for (const a of clashes)
      for (const b of clashes)
        if (a !== b)
          expect((a.x - b.x) ** 2 + (a.y - b.y) ** 2).toBeGreaterThanOrEqual(
            CLASH_SPACING ** 2,
          );
  });
  it("never stacks two neighbours' guards on a shared border", () => {
    // A ragged border so both owners get candidate cells along it.
    const map = grid(30, 120, (x, y) => (x < 15 + ((y >> 3) % 2) * 3 ? 1 : 2));
    const troops = computeBorderTroops(
      map,
      new Map([
        [1, player(1, 7, 6000)],
        [2, player(2, 7, 6000)],
      ]),
    );
    expect(new Set(troops.map((t) => t.owner)).size).toBe(2);
    for (const a of troops)
      for (const b of troops)
        if (a !== b)
          expect((a.x - b.x) ** 2 + (a.y - b.y) ** 2).toBeGreaterThanOrEqual(
            MIN_TROOP_SPACING ** 2,
          );
  });

  it("each guard patrols to another border tile of its own, a few tiles away", () => {
    const W = 60;
    const inside = (x: number, y: number) =>
      x >= 10 && x < 40 && y >= 10 && y < 40;
    const map = grid(W, 60, (x, y) => (inside(x, y) ? 1 : 0));
    const troops = computeBorderTroops(map, new Map([[1, player(1, 3, 900)]]));
    expect(troops.length).toBeGreaterThan(0);
    let moved = 0;
    for (const t of troops) {
      expect(inside(t.px, t.py)).toBe(true);
      const onEdge = t.px === 10 || t.px === 39 || t.py === 10 || t.py === 39;
      expect(onEdge).toBe(true);
      const d = Math.hypot(t.px - t.x, t.py - t.y);
      expect(d).toBeLessThanOrEqual(PATROL_RADIUS + 1);
      if (d > 0) moved++;
    }
    expect(moved).toBe(troops.length);
  });

  it("clashes hold their ground (no patrol)", () => {
    const map = grid(60, 30, (x) => (x < 30 ? 1 : 2));
    const troops = computeBorderTroops(
      map,
      new Map([
        [1, player(1, 2, 900, [2])],
        [2, player(2, 2, 900)],
      ]),
    );
    const clashes = troops.filter((t) => t.kind === 1);
    expect(clashes.length).toBeGreaterThan(0);
    for (const t of clashes) expect([t.px, t.py]).toEqual([t.x, t.y]);
  });

  it("the patrol walks out, pauses, walks back and pauses", () => {
    let lo = 1;
    let hi = 0;
    let atRest = 0;
    const N = 400;
    for (let i = 0; i < N; i++) {
      const w = patrolWeight((i / N) * 13, 0);
      lo = Math.min(lo, w);
      hi = Math.max(hi, w);
      if (w === 0 || w === 1) atRest++;
    }
    expect(lo).toBe(0);
    expect(hi).toBe(1);
    expect(atRest).toBeGreaterThan(N * 0.2);
    // Continuous: no jump between frames 1/60 s apart.
    for (let t = 0; t < 20; t += 1 / 60) {
      expect(
        Math.abs(patrolWeight(t + 1 / 60, 0.3) - patrolWeight(t, 0.3)),
      ).toBeLessThan(0.02);
    }
  });
});
