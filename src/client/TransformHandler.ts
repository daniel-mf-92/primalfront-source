import { EventBus, GameEvent } from "../core/EventBus";
import { Age, Cell } from "../core/game/Game";
import { CenterCameraEvent, DragEvent, ZoomEvent } from "./InputHandler";
import { GameView, PlayerView, UnitView } from "./view";

export class GoToPlayerEvent implements GameEvent {
  constructor(
    public player: PlayerView,
    public zoom?: number,
  ) {}
}

export class GoToPositionEvent implements GameEvent {
  constructor(
    public x: number,
    public y: number,
  ) {}
}

export class GoToUnitEvent implements GameEvent {
  constructor(public unit: UnitView) {}
}

export const GOTO_INTERVAL_MS = 16;
export const CAMERA_MAX_SPEED = 15;
export const CAMERA_SMOOTHING = 0.03;
export const PRIMITIVE_TRIBE_CAMERA_ZOOM = 11;

// ── Cinematic follow-cam (client-only) tuning ─────────────────────────────
// Cadence of the persistent follow driver. Matches GOTO_INTERVAL_MS so the
// retarget rate lines up with the easing rate.
export const FOLLOW_INTERVAL_MS = 16;
// Minimum wall-clock gap between two centroid samples used to finite-difference
// velocity. The tribe centroid (nameLocation) only moves on game ticks, so we
// sample coarsely to get a meaningful delta instead of a per-frame zero/spike.
export const FOLLOW_VELOCITY_SAMPLE_MS = 100;
// How far ahead (seconds of centroid velocity) to lead the camera so it
// anticipates a migrating tribe rather than trailing it.
// 0 since 2026-10-22: with attack-based expansion the tribe's label point
// hops as its shape changes, and leading it amplified each hop into a lurch
// (Marta: "the way the cam recentres is glitchy").
export const FOLLOW_LOOK_AHEAD_SECONDS = 0;
// Hard clamp on the look-ahead lead so a fast/teleporting centroid can't fling
// the camera off-screen (game-unit tiles).
export const FOLLOW_MAX_LOOK_AHEAD_TILES = 40;
// Exponential-moving-average factor for the velocity estimate (0..1); higher =
// snappier, lower = smoother. Kills single-tick jump spikes in the look-ahead.
export const FOLLOW_VELOCITY_SMOOTHING = 0.5;
// Screen-space deadzone as a fraction of the viewport half-extent. The camera
// only retargets once the follow goal leaves this box around the view center,
// which kills per-tick jitter when the tribe is essentially stationary.
// 0.4 since 2026-10-22: the camera stays put while the tribe is anywhere in
// the middle of the screen and only glides when it nears the edge, instead of
// re-centring on every small reshape of the territory.
export const FOLLOW_DEADZONE_FRACTION = 0.4;
// After a manual pan/zoom, follow yields for this idle window before it
// re-engages automatically (or immediately via setFollow(true)).
// 8 s since 2026-10-22: after you pan or zoom, the camera leaves the view to
// you for longer before it starts following again.
export const FOLLOW_REENGAGE_IDLE_MS = 8000;

