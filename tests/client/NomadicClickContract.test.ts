import fs from "fs/promises";
import path from "path";
import { describe, expect, test } from "vitest";

// A land click is an attack that grows toward the click, in every age. The
// Stone Age camp-migration click is retired (owner direction 2026-10-21).
const readRepoFile = (relativePath: string) =>
  fs.readFile(path.join(process.cwd(), relativePath), "utf8");

describe("nomadic click contract", () => {
  test("the client never turns a click into a camp migration", async () => {
    const runner = await readRepoFile("src/client/ClientGameRunner.ts");
    expect(runner).not.toContain("SendPrimitiveMigrationIntentEvent");
    expect(runner).toMatch(/new SendAttackIntentEvent\([\s\S]*?tile,\s*\)/);
  });

  test("the attack intent carries the clicked tile and the sim reads it", async () => {
    const transport = await readRepoFile("src/client/Transport.ts");
    const schemas = await readRepoFile("src/core/Schemas.ts");
    const manager = await readRepoFile(
      "src/core/execution/ExecutionManager.ts",
    );
    expect(transport).toContain("focus: event.tile");
    expect(schemas).toMatch(
      /focus: z\.number\(\)\.int\(\)\.nonnegative\(\)\.optional\(\)/,
    );
    expect(manager).toContain("intent.focus ?? null");
  });

  test("the on-map marker and the strings talk about claiming, not moving a camp", async () => {
    const beacon = await readRepoFile("src/client/hud/layers/GuideBeacon.ts");
    expect(beacon).toContain("SendAttackIntentEvent");
    expect(beacon).not.toContain("SendPrimitiveMigrationIntentEvent");
    const en = JSON.parse(await readRepoFile("resources/lang/en.json"));
    expect(en.guide_beacon.move).not.toMatch(/camp/i);
    expect(en.help_modal.how_to_play_1).not.toMatch(/move your camp/i);
    expect(en.control_panel.objective_find_resources).not.toMatch(/walk/i);
  });
});
