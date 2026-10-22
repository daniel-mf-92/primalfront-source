import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { EventBus } from "../../../core/EventBus";
import { Age, Cell, UnitType } from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { Controller } from "../../Controller";
import { MouseMoveEvent } from "../../InputHandler";
import { PlaySoundEffectEvent } from "../../sound/Sounds";
import { TransformHandler } from "../../TransformHandler";
import { translateText } from "../../Utils";
import { GameView, PlayerView } from "../../view";
import {
  BuildHoverEvent,
  BuildPlacedEvent,
  BuildRefusedEvent,
} from "./BuildFeedback";
import {
  atWildLandCap,
  LandClickFeedbackEvent,
  landClickLabel,
} from "./LandClick";
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
//    acknowledgement at all. The marker names the advance ("Pushing into the
//    wild", "Advancing on X") and lives exactly as long as the attack does;
//    a click that cannot advance gets its reason stamped where it landed
//    (LandClick.ts).
//
// Positions are re-derived every animation frame from the camera, so the
// markers stay glued to their tiles while the player pans and zooms.

/** A boat order has no attack to track until it lands: give it this long. */
const BOAT_MARKER_TTL_TICKS = 900;
/** Ticks for an attack order to reach the sim and show up as an attack. */
const ATTACK_GRACE_TICKS = 15;
/** An advance that ends this soon without arriving was turned back. */
const TURNED_BACK_TICKS = 60;
/** Safety net: no advance marker outlives this, attack or not. */
const MOVE_MARKER_MAX_TICKS = 3000;
/** Keep clamped markers this far inside the viewport edge. */
const EDGE_PAD = 28;
/** How long the "placed" / "can't build here" stamp stays on the map. */
const BUILD_MARK_MS = 1800;
const BUILD_REFUSED_MS = 2600;
/** Hover reason offset from the cursor: right of the ghost ring, raised. */
const HOVER_GAP_X = 58;
const HOVER_LIFT_Y = 34;

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