// ── Adaptive auto-zoom (follow-cam zoom sizing) tuning ────────────────────
// While following a Primitive tribe the held zoom is sized to the tribe: a
// tight/small tribe pushes IN (intimate close-up), a spread-out and/or
// fast-migrating tribe pulls OUT (epic overview). The spread signal is
// PlayerView.nameLocation().size — a font size proportional to the tribe's
// territory extent (the largest inscribed rectangle of its territory; see
// NameBoxCalculator.placeName) — so we get a spread proxy for the cost of a
// single field read, never the per-tick player.tiles() copy (a known hotspot).
// The mapping is a subtle, monotone, piecewise-linear curve so the existing
// >0.25 re-zoom gate in followTick() eases toward the new zoom rather than
// snapping, and never disorients.
//
// The band is anchored: a "normal" tribe (spread == AUTOZOOM_SPREAD_ANCHOR,
// zero speed) resolves to exactly PRIMITIVE_TRIBE_CAMERA_ZOOM, so this stays a
// drop-in refinement of the old flat primitive zoom.
export const AUTOZOOM_SCALE_MAX = 13; // tightest zoom-in (small/tight tribe)
export const AUTOZOOM_SCALE_MIN = 6; // widest zoom-out (large/fast tribe)
export const AUTOZOOM_SPREAD_TIGHT = 3; // spread at/below which we hold SCALE_MAX
export const AUTOZOOM_SPREAD_ANCHOR = 12; // spread pinned to the anchor zoom
export const AUTOZOOM_SPREAD_WIDE = 45; // spread at/above which we hold SCALE_MIN
// Centroid speed (game-units/sec) folded into the spread signal so a fast
// migration zooms out a touch on top of raw spread. Capped so a single teleport
// spike can't fling the zoom.
export const AUTOZOOM_SPEED_WEIGHT = 0.5;
export const AUTOZOOM_SPEED_CAP = 24;
// Auto-zoom only RE-zooms once its target drifts this far from the held scale,
// and its target is quantized to this step. Together they stop the adaptive
// zoom from perpetually chasing every sub-tile spread change as the tribe
// grows — that continuous easing was felt as jitter/lag while zooming
// (2026-07-05 owner: "map less jitter lag e.g. when zooming"). Was a flat 0.25.
export const AUTOZOOM_REZOOM_THRESHOLD = 1.2;
export const AUTOZOOM_QUANTIZE = 0.5;

export class TransformHandler {
  public scale: number = 1.8;
  private _boundingRect: DOMRect;
  public offsetX: number = -350;
  public offsetY: number = -200;
  private lastGoToCallTime: number | null = null;

  private target: Cell | null;
  private targetScale: number | null = null;
  private intervalID: NodeJS.Timeout | null = null;
  private changed = false;

  // ── Follow-cam state (client-only) ──
  // null = follow decision falls back to the age default (ON in the Primitive
  // age); true/false = explicit toggle from setFollow().
  private followOverride: boolean | null = null;
  // Persistent driver that continuously retargets the camera onto the tribe.
  private followIntervalID: NodeJS.Timeout | null = null;
  // Wall-clock timestamp until which follow yields to the user's manual input.
  private followSuspendedUntil: number = 0;
  // Last centroid sample used to finite-difference velocity.
  private followSampleCell: Cell | null = null;
  private followSampleTime: number | null = null;
  // Smoothed centroid velocity (game units / second) for look-ahead.
  private autoZoomSettled = false;
  private followVelX: number = 0;
  private followVelY: number = 0;
  // Once the user manually zooms, auto-zoom yields SCALE control for good (the
  // follow-cam keeps panning to hold the tribe centered, but never yanks the
  // player's chosen zoom back). Re-armed by an explicit setFollow(true) or a
  // centerCamera() recenter. Kills the "camera fights my zoom" jitter.
  private autoZoomYielded: boolean = false;

  constructor(
    private game: GameView,
    private eventBus: EventBus,
    private canvas: HTMLElement,
  ) {
    this._boundingRect = this.canvas.getBoundingClientRect();
    this.eventBus.on(ZoomEvent, (e) => this.onZoom(e));
    this.eventBus.on(DragEvent, (e) => this.onMove(e));
    this.eventBus.on(GoToPlayerEvent, (e) => this.onGoToPlayer(e));
    this.eventBus.on(GoToPositionEvent, (e) => this.onGoToPosition(e));
    this.eventBus.on(GoToUnitEvent, (e) => this.onGoToUnit(e));
    this.eventBus.on(CenterCameraEvent, () => this.centerCamera());
    // Persistent follow driver: cheap no-op when follow is inactive (guarded on
    // isFollowing() + a live myPlayer), so it's safe to leave running for the
    // whole game session. Stopped by destroy().
    this.followIntervalID = setInterval(
      () => this.followTick(),
      FOLLOW_INTERVAL_MS,
    );
  }

  /** Stop all timers. Call when tearing down the renderer/game session. */
  destroy() {
    this.clearTarget();
    if (this.followIntervalID !== null) {
      clearInterval(this.followIntervalID);
      this.followIntervalID = null;
    }
  }

