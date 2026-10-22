import { Age } from "../../../core/game/Game";
import { GameView } from "../../view";
import {
  chooseObjective,
  computeAgeGates,
  computePrimitiveGoldPipeline,
  ObjectiveMemory,
  ObjectiveRailItem,
} from "./ObjectiveRail";
import { nearestWoodStand, tribeAnchor, WoodTarget } from "./WoodStand";

/** The stand scan walks a 141x141 box; twice a second is plenty. */
const WOOD_SCAN_INTERVAL_TICKS = 5;

/**
 * The ONE goal the HUD gives the local player at any moment.
 *
 * Three surfaces read a goal (the goal panel, the on-map wood marker and the
 * map director). Each used to call chooseObjective on its own with no memory,
 * so they could disagree with each other and with themselves a tick later.
 * They all ask this now: it remembers how far down the Stone Age ladder the
 * tribe has come (so the goal never steps back) and whether a wood stand is
 * actually in sight (so it never asks for one that is not there).
 */
export class ObjectiveDirector {
  private readonly memory: ObjectiveMemory = { stage: 0 };
  private cachedTick = -1;
  private cached: ObjectiveRailItem | null = null;
  private wood: WoodTarget | null = null;
  private woodScannedTick = Number.NEGATIVE_INFINITY;

  constructor(private readonly game: GameView) {}

  /** Current goal for my player, or null before spawning / after death. */
  current(): ObjectiveRailItem | null {
    const me = this.game.myPlayer();
    if (me === null || !me.isAlive() || !me.hasSpawned()) return null;
    const ticks = this.game.ticks();
    if (ticks === this.cachedTick && this.cached !== null) return this.cached;

    const config = this.game.config();
    if (me.age() === Age.Primitive) {
      if (ticks - this.woodScannedTick >= WOOD_SCAN_INTERVAL_TICKS) {
        this.woodScannedTick = ticks;
        const anchor = tribeAnchor(this.game, me);
        this.wood =
          anchor === null
            ? null
            : nearestWoodStand(this.game, anchor, me.smallID());
      }
    } else {
      this.wood = null;
    }

    this.cached = chooseObjective(
      me,
      config,
      computeAgeGates(me, config),
      computePrimitiveGoldPipeline(me, config),
      ticks,
      { memory: this.memory, woodInSight: this.wood !== null },
    );
    this.cachedTick = ticks;
    return this.cached;
  }

  /** The stand the goal points at, when the goal is "go get wood". */
  woodTarget(): WoodTarget | null {
    const goal = this.current();
    return goal?.pointToWood ? this.wood : null;
  }
}

const directors = new WeakMap<GameView, ObjectiveDirector>();

export function objectiveDirector(game: GameView): ObjectiveDirector {
  let director = directors.get(game);
  if (director === undefined) {
    director = new ObjectiveDirector(game);
    directors.set(game, director);
  }
  return director;
}
