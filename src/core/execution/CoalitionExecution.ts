import { Execution, Game, Player, PlayerID } from "../game/Game";

// Module E — Coalition-against-the-leader (social anti-snowball).
//
// Any player may form/join a time-boxed coalition targeting the CURRENT
// high-threat leader. While the pact stands, members get a modest, capped
// deterministic buff (income + combat, see Config.coalition*Bonus) and a mutual
// non-aggression lock with one another (PlayerImpl.canAttackPlayer). The pact:
//   - is only legitimate vs a genuine high-threat leader (threatScore at/above
//     config.coalitionThreatThreshold() AND the actual top-threat player),
//   - auto-expires after config.coalitionDuration() ticks, and
//   - dissolves the instant the target stops being the threat leader (or dies).
//
// Determinism: no RNG, no wall-clock. Validity is recomputed each tick from
// serialized threatScore + tile ownership; the threat-leader tiebreak is the
// lowest smallID. This execution OWNS the requestor's membership state and is
// the only thing that sets/clears it, so the cheap `inActiveCoalition()` /
// `isCoalitionPartner()` checks read by Config/PlayerImpl stay trustworthy.
export class CoalitionExecution implements Execution {
  private active = true;
  private mg: Game;
  private requestor: Player;
  private endTick = 0;

  constructor(
    requestor: Player,
    private targetID: PlayerID,
  ) {
    this.requestor = requestor;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;

    if (!mg.hasPlayer(this.targetID)) {
      this.active = false;
      return;
    }
    const target = mg.player(this.targetID);

    // Can't coalition against yourself, a dead target, or an illegitimate
    // (not-genuinely-dominant) target.
    if (
      target === this.requestor ||
      !this.requestor.isAlive() ||
      !this.isLegitimateTarget(target)
    ) {
      this.active = false;
      return;
    }

    this.endTick = ticks + mg.config().coalitionDuration();
    this.requestor.joinCoalition(this.targetID, this.endTick);
  }

  tick(ticks: number): void {
    if (!this.active) {
      return;
    }

    const target = this.mg.hasPlayer(this.targetID)
      ? this.mg.player(this.targetID)
      : null;

    // Dissolve when: time-boxed window elapsed, requestor dead/left the pact,
    // target gone, or target is no longer a genuine threat leader.
    if (
      ticks >= this.endTick ||
      !this.requestor.isAlive() ||
      this.requestor.coalitionTargetID() !== this.targetID ||
      target === null ||
      !this.isLegitimateTarget(target)
    ) {
      // Only clear if we still own this membership (don't stomp a newer pact).
      if (this.requestor.coalitionTargetID() === this.targetID) {
        this.requestor.leaveCoalition();
      }
      this.active = false;
    }
  }

  // A target is legitimate only while it is BOTH above the threat threshold AND
  // the current top-threat alive player (lowest-smallID tiebreak). This keeps the
  // coalition a genuine anti-snowball tool rather than a free dogpile buff.
  private isLegitimateTarget(target: Player): boolean {
    if (!target.isAlive()) {
      return false;
    }
    const threshold = this.mg.config().coalitionThreatThreshold();
    if (target.threatScore() < threshold) {
      return false;
    }
    return this.threatLeader() === target;
  }

  // Deterministic current threat leader: highest threatScore among alive
  // players, tiebroken by lowest smallID. Null if nobody clears 0 threat.
  private threatLeader(): Player | null {
    let leader: Player | null = null;
    for (const p of this.mg.players()) {
      if (!p.isAlive()) {
        continue;
      }
      if (p.threatScore() <= 0) {
        continue;
      }
      if (
        leader === null ||
        p.threatScore() > leader.threatScore() ||
        (p.threatScore() === leader.threatScore() &&
          p.smallID() < leader.smallID())
      ) {
        leader = p;
      }
    }
    return leader;
  }

  isActive(): boolean {
    return this.active;
  }
}