  public updateCanvasBoundingRect() {
    this._boundingRect = this.canvas.getBoundingClientRect();
  }

  boundingRect(): DOMRect {
    return this._boundingRect;
  }

  width(): number {
    return this.boundingRect().width;
  }
  hasChanged(): boolean {
    return this.changed;
  }
  resetChanged() {
    this.changed = false;
  }

  handleTransform(context: CanvasRenderingContext2D) {
    // Disable image smoothing for pixelated effect
    context.imageSmoothingEnabled = false;

    // Apply zoom and pan
    context.setTransform(
      this.scale,
      0,
      0,
      this.scale,
      this.game.width() / 2 - this.offsetX * this.scale,
      this.game.height() / 2 - this.offsetY * this.scale,
    );
  }

  worldToCanvasCoordinates(cell: Cell): { x: number; y: number } {
    // Step 1: Convert from Cell coordinates to game coordinates
    // (reverse of Math.floor operation - we'll use the exact values)
    const gameX = cell.x;
    const gameY = cell.y;

    // Step 2: Reverse the game center offset calculation
    // Original: gameX = centerX + this.game.width() / 2
    // Therefore: centerX = gameX - this.game.width() / 2
    const centerX = gameX - this.game.width() / 2;
    const centerY = gameY - this.game.height() / 2;

    // Step 3: Reverse the world point calculation
    // Original: centerX = (canvasX - this.game.width() / 2) / this.scale + this.offsetX
    // Therefore: canvasX = (centerX - this.offsetX) * this.scale + this.game.width() / 2
    const canvasX =
      (centerX - this.offsetX) * this.scale + this.game.width() / 2;
    const canvasY =
      (centerY - this.offsetY) * this.scale + this.game.height() / 2;

    return { x: canvasX, y: canvasY };
  }

  worldToScreenCoordinates(cell: Cell): { x: number; y: number } {
    // Step 1-3: Convert world coordinates to canvas coordinates in worldToCanvasCoordinates
    // Step 4 only where needed: Convert canvas coordinates back to screen coordinates
    const canvasCoords = this.worldToCanvasCoordinates(cell);
    return this.canvasToScreenCoordinates(canvasCoords.x, canvasCoords.y);
  }

  screenToWorldCoordinates(screenX: number, screenY: number): Cell {
    const f = this.screenToWorldCoordinatesFloat(screenX, screenY);
    return new Cell(Math.floor(f.x), Math.floor(f.y));
  }

  /** Like screenToWorldCoordinates but returns sub-tile precision. */
  screenToWorldCoordinatesFloat(
    screenX: number,
    screenY: number,
  ): { x: number; y: number } {
    const canvasCoords = this.screenToCanvasCoordinates(screenX, screenY);
    const gameX =
      (canvasCoords.x - this.game.width() / 2) / this.scale +
      this.offsetX +
      this.game.width() / 2;
    const gameY =
      (canvasCoords.y - this.game.height() / 2) / this.scale +
      this.offsetY +
      this.game.height() / 2;
    return { x: gameX, y: gameY };
  }

  canvasToScreenCoordinates(
    canvasX: number,
    canvasY: number,
  ): { x: number; y: number } {
    const canvasRect = this.boundingRect();
    return {
      x: canvasX + canvasRect.left,
      y: canvasY + canvasRect.top,
    };
  }

  screenToCanvasCoordinates(
    screenX: number,
    screenY: number,
  ): { x: number; y: number } {
    const canvasRect = this.boundingRect();
    return { x: screenX - canvasRect.left, y: screenY - canvasRect.top };
  }

  screenBoundingRect(): [Cell, Cell] {
    const canvasRect = this.boundingRect();
    const canvasWidth = canvasRect.width;
    const canvasHeight = canvasRect.height;

    const LeftX = -this.game.width() / 2 / this.scale + this.offsetX;
    const TopY = -this.game.height() / 2 / this.scale + this.offsetY;

    const gameLeftX = LeftX + this.game.width() / 2;
    const gameTopY = TopY + this.game.height() / 2;

    const rightX =
      (canvasWidth - this.game.width() / 2) / this.scale + this.offsetX;
    const bottomY =
      (canvasHeight - this.game.height() / 2) / this.scale + this.offsetY;

    const gameRightX = rightX + this.game.width() / 2;
    const gameBottomY = bottomY + this.game.height() / 2;

    return [
      new Cell(Math.floor(gameLeftX), Math.floor(gameTopY)),
      new Cell(Math.floor(gameRightX), Math.floor(gameBottomY)),
    ];
  }

