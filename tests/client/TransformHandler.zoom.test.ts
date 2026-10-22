import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CenterCameraEvent,
  DragEvent,
  InputHandler,
  ZoomEvent,
} from "../../src/client/InputHandler";
import {
  PRIMITIVE_TRIBE_CAMERA_ZOOM,
  TransformHandler,
} from "../../src/client/TransformHandler";
import {
  anchoredZoomOffset,
  clampZoomScale,
  easeZoomScale,
  normalizeWheelDelta,
  WHEEL_LINE_PX,
  ZOOM_MAX_EVENT_DELTA,
  ZOOM_MAX_SCALE,
  ZOOM_MIN_SCALE,
  zoomFactorForDelta,
} from "../../src/client/utilities/CameraZoom";
import { GameView } from "../../src/client/view";
import { EventBus } from "../../src/core/EventBus";
import { Age } from "../../src/core/game/Game";
import {
  makeGameView,
  makeNameViewData,
  makePlayerView,
} from "../util/viewStubs";

function makeInputElement(): HTMLElement {
  const el = document.createElement("div");
  Object.defineProperty(el, "getBoundingClientRect", {
    value: () => ({ left: 0, top: 0, width: 1000, height: 600 }) as DOMRect,
  });
  return el;
}

function makeHandler(withPlayer: boolean) {
  const game = makeGameView({ width: 400, height: 300 });
  if (withPlayer) {
    const player = makePlayerView({
      game,
      data: { spawnTile: game.ref(120, 90), age: Age.Primitive },
      nameData: makeNameViewData({ x: 120, y: 90, size: 12 }),
    });
    (game as any)._myPlayer = player;
  }
  const bus = new EventBus();
  const handler = new TransformHandler(game, bus, makeInputElement());
  // Stop the persistent follow driver so the test drives everything.
  handler.destroy();
  return { handler, game, bus };
}

describe("CameraZoom maths", () => {
  it("normalises wheel deltas from lines and pages to pixels", () => {
    expect(normalizeWheelDelta(100, 0)).toBe(100);
    expect(normalizeWheelDelta(3, 1)).toBe(3 * WHEEL_LINE_PX);
    expect(normalizeWheelDelta(1, 2, 700)).toBe(700);
    expect(normalizeWheelDelta(Number.NaN, 0)).toBe(0);
  });

  it("zoom factor is always positive and bounded per event", () => {
    // The old linear 1 + d/600 hit zero at d = 600 and went negative past it.
    for (const d of [600, 1200, 1e6, -1e6]) {
      expect(zoomFactorForDelta(d)).toBeGreaterThan(0);
    }
    expect(zoomFactorForDelta(1e6)).toBe(
      zoomFactorForDelta(ZOOM_MAX_EVENT_DELTA),
    );
    expect(zoomFactorForDelta(-1e6)).toBe(
      zoomFactorForDelta(-ZOOM_MAX_EVENT_DELTA),
    );
    // In and out are symmetric: one notch each way returns to the start.
    expect(zoomFactorForDelta(100) * zoomFactorForDelta(-100)).toBeCloseTo(
      1,
      12,
    );
    // Small deltas feel like the old factor.
    expect(zoomFactorForDelta(10)).toBeCloseTo(1 / (1 + 10 / 600), 3);
    expect(zoomFactorForDelta(Number.NaN)).toBe(1);
  });

  it("clamps the scale to the zoom range", () => {
    expect(clampZoomScale(0)).toBe(ZOOM_MIN_SCALE);
    expect(clampZoomScale(-3)).toBe(ZOOM_MIN_SCALE);
    expect(clampZoomScale(1e9)).toBe(ZOOM_MAX_SCALE);
    expect(clampZoomScale(Number.POSITIVE_INFINITY)).toBe(ZOOM_MIN_SCALE);
    expect(clampZoomScale(3)).toBe(3);
  });

  it("eases monotonically toward the target in log space", () => {
    let s = 1;
    const seen: number[] = [];
    for (let i = 0; i < 30; i++) {
      s = easeZoomScale(s, 8, 16);
      seen.push(s);
    }
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThan(seen[i - 1]);
      expect(seen[i]).toBeLessThanOrEqual(8);
    }
    expect(seen[0]).toBeLessThan(4); // no full jump on the first frame
    expect(s).toBeCloseTo(8, 1);
    expect(easeZoomScale(2, 2, 16)).toBeCloseTo(2, 12);
  });

  it("anchored offset keeps the world point under the anchor fixed", () => {
    const half = 200;
    const anchor = 730;
    const offset = -55;
    const worldBefore = (anchor - half) / 1.5 + offset;
    const next = anchoredZoomOffset(offset, anchor, half, 1.5, 4.2);
    const worldAfter = (anchor - half) / 4.2 + next;
    expect(worldAfter).toBeCloseTo(worldBefore, 9);
  });
});

