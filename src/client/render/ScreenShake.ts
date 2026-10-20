import { GameEvent } from "../../core/EventBus";

/**
 * Request a one-shot camera shake. `magnitude` is trauma added in [0, 1]
 * (1 = a full-strength jolt). Emitted by controllers reacting to sim events
 * (e.g. a nuke detonation) and consumed by the WebGL frame loop. Presentation
 * only — never read by the lockstep simulation.
 */
export class ScreenShakeEvent implements GameEvent {
  constructor(public readonly magnitude: number) {}
}

/**
 * Request a one-shot zoom punch: a quick punch-in around the screen center
 * that eases back out. `magnitude` in [0, 1] scales the peak zoom kick.
 * Presentation only — consumed by the frame loop alongside ScreenShakeEvent.
 */
export class ZoomPunchEvent implements GameEvent {
  constructor(public readonly magnitude: number) {}
}

/**
 * Request a one-shot full-screen color wash on the map canvas (additive,
 * single decay — never strobes). Color channels in [0,1]; `alpha` is the
 * peak intensity request (the flash pass hard-caps it). HUD DOM sits above
 * the canvas and is unaffected.
 */
export class ScreenFlashEvent implements GameEvent {
  constructor(
    public readonly r: number,
    public readonly g: number,
    public readonly b: number,
    public readonly alpha: number,
    public readonly durationMs: number,
  ) {}
}

// Peak camera displacement (screen pixels) at full trauma, before the trauma²
// falloff. Kept modest so the map stays readable.
export const MAX_SHAKE_PX = 12;
// Trauma bled off per second — ~0.55s for a full-strength jolt to settle.
export const TRAUMA_DECAY_PER_SEC = 1.8;

/**
 * Trauma-based screen shake (Squirrel Eiserloh's model): events add trauma,
 * trauma decays linearly, and the per-frame offset scales with trauma² so the
 * shake eases out smoothly instead of cutting off. Pure and frame-rate
 * independent (driven by elapsed wall-clock ms), so it unit-tests cleanly and
 * the frame loop just samples it.
 */
export class ScreenShake {
  private trauma = 0;

  /** Add a jolt. Trauma saturates at 1 so stacked nukes can't fling the camera. */
  addTrauma(magnitude: number): void {
    if (!(magnitude > 0)) return;
    this.trauma = Math.min(1, this.trauma + magnitude);
  }

  /** Advance decay by `dtMs` elapsed wall-clock milliseconds. */
  update(dtMs: number): void {
    const dt = Math.max(0, dtMs) / 1000;
    this.trauma = Math.max(0, this.trauma - TRAUMA_DECAY_PER_SEC * dt);
  }

  get active(): boolean {
    return this.trauma > 0;
  }

  /**
   * Current shake offset in screen pixels. Random per axis per sample (the
   * classic jittery shake). |x|,|y| are bounded by MAX_SHAKE_PX. Uses
   * Math.random() — fine on the client, never in the sim.
   */
  offset(): { x: number; y: number } {
    if (this.trauma <= 0) return { x: 0, y: 0 };
    const amp = this.trauma * this.trauma * MAX_SHAKE_PX;
    return {
      x: (Math.random() * 2 - 1) * amp,
      y: (Math.random() * 2 - 1) * amp,
    };
  }
}

// Peak zoom multiplier gain at full punch: 1 + MAX_ZOOM_PUNCH (kept tiny —
// a punch should be felt, not seen as a zoom).
export const MAX_ZOOM_PUNCH = 0.045;
// Punch bled off per second — a full punch settles in ~0.3s.
export const ZOOM_PUNCH_DECAY_PER_SEC = 3.4;

/**
 * Zoom punch companion to ScreenShake: events add punch, punch decays
 * linearly, and the camera zoom is multiplied by 1 + punch² · MAX_ZOOM_PUNCH
 * so the kick eases out smoothly. Pure and frame-rate independent.
 */
export class ZoomPunch {
  private punch = 0;

  /** Add a kick. Saturates at 1 so stacked events can't lens-zoom the map. */
  addPunch(magnitude: number): void {
    if (!(magnitude > 0)) return;
    this.punch = Math.min(1, this.punch + magnitude);
  }

  /** Advance decay by `dtMs` elapsed wall-clock milliseconds. */
  update(dtMs: number): void {
    const dt = Math.max(0, dtMs) / 1000;
    this.punch = Math.max(0, this.punch - ZOOM_PUNCH_DECAY_PER_SEC * dt);
  }

  get active(): boolean {
    return this.punch > 0;
  }

  /** Current zoom multiplier (≥ 1). Apply to the final camera zoom only. */
  factor(): number {
    if (this.punch <= 0) return 1;
    return 1 + this.punch * this.punch * MAX_ZOOM_PUNCH;
  }
}
