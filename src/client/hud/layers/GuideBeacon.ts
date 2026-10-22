import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { Age, Cell, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { Controller } from "../../Controller";
import { PlaySoundEffectEvent } from "../../sound/Sounds";
import { TransformHandler } from "../../TransformHandler";
import { SendAttackIntentEvent } from "../../Transport";
import { translateText } from "../../Utils";
import { GameView, PlayerView } from "../../view";
import { BuildPlacedEvent, BuildRefusedEvent } from "./BuildFeedback";
import { objectiveDirector } from "./ObjectiveDirector";
import type { ObjectiveRailItem } from "./ObjectiveRail";
import { WoodTarget, WorldPoint } from "./WoodStand";

// Two on-map markers that answer the two questions a new tribe has in its
// first minute, both read from the same replicated state every other HUD
// element uses (nothing here touches the sim):
//
//  - WOOD: the nearest wood stand worth walking to, while the tribe has no
//    resource income. Before this, the objective said "find a resource
//    frontier" and nothing on the map said where (real-screen audit
//    2026-10-21: ten minutes, objective pinned at 0%).
//  - MOVE: where the tribe was just told to go. A land click sends troops
//    toward that tile (every age, since 2026-10-21) and used to give no
//    acknowledgement at all.
//
// Positions are re-derived every animation frame from the camera, so the
// markers stay glued to their tiles while the player pans and zooms.

/** The move marker expires if the camp never arrives (blocked, abandoned). */
const MOVE_MARKER_TTL_TICKS = 900;
/** Keep clamped markers this far inside the viewport edge. */
const EDGE_PAD = 28;
/** How long the "placed" / "can't build here" stamp stays on the map. */
const BUILD_MARK_MS = 1800;
const BUILD_REFUSED_MS = 2600;

const BUILD_NAME_KEYS: Partial<Record<UnitType, string>> = {
  [UnitType.City]: "unit_display.short_permanent_settlement",
  [UnitType.Hut]: "unit_display.short_hut",
  [UnitType.TradeOutpost]: "unit_display.short_trade_outpost",
  [UnitType.ScoutLookout]: "unit_display.short_scout_lookout",
  [UnitType.PrimitiveFarm]: "unit_display.short_primitive_farm",
};

function buildName(type: UnitType): string {
  const key = BUILD_NAME_KEYS[type];
  return key !== undefined ? translateText(key) : String(type);
}

export { nearestWoodStand } from "./WoodStand";
export type { WoodTarget } from "./WoodStand";

/** Pure: should the wood beacon show for this player right now? */
export function wantsWoodBeacon(
  player: Pick<PlayerView, "age" | "hasSpawned" | "isAlive">,
  objective: Pick<ObjectiveRailItem, "pointToWood"> | null,
): boolean {
  if (!player.hasSpawned() || !player.isAlive()) return false;
  if (player.age() !== Age.Primitive) return false;
  // The goal panel decides: the marker shows exactly when the goal's next
  // action is "go to the wood stand", so the two never contradict.
  return objective?.pointToWood === true;
}

@customElement("guide-beacon")
export class GuideBeacon extends LitElement implements Controller {
  public game: GameView;
  public eventBus: EventBus;
  public transformHandler: TransformHandler;

  @state() private wood: WoodTarget | null = null;
  @state() private move: WorldPoint | null = null;
  // Build feedback: a stamp where the build order landed (or why it did not).
  @state() private build: (WorldPoint & { ok: boolean; label: string }) | null =
    null;
  private buildTimer: ReturnType<typeof setTimeout> | null = null;
  private moveTile: TileRef | null = null;
  private moveSetTick = 0;
  private rafId: number | null = null;

  createRenderRoot() {
    this.style.position = "fixed";
    this.style.inset = "0";
    this.style.zIndex = "150";
    this.style.pointerEvents = "none";
    return this;
  }

  init() {
    this.eventBus.on(SendAttackIntentEvent, (e) => {
      if (e.tile === null) return;
      this.moveTile = e.tile;
      this.moveSetTick = this.game.ticks();
      this.move = { x: this.game.x(e.tile), y: this.game.y(e.tile) };
      this.place();
    });
    this.eventBus.on(BuildPlacedEvent, (e) => {
      this.showBuildMark(
        e.tile,
        true,
        translateText("guide_beacon.build_placed", {
          name: buildName(e.unitType),
        }),
      );
      this.eventBus.emit(new PlaySoundEffectEvent("click"));
    });
    this.eventBus.on(BuildRefusedEvent, (e) => {
      this.showBuildMark(e.tile, false, e.reason);
      this.eventBus.emit(new PlaySoundEffectEvent("click", 0.6));
    });
    const frame = () => {
      this.place();
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  private showBuildMark(tile: TileRef, ok: boolean, label: string) {
    this.build = { x: this.game.x(tile), y: this.game.y(tile), ok, label };
    if (this.buildTimer !== null) clearTimeout(this.buildTimer);
    this.buildTimer = setTimeout(
      () => {
        this.build = null;
        this.buildTimer = null;
      },
      ok ? BUILD_MARK_MS : BUILD_REFUSED_MS,
    );
    // Restart the stamp animation even when the same marker is reused.
    const el = this.querySelector<HTMLElement>("#gb-build");
    if (el !== null) {
      el.classList.remove("is-stamping");
      void el.offsetWidth;
      el.classList.add("is-stamping");
    }
    this.place();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.buildTimer !== null) clearTimeout(this.buildTimer);
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
    const director = objectiveDirector(this.game);
    this.wood = wantsWoodBeacon(me, director.current())
      ? director.woodTarget()
      : null;
  }

  /** Glue both markers to their tiles for the current camera. */
  private place() {
    if (!this.transformHandler) return;
    this.placeOne("gb-wood", this.wood);
    this.placeOne("gb-move", this.move);
    this.placeOne("gb-build", this.build);
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
            700 12px/1.2 "Alegreya Sans",
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
        #gb-build {
          --gb-color: #e9d9a8;
        }
        #gb-build.is-refused {
          --gb-color: #d0563c;
        }
        #gb-build .gb-ring {
          animation: gb-stamp 0.5s ease-out 1 both;
          border-width: 3px;
        }
        #gb-build .gb-core {
          display: none;
        }
        /* Above the ring: below it sits the build ghost's own cost label. */
        #gb-build .gb-label {
          top: auto;
          bottom: 30px;
          border-radius: 3px;
          background: rgba(36, 26, 18, 0.95);
          border: 1px solid #120c07;
          border-left: 3px solid var(--gb-color);
          color: #efe6d2;
          max-width: 260px;
          white-space: normal;
          text-align: center;
          width: max-content;
        }
        @keyframes gb-stamp {
          0% {
            transform: scale(1.7);
            opacity: 0;
          }
          60% {
            transform: scale(0.92);
            opacity: 1;
          }
          100% {
            transform: scale(1);
            opacity: 1;
          }
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
      <div
        id="gb-build"
        class="gb-marker is-stamping ${this.build?.ok === false
          ? "is-refused"
          : ""}"
        role="status"
        aria-live="polite"
      >
        <div class="gb-arrow"></div>
        <div class="gb-ring"></div>
        <div class="gb-core"></div>
        <div class="gb-label">${this.build?.label ?? ""}</div>
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
