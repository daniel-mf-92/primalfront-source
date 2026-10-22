import { describe, expect, it } from "vitest";
import {
  BorderTroopPlayer,
  computeBorderTroops,
  MAX_TROOPS_PER_PLAYER,
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
});
