import {
  Age,
  Execution,
  Game,
  MessageType,
  Player,
  PlayerID,
  ResourceKind,
  UnitType,
} from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";

// Module §6 — RAID: extract wealth from an enemy WITHOUT taking land. Resolved
// ONCE in init() (single-shot, like AdvanceAge/DonateGold). Deterministic in the
// lockstep sim: the success roll is seeded from replicated state
// (tick + attacker.smallID + defender.smallID) and all gold/loot math is bigint
// in integer basis points — never a float-cast bigint, never Math.random.
//
// Outcome:
//  - power(p) = numTilesOwned(p)
//             + raidTroopWeight·troops(p)
//             + raidDevWeight·(unitsOwned(City)·raidCityDev + age(p)·raidAgeDev)
//  - P(success) = clamp(powerAtt/(powerAtt+powerDef), raidSuccessMin, raidSuccessMax)
//  - success ⇔ rng.nextFloat(0,1) < P
//  - on success: transfer raidLootFraction·defender.gold() (basis points) +
//    steal a sliver of troops; if the defender isAnimalPack, ALSO grant MEAT.
//  - on failure: a small attacker troop loss (the raiding party is bloodied).
// NEVER conquerPlayer, NEVER capture a tile.
export class RaidExecution implements Execution {
  private active = true;
  private mg: Game;

  constructor(
    private attacker: Player,
    private targetID: PlayerID,
  ) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  // Raid power of a player (the size/dev ratio computed INLINE — never the stale
  // 20-tick threatScore()).
  private power(p: Player): number {
    const config = this.mg.config();
    const dev =
      p.unitsOwned(UnitType.City) * config.raidCityDev() +
      p.age() * config.raidAgeDev();
    return (
      p.numTilesOwned() +
      config.raidTroopWeight() * p.troops() +
      config.raidDevWeight() * dev
    );
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;

    if (!mg.hasPlayer(this.targetID)) {
      console.warn(`RaidExecution target ${this.targetID} not found`);
      this.active = false;
      return;
    }
    const defender = mg.player(this.targetID);
    if (defender === this.attacker) {
      console.warn(`RaidExecution: ${this.attacker.name()} cannot raid itself`);
      this.active = false;
      return;
    }
    // Cannot raid a friendly (ally / same team) — mirrors the attack guard.
    if (this.attacker.isFriendly(defender)) {
      this.active = false;
      return;
    }

    const config = mg.config();
    const powerAtt = this.power(this.attacker);
    const powerDef = this.power(defender);
    const denom = powerAtt + powerDef;
    // Degenerate (both zero) ⇒ even odds; clamp keeps it inside [min, max].
    const raw = denom > 0 ? powerAtt / denom : 0.5;
    const p = Math.min(
      config.raidSuccessMax(),
      Math.max(config.raidSuccessMin(), raw),
    );

    // Deterministic single roll from replicated state. smallIDs + tick are
    // identical on every client, so every client resolves the SAME outcome.
    const rng = new PseudoRandom(
      mg.ticks() + this.attacker.smallID() + defender.smallID(),
    );
    const success = rng.nextFloat(0, 1) < p;

    if (success) {
      this.resolveSuccess(defender);
    } else {
      this.resolveFailure();
    }
    this.active = false;
  }

  private resolveSuccess(defender: Player): void {
    const config = this.mg.config();
    // Loot a fraction of the defender's banked gold, in INTEGER basis points
    // (mirror plunder math in AttackExecution.handleDeadDefender). removeGold
    // returns what was actually seized (clamped to the defender's balance), so
    // the transfer is conserved even if the balance shifted.
    const lootBps = BigInt(Math.round(config.raidLootFraction() * 10000));
    const lootTarget = (defender.gold() * lootBps) / 10000n;
    if (lootTarget > 0n) {
      const seized = defender.removeGold(lootTarget);
      this.attacker.addGold(seized);
      this.mg.stats().goldWar(this.attacker, defender, seized);
    }

    // Steal a small sliver of troops — half the loot fraction, deterministic
    // floor (no RNG, no float-cast of a bigint).
    const troopBps = config.raidLootFraction() * 0.5;
    const troopSteal = Math.floor(defender.troops() * troopBps);
    if (troopSteal > 0) {
      this.attacker.addTroops(defender.removeTroops(troopSteal));
    }

    // Raiding an animal pack yields MEAT into the general resource pile (Module
    // §2/§4). Scaled off the pack's size so a fat pack is a richer kill.
    if (defender.isAnimalPack()) {
      const meat = Math.max(1, Math.floor(defender.numTilesOwned() * 0.5) + 5);
      this.attacker.addResource(ResourceKind.Meat, meat);
    }

    // Primal-meta (docs/PRIMAL_META.md §D) — raiding a MORE ADVANCED victim is
    // how the primal world fights back. All deterministic integer math.
    if (defender.age() > this.attacker.age()) {
      // 1) LEARN: loot a fraction of the victim's tech points (transfer is
      //    conserved via removeTechPoints clamping, mirroring the gold path).
      const techSteal = Math.floor(
        defender.techPoints() * config.raidTechLootFraction(),
      );
      if (techSteal > 0) {
        this.attacker.addTechPoints(defender.removeTechPoints(techSteal));
      }
      // 2) INCITE: a PRIMITIVE raider spreads unrest through the civilized
      //    victim's ungoverned margins — integration debt pushes them toward
      //    the overextension penalties / secession machinery that already
      //    exists for Classical realms.
      if (this.attacker.age() === Age.Primitive) {
        const debt = config.raidUnrestDebt(defender);
        if (debt > 0) {
          defender.addIntegrationDebt(debt);
        }
      }
    }

    // 3) SABOTAGE: a successful raid sets back the victim's Great Work (the
    //    public era-advance ritual) — raiding is the counterplay to a rival's
    //    bid for the next age.
    if (defender.setbackGreatWork(config.greatWorkRaidSetbackTicks())) {
      this.mg.displayMessage(
        "events_display.great_work_setback_suffered",
        MessageType.GREAT_WORK_SETBACK,
        defender.id(),
        undefined,
        { name: this.attacker.displayName() },
      );
      this.mg.displayMessage(
        "events_display.great_work_setback_dealt",
        MessageType.GREAT_WORK_SETBACK,
        this.attacker.id(),
        undefined,
        { name: defender.displayName() },
      );
    }

    // Module §7 — ADMIXTURE on a raid. When a NON-Neanderthal raids a
    // Neanderthal tribe, there is a chance the raid becomes interbreeding: the
    // raider gains a population windfall (bonus troops) on top of the troop
    // steal. Deterministic roll seeded from replicated state, offset by +7 from
    // the success-roll seed so the two rolls are independent.
    if (defender.isNeanderthal() && !this.attacker.isNeanderthal()) {
      const admixtureRng = new PseudoRandom(
        this.mg.ticks() + this.attacker.smallID() + defender.smallID() + 7,
      );
      if (admixtureRng.nextFloat(0, 1) < config.admixtureRaidChance()) {
        const gain = Math.floor(
          defender.troops() * config.admixtureRaidTroopFraction(),
        );
        if (gain > 0) {
          this.attacker.addTroops(gain);
        }
      }
    }
  }

  private resolveFailure(): void {
    // The raiding party is bloodied — a small flat troop loss. Deterministic,
    // no RNG (the only roll was the success check).
    const loss = Math.floor(this.attacker.troops() * 0.02);
    if (loss > 0) {
      this.attacker.removeTroops(loss);
    }
  }

  tick(ticks: number): void {}

  isActive(): boolean {
    return this.active;
  }
}
