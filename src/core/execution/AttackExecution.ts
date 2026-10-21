import { renderTroops } from "../../client/Utils";
import {
  Age,
  Attack,
  Difficulty,
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
  PlayerType,
  ResourceKind,
  TerrainType,
  TerraNullius,
} from "../game/Game";
import { GameMap, TileRef } from "../game/GameMap";
import { PseudoRandom } from "../PseudoRandom";
import { ATTACK_INDEX_SENT } from "../StatsSchemas";
import { assertNever } from "../Util";
import { FlatBinaryHeap } from "./utils/FlatBinaryHeap"; // adjust path if needed

const malusForRetreat = 25;

export class AttackExecution implements Execution {
  private active: boolean = true;
  private toConquer = new FlatBinaryHeap();

  private random = new PseudoRandom(123);

  private target: Player | TerraNullius;

  private mg: Game;
  // Direct GameMap reference to skip the Game delegation hop in hot loops.
  private map: GameMap;

  private attack: Attack | null = null;

  // Cached smallIDs for integer owner comparisons in hot loops.
  private ownerSmallID: number;
  private targetSmallID: number;
  // Reusable neighbor buffers to avoid closures/allocation in hot loops.
  private nbuf: TileRef[] = [0, 0, 0, 0];
  private nbuf2: TileRef[] = [0, 0, 0, 0];

  constructor(
    private startTroops: number | null = null,
    private _owner: Player,
    private _targetID: PlayerID | null,
    private sourceTile: TileRef | null = null,
    private removeTroops: boolean = true,
    // Nomadic direction (Marta 2026-10-21): the land tile the player clicked.
    // Tiles nearer to it are taken first, so the front grows toward the click
    // and the attrition behind sheds the far side - a tribe that WALKS where
    // you point instead of swelling evenly. Null = classic even expansion.
    private focusTile: TileRef | null = null,
  ) {}

  public targetID(): PlayerID | null {
    return this._targetID;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number) {
    if (!this.active) {
      return;
    }
    this.mg = mg;
    this.map = mg.map();

    if (this._targetID !== null && !mg.hasPlayer(this._targetID)) {
      console.warn(`target ${this._targetID} not found`);
      this.active = false;
      return;
    }

    this.target =
      this._targetID === this.mg.terraNullius().id()
        ? mg.terraNullius()
        : mg.player(this._targetID);
    this.ownerSmallID = this._owner.smallID();
    this.targetSmallID = this.target.smallID();

    if (this._owner === this.target) {
      console.error(`Player ${this._owner} cannot attack itself`);
      this.active = false;
      return;
    }

    // ALLIANCE CHECK — block attacks on friendly (ally or same team)
    if (this.target.isPlayer()) {
      const targetPlayer = this.target as Player;
      if (this._owner.isFriendly(targetPlayer)) {
        console.warn(
          `${this._owner.displayName()} cannot attack ${targetPlayer.displayName()} because they are friendly (allied or same team)`,
        );
        this.active = false;
        return;
      }
    }

    if (this.target && this.target.isPlayer()) {
      const targetPlayer = this.target as Player;
      if (
        targetPlayer.type() !== PlayerType.Bot &&
        this._owner.type() !== PlayerType.Bot
      ) {
        // Don't let bots embargo since they can't trade anyway.
        targetPlayer.addEmbargo(this._owner, true);
        this.rejectIncomingAllianceRequests(targetPlayer);
      }
    }

    if (this.target.isPlayer() && !this._owner.canAttackPlayer(this.target)) {
      this.active = false;
      return;
    }

    this.startTroops ??= this.mg
      .config()
      .attackAmount(this._owner, this.target);
    if (this.removeTroops) {
      this.startTroops = Math.min(this._owner.troops(), this.startTroops);
      this._owner.removeTroops(this.startTroops);
    }
    this.attack = this._owner.createAttack(
      this.target,
      this.startTroops,
      this.sourceTile,
      new Set<TileRef>(),
    );

    // All ages expand as a contiguous front/glob. Primitive territory is reined
    // in afterward by the settlement-anchored rewild (PlayerExecution), not by a
    // special claim shape here.
    if (this.sourceTile !== null) {
      this.addNeighbors(this.sourceTile);
    } else {
      this.refreshToConquer();
    }

    // Record stats
    this.mg.stats().attack(this._owner, this.target, this.startTroops);

    for (const incoming of this._owner.incomingAttacks()) {
      if (incoming.attacker() === this.target) {
        // Target has opposing attack, cancel them out
        if (incoming.troops() > this.attack.troops()) {
          incoming.setTroops(incoming.troops() - this.attack.troops());
          this.attack.delete();
          this.active = false;
          return;
        } else {
          this.attack.setTroops(this.attack.troops() - incoming.troops());
          incoming.delete();
        }
      }
    }
    for (const outgoing of this._owner.outgoingAttacks()) {
      if (
        outgoing !== this.attack &&
        outgoing.target() === this.attack.target() &&
        // Boat attacks (sourceTile is not null) are not combined with other attacks
        this.attack.sourceTile() === null
      ) {
        this.attack.setTroops(this.attack.troops() + outgoing.troops());
        outgoing.delete();
      }
    }

    if (this.target.isPlayer()) {
      const difficulty = this.mg.config().gameConfig().difficulty;
      let relationChange: number;
      switch (difficulty) {
        case Difficulty.Easy:
          relationChange = -60;
          break;
        case Difficulty.Medium:
          relationChange = -70;
          break;
        case Difficulty.Hard:
          relationChange = -80;
          break;
        case Difficulty.Impossible:
          relationChange = -100;
          break;
        default:
          assertNever(difficulty);
      }
      this.target.updateRelation(this._owner, relationChange);
    }
  }

