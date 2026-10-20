import { expect, test } from "vitest";
import type { DirectorTargetCandidate } from "../../../src/client/controllers/MapDirectorController";
import { chooseDirectorTarget } from "../../../src/client/controllers/MapDirectorController";
import type { TileRef } from "../../../src/core/game/GameMap";

const tile = (n: number) => n as TileRef;

test("resource objectives prefer visible resources even when a settlement is closer", () => {
  const candidates: DirectorTargetCandidate[] = [
    { tile: tile(1), kind: "settlement", distance2: 1 },
    { tile: tile(2), kind: "resource", distance2: 100 },
  ];

  expect(chooseDirectorTarget("find_resources", candidates)).toBe(tile(2));
});

test("advance objectives prefer settlements", () => {
  const candidates: DirectorTargetCandidate[] = [
    { tile: tile(3), kind: "resource", distance2: 1 },
    { tile: tile(4), kind: "settlement", distance2: 100 },
  ];

  expect(chooseDirectorTarget("advance_age", candidates)).toBe(tile(4));
});

test("economy objectives prefer economy structures and otherwise use nearest target", () => {
  expect(
    chooseDirectorTarget("generate_tech", [
      { tile: tile(5), kind: "settlement", distance2: 1 },
      { tile: tile(6), kind: "economy", distance2: 100 },
    ]),
  ).toBe(tile(6));

  expect(
    chooseDirectorTarget("final_age", [
      { tile: tile(7), kind: "resource", distance2: 40 },
      { tile: tile(8), kind: "resource", distance2: 4 },
    ]),
  ).toBe(tile(8));
});
