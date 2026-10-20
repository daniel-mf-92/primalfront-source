import { expect, test } from "vitest";
import type {
  DramaCueID,
  DramaSnapshot,
} from "../../../../src/client/hud/layers/DramaDirector";
import {
  collectDramaCues,
  isRepeatableDramaCue,
} from "../../../../src/client/hud/layers/DramaDirector";

const baseSnapshot: DramaSnapshot = {
  age: 0,
  canAdvanceAge: false,
  cityCount: 0,
  farmCount: 0,
  outpostCount: 0,
  pipelineGoldPerSecond: 0n,
  threatLeaderID: null,
  isThreatLeader: false,
};

test("drama cues emit first economic and settlement milestones once", () => {
  const seen = new Set<DramaCueID>(["first_city"]);
  const cues = collectDramaCues(
    null,
    {
      ...baseSnapshot,
      cityCount: 1,
      farmCount: 1,
      outpostCount: 1,
      pipelineGoldPerSecond: 10n,
    },
    seen,
  );

  expect(cues).toEqual(["first_farm", "first_outpost", "first_resource_flow"]);
});

test("age-ready and threat cues fire on state transitions", () => {
  const cues = collectDramaCues(
    baseSnapshot,
    {
      ...baseSnapshot,
      canAdvanceAge: true,
      threatLeaderID: "rival",
      isThreatLeader: false,
    },
    new Set<DramaCueID>(),
  );

  expect(cues).toEqual(["age_ready", "threat_spotted"]);
});

test("threat cue waits until the player can respond", () => {
  const cues = collectDramaCues(
    baseSnapshot,
    {
      ...baseSnapshot,
      threatLeaderID: "rival",
      isThreatLeader: false,
    },
    new Set<DramaCueID>(),
  );

  expect(cues).toEqual([]);
});

test("resource flow alone does not interrupt the first turn with a threat alert", () => {
  const cues = collectDramaCues(
    baseSnapshot,
    {
      ...baseSnapshot,
      pipelineGoldPerSecond: 10n,
      threatLeaderID: "rival",
      isThreatLeader: false,
    },
    new Set<DramaCueID>(),
  );

  expect(cues).toEqual(["first_resource_flow"]);
});

test("age-up is repeatable while deed milestones are not", () => {
  const cues = collectDramaCues(
    { ...baseSnapshot, age: 1 },
    { ...baseSnapshot, age: 2 },
    new Set<DramaCueID>(["age_up"]),
  );

  expect(cues).toEqual(["age_up"]);
  expect(isRepeatableDramaCue("age_up")).toBe(true);
  expect(isRepeatableDramaCue("first_city")).toBe(false);
});