describe("TransformHandler eased zoom", () => {
  afterEach(() => vi.restoreAllMocks());

  it("glides over several frames, never jumps, keeps the cursor point fixed", () => {
    const { handler } = makeHandler(false);
    handler.override(0, 0, 2);
    const cursor = { x: 640, y: 210 };
    const before = handler.screenToWorldCoordinatesFloat(cursor.x, cursor.y);

    // A huge flick (old code: factor 1 + 5000/600 -> scale / 9.3 at once; a
    // negative delta of -600 or more divided by zero or a negative).
    handler.onZoom(new ZoomEvent(cursor.x, cursor.y, -5000));
    expect(handler.isZooming()).toBe(true);
    const target = 2 / zoomFactorForDelta(ZOOM_MAX_EVENT_DELTA);

    const scales: number[] = [];
    for (let i = 0; i < 40 && handler.isZooming(); i++) {
      handler.stepZoom(16);
      scales.push(handler.scale);
      const w = handler.screenToWorldCoordinatesFloat(cursor.x, cursor.y);
      expect(w.x).toBeCloseTo(before.x, 6);
      expect(w.y).toBeCloseTo(before.y, 6);
    }
    expect(scales.length).toBeGreaterThan(3);
    expect(scales[0]).toBeLessThan(target);
    expect(handler.scale).toBeCloseTo(target, 6);
    expect(handler.isZooming()).toBe(false);
  });

  it("accumulates a burst of notches onto the pending target", () => {
    const { handler } = makeHandler(false);
    handler.override(0, 0, 2);
    for (let i = 0; i < 3; i++) handler.onZoom(new ZoomEvent(500, 300, 100));
    while (handler.isZooming()) handler.stepZoom(16);
    expect(handler.scale).toBeCloseTo(2 * zoomFactorForDelta(100) ** 3, 6);
  });

  it("never leaves the zoom range however hard you scroll", () => {
    const { handler } = makeHandler(false);
    handler.override(0, 0, 2);
    for (let i = 0; i < 200; i++) handler.onZoom(new ZoomEvent(500, 300, 1e6));
    while (handler.isZooming()) handler.stepZoom(16);
    expect(handler.scale).toBe(ZOOM_MIN_SCALE);
    for (let i = 0; i < 200; i++) handler.onZoom(new ZoomEvent(500, 300, -1e6));
    while (handler.isZooming()) handler.stepZoom(16);
    expect(handler.scale).toBe(ZOOM_MAX_SCALE);
  });

  it("a camera glide (go to player) cancels a pending wheel zoom", () => {
    const { handler } = makeHandler(true);
    handler.onZoom(new ZoomEvent(500, 300, -200));
    expect(handler.isZooming()).toBe(true);
    handler.resetView();
    expect(handler.isZooming()).toBe(false);
    (handler as any).clearTarget();
  });
});

describe("TransformHandler default view", () => {
  it("fits the whole map when there is no player yet", () => {
    const { handler } = makeHandler(false);
    const spy = vi.spyOn(handler, "centerAll");
    handler.resetView();
    expect(spy).toHaveBeenCalledWith(0.9);
  });

  it("glides to the tribe at the default zoom and hands control back to follow", () => {
    const { handler, bus } = makeHandler(true);
    // The player zoomed by hand: follow is suspended and auto-zoom yielded.
    handler.onZoom(new ZoomEvent(10, 10, 300));
    expect((handler as any).followSuspendedUntil).toBeGreaterThan(0);
    expect((handler as any).autoZoomYielded).toBe(true);

    bus.emit(new CenterCameraEvent());
    expect((handler as any).target).toMatchObject({ x: 120, y: 90 });
    expect((handler as any).targetScale).toBe(PRIMITIVE_TRIBE_CAMERA_ZOOM);
    expect((handler as any).followSuspendedUntil).toBe(0);
    expect((handler as any).autoZoomYielded).toBe(false);
    (handler as any).clearTarget();
  });
});

describe("InputHandler wheel normalisation", () => {
  function makeInput() {
    const bus = new EventBus();
    const canvas = document.createElement("canvas");
    const input = new InputHandler(
      { inSpawnPhase: () => false } as unknown as GameView,
      { attackRatio: 20, ghostStructure: null, rocketDirectionUp: true } as any,
      canvas,
      bus,
    );
    const zooms: ZoomEvent[] = [];
    const drags: DragEvent[] = [];
    bus.on(ZoomEvent, (e) => zooms.push(e));
    bus.on(DragEvent, (e) => drags.push(e));
    let t = 1000;
    const wheel = (init: Partial<WheelEvent>, gapMs = 16) => {
      t += gapMs;
      (input as any).onScroll({
        x: 400,
        y: 300,
        deltaX: 0,
        deltaY: 0,
        deltaMode: 0,
        ctrlKey: false,
        shiftKey: false,
        timeStamp: t,
        ...init,
      });
    };
    return { zooms, drags, wheel };
  }

  it("converts Firefox line deltas to pixels before zooming", () => {
    const { zooms, wheel } = makeInput();
    wheel({ deltaY: 3, deltaMode: 1 });
    expect(zooms).toHaveLength(1);
    expect(zooms[0].delta).toBe(3 * WHEEL_LINE_PX);
  });

  it("a plain mouse wheel zooms", () => {
    const { zooms, drags, wheel } = makeInput();
    wheel({ deltaY: 120 });
    wheel({ deltaY: -120 });
    expect(zooms.map((z) => z.delta)).toEqual([120, -120]);
    expect(drags).toHaveLength(0);
  });

  it("a two-finger trackpad swipe pans for the whole gesture", () => {
    const { zooms, drags, wheel } = makeInput();
    wheel({ deltaX: 6, deltaY: 4 });
    wheel({ deltaX: 0, deltaY: 9 }); // same gesture, purely vertical
    expect(zooms).toHaveLength(0);
    expect(drags.map((d) => [d.deltaX, d.deltaY])).toEqual([
      [-6, -4],
      [-0, -9],
    ]);
    // After a pause a new gesture starts; a vertical wheel zooms again.
    wheel({ deltaY: 100 }, 500);
    expect(zooms).toHaveLength(1);
  });

  it("a fast trackpad pinch still zooms (was dropped above 10)", () => {
    const { zooms, wheel } = makeInput();
    wheel({ ctrlKey: true, deltaY: 30 });
    wheel({ ctrlKey: true, deltaY: 400 }); // browser zoom shortcut: ignored
    expect(zooms.map((z) => z.delta)).toEqual([300]);
  });
});
