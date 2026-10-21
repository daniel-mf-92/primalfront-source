import { ResourceSeedExecution } from "../src/core/execution/ResourceSeedExecution";
import { ResourceKind } from "../src/core/game/Game";
import { PseudoRandom } from "../src/core/PseudoRandom";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";

// Regression guard for the Primitive economy's one input. Before 2026-10-21 the
// World map seeded 83 wood stands (1 per 7,853 land tiles; median 56 tiles from
// a random spot to the nearest one). Any retune that drifts back toward that
// starves every tribe that is not sitting on its starter stand. The other
// direction is guarded by LoopVitals, not here: at 1 per ~1,200 tiles the first
// tribe left the Stone Age at 7:40 (owner target 8-14 min); the shipped density
// (~1 per 2,600, median ~39 tiles) exits at 10:00-11:40 across seeds and maps.
test("the world map seeds wood within reach of most land", async () => {
  const game = await setup("world", { bots: 0 }, [], undefined, TestConfig);
  game.addExecution(new ResourceSeedExecution("density_game"));
  game.executeNextTick();
  const woods: number[] = [];
  let land = 0;
  game.forEachTile((t) => {
    if (game.isLand(t)) land++;
    if (game.resourceAt(t).kind === ResourceKind.Wood) woods.push(t);
  });
  expect(land / woods.length).toBeLessThan(3000);

  const rand = new PseudoRandom(42);
  const dists: number[] = [];
  while (dists.length < 60) {
    const t = game.ref(
      rand.nextInt(0, game.width() - 1),
      rand.nextInt(0, game.height() - 1),
    );
    if (!game.isLand(t) || game.isBorder(t)) continue;
    let best = Infinity;
    for (const w of woods) {
      const d = Math.hypot(game.x(w) - game.x(t), game.y(w) - game.y(t));
      if (d < best) best = d;
    }
    dists.push(best);
  }
  dists.sort((a, b) => a - b);
  expect(dists[Math.floor(dists.length / 2)]).toBeLessThan(40);
});
