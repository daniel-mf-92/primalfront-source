import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { Age, Cell, ResourceKind } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { Controller } from "../../Controller";
import { TransformHandler } from "../../TransformHandler";
import { SendPrimitiveMigrationIntentEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { GameView, PlayerView } from "../../view";
import { chooseObjective } from "./ObjectiveRail";

// Two on-map markers that answer the two questions a new tribe has in its
// first minute, both read from the same replicated state every other HUD
// element uses (nothing here touches the sim):
//
//  - WOOD: the nearest wood stand worth walking to, while the tribe has no
//    resource income. Before this, the objective said "find a resource
//    frontier" and nothing on the map said where (real-screen audit
//    2026-10-21: ten minutes, objective pinned at 0%).
//  - MOVE: where the camp was just told to go. A land click in the Primitive
//    era is a slow camp migration, not an attack, and used to give no
//    acknowledgement at all.
//
// Positions are re-derived every animation frame from the camera, so the
// markers stay glued to their tiles while the player pans and zooms.

/** How far (tiles) from the tribe's centre a stand is still worth pointing at. */
const WOOD_SEARCH_RADIUS = 70;
/** A node this depleted is a stump, not a stand. */
const MIN_USEFUL_WOOD = 4;
/** The move marker expires if the camp never arrives (blocked, abandoned). */
const MOVE_MARKER_TTL_TICKS = 900;
/** Keep clamped markers this far inside the viewport edge. */
const EDGE_PAD = 28;

interface WorldPoint {
  x: number;
  y: number;
}

export interface WoodTarget extends WorldPoint {
  tile: TileRef;
  dist: number;
}

/**
 * Pure: pick the nearest visible, un-owned, still-rich wood node around an
 * anchor. Exported so the choice is unit-testable without a renderer.
 */
export function nearestWoodStand(
  game: Pick<
    GameView,
    | "width"
    | "height"
    | "ref"
    | "resourceAt"
    | "isResourceVisible"
    | "ownerID"
    | "isValidCoord"
  >,
  anchor: WorldPoint,
  mySmallID: number,
  radius: number = WOOD_SEARCH_RADIUS,
): WoodTarget | null {
  const ax = Math.round(anchor.x);
  const ay = Math.round(anchor.y);
  let best: WoodTarget | null = null;
  const x0 = Math.max(0, ax - radius);
  const x1 = Math.min(game.width() - 1, ax + radius);
  const y0 = Math.max(0, ay - radius);
  const y1 = Math.min(game.height() - 1, ay + radius);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const tile = game.ref(x, y);
      const node = game.resourceAt(tile);
      if (node.kind !== ResourceKind.Wood || node.quantity < MIN_USEFUL_WOOD) {
        continue;
      }
      if (game.ownerID(tile) === mySmallID) continue;
      if (!game.isResourceVisible(tile)) continue;
      const dist = Math.hypot(x - ax, y - ay);
      if (best === null || dist < best.dist) {
        best = { tile, x, y, dist };
      }
    }
  }
  return best;
}

/** Pure: should the wood beacon show for this player right now? */
export function wantsWoodBeacon(
  player: Pick<PlayerView, "age" | "resources" | "hasSpawned" | "isAlive">,
  objectiveId: string,
): boolean {
  if (!player.hasSpawned() || !player.isAlive()) return false;
  if (player.age() !== Age.Primitive) return false;
  // Keep pointing at the next node until the first building goes up: one
  // captured node is a trickle, the rest of the stand is the real income.
  return (
    objectiveId === "find_resources" || objectiveId === "convert_resources"
  );
}

