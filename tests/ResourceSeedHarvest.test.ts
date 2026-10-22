import { HarvestExecution } from "../src/core/execution/HarvestExecution";
import { ResourceSeedExecution } from "../src/core/execution/ResourceSeedExecution";
import { ResourceTerritoryFlowExecution } from "../src/core/execution/ResourceTerritoryFlowExecution";
import { SpawnExecution } from "../src/core/execution/SpawnExecution";
import {
  Age,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  ResourceKind,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { GameID } from "../src/core/Schemas";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// Snapshot the full per-tile resource layer into a comparable string so two
// runs can be compared for byte-for-byte determinism.
function snapshotResources(game: Game): string {
  const parts: string[] = [];
  game.forEachTile((tile: TileRef) => {
    const r = game.resourceAt(tile);
    if (r.kind !== ResourceKind.None) {
      parts.push(`${tile}:${r.kind}:${r.quantity}`);
    }
  });
  return parts.join("|");
}

describe("ResourceSeedExecution determinism", () => {
  it("seeds identical nodes for the same gameID, different for another", async () => {
    const gameA1 = await setup("plains");
    new ResourceSeedExecution("game_seed_A").init(gameA1, 0);
    const snapA1 = snapshotResources(gameA1);

    const gameA2 = await setup("plains");
    new ResourceSeedExecution("game_seed_A").init(gameA2, 0);
    const snapA2 = snapshotResources(gameA2);

    // Same gameID + same map ⇒ byte-identical node layout.
    expect(snapA2).toBe(snapA1);
    // Sanity: it actually placed SOME nodes (plains has wooded/green land).
    expect(snapA1.length).toBeGreaterThan(0);

    const gameB = await setup("plains");
    new ResourceSeedExecution("game_seed_B").init(gameB, 0);
    const snapB = snapshotResources(gameB);

    // A different gameID seeds a different layout.
    expect(snapB).not.toBe(snapA1);
  });

  it("places wood/rock on land and fish in inland water", async () => {
    const game = await setup("plains");
    new ResourceSeedExecution("game_seed_water").init(game, 0);
    game.forEachTile((tile: TileRef) => {
      const r = game.resourceAt(tile);
      if (r.kind !== ResourceKind.None) {
        if (r.kind === ResourceKind.Fish) {
          expect(game.isWater(tile)).toBe(true);
          expect(game.isOcean(tile)).toBe(false);
        } else {
          expect(game.isLand(tile)).toBe(true);
        }
      }
    });
  });
});

// Worker -> main replication of the per-tile resource layer (Module §7).
// The seed runs ONLY on the authoritative worker map; the client mirror must
// light up its nodes from the packed `[tileRef, resourceByte]` delta channel
// (drainPackedResourceUpdates) and deplete/clear them as the worker harvests —
// never by re-running the seed (which would be the determinism trap this whole
// channel exists to avoid). This is the bug the live client hit: nodes only
// ever existed in the worker map, so the main-thread renderer drew nothing.
describe("resource layer worker->main replication", () => {
  // Apply one drained packed-resource buffer onto the client mirror, exactly as
  // GameView.update() does on the main thread.
  function applyPacked(mirror: Game, packed: Uint32Array): void {
    for (let i = 0; i + 1 < packed.length; i += 2) {
      mirror.updateResourceTile(packed[i], packed[i + 1]);
    }
  }

  it("mirrors seeded nodes onto a fresh client map via the packed channel", async () => {
    // Authoritative worker map: seeded.
    const worker = await setup("plains");
    new ResourceSeedExecution("repl_game").init(worker, 0);

    // Independent client mirror (same terrain, NOT seeded — starts all-None).
    const mirror = await setup("plains");
    expect(snapshotResources(mirror)).toBe("");

    // The seed records every placed tile, so the first drain is the full
    // snapshot. Replicate it onto the mirror.
    const snapshot = worker.drainPackedResourceUpdates();
    expect(snapshot.length).toBeGreaterThan(0);
    applyPacked(mirror, snapshot);

    // Client mirror now shows the SAME nodes the worker has — nodes appear.
    expect(snapshotResources(mirror)).toBe(snapshotResources(worker));
    expect(snapshotResources(mirror).length).toBeGreaterThan(0);

    // And the mirror's own renderer delta queue carries those tiles, so the
    // ResourceNodePass drain path (drainResourceUpdates) is live, not the
    // 30-tick rescan fallback.
    expect(mirror.drainResourceUpdates().length).toBeGreaterThan(0);
  });

  it("depletes and clears a harvested node on the client mirror", async () => {
    const worker = await setup("plains");
    const mirror = await setup("plains");

    // Place a known node on the worker, replicate the resulting delta.
    const tile = worker.ref(5, 10);
    worker.setResource(tile, ResourceKind.Wood, 12);
    applyPacked(mirror, worker.drainPackedResourceUpdates());

    expect(mirror.resourceAt(tile)).toEqual({
      kind: ResourceKind.Wood,
      quantity: 12,
    });
    mirror.drainResourceUpdates(); // clear the queue from the snapshot apply.

    // Worker harvests part of the node — depletion delta replicates.
    const taken = worker.harvestResource(tile, 5);
    expect(taken).toBe(5);
    applyPacked(mirror, worker.drainPackedResourceUpdates());
    expect(mirror.resourceAt(tile).quantity).toBe(7);

    // Worker fully drains the node — the mirror clears it to None, and the
    // delta queue reports the cleared tile so the renderer removes its sprite.
    worker.harvestResource(tile, 100);
    const clearing = worker.drainPackedResourceUpdates();
    applyPacked(mirror, clearing);
    expect(mirror.resourceAt(tile).kind).toBe(ResourceKind.None);
    expect(mirror.drainResourceUpdates()).toContain(tile);
  });
});

describe("HarvestExecution validation", () => {
  let game: Game;
  const gameID: GameID = "harvest_game";
  let player: Player;
  let pack: Player;

  beforeEach(async () => {
    game = await setup("plains", {
      infiniteGold: true,
      instantBuild: true,
      infiniteTroops: true,
    });

    const playerInfo = new PlayerInfo(
      "Harvester",
      PlayerType.Human,
      null,
      "Harvester",
    );
    // A bot flagged as an animal pack — must be rejected from harvesting.
    const packInfo = new PlayerInfo("Pack", PlayerType.Bot, null, "Pack");
    packInfo.setIsAnimalPack(true);

    game.addPlayer(playerInfo);
    game.addPlayer(packInfo);

    game.addExecution(
      new SpawnExecution(
        gameID,
        game.player(playerInfo.id).info(),
        game.ref(5, 10),
      ),
      new SpawnExecution(
        gameID,
        game.player(packInfo.id).info(),
        game.ref(40, 40),
      ),
    );
    executeTicks(game, 2);

    player = game.player(playerInfo.id);
    player.setAge(Age.Classical);
    pack = game.player(packInfo.id);
  });

  it("harvests a node on a tile the player owns and grows the pile", () => {
    const tile = Array.from(player.tiles())[0];
    expect(game.ownerID(tile)).toBe(player.smallID());

    game.setResource(tile, ResourceKind.Wood, 30);
    const before = player.wood();

    const exec = new HarvestExecution(player, tile);
    exec.init(game, 0);

    // Single-shot.
    expect(exec.isActive()).toBe(false);
    // Pile grew, node shrank by the same amount.
    const got = player.wood() - before;
    expect(got).toBeGreaterThan(0);
    expect(game.resourceAt(tile).quantity).toBe(30 - got);
  });

  it("rejects manual harvesting for primitive tribes", () => {
    player.setAge(Age.Primitive);
    const tile = Array.from(player.tiles())[0];
    game.setResource(tile, ResourceKind.Wood, 30);
    const before = player.resources();

    new HarvestExecution(player, tile).init(game, 0);

    expect(player.resources()).toBe(before);
    expect(game.resourceAt(tile)).toEqual({
      kind: ResourceKind.Wood,
      quantity: 30,
    });
  });

  it("rejects manual fish harvesting outside primitive foraging", () => {
    player.setAge(Age.Classical);
    const tile = Array.from(player.tiles())[0];
    game.setResource(tile, ResourceKind.Fish, 12);
    const before = player.resources();

    new HarvestExecution(player, tile).init(game, 0);

    expect(player.resources()).toBe(before);
    expect(game.resourceAt(tile)).toEqual({
      kind: ResourceKind.Fish,
      quantity: 12,
    });
  });

  it("harvests a node on a tile DIAGONALLY adjacent to owned land", () => {
    // Scan all owned tiles for any that has an unowned LAND 8-neighbor to host
    // the node (the player owns a cluster, so an interior tile's neighbors may
    // all be owned/water — keep looking until we find a frontier tile).
    let target: TileRef | null = null;
    for (const owned of player.tiles()) {
      game.forEachNeighborWithDiag(owned, (n: TileRef) => {
        if (target === null && game.isLand(n) && game.ownerID(n) === 0) {
          target = n;
        }
      });
      if (target !== null) break;
    }
    expect(target).not.toBeNull();
    game.setResource(target!, ResourceKind.Rock, 20);
    const before = player.rocks();

    new HarvestExecution(player, target!).init(game, 0);

    expect(player.rocks()).toBeGreaterThan(before);
  });

  it("rejects harvest on a tile neither owned nor adjacent to owned land", () => {
    // A far-away tile the player has no claim on.
    const far = game.ref(60, 60);
    expect(game.ownerID(far)).not.toBe(player.smallID());
    game.setResource(far, ResourceKind.Wood, 25);
    const before = player.wood();

    new HarvestExecution(player, far).init(game, 0);

    // Nothing granted, node untouched.
    expect(player.wood()).toBe(before);
    expect(game.resourceAt(far).quantity).toBe(25);
  });

  it("rejects harvest by an animal pack even on its own land", () => {
    const packTile = Array.from(pack.tiles())[0];
    expect(game.ownerID(packTile)).toBe(pack.smallID());
    game.setResource(packTile, ResourceKind.Wood, 25);
    const before = pack.wood();

    new HarvestExecution(pack, packTile).init(game, 0);

    expect(pack.wood()).toBe(before);
    expect(game.resourceAt(packTile).quantity).toBe(25);
  });

  it("rejects harvest on an empty (None) node", () => {
    const tile = Array.from(player.tiles())[0];
    expect(game.resourceAt(tile).kind).toBe(ResourceKind.None);
    const before = player.wood() + player.rocks();

    new HarvestExecution(player, tile).init(game, 0);

    expect(player.wood() + player.rocks()).toBe(before);
  });
});

describe("ResourceTerritoryFlowExecution", () => {
  let game: Game;
  let player: Player;
  let flow: ResourceTerritoryFlowExecution;

  beforeEach(async () => {
    game = await setup("plains", {
      infiniteGold: true,
      instantBuild: true,
      infiniteTroops: true,
    });
    const playerInfo = new PlayerInfo(
      "Forager",
      PlayerType.Human,
      null,
      "Forager",
    );
    game.addPlayer(playerInfo);
    game.addExecution(
      new SpawnExecution("flow_game", playerInfo, game.ref(5, 10)),
    );
    executeTicks(game, 2);
    player = game.player(playerInfo.id);
    player.setAge(Age.Classical);
    flow = new ResourceTerritoryFlowExecution();
    flow.init(game, 0);
  });

  function runFlow(n: number): void {
    flow.tick(n * game.config().resourceTerritoryFlowIntervalTicks());
  }
  // Runs `n` consecutive flows (runFlow runs at most one per call).
  let flowClock = 1000;
  function runFlows(n: number): void {
    for (let i = 0; i < n; i++) {
      flowClock += game.config().resourceTerritoryFlowIntervalTicks();
      flow.tick(flowClock);
    }
  }

  it("shrinks owned forest to a sustainable stand, then trickles resources", () => {
    const tile = Array.from(player.tiles())[0];
    const floor = game.config().forestSustainableQuantity();
    game.setResource(tile, ResourceKind.Wood, floor + 2);
    const before = player.resources();

    runFlow(1);
    expect(game.resourceAt(tile).quantity).toBe(floor + 1);
    expect(player.resources()).toBe(
      before + game.config().forestClearYieldPerFlow(),
    );

    // Draw the stand all the way down to its sustainable floor.
    for (let i = 0; i < 10; i++) runFlow(2 + i);
    expect(game.resourceAt(tile).quantity).toBe(floor);

    const afterDrawdown = player.resources();
    runFlow(50);
    expect(game.resourceAt(tile).quantity).toBe(floor);
    expect(player.resources()).toBe(
      afterDrawdown + game.config().forestTrickleYieldPerFlow(),
    );
  });

  // Owner direction 2026-08-03: nodes last ~5x longer, so the stand is drawn
  // down SLOWLY and only then falls back to a trickle.
  it("primitive forest is drawn down slowly to a small stand, then only trickles", () => {
    player.setAge(Age.Primitive);
    const tile = Array.from(player.tiles())[0];
    const floor = game.config().primitiveForestSustainableQuantity();
    const use = game.config().primitiveForestUsePerFlow();
    game.setResource(tile, ResourceKind.Wood, floor + 5);
    const before = player.resources();

    runFlow(1);
    expect(game.resourceAt(tile).quantity).toBe(floor + 5 - use);
    expect(player.resources()).toBe(
      before + game.config().primitiveForestClearYieldPerFlow(),
    );

    // Draw the stand all the way down to its sustainable floor.
    for (let i = 0; i < 10; i++) runFlow(2 + i);
    expect(game.resourceAt(tile).quantity).toBe(floor);

    const afterDrawdown = player.resources();
    runFlow(50);
    expect(game.resourceAt(tile).quantity).toBe(floor);
    expect(player.resources()).toBe(
      afterDrawdown + game.config().primitiveForestTrickleYieldPerFlow(),
    );
  });

  it("regrows neutral forest and stops feeding the previous owner", () => {
    const tile = Array.from(player.tiles())[0];
    const floor = game.config().forestSustainableQuantity();
    game.setResource(tile, ResourceKind.Wood, floor);
    player.relinquish(tile);
    const before = player.resources();

    runFlow(1);

    expect(game.resourceAt(tile)).toEqual({
      kind: ResourceKind.Wood,
      quantity: floor + game.config().forestRegrowPerFlow(),
    });
    expect(player.resources()).toBe(before);
  });

  it("mines owned rocks down permanently and leaves neutral rocks untouched", () => {
    const tile = Array.from(player.tiles())[0];
    game.setResource(tile, ResourceKind.Rock, 3);
    const before = player.resources();

    runFlow(1);
    expect(game.resourceAt(tile)).toEqual({
      kind: ResourceKind.Rock,
      quantity: 1,
    });
    expect(player.resources()).toBe(
      before + game.config().rockMineYieldPerFlow(),
    );

    runFlow(2);
    expect(game.resourceAt(tile).kind).toBe(ResourceKind.None);

    const neutral = game.ref(60, 60);
    game.setResource(neutral, ResourceKind.Rock, 3);
    const afterMine = player.resources();
    runFlow(3);
    expect(game.resourceAt(neutral)).toEqual({
      kind: ResourceKind.Rock,
      quantity: 3,
    });
    expect(player.resources()).toBe(afterMine);
  });

  // Owner direction 2026-08-03: "nodes should last 5x longer". The Primitive era
  // is meant to be spent ROAMING, so a quarry a tribe wanders onto has to keep
  // paying long enough to be worth the walk. Primitive mining is therefore
  // SLOWER per flow than settled-era mining, not faster: the tribe lacks the
  // tools, and the node endures.
  it("a Stone Age tribe works a quarry out quickly, so staying put stops paying", () => {
    // Marta 2026-10-22: resources under a tribe that sits still must run out
    // early - the tribe is meant to roam to the next one.
    player.setAge(Age.Primitive);
    const tile = Array.from(player.tiles())[0];
    game.setResource(tile, ResourceKind.Rock, 20);
    const before = player.resources();
    const rate = game.config().primitiveRockMineYieldPerFlow();
    expect(rate).toBeGreaterThanOrEqual(
      3 * game.config().rockMineYieldPerFlow(),
    );

    runFlow(1);
    expect(game.resourceAt(tile)).toEqual({
      kind: ResourceKind.Rock,
      quantity: 20 - rate,
    });
    expect(player.resources()).toBe(before + rate);

    runFlows(Math.ceil(20 / rate));
    expect(game.resourceAt(tile).kind).toBe(ResourceKind.None);
  });

  it("a Stone Age wood stand is cleared outright and stops paying", () => {
    player.setAge(Age.Primitive);
    const tile = Array.from(player.tiles())[0];
    game.setResource(tile, ResourceKind.Wood, 12);
    runFlows(Math.ceil(12 / game.config().primitiveForestUsePerFlow()) + 1);
    expect(game.resourceAt(tile).kind).toBe(ResourceKind.None);
    const after = player.resources();
    runFlows(5);
    expect(player.resources()).toBe(after);
  });

  it("primitive tribes gather adjacent river fish and abandoned shoals regrow", () => {
    player.setAge(Age.Primitive);
    let fishTile: TileRef | null = null;
    for (const owned of player.tiles()) {
      game.forEachNeighborWithDiag(owned, (n: TileRef) => {
        if (fishTile === null && game.ownerID(n) === 0) {
          fishTile = n;
        }
      });
      if (fishTile !== null) break;
    }
    expect(fishTile).not.toBeNull();
    game.setWater(fishTile!);
    game.setResource(fishTile!, ResourceKind.Fish, 12);
    const before = player.resources();

    runFlow(1);
    expect(game.resourceAt(fishTile!)).toEqual({
      kind: ResourceKind.Fish,
      quantity: 10,
    });
    expect(player.resources()).toBe(
      before + game.config().primitiveFishClearYieldPerFlow(),
    );

    player.setAge(Age.Classical);
    runFlow(2);
    expect(game.resourceAt(fishTile!)).toEqual({
      kind: ResourceKind.Fish,
      quantity: 10 + game.config().fishRegrowPerFlow(),
    });
  });
});
