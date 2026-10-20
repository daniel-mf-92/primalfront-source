import { expect, test } from "vitest";
import { PlayerExecution } from "../src/core/execution/PlayerExecution";
import { PlayerInfo, PlayerType } from "../src/core/game/Game";
import { setup } from "./util/Setup";

test("Module C: capture adds integration debt, tick digests it", async () => {
  const p1 = new PlayerInfo("player1", PlayerType.Human, "player1", "player1");
  const game = await setup("plains", { infiniteTroops: true }, [p1]);
  const player1 = game.player("player1");
  player1.conquer(game.ref(50, 50));
  expect(player1.isAlive()).toBe(true);
  game.addExecution(new PlayerExecution(player1));
  game.executeNextTick();
  player1.setIntegrationDebt(10);
  // Several ticks should digest debt down (throughput per tick > 0).
  for (let i = 0; i < 5; i++) game.executeNextTick();
  expect(player1.integrationDebt()).toBeLessThan(10);
});

test("Module C: overextension penalty reduces gold income at high debt", async () => {
  const p1 = new PlayerInfo("player1", PlayerType.Human, "player1", "player1");
  const game = await setup("plains", { infiniteTroops: true }, [p1]);
  const player1 = game.player("player1");
  player1.conquer(game.ref(50, 50));
  // The overextension penalty is Primitive-only. Primitive passive gold income is
  // now ZERO (it comes from caravan trade, not a drip), so the penalty's bite is
  // expressed through its multiplier (and troop-regen) rather than through
  // goldAdditionRate. Verify the penalty math directly: more debt ⇒ lower mult.
  const baseMult = game.config().overextensionPenalty(player1).goldMult;
  player1.setIntegrationDebt(10000); // far past capacity
  const taxedMult = game.config().overextensionPenalty(player1).goldMult;
  expect(taxedMult).toBeLessThan(baseMult);
});

test("Module C: helpers are deterministic and clamp", async () => {
  const p1 = new PlayerInfo("player1", PlayerType.Human, "player1", "player1");
  const game = await setup("plains", { infiniteTroops: true }, [p1]);
  const player1 = game.player("player1");
  player1.setIntegrationDebt(-5);
  expect(player1.integrationDebt()).toBe(0); // clamped >=0
  player1.addIntegrationDebt(3);
  player1.addIntegrationDebt(-99); // ignored
  expect(player1.integrationDebt()).toBe(3);
});

test("Primitive frontier far from any settlement re-wilds, the camp is kept; debt is digested (deterministic)", async () => {
  // Settlement-anchored rewild (Module §3, theirs' glob-drift) sheds unsupported
  // border land. Territory loss is NO LONGER driven by integration-debt overflow:
  // the old debt-overflow "frontier revolt" was REPLACED by this positional
  // rewild, so even MASSIVE integration debt digests down WITHOUT relinquishing
  // supported (camp) tiles — only the unsupported far frontier re-wilds.
  const p1 = new PlayerInfo("player1", PlayerType.Human, "player1", "player1");
  // Default age is Primitive, so the settlement-anchored rewild applies.
  const game = await setup("big_plains", { infiniteTroops: true }, [p1]);
  const player1 = game.player("player1");
  // Compact camp: the owned-tile centroid sits here, and these tiles are well
  // within the nomad-camp support radius, so they are anchored (never shed).
  const camp = [
    game.ref(50, 50),
    game.ref(51, 50),
    game.ref(50, 51),
    game.ref(51, 51),
  ];
  for (const t of camp) player1.conquer(t);

  // An isolated frontier tile far beyond the camp support radius, with no
  // settlement near it — exactly what the Primitive rewild should reclaim.
  const farTile = game.ref(50, 75);
  player1.conquer(farTile);
  expect(game.ownerID(farTile)).toBe(player1.smallID());

  game.addExecution(new PlayerExecution(player1));

  // Massive integration debt would have forced a debt-overflow revolt under the
  // OLD Module C gate. Under the positional rewild it must NOT relinquish the
  // supported camp — only the unsupported far frontier sheds — and the debt is
  // digested down each tick regardless (DECISION 1: digestion no longer
  // relinquishes; the rewild owns territory loss).
  player1.setIntegrationDebt(100000);

  // Run past a rewild cadence tick (the bleed is throttled to ~1/s).
  for (let i = 0; i < 21; i++) game.executeNextTick();

  // The unsupported far frontier re-wilded to neutral; the camp is retained.
  expect(game.ownerID(farTile)).not.toBe(player1.smallID());
  for (const t of camp) {
    expect(game.ownerID(t)).toBe(player1.smallID());
  }
  // Debt was digested (it never drove the relinquishment): the camp survived
  // despite the huge debt, and the debt itself drained well below its start.
  expect(player1.integrationDebt()).toBeLessThan(100000);
});