  private refreshToConquer() {
    if (this.attack === null) {
      throw new Error("Attack not initialized");
    }

    this.toConquer.clear();
    this.attack.clearBorder();
    for (const tile of this._owner.borderTiles()) {
      this.addNeighbors(tile);
    }
  }

  private retreat(malusPercent = 0) {
    if (this.attack === null) {
      throw new Error("Attack not initialized");
    }

    const deaths = this.attack.troops() * (malusPercent / 100);
    if (deaths) {
      this.mg.displayMessage(
        "events_display.attack_cancelled_retreat",
        MessageType.ATTACK_CANCELLED,
        this._owner.id(),
        undefined,
        { troops: renderTroops(deaths) },
      );
    }
    if (this.removeTroops === false && this.sourceTile === null) {
      // startTroops are always added to attack troops at init but not always removed from owner troops
      // subtract startTroops from attack troops so we don't give back startTroops to owner that were never removed
      // boat attacks (sourceTile !== null) are the exception: troops were removed at departure and must be returned after attack still
      this.attack.setTroops(this.attack.troops() - (this.startTroops ?? 0));
    }

    const survivors = this.attack.troops() - deaths;
    this._owner.addTroops(survivors);
    this.attack.delete();
    this.active = false;

    // Not all retreats are canceled attacks
    if (this.attack.retreated()) {
      // Record stats
      this.mg.stats().attackCancel(this._owner, this.target, survivors);
    }
  }

