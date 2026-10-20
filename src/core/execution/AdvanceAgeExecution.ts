import { Age, Execution, Game, MessageType, Player } from "../game/Game";

// Primal-meta: era advance is no longer an instant purchase — it is a GREAT
// WORK, a public, interruptible ritual (docs/PRIMAL_META.md).
//
// init() validates the full advance criteria and ESCROWS the gold toll
// (Player.startGreatWork). tick() advances progress while the player still
// holds the advance gates (settlement/keystone — Player.holdsAdvanceGates);
// successful enemy raids knock progress back (RaidExecution.setbackGreatWork);
// losing the gate mid-ritual FAILS the work (partial escrow refund).
// Completion releases the escrow and performs the real Player.advanceAge()
// (Golden Age / diffusion / penalty all fire there).
//
// A world-first bid (no player has reached the target age yet) is broadcast to
// EVERY player — the whole lobby sees the ritual start and can move to stop
// it. Repeat advances only notify the advancing player, so 100+ bot advances
// do not flood the event feed.
export class AdvanceAgeExecution implements Execution {
  private active = true;
  private mg: Game;
  private stalledAnnounced = false;

  constructor(private player: Player) {}

  activeDuringSpawnPhase(): boolean {
    return false;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    // startGreatWork re-validates criteria and enforces one-work-at-a-time,
    // so a spammed advance intent just no-ops here.
    if (!this.player.startGreatWork()) {
      this.active = false;
      return;
    }
    const gw = this.player.greatWork();
    if (gw === null) {
      this.active = false;
      return;
    }
    const params = {
      player: this.player.displayName(),
      age: Age[gw.targetAge],
      seconds: Math.floor(gw.required / 10),
    };
    if (!mg.eraReached(gw.targetAge)) {
      // A bid to drag the world into a NEW age — everyone hears about it.
      mg.displayMessage(
        "events_display.great_work_started_world",
        MessageType.GREAT_WORK_STARTED,
        null,
        undefined,
        params,
      );
    } else {
      mg.displayMessage(
        "events_display.great_work_started",
        MessageType.GREAT_WORK_STARTED,
        this.player.id(),
        undefined,
        params,
      );
    }
  }

  tick(ticks: number): void {
    const gw = this.player.greatWork();
    if (gw === null) {
      // Cleared externally (completed elsewhere or cancelled) — stand down.
      this.active = false;
      return;
    }
    if (!this.player.isAlive()) {
      // The ruins keep the gold: no refund on death.
      this.player.failGreatWork(0);
      this.active = false;
      return;
    }
    if (!this.player.holdsAdvanceGates()) {
      // The settlement/keystone anchoring the work was lost — it collapses.
      this.player.failGreatWork(this.mg.config().greatWorkFailRefundBps());
      this.mg.displayMessage(
        "events_display.great_work_failed",
        MessageType.GREAT_WORK_FAILED,
        this.player.id(),
        undefined,
        { age: Age[gw.targetAge] },
      );
      this.active = false;
      return;
    }
    this.player.setGreatWorkProgress(gw.progress + 1);
    if (gw.progress >= gw.required) {
      if (this.player.completeGreatWork()) {
        this.active = false;
      } else if (!this.stalledAnnounced) {
        // Criteria no longer met at the finish line (e.g. tech raided below
        // the threshold) — hold at full progress and retry each tick.
        this.stalledAnnounced = true;
        this.mg.displayMessage(
          "events_display.great_work_stalled",
          MessageType.GREAT_WORK_SETBACK,
          this.player.id(),
          undefined,
          { age: Age[gw.targetAge] },
        );
      }
    }
  }

  isActive(): boolean {
    return this.active;
  }
}