  isOnScreen(cell: Cell): boolean {
    const [topLeft, bottomRight] = this.screenBoundingRect();
    return (
      cell.x > topLeft.x &&
      cell.x < bottomRight.x &&
      cell.y > topLeft.y &&
      cell.y < bottomRight.y
    );
  }

  screenCenter(): { screenX: number; screenY: number } {
    const [upperLeft, bottomRight] = this.screenBoundingRect();
    return {
      screenX: upperLeft.x + Math.floor((bottomRight.x - upperLeft.x) / 2),
      screenY: upperLeft.y + Math.floor((bottomRight.y - upperLeft.y) / 2),
    };
  }

  onGoToPlayer(event: GoToPlayerEvent) {
    this.clearTarget();
    const target = this.playerFocusCell(event.player);
    if (target === null) {
      return;
    }
    this.target = target;
    this.targetScale = this.playerFocusScale(event.player, event.zoom ?? null);
    this.intervalID = setInterval(() => this.goTo(), GOTO_INTERVAL_MS);
  }

  onGoToPosition(event: GoToPositionEvent) {
    this.clearTarget();
    this.target = new Cell(event.x, event.y);
    this.intervalID = setInterval(() => this.goTo(), GOTO_INTERVAL_MS);
  }

  onGoToUnit(event: GoToUnitEvent) {
    this.clearTarget();
    this.target = new Cell(
      this.game.x(event.unit.lastTile()),
      this.game.y(event.unit.lastTile()),
    );
    this.intervalID = setInterval(() => this.goTo(), GOTO_INTERVAL_MS);
  }

  centerCamera() {
    this.clearTarget();
    // Explicit recenter re-arms adaptive zoom (undoes a prior manual-zoom yield).
    this.autoZoomYielded = false;
    const player = this.game.myPlayer();
    if (!player) return;
    const target = this.playerFocusCell(player);
    if (target === null) return;
    this.target = target;
    this.targetScale = this.playerFocusScale(player, null);
    this.intervalID = setInterval(() => this.goTo(), GOTO_INTERVAL_MS);
  }

  // ── Follow-cam public API (consumed by downstream cinematic-camera agents) ──

  /**
   * Enable/disable continuous follow. `true`/`false` overrides the age default;
   * enabling re-engages immediately (cancels any manual-input suspension),
   * disabling stops any in-progress follow ease but leaves the current view put.
   */
  setFollow(enabled: boolean) {
    this.followOverride = enabled;
    if (enabled) {
      this.followSuspendedUntil = 0;
      // Explicit re-engage re-arms adaptive zoom (undoes a prior manual-zoom yield).
      this.autoZoomYielded = false;
    } else {
      this.clearTarget();
      this.resetFollowSampling();
    }
  }

  /**
   * Whether follow mode is engaged. Explicit setFollow() wins; otherwise the
   * default is ON only in the Primitive age (the tribe experience). This
   * reflects the *mode*, not transient yielding to manual input — a manual
   * pan/zoom suspends the ease for FOLLOW_REENGAGE_IDLE_MS but isFollowing()
   * stays true throughout.
   */
  isFollowing(): boolean {
    if (this.followOverride !== null) {
      return this.followOverride;
    }
    const me = this.game.myPlayer();
    return me !== null && me.age() === Age.Primitive;
  }

