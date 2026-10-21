import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { computeEraStanding } from "../../../../src/client/hud/layers/ObjectiveRail";
import { Age } from "../../../../src/core/game/Game";

// The era ladder's LENGTH is a deliberate mystery: a player must never learn how
// many ages exist or how far they are from the last one. That rules out a
// completion fraction, so position can only be expressed relative to the table.
// These cover the ranking itself and the no-leak guarantee.

/** Minimal stand-in — computeEraStanding only reads age() and isAlive(). */
function player(age: Age, alive = true) {
  return { age: () => age, isAlive: () => alive } as never;
}

describe("computeEraStanding", () => {
  it("returns null when there is nobody to rank against", () => {
    const me = player(Age.Primitive);
    expect(computeEraStanding(me, [me])).toBeNull();
    expect(computeEraStanding(me, [])).toBeNull();
  });

  it("ignores the dead — standing is about live rivals", () => {
    const me = player(Age.Primitive);
    const deadAhead = player(Age.Modern, false);
    expect(computeEraStanding(me, [me, deadAhead])).toBeNull();
  });

  it("ranks first when nobody is in a later era", () => {
    const me = player(Age.Imperial);
    const behind = player(Age.Primitive);
    const level = player(Age.Imperial);
    const standing = computeEraStanding(me, [me, behind, level]);
    expect(standing).toEqual({ ahead: 0, rank: 1, peers: 2 });
  });

  it("counts only players strictly ahead, so ties do not demote you", () => {
    const me = player(Age.Feudal);
    const tie1 = player(Age.Feudal);
    const tie2 = player(Age.Feudal);
    expect(computeEraStanding(me, [me, tie1, tie2])?.rank).toBe(1);
  });

  it("ranks behind everyone in a later era", () => {
    const me = player(Age.Classical);
    const rivals = [
      player(Age.Imperial),
      player(Age.Modern),
      player(Age.Primitive),
    ];
    const standing = computeEraStanding(me, [me, ...rivals]);
    expect(standing).toEqual({ ahead: 2, rank: 3, peers: 3 });
  });

  it("never derives rank from the number of ages that exist", () => {
    // Same rank regardless of which end of the ladder the table sits at: the
    // result must depend only on relative order, never on Age.Alien's value.
    const low = computeEraStanding(player(Age.Primitive), [
      player(Age.Primitive),
      player(Age.Classical),
    ]);
    const high = computeEraStanding(player(Age.Modern), [
      player(Age.Modern),
      player(Age.Alien),
    ]);
    expect(low?.rank).toBe(high?.rank);
    expect(low?.ahead).toBe(high?.ahead);
  });
});

describe("era ladder length stays hidden", () => {
  const repoRoot = path.resolve(__dirname, "../../../..");

  it("no HUD string interpolates a total number of ages", () => {
    const en = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "resources/lang/en.json"), "utf8"),
    );
    const cp = en.control_panel ?? {};
    const offenders = Object.entries(cp)
      .filter(
        ([, v]) =>
          typeof v === "string" &&
          (/\{total\}/.test(v) || /\/\s*\{/.test(v) || /\bof\s*\{/.test(v)),
      )
      .map(([k]) => k);
    expect(
      offenders,
      `control_panel strings expose a denominator: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  it("the era readout renders a numeral, not a fraction", () => {
    const en = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "resources/lang/en.json"), "utf8"),
    );
    expect(en.control_panel.era_number).toBe("Age {numeral}");
  });
});
