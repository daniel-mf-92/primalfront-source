import { expect, test } from "vitest";
import { Age, EraTriumph, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { setup } from "./util/Setup";

test("an unmastered era rush pays a premium and stays vulnerable longer", async () => {
  const info = new PlayerInfo("rush", PlayerType.Human, null, "rush");
  const game = await setup("big_plains", { infiniteTroops: true }, [info]);
  const player = game.player("rush");
  player.setAge(Age.Classical);
  const config = game.config();
  const base = config.baseAdvanceAgeCost(Age.Classical)!;
  const rushed = config.advanceAgeCost(player)!;

  expect(player.eraTriumphCount()).toBe(0);
  expect(rushed.gold).toBe((base.gold * 15000n) / 10000n);
  expect(rushed.techPoints).toBe(Math.ceil(base.techPoints * 1.5));
  expect(config.greatWorkTicks(Age.Classical, 0)).toBeGreaterThan(
    config.greatWorkTicks(Age.Classical, 2),
  );
  expect(config.advancePenaltyTicks(0)).toBeGreaterThan(
    config.advancePenaltyTicks(2),
  );
});

test("broad era play earns sticky Triumphs and restores the base transition", async () => {
  const info = new PlayerInfo("master", PlayerType.Human, null, "master");
  const game = await setup("big_plains", { infiniteTroops: true }, [info]);
  const player = game.player("master");
  player.setAge(Age.Classical);
  player.setAgeAdvanceCredit(0.5);
  const config = game.config();
  const base = config.baseAdvanceAgeCost(Age.Classical)!;

  player.addTechPoints(
    Math.ceil(
      base.techPoints *
        (1 - player.ageAdvanceCredit()) *
        config.eraIngenuityTargetMult(),
    ),
  );
  player.addGold(config.eraProsperityTarget(Age.Classical));
  player.refreshEraTriumphs();

  expect(player.eraTriumphMask() & EraTriumph.Ingenuity).not.toBe(0);
  expect(player.eraTriumphMask() & EraTriumph.Prosperity).not.toBe(0);
  expect(player.eraTriumphCount()).toBe(2);
  expect(config.advanceAgeCost(player)).toEqual(base);

  player.removeGold(player.gold());
  player.refreshEraTriumphs();
  expect(player.eraTriumphCount()).toBe(2);
});

test("all eight ages have explicit economy multipliers", async () => {
  const info = new PlayerInfo("alien", PlayerType.Human, null, "alien");
  const game = await setup("big_plains", { infiniteTroops: true }, [info]);
  const player = game.player("alien");
  player.setAge(Age.Alien);

  expect(game.config().ageExpansionCostMult(player)).toBe(2.4);
  expect(game.config().ageTroopRegenMult(player)).toBe(0.6);
});
