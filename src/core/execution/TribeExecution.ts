import {
  Age,
  Execution,
  Game,
  Player,
  Structures,
  UnitType,
} from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { simpleHash } from "../Util";
import { AdvanceAgeExecution } from "./AdvanceAgeExecution";
import { AllianceExtensionExecution } from "./alliance/AllianceExtensionExecution";
import { ConstructionExecution } from "./ConstructionExecution";
import { DeleteUnitExecution } from "./DeleteUnitExecution";
import { RaidExecution } from "./RaidExecution";
import { AiAttackBehavior } from "./utils/AiAttackBehavior";

// Primal-meta: development ARCHETYPES. A monoculture of advance-the-moment-
// you-can bots would falsify the whole stay-primitive-vs-advance meta in every
// lobby, so tribes split three ways (seeded from the player id — identical on
// every lockstep client):
//  - RAIDER  (~30%): never settles a City, never advances — lives off raiding
//    richer/more advanced neighbors (loot + tech + unrest). The "barbarians".
//  - BUILDER (~50%): settles and advances, but only with a savings buffer —
//    it won't beeline the ritual the instant it scrapes the toll together.
//  - BEELINER (~20%): the legacy behavior — advances the moment it can, and
//    is usually the lobby's first Great Work (and first raid target).
type TribeDevArchetype = "raider" | "builder" | "beeliner";

export class TribeExecution implements Execution {
  private active = true;
  private random: PseudoRandom;
  private mg: Game;
  private neighborsTerraNullius = true;

  private attackBehavior: AiAttackBehavior | null = null;
  private attackRate: number;
  private attackTick: number;
  private triggerRatio: number;
  private reserveRatio: number;
  private expandRatio: number;
  private devArchetype: TribeDevArchetype;

  constructor(private tribe: Player) {
    this.random = new PseudoRandom(simpleHash(tribe.id()));
    this.attackRate = this.random.nextInt(40, 80);
    this.attackTick = this.random.nextInt(0, this.attackRate);
    this.triggerRatio = this.random.nextInt(50, 60) / 100;
    this.reserveRatio = this.random.nextInt(30, 40) / 100;
    this.expandRatio = this.random.nextInt(10, 20) / 100;
    const roll = this.random.nextInt(0, 100);
    this.devArchetype =
      roll < 30 ? "raider" : roll < 80 ? "builder" : "beeliner";
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game) {
    this.mg = mg;
  }

  tick(ticks: number) {
    if (ticks % this.attackRate !== this.attackTick) return;

    if (!this.tribe.isAlive()) {
      //removeOnDeath is called from tribe's PlayerExecution
      this.active = false;
      return;
    }

    if (this.attackBehavior === null) {
      this.attackBehavior = new AiAttackBehavior(
        this.random,
        this.mg,
        this.tribe,
        this.triggerRatio,
        this.reserveRatio,
        this.expandRatio,
      );

      // Send an attack on the first tick
      this.attackBehavior.sendAttack(this.mg.terraNullius());
      return;
    }

    this.acceptAllAllianceRequests();
    this.deleteNextStructure();
    this.maybeDevelop();
    this.maybeAttack();
  }

  private acceptAllAllianceRequests() {
    // Module F — no diplomacy with animal tribes: a Primitive-era tribe cannot
    // form, accept, or extend alliances. Reject all incoming requests instead
    // of accepting them, and skip extensions, while still a tribe. Once it
    // advances out of Primitive, normal diplomacy (accept/extend) resumes.
    if (this.tribe.age() === Age.Primitive) {
      for (const req of this.tribe.incomingAllianceRequests()) {
        req.reject();
      }
      return;
    }

    // Accept all alliance requests
    for (const req of this.tribe.incomingAllianceRequests()) {
      req.accept();
    }

    // Accept all alliance extension requests
    for (const alliance of this.tribe.alliances()) {
      // Alliance expiration tracked by Events Panel, only human ally can click Request to Renew
      // Skip if no expiration yet/ ally didn't request extension yet / tribe already agreed to extend
      if (!alliance.onlyOneAgreedToExtend()) continue;

      const human = alliance.other(this.tribe);
      this.mg.addExecution(
        new AllianceExtensionExecution(this.tribe, human.id()),
      );
    }
  }

  private deleteNextStructure() {
    if (!this.tribe.canDeleteUnit()) return;
    for (const unit of this.tribe.units()) {
      if (!Structures.has(unit.type())) continue;
      // Never delete our OWN economy/settlement structures — Huts/Cities anchor
      // land + advance the era, Farms/Outposts are our income. Self-deleting them
      // is what kept tribes frozen. Only shed OTHER captured structures the tribe
      // can't use, keeping it "primitive". See docs/ICE_AGE_ECONOMY.md §A/§B.
      if (
        unit.type() === UnitType.Hut ||
        unit.type() === UnitType.City ||
        unit.type() === UnitType.PrimitiveFarm ||
        unit.type() === UnitType.TradeOutpost
      )
        continue;
      if (unit.isMarkedForDeletion()) continue;
      this.mg.addExecution(new DeleteUnitExecution(this.tribe, unit.id()));
      return;
    }
  }

