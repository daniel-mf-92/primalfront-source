import { GameEvent } from "../EventBus";
import {
  ColoredTeams,
  Execution,
  Game,
  GameMode,
  Player,
  PlayerType,
  RankedType,
  Team,
} from "../game/Game";

export class WinEvent implements GameEvent {
  constructor(public readonly winner: Player) {}
}

export class WinCheckExecution implements Execution {
  private active = true;

  private mg: Game | null = null;

  // Hard time limit (in seconds) to force a winner before the server's
  // maxGameDuration hard kill. 170mins (10 mins before 3hrs)
  private static readonly HARD_TIME_LIMIT_SECONDS = 170 * 60;

  constructor() {}

  init(mg: Game, ticks: number) {
    this.mg = mg;
  }

  tick(ticks: number) {
    if (ticks % 10 !== 0) {
      return;
    }
    if (this.mg === null) throw new Error("Not initialized");

    if (this.mg.config().gameConfig().gameMode === GameMode.FFA) {
      this.checkWinnerFFA();
    } else {
      this.checkWinnerTeam();
    }
  }

  checkWinnerFFA(): void {
    if (this.mg === null) throw new Error("Not initialized");
    const sorted = this.mg
      .players()
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
    if (sorted.length === 0) {
      return;
    }

    if (this.mg.config().gameConfig().rankedType === RankedType.OneVOne) {
      const humans = sorted.filter(
        (p) => p.type() === PlayerType.Human && !p.isDisconnected(),
      );
      if (humans.length === 1) {
        this.mg.setWinner(humans[0], this.mg.stats().stats());
        console.log(`${humans[0].name()} has won the game`);
        this.active = false;
        return;
      }
    }

    const max = sorted[0];
    const timeElapsed = this.mg.elapsedGameSeconds();
    const numTilesWithoutFallout =
      this.mg.numLandTiles() - this.mg.numTilesWithFallout();

    // Domination win: a player crosses the tile-percentage threshold.
    if (
      (max.numTilesOwned() / numTilesWithoutFallout) * 100 >
      this.mg.config().percentageTilesOwnedToWin()
    ) {
      this.mg.setWinner(max, this.mg.stats().stats());
      console.log(`${max.name()} has won the game`);
      this.active = false;
      return;
    }

    // Time/turn cap reached with no domination winner: highest cumulative
    // Renown wins (Eonfront alternative victory).
    if (
      (this.mg.config().gameConfig().maxTimerValue !== undefined &&
        timeElapsed - this.mg.config().gameConfig().maxTimerValue! * 60 >= 0) ||
      timeElapsed >= WinCheckExecution.HARD_TIME_LIMIT_SECONDS
    ) {
      const renownWinner = this.highestRenownPlayer();
      const winner = renownWinner ?? max;
      this.mg.setWinner(winner, this.mg.stats().stats());
      console.log(`${winner.name()} has won the game on renown`);
      this.active = false;
    }
  }

  // Player with the highest cumulative Renown. Deterministic tiebreak on the
  // lowest smallID so the result is reproducible across clients.
  private highestRenownPlayer(): Player | null {
    if (this.mg === null) throw new Error("Not initialized");
    let best: Player | null = null;
    for (const p of this.mg.players()) {
      if (!p.isAlive()) continue;
      if (
        best === null ||
        p.renown() > best.renown() ||
        (p.renown() === best.renown() && p.smallID() < best.smallID())
      ) {
        best = p;
      }
    }
    return best;
  }

  checkWinnerTeam(): void {
    if (this.mg === null) throw new Error("Not initialized");
    const teamToTiles = new Map<Team, number>();
    for (const player of this.mg.players()) {
      const team = player.team();
      // Sanity check, team should not be null here
      if (team === null) continue;
      teamToTiles.set(
        team,
        (teamToTiles.get(team) ?? 0) + player.numTilesOwned(),
      );
    }
    const sorted = Array.from(teamToTiles.entries()).sort(
      (a, b) => b[1] - a[1],
    );
    if (sorted.length === 0) {
      return;
    }
    const max = sorted[0];
    const timeElapsed = this.mg.elapsedGameSeconds();
    const numTilesWithoutFallout =
      this.mg.numLandTiles() - this.mg.numTilesWithFallout();
    const percentage = (max[1] / numTilesWithoutFallout) * 100;

    // Domination win: a team crosses the tile-percentage threshold.
    if (percentage > this.mg.config().percentageTilesOwnedToWin()) {
      if (max[0] === ColoredTeams.Bot) return;
      this.mg.setWinner(max[0], this.mg.stats().stats());
      console.log(`${max[0]} has won the game`);
      this.active = false;
      return;
    }

    // Time/turn cap with no domination winner: team with the highest cumulative
    // Renown (sum over alive members) wins.
    if (
      (this.mg.config().gameConfig().maxTimerValue !== undefined &&
        timeElapsed - this.mg.config().gameConfig().maxTimerValue! * 60 >= 0) ||
      timeElapsed >= WinCheckExecution.HARD_TIME_LIMIT_SECONDS
    ) {
      const renownTeam = this.highestRenownTeam();
      const winner = renownTeam ?? max[0];
      if (winner === ColoredTeams.Bot) return;
      this.mg.setWinner(winner, this.mg.stats().stats());
      console.log(`${winner} has won the game on renown`);
      this.active = false;
    }
  }

  // Team with the highest cumulative Renown summed over alive members.
  private highestRenownTeam(): Team | null {
    if (this.mg === null) throw new Error("Not initialized");
    const teamToRenown = new Map<Team, number>();
    for (const player of this.mg.players()) {
      if (!player.isAlive()) continue;
      const team = player.team();
      if (team === null) continue;
      teamToRenown.set(team, (teamToRenown.get(team) ?? 0) + player.renown());
    }
    let best: Team | null = null;
    let bestRenown = -1;
    for (const [team, renown] of teamToRenown.entries()) {
      if (renown > bestRenown) {
        bestRenown = renown;
        best = team;
      }
    }
    return best;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