  tick(ticks: number) {
    if (this.attack === null) {
      throw new Error("Attack not initialized");
    }
    let troopCount = this.attack.troops(); // cache troop count
    const targetIsPlayer = this.target.isPlayer(); // cache target type
    const targetPlayer = targetIsPlayer ? (this.target as Player) : null; // cache target player

    if (this.attack.retreated()) {
      if (targetIsPlayer) {
        this.retreat(malusForRetreat);
      } else {
        this.retreat();
      }
      this.active = false;
      return;
    }

    if (this.attack.retreating()) {
      return;
    }

    if (!this.attack.isActive()) {
      this.active = false;
      return;
    }

    if (targetPlayer && this._owner.isFriendly(targetPlayer)) {
      // In this case a new alliance was created AFTER the attack started.
      this.retreat();
      return;
    }
    // Nomadic attrition: a roaming-age tribe stops claiming wilderness once it
    // holds nomadOvershootMult x its carrying capacity. The troops come home
    // and the back of the band goes wild (PlayerExecution's shed), so the
    // tribe walks where it was pointed instead of swelling. Pure function of
    // replicated state - lockstep-safe.
    if (!targetIsPlayer) {
      const cfg = this.mg.config();
      const age = this._owner.age();
      if (cfg.rewildEnabled(age)) {
        const cap =
          cfg.carryingCapacityTiles(this._owner) *
          cfg.landCapacityMult(age) *
          cfg.climateLandScale(this.mg);
        if (this._owner.numTilesOwned() >= cap * cfg.nomadOvershootMult()) {
          this.retreat();
          return;
        }
      }
    }

    const numTilesPerTick = this.mg
      .config()
      .attackTilesPerTick(
        troopCount,
        this._owner,
        this.target,
        this.attack.borderSize() + this.random.nextInt(0, 5),
      );

    let tilesBudget = numTilesPerTick;
    while (tilesBudget > 0) {
      if (troopCount < 1) {
        this.attack.delete();
        this.active = false;
        return;
      }

      if (this.toConquer.size() === 0) {
        this.refreshToConquer();
        this.retreat();
        return;
      }

      const tileToConquer = this.toConquer.dequeue();
      this.attack.removeBorderTile(tileToConquer);

      let onBorder = false;
      const numNeighbors = this.map.neighbors4(tileToConquer, this.nbuf);
      for (let i = 0; i < numNeighbors; i++) {
        if (this.map.ownerID(this.nbuf[i]) === this.ownerSmallID) {
          onBorder = true;
          break;
        }
      }
      if (this.map.ownerID(tileToConquer) !== this.targetSmallID || !onBorder) {
        continue;
      }
      if (!this.map.isLand(tileToConquer)) {
        continue;
      }
      // Module §7 — a PRIMITIVE tribe's CORE resists capture: once it is small
      // (≤ primitiveExterminationFloorTiles), its tiles cannot be taken unless
      // the attacker still holds overwhelming force (primitiveExterminationRatio×
      // its strength). A marginal attack stalls at the core and the tribe
      // survives + drifts; only an overwhelming strike breaks through, which then
      // reaches handleDeadDefender → conquerPlayer → the slaves/sacrifice payoff.
      // This is what makes extermination "very intensive to achieve".
      // Deterministic; disconnected/pack defenders are unaffected (own paths).
      if (
        targetPlayer !== null &&
        targetPlayer.age() === Age.Primitive &&
        !targetPlayer.isAnimalPack() &&
        !targetPlayer.isDisconnected() &&
        targetPlayer.numTilesOwned() <=
          this.mg.config().primitiveExterminationFloorTiles() &&
        troopCount <
          this.mg.config().primitiveExterminationRatio(targetPlayer) *
            Math.max(1, targetPlayer.troops())
      ) {
        continue; // core holds — not enough force to exterminate this tribe
      }
      this.addNeighbors(tileToConquer);
      const { attackerTroopLoss, defenderTroopLoss, tilesPerTickUsed } = this.mg
        .config()
        .attackLogic(
          this.mg,
          troopCount,
          this._owner,
          this.target,
          tileToConquer,
        );
      tilesBudget -= tilesPerTickUsed;
      troopCount -= attackerTroopLoss;
      // Woodland harvest (PRIMITIVE only): a tribe clearing forest/jungle pays
      // extra population but gathers wood (the canoe resource). Civilized ages
      // don't gather wood (they have no use for it) and pay no woodland penalty.
      // Deterministic — pure function of the tile's latitude-derived biome.
      // AI-NOTE: the `age === Primitive` gate is load-bearing — dropping it
      // applies the woodland troop tax to EVERY era, shrinking all forest/jungle
      // conquest. | evidence: tests/Attack.test.ts (Modern defender expansion)
      if (
        this._owner.age() === Age.Primitive &&
        this.mg.isWoodland(tileToConquer)
      ) {
        troopCount = Math.max(
          0,
          troopCount - this.mg.config().woodlandCaptureTroopCost(),
        );
        // Primal-meta: the TWILIGHT OF THE WILD — once the ice has receded,
        // woodland yields thin out (primitiveTwilightMult 1 → floor), so the
        // primitive lifestyle is strong early and decays late. Integer floor
        // keeps the wood pile lockstep-exact.
        this._owner.addWood(
          Math.floor(
            this.mg.config().woodPerWoodlandTile() *
              this.mg.config().primitiveTwilightMult(this.mg),
          ),
        );
      }
      this.attack.setTroops(troopCount);
      if (targetPlayer) {
        targetPlayer.removeTroops(defenderTroopLoss);
      }
      this._owner.conquer(tileToConquer);
      // Overextension (Module C): each captured tile adds integration debt and is
      // recorded for deterministic frontier-revolt ordering. Conquest must be
      // expensive to KEEP, not just to take.
      this._owner.addIntegrationDebt(
        this.mg.config().integrationDebtPerCapture(this._owner),
      );
      this._owner.recordCapture(tileToConquer);
      // Capture-grace: land taken FROM a player is spared by the rewild /
      // carrying-cap shedders for captureGraceTicks, so conquest relocates the
      // blob toward the front instead of evaporating the same second.
      if (targetPlayer !== null) {
        this._owner.markCaptureTick(tileToConquer, this.mg.ticks());
      }
      // Incremental Primitive conquest payoff: each tile raided off a living
      // tribe (Bot, non-pack) yields captives immediately — attacks pay as you
      // fight, not only on a full extermination (packs pay in MEAT instead,
      // see handleDeadDefender). Fractional slaves ride the float pile;
      // consumers floor at source.
      if (
        this._owner.age() === Age.Primitive &&
        targetPlayer !== null &&
        targetPlayer.type() === PlayerType.Bot &&
        targetPlayer.age() === Age.Primitive &&
        !targetPlayer.isAnimalPack()
      ) {
        this._owner.addSlaves(this.mg.config().primitiveTileCaptureSlaves());
      }
      this.handleDeadDefender();
    }
  }

