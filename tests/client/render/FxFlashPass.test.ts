import { describe, expect, it } from "vitest";

import { flashEnvelope } from "../../../src/client/render/gl/passes/fx-pass/FxFlashPass";

describe("flashEnvelope", () => {
  it("is zero outside the [0, 1] window", () => {
    expect(flashEnvelope(-0.1)).toBe(0);
    expect(flashEnvelope(0)).toBe(0);
    expect(flashEnvelope(1)).toBe(0);
    expect(flashEnvelope(1.5)).toBe(0);
  });

  it("ramps up through the short attack and peaks at its end", () => {
    expect(flashEnvelope(0.03)).toBeGreaterThan(0);
    expect(flashEnvelope(0.03)).toBeLessThan(1);
    expect(flashEnvelope(0.06)).toBeCloseTo(1, 6);
  });

  it("decays monotonically after the attack (single decay — never strobes)", () => {
    let prev = flashEnvelope(0.06);
    for (let t = 0.1; t < 1; t += 0.05) {
      const v = flashEnvelope(t);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
    expect(prev).toBeGreaterThanOrEqual(0);
  });

  it("eases out quadratically (soft landing, no cutoff)", () => {
    // Near the end the slope must be shallow: value at 0.95 is tiny.
    expect(flashEnvelope(0.95)).toBeLessThan(0.02);
  });
});