@customElement("guide-beacon")
export class GuideBeacon extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public transformHandler: TransformHandler;

  @state() private wood: WoodTarget | null = null;
  @state() private move: WorldPoint | null = null;
  private moveTile: TileRef | null = null;
  private moveSetTick = 0;
  private rafId: number | null = null;
  private scanCountdown = 0;

  createRenderRoot() {
    this.style.position = "fixed";
    this.style.inset = "0";
    this.style.zIndex = "150";
    this.style.pointerEvents = "none";
    return this;
  }

  init() {
    this.eventBus.on(SendPrimitiveMigrationIntentEvent, (e) => {
      this.moveTile = e.tile;
      this.moveSetTick = this.game.ticks();
      this.move = { x: this.game.x(e.tile), y: this.game.y(e.tile) };
      this.place();
    });
    const frame = () => {
      this.place();
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
  }

  tick() {
    const me = this.game.myPlayer();
    if (me === null || !me.hasSpawned()) {
      this.wood = null;
      this.move = null;
      return;
    }
    if (this.moveTile !== null) {
      const arrived = this.game.ownerID(this.moveTile) === me.smallID();
      const expired =
        this.game.ticks() - this.moveSetTick > MOVE_MARKER_TTL_TICKS;
      if (arrived || expired || me.age() !== Age.Primitive) {
        this.moveTile = null;
        this.move = null;
      }
    }
    // The stand search walks a 141x141 box; twice a second is plenty.
    if (this.scanCountdown-- > 0) return;
    this.scanCountdown = 5;
    const objective = chooseObjective(
      me,
      this.game.config(),
      undefined,
      undefined,
      this.game.ticks(),
    );
    if (!wantsWoodBeacon(me, objective.id)) {
      this.wood = null;
      return;
    }
    const anchor = this.anchorOf(me);
    if (anchor === null) {
      this.wood = null;
      return;
    }
    this.wood = nearestWoodStand(
      this.game,
      anchor,
      me.smallID(),
      objective.id === "find_resources" ? WOOD_SEARCH_RADIUS : 40,
    );
  }

  private anchorOf(me: PlayerView): WorldPoint | null {
    const name = me.nameLocation();
    if (name !== undefined && name.size > 0) {
      return { x: name.x, y: name.y };
    }
    const spawn = me.spawnTile();
    if (spawn === undefined) return null;
    return { x: this.game.x(spawn), y: this.game.y(spawn) };
  }

  /** Glue both markers to their tiles for the current camera. */
  private place() {
    if (!this.transformHandler) return;
    this.placeOne("gb-wood", this.wood);
    this.placeOne("gb-move", this.move);
  }

  private placeOne(id: string, point: WorldPoint | null) {
    const el = this.querySelector<HTMLElement>(`#${id}`);
    if (el === null) return;
    if (point === null) {
      el.style.display = "none";
      return;
    }
    const screen = this.transformHandler.worldToScreenCoordinates(
      new Cell(point.x + 0.5, point.y + 0.5),
    );
    const w = window.innerWidth;
    const h = window.innerHeight;
    const x = Math.max(EDGE_PAD, Math.min(w - EDGE_PAD, screen.x));
    const y = Math.max(EDGE_PAD, Math.min(h - EDGE_PAD, screen.y));
    const clamped = x !== screen.x || y !== screen.y;
    el.style.display = "block";
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.classList.toggle("is-offscreen", clamped);
    if (clamped) {
      const angle = Math.atan2(screen.y - y, screen.x - x);
      el.style.setProperty("--gb-arrow", `${angle}rad`);
    }
  }

  render() {
    const woodLabel =
      this.wood === null
        ? ""
        : translateText("guide_beacon.wood", {
            tiles: String(Math.max(1, Math.round(this.wood.dist))),
          });
    return html`
      <style>
        .gb-marker {
          position: absolute;
          left: 0;
          top: 0;
          width: 0;
          height: 0;
          display: none;
          will-change: transform;
        }
        .gb-ring {
          position: absolute;
          left: -22px;
          top: -22px;
          width: 44px;
          height: 44px;
          border-radius: 50%;
          border: 3px solid var(--gb-color);
          box-shadow:
            0 0 0 2px rgba(0, 0, 0, 0.55),
            0 0 18px var(--gb-color);
          animation: gb-pulse 1.4s ease-out infinite;
        }
        .gb-core {
          position: absolute;
          left: -6px;
          top: -6px;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: var(--gb-color);
          box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.6);
        }
        .gb-label {
          position: absolute;
          left: 50%;
          top: 26px;
          transform: translateX(-50%);
          white-space: nowrap;
          padding: 3px 9px;
          border-radius: 999px;
          font:
            700 12px/1.2 "Inter",
            system-ui,
            sans-serif;
          letter-spacing: 0.02em;
          color: #fff;
          background: rgba(10, 8, 6, 0.86);
          border: 1px solid var(--gb-color);
          text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
        }
        .gb-arrow {
          display: none;
          position: absolute;
          left: -30px;
          top: -30px;
          width: 60px;
          height: 60px;
          transform: rotate(var(--gb-arrow, 0rad));
        }
        .gb-arrow::after {
          content: "";
          position: absolute;
          right: -4px;
          top: 50%;
          margin-top: -8px;
          border-left: 14px solid var(--gb-color);
          border-top: 8px solid transparent;
          border-bottom: 8px solid transparent;
          filter: drop-shadow(0 0 3px rgba(0, 0, 0, 0.9));
        }
        .is-offscreen .gb-arrow {
          display: block;
        }
        .is-offscreen .gb-ring {
          animation-duration: 0.9s;
        }
        #gb-wood {
          --gb-color: #7ad96b;
        }
        #gb-move {
          --gb-color: #f0b35c;
        }
        #gb-move .gb-ring {
          animation: gb-ripple 1.1s ease-out infinite;
          border-width: 2px;
        }
        @keyframes gb-pulse {
          0% {
            transform: scale(0.75);
            opacity: 1;
          }
          100% {
            transform: scale(1.35);
            opacity: 0;
          }
        }
        @keyframes gb-ripple {
          0% {
            transform: scale(0.4);
            opacity: 0.95;
          }
          100% {
            transform: scale(1.3);
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .gb-ring {
            animation: none !important;
            opacity: 0.8;
          }
        }
      </style>
      <div id="gb-wood" class="gb-marker" aria-hidden="true">
        <div class="gb-arrow"></div>
        <div class="gb-ring"></div>
        <div class="gb-core"></div>
        <div class="gb-label">${woodLabel}</div>
      </div>
      <div id="gb-move" class="gb-marker" aria-hidden="true">
        <div class="gb-arrow"></div>
        <div class="gb-ring"></div>
        <div class="gb-core"></div>
        <div class="gb-label">${translateText("guide_beacon.move")}</div>
      </div>
    `;
  }
}
