/**
 * Pure maths for the map camera's wheel / trackpad / keyboard zoom, shared by
 * InputHandler (delta normalisation) and TransformHandler (eased, anchored
 * zoom). Kept free of DOM and game state so it is unit-testable.
 */

// ── Wheel / trackpad / keyboard zoom (2026-10-22, Marta: "scroll breaks
// sometimes, doesnt elegantly scroll map") ─────────────────────────────────
// Zoom limits. The old linear factor `1 + delta/600` went to zero or negative
// for a big wheel delta (>= 600 px, a fast flick or a "page" deltaMode), which
// flung the scale to a clamp edge in one event. The factor is now exponential
// (never <= 0) and each event's delta is clamped.
export const ZOOM_MIN_SCALE = 0.2;
export const ZOOM_MAX_SCALE = 20;
// Zoom per pixel of normalised wheel delta: exp(-delta * k). 1/600 keeps the
// feel of the old linear factor for ordinary small deltas.
export const ZOOM_PER_PIXEL = 1 / 600;
// Largest delta one wheel event may apply (about x1.5 per event).
export const ZOOM_MAX_EVENT_DELTA = 240;
// Time constant of the zoom ease: the scale glides toward its target instead
// of jumping a full step per wheel notch.
export const ZOOM_EASE_MS = 70;
// Pixels per wheel "line" (Firefox deltaMode 1) — what browsers use.
export const WHEEL_LINE_PX = 16;

/**
 * Convert a WheelEvent delta to pixels. Firefox reports lines (deltaMode 1),
 * some mice report pages (deltaMode 2); Chrome/Safari report pixels.
 */
export function normalizeWheelDelta(
  delta: number,
  deltaMode: number,
  pagePx: number = 800,
): number {
  if (!Number.isFinite(delta)) return 0;
  if (deltaMode === 1) return delta * WHEEL_LINE_PX;
  if (deltaMode === 2) return delta * pagePx;
  return delta;
}

/**
 * Multiplier for the scale from one zoom delta (positive delta = zoom out).
 * Always > 0, and bounded per event so a huge delta can't fling the zoom.
 */
export function zoomFactorForDelta(delta: number): number {
  if (!Number.isFinite(delta)) return 1;
  const d = Math.max(
    -ZOOM_MAX_EVENT_DELTA,
    Math.min(ZOOM_MAX_EVENT_DELTA, delta),
  );
  return Math.exp(-d * ZOOM_PER_PIXEL);
}

export function clampZoomScale(scale: number): number {
  if (!Number.isFinite(scale)) return ZOOM_MIN_SCALE;
  return Math.max(ZOOM_MIN_SCALE, Math.min(ZOOM_MAX_SCALE, scale));
}

/**
 * One frame of the zoom ease: move the scale toward `target` in log space (so
 * zooming in and out feel the same), by the fraction 1 - exp(-dt / tau).
 */
export function easeZoomScale(
  current: number,
  target: number,
  dtMs: number,
  tauMs: number = ZOOM_EASE_MS,
): number {
  const alpha = 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
  const logNext =
    Math.log(current) + (Math.log(target) - Math.log(current)) * alpha;
  return Math.exp(logNext);
}

/**
 * The offset that keeps the world point under the canvas point (ax, ay) fixed
 * while the scale changes from oldScale to newScale. `halfW/halfH` are half
 * the game map size (the transform's centring term).
 */
export function anchoredZoomOffset(
  offset: number,
  anchor: number,
  half: number,
  oldScale: number,
  newScale: number,
): number {
  const world = (anchor - half) / oldScale + offset;
  return world - (anchor - half) / newScale;
}

// Wheel events further apart than this start a new gesture (pan vs zoom is
// decided per gesture).
export const WHEEL_GESTURE_GAP_MS = 180;
