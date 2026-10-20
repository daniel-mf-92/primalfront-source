import { Age, Execution, Game, Player, ResourceKind } from "../game/Game";
import { TileRef } from "../game/GameMap";

// Natural resource flow for territory ownership:
// - Wood is renewable forest cover. Inside borders it is gradually consumed down
//   to a sustainable stand, then keeps yielding a small trickle without shrinking.
//   Neutral forest regrows.
// - Rock is a finite quarry. Inside borders it is slowly mined down and never
//   regenerates.
export class ResourceTerritoryFlowExecution implements Execution {
  private active = true;
  private mg: Game;
  private lastFlow = 0;

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.lastFlow = ticks;
  }

  tick(ticks: number): void {
    const config = this.mg.config();
    if (ticks - this.lastFlow < config.resourceTerritoryFlowIntervalTicks()) {
      return;
    }
    this.lastFlow = ticks;

    this.mg.forEachTile((tile: TileRef) => {
      const node = this.mg.resourceAt(tile);
      if (node.kind === ResourceKind.None || node.quantity <= 0) {
        return;
      }

      const owner = this.mg.owner(tile);
      if (node.kind === ResourceKind.Wood) {
        if (owner.isPlayer()) {
          this.flowForest(owner, tile, node.quantity);
        } else {
          this.regrowForest(tile, node.quantity);
        }
        return;
      }

      if (node.kind === ResourceKind.Rock && owner.isPlayer()) {
        this.mineRock(owner, tile, node.quantity);
        return;
      }

      if (node.kind === ResourceKind.Fish) {
        this.flowFish(tile, node.quantity);
      }
    });
  }

  isActive(): boolean {
    return this.active;
  }

  private flowForest(player: Player, tile: TileRef, quantity: number): void {
    if (player.isAnimalPack()) {
      return;
    }
    const config = this.mg.config();
    const primitive = player.age() === Age.Primitive;
    const floor = primitive
      ? config.primitiveForestSustainableQuantity()
      : config.forestSustainableQuantity();
    if (quantity > floor) {
      const use = primitive
        ? config.primitiveForestUsePerFlow()
        : config.forestUsePerFlow();
      const newQuantity = Math.max(floor, quantity - use);
      this.mg.setResource(tile, ResourceKind.Wood, newQuantity);
      player.addResource(
        ResourceKind.Wood,
        primitive
          ? config.primitiveForestClearYieldPerFlow()
          : config.forestClearYieldPerFlow(),
      );
      return;
    }
    player.addResource(
      ResourceKind.Wood,
      primitive
        ? config.primitiveForestTrickleYieldPerFlow()
        : config.forestTrickleYieldPerFlow(),
    );
  }

  private regrowForest(tile: TileRef, quantity: number): void {
    const config = this.mg.config();
    const max = config.forestMaxQuantity();
    if (quantity >= max) {
      return;
    }
    this.mg.setResource(
      tile,
      ResourceKind.Wood,
      Math.min(max, quantity + config.forestRegrowPerFlow()),
    );
  }

  private mineRock(player: Player, tile: TileRef, quantity: number): void {
    if (player.isAnimalPack()) {
      return;
    }
    const config = this.mg.config();
    const mined = Math.min(
      quantity,
      player.age() === Age.Primitive
        ? config.primitiveRockMineYieldPerFlow()
        : config.rockMineYieldPerFlow(),
    );
    if (mined <= 0) {
      return;
    }
    const remaining = quantity - mined;
    this.mg.setResource(
      tile,
      remaining === 0 ? ResourceKind.None : ResourceKind.Rock,
      remaining,
    );
    player.addResource(ResourceKind.Rock, mined);
  }

  private flowFish(tile: TileRef, quantity: number): void {
    const config = this.mg.config();
    const player = this.adjacentPrimitiveForager(tile);
    if (player === null) {
      const max = config.fishMaxQuantity();
      if (quantity < max) {
        this.mg.setResource(
          tile,
          ResourceKind.Fish,
          Math.min(max, quantity + config.fishRegrowPerFlow()),
        );
      }
      return;
    }

    const floor = config.primitiveFishSustainableQuantity();
    if (quantity > floor) {
      const newQuantity = Math.max(
        floor,
        quantity - config.primitiveFishUsePerFlow(),
      );
      this.mg.setResource(tile, ResourceKind.Fish, newQuantity);
      player.addResource(
        ResourceKind.Fish,
        config.primitiveFishClearYieldPerFlow(),
      );
      return;
    }
    player.addResource(
      ResourceKind.Fish,
      config.primitiveFishTrickleYieldPerFlow(),
    );
  }

  private adjacentPrimitiveForager(tile: TileRef): Player | null {
    let player: Player | null = null;
    this.mg.forEachNeighborWithDiag(tile, (n: TileRef) => {
      if (player !== null) return;
      const owner = this.mg.owner(n);
      if (
        owner.isPlayer() &&
        !owner.isAnimalPack() &&
        owner.age() === Age.Primitive
      ) {
        player = owner;
      }
    });
    return player;
  }
}