/** Pure: is an advance on this target (0 = the wild) still under way? */
export function advanceStillOut(
  me: Pick<PlayerView, "outgoingAttacks">,
  targetSmallID: number,
): boolean {
  return me
    .outgoingAttacks()
    .some((a) => a.targetID === targetSmallID && !a.retreating);
}

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
  // Build ghost hover: the reason (or "Renew") next to the cursor.
  @state() private hover: { label: string; ok: boolean } | null = null;
  private cursor = { x: -1000, y: -1000 };
  @state() private moveLabel = "";
  private moveTile: TileRef | null = null;
  private moveSetTick = 0;
  private moveTargetSmallID = 0;
  private moveBoat = false;
  private rafId: number | null = null;

  createRenderRoot() {
    this.style.position = "fixed";
    this.style.inset = "0";
    this.style.zIndex = "150";
    this.style.pointerEvents = "none";
    return this;
  }

  init() {
    this.eventBus.on(LandClickFeedbackEvent, (e) => {
      const label = landClickLabel(e.verdict);
      if (label === null || e.verdict.kind === "ignore") return;
      const text = translateText(label.key, label.params);
      if (e.verdict.kind === "refuse") {
        this.showBuildMark(e.tile, false, text);
        return;
      }
      this.moveTile = e.tile;
      this.moveSetTick = this.game.ticks();
      this.moveTargetSmallID = e.targetSmallID;
      this.moveBoat = e.verdict.boat;
      this.moveLabel = text;
      this.move = { x: this.game.x(e.tile), y: this.game.y(e.tile) };
      this.place();
    });
    this.eventBus.on(BuildPlacedEvent, (e) => {
      this.showBuildMark(
        e.tile,
        true,
        translateText(
          e.renewed
            ? "guide_beacon.build_renewed"
            : "guide_beacon.build_placed",
          { name: buildName(e.unitType) },
        ),
      );
      this.eventBus.emit(new PlaySoundEffectEvent("click"));
    });
    this.eventBus.on(MouseMoveEvent, (e) => {
      this.cursor = { x: e.x, y: e.y };
    });
    this.eventBus.on(BuildHoverEvent, (e) => {
      this.hover = e.label === null ? null : { label: e.label, ok: e.ok };
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
    if (this.moveTile !== null) this.trackAdvance(me);
    const director = objectiveDirector(this.game);
    this.wood = wantsWoodBeacon(me, director.current())
      ? director.woodTarget()
      : null;
  }

  /**
   * The advance marker lives exactly as long as the advance: it clears when
   * the tribe reaches the tile or the attack ends, never sits on a target
   * nobody is walking to. An advance the sim turns straight back gets its
   * reason stamped on the tile instead.
   */
  private trackAdvance(me: PlayerView) {
    const tile = this.moveTile;
    if (tile === null) return;
    const age = this.game.ticks() - this.moveSetTick;
    const arrived = this.game.ownerID(tile) === me.smallID();
    let over = arrived || age > MOVE_MARKER_MAX_TICKS;
    if (!over && this.moveBoat) {
      over = age > BOAT_MARKER_TTL_TICKS;
    } else if (!over && age > ATTACK_GRACE_TICKS) {
      over = !advanceStillOut(me, this.moveTargetSmallID);
      if (
        over &&
        age <= TURNED_BACK_TICKS &&
        this.moveTargetSmallID === 0 &&
        atWildLandCap(this.game.config(), me, this.game.ticks())
      ) {
        this.showBuildMark(
          tile,
          false,
          translateText("land_click.refuse_land_cap", {}),
        );
      }
    }
    if (over) {
      this.moveTile = null;
      this.move = null;
    }
  }

  /** Glue both markers to their tiles for the current camera. */
  private place() {
    if (!this.transformHandler) return;
    this.placeOne("gb-wood", this.wood);
    this.placeOne("gb-move", this.move);
    this.placeOne("gb-build", this.build);
    const hover = this.querySelector<HTMLElement>("#gb-hover");
    if (hover !== null) {
      // Beside the cursor, clear of the ghost's ring and its cost label
      // (drawn under the cursor); flipped left near the right edge.
      const flip = this.cursor.x > window.innerWidth - 320;
      hover.style.display = this.hover === null ? "none" : "block";
      hover.style.transform = `translate(${this.cursor.x + (flip ? -HOVER_GAP_X : HOVER_GAP_X)}px, ${this.cursor.y - HOVER_LIFT_Y}px)`;
      hover.classList.toggle("is-flipped", flip);
    }
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
        #gb-hover {
          position: absolute;
          left: 0;
          top: 0;
          display: none;
          will-change: transform;
          --gb-color: #e9d9a8;
        }
        #gb-hover.is-refused {
          --gb-color: #d0563c;
        }
        .gb-hover-label {
          max-width: 240px;
          width: max-content;
          padding: 3px 8px;
          border-radius: 3px;
          background: rgba(36, 26, 18, 0.95);
          border: 1px solid #120c07;
          border-left: 3px solid var(--gb-color);
          color: #efe6d2;
          font:
            700 12px/1.25 "Alegreya Sans",
            system-ui,
            sans-serif;
          box-shadow: 0 2px 0 rgba(0, 0, 0, 0.5);
        }
        #gb-hover.is-flipped .gb-hover-label {
          transform: translateX(-100%);
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
      <div
        id="gb-hover"
        class="${this.hover?.ok === false ? "is-refused" : ""}"
        role="status"
        aria-live="polite"
      >
        <div class="gb-hover-label">${this.hover?.label ?? ""}</div>
      </div>
      <div id="gb-move" class="gb-marker" aria-hidden="true">
        <div class="gb-arrow"></div>
        <div class="gb-ring"></div>
        <div class="gb-core"></div>
        <div class="gb-label">${this.moveLabel}</div>
      </div>
    `;
  }
}