  /**
   * The current follow goal: the tribe centroid, led by its sampled velocity,
   * plus the scale the camera should hold. Returns null when there's nothing to
   * follow (no local player / no placement yet).
   *
   * Override hook: the AUTO-ZOOM agent can override this to replace `scale`
   * (e.g. size the frame to the tribe's spread) while reusing the centroid +
   * look-ahead math; the DIRECTOR agent can query it without re-deriving logic.
   */
  /** Half the height the bottom HUD panel covers, in map tiles. */
  private bottomPanelOffsetTiles(): number {
    if (typeof document === "undefined" || typeof window === "undefined") {
      return 0;
    }
    const hud = document.querySelector(".tc-hud-main");
    if (!(hud instanceof HTMLElement)) return 0;
    const rect = hud.getBoundingClientRect();
    const covered = window.innerHeight - rect.top;
    if (
      rect.height <= 0 ||
      covered <= 0 ||
      rect.top < window.innerHeight * 0.35
    ) {
      return 0;
    }
    return covered / 2 / Math.max(this.scale, 0.0001);
  }

  protected computeFollowTarget(): {
    cell: Cell;
    scale: number | null;
  } | null {
    const me = this.game.myPlayer();
    if (me === null) {
      return null;
    }
    const focus = this.playerFocusCell(me);
    if (focus === null) {
      return null;
    }
    const lead = this.followLead();
    // Centre the tribe in the open map above the bottom command panel, not
    // behind it (playtest 2026-10-22: the panel covered the player's land).
    const cell = new Cell(
      focus.x + lead.x,
      focus.y + lead.y + this.bottomPanelOffsetTiles(),
    );
    // Adaptive zoom sized to the tribe's spread (+ speed) in the Primitive age;
    // null in other ages = "leave zoom alone" (matches the old flat behavior of
    // playerFocusScale(me, null) for non-primitive players). Also null once the
    // user has manually zoomed (yield), so we pan-follow without touching scale.
    // Auto-zoom settles ONCE (the opening framing), then leaves zoom to the
    // player: re-zooming as the territory reshaped read as the camera pumping.
    let scale =
      this.autoZoomYielded || this.autoZoomSettled
        ? null
        : this.autoZoomScale(me);
    if (scale !== null) {
      // Quantize the target so tiny spread wiggles resolve to the SAME scale —
      // stops the perpetual re-ease that read as jitter.
      scale = Math.round(scale / AUTOZOOM_QUANTIZE) * AUTOZOOM_QUANTIZE;
    }
    return { cell, scale };
  }

  /**
   * Adaptive follow zoom: map the tribe's spread (+ centroid speed) onto a
   * scale within the primitive band [AUTOZOOM_SCALE_MIN, AUTOZOOM_SCALE_MAX],
   * pinned so a "normal" tribe holds PRIMITIVE_TRIBE_CAMERA_ZOOM. Small/tight
   * tribes push IN (higher scale); spread-out/fast tribes pull OUT (lower
   * scale). Returns null outside the Primitive age so we never fight manual
   * zoom once the tribe has grown up.
   */
  private autoZoomScale(player: PlayerView): number | null {
    if (player.age() !== Age.Primitive) {
      return null;
    }
    // Spread proxy: nameLocation().size ∝ territory extent (cheap field read,
    // no tiles() copy). Fall back to the anchor when there's no placement yet.
    const name = player.nameLocation();
    const spread =
      name !== undefined && name.size > 0 ? name.size : AUTOZOOM_SPREAD_ANCHOR;
    // Fold in ①'s already-smoothed centroid velocity so a fast-migrating tribe
    // zooms out slightly. Capped so a teleport spike can't fling the zoom.
    const speedMag = Math.hypot(this.followVelX, this.followVelY);
    const speedTerm =
      Math.min(speedMag, AUTOZOOM_SPEED_CAP) * AUTOZOOM_SPEED_WEIGHT;
    const effective = spread + speedTerm;

    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const anchorScale = PRIMITIVE_TRIBE_CAMERA_ZOOM;
    if (effective <= AUTOZOOM_SPREAD_ANCHOR) {
      // Tight side: SCALE_MAX at TIGHT → anchor at ANCHOR.
      const t = clamp01(
        (effective - AUTOZOOM_SPREAD_TIGHT) /
          (AUTOZOOM_SPREAD_ANCHOR - AUTOZOOM_SPREAD_TIGHT),
      );
      return AUTOZOOM_SCALE_MAX + (anchorScale - AUTOZOOM_SCALE_MAX) * t;
    }
    // Wide side: anchor at ANCHOR → SCALE_MIN at WIDE.
    const t = clamp01(
      (effective - AUTOZOOM_SPREAD_ANCHOR) /
        (AUTOZOOM_SPREAD_WIDE - AUTOZOOM_SPREAD_ANCHOR),
    );
    return anchorScale + (AUTOZOOM_SCALE_MIN - anchorScale) * t;
  }