  private rejectIncomingAllianceRequests(target: Player) {
    const request = this._owner
      .incomingAllianceRequests()
      .find((ar) => ar.requestor() === target);
    if (request !== undefined) {
      request.reject();
    }
  }

  private addNeighbors(tile: TileRef) {
    if (this.attack === null) {
      throw new Error("Attack not initialized");
    }

    const tickNow = this.mg.ticks(); // cache tick

    const numNeighbors = this.map.neighbors4(tile, this.nbuf);
    for (let i = 0; i < numNeighbors; i++) {
      const neighbor = this.nbuf[i];
      if (
        this.map.isWater(neighbor) ||
        this.map.ownerID(neighbor) !== this.targetSmallID
      ) {
        continue;
      }

      this.attack.addBorderTile(neighbor);
      let numOwnedByMe = 0;
      const numInner = this.map.neighbors4(neighbor, this.nbuf2);
      for (let j = 0; j < numInner; j++) {
        if (this.map.ownerID(this.nbuf2[j]) === this.ownerSmallID) {
          numOwnedByMe++;
        }
      }

      let mag: number;
      switch (this.map.terrainType(neighbor)) {
        case TerrainType.Plains:
          mag = 1;
          break;
        case TerrainType.Highland:
          mag = 1.5;
          break;
        case TerrainType.Mountain:
          mag = 2;
          break;
        default:
          mag = 0;
          break;
      }

      let priority =
        (this.random.nextInt(0, 7) + 10) * (1 - numOwnedByMe * 0.5 + mag / 2) +
        tickNow;
      if (this.focusTile !== null) {
        // Directed expansion: each tile of distance from the clicked tile costs
        // attackFocusWeight() of priority (same unit as the tick term), capped
        // so a far click does not freeze the near front.
        priority +=
          Math.min(
            this.mg.config().attackFocusMaxDist(),
            this.mg.manhattanDist(neighbor, this.focusTile),
          ) * this.mg.config().attackFocusWeight();
      }

      this.toConquer.enqueue(neighbor, priority);
    }
  }

