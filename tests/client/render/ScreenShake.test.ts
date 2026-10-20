import { describe, expect, it } from "vitest";

import {
  MAX_SHAKE_PX,
  MAX_ZOOM_PUNCH,
  ScreenShake,
  TRAUMA_DECAY_PER_SEC,
  ZOOM_PUNCH_DECAY_PER_SEC,
  ZoomPunch,
} from "../../../src/client/render/ScreenShake";

describe("ScreenShake", () => {
  it("is inactive with zero offset before any trauma", () => {
    const s = new ScreenShake();
    expect(s.active).toBe(false);
    expect(s.offset()).toEqual({ x: 0, y: 0 });
  });

  it("becomes active after a jolt and decays back to rest", () => {
    const s = new ScreenShake();
    s.addTrauma(1);
    expect(s.active).toBe(true);
    // Advance past the full-strength settle time (1 / decay-per-sec seconds).
    s.update(1000 / TRAUMA_DECAY_PER_SEC + 50);
    expect(s.active).toBe(false);
    expect(s.offset()).toEqual({ x: 0, y: 0 });
  });

  it("saturates trauma at 1 so stacked jolts never exceed the cap", () => {
    const s = new ScreenShake();
    s.addTrauma(0.8);
    s.addTrauma(0.8); // 1.6 unclamped → must clamp to 1 (amp = MAX_SHAKE_PX)
    for (let i = 0; i < 500; i++) {
      const { x, y } = s.offset();
      expect(Math.abs(x)).toBeLessThanOrEqual(MAX_SHAKE_PX + 1e-9);
      expect(Math.abs(y)).toBeLessThanOrEqual(MAX_SHAKE_PX + 1e-9);
    }
  });

  it("ignores non-positive trauma", () => {
    const s = new ScreenShake();
    s.addTrauma(0);
    s.addTrauma(-1);
    expect(s.active).toBe(false);
  });

  it("shrinks the offset bound as trauma decays (trauma² falloff)", () => {
    const s = new ScreenShake();
    s.addTrauma(1);
    s.update(150); // partial decay
    const trauma = 1 - TRAUMA_DECAY_PER_SEC * 0.15;
    const amp = trauma * trauma * MAX_SHAKE_PX;
    for (let i = 0; i < 1000; i++) {
      const { x, y } = s.offset();
      expect(Math.abs(x)).toBeLessThanOrEqual(amp + 1e-9);
      expect(Math.abs(y)).toBeLessThanOrEqual(amp + 1e-9);
    }
    expect(amp).toBeLessThan(MAX_SHAKE_PX);
  });
});

describe("ZoomPunch", () => {
  it("is inactive with factor 1 before any punch", () => {
    const z = new ZoomPunch();
    expect(z.active).toBe(false);
    expect(z.factor()).toBe(1);
  });

  it("kicks the factor above 1 (bounded) and decays back to rest", () => {
    const z = new ZoomPunch();
    z.addPunch(1);
    expect(z.active).toBe(true);
    expect(z.factor()).toBeGreaterThan(1);
    expect(z.factor()).toBeLessThanOrEqual(1 + MAX_ZOOM_PUNCH + 1e-9);
    z.update(1000 / ZOOM_PUNCH_DECAY_PER_SEC + 50);
    expect(z.active).toBe(false);
    expect(z.factor()).toBe(1);
  });

  it("saturates stacked punches at the cap", () => {
    const z = new ZoomPunch();
    z.addPunch(0.8);
    z.addPunch(0.8);
    expect(z.factor()).toBeCloseTo(1 + MAX_ZOOM_PUNCH, 10);
  });

  it("ignores non-positive punches", () => {
    const z = new ZoomPunch();
    z.addPunch(0);
    z.addPunch(-2);
    expect(z.active).toBe(false);
  });

  it("eases out with punch² falloff as it decays", () => {
    const z = new ZoomPunch();
    z.addPunch(1);
    z.update(100);
    const punch = 1 - ZOOM_PUNCH_DECAY_PER_SEC * 0.1;
    expect(z.factor()).toBeCloseTo(1 + punch * punch * MAX_ZOOM_PUNCH, 10);
  });
});