  /** Persistent driver: continuously eases the camera onto the follow goal. */
  private followTick() {
    if (!this.isFollowing()) {
      // Follow off: drop any stale sampling so a later re-enable starts clean.
      this.resetFollowSampling();
      return;
    }

    const now = window.performance.now();

    // Yield to the user's hand after a manual pan/zoom. We still sample the
    // centroid so velocity is warm when follow re-engages, but we don't drive
    // the camera.
    if (now < this.followSuspendedUntil) {
      this.sampleFollowVelocity(now);
      return;
    }

    if (this.game.myPlayer() === null) {
      return;
    }

    this.sampleFollowVelocity(now);

    const goal = this.computeFollowTarget();
    if (goal === null) {
      return;
    }

    // Retarget when the goal leaves the screen-space deadzone OR the held scale
    // is off (so the primitive zoom still settles even if the tribe is still).
    const scaleWants =
      goal.scale !== null &&
      Math.abs(this.scale - goal.scale) > AUTOZOOM_REZOOM_THRESHOLD;
    if (goal.scale !== null && !scaleWants) {
      this.autoZoomSettled = true;
    }
    if (!scaleWants && this.withinFollowDeadzone(goal.cell)) {
      return;
    }

    // Hand off to the existing goTo() easing loop (keeps drag/zoom instant and
    // manual-input interruption intact — clearTarget() still cancels it).
    this.target = goal.cell;
    this.targetScale = goal.scale;
    this.intervalID ??= setInterval(() => this.goTo(), GOTO_INTERVAL_MS);
  }

  /** Suspend follow so the user's manual pan/zoom wins for a short idle window. */
  private suspendFollow() {
    this.followSuspendedUntil =
      window.performance.now() + FOLLOW_REENGAGE_IDLE_MS;
  }

  /** Look-ahead offset = smoothed centroid velocity * lookAhead, clamped. */
  private followLead(): { x: number; y: number } {
    const max = FOLLOW_MAX_LOOK_AHEAD_TILES;
    const leadX = this.followVelX * FOLLOW_LOOK_AHEAD_SECONDS;
    const leadY = this.followVelY * FOLLOW_LOOK_AHEAD_SECONDS;
    return {
      x: Math.max(-max, Math.min(max, leadX)),
      y: Math.max(-max, Math.min(max, leadY)),
    };
  }

  /**
   * Finite-difference the tribe centroid across coarse samples to estimate its
   * velocity, EMA-smoothed. Uses the RAW centroid (no look-ahead) so the
   * estimate is a real ground-truth derivative.
   */
  private sampleFollowVelocity(now: number) {
    const me = this.game.myPlayer();
    if (me === null) {
      return;
    }
    const focus = this.playerFocusCell(me);
    if (focus === null) {
      return;
    }

    if (this.followSampleCell === null || this.followSampleTime === null) {
      this.followSampleCell = focus;
      this.followSampleTime = now;
      return;
    }

    const dt = now - this.followSampleTime;
    if (dt < FOLLOW_VELOCITY_SAMPLE_MS) {
      return;
    }

    const dtSec = dt / 1000;
    const instVelX = (focus.x - this.followSampleCell.x) / dtSec;
    const instVelY = (focus.y - this.followSampleCell.y) / dtSec;

    const a = FOLLOW_VELOCITY_SMOOTHING;
    this.followVelX = this.followVelX * (1 - a) + instVelX * a;
    this.followVelY = this.followVelY * (1 - a) + instVelY * a;

    this.followSampleCell = focus;
    this.followSampleTime = now;
  }

