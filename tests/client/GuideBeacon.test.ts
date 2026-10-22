import { describe, expect, it } from "vitest";
import {
  nearestWoodStand,
  wantsWoodBeacon,
} from "../../src/client/hud/layers/GuideBeacon";
import { Age, ResourceKind } from "../../src/core/game/Game";

// A tiny fake map: 40x40, wood nodes at a few spots, one owned by "me".
function fakeMap(nodes: Array<[number, number, number, number]>) {
  const W = 40;
  const byTile = new Map<number, { quantity: number; owner: number }>();
  for (const [x, y, q, owner] of nodes)
    byTile.set(y * W + x, { quantity: q, owner });
  return {
    width: () => W,
    height: () => W,
    ref: (x: number, y: number) => y * W + x,
    isValidCoord: (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < W,
    resourceAt: (t: number) => {
      const n = byTile.get(t);
      return n
        ? { kind: ResourceKind.Wood, quantity: n.quantity }
        : { kind: ResourceKind.None, quantity: 0 };
    },
    ownerID: (t: number) => byTile.get(t)?.owner ?? 0,
    isResourceVisible: (t: number) => byTile.get(t)?.quantity !== 1,
  };
}

describe("guide beacon", () => {
  it("points at the nearest rich, visible stand the tribe does not own", () => {
    const map = fakeMap([
      [10, 10, 30, 7], // mine
      [14, 10, 30, 0], // nearest, free
      [30, 30, 30, 0], // far
      [11, 10, 2, 0], // stump
      [12, 10, 1, 0], // hidden by fog (quantity 1 in the fake = invisible)
    ]);
    const hit = nearestWoodStand(map, { x: 10, y: 10 }, 7);
    expect(hit).not.toBeNull();
    expect([hit!.x, hit!.y]).toEqual([14, 10]);
    expect(hit!.dist).toBe(4);
  });

  it("returns nothing when the only stands are out of range", () => {
    const map = fakeMap([[39, 39, 30, 0]]);
    expect(nearestWoodStand(map, { x: 0, y: 0 }, 7, 10)).toBeNull();
  });

  it("shows exactly when the goal says go to the wood stand", () => {
    const tribe = (age: Age) => ({
      age: () => age,
      hasSpawned: () => true,
      isAlive: () => true,
    });
    const go = { pointToWood: true };
    const stay = { pointToWood: false };
    expect(wantsWoodBeacon(tribe(Age.Primitive), go)).toBe(true);
    expect(wantsWoodBeacon(tribe(Age.Primitive), stay)).toBe(false);
    expect(wantsWoodBeacon(tribe(Age.Primitive), null)).toBe(false);
    expect(wantsWoodBeacon(tribe(Age.Classical), go)).toBe(false);
  });
});