  // The "develop" behavior (docs/ICE_AGE_ECONOMY.md §B) — the structural un-freeze.
  // A non-pack ("human") tribe banks gold from the internal economy and uses it to
  // settle and advance: build a permanent City (the advance gate), plant a cheap
  // Hut to anchor land while saving, and advance the era the moment it can. Animal
  // packs are nomadic predators — they never settle or tech, so they skip this.
  private maybeDevelop() {
    if (this.tribe.isAnimalPack()) return;

    // A Great Work is already under way — don't queue redundant advance
    // executions (startGreatWork would no-op them anyway).
    if (this.tribe.greatWork() !== null) return;

    // Primal-meta: RAIDERS never settle or advance — they prey on those who
    // do. Their whole develop step is picking a victim.
    if (this.devArchetype === "raider") {
      this.maybeRaid();
      // Raiders still keep a subsistence base going (huts/farms/outposts,
      // never a City) — fall through to the shared economy steps below.
    } else if (this.tribe.canAdvanceAge()) {
      // BEELINER: open the Great Work the moment the criteria are met.
      // BUILDER: only commit once the treasury holds a safety buffer over the
      // toll — a raid-resistant, better-timed (if slower) bid.
      if (this.devArchetype === "beeliner" || this.hasSavingsBuffer()) {
        this.mg.addExecution(new AdvanceAgeExecution(this.tribe));
        return;
      }
    }

    // Settling/developing is a Primitive-era activity (the path out of the era).
    if (this.tribe.age() !== Age.Primitive) return;

    // 1) Build the permanent City the MOMENT we can afford it — it is BOTH the
    //    advance gate AND a settlement, so it always takes priority (prefer it over
    //    a temporary Hut). canBuild gates on affordability, so this only fires once
    //    we can pay the (now reachable) cost. Raiders never settle.
    if (this.devArchetype !== "raider" && this.tryBuild(UnitType.City)) return;

    // 2) Can't afford a City yet — ensure a base: plant a cheap, temporary Hut if
    //    we hold no settlement at all (anchors land + supports economy structures).
    const hasSettlement =
      this.tribe.unitsOwned(UnitType.City) > 0 ||
      this.tribe.unitsOwned(UnitType.Hut) > 0;
    if (!hasSettlement) {
      this.tryBuild(UnitType.Hut);
      return;
    }

    // 3) Have a base, still saving for the (expensive) City — grow income meanwhile
    //    so we reach it faster: one Primitive Farm (passive gold)...
    if (
      this.tribe.unitsOwned(UnitType.PrimitiveFarm) < 1 &&
      this.tryBuild(UnitType.PrimitiveFarm)
    ) {
      return;
    }
    // 4) ...then Trade Outposts (speed the resource→gold economy), capped at 3.
    if (
      this.tribe.unitsOwned(UnitType.TradeOutpost) <
      this.mg.config().tradeOutpostMaxCount()
    ) {
      this.tryBuild(UnitType.TradeOutpost);
    }
  }

  // Primal-meta BUILDER gate: only open the Great Work once the treasury holds
  // 2× the gold toll, so the ritual isn't a scrape-and-pray beeline.
  private hasSavingsBuffer(): boolean {
    const cost = this.mg.config().advanceAgeCost(this.tribe);
    if (cost === null) return false;
    return this.tribe.gold() >= cost.gold * 2n;
  }

  // Primal-meta RAIDER: pick the most ADVANCED (then richest) hostile
  // neighbor and raid them. Deterministic: candidates come from the
  // replicated neighbor set and are sorted by (age, gold, smallID); the only
  // randomness is the seeded cadence gate. RaidExecution itself resolves the
  // success roll from replicated state.
  private maybeRaid() {
    if (!this.random.chance(2)) return; // roughly every other develop tick
    let best: Player | null = null;
    for (const n of this.tribe.nearby()) {
      if (!n.isPlayer()) continue;
      const p = n as Player;
      if (!p.isAlive() || this.tribe.isFriendly(p)) continue;
      if (
        best === null ||
        p.age() > best.age() ||
        (p.age() === best.age() && p.gold() > best.gold()) ||
        (p.age() === best.age() &&
          p.gold() === best.gold() &&
          p.smallID() < best.smallID())
      ) {
        best = p;
      }
    }
    if (best !== null) {
      this.mg.addExecution(new RaidExecution(this.tribe, best.id()));
    }
  }

  // Try to build `type` on one of our owned tiles. Affordability (gold), era
  // (min/maxAge) and placement (spacing) are all validated by canBuild; we just
  // find a tile it accepts. Tile sampling is seeded (this.random) and walks the
  // insertion-ordered owned-tile set, so it is byte-identical on every client.
  private tryBuild(type: UnitType): boolean {
    const tiles = Array.from(this.tribe.tiles());
    if (tiles.length === 0) return false;
    const attempts = Math.min(tiles.length, 8);
    for (let i = 0; i < attempts; i++) {
      const idx = Math.min(
        tiles.length - 1,
        this.random.nextInt(0, tiles.length),
      );
      const tile = tiles[idx];
      if (this.tribe.canBuild(type, tile) !== false) {
        this.mg.addExecution(new ConstructionExecution(this.tribe, type, tile));
        return true;
      }
    }
    return false;
  }

  private maybeAttack() {
    if (this.attackBehavior === null) {
      throw new Error("not initialized");
    }
    const toAttack = this.attackBehavior.getNeighborTraitorToAttack();
    if (toAttack !== null) {
      const odds = this.tribe.isFriendly(toAttack) ? 6 : 3;
      if (this.random.chance(odds)) {
        // Check and break alliance before attacking if needed
        const alliance = this.tribe.allianceWith(toAttack);

        if (alliance !== null) {
          this.tribe.breakAlliance(alliance);
        }

        if (this.attackBehavior.sendAttack(toAttack)) return;
      }
    }

    if (this.neighborsTerraNullius) {
      if (this.tribe.nearby().some((n) => !n.isPlayer())) {
        if (this.attackBehavior.sendAttack(this.mg.terraNullius())) return;
      } else {
        this.neighborsTerraNullius = false;
      }
    }

    this.attackBehavior.attackRandomTarget();
  }

  isActive(): boolean {
    return this.active;
  }
}