  /**
   * True when `cell` sits inside the screen-space deadzone box centered on the
   * current view center. Reuses screenCenter()/screenBoundingRect() so the box
   * scales with the zoom level.
   */
  private withinFollowDeadzone(cell: Cell): boolean {
    const { screenX, screenY } = this.screenCenter();
    const [topLeft, bottomRight] = this.screenBoundingRect();
    const halfW = Math.abs(bottomRight.x - topLeft.x) / 2;
    const halfH = Math.abs(bottomRight.y - topLeft.y) / 2;
    const dzX = halfW * FOLLOW_DEADZONE_FRACTION;
    const dzY = halfH * FOLLOW_DEADZONE_FRACTION;
    return (
      Math.abs(cell.x - screenX) <= dzX && Math.abs(cell.y - screenY) <= dzY
    );
  }

  private resetFollowSampling() {
    this.followSampleCell = null;
    this.followSampleTime = null;
    this.followVelX = 0;
    this.followVelY = 0;
  }

  private playerFocusCell(player: PlayerView): Cell | null {
    const nameLocation = player.nameLocation();
    if (nameLocation !== undefined && nameLocation.size > 0) {
      return new Cell(nameLocation.x, nameLocation.y);
    }

    const spawnTile = player.spawnTile();
    if (spawnTile !== undefined) {
      return new Cell(this.game.x(spawnTile), this.game.y(spawnTile));
    }

    return null;
  }

  private playerFocusScale(
    player: PlayerView,
    requested: number | null,
  ): number | null {
    if (player.age() !== Age.Primitive) {
      return requested;
    }
    return Math.max(
      requested ?? PRIMITIVE_TRIBE_CAMERA_ZOOM,
      PRIMITIVE_TRIBE_CAMERA_ZOOM,
    );
  }

  private goTo() {
    const { screenX, screenY } = this.screenCenter();

    if (this.target === null) throw new Error("null target");

    const positionClose =
      Math.abs(this.target.x - screenX) + Math.abs(this.target.y - screenY) < 2;
    const scaleClose =
      this.targetScale === null ||
      Math.abs(this.scale - this.targetScale) < 0.01;
    if (positionClose && scaleClose) {
      this.clearTarget();
      return;
    }

    let dt: number;
    const now = window.performance.now();
    if (this.lastGoToCallTime === null) {
      dt = GOTO_INTERVAL_MS;
    } else {
      dt = now - this.lastGoToCallTime;
    }
    this.lastGoToCallTime = now;

    const r = 1 - Math.pow(CAMERA_SMOOTHING, dt / 1000);

    this.offsetX += Math.max(
      Math.min((this.target.x - screenX) * r, CAMERA_MAX_SPEED),
      -CAMERA_MAX_SPEED,
    );
    this.offsetY += Math.max(
      Math.min((this.target.y - screenY) * r, CAMERA_MAX_SPEED),
      -CAMERA_MAX_SPEED,
    );

    if (this.targetScale !== null) {
      const oldScale = this.scale;
      const zoomSmoothing = 0.7;
      const zoomR = 1 - Math.pow(zoomSmoothing, dt / 1000);
      const diff = this.targetScale - this.scale;
      const smoothStep = diff * zoomR;
      const minStep =
        Math.sign(diff) * Math.min(Math.abs(diff), (6.0 * dt) / 1000);
      this.scale +=
        Math.abs(smoothStep) >= Math.abs(minStep) ? smoothStep : minStep;
      // Keep screen center pinned as scale changes: (canvasSize - mapSize) / (2 * scale)
      // shifts the apparent center when canvas != map dimensions (always on mobile).
      const { width: canvasWidth, height: canvasHeight } = this.boundingRect();
      this.offsetX +=
        (canvasWidth - this.game.width()) *
        (1 / (2 * oldScale) - 1 / (2 * this.scale));
      this.offsetY +=
        (canvasHeight - this.game.height()) *
        (1 / (2 * oldScale) - 1 / (2 * this.scale));
    }

    this.changed = true;
  }

