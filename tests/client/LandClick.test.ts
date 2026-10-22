import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { advanceStillOut } from "../../src/client/hud/layers/GuideBeacon";
import {
  LandClickFacts,
  landClickLabel,
  landClickVerdict,
} from "../../src/client/hud/layers/LandClick";
import { needsHumanCheck } from "../../src/client/HumanCheck";
import { GameEnv } from "../../src/core/configuration/Config";
import { GameType } from "../../src/core/game/Game";

// Playtest 2026-10-22: clicks on unreachable land did nothing and said
// nothing, and "Claiming here" sat on a wood stand across the water for ten
// minutes. Every land click now answers where it landed.
const wild: LandClickFacts = {
  isLand: true,
  ownedByMe: false,
  targetName: null,
  friendly: false,
  canAttack: true,
  sharedBorder: false,
  canBoat: false,
  attackTroops: 500,
  atLandCap: false,
  alreadyAdvancing: false,
};
const rival: LandClickFacts = {
  ...wild,
  targetName: "Ug",
  sharedBorder: true,
};

const en = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "resources/lang/en.json"), "utf8"),
);
const keyExists = (key: string) =>
  key.split(".").reduce((o, k) => (o ? o[k] : undefined), en) !== undefined;

describe("land click verdict", () => {
  it("advances into reachable wild land and on bordering rivals", () => {
    expect(landClickVerdict(wild)).toEqual({
      kind: "advance",
      target: null,
      boat: false,
      reinforce: false,
    });
    expect(landClickVerdict(rival)).toMatchObject({
      kind: "advance",
      target: "Ug",
    });
    expect(landClickVerdict({ ...wild, alreadyAdvancing: true })).toMatchObject(
      { kind: "advance", reinforce: true },
    );
  });

  it("says why it cannot, for every way a click can fail", () => {
    const reason = (f: LandClickFacts) => {
      const v = landClickVerdict(f);
      return v.kind === "refuse" ? v.reason : v.kind;
    };
    expect(reason({ ...wild, canAttack: false })).toBe("unreachable");
    expect(reason({ ...rival, canAttack: false, sharedBorder: false })).toBe(
      "no_border",
    );
    expect(reason({ ...rival, canAttack: false })).toBe("peace");
    expect(reason({ ...rival, friendly: true })).toBe("allied");
    expect(reason({ ...wild, attackTroops: 0.4 })).toBe("no_troops");
    expect(reason({ ...wild, atLandCap: true })).toBe("land_cap");
    // The land cap only turns back pushes into the wild, not attacks.
    expect(reason({ ...rival, atLandCap: true })).toBe("advance");
    // No land path but a shore launch: by boat.
    expect(
      landClickVerdict({ ...wild, canAttack: false, canBoat: true }),
    ).toMatchObject({ kind: "advance", boat: true });
  });

  it("stays quiet on water and on my own land", () => {
    expect(landClickVerdict({ ...wild, isLand: false }).kind).toBe("ignore");
    expect(landClickVerdict({ ...wild, ownedByMe: true }).kind).toBe("ignore");
  });

  it("every answer has a label string", () => {
    const facts: LandClickFacts[] = [
      wild,
      rival,
      { ...wild, alreadyAdvancing: true },
      { ...wild, canAttack: false, canBoat: true },
      { ...wild, canAttack: false },
      { ...rival, canAttack: false, sharedBorder: false },
      { ...rival, canAttack: false },
      { ...rival, friendly: true },
      { ...wild, attackTroops: 0 },
      { ...wild, atLandCap: true },
    ];
    for (const f of facts) {
      const label = landClickLabel(landClickVerdict(f));
      expect(label).not.toBeNull();
      expect(keyExists(label!.key), label!.key).toBe(true);
    }
  });

  it("the advance marker lives only while its attack is out", () => {
    const me = (attacks: Array<{ targetID: number; retreating: boolean }>) => ({
      outgoingAttacks: () =>
        attacks.map((a) => ({ ...a, attackerID: 1, troops: 10, id: "a" })),
    });
    expect(advanceStillOut(me([{ targetID: 0, retreating: false }]), 0)).toBe(
      true,
    );
    expect(advanceStillOut(me([{ targetID: 0, retreating: true }]), 0)).toBe(
      false,
    );
    expect(advanceStillOut(me([{ targetID: 5, retreating: false }]), 0)).toBe(
      false,
    );
    expect(advanceStillOut(me([]), 0)).toBe(false);
  });
});

describe("human check", () => {
  const sp = { config: { gameType: GameType.Singleplayer } };
  const mp = { config: { gameType: GameType.Public } };
  it("never for practice or dev; always for multiplayer", () => {
    expect(needsHumanCheck(GameEnv.Prod, { gameStartInfo: sp })).toBe(false);
    expect(needsHumanCheck(GameEnv.Prod, { source: "singleplayer" })).toBe(
      false,
    );
    expect(needsHumanCheck(GameEnv.Dev, { gameStartInfo: mp })).toBe(false);
    expect(needsHumanCheck(GameEnv.Prod, { gameStartInfo: mp })).toBe(true);
    expect(needsHumanCheck(GameEnv.Prod, { source: "public" })).toBe(true);
  });
});