  private handleDeadDefender() {
    if (!(this.target.isPlayer() && this.target.numTilesOwned() < 100)) return;
    const target: Player = this.target;

    // Module §2 — an ANIMAL PACK "can be attacked but only INVADED if super-
    // aggressively attacked." A normal-strength attack just bloodies/pushes the
    // pack (the per-tile attrition loop above already chips its tiles, and its
    // nomadic drift moves it); only a strike whose committed troops are at least
    // animalPackConquerRatio× the pack's defensive strength actually conquers/
    // eliminates it. EITHER way the attacker harvests MEAT from the pack.
    // Deterministic: integer/bigint-safe, no RNG, no float-cast of a bigint.
    if (target.isAnimalPack()) {
      const packStrength = Math.max(1, target.troops());
      const committed = this.attack !== null ? this.attack.troops() : 0;
      // Module §7 — a Neanderthal attacker (apex hunter) needs to commit far
      // less to fully take a pack than a generic attacker does.
      const ratio = this._owner.isNeanderthal()
        ? this.mg.config().neanderthalPackConquerRatio()
        : this.mg.config().animalPackConquerRatio();
      // Meat yield from striking the pack, scaled off its current size.
      const meat = Math.max(1, Math.floor(target.numTilesOwned() * 0.25) + 3);
      this._owner.addResource(ResourceKind.Meat, meat);
      if (committed < ratio * packStrength) {
        // Not super-aggressive enough — push/damage only, no conquest. The pack
        // survives and drifts away; do NOT call conquerPlayer / capture tiles.
        return;
      }
      // Super-aggressive: fall through and fully conquer/eliminate the pack
      // (plunder + conquerPlayer below), harvesting its remaining tiles.
    }

    // Module §7 — a PRIMITIVE (non-pack) tribe is VERY HARD to EXTERMINATE.
    // Like an animal pack, a normal-strength attack only bloodies/pushes it
    // (per-tile attrition + nomadic drift do the rest); only a strike committing
    // at least primitiveExterminationRatio× the defender's strength actually
    // wipes it out. Era-scoped: outside Primitive, conquest resolves normally.
    // Deterministic, no RNG.
    // Disconnected (AFK) tribes are exempt — you shouldn't need overwhelming
    // force to mop up an inactive player (and same-team disconnected takeover is
    // its own mechanic). The hardness applies to ACTIVE Primitive tribes.
    const defenderPrimitiveTribe =
      target.age() === Age.Primitive &&
      !target.isAnimalPack() &&
      !target.isDisconnected();
    if (defenderPrimitiveTribe) {
      const strength = Math.max(1, target.troops());
      const committed = this.attack !== null ? this.attack.troops() : 0;
      if (
        committed <
        this.mg.config().primitiveExterminationRatio(target) * strength
      ) {
        return; // not overwhelming enough — no extermination this tick
      }
    }

    // Plunder: the finishing attacker seizes a fraction of the victim's banked
    // gold (+ a share of troops) before conquerPlayer drains the rest. Mirrors
    // the boat-captured-trade value-transfer-on-capture precedent. Deterministic:
    // fraction is a fixed config constant, bigint gold via integer basis points.
    // The gold seizure respects the same "must have played" gate as
    // conquerPlayer (a human who never attacked yields no gold) and is recorded
    // as war gold so the StatsImpl war-gold ledger stays consistent.
    // Captured before plunder so admixture (below) reflects the Neanderthal
    // population at the moment of absorption.
    const targetTroopsBefore = target.troops();
    const targetStats = this.mg.stats().getPlayerStats(target);
    const attacksSent = targetStats?.attacks?.[ATTACK_INDEX_SENT] ?? 0n;
    // Module §7 — NO conventional conquest-for-gold in the Primitive era. A
    // Primitive attacker seizes no banked gold (the only conquest payoff there
    // is slaves/sacrifice, granted below). Later ages plunder gold normally.
    const attackerPrimitive = this._owner.age() === Age.Primitive;
    const skipGoldPlunder =
      attackerPrimitive ||
      (attacksSent === 0n && target.type() === PlayerType.Human);
    const fraction = this.mg.config().plunderFraction();
    const plunderBps = BigInt(Math.round(fraction * 10000));
    const goldPlunder = skipGoldPlunder
      ? 0n
      : (target.gold() * plunderBps) / 10000n;
    if (goldPlunder > 0n) {
      const seized = target.removeGold(goldPlunder);
      this._owner.addGold(seized);
      this.mg.stats().goldWar(this._owner, target, seized);
    }
    const troopPlunder = Math.floor(target.troops() * fraction);
    if (troopPlunder > 0) {
      this._owner.addTroops(target.removeTroops(troopPlunder));
    }

    // Module §7 — ADMIXTURE. When a NON-Neanderthal victor absorbs a Neanderthal
    // tribe, there is a chance the conquest becomes interbreeding: the victor
    // gains a population windfall (bonus troops) on top of the normal plunder,
    // scaled off the Neanderthal's pre-plunder population. Deterministic roll
    // from replicated state (tick + smallIDs) so every client agrees. On
    // re-entry after conquerPlayer the pre-plunder troop count is ~0, so the
    // windfall is a no-op — it fires once, on the real elimination.
    if (target.isNeanderthal() && !this._owner.isNeanderthal()) {
      const cfg = this.mg.config();
      const admixtureRng = new PseudoRandom(
        this.mg.ticks() + this._owner.smallID() + target.smallID(),
      );
      if (admixtureRng.nextFloat(0, 1) < cfg.admixtureConquerChance()) {
        const gain = Math.floor(
          targetTroopsBefore * cfg.admixtureConquerTroopFraction(),
        );
        if (gain > 0) {
          this._owner.addTroops(gain);
        }
      }
    }

    // Module §7 — SLAVES/SACRIFICE: the sole conquest payoff in the Primitive
    // era (no gold was plundered above). Granted to a Primitive attacker on a
    // successful extermination, scaled off the victim's pre-plunder size; these
    // convert slowly to gold in PlayerExecution (the costly, indirect route to
    // the wealth needed to leave Primitive). Neanderthals can take slaves but
    // their addGold no-op voids the eventual conversion (they "never any money").
    if (attackerPrimitive) {
      const slaves = this.mg
        .config()
        .slavesPerExtermination(targetTroopsBefore, target.numTilesOwned());
      if (slaves > 0) {
        this._owner.addSlaves(slaves);
      }
    }

    this.mg.conquerPlayer(this._owner, target);

    for (let i = 0; i < 10; i++) {
      for (const tile of target.tiles()) {
        let borders = false;
        this.mg.forEachNeighbor(tile, (t) => {
          if (!borders && this.mg.owner(t) === this._owner) {
            borders = true;
          }
        });
        if (borders) {
          this._owner.conquer(tile);
        } else {
          let captured = false;
          this.mg.forEachNeighbor(tile, (neighbor) => {
            if (captured) return;
            const no = this.mg.owner(neighbor);
            if (no.isPlayer() && no !== target && !no.isFriendly(target)) {
              this.mg.player(no.id()).conquer(tile);
              captured = true;
            }
          });
        }
      }
    }
  }

  owner(): Player {
    return this._owner;
  }

  isActive(): boolean {
    return this.active;
  }
}