  onZoom(event: ZoomEvent) {
    this.clearTarget();
    this.suspendFollow();
    // The user picked a zoom — auto-zoom yields scale control so it never yanks
    // it back (follow still pans). Re-armed by setFollow(true)/centerCamera().
    this.autoZoomYielded = true;
    const oldScale = this.scale;
    const zoomFactor = 1 + event.delta / 600;
    this.scale /= zoomFactor;

    // Clamp the scale to prevent extreme zooming
    this.scale = Math.max(0.2, Math.min(20, this.scale));

    const canvasCoords = this.screenToCanvasCoordinates(event.x, event.y);

    // Calculate the world point we want to zoom towards
    const zoomPointX =
      (canvasCoords.x - this.game.width() / 2) / oldScale + this.offsetX;
    const zoomPointY =
      (canvasCoords.y - this.game.height() / 2) / oldScale + this.offsetY;

    // Adjust the offset
    this.offsetX =
      zoomPointX - (canvasCoords.x - this.game.width() / 2) / this.scale;
    this.offsetY =
      zoomPointY - (canvasCoords.y - this.game.height() / 2) / this.scale;
    this.clampOffsets();
    this.changed = true;
  }

  private clampOffsets() {
    const canvasRect = this.boundingRect();
    const canvasWidth = canvasRect.width;
    const canvasHeight = canvasRect.height;
    const gameWidth = this.game.width();
    const gameH = this.game.height();
    const scale = this.scale;

    // Allow panning so that up to half of the viewport can be outside the map on each side.
    // This lets a map corner be placed at the screen center, but no further.
    // Derivation (X axis):
    //   gameLeftX = -gameWidth/(2*scale) + offsetX + gameWidth/2 >= -vw/2
    //   gameRightX = (canvasWidth - gameWidth/2)/scale + offsetX + gameWidth/2 <= gameWidth + vw/2
    // Solving gives:
    //   minOffsetX = -gameWidth/2 + (gameWidth - canvasWidth) / (2*scale)
    //   maxOffsetX =  gameWidth/2 + (gameWidth - canvasWidth) / (2*scale)
    const minOffsetX = -gameWidth / 2 + (gameWidth - canvasWidth) / (2 * scale);
    const maxOffsetX = gameWidth / 2 + (gameWidth - canvasWidth) / (2 * scale);

    const minOffsetY = -gameH / 2 + (gameH - canvasHeight) / (2 * scale);
    const maxOffsetY = gameH / 2 + (gameH - canvasHeight) / (2 * scale);

    // Clamp offsets within computed bounds on each axis
    if (this.offsetX < minOffsetX) {
      this.offsetX = minOffsetX;
    } else if (this.offsetX > maxOffsetX) {
      this.offsetX = maxOffsetX;
    }

    if (this.offsetY < minOffsetY) {
      this.offsetY = minOffsetY;
    } else if (this.offsetY > maxOffsetY) {
      this.offsetY = maxOffsetY;
    }
  }

  onMove(event: DragEvent) {
    this.clearTarget();
    this.suspendFollow();
    this.offsetX -= event.deltaX / this.scale;
    this.offsetY -= event.deltaY / this.scale;
    this.clampOffsets();
    this.changed = true;
  }

  private clearTarget() {
    if (this.intervalID !== null) {
      clearInterval(this.intervalID);
      this.intervalID = null;
    }
    this.target = null;
    this.targetScale = null;
  }

  override(x: number = 0, y: number = 0, s: number = 1) {
    //hardset view position
    this.clearTarget();
    this.offsetX = x;
    this.offsetY = y;
    this.scale = s;
    this.changed = true;
  }

  centerAll(fit: number = 1) {
    //position entire map centered on the screen

    const vpWidth = this.boundingRect().width;
    const vpHeight = this.boundingRect().height;
    const mapWidth = this.game.width();
    const mapHeight = this.game.height();

    const scHor = (vpWidth / mapWidth) * fit;
    const scVer = (vpHeight / mapHeight) * fit;
    const tScale = Math.min(scHor, scVer);

    const oHor = (mapWidth - vpWidth) / 2 / tScale;
    const oVer = (mapHeight - vpHeight) / 2 / tScale;

    this.override(oHor, oVer, tScale);
  }
}
